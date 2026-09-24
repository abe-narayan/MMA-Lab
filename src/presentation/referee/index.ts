/**
 * THE REFEREE'S BODY — presentation only (the sim has no referee body).
 *
 * `arena/referee.ts` decides where the referee stands and what he is doing
 * (`VenueSet.referee` after each `ArenaSet.update`); this module gives him a
 * body and a pose:
 *
 *   - body: a real skinned human from the character module's public factory
 *     (`CharacterFactory.create`, read-only use) built from a referee
 *     definition (`refereeDefinition`: 1.80 m, neutral build, forties, short
 *     hair, bare hands), dressed by `clothing.ts` in a black shirt, black
 *     trousers and black shoes cut from his own body mesh. Without the
 *     character module (placeholders) he is the capsule `DebugSkeletonActor`
 *     in the `official` outfit, as before.
 *   - pose: `RefereeAnimator` (stance/crouch, a gait driven by the distance he
 *     travels, arm IK for his gestures), on the body's own rest skeleton.
 *
 * Placement comes from the arena set when it provides one (so his contact
 * shadow on the canvas, which the set draws from the same placement, sits
 * under his feet); a set without a `referee` field (the placeholder arena)
 * gets the same `RefereeTracker` run here. `null` from the set means "no
 * referee" (street fights) and hides him.
 */
import type {
  ArenaSet, BoutPresentation, CharacterActor, CharacterFactory, FrameInput, QualitySettings,
} from '../contract';
import type { FighterDefinition, SimEvent } from '../../sim';
import { RefereeTracker, type RefereePlacement } from '../arena/referee';
import { DebugSkeletonActor } from '../placeholders/debugSkeleton';
import { B, defaultRest, type Pose, type RestSkeleton, type WorldPose } from '../rig/skeleton';
import { RefereeAnimator } from './pose';
import { dressReferee, type RefereeClothes } from './clothing';

export { RefereeAnimator, STRIDE_M } from './pose';
export type { RefereeFrame } from './pose';
export { classifyVertices, dressReferee } from './clothing';

/** A neutral official: 1.80 m, black shirt and trousers. */
export const REFEREE_STATURE_M = 1.8;
export const REFEREE_CLOTHING = '#0d0e10';

export function refereeRest(statureM = REFEREE_STATURE_M): RestSkeleton {
  const base = defaultRest();
  const k = statureM / base.statureM;
  for (let j = 0; j < base.head.length; j++) { base.head[j] *= k; base.tail[j] *= k; }
  for (let j = 0; j < base.length.length; j++) base.length[j] *= k;
  base.statureM *= k;
  return base;
}

/** FNV-1a, for the referee's cosmetic choices (never the sim RNG). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * The referee as a fighter definition the character module can build: a
 * neutral 1.80 m, 86 kg man in his forties, short hair, no tattoos, bare
 * hands, black "vale tudo" shorts (hidden under the trousers). Skin tone,
 * face and hair are picked from the bout's cosmetic seed, so a bout always
 * has the same official. The template supplies the fields the body builder
 * does not read (attributes, disciplines, record).
 */
export function refereeDefinition(bout: BoutPresentation): FighterDefinition | null {
  const tpl = bout.fighters[0];
  if (!tpl) return null;
  const h = hash(`${bout.cosmeticSeed}:referee`);
  const tones = [0.18, 0.3, 0.42, 0.55, 0.68, 0.8];
  const hairColours = ['black', 'darkBrown', 'brown', 'grey', 'darkBrown', 'black'];
  const styles = ['crew', 'buzz', 'receding', 'crew'];
  const heightM = REFEREE_STATURE_M;
  const legRatio = tpl.body.legReachM / Math.max(1, tpl.body.heightM);
  return {
    ...tpl,
    id: 'referee',
    name: 'Referee',
    short: 'REF',
    body: {
      ...tpl.body,
      heightM,
      reachM: heightM * 1.02,
      legReachM: heightM * (Number.isFinite(legRatio) && legRatio > 0.4 ? legRatio : 0.52),
      massKg: 86,
      weighInKg: 86,
      fightNightKg: 86,
      naturalWeightKg: 86,
      ageYears: 46,
      bodyFatPct: 21,
      build: { ecto: 0.3, meso: 0.4, endo: 0.3 },
      stance: 'orthodox',
      handedness: 'right',
      sex: 'male',
    },
    appearance: {
      ...tpl.appearance,
      skinTone: tones[h % tones.length]!,
      hair: 'crew',
      hairStyle: {
        styleId: styles[(h >>> 4) % styles.length]!,
        colorId: hairColours[(h >>> 8) % hairColours.length]!,
        length: 'short',
      },
      facialHair: (h >>> 12) % 3 === 0 ? 'stubble' : 'none',
      facePreset: (h >>> 16) % 10,
      faceMorphs: undefined,
      tattoos: [],
      tattooPlacements: [],
      shortsKit: { style: 'vale_tudo', primary: '#101012', secondary: '#101012', trim: '#101012' },
      gloveKit: undefined,
      handWrapColor: undefined,
      mouthguardColor: '#d8d8d4',
      shinGuards: false,
    },
  } as FighterDefinition;
}

