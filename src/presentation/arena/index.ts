/**
 * Arena module entry point (docs/design/08 §4.3, §6). Owned by the arena/lighting work.
 *
 * `createArenaSet(arena, quality, options?)` builds the venue for any `ArenaId`:
 *   octagon_30 / octagon_25  raised cage under a broadcast truss in a dark bowl
 *   ring_16 / ring_20 / ring_24  roped ring under the same rig, warmer key
 *   mat_ibjjf / tatami_ijf   competition mats in a brightly lit sports hall
 *   street_open / street_grass  night lot under sodium lamps
 *
 * The set owns geometry, materials, the light rig, the image-based environment
 * (`environment`, for `scene.environment`), haze, crowd and cageside dressing,
 * and in `update` it drives the crowd from the recorded events, animates
 * screens, feeds the fighters' bones to the floor contact-occlusion term, and
 * computes the referee's spot (`referee`), which the presenter hands to the
 * referee character. It never reads or writes sim state beyond the frame.
 *
 * Pass `options.cosmeticSeed` (BoutPresentation.cosmeticSeed) and
 * `options.cornerColours` when a bout is known; defaults are the arena id and
 * red/blue.
 */
import * as THREE from 'three/webgpu';
import type { Arena, SimEvent } from '../../sim';
import type { ArenaSet, FrameInput, QualitySettings } from '../contract';
import type { WorldPose } from '../rig/skeleton';
import { B } from '../rig/skeleton';
import {
  OCTAGON_APRON_M, OCTAGON_PLATFORM_M, RING_APRON_M, RING_PLATFORM_M, circumradius, setKindOf, venueBounds,
  wallInradius, wallSegments, type SetKind,
} from './geometry';
import { hashString } from './rng';
import { ContactOccluders, OCCLUDER_COUNT, chainLinkMaterial, floorMaterial, ledMaterial, propMaterial, vinylMaterial } from './materials';
import { broadcastRig, hallRig, streetRig, type Rig } from './lighting';
import { buildEnvironment } from './environment';
import { floorExtent, ledBoardTexture, octagonCanvasTexture, ringCanvasTexture, matTexture } from './textures';
import { buildOctagonParts } from './octagon';
import { buildRingParts } from './ring';
import {
  HazeUniforms, ScreenUniforms, buildArenaFloor, buildCentreHung, buildHazeColumn, buildShafts, buildTruss, screenMaterial,
} from './venue';
import {
  CrowdUniforms, bowlRows, buildCardStrips, buildFigures, buildTiers, rowsCovered, type BowlSpec, type Row,
} from './crowd';
import { buildCagesideDressing } from './dressing';
import { EventMemory, crowdState, FLASH_BUCKETS_PER_S, type CrowdState } from './crowdReactions';
import { RefereeTracker, type RefereePlacement, type RefereeScene } from './referee';
import { buildHall } from './hall';
import { buildStreet } from './street';
import { loadArenaTextures, type ArenaTextures } from './assets';
import { attribute, pmremTexture } from 'three/tsl';

export { refereePlacement, RefereeTracker } from './referee';
export type { RefereePlacement, RefereeGesture } from './referee';
export { crowdState } from './crowdReactions';
export type { CrowdState } from './crowdReactions';

export interface ArenaOptions {
  /** BoutPresentation.cosmeticSeed. */
  cosmeticSeed?: string;
  /** BoutPresentation.cornerColours: [red, blue]. */
  cornerColours?: readonly string[];
}

/** The concrete set: the contract plus what the presenter and dev tools read. */
export interface VenueSet extends ArenaSet {
  readonly kind: SetKind;
  /** The referee's placement after the last `update` (null when there is no referee). */
  readonly referee: RefereePlacement | null;
  readonly crowd: CrowdState;
  /** Static triangle count and draw calls of the set (excluding shadow passes). */
  stats(): { triangles: number; drawCalls: number; crowdFigures: number };
}

interface Built {
  root: THREE.Group;
  rig: Rig;
  env: THREE.DataTexture;
  rows: Row[];
  bowl: BowlSpec | null;
  shafts: THREE.Mesh | null;
  triangles: number;
  drawCalls: number;
}

