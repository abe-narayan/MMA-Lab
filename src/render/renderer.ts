/**
 * ARENA RENDERER - the object the replay UI talks to.
 *
 * Lifecycle:
 *   const r = new ArenaRenderer(container);
 *   r.setFighters(replay.fighterLabels, teams);   // once per loaded replay
 *   // every animation frame:
 *   r.update(player.current, nextFrame, alpha);
 *   r.render();
 *   // on unmount:
 *   r.dispose();
 *
 * Everything on screen is a function of the recorded frames. The only
 * wall-clock inputs are the exponential smoothing of poses and cameras and the
 * decay of impact markers, none of which can change what is depicted - only how
 * smoothly it arrives.
 */

import * as THREE from 'three';
import type { TickSnapshot, ActionKind } from '../engine/types';
import { ACTIONS, STRIKES } from '../engine/actions';
import { ATHLETE_A, ATHLETE_B, deriveAttributes, type DerivedAttributes } from '../engine/fighter';
import { DEFAULT_PARAMS } from '../engine/params';
import { Arena, PALETTE, clamp, lerp, type ImpactKind } from './arena';
import { FighterRig, type SnapshotFighter } from './fighterRig';
import { CameraRig, type CameraMode } from './cameras';

export type { CameraMode };

export interface RendererOptions {
  /** Adds a polar grid and axes to the scene. */
  showDebug?: boolean;
}

/** Which height an impact marker sits at, per strike. */
const STRIKE_TARGET: Record<string, 'head' | 'body' | 'leg'> = {
  jab: 'head', cross: 'head', hook: 'head', uppercut: 'head', headKick: 'head',
  bodyKick: 'body', teep: 'body', clinchKnee: 'body', groundStrike: 'head',
  lowKick: 'leg',
};

const STRIKE_SET = new Set<ActionKind>(STRIKES);

/** The hardest single strike in the catalogue; used to normalise emphasis. */
const MAX_BASE_DAMAGE = Math.max(...STRIKES.map((k) => ACTIONS[k]?.baseDamage ?? 1));

let attrCache: { a: DerivedAttributes; b: DerivedAttributes } | null = null;
function athleteAttributes(): { a: DerivedAttributes; b: DerivedAttributes } {
  if (!attrCache) {
    attrCache = {
      a: deriveAttributes(ATHLETE_A, DEFAULT_PARAMS),
      b: deriveAttributes(ATHLETE_B, DEFAULT_PARAMS),
    };
  }
  return attrCache;
}

export class ArenaRenderer {
  /** The canvas this renderer draws into; appended to the container. */
  readonly domElement: HTMLCanvasElement;

  private container: HTMLElement;
  private opts: RendererOptions;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private arena: Arena;
  private cameras: CameraRig;

  private rigs: FighterRig[] = [];
  private rigById = new Map<number, FighterRig>();
  private followId = 0;

  /** Last tick on which each fighter's action resolved, to avoid re-firing. */
  private lastResolveTick = new Map<number, number>();
  private wasDown = new Map<number, boolean>();

  private resizeObserver: ResizeObserver | null = null;
  private onWindowResize = (): void => this.resize();

  private lastUpdateTime = 0;
  private lastRenderTime = 0;
  private disposed = false;

  // scratch vectors, reused to keep the render loop allocation-free
  private vA = new THREE.Vector3();
  private vB = new THREE.Vector3();
  private vC = new THREE.Vector3();
  private centroid = new THREE.Vector3();

  constructor(container: HTMLElement, opts: RendererOptions = {}) {
    this.container = container;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.domElement = this.renderer.domElement;
    this.domElement.style.display = 'block';
    this.domElement.style.width = '100%';
    this.domElement.style.height = '100%';
    container.appendChild(this.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = PALETTE.background.clone();
    // A long fog keeps the far side of the cage from competing with the action
    // without ever hiding a fighter.
    this.scene.fog = new THREE.Fog(PALETTE.fog.clone(), 16, 42);

    this.arena = new Arena({ showDebug: opts.showDebug });
    this.scene.add(this.arena.group);

    this.cameras = new CameraRig(this.domElement);

    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onWindowResize);
    }