/** The official's body: a skinned, dressed character, or the capsule stand-in. */
export interface RefereeBody {
  readonly object3d: CharacterActor['object3d'];
  readonly rest: RestSkeleton;
  readonly kind: 'character' | 'capsule';
  applyPose(pose: Pose): void;
  setVisible(v: boolean): void;
  setLOD(level: 0 | 1 | 2 | 3): void;
  dispose(): void;
}

function capsuleBody(): RefereeBody {
  const rest = refereeRest();
  const body = new DebugSkeletonActor(-1, { rest, corner: REFEREE_CLOTHING, glove: 'bare', outfit: 'official' });
  return {
    object3d: body.object3d, rest, kind: 'capsule',
    applyPose: (p) => body.applyPose(p),
    setVisible: (v) => body.setVisible(v),
    setLOD: () => undefined,
    dispose: () => body.dispose(),
  };
}

function characterBody(factory: CharacterFactory, bout: BoutPresentation, quality: QualitySettings): RefereeBody | null {
  const def = refereeDefinition(bout);
  if (!def) return null;
  let actor: CharacterActor;
  try {
    const refBout: BoutPresentation = {
      ...bout, fighters: [def], runtimes: [], teamOf: [0], cornerColours: ['#101012'], glove: 'bare',
    };
    actor = factory.create(refBout, 0, quality);
  } catch (err) {
    console.warn('[referee] character build failed, using the capsule official:', err);
    return null;
  }
  let clothes: RefereeClothes | null = null;
  try {
    clothes = dressReferee(actor.object3d);
  } catch (err) {
    console.warn('[referee] dressing failed, using the capsule official:', err);
  }
  if (!clothes) {
    actor.dispose();
    return null;
  }
  // A dry, calm official: no sweat, no flush, no damage.
  actor.setVisualState({
    sweat: 0.05, flush: 0, damageZones: [], swelling: [], cuts: [], bloodOnGloves: 0, blood: false, fatigue: 0,
  });
  const dressed = clothes;
  return {
    object3d: actor.object3d, rest: actor.rest, kind: 'character',
    applyPose: (p) => actor.applyPose(p),
    setVisible: (v) => { actor.object3d.visible = v; },
    setLOD: (l) => actor.setLOD(l),
    dispose: () => { dressed.dispose(); actor.dispose(); },
  };
}

/**
 * The set's referee placement: a placement, `null` for "this venue has no
 * referee", or `undefined` when the set does not compute one at all.
 */
export function arenaReferee(arena: ArenaSet): RefereePlacement | null | undefined {
  if (!('referee' in arena)) return undefined;
  return (arena as unknown as { referee: RefereePlacement | null }).referee;
}

export interface RefereeActorOptions {
  /** The character factory (after `preload`): a real, dressed body. Absent or null: the capsule official. */
  factory?: CharacterFactory | null;
  quality?: QualitySettings;
}

export class RefereeActor {
  readonly body: RefereeBody;
  readonly animator: RefereeAnimator;
  /** The placement used on the last update (null when he is not shown). */
  placement: RefereePlacement | null = null;
  private readonly tracker: RefereeTracker;

  constructor(bout: BoutPresentation, hardCameraAngle = 0, opts: RefereeActorOptions = {}) {
    const real = opts.factory && opts.quality ? characterBody(opts.factory, bout, opts.quality) : null;
    this.body = real ?? capsuleBody();
    this.body.object3d.name = 'referee';
    this.animator = new RefereeAnimator(this.body.rest);
    this.tracker = new RefereeTracker(bout.arena, undefined, hardCameraAngle);
  }

  get object3d(): CharacterActor['object3d'] {
    return this.body.object3d;
  }

  /** The referee's world pose after the last update, or null when he is not shown (camera occlusion). */
  get world(): WorldPose | null {
    return this.placement ? this.animator.world : null;
  }

  update(input: FrameInput, arena: ArenaSet, fighters: readonly WorldPose[], realDt: number): RefereePlacement | null {
    const rate = Math.max(0, input.playbackRate);
    const simDt = input.discontinuity ? 0 : Math.max(0, realDt) * rate;
    let place = arenaReferee(arena);
    if (place === undefined) {
      // TickSnapshot satisfies the tracker's RefereeScene (it reads, never writes).
      const t = this.tracker.update(input.frame, input.simTime, simDt, input.discontinuity,
        { events: input.events as readonly SimEvent[] });
      place = t.present ? t : null;
    }
    this.placement = place && place.present ? place : null;
    this.body.setVisible(this.placement !== null);
    if (!this.placement) return null;
    const pose = this.animator.evaluate({
      placement: this.placement, fighters, realDt, simDt, snap: input.discontinuity,
    });
    this.body.applyPose(pose);
    return this.placement;
  }

  /** Level of detail (the presenter applies its distance rule, as for fighters). */
  setLOD(level: 0 | 1 | 2 | 3): void {
    this.body.setLOD(level);
  }

  /** Chest position of the last pose, for the LOD distance. */
  chest(): [number, number, number] | null {
    const w = this.world;
    return w ? [w.pos[B.spine2 * 3], w.pos[B.spine2 * 3 + 1], w.pos[B.spine2 * 3 + 2]] : null;
  }

  reset(): void {
    this.animator.reset();
  }

  dispose(): void {
    this.body.dispose();
  }
}

export function createRefereeActor(bout: BoutPresentation, hardCameraAngle = 0, opts: RefereeActorOptions = {}): RefereeActor {
  return new RefereeActor(bout, hardCameraAngle, opts);
}