const DEFAULT_RED = '#c0161d';
const DEFAULT_BLUE = '#1d56b0';

export async function createArenaSet(
  arena: Arena, quality: QualitySettings, options: ArenaOptions = {},
): Promise<ArenaSet | null> {
  return createVenueAsync(arena, quality, options);
}

/** The concrete set, with the optional photographic textures loaded first. */
export async function createVenueAsync(arena: Arena, quality: QualitySettings, options: ArenaOptions = {}): Promise<VenueSet> {
  const textures = await loadArenaTextures(setKindOf(arena), quality);
  return new Venue(arena, quality, options, textures);
}

/** Synchronous, fully procedural variant (no texture downloads). */
export function createVenue(arena: Arena, quality: QualitySettings, options: ArenaOptions = {}): VenueSet {
  return new Venue(arena, quality, options, {});
}

class Venue implements VenueSet {
  readonly object3d: THREE.Group;
  readonly bounds: { fightRadiusM: number; outerRadiusM: number; ceilingM: number };
  readonly environment: THREE.Texture | null;
  readonly kind: SetKind;
  referee: RefereePlacement | null = null;
  crowd: CrowdState = { excitement: 0.15, stand: 0, flashRate: 1, phones: 0.03 };

  private readonly seed: string;
  private readonly seedNum: number;
  private readonly occluders = new ContactOccluders();
  private readonly cu = new CrowdUniforms();
  private readonly haze = new HazeUniforms();
  private readonly screens = new ScreenUniforms();
  private readonly memory = new EventMemory();
  private readonly tracker: RefereeTracker;
  private readonly built: Built;
  private crowdGroup = new THREE.Group();
  private readonly extraTextures: THREE.Texture[] = [];
  private crowdKey = '';
  private crowdTris = 0;
  private crowdFigures = 0;
  private crowdDraws = 0;
  private quality: QualitySettings;
  private readonly red: string;
  private readonly blue: string;
  private readonly sceneScratch: { phase: RefereeScene['phase']; fighters: { id: number; x: number; z: number; posture: RefereeScene['fighters'][number]['posture'] }[]; engagements: RefereeScene['engagements']; referee: RefereeScene['referee'] };

