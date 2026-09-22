/**
 * FIGHTER RIG - one humanoid built from primitives, posed entirely from the
 * recorded `TickSnapshot`.
 *
 * Two rules govern everything in this file:
 *
 *  1. The pose is a pure function of recorded state (position, facing, action,
 *     actionPhase, defense, posture, ground role/position, stamina, balance,
 *     down, out) plus the interpolation `alpha` and the simulated clock. There
 *     is no Math.random() anywhere: the same replay frame always produces the
 *     same pose, which is what makes scrubbing and stepping coherent.
 *
 *     The only smoothing applied on top is an exponential filter on the joint
 *     angles, which removes the pop when the engine switches action between two
 *     0.1 s ticks. It is a filter over recorded state, not invented motion.
 *
 *  2. Contact frames come from the engine's own action catalogue:
 *     `ACTIONS[kind].resolve / ACTIONS[kind].total` is the exact phase at which
 *     the engine rolled the outcome, so every strike animation reaches full
 *     extension on that phase and not a frame earlier or later.
 *
 * Nothing here depicts injury. A knocked-down fighter lies still and props
 * themselves up; a stopped fighter is seated quietly at the cage edge at 40%
 * opacity. There are no wounds, no blood, no limp ragdolls.
 */

import * as THREE from 'three';
import type { TickSnapshot, ActionKind, GroundPosition } from '../engine/types';
import { ACTIONS } from '../engine/actions';
import {
  CAGE_RADIUS, clamp, lerp, lerpAngle, damp, dampAngle, smoothstep, smootherstep, cornerColour,
  disposeObject3D,
} from './arena';

/** One fighter's slice of a recorded tick. */
export type SnapshotFighter = TickSnapshot['fighters'][number];

// ---------------------------------------------------------------- proportions

/** Reference skeleton for a 1.778 m athlete, in metres. Scaled per fighter. */
const DIM = {
  hipHeight: 0.93,
  pelvisR: 0.135,
  torsoLen: 0.50,     // hip joint -> shoulder line
  torsoR: 0.165,
  shoulderHalf: 0.195,
  hipHalf: 0.098,
  upperArm: 0.30,
  foreArm: 0.29,
  armR: 0.055,
  gloveR: 0.072,
  thigh: 0.44,
  shin: 0.42,
  thighR: 0.088,
  shinR: 0.070,
  neck: 0.09,
  headR: 0.112,
};

const REF_HEIGHT = 1.778;
const REF_MASS = 74;

// ---------------------------------------------------------------- pose model

/**
 * Every pose is a flat bag of angles (radians) and heights (metres) so that the
 * per-frame smoothing can run generically over the keys.
 *
 * Sign conventions, all in the fighter's own frame where +Z is "forward,
 * toward whoever they are facing":
 *   pitch  positive = forward / upward-front rotation
 *   yaw    positive = outward from the body midline (per limb side)
 *   roll   positive = abduction (limbs) or lean (torso/body)
 *   elbow  positive = forearm folds forward   knee positive = heel folds back
 */
interface Pose {
  hipY: number;       // height of the pelvis above the mat
  offX: number;       // lateral body offset in the fighter's own frame
  offZ: number;       // forward body offset in the fighter's own frame

  bodyPitch: number; bodyYaw: number; bodyRoll: number;
  torsoPitch: number; torsoYaw: number; torsoRoll: number;
  headPitch: number; headYaw: number;

  lArmPitch: number; lArmYaw: number; lArmRoll: number; lElbow: number;
  rArmPitch: number; rArmYaw: number; rArmRoll: number; rElbow: number;

  lLegPitch: number; lLegYaw: number; lLegRoll: number; lKnee: number;
  rLegPitch: number; rLegYaw: number; rLegRoll: number; rKnee: number;

  labelY: number;     // where the floating label sits, above the mat
}

const POSE_KEYS = [
  'hipY', 'offX', 'offZ',
  'bodyPitch', 'bodyYaw', 'bodyRoll',
  'torsoPitch', 'torsoYaw', 'torsoRoll',
  'headPitch', 'headYaw',
  'lArmPitch', 'lArmYaw', 'lArmRoll', 'lElbow',
  'rArmPitch', 'rArmYaw', 'rArmRoll', 'rElbow',
  'lLegPitch', 'lLegYaw', 'lLegRoll', 'lKnee',
  'rLegPitch', 'rLegYaw', 'rLegRoll', 'rKnee',
  'labelY',
] as const;

function neutralPose(): Pose {
  return {
    hipY: DIM.hipHeight, offX: 0, offZ: 0,
    bodyPitch: 0, bodyYaw: 0, bodyRoll: 0,
    torsoPitch: 0.07, torsoYaw: 0, torsoRoll: 0,
    headPitch: 0.06, headYaw: 0,
    lArmPitch: 0.55, lArmYaw: 0.10, lArmRoll: 0.24, lElbow: 2.05,
    rArmPitch: 0.45, rArmYaw: 0.10, rArmRoll: 0.26, rElbow: 2.20,
    lLegPitch: 0.24, lLegYaw: 0.10, lLegRoll: 0.14, lKnee: 0.28,
    rLegPitch: -0.20, rLegYaw: 0.12, rLegRoll: 0.16, rKnee: 0.34,
    labelY: 2.16,
  };
}

// ---------------------------------------------------------------- action timing

/**
 * The phase at which the engine resolves this action:
 * `ACTIONS[kind].resolve / ACTIONS[kind].total`. Animations peak exactly here.
 */
export function contactPhase(kind: ActionKind): number {
  const spec = ACTIONS[kind];
  if (!spec || spec.total <= 0) return 0.6;
  return clamp(spec.resolve / spec.total, 0.08, 0.95);
}

/**
 * 0 at the start of the action, exactly 1 on the engine's resolve frame, back
 * to 0 by the end. The retraction is slightly snappier than the extension,
 * which is what a punch actually looks like.
 */
function strikeCurve(kind: ActionKind, phase: number): number {
  const c = contactPhase(kind);
  const p = clamp(phase, 0, 1);
  if (p <= c) return smootherstep(p / c);
  return 1 - smoothstep(Math.pow((p - c) / Math.max(1e-3, 1 - c), 0.8));
}

/** Pre-contact chamber: rises to 1 just before contact, gone at contact. */
function chamber(kind: ActionKind, phase: number): number {
  const c = contactPhase(kind);
  const p = clamp(phase, 0, 1);
  if (p >= c) return 0;
  return Math.sin((p / c) * Math.PI) * 0.9;
}