    const now = this.clock();
    this.lastUpdateTime = now;
    this.lastRenderTime = now;
  }

  // ------------------------------------------------------------------ setup

  /**
   * Build one rig per fighter. Called once per replay load; safe to call again
   * with a different roster - the previous rigs are fully released first.
   */
  setFighters(labels: string[], teams: ('A' | 'B')[]): void {
    this.clearRigs();
    const attr = athleteAttributes();

    let bCount = 0;
    for (let i = 0; i < labels.length; i++) {
      const team: 'A' | 'B' = teams[i] === 'B' ? 'B' : 'A';
      // Body metrics come from the same derivation the engine used, so the
      // heavier athlete is visibly the heavier athlete.
      const derived = team === 'A' ? attr.a : attr.b;
      // Corner index: A is always 0; the B side cycles its shades so that a
      // 1v5 bout has five distinguishable opponents.
      const cornerIndex = team === 'A' ? 0 : bCount++;

      const rig = new FighterRig(i, {
        label: labels[i] ?? (team === 'A' ? 'A' : `B${cornerIndex + 1}`),
        team,
        index: cornerIndex,
        massKg: derived.massKg,
        heightM: derived.heightM,
        staminaMax: derived.staminaMax,
      });

      this.rigs.push(rig);
      this.rigById.set(i, rig);
      this.scene.add(rig.group);
    }

    this.arena.clearImpacts();
    this.lastResolveTick.clear();
    this.wasDown.clear();
    if (!this.rigById.has(this.followId)) this.followId = this.rigs.length ? this.rigs[0].id : 0;
    this.applyHighlight();
  }

  private clearRigs(): void {
    for (const rig of this.rigs) rig.dispose();
    this.rigs.length = 0;
    this.rigById.clear();
  }

  // ------------------------------------------------------------------ frame

  /**
   * Apply one replay frame.
   *
   * @param frame the current tick
   * @param next  the following tick, or null at the end of the replay
   * @param alpha 0..1 interpolation between the two
   */
  update(frame: TickSnapshot, next: TickSnapshot | null, alpha: number): void {
    if (this.disposed || !frame) return;
    const a = clamp(alpha, 0, 1);
    const dt = this.advance('update');

    // Simulated clock, interpolated: all periodic motion is keyed to this so
    // that pausing the replay also stills the fighters.
    const simTime = next ? lerp(frame.t, next.t, a) : frame.t;

    // Index the next tick by fighter id - ids are stable across a bout, but a
    // defensive lookup keeps a malformed frame from throwing.
    const nextById = new Map<number, SnapshotFighter>();
    if (next) for (const nf of next.fighters) nextById.set(nf.id, nf);

    let active = 0;
    this.centroid.set(0, 0, 0);

    for (const f of frame.fighters) {
      const rig = this.rigById.get(f.id);
      if (!rig) continue;
      rig.visible = true;
      rig.update(f, nextById.get(f.id) ?? null, a, simTime, dt);

      if (!f.out) {
        this.centroid.x += f.x;
        this.centroid.z += f.z;
        active++;
      }

      this.handleResolve(frame, f);
      this.handleKnockdown(f);
    }

    // Hide any rig the current frame has no state for (should not happen, but
    // a 6-fighter bout must never throw).
    if (frame.fighters.length !== this.rigs.length) {
      const present = new Set(frame.fighters.map((f) => f.id));
      for (const rig of this.rigs) if (!present.has(rig.id)) rig.visible = false;
    }

    if (active > 0) {
      this.centroid.multiplyScalar(1 / active);
    } else {
      this.centroid.set(0, 0, 0);
    }

    // Spread = how far the furthest active fighter is from the centroid; the
    // cameras use it to pull back when the group fans out in a 1v5.
    let spread = 1.2;
    for (const f of frame.fighters) {
      if (f.out) continue;
      spread = Math.max(spread, Math.hypot(f.x - this.centroid.x, f.z - this.centroid.z));
    }
    this.cameras.setFocus(this.centroid, spread);
    this.updateFollowCamera(frame);
  }

  /** Impact markers + camera shake, fired exactly on the engine's resolve tick. */
  private handleResolve(frame: TickSnapshot, f: SnapshotFighter): void {
    if (f.actionResult === 'none') return;
    if (this.lastResolveTick.get(f.id) === frame.tick) return;
    this.lastResolveTick.set(f.id, frame.tick);

    if (!STRIKE_SET.has(f.action)) return;
    if (f.actionResult === 'missed') return;    // a whiff gets no marker at all

    const spec = ACTIONS[f.action];
    const base = spec?.baseDamage ?? 1;
    const emphasis = clamp(0.35 + (base / MAX_BASE_DAMAGE) * 0.85, 0.3, 1.25);

    const defender = this.nearestOpponent(frame, f);
    const where = this.impactPoint(f, defender, f.action, this.vA);
    const kind: ImpactKind = f.actionResult === 'landed' ? 'landed'
      : f.actionResult === 'blocked' ? 'blocked' : 'evaded';

    this.arena.spawnImpact(where, kind, emphasis);

    if (kind === 'landed') {
      // Deliberately restrained: a short shake, nothing else. No hit-stop, no
      // slow motion, no damage decal.
      this.cameras.shake(emphasis * (f.action === 'groundStrike' ? 0.4 : 0.8));
    }
  }

  /** A knockdown gets the smallest possible emphasis and nothing more. */
  private handleKnockdown(f: SnapshotFighter): void {
    const was = this.wasDown.get(f.id) ?? false;
    if (f.down && !was) this.cameras.shake(0.35);
    this.wasDown.set(f.id, f.down);
  }

  /** Nearest fighter from the other team who is still in the bout. */
  private nearestOpponent(frame: TickSnapshot, f: SnapshotFighter): SnapshotFighter | null {
    const rig = this.rigById.get(f.id);
    const team = rig?.team;
    let best: SnapshotFighter | null = null;
    let bestD = Infinity;
    for (const o of frame.fighters) {
      if (o.id === f.id || o.out) continue;
      const oRig = this.rigById.get(o.id);
      if (team && oRig && oRig.team === team) continue;
      const d = (o.x - f.x) ** 2 + (o.z - f.z) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /**
   * Where to draw the abstract impact ring: between the two fighters, at a
   * height that matches the target of the strike (head / body / leg).
   */
  private impactPoint(
    attacker: SnapshotFighter,
    defender: SnapshotFighter | null,
    kind: ActionKind,
    out: THREE.Vector3
  ): THREE.Vector3 {
    const target = STRIKE_TARGET[kind] ?? 'body';
    const defRig = defender ? this.rigById.get(defender.id) : undefined;

    // Base height: take the defender's actual head if we have a rig for them,
    // otherwise fall back to nominal heights.
    let y = 1.25;
    if (target === 'head') {
      y = defRig ? defRig.getHeadWorld(this.vB).y : 1.55;
    } else if (target === 'body') {
      y = defRig ? defRig.getChestWorld(this.vB).y : 1.15;
    } else {
      y = 0.5;
    }
    if (defender && (defender.posture === 'ground' || defender.down)) {
      y = Math.min(y, target === 'leg' ? 0.35 : 0.75);
    }

    if (!defender) {
      // No opponent resolved: put the marker just in front of the attacker.
      const reach = (ACTIONS[kind]?.range ?? 1) * 0.65;
      return out.set(
        attacker.x + Math.sin(attacker.facing) * reach,
        y,
        attacker.z + Math.cos(attacker.facing) * reach
      );
    }

    // 62% of the way toward the defender reads as "on them" without clipping
    // into the head geometry.
    return out.set(
      lerp(attacker.x, defender.x, 0.62),
      y,
      lerp(attacker.z, defender.z, 0.62)
    );
  }

  /** Point the follow camera at the tracked fighter and their engagement. */
  private updateFollowCamera(frame: TickSnapshot): void {
    const rig = this.rigById.get(this.followId);
    if (!rig) {
      this.cameras.setFollow(null, null);
      return;
    }
    const self = frame.fighters.find((f) => f.id === this.followId);
    rig.getGroundPosition(this.vA);

    // Look at the engagement: the tracked fighter's nearest live opponent, or
    // the centre of the cage when there is nobody left to face.
    const opponent = self ? this.nearestOpponent(frame, self) : null;
    this.vC.set(opponent ? opponent.x : 0, 0, opponent ? opponent.z : 0);
    this.cameras.setFollow(this.vA, this.vC);
  }

  // ------------------------------------------------------------------ controls

  setCameraMode(mode: CameraMode): void {
    this.cameras.setMode(mode);
  }

  /** Which fighter id the 'follow' camera tracks; also moves the floor ring. */
  setFollowTarget(id: number): void {
    this.followId = id;
    this.applyHighlight();
  }

  resetCamera(): void {
    this.cameras.reset();
  }

  private applyHighlight(): void {
    for (const rig of this.rigs) rig.setHighlighted(rig.id === this.followId);
  }

  // ------------------------------------------------------------------ loop

  /** Draw one frame. Safe to call without a preceding update(). */
  render(): void {
    if (this.disposed) return;
    const dt = this.advance('render');
    const t = this.lastRenderTime;

    this.cameras.update(dt);
    this.arena.update(dt);
    for (const rig of this.rigs) rig.pulseHighlight(t);

    this.renderer.render(this.scene, this.cameras.camera);
  }

  /** Re-read the container size. Called automatically on resize as well. */
  resize(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth || this.container.offsetWidth || 0;
    const h = this.container.clientHeight || this.container.offsetHeight || 0;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.cameras.resize(w, h);
  }

  // ------------------------------------------------------------------ teardown

  /** Release every GPU resource, listener and DOM node this renderer owns. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.cameras.dispose();
    this.clearRigs();
    this.arena.dispose();

    this.scene.clear();
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.background = null;
    this.scene.fog = null;

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.domElement.parentNode === this.container) {
      this.container.removeChild(this.domElement);
    }
  }

  // ------------------------------------------------------------------ helpers

  private clock(): number {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  /**
   * Wall-clock delta for one of the two independent loops. Clamped so that a
   * backgrounded tab does not produce a single enormous smoothing step.
   */
  private advance(which: 'update' | 'render'): number {
    const now = this.clock();
    const last = which === 'update' ? this.lastUpdateTime : this.lastRenderTime;
    const dt = clamp(now - last, 0, 0.1);
    if (which === 'update') this.lastUpdateTime = now;
    else this.lastRenderTime = now;
    return dt;
  }
}