  constructor(private readonly arena: Arena, q: QualitySettings, o: ArenaOptions, private readonly tex: ArenaTextures) {
    this.kind = setKindOf(arena);
    this.seed = o.cosmeticSeed ?? `arena:${arena.id}`;
    this.seedNum = hashString(this.seed);
    this.red = o.cornerColours?.[0] ?? DEFAULT_RED;
    this.blue = o.cornerColours?.[1] ?? DEFAULT_BLUE;
    this.quality = q;
    this.bounds = venueBounds(arena);
    this.tracker = new RefereeTracker(arena);
    this.cu.seedOffset.value = this.seedNum % 65536;
    this.screens.red.value.set(this.red);
    this.screens.blue.value.set(this.blue);
    this.sceneScratch = { phase: 'pre', fighters: [], engagements: [], referee: { state: 'watching' } };

    this.built = this.kind === 'octagon' || this.kind === 'ring' ? this.buildBroadcast(q)
      : this.kind === 'mat' ? this.buildHallSet(q) : this.buildStreetSet(q);
    this.object3d = this.built.root;
    this.object3d.name = `arena:${arena.id}`;
    this.environment = this.built.env;
    this.object3d.add(this.crowdGroup);
    this.setQuality(q);
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private texSize(q: QualitySettings): number {
    return q.level === 'ultra' ? 4096 : q.level === 'low' ? 1024 : 2048;
  }

  private buildBroadcast(q: QualitySettings): Built {
    const root = new THREE.Group();
    const isCage = this.kind === 'octagon';
    const a = wallInradius(this.arena);
    const platform = isCage ? OCTAGON_PLATFORM_M : RING_PLATFORM_M;
    const stageR = isCage ? (a + OCTAGON_APRON_M) / Math.cos(Math.PI / 8) : (a + RING_APRON_M) * Math.SQRT2;
    let tris = 0;
    let draws = 0;
    const add = (m: THREE.Object3D, t: number, d = 1) => { root.add(m); tris += t; draws += d; };

    // Floor texture and material.
    const tex = isCage
      ? octagonCanvasTexture(this.arena, this.texSize(q), this.seed)
      : ringCanvasTexture(this.arena, this.texSize(q), this.seed, this.red, this.blue);
    const canvasMat = floorMaterial({
      map: tex, roughness: 0.82, weaveM: 0.004, weaveDepth: 0.35, undulation: 0.018, occluders: this.occluders,
      detailNormal: this.tex.canvasNormal, detailTileM: 0.45, detailStrength: 0.35,
    });
    const vinyl = vinylMaterial('#ffffff', 0.78);
    vinyl.clearcoat = 0.0;
    vinyl.specularIntensity = 0.6;
    vinyl.vertexColors = true;
    const led = ledMaterial(ledBoardTexture(this.seed, this.red), 0.55);
    led.side = THREE.DoubleSide;

    if (isCage) {
      const parts = buildOctagonParts(this.arena, this.red, this.blue);
      const canvas = new THREE.Mesh(parts.canvas, canvasMat);
      canvas.receiveShadow = true;
      canvas.name = 'arena.canvas';
      add(canvas, parts.canvas.index!.count / 3);
      const hw = new THREE.Mesh(parts.hardware, vinyl);
      hw.castShadow = true;
      hw.receiveShadow = true;
      hw.name = 'arena.cage.hardware';
      add(hw, parts.hardware.index!.count / 3);
      const fence = new THREE.Mesh(parts.fence, chainLinkMaterial({ pitch: 0.05, wireR: 0.0024, colour: '#0b0b0c', roughness: 0.42 }));
      fence.name = 'arena.cage.fence';
      fence.renderOrder = 2;
      add(fence, 16);
      const skirt = new THREE.Mesh(parts.skirt, led);
      skirt.name = 'arena.skirt';
      add(skirt, parts.skirt.index!.count / 3);
    } else {
      const parts = buildRingParts(this.arena, this.red, this.blue);
      const canvas = new THREE.Mesh(parts.canvas, canvasMat);
      canvas.receiveShadow = true;
      canvas.name = 'arena.canvas';
      add(canvas, 4);
      const hw = new THREE.Mesh(parts.hardware, vinyl);
      hw.castShadow = true;
      hw.receiveShadow = true;
      add(hw, parts.hardware.index!.count / 3);
      const ropeMat = vinylMaterial('#ffffff', 0.35);
      ropeMat.vertexColors = true;
      const ropes = new THREE.Mesh(parts.ropes, ropeMat);
      ropes.castShadow = true;
      ropes.name = 'arena.ring.ropes';
      add(ropes, parts.ropes.index!.count / 3);
      const skirt = new THREE.Mesh(parts.skirt, led);
      add(skirt, 12);
    }

    // Arena floor and the dark bowl.
    const arenaFloor = buildArenaFloor(-platform, 70);
    add(arenaFloor, 64);

    // Truss and lights.
    const trussY = isCage ? 8.6 : 8.2;
    const truss = buildTruss({ y: trussY, half: stageR + 1.2, innerHalf: stageR * 0.55, pitch: 0.95 });
    truss.frame.castShadow = false;
    add(truss.frame, truss.triangles);
    add(truss.lenses, 0);
    const rig = broadcastRig(isCage ? 'octagon' : 'ring', stageR, trussY, q);
    root.add(rig.group);

    // Haze: glow column + beams under the inner-square fixtures.
    const column = buildHazeColumn(stageR + 0.8, 0, trussY - 0.3, this.haze);
    add(column, 96);
    const inner = truss.fixtures.filter((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) < stageR * 0.8);
    const beamFrom = inner.filter((_, i) => i % 4 === 1);
    const shafts = buildShafts(beamFrom, 0, 0.1, this.haze, this.seedNum);
    if (shafts) add(shafts, beamFrom.length * 48);

    // Screens.
    const scrMat = screenMaterial(this.screens, null);
    const ch = buildCentreHung(trussY + 5.5, 5.2, scrMat);
    add(ch.group, ch.triangles, 6);

    // Cageside.
    const gateAngles = isCage
      ? [1, 5].map((k) => { const s = wallSegments(this.arena)[k]!; return Math.atan2(s.nx, s.nz); })
      : [-Math.PI / 4 - Math.PI / 2, Math.PI / 4 + Math.PI / 2];
    const dress = buildCagesideDressing(this.arena, isCage ? 'octagon' : 'ring', stageR, -platform, this.seedNum, this.red, this.blue, gateAngles);
    const dressMesh = new THREE.Mesh(dress.lit, propMaterial(0.7, 0));
    dressMesh.receiveShadow = true;
    dressMesh.castShadow = true;
    add(dressMesh, dress.lit.index!.count / 3);
    const dressGlow = new THREE.Mesh(dress.glow, glowMaterialVertex(2.2));
    add(dressGlow, dress.glow.index!.count / 3);

    // Crowd bowl layout (the crowd itself is built in setQuality).
    const bowl: BowlSpec = {
      shape: 'bowl', start: stageR + 4.2, floorY: -platform, floorRows: 9, tierRows: 24, tierGap: 2.6,
      aspect: 1.15, occupancy: 0.93,
    };
    const rows = bowlRows(bowl, this.seedNum);
    const tiers = buildTiers(rows, this.cu);
    if (tiers) add(tiers, tiers.geometry.index!.count / 3);
    this.cu.spillR.value = stageR + 2.5;
    this.cu.spill.value = 0.13;
    this.cu.spillFall.value = 4.0;
    this.cu.accent.value = 0.035;

    const envSpec = {
      kind: this.kind, floorRadius: a * 1.05, floorRadiance: [1.17, 1.13, 1.06] as [number, number, number],
      trussHeight: trussY - 1.6, trussHalf: stageR + 1.2, trussRadiance: 14,
    };
    const env = buildEnvironment(envSpec, this.seedNum);
    // Props outside the pool see the rig from afar: no fill banks, a dimmer canvas.
    const outside = buildEnvironment({ ...envSpec, fillBanks: false, floorRadiance: [0.45, 0.43, 0.4] }, this.seedNum);
    this.extraTextures.push(outside);
    const outsideEnv = pmremTexture(outside);
    for (const o of [arenaFloor, dressMesh, truss.frame]) (o.material as THREE.MeshStandardNodeMaterial).envNode = outsideEnv;
    // Black vinyl pads and ropes: without the fill banks' broad reflections they
    // stay black with a highlight, instead of a grey plastic sheen.
    vinyl.envNode = outsideEnv;
    this.screens.brightness.value = 0.6;
    this.haze.density.value = 0.0009;
    return { root, rig, env, rows, bowl, shafts, triangles: tris, drawCalls: draws };
  }

  private buildHallSet(q: QualitySettings): Built {
    const root = new THREE.Group();
    const tex = matTexture(this.arena, this.texSize(q), this.seed);
    const matMat = floorMaterial({
      map: tex, roughness: 0.62, weaveM: 0, weaveDepth: 0, undulation: 0.006, occluders: this.occluders,
      detailNormal: this.tex.vinylNormal, detailTileM: 0.6, detailStrength: 0.25,
    });
    const hall = buildHall(this.arena, matMat, floorExtent(this.arena), this.seedNum);
    root.add(hall.group);
    const rig = hallRig(wallInradius(this.arena), hall.ceilingY, q);
    root.add(rig.group);
    const bowl: BowlSpec = {
      shape: 'bleachers', start: hall.bleacherZ, floorY: 0, floorRows: 0, tierRows: 7, tierGap: 0,
      aspect: 1, halfLength: 11, occupancy: 0.45,
    };
    const rows = bowlRows(bowl, this.seedNum);
    const tiers = buildTiers(rows, this.cu);
    if (tiers) root.add(tiers);
    this.cu.spillR.value = 30;
    this.cu.spill.value = 0.9;
    this.cu.accent.value = 0.0;
    this.cu.warm.value.setRGB(1, 0.98, 0.95);
    const env = buildEnvironment({
      kind: 'mat', floorRadius: wallInradius(this.arena) + 3, floorRadiance: [0.35, 0.4, 0.55],
      trussHeight: hall.ceilingY - 1.6, trussHalf: 14, trussRadiance: 6,
    }, this.seedNum);
    return {
      root, rig, env, rows, bowl, shafts: null,
      triangles: hall.triangles + (tiers ? tiers.geometry.index!.count / 3 : 0), drawCalls: hall.drawCalls + 1,
    };
  }

  private buildStreetSet(q: QualitySettings): Built {
    const root = new THREE.Group();
    const st = buildStreet(this.arena, this.seedNum, this.haze, this.tex.asphalt);
    root.add(st.group);
    const rig = streetRig(st.lamps, q);
    root.add(rig.group);
    const bowl: BowlSpec = {
      shape: 'bystanders', start: 5.6, floorY: 0, floorRows: 0, tierRows: 0, tierGap: 0, aspect: 1, occupancy: 1,
    };
    const rows = bowlRows(bowl, this.seedNum);
    this.cu.spillR.value = 6;
    this.cu.spill.value = 0.35;
    this.cu.spillFall.value = 5;
    this.cu.accent.value = 0.0;
    this.cu.warm.value.setRGB(1.0, 0.62, 0.25);
    this.cu.phones.value = 0.6;
    const env = buildEnvironment({
      kind: 'street', floorRadius: 0, floorRadiance: [0, 0, 0], trussHeight: 0, trussHalf: 0, trussRadiance: 0,
    }, this.seedNum);
    this.haze.colour.value.setRGB(1.0, 0.62, 0.3);
    this.haze.density.value = 0.0011;
    return { root, rig, env, rows, bowl, shafts: st.shafts, triangles: st.triangles, drawCalls: st.drawCalls };
  }

  private rebuildCrowd(q: QualitySettings): void {
    const key = `${q.crowd}:${q.crowdCount}`;
    if (key === this.crowdKey) return;
    this.crowdKey = key;
    for (const c of [...this.crowdGroup.children]) {
      this.crowdGroup.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.crowdTris = 0;
    this.crowdFigures = 0;
    this.crowdDraws = 0;
    const { rows, bowl } = this.built;
    if (!bowl || q.crowd === 'off') return;
    const bystanders = bowl.shape === 'bystanders';
    let firstCardRow = 0;
    if (q.crowd === 'instanced' || bystanders) {
      const count = bystanders ? 100 : Math.max(0, q.crowdCount);
      const limit = bystanders ? rows.length : rowsCovered(rows, count, bowl.occupancy, bowl.start + 12);
      const figs = buildFigures(rows, limit, this.cu, this.seedNum ^ 0x5eed, bowl.occupancy, bystanders);
      if (figs) {
        this.crowdGroup.add(figs.mesh);
        this.crowdTris += figs.triangles;
        this.crowdFigures = figs.count;
        this.crowdDraws++;
      }
      firstCardRow = limit;
    }
    if (!bystanders) {
      const cards = buildCardStrips(rows, firstCardRow, this.cu, bowl.occupancy);
      if (cards) {
        this.crowdGroup.add(cards);
        this.crowdTris += cards.geometry.index!.count / 3;
        this.crowdDraws++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // ArenaSet
  // -------------------------------------------------------------------------

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.built.rig.setQuality(q);
    this.occluders.noShadows.value = q.shadows === 'off' ? 1 : 0;
    if (this.built.shafts) this.built.shafts.visible = q.level !== 'low';
    this.rebuildCrowd(q);
  }

  update(input: FrameInput, fighters: readonly WorldPose[], realDt: number): void {
    const f = input.frame;
    const simTime = input.simTime;
    const tickS = f.tick > 0 && f.t > 0 ? f.t / f.tick : 0.1;
    if (input.discontinuity) this.memory.clear();
    this.memory.add(input.events);
    const events = this.memory.at(simTime);
    let subStage = 0;
    let anyDown = false;
    for (const ff of f.fighters) {
      if (ff.posture === 'down') anyDown = true;
      if (ff.sub.technique) subStage = Math.max(subStage, ff.sub.stage);
    }
    this.crowd = crowdState(events as readonly SimEvent[], simTime, { phase: f.phase, anyDown, subStage }, tickS);
    this.cu.time.value = simTime;
    this.cu.stand.value = this.crowd.stand;
    this.cu.excite.value = this.crowd.excitement;
    this.cu.flashP.value = this.crowd.flashRate / 1000 / FLASH_BUCKETS_PER_S;
    this.cu.phones.value = this.kind === 'street' ? 0.6 : this.crowd.phones;
    this.haze.time.value = simTime;
    this.screens.time.value = simTime;
    this.screens.excite.value = this.crowd.excitement;

    this.feedOccluders(input, fighters);

    // Referee: interpolated floor positions, then the speed-limited follow.
    const s = this.sceneScratch;
    s.phase = f.phase;
    s.engagements = f.engagements;
    s.referee = f.referee;
    s.fighters.length = 0;
    const a = input.alpha;
    for (let i = 0; i < f.fighters.length; i++) {
      const p = f.fighters[i]!;
      const n = input.next?.fighters[i];
      s.fighters.push({
        id: p.id,
        x: n ? p.x + (n.x - p.x) * a : p.x,
        z: n ? p.z + (n.z - p.z) * a : p.z,
        posture: p.posture,
      });
    }
    const r = this.tracker.update(s, simTime, realDt * Math.max(0.05, input.playbackRate), input.discontinuity);
    this.referee = r.present ? r : null;
  }

  private feedOccluders(input: FrameInput, fighters: readonly WorldPose[]): void {
    const d = this.occluders.data;
    let k = 0;
    const put = (x: number, y: number, z: number, r: number) => {
      if (k < OCCLUDER_COUNT) d[k++]!.set(x, y, z, r);
    };
    const bones: [number, number][] = [
      [B.hips, 0.17], [B.spine1, 0.16], [B.spine2, 0.17], [B.head, 0.12], [B.lLeg, 0.09], [B.rLeg, 0.09],
      [B.lFoot, 0.075], [B.rFoot, 0.075], [B.lHand, 0.07], [B.rHand, 0.07],
    ];
    if (fighters.length > 0) {
      for (const w of fighters) {
        for (const [b, r] of bones) put(w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!, r);
      }
    } else {
      for (const p of input.frame.fighters) {
        const low = p.posture === 'down' || p.posture === 'ground';
        put(p.x, low ? 0.2 : 0.95, p.z, low ? 0.3 : 0.2);
        put(p.x, low ? 0.15 : 0.45, p.z, 0.16);
        put(p.x, 0.08, p.z, 0.12);
      }
    }
    // The referee is a body on the floor too.
    if (this.referee) {
      put(this.referee.x, 0.95 - this.referee.crouch * 0.3, this.referee.z, 0.17);
      put(this.referee.x, 0.1, this.referee.z, 0.12);
    }
    const used = k;
    while (k < OCCLUDER_COUNT) d[k++]!.set(0, -100, 0, 0);
    this.occluders.commit(used);
  }

  stats(): { triangles: number; drawCalls: number; crowdFigures: number } {
    return {
      triangles: Math.round(this.built.triangles + this.crowdTris),
      drawCalls: this.built.drawCalls + this.crowdDraws,
      crowdFigures: this.crowdFigures,
    };
  }

  dispose(): void {
    this.built.rig.dispose();
    this.object3d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
            if (v instanceof THREE.Texture) v.dispose();
          }
          mat.dispose();
        }
      }
    });
    this.built.env.dispose();
    for (const t of this.extraTextures) t.dispose();
  }
}

/** Vertex-coloured unlit glow (monitor screens, tally lights). */
function glowMaterialVertex(gain: number): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = attribute('color', 'vec3').mul(gain);
  return m;
}

export { circumradius };