// ---------------------------------------------------------------- ground poses

interface GroundPose {
  hipY: number; offZ: number; offX: number;
  bodyPitch: number; bodyYaw: number; bodyRoll: number;
  torsoPitch: number;
  legPitch: number; knee: number; legRoll: number;
  armPitch: number; elbow: number; armRoll: number;
}

/**
 * The five ground positions, for the top and the bottom fighter. Because both
 * fighters in a pair always face each other, "+Z" for one is "-Z" for the
 * other, so these offsets stack the pair correctly without either rig needing
 * to know where its partner is.
 *
 * A body pitch of -PI/2 means "supine, head away from the opponent"; +values
 * lean forward over them. The top fighter always sits higher.
 */
const GROUND: Record<Exclude<GroundPosition, 'none'>, { top: GroundPose; bottom: GroundPose }> = {
  guard: {
    // Bottom on their back, knees drawn up; top kneeling inside the legs.
    bottom: { hipY: 0.21, offZ: -0.18, offX: 0, bodyPitch: -1.57, bodyYaw: 0, bodyRoll: 0,
              torsoPitch: 0.34, legPitch: 1.40, knee: 1.30, legRoll: 0.34,
              armPitch: 1.10, elbow: 1.85, armRoll: 0.30 },
    top:    { hipY: 0.44, offZ: 0.22, offX: 0, bodyPitch: 0.55, bodyYaw: 0, bodyRoll: 0,
              torsoPitch: 0.26, legPitch: 1.25, knee: 2.15, legRoll: 0.30,
              armPitch: 1.35, elbow: 0.55, armRoll: 0.26 },
  },
  half: {
    // Bottom rolled onto a hip with one leg trapped; top flatter, chest to chest.
    bottom: { hipY: 0.23, offZ: -0.16, offX: 0, bodyPitch: -1.57, bodyYaw: 0, bodyRoll: 0.46,
              torsoPitch: 0.26, legPitch: 0.95, knee: 1.50, legRoll: 0.18,
              armPitch: 1.30, elbow: 1.25, armRoll: 0.34 },
    top:    { hipY: 0.36, offZ: 0.30, offX: 0, bodyPitch: 0.95, bodyYaw: 0, bodyRoll: 0.10,
              torsoPitch: 0.14, legPitch: 0.75, knee: 1.85, legRoll: 0.46,
              armPitch: 1.45, elbow: 0.78, armRoll: 0.42 },
  },
  side: {
    // Bottom flat; top lying across the chest, perpendicular, legs sprawled.
    bottom: { hipY: 0.20, offZ: -0.18, offX: 0, bodyPitch: -1.57, bodyYaw: 0, bodyRoll: 0.14,
              torsoPitch: 0.12, legPitch: 0.34, knee: 0.52, legRoll: 0.24,
              armPitch: 1.20, elbow: 1.50, armRoll: 0.48 },
    top:    { hipY: 0.34, offZ: 0.30, offX: 0.20, bodyPitch: 1.15, bodyYaw: 1.30, bodyRoll: 0,
              torsoPitch: 0.10, legPitch: -0.35, knee: 0.32, legRoll: 0.52,
              armPitch: 1.50, elbow: 0.95, armRoll: 0.55 },
  },
  mount: {
    // Bottom flat with hands up; top sitting upright astride, knees splayed.
    bottom: { hipY: 0.20, offZ: -0.24, offX: 0, bodyPitch: -1.57, bodyYaw: 0, bodyRoll: 0,
              torsoPitch: 0.14, legPitch: 0.22, knee: 0.55, legRoll: 0.28,
              armPitch: 1.50, elbow: 2.00, armRoll: 0.48 },
    top:    { hipY: 0.62, offZ: 0.42, offX: 0, bodyPitch: 0.12, bodyYaw: 0, bodyRoll: 0,
              torsoPitch: -0.04, legPitch: 1.35, knee: 2.05, legRoll: 0.85,
              armPitch: 0.70, elbow: 1.45, armRoll: 0.38 },
  },
  back: {
    // Both on their side facing the same way; the back-taker stacked behind.
    bottom: { hipY: 0.25, offZ: 0.04, offX: 0, bodyPitch: -1.55, bodyYaw: Math.PI, bodyRoll: 0.60,
              torsoPitch: 0.20, legPitch: 0.50, knee: 1.00, legRoll: 0.16,
              armPitch: 1.20, elbow: 2.20, armRoll: 0.28 },
    top:    { hipY: 0.42, offZ: 0.10, offX: 0.06, bodyPitch: -1.45, bodyYaw: 0, bodyRoll: 0.60,
              torsoPitch: 0.30, legPitch: 1.10, knee: 1.20, legRoll: 0.48,
              armPitch: 1.50, elbow: 2.40, armRoll: 0.10 },
  },
};

// ---------------------------------------------------------------- the rig

export interface RigOptions {
  label: string;
  team: 'A' | 'B';
  /** 0-based index within the whole roster; picks the corner shade / number. */
  index: number;
  massKg: number;
  heightM: number;
  /** Stamina pool for this fighter, used to scale the floating bar. */
  staminaMax: number;
}

export class FighterRig {
  readonly id: number;
  readonly label: string;
  readonly team: 'A' | 'B';
  readonly group = new THREE.Group();

  /** Corner colour, exposed so the renderer can tint impacts and UI rings. */
  readonly colour: number;

  private opts: RigOptions;
  private scale: number;
  private bulk: number;

  // scene graph handles
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();

  private disc!: THREE.Mesh;
  private discTex!: THREE.CanvasTexture;
  private highlight!: THREE.Mesh;
  private labelSprite!: THREE.Sprite;
  private labelCanvas!: HTMLCanvasElement;
  private labelTex!: THREE.CanvasTexture;
  private labelState = '';

  private materials: THREE.MeshStandardMaterial[] = [];

  private pose: Pose = neutralPose();
  private opacity = 1;
  /** Smoothed world position; only diverges from the snapshot once `out`. */
  private displayPos = new THREE.Vector3();
  private displayFacing = 0;
  private initialised = false;

  constructor(id: number, opts: RigOptions) {
    this.id = id;
    this.opts = opts;
    this.label = opts.label;
    this.team = opts.team;
    this.colour = cornerColour(opts.team, opts.index);
    this.scale = opts.heightM / REF_HEIGHT;
    // Heavier fighters get thicker limbs and a broader torso. Athlete A is
    // 200 lb against B's 150 lb, which lands around a 1.2x radius difference.
    this.bulk = clamp(Math.pow(opts.massKg / REF_MASS, 0.75), 0.82, 1.4);

    this.group.name = `fighter-${id}`;
    this.build();
  }

  // -------------------------------------------------------------- building

  private mat(color: number, roughness = 0.78, metalness = 0.04): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.push(m);
    return m;
  }

  private build(): void {
    const s = this.scale;
    const b = this.bulk;
    const D = DIM;

    // Deliberately neutral figure colour with all identity carried by the
    // corner colour; no skin tones are modelled.
    const skin = this.mat(0xb3ada4, 0.85);
    const kit = this.mat(this.colour, 0.66);
    const kitDark = this.mat(new THREE.Color(this.colour).multiplyScalar(0.72).getHex(), 0.62);
    const dark = this.mat(0x2b2f36, 0.7);

    const capsule = (r: number, total: number, seg = 10) =>
      new THREE.CapsuleGeometry(r, Math.max(0.01, total - 2 * r), 4, seg);

    // ---- root decorations ------------------------------------------------
    // A faint team disc under every fighter, carrying the fighter's own label.
    // This is the single biggest readability win for the top-down camera, and
    // it is how the B side is "numbered" when there is more than one of them.
    this.discTex = this.makeDiscTexture();
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.34 * s, 32),
      new THREE.MeshBasicMaterial({
        map: this.discTex, transparent: true, opacity: 0.85, depthWrite: false,
      })
    );
    // Lay the disc flat. The extra Z-roll puts the texture's "up" along the
    // fighter's +Z, so the label and the facing tick read the right way round
    // from the top camera.
    this.disc.rotation.set(-Math.PI / 2, 0, Math.PI);
    this.disc.position.y = 0.02;
    this.disc.renderOrder = 1;
    this.group.add(this.disc);

    // Highlight ring, shown only under the follow camera's target.
    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.36 * s, 0.47 * s, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffe0a8, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.026;
    this.highlight.renderOrder = 2;
    this.highlight.visible = false;
    this.group.add(this.highlight);

    // ---- body ------------------------------------------------------------
    this.body.rotation.order = 'YXZ';
    this.group.add(this.body);

    const pelvis = new THREE.Mesh(capsule(D.pelvisR * b, D.pelvisR * 2.3 * b, 14), kit);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.82);
    pelvis.position.y = -0.02 * s;
    pelvis.castShadow = true;
    this.body.add(pelvis);
    this.body.scale.setScalar(s);

    // ---- torso -----------------------------------------------------------
    this.torso.rotation.order = 'YXZ';
    this.torso.position.y = D.pelvisR * 0.4;
    this.body.add(this.torso);

    const chest = new THREE.Mesh(capsule(D.torsoR * b, D.torsoLen * 0.94, 16), skin);
    chest.position.y = D.torsoLen * 0.46;
    chest.scale.set(1.06, 1, 0.84);
    chest.castShadow = true;
    this.torso.add(chest);

    // Shoulder yoke in the corner colour - reads instantly from above.
    const yoke = new THREE.Mesh(capsule(0.072 * b, D.shoulderHalf * 2.1 * b, 12), kit);
    yoke.rotation.z = Math.PI / 2;
    yoke.position.y = D.torsoLen * 0.88;
    yoke.castShadow = true;
    this.torso.add(yoke);

    // Waistband, so the trunks read as kit rather than as a colour blob.
    const band = new THREE.Mesh(capsule(D.torsoR * b * 0.94, D.torsoR * b * 1.1, 14), kitDark);
    band.position.y = D.torsoLen * 0.08;
    band.scale.set(1.06, 1, 0.86);
    this.torso.add(band);

    // ---- head ------------------------------------------------------------
    const neck = new THREE.Mesh(capsule(0.045, D.neck + 0.05, 10), skin);
    neck.position.y = D.torsoLen + 0.02;
    this.torso.add(neck);

    this.head.position.y = D.torsoLen + D.neck + D.headR * 0.55;
    this.torso.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(D.headR, 20, 14), skin);
    skull.scale.set(0.95, 1.12, 1.0);
    skull.castShadow = true;
    this.head.add(skull);

    // A dark brow band: a face-direction cue, nothing anatomical.
    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(D.headR * 1.35, D.headR * 0.38, D.headR * 0.3),
      dark
    );
    brow.position.set(0, D.headR * 0.18, D.headR * 0.82);
    this.head.add(brow);

    // ---- arms ------------------------------------------------------------
    const buildArm = (side: 1 | -1, shoulder: THREE.Group, fore: THREE.Group) => {
      shoulder.rotation.order = 'YXZ';
      shoulder.position.set(side * D.shoulderHalf * b, D.torsoLen * 0.88, 0);
      this.torso.add(shoulder);

      const upper = new THREE.Mesh(capsule(D.armR * b, D.upperArm, 10), skin);
      upper.position.y = -D.upperArm / 2;
      upper.castShadow = true;
      shoulder.add(upper);

      fore.rotation.order = 'YXZ';
      fore.position.y = -D.upperArm;
      shoulder.add(fore);

      const lower = new THREE.Mesh(capsule(D.armR * b * 0.9, D.foreArm, 10), skin);
      lower.position.y = -D.foreArm / 2;
      lower.castShadow = true;
      fore.add(lower);

      const glove = new THREE.Mesh(new THREE.SphereGeometry(D.gloveR * b, 14, 10), kit);
      glove.position.y = -D.foreArm - D.gloveR * 0.3;
      glove.scale.set(1, 1.05, 1.15);
      glove.name = side > 0 ? 'glove-r' : 'glove-l';
      glove.castShadow = true;
      fore.add(glove);
    };
    buildArm(-1, this.armL, this.foreL);
    buildArm(1, this.armR, this.foreR);

    // ---- legs ------------------------------------------------------------
    const buildLeg = (side: 1 | -1, hip: THREE.Group, shin: THREE.Group) => {
      hip.rotation.order = 'YXZ';
      hip.position.set(side * D.hipHalf * b, -0.04, 0);
      this.body.add(hip);

      const thigh = new THREE.Mesh(capsule(D.thighR * b, D.thigh, 12), skin);
      thigh.position.y = -D.thigh / 2;
      thigh.castShadow = true;
      hip.add(thigh);

      shin.rotation.order = 'YXZ';
      shin.position.y = -D.thigh;
      hip.add(shin);

      const calf = new THREE.Mesh(capsule(D.shinR * b, D.shin, 12), skin);
      calf.position.y = -D.shin / 2;
      calf.castShadow = true;
      shin.add(calf);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085 * b, 0.055, 0.2), dark);
      foot.name = side > 0 ? 'foot-r' : 'foot-l';
      foot.position.set(0, -D.shin - 0.02, 0.045);
      foot.castShadow = true;
      shin.add(foot);

      // Ankle wrap in the corner colour.
      const wrap = new THREE.Mesh(capsule(D.shinR * b * 1.05, 0.07, 10), kitDark);
      wrap.position.y = -D.shin + 0.06;
      shin.add(wrap);
    };
    buildLeg(-1, this.legL, this.shinL);
    buildLeg(1, this.legR, this.shinR);

    // ---- floating label --------------------------------------------------
    this.buildLabel();
  }

  /**
   * The floor disc: a soft corner-coloured ring with the fighter's label in the
   * middle, so a 1v5 bout is readable from directly overhead.
   */
  private makeDiscTexture(): THREE.CanvasTexture {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d')!;
    const c = S / 2;
    const hex = '#' + this.colour.toString(16).padStart(6, '0');

    g.clearRect(0, 0, S, S);
    g.globalAlpha = 0.22;
    g.fillStyle = hex;
    g.beginPath(); g.arc(c, c, S * 0.46, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.85;
    g.strokeStyle = hex;
    g.lineWidth = 5;
    g.beginPath(); g.arc(c, c, S * 0.44, 0, Math.PI * 2); g.stroke();

    // A short tick at the front of the disc marks which way the fighter faces.
    g.beginPath();
    g.moveTo(c, c - S * 0.44);
    g.lineTo(c, c - S * 0.30);
    g.lineWidth = 7;
    g.stroke();

    g.globalAlpha = 0.95;
    g.fillStyle = hex;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${this.label.length > 2 ? 40 : 54}px system-ui, -apple-system, Segoe UI, sans-serif`;
    g.fillText(this.label, c, c + 4);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildLabel(): void {
    const cv = document.createElement('canvas');
    cv.width = 320;
    cv.height = 116;
    this.labelCanvas = cv;
    this.labelTex = new THREE.CanvasTexture(cv);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: this.labelTex,
      transparent: true,
      depthTest: false,     // labels must never be swallowed by the cage mesh
      depthWrite: false,
    });
    this.labelSprite = new THREE.Sprite(material);
    this.labelSprite.scale.set(1.05, 0.38, 1);
    this.labelSprite.center.set(0.5, 0);
    this.labelSprite.renderOrder = 20;
    this.group.add(this.labelSprite);

    this.drawLabel(1, '');
  }

  /** Redraws the label canvas. Called only when something actually changes. */
  private drawLabel(staminaFrac: number, status: string): void {
    const g = this.labelCanvas.getContext('2d')!;
    const W = this.labelCanvas.width;
    const H = this.labelCanvas.height;
    g.clearRect(0, 0, W, H);

    // Plate
    const r = 16;
    g.fillStyle = 'rgba(16,19,24,0.78)';
    g.beginPath();
    g.moveTo(r, 4);
    g.lineTo(W - r, 4);
    g.quadraticCurveTo(W - 4, 4, W - 4, 4 + r);
    g.lineTo(W - 4, H - r - 4);
    g.quadraticCurveTo(W - 4, H - 4, W - r, H - 4);
    g.lineTo(r, H - 4);
    g.quadraticCurveTo(4, H - 4, 4, H - r - 4);
    g.lineTo(4, 4 + r);
    g.quadraticCurveTo(4, 4, r, 4);
    g.closePath();
    g.fill();

    // Corner flash down the left edge.
    const hex = '#' + this.colour.toString(16).padStart(6, '0');
    g.fillStyle = hex;
    g.fillRect(4, 10, 9, H - 28);

    g.fillStyle = '#f2f4f7';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '600 42px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(this.label, 26, 36);

    if (status) {
      g.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      g.fillStyle = 'rgba(232,236,242,0.72)';
      g.textAlign = 'right';
      g.fillText(status, W - 18, 34);
    }

    // Stamina bar
    const bx = 26, by = 66, bw = W - 52, bh = 16;
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(bx, by, bw, bh);
    const frac = clamp(staminaFrac, 0, 1);
    g.fillStyle = frac > 0.55 ? '#7fc99a' : frac > 0.28 ? '#e0bf6a' : '#d4766a';
    g.fillRect(bx, by, bw * frac, bh);
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 2;
    g.strokeRect(bx, by, bw, bh);

    this.labelTex.needsUpdate = true;
  }

  // -------------------------------------------------------------- pose maths

  /**
   * Build the target pose for this frame. Pure function of recorded state.
   *
   * @param f      interpolated fighter state for this frame
   * @param phase  interpolated action phase, 0..1
   * @param time   simulated seconds (used only for periodic motion: stance
   *               bounce, breathing - all deterministic in the replay clock)
   */
  private targetPose(f: SnapshotFighter, phase: number, time: number): Pose {
    const p = neutralPose();
    const fatigue = clamp(1 - f.stamina / Math.max(1, this.opts.staminaMax), 0, 1);
    const wobble = clamp(1 - f.balance / 100, 0, 1);

    // ---------- stopped: seated at the cage edge, still -------------------
    if (f.out) {
      p.hipY = 0.30; p.offZ = 0;
      p.bodyPitch = -0.16; p.bodyRoll = 0;
      p.torsoPitch = 0.10; p.headPitch = 0.16;
      p.lLegPitch = 1.45; p.rLegPitch = 1.42;
      p.lKnee = 0.42; p.rKnee = 0.48;
      p.lLegRoll = 0.26; p.rLegRoll = 0.28;
      p.lArmPitch = 0.45; p.rArmPitch = 0.42;
      p.lElbow = 0.85; p.rElbow = 0.80;
      p.lArmRoll = 0.40; p.rArmRoll = 0.42;
      p.labelY = 1.20;
      return p;
    }

    // ---------- knocked down: lying still, slowly propping up -------------
    if (f.down) {
      const recover = f.action === 'recover' ? smoothstep(phase) : 0;
      const breathe = Math.sin(time * 1.7) * 0.5 + 0.5;
      p.hipY = 0.21 + 0.03 * recover + 0.008 * breathe;
      p.offZ = -0.14;
      p.bodyPitch = lerp(-1.55, -1.15, recover);
      p.bodyRoll = 0.34;
      p.torsoPitch = 0.22 + 0.30 * recover + 0.03 * breathe;
      p.headPitch = 0.18 - 0.10 * recover;
      p.lArmPitch = 1.35; p.lElbow = 2.30; p.lArmRoll = 0.30;
      p.rArmPitch = lerp(1.1, 1.5, recover); p.rElbow = lerp(1.9, 0.9, recover); p.rArmRoll = 0.44;
      p.lLegPitch = 0.80; p.lKnee = 1.20; p.lLegRoll = 0.18;
      p.rLegPitch = 0.45 + 0.5 * recover; p.rKnee = 0.80 + 0.6 * recover; p.rLegRoll = 0.30;
      p.labelY = 1.05;
      return p;
    }

    // ---------- on the ground --------------------------------------------
    if (f.posture === 'ground' && f.groundPosition !== 'none' && f.groundRole !== 'none') {
      const table = GROUND[f.groundPosition as Exclude<GroundPosition, 'none'>];
      const gp = f.groundRole === 'top' ? table.top : table.bottom;
      this.applyGroundPose(p, gp);
      this.applyGroundAction(p, f, phase, time);
      p.labelY = Math.max(0.95, gp.hipY + 0.95);
      return p;
    }

    // ---------- standing / clinch ----------------------------------------
    const clinched = f.posture === 'clinch';

    // Stance bounce: slows and shallows as the fighter tires.
    const moving = f.action === 'advance' || f.action === 'retreat' || f.action === 'circle';
    const bounceHz = (moving ? 2.1 : 1.55) * (1 - 0.3 * fatigue);
    const bounceAmp = 0.024 * (1 - 0.55 * fatigue) * (clinched ? 0.35 : 1);
    p.hipY = DIM.hipHeight - 0.03 * fatigue + Math.sin(time * Math.PI * 2 * bounceHz) * bounceAmp;

    // Fatigue and lost balance both drop the guard and add a slow sway.
    const guardDrop = 0.45 * fatigue;
    p.lArmPitch -= guardDrop * 0.4; p.rArmPitch -= guardDrop * 0.4;
    p.lElbow -= guardDrop * 0.5; p.rElbow -= guardDrop * 0.5;
    p.torsoPitch += 0.14 * fatigue;
    p.torsoRoll += Math.sin(time * 1.1) * 0.05 * wobble;
    p.bodyRoll += Math.sin(time * 0.83) * 0.045 * wobble;

    if (clinched) {
      // Chest to chest, both sets of hands inside, weight forward.
      p.hipY -= 0.05;
      p.torsoPitch = 0.30;
      p.lArmPitch = 1.28; p.rArmPitch = 1.24;
      p.lElbow = 1.75; p.rElbow = 1.80;
      p.lArmRoll = -0.05; p.rArmRoll = -0.02;
      p.lArmYaw = -0.18; p.rArmYaw = -0.16;
      p.lLegPitch = 0.10; p.rLegPitch = -0.22;
      p.lKnee = 0.42; p.rKnee = 0.46;
      p.lLegRoll = 0.24; p.rLegRoll = 0.26;
      p.headPitch = 0.22;
    } else {
      this.applyDefense(p, f);
    }

    this.applyStandingAction(p, f, phase, time);
    p.labelY = 2.12 + (p.hipY - DIM.hipHeight);
    return p;
  }

  /** Guard shape from the engine's defensive state. */
  private applyDefense(p: Pose, f: SnapshotFighter): void {
    switch (f.defense) {
      case 'highGuard':
        p.lArmPitch = 0.34; p.rArmPitch = 0.32;
        p.lElbow = 2.55; p.rElbow = 2.58;
        p.lArmRoll = 0.08; p.rArmRoll = 0.10;
        p.torsoPitch = 0.20; p.headPitch = 0.20;
        break;
      case 'slip':
        p.torsoRoll += 0.34; p.torsoPitch += 0.16;
        p.headYaw = 0.26; p.hipY -= 0.05;
        p.lElbow += 0.15; p.rElbow += 0.15;
        break;
      case 'parry':
        p.lArmPitch = 0.95; p.lElbow = 1.25; p.lArmRoll = 0.10;
        p.rArmPitch = 0.40; p.rElbow = 2.40;
        break;
      case 'sprawl':
        p.hipY -= 0.14; p.torsoPitch = 0.42;
        p.lLegPitch = -0.30; p.rLegPitch = -0.42;
        p.lKnee = 0.20; p.rKnee = 0.18;
        p.lArmPitch = 1.20; p.rArmPitch = 1.18;
        p.lElbow = 0.70; p.rElbow = 0.68;
        break;
      case 'frame':
        p.lArmPitch = 1.40; p.rArmPitch = 1.38;
        p.lElbow = 0.55; p.rElbow = 0.58;
        break;
      case 'subDefend':
        p.lArmPitch = 0.95; p.rArmPitch = 0.92;
        p.lElbow = 2.55; p.rElbow = 2.58;
        p.lArmRoll = -0.05; p.rArmRoll = -0.05;
        p.headPitch = 0.26;
        break;
      default:
        break;
    }
  }

  /**
   * Standing action overlays. `u` peaks at exactly ACTIONS[kind].resolve /
   * ACTIONS[kind].total so the animation's contact frame is the engine's.
   */
  private applyStandingAction(p: Pose, f: SnapshotFighter, phase: number, time: number): void {
    const kind = f.action;
    const u = strikeCurve(kind, phase);
    const ch = chamber(kind, phase);

    switch (kind) {
      // ---- straight punches: lead = left, rear = right -------------------
      case 'jab':
        p.lArmPitch = lerp(p.lArmPitch, 1.60, u);
        p.lElbow = lerp(p.lElbow, 0.12, u);
        p.lArmRoll = lerp(p.lArmRoll, 0.02, u);
        p.torsoYaw = 0.22 * u;
        p.torsoPitch += 0.08 * u;
        p.hipY += 0.015 * u;
        p.offZ += 0.10 * u;          // step into it
        break;
      case 'cross':
        p.rArmPitch = lerp(p.rArmPitch, 1.66, u);
        p.rElbow = lerp(p.rElbow, 0.08, u);
        p.rArmRoll = lerp(p.rArmRoll, 0.00, u);
        p.lElbow = lerp(p.lElbow, 2.45, u * 0.7);     // lead hand back to the chin
        p.torsoYaw = -0.40 * u;
        p.bodyYaw = -0.18 * u;                        // rear hip turns over
        p.rLegPitch += 0.18 * u;
        p.rKnee = lerp(p.rKnee, 0.12, u);
        p.offZ += 0.15 * u;
        break;
      case 'hook':
        // A hook is a horizontal arc: the shoulder abducts so that the bent
        // elbow carries the glove around the side instead of lifting it.
        p.rArmPitch = lerp(p.rArmPitch, 0.30, u);
        p.rArmRoll = lerp(p.rArmRoll, -1.20, u);
        p.rElbow = lerp(p.rElbow, 1.50, Math.max(u, ch));
        p.rArmYaw = lerp(0.40, -1.00, u);             // sweeps across the midline
        p.torsoYaw = -0.50 * u;
        p.bodyYaw = -0.26 * u;
        p.lElbow = lerp(p.lElbow, 2.5, u * 0.8);
        p.offZ += 0.11 * u;
        break;
      case 'uppercut':
        p.rArmPitch = lerp(p.rArmPitch, 0.70, u);
        p.rElbow = lerp(2.55, 2.05, u);
        p.rArmYaw = -0.12 * u;
        p.torsoPitch = lerp(p.torsoPitch, -0.16, u);  // drive up from the legs
        p.hipY += -0.06 * ch + 0.045 * u;
        p.torsoYaw = -0.26 * u;
        p.lElbow = lerp(p.lElbow, 2.5, u * 0.8);
        p.offZ += 0.09 * u;
        break;

      // ---- kicks: rear leg unless noted ---------------------------------
      case 'lowKick':
      case 'bodyKick':
      case 'headKick': {
        // Hip flexion chosen so the foot arrives at thigh / ribs / head height.
        const lift = kind === 'lowKick' ? 0.85 : kind === 'bodyKick' ? 1.78 : 2.25;
        p.rLegPitch = lerp(-0.2, lift, u);
        p.rLegYaw = lerp(0.85, -0.45, u);             // swings around the arc
        p.rLegRoll = lerp(0.55, 0.18, u);
        p.rKnee = lerp(1.15 * (0.4 + ch), 0.12, u);   // chamber then whip out
        p.bodyYaw = -0.42 * u;
        p.torsoRoll = 0.20 + 0.28 * u;                // lean away from the kick
        p.torsoPitch -= 0.22 * u;
        p.lLegPitch = lerp(p.lLegPitch, 0.02, u);
        p.lKnee = lerp(p.lKnee, 0.10, u);
        p.hipY += (kind === 'headKick' ? -0.05 : -0.02) * u;
        p.offZ += 0.17 * u;
        p.lArmPitch = lerp(p.lArmPitch, 0.05, u);     // lead arm counterbalances
        p.rArmPitch = lerp(p.rArmPitch, -0.35, u);
        p.rElbow = lerp(p.rElbow, 1.0, u);
        break;
      }
      case 'teep':
        p.lLegPitch = lerp(0.22, 1.35, u);
        p.lKnee = lerp(1.55 * (0.5 + ch), 0.12, u);
        p.lLegRoll = 0.10;
        p.torsoPitch = lerp(p.torsoPitch, -0.28, u);
        p.hipY -= 0.04 * u;
        p.offZ += 0.20 * u;
        p.lArmPitch = lerp(p.lArmPitch, 0.0, u);
        break;

      // ---- clinch work ----------------------------------------------------
      case 'clinchEntry':
        p.lArmPitch = lerp(p.lArmPitch, 1.25, u);
        p.rArmPitch = lerp(p.rArmPitch, 1.22, u);
        p.lElbow = lerp(p.lElbow, 0.90, u);
        p.rElbow = lerp(p.rElbow, 0.95, u);
        p.lArmYaw = -0.20 * u; p.rArmYaw = -0.18 * u;
        p.torsoPitch += 0.30 * u;
        p.hipY -= 0.05 * u;
        break;
      case 'clinchKnee':
        p.rLegPitch = lerp(p.rLegPitch, 1.78, u);
        p.rKnee = lerp(p.rKnee, 2.10, Math.max(u * 0.9, ch * 0.6));
        p.rLegRoll = 0.24 + 0.14 * u;
        p.lKnee = lerp(p.lKnee, 0.18, u);
        p.torsoPitch = 0.20 + 0.16 * u;
        p.lArmPitch = 1.30; p.rArmPitch = 1.28;
        p.lElbow = 1.95; p.rElbow = 1.98;
        p.lArmYaw = -0.22; p.rArmYaw = -0.20;
        p.hipY += 0.03 * u;
        p.offZ += 0.06 * u;
        break;
      case 'breakClinch':
        p.lArmPitch = lerp(p.lArmPitch, 1.48, u);
        p.rArmPitch = lerp(p.rArmPitch, 1.46, u);
        p.lElbow = lerp(p.lElbow, 0.22, u);
        p.rElbow = lerp(p.rElbow, 0.20, u);
        p.torsoPitch = lerp(p.torsoPitch, -0.22, u);
        p.hipY -= 0.05 * u;
        p.offZ = -0.16 * u;                           // posts off and steps back
        break;

      // ---- level changes ---------------------------------------------------
      case 'shoot':
        p.hipY -= 0.28 * u;
        p.offZ = 0.30 * u;
        p.torsoPitch = 0.34 + 0.52 * u;
        p.bodyPitch = 0.08 * u;
        p.lArmPitch = lerp(p.lArmPitch, 1.42, u);
        p.rArmPitch = lerp(p.rArmPitch, 1.40, u);
        p.lElbow = lerp(p.lElbow, 0.62, u);
        p.rElbow = lerp(p.rElbow, 0.60, u);
        p.lLegPitch = lerp(p.lLegPitch, 0.95, u);
        p.lKnee = lerp(p.lKnee, 1.45, u);
        p.rLegPitch = lerp(p.rLegPitch, -0.70, u);
        p.rKnee = lerp(p.rKnee, 0.30, u);
        p.headPitch = 0.10 + 0.18 * u;
        break;
      case 'sprawlDefend':
        p.hipY -= 0.36 * u;
        p.offZ = -0.08 * u;
        p.torsoPitch = 0.34 + 0.40 * u;
        p.bodyPitch = 0.02 * u;     // the lean is in the torso: keep feet planted
        p.lLegPitch = lerp(p.lLegPitch, -0.92, u);
        p.rLegPitch = lerp(p.rLegPitch, -0.96, u);
        p.lKnee = lerp(p.lKnee, 0.14, u);
        p.rKnee = lerp(p.rKnee, 0.12, u);
        p.lLegRoll = 0.34 * u; p.rLegRoll = 0.36 * u;
        p.lArmPitch = lerp(p.lArmPitch, 1.60, u);
        p.rArmPitch = lerp(p.rArmPitch, 1.50, u);
        p.lElbow = lerp(p.lElbow, 0.24, u);
        p.rElbow = lerp(p.rElbow, 0.22, u);
        break;

      // ---- footwork --------------------------------------------------------
      case 'advance':
        p.torsoPitch += 0.10;
        p.lLegPitch += 0.16 * Math.sin(time * 9);
        p.rLegPitch -= 0.16 * Math.sin(time * 9);
        break;
      case 'retreat':
        p.torsoPitch -= 0.08;
        p.lLegPitch -= 0.14 * Math.sin(time * 9);
        p.rLegPitch += 0.14 * Math.sin(time * 9);
        break;
      case 'circle':
        p.bodyRoll += 0.06 * Math.sin(time * 4);
        p.lLegRoll += 0.16; p.rLegRoll += 0.14;
        p.lLegPitch += 0.10 * Math.sin(time * 7.5);
        p.rLegPitch -= 0.10 * Math.sin(time * 7.5);
        break;
      case 'recover':
        // Standing but gathering themselves: guard high, weight settled.
        p.lElbow = 2.45; p.rElbow = 2.48;
        p.torsoPitch += 0.10;
        p.hipY -= 0.03;
        break;
      default:
        break;
    }
  }

  private applyGroundPose(p: Pose, gp: GroundPose): void {
    p.hipY = gp.hipY; p.offZ = gp.offZ; p.offX = gp.offX;
    p.bodyPitch = gp.bodyPitch; p.bodyYaw = gp.bodyYaw; p.bodyRoll = gp.bodyRoll;
    p.torsoPitch = gp.torsoPitch;
    p.lLegPitch = gp.legPitch; p.rLegPitch = gp.legPitch * 0.88;
    p.lKnee = gp.knee; p.rKnee = gp.knee * 0.92;
    p.lLegRoll = gp.legRoll; p.rLegRoll = gp.legRoll;
    p.lArmPitch = gp.armPitch; p.rArmPitch = gp.armPitch * 0.95;
    p.lElbow = gp.elbow; p.rElbow = gp.elbow * 0.94;
    p.lArmRoll = gp.armRoll; p.rArmRoll = gp.armRoll;
    p.headPitch = 0.12;
  }

  /** Ground-specific action overlays, again keyed to the engine's resolve tick. */
  private applyGroundAction(p: Pose, f: SnapshotFighter, phase: number, time: number): void {
    const kind = f.action;
    const u = strikeCurve(kind, phase);
    const arc = Math.sin(Math.PI * clamp(phase, 0, 1));

    switch (kind) {
      case 'groundStrike':
        // A hammering arm: because the body is already pitched over the
        // opponent, "forward" for the arm reads as "downward" on screen.
        p.rArmPitch = lerp(0.20, 1.95, u);
        p.rElbow = lerp(1.85, 0.32, u);
        p.rArmYaw = 0.22 - 0.30 * u;
        p.torsoYaw = -0.28 * u;
        p.torsoPitch += 0.22 * u;
        break;
      case 'passGuard':
        // Circling around the legs: a lateral arc rather than a strike.
        p.bodyYaw += 0.55 * arc;
        p.offX += 0.26 * arc;
        p.offZ += 0.10 * arc;
        p.lLegPitch = lerp(p.lLegPitch, 0.30, arc);
        p.rLegPitch = lerp(p.rLegPitch, -0.25, arc);
        p.lArmPitch = lerp(p.lArmPitch, 1.45, arc);
        break;
      case 'sweep':
        // Bridging and rolling from the bottom.
        p.bodyRoll += 0.75 * arc;
        p.hipY += 0.13 * arc;
        p.torsoPitch += 0.25 * arc;
        p.lLegPitch += 0.5 * arc;
        p.rLegPitch += 0.35 * arc;
        break;
      case 'standUp': {
        // Technical stand-up: rise smoothly toward the standing pose.
        const t = smoothstep(phase);
        p.hipY = lerp(p.hipY, DIM.hipHeight - 0.05, t);
        p.bodyPitch = lerp(p.bodyPitch, 0.1, t);
        p.bodyRoll = lerp(p.bodyRoll, 0, t);
        p.offZ = lerp(p.offZ, -0.25, t);
        p.lLegPitch = lerp(p.lLegPitch, 0.35, t);
        p.rLegPitch = lerp(p.rLegPitch, -0.30, t);
        p.lKnee = lerp(p.lKnee, 0.55, t);
        p.rKnee = lerp(p.rKnee, 0.45, t);
        p.lArmPitch = lerp(p.lArmPitch, 1.40, t * 0.7);
        p.rArmPitch = lerp(p.rArmPitch, 0.60, t);
        p.rElbow = lerp(p.rElbow, 2.0, t);
        break;
      }
      case 'submission': {
        // Both arms clamp and squeeze; intensity tracks the engine's own
        // subProgress so the picture matches the HUD number.
        const squeeze = 0.12 * Math.sin(phase * Math.PI * 3) + 0.25 * f.subProgress;
        p.lArmPitch = 1.35 + squeeze * 0.3;
        p.rArmPitch = 1.32 + squeeze * 0.3;
        p.lElbow = 2.45 + squeeze;
        p.rElbow = 2.48 + squeeze;
        p.lArmRoll = -0.10; p.rArmRoll = -0.08;
        p.torsoPitch += 0.18 * arc;
        break;
      }
      case 'recover':
        p.torsoPitch += 0.06 * Math.sin(time * 1.9);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------- per frame

  /**
   * Apply one rendered frame.
   *
   * @param cur    fighter state at `frame`
   * @param next   fighter state at the following tick, or null at the end
   * @param alpha  0..1 interpolation between the two ticks
   * @param time   interpolated simulated seconds
   * @param dt     wall-clock seconds since the previous call (smoothing only)
   */
  update(cur: SnapshotFighter, next: SnapshotFighter | null, alpha: number, time: number, dt: number): void {
    const a = clamp(alpha, 0, 1);

    // ---- interpolate the raw state --------------------------------------
    let x = cur.x, z = cur.z, facing = cur.facing;
    let phase = cur.actionPhase;
    let stamina = cur.stamina, balance = cur.balance, subProgress = cur.subProgress;

    if (next) {
      x = lerp(cur.x, next.x, a);
      z = lerp(cur.z, next.z, a);
      facing = lerpAngle(cur.facing, next.facing, a);
      stamina = lerp(cur.stamina, next.stamina, a);
      balance = lerp(cur.balance, next.balance, a);
      subProgress = lerp(cur.subProgress, next.subProgress, a);
      // Only interpolate the phase inside a single continuous action; when the
      // engine starts a new action the phase resets and must not be smeared.
      if (next.action === cur.action && next.actionPhase >= cur.actionPhase) {
        phase = lerp(cur.actionPhase, next.actionPhase, a);
      }
    }

    const state: SnapshotFighter = { ...cur, x, z, facing, stamina, balance, subProgress, actionPhase: phase };

    // ---- world placement -------------------------------------------------
    if (!this.initialised) {
      this.displayPos.set(x, 0, z);
      this.displayFacing = facing;
      this.initialised = true;
    }

    if (cur.out) {
      // A stopped fighter is walked to the cage edge and seated facing the
      // centre. Shown plainly; no drama, no collapse animation.
      const here = new THREE.Vector2(this.displayPos.x, this.displayPos.z);
      if (here.lengthSq() < 1e-4) here.set(Math.sin(this.id * 1.7), Math.cos(this.id * 1.7));
      here.normalize().multiplyScalar(CAGE_RADIUS - 0.55);
      this.displayPos.x = damp(this.displayPos.x, here.x, 2.2, dt);
      this.displayPos.z = damp(this.displayPos.z, here.y, 2.2, dt);
      this.displayFacing = dampAngle(this.displayFacing, Math.atan2(-here.x, -here.y), 2.2, dt);
    } else {
      this.displayPos.set(x, 0, z);
      this.displayFacing = facing;
    }

    this.group.position.set(this.displayPos.x, 0, this.displayPos.z);
    // The engine's `facing` is atan2(dx, dz), i.e. forward = (sin, cos), which
    // is exactly three.js's +Z axis rotated by rotation.y.
    this.group.rotation.y = this.displayFacing;

    // ---- pose -------------------------------------------------------------
    const target = this.targetPose(state, phase, time);
    // Fast exponential filter: kills inter-action pops without inventing motion.
    // Lying down / standing up is a larger, slower change, so it gets a lower
    // rate to read as a deliberate movement rather than a snap.
    const lambda = 26;
    for (const k of POSE_KEYS) {
      if (k === 'bodyYaw') {
        this.pose[k] = dampAngle(this.pose[k], target[k], 9, dt);
      } else if (k === 'bodyPitch' || k === 'bodyRoll' || k === 'hipY' || k === 'offZ' || k === 'offX') {
        this.pose[k] = damp(this.pose[k], target[k], 11, dt);
      } else {
        this.pose[k] = damp(this.pose[k], target[k], lambda, dt);
      }
    }
    this.applyPose();

    // ---- label + fade ------------------------------------------------------
    this.updateLabel(state);

    const wantOpacity = cur.out ? 0.4 : 1;
    if (Math.abs(this.opacity - wantOpacity) > 0.002) {
      this.opacity = damp(this.opacity, wantOpacity, 3.0, dt);
      const o = this.opacity;
      for (const m of this.materials) {
        m.opacity = o;
        m.transparent = o < 0.999;
        m.depthWrite = o > 0.9;
      }
      (this.disc.material as THREE.MeshBasicMaterial).opacity = 0.85 * o;
      (this.labelSprite.material as THREE.SpriteMaterial).opacity = clamp(o + 0.25, 0, 1);
    }
  }

  /** Push the smoothed pose into the scene graph. */
  private applyPose(): void {
    const p = this.pose;
    const s = this.scale;

    this.body.position.set(p.offX * s, p.hipY * s, p.offZ * s);
    this.body.rotation.set(p.bodyPitch, p.bodyYaw, p.bodyRoll);

    this.torso.rotation.set(p.torsoPitch, p.torsoYaw, p.torsoRoll);
    this.head.rotation.set(p.headPitch, p.headYaw, 0);

    // side = +1 for the right-hand limbs, -1 for the left; yaw is "outward"
    // and roll is "toward the midline" for arms / "outward" for legs.
    this.armL.rotation.set(-p.lArmPitch, -p.lArmYaw, p.lArmRoll);
    this.armR.rotation.set(-p.rArmPitch, p.rArmYaw, -p.rArmRoll);
    this.foreL.rotation.x = -p.lElbow;
    this.foreR.rotation.x = -p.rElbow;

    this.legL.rotation.set(-p.lLegPitch, -p.lLegYaw, -p.lLegRoll);
    this.legR.rotation.set(-p.rLegPitch, p.rLegYaw, p.rLegRoll);
    this.shinL.rotation.x = p.lKnee;
    this.shinR.rotation.x = p.rKnee;

    this.labelSprite.position.y = p.labelY * s;
  }

  private updateLabel(f: SnapshotFighter): void {
    const frac = clamp(f.stamina / Math.max(1, this.opts.staminaMax), 0, 1);
    const status = f.out ? 'OUT' : f.down ? 'DOWN' : '';
    // Only repaint the canvas when the drawn result would actually differ.
    const key = `${Math.round(frac * 48)}|${status}`;
    if (key !== this.labelState) {
      this.labelState = key;
      this.drawLabel(frac, status);
    }
  }

  // -------------------------------------------------------------- accessors

  /** Show / hide the follow-camera highlight ring under this fighter. */
  setHighlighted(on: boolean): void {
    this.highlight.visible = on;
  }

  /** Slow pulse on the highlight ring; called from the render loop. */
  pulseHighlight(time: number): void {
    if (!this.highlight.visible) return;
    const m = this.highlight.material as THREE.MeshBasicMaterial;
    m.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4));
  }

  /** World-space position of the head, for impact markers and cameras. */
  getHeadWorld(out: THREE.Vector3): THREE.Vector3 {
    this.head.getWorldPosition(out);
    return out;
  }

  /** World-space position of the chest, a good generic "look at me" point. */
  getChestWorld(out: THREE.Vector3): THREE.Vector3 {
    this.torso.getWorldPosition(out);
    out.y += DIM.torsoLen * 0.45 * this.scale;
    return out;
  }

  /** Current display position on the mat (y = 0). */
  getGroundPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.displayPos.x, 0, this.displayPos.z);
  }

  get visible(): boolean { return this.group.visible; }
  set visible(v: boolean) { this.group.visible = v; }

  dispose(): void {
    disposeObject3D(this.group);
    this.materials.length = 0;
  }
}
