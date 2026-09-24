/**
 * Character lookdev. Two modes.
 *
 * LINE-UP (default): the 15 archetypes in a guard pose under a studio light or a stand-in arena
 * light.
 *
 *   light=studio|arena   sweat=0..1  flush=0..1  damage=0..1  swell=0..1  cuts=0|1  blood=0|1
 *   tone=0..1 (override every fighter)   face=0..9   hair=<style>   glove=mma4oz|boxing10oz|boxing16oz|grappling|bare
 *   fighter=<index> | fighters=i,j,k   close=face|gloves|shorts|body   lod=0..3   pose=guard|relaxed|t
 *   yaw=<deg> pitch=<deg> dist=<m>  (camera orbit)   clean=1 (hide UI)   backend=webgl2
 *
 * VENUE BOARDS (`board=...`): the real broadcast venue (`createVenueAsync`, octagon by default,
 * `set=<ArenaId>`), its key light and image-based environment, and several camera presets
 * rendered as tiles of ONE frame so a single capture serves a whole comparison. Every tile shows
 * one or two fighters standing at the centre of the cage, under the hard overhead key.
 *
 *   board=distances  main wide (~12 m), cageside (~3 m, torso), replay close-up (~1.2 m face)
 *   board=sweat      round 1 vs round 3 sweat: torso at cageside and face close-up
 *   board=tones      very light / medium / very dark skin: cageside torso and face close-up
 *   board=faces      the 10 face presets, replay close-up
 *   board=hair       the 8 hair styles, close-up three-quarter views
 *   board=detail     skin micro-detail: knuckles/forearm, abdomen, back/shoulder, face (1 m)
 *   board=face       two faces (light / dark skin) at 0.5 m, three-quarter 0.6 m and an eye at 0.22 m
 *                    (mouth=1 opens the mouth; face=<preset>, hair=, facial= apply to the first)
 *   shot=wide|cageside|replay   one full-frame preset through the stage's own post pipeline
 *                                (TAA, GTAO, bloom, ACES, broadcast LUT) instead of a board
 *   round=1|3        sweat/flush of an early / late round for `shot=` (default 2)
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ARCHETYPES, ARENAS, deriveRuntime, resolveParams, type ArenaId, type FighterDefinition } from '../src/sim';
import type { BoutPresentation, CharacterVisualState, GloveKind, QualitySettings } from '../src/presentation/contract';
import { createCharacterFactory, FighterActor, skinDebug } from '../src/presentation/character';
import {
  B, createPose, createWorldPose, forwardKinematics, FACE, type Pose,
} from '../src/presentation/rig/skeleton';
import { LIMBS, solveTwoBone, axisAngle } from '../src/presentation/rig/ik';
import { mulQuat } from '../src/presentation/rig/skeleton';
import { createVenueAsync } from '../src/presentation/arena';
import { StagePipeline, STAGE_TUNING, qualitySettings } from '../src/presentation/stage';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
if (q.get('clean') === '1') document.body.classList.add('clean');
// ?dbg=1..9 shows one skin map channel (skinMaterial.ts): lash, redness, veins, oil, pores, cavity, sweat, wet, AO.
skinDebug.value = num('dbg', 0);

const QUALITY: QualitySettings = {
  level: 'high', renderScale: 1, upscale: 'none', antialias: 'fxaa', maxPixelRatio: 1.5, shadows: 'soft',
  shadowMapSize: 2048, ambientOcclusion: false, screenSpaceReflections: false, bloom: false,
  replayDepthOfField: false, replayMotionBlur: false, skinScattering: q.get('sss') !== '0', sweatAndDamage: true,
  crowd: 'off', crowdCount: 0, maxCharacterLOD: 0,
};

interface Look { tone: number; face: number; hair: string; colour: string; facial: string; tattoos?: string[]; kit?: [string, string] }

// Lookdev variety: the archetypes all ship the same default appearance, so the page dresses them
// (this is presentation-side test data only; the sim definitions are never modified).
const LOOKS: Look[] = [
  { tone: 0.35, face: 0, hair: 'crew', colour: 'darkBrown', facial: 'stubble', kit: ['#1b1b1f', '#b3122a'] },
  { tone: 0.55, face: 2, hair: 'buzz', colour: 'black', facial: 'none', tattoos: ['rightArmFull'] },
  { tone: 0.2, face: 4, hair: 'receding', colour: 'brown', facial: 'full' },
  { tone: 0.12, face: 9, hair: 'fade', colour: 'lightBrown', facial: 'stubble' },
  { tone: 0.72, face: 5, hair: 'fade', colour: 'black', facial: 'goatee', tattoos: ['chest'] },
  { tone: 0.95, face: 1, hair: 'bald', colour: 'black', facial: 'none' },
  { tone: 0.28, face: 7, hair: 'crew', colour: 'red', facial: 'full', tattoos: ['leftArmFull', 'back'] },
  { tone: 0.45, face: 3, hair: 'curly', colour: 'black', facial: 'none' },
  { tone: 0.85, face: 8, hair: 'cornrows', colour: 'black', facial: 'moustache' },
  { tone: 0.05, face: 0, hair: 'buzz', colour: 'blonde', facial: 'stubble', tattoos: ['leftForearm'] },
  { tone: 0.66, face: 6, hair: 'braids', colour: 'black', facial: 'full' },
  { tone: 0.4, face: 2, hair: 'crew', colour: 'black', facial: 'none' },
  { tone: 0.25, face: 7, hair: 'bald', colour: 'grey', facial: 'full' },
  { tone: 0.78, face: 5, hair: 'buzz', colour: 'black', facial: 'stubble', tattoos: ['rightLeg'] },
  { tone: 0.5, face: 8, hair: 'fade', colour: 'darkBrown', facial: 'goatee', tattoos: ['leftArmFull'] },
];

function dress(def: FighterDefinition, L: Look, id?: string): FighterDefinition {
  const tone = q.has('tone') ? num('tone', 0.5) : L.tone;
  return {
    ...def,
    id: id ?? def.id,
    appearance: {
      ...def.appearance,
      skinTone: tone,
      facePreset: q.has('face') ? num('face', 0) : L.face,
      hairStyle: { styleId: q.get('hair') ?? L.hair, colorId: L.colour, length: 'short' },
      facialHair: (q.get('facial') ?? L.facial) as never,
      tattooPlacements: (L.tattoos ?? []).map((slot) => ({ slot: slot as never, textureId: 'ink.default' })),
      shortsKit: L.kit ? { style: 'mma_short', primary: L.kit[0], secondary: L.kit[1], trim: '#d8d8d8' } : undefined,
      handWrapColor: '#e8e6e0',
    },
  };
}

function baseState(sweat: number, flush: number): CharacterVisualState {
  return {
    sweat, flush,
    damageZones: new Array(8).fill(num('damage', 0)), swelling: new Array(8).fill(num('swell', num('damage', 0) * 0.8)),
    cuts: q.get('cuts') === '1' ? [
      { site: 'brow_L', severity: 2, bleeding: true, ageS: 25 },
      { site: 'nose_bridge', severity: 1, bleeding: false, ageS: 60 },
      { site: 'cheek_R', severity: 1, bleeding: true, ageS: 8 },
    ] : [],
    bloodOnGloves: num('damage', 0), blood: q.get('blood') !== '0', fatigue: num('fatigue', 0.3),
  };
}

/** Presenter-like sweat for an early and a late round (presenter.ts: 0.1 + fatigue + round time). */
const ROUND: Record<string, { sweat: number; flush: number; fatigue: number }> = {
  '1': { sweat: 0.28, flush: 0.12, fatigue: 0.1 },
  '2': { sweat: 0.5, flush: 0.25, fatigue: 0.3 },
  '3': { sweat: 0.85, flush: 0.45, fatigue: 0.7 },
};

async function makeRenderer(): Promise<THREE.WebGPURenderer> {
  const container = document.getElementById('app')!;
  // perf=1: GPU timestamp queries (median GPU ms per frame in __stats.gpuMs).
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: q.get('backend') === 'webgl2', trackTimestamp: q.get('perf') === '1' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  await renderer.init();
  return renderer;
}

function makeBout(defs: FighterDefinition[], glove: GloveKind): BoutPresentation {
  const params = resolveParams();
  return {
    fighters: defs,
    runtimes: defs.map((d) => deriveRuntime(d, params, { explain: false })),
    teamOf: defs.map((_, i) => i % 2),
    arena: ARENAS.octagon_30,
    rulesetId: glove.startsWith('boxing') ? 'boxing' : 'mma.unified',
    glove,
    cornerColours: defs.map((_, i) => (i % 2 ? '#1d4fb8' : '#c01824')),
    blood: q.get('blood') !== '0',
    cosmeticSeed: q.get('seed') ?? 'lookdev',
  };
}

// ---------------------------------------------------------------------------
// Line-up mode (pass 1's page)
// ---------------------------------------------------------------------------

async function lineup(): Promise<void> {
  const renderer = await makeRenderer();
  const scene = new THREE.Scene();
  const light = q.get('light') ?? 'arena';
  setupLights(scene, renderer, light);

  const all = Object.values(ARCHETYPES);
  const pick = q.has('fighters') ? q.get('fighters')!.split(',').map((i) => all[Number(i) % all.length])
    : q.has('fighter') ? [all[num('fighter', 0) % all.length]] : all;
  const defs = pick.map((d) => dress(d, LOOKS[all.indexOf(d) % LOOKS.length]));
  const glove = (q.get('glove') ?? 'mma4oz') as GloveKind;
  const bout = makeBout(defs, glove);

  const factory = createCharacterFactory();
  const t0 = performance.now();
  await factory.preload();
  const tPreload = performance.now() - t0;
  const actors: FighterActor[] = [];
  const spacing = 1.15;
  const poses: Pose[] = [];
  for (let i = 0; i < defs.length; i++) {
    const a = factory.create(bout, i, QUALITY) as FighterActor;
    actors.push(a);
    scene.add(a.object3d);
    const x = (i - (defs.length - 1) / 2) * spacing;
    const pose = makePose(a, q.get('pose') ?? 'guard', x, 0, 0, defs[i].body.stance === 'southpaw');
    pose.face[FACE.mouthOpen] = num('mouth', 0);
    pose.face[FACE.grimace] = num('grimace', 0);
    pose.face[FACE.wince] = num('wince', 0);
    poses.push(pose);
    a.applyPose(pose);
    a.setLOD(num('lod', 0) as 0);
  }
  const buildMs = actors.map((a) => a.buildMs);
  const state = baseState(num('sweat', 0.25), num('flush', 0.2));
  const ui = buildUI(state, actors, poses);
  for (const a of actors) a.setVisualState(state);

  const camera = new THREE.PerspectiveCamera(num('fov', 30), window.innerWidth / window.innerHeight, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  const target = new THREE.Vector3(0, 1.1, 0);
  let dist = num('dist', defs.length > 1 ? 16 : 3.6);
  const close = q.get('close');
  const focus = actors[Math.min(actors.length - 1, num('focus', 0))];
  if (close) {
    const w = createWorldPose();
    forwardKinematics(w, poses[actors.indexOf(focus)], focus.rest);
    const at = (b: number): THREE.Vector3 => new THREE.Vector3(w.pos[b * 3], w.pos[b * 3 + 1], w.pos[b * 3 + 2]);
    if (close === 'face') { target.copy(at(B.head)).add(new THREE.Vector3(0, 0.08, 0.04)); dist = num('dist', 0.62); }
    else if (close === 'hand') { target.copy(at(B.lHand)).lerp(at(B.lHand + 4), 0.8); dist = num('dist', 0.45); }
    else if (close === 'gloves') { target.copy(at(B.lHand)).lerp(at(B.rHand), 0.5); dist = num('dist', 0.8); }
    else if (close === 'shorts') { target.copy(at(B.hips)).add(new THREE.Vector3(0, -0.12, 0)); dist = num('dist', 1.4); }
    else { target.copy(at(B.spine1)); dist = num('dist', 3.2); }
  }
  const yaw = THREE.MathUtils.degToRad(num('yaw', 12));
  const pitch = THREE.MathUtils.degToRad(num('pitch', 6));
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  controls.target.copy(target);
  controls.update();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  const tris = actors.map((a) => Math.round(a.triangles()));
  loop(renderer, () => { controls.update(); renderer.render(scene, camera); }, { tPreload, buildMs, tris });
  void ui;
}

// ---------------------------------------------------------------------------
// Venue boards
// ---------------------------------------------------------------------------

interface Cam { pos: [number, number, number]; target: [number, number, number]; fov: number }
interface Tile {
  label: string;
  cam: Cam;
  /** Actor indices drawn in this tile. */
  show: number[];
  /** Visual state per shown actor (defaults to the board's). */
  state?: (i: number) => CharacterVisualState;
}

/** Head / chest world positions of a posed actor. */
function joints(a: FighterActor, p: Pose): (b: number) => [number, number, number] {
  const w = createWorldPose();
  forwardKinematics(w, p, a.rest);
  return (b) => [w.pos[b * 3], w.pos[b * 3 + 1], w.pos[b * 3 + 2]];
}

/** A camera `dist` metres from `t` along a horizontal yaw (0 = +Z) and a pitch (deg, + above). */
function orbit(t: [number, number, number], dist: number, yawDeg: number, pitchDeg: number, fov: number): Cam {
  const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg);
  return { pos: [t[0] + Math.sin(y) * Math.cos(p) * dist, t[1] + Math.sin(p) * dist, t[2] + Math.cos(y) * Math.cos(p) * dist], target: t, fov };
}

async function venueBoard(): Promise<void> {
  const renderer = await makeRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const board = q.get('board') ?? 'distances';
  const shot = q.get('shot');
  // Boards render at scale 1; a `shot=` uses the High preset's own render scale (TAAU) unless rs= is given.
  const hq = qualitySettings('high', q.has('rs') ? num('rs', 1) : shot ? undefined : 1);
  const venueId = (q.get('set') ?? 'octagon_30') as ArenaId;
  const tv = performance.now();
  const venue = await createVenueAsync(ARENAS[venueId] ?? ARENAS.octagon_30, hq, { cosmeticSeed: 'lookdev', cornerColours: ['#c01824', '#1d4fb8'] });
  const venueMs = performance.now() - tv;
  scene.add(venue.object3d);
  scene.environment = venue.environment;

  const all = Object.values(ARCHETYPES);
  const arch = (i: number): FighterDefinition => all[i % all.length];
  const round = ROUND[q.get('round') ?? '2'] ?? ROUND['2'];
  const lk = (o: Partial<Look>, base = 0): Look => ({ ...LOOKS[base], ...o });
  // Who is on the board.
  let defs: FighterDefinition[];
  let layout: 'pair' | 'centre' = 'centre';
  const tone = q.has('tone') ? num('tone', 0.5) : undefined;
  switch (shot ? 'distances' : board) {
    case 'sweat':
      defs = [dress(arch(0), lk({ tone: tone ?? 0.4, hair: 'buzz', facial: 'stubble', colour: 'black' }), 'lookdev.sweat')];
      break;
    case 'tones':
      defs = [0.06, 0.5, 0.95].map((t, i) => dress(arch(0), lk({ tone: t, face: 3, hair: 'buzz', colour: t > 0.6 ? 'black' : 'darkBrown', facial: 'stubble' }), `lookdev.tone${i}`));
      break;
    case 'faces':
      defs = Array.from({ length: 10 }, (_, f) => dress(arch(f % 3 === 0 ? 0 : f % 3 === 1 ? 4 : 10),
        lk({ tone: tone ?? [0.3, 0.8, 0.15, 0.5, 0.25, 0.7, 0.45, 0.35, 0.9, 0.1][f], face: f, hair: ['buzz', 'fade', 'crew', 'bald', 'receding', 'cornrows', 'curly', 'crew', 'bald', 'buzz'][f], colour: 'black', facial: ['stubble', 'none', 'full', 'goatee', 'stubble', 'none', 'moustache', 'full', 'stubble', 'none'][f] }), `lookdev.face${f}`));
      break;
    case 'hair':
      defs = ['bald', 'buzz', 'fade', 'crew', 'curly', 'cornrows', 'braids', 'receding'].map((h, i) =>
        dress(arch(0), lk({ tone: [0.3, 0.55, 0.8, 0.2, 0.6, 0.9, 0.7, 0.15][i], hair: h, face: [0, 2, 5, 9, 3, 1, 6, 4][i], colour: i === 3 ? 'brown' : i === 7 ? 'lightBrown' : 'black', facial: ['full', 'stubble', 'goatee', 'none', 'none', 'moustache', 'stubble', 'stubble'][i] }), `lookdev.hair${i}`));
      break;
    case 'detail':
      defs = [dress(arch(0), lk({ tone: tone ?? 0.35, hair: 'buzz', facial: 'stubble', colour: 'darkBrown' }), 'lookdev.detail')];
      break;
    case 'face':
      defs = [dress(arch(0), lk({ tone: tone ?? 0.3, face: q.has('face') ? num('face', 0) : 0, hair: q.get('hair') ?? 'buzz', facial: q.get('facial') ?? 'stubble', colour: 'darkBrown' }), 'lookdev.face'),
        dress(arch(4), lk({ tone: 0.85, face: q.has('face') ? num('face', 5) : 5, hair: 'fade', facial: 'full', colour: 'black' }), 'lookdev.face2')];
      break;
    default:
      layout = 'pair';
      defs = [dress(arch(0), LOOKS[q.has('look') ? num('look', 0) : 0]), dress(arch(4), LOOKS[q.has('look2') ? num('look2', 4) : 4])];
  }
  const glove = (q.get('glove') ?? 'mma4oz') as GloveKind;
  const bout = makeBout(defs, glove);
  const factory = createCharacterFactory();
  const t0 = performance.now();
  await factory.preload();
  const tPreload = performance.now() - t0;
  const actors: FighterActor[] = [];
  const poses: Pose[] = [];
  const poseKind = q.get('pose') ?? (['faces', 'hair', 'tones', 'sweat', 'detail', 'face'].includes(board) && !shot ? 'relaxed' : 'guard');
  for (let i = 0; i < defs.length; i++) {
    const a = factory.create(bout, i, hq) as FighterActor;
    actors.push(a);
    scene.add(a.object3d);
    // Pair: the two fighters face each other across the centre of the cage, turned a little
    // toward the hard camera (+Z), as in a live exchange.
    const pair = layout === 'pair';
    const x = pair ? (i === 0 ? -0.72 : 0.72) : 0;
    const yawDeg = pair ? (i === 0 ? 90 - 28 : -90 + 28) : num('fyaw', 0);
    const pose = makePose(a, poseKind, x, pair ? 0.1 : 0, yawDeg, defs[i].body.stance === 'southpaw');
    pose.face[FACE.mouthOpen] = num('mouth', 0);
    pose.face[FACE.breathe] = 0.25 + round.fatigue * 0.5;
    poses.push(pose);
    a.applyPose(pose);
    a.setLOD(0);
  }
  const buildMs = actors.map((a) => a.buildMs);
  const st = (s: { sweat: number; flush: number; fatigue: number }): CharacterVisualState => ({ ...baseState(num('sweat', s.sweat), num('flush', s.flush)), fatigue: s.fatigue });
  for (const a of actors) a.setVisualState(st(round));

  // Tiles.
  const J = actors.map((a, i) => joints(a, poses[i]));
  const head = (i: number): [number, number, number] => { const h = J[i](B.head); return [h[0], h[1] + 0.07, h[2]]; };
  const chest = (i: number): [number, number, number] => J[i](B.spine2);
  /** World position of an eye (side 1 = the fighter's left), from the head joint and the A-pose offset. */
  const eyeW = (i: number, side: number): [number, number, number] => {
    const h = J[i](B.head), lm = actors[i].body.landmarks, ja = actors[i].body.jointsA.head;
    const e = side > 0 ? lm.eyeL : lm.eyeR;
    return [h[0] + e[0] - ja[B.head * 3], h[1] + e[1] - ja[B.head * 3 + 1], h[2] + e[2] - ja[B.head * 3 + 2]];
  };
  const mid = (a: number[], b: number[], t = 0.5): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const everyone = actors.map((_, i) => i);
  let tiles: Tile[];
  const r1 = ROUND['1'], r3 = ROUND['3'];
  switch (shot ? 'distances' : board) {
    case 'sweat':
      tiles = [
        { label: 'ROUND 1 — cageside 3 m', cam: orbit(mid(chest(0), head(0), 0.25), 2.9, 18, 6, 24), show: [0], state: () => st(r1) },
        { label: 'ROUND 3 — cageside 3 m', cam: orbit(mid(chest(0), head(0), 0.25), 2.9, 18, 6, 24), show: [0], state: () => st(r3) },
        { label: 'ROUND 1 — back', cam: orbit(chest(0), 2.9, 180 + 25, 8, 24), show: [0], state: () => st(r1) },
        { label: 'ROUND 3 — back', cam: orbit(chest(0), 2.9, 180 + 25, 8, 24), show: [0], state: () => st(r3) },
        { label: 'ROUND 1 — replay 1.2 m', cam: orbit(head(0), 1.2, 25, 4, 24), show: [0], state: () => st(r1) },
        { label: 'ROUND 3 — replay 1.2 m', cam: orbit(head(0), 1.2, 25, 4, 24), show: [0], state: () => st(r3) },
      ];
      break;
    case 'tones':
      tiles = [
        ...[0, 1, 2].map((i) => ({ label: `tone ${[0.06, 0.5, 0.95][i]} — cageside`, cam: orbit(mid(chest(i), head(i), 0.25), 2.9, 20, 6, 24), show: [i] })),
        ...[0, 1, 2].map((i) => ({ label: `tone ${[0.06, 0.5, 0.95][i]} — replay`, cam: orbit(head(i), 1.2, 22, 4, 24), show: [i] })),
      ];
      break;
    case 'faces':
      tiles = everyone.map((i) => ({ label: `face ${i}`, cam: orbit(head(i), 1.2, 18, 3, 20), show: [i] }));
      break;
    case 'hair':
      tiles = everyone.map((i) => ({ label: defs[i].appearance.hairStyle?.styleId ?? '', cam: orbit(mid(head(i), [head(i)[0], head(i)[1] + 0.04, head(i)[2]]), 1.0, i % 2 ? 140 : 35, 14, 22), show: [i] }));
      break;
    case 'face':
      tiles = [
        { label: 'face 0.5 m', cam: orbit(head(0), 0.5, 8, 2, 24), show: [0] },
        { label: 'three-quarter 0.6 m', cam: orbit(head(0), 0.6, 38, 4, 24), show: [0] },
        q.has('mouthcam')
          ? { label: 'mouth 0.25 m', cam: orbit([head(0)[0], head(0)[1] - 0.085, head(0)[2] + 0.1], 0.22, 25, 4, 30), show: [0] }
          : { label: 'eye 0.14 m', cam: orbit(eyeW(0, 1), 0.14, 18, 2, 24), show: [0] },
        { label: 'face 0.5 m', cam: orbit(head(1), 0.5, -10, 2, 24), show: [1] },
        { label: 'three-quarter 0.6 m', cam: orbit(head(1), 0.6, -38, 4, 24), show: [1] },
        { label: 'eye 0.14 m', cam: orbit(eyeW(1, -1), 0.14, -18, 2, 24), show: [1] },
      ];
      break;
    case 'detail': {
      const hand = J[0](B.lForeArm), wrist = J[0](B.lHand);
      tiles = [
        { label: 'forearm / hand 0.7 m', cam: orbit(mid(hand, wrist, 0.55), 0.7, 75, 8, 26), show: [0] },
        { label: 'abdomen 1 m', cam: orbit(J[0](B.spine1), 1.0, 12, 4, 26), show: [0] },
        { label: 'back / shoulders 1.1 m', cam: orbit(chest(0), 1.1, 200, 10, 30), show: [0] },
        { label: 'face 0.7 m', cam: orbit(head(0), 0.7, 30, 2, 24), show: [0] },
      ];
      break;
    }
    default: {
      const c = mid(chest(0), chest(1));
      tiles = [
        { label: 'MAIN WIDE ~12 m', cam: { pos: [c[0] + 1.6, 5.4, 11.2], target: [c[0], 0.95, c[2]], fov: 24 }, show: everyone },
        { label: 'CAGESIDE ~3 m', cam: orbit(mid(chest(0), head(0), 0.3), 3.0, 35, 5, 26), show: everyone },
        { label: 'REPLAY CLOSE-UP ~1.2 m', cam: orbit(head(0), 1.2, 30, 3, 24), show: everyone },
        { label: 'REPLAY CLOSE-UP ~1.2 m (opponent)', cam: orbit(head(1), 1.2, -30, 3, 24), show: everyone },
      ];
      if (shot) tiles = [tiles[shot === 'cageside' ? 1 : shot === 'replay' ? 2 : 0]];
    }
  }

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
  const setCam = (c: Cam, aspect: number): void => {
    camera.position.set(...c.pos);
    camera.lookAt(...c.target);
    camera.fov = c.fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };
  const overlay = document.getElementById('labels')!;

  if (shot) {
    // One preset through the stage's real post pipeline.
    const tile = tiles[0];
    setCam(tile.cam, innerWidth / innerHeight);
    const pipeline = new StagePipeline(renderer, scene, camera, hq, STAGE_TUNING.high);
    overlay.innerHTML = `<div class="lab" style="left:12px;top:10px">${tile.label}</div>`;
    const tris = actors.map((a) => Math.round(a.triangles()));
    loop(renderer, () => pipeline.render(false), { tPreload, buildMs, tris, venueMs });
    installBench(renderer, () => pipeline.render(false));
    return;
  }

  // Tiled board: plain renderer (ACES output), one scissored viewport per tile.
  const n = tiles.length;
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const W = innerWidth, H = innerHeight;
  const tw = Math.floor(W / cols), th = Math.floor(H / rows);
  overlay.innerHTML = tiles.map((t, k) => `<div class="lab" style="left:${(k % cols) * tw + 8}px;top:${Math.floor(k / cols) * th + 6}px">${t.label}</div>`).join('');
  renderer.autoClear = false;
  const baseline = st(round);
  const tris = actors.map((a) => Math.round(a.triangles()));
  loop(renderer, () => {
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    tiles.forEach((t, k) => {
      const x = (k % cols) * tw, yTop = Math.floor(k / cols) * th;
      const y = yTop; // three.js viewports use a top-left origin on both backends
      actors.forEach((a, i) => {
        a.object3d.visible = t.show.includes(i);
        if (a.object3d.visible) a.setVisualState(t.state ? t.state(i) : baseline);
      });
      renderer.setViewport(x, y, tw, th);
      renderer.setScissor(x, y, tw, th);
      setCam(t.cam, tw / th);
      renderer.render(scene, camera);
    });
  }, { tPreload, buildMs, tris, venueMs });
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function loop(renderer: THREE.WebGPURenderer, draw: () => void, info0: { tPreload: number; buildMs: number[]; tris: number[]; venueMs?: number }): void {
  const stats = document.getElementById('stats')!;
  let frames = 0;
  let last = performance.now();
  let fpsAcc = 0;
  const gpu: number[] = [];
  const tick = (): void => {
    draw();
    if (q.get('perf') === '1' && frames > 30) {
      void renderer.resolveTimestampsAsync('render').then((ms) => {
        if (typeof ms === 'number' && ms > 0) { gpu.push(ms); if (gpu.length > 90) gpu.shift(); }
      });
    }
    frames++;
    const now = performance.now();
    fpsAcc += now - last;
    last = now;
    if (frames % 30 === 0) {
      const ms = fpsAcc / 30;
      fpsAcc = 0;
      const info = renderer.info.render;
      stats.textContent = `${renderer.backend.constructor.name}  ${ms.toFixed(1)} ms/frame  calls ${info.drawCalls}  tris ${info.triangles}\n` +
        `preload ${info0.tPreload.toFixed(0)} ms  build/fighter ${avg(info0.buildMs).toFixed(0)} ms (max ${Math.max(...info0.buildMs).toFixed(0)})  LOD0 tris/fighter ${Math.max(...info0.tris)}`;
      const benchMs = (window as unknown as { __benchMs?: number }).__benchMs;
    (window as unknown as { __stats: unknown }).__stats = {
        benchMs, gpuMs: gpu.length ? [...gpu].sort((a, b) => a - b)[gpu.length >> 1] : undefined, gpuN: gpu.length,
        backend: renderer.backend.constructor.name, frameMs: ms, drawCalls: info.drawCalls, triangles: info.triangles,
        preloadMs: info0.tPreload, buildMs: avg(info0.buildMs), buildMaxMs: Math.max(...info0.buildMs), trisPerFighter: Math.max(...info0.tris),
        venueMs: info0.venueMs,
      };
    }
    if (frames === 20) (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(tick);
  };
  tick();
}

const avg = (a: number[]): number => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

/**
 * GPU throughput: `window.__bench(n)` renders n frames back to back, drains the GPU queue and
 * reports the best of five trials in `__stats.benchMs` (rAF is capped at the display rate).
 */
function installBench(renderer: THREE.WebGPURenderer, draw: () => void): void {
  const w = window as unknown as { __bench: (n: number) => Promise<number>; __stats?: Record<string, unknown>; __benchMs?: number };
  w.__bench = async (n: number) => {
    const device = (renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
    const drain = async (): Promise<void> => { if (device) await device.queue.onSubmittedWorkDone(); else await new Promise((r) => setTimeout(r, 50)); };
    for (let i = 0; i < 5; i++) draw();
    await drain();
    let best = Infinity;
    for (let t = 0; t < 5; t++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) draw();
      await drain();
      best = Math.min(best, (performance.now() - t0) / n);
    }
    w.__benchMs = best;
    return best;
  };
}

function setupLights(scene: THREE.Scene, renderer: THREE.WebGPURenderer, mode: string): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  const floorMat = new THREE.MeshStandardNodeMaterial({ color: 0xb9b4ac, roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  if (mode === 'studio') {
    scene.background = new THREE.Color(0x4a4d52);
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff4e8, 2.6);
    key.position.set(4, 6, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 4, bottom: -1, near: 0.5, far: 30 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce6ff, 0.7);
    fill.position.set(-6, 3, 4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4);
    rim.position.set(0, 4, -6);
    scene.add(rim);
  } else {
    // Arena stand-in: very dark surround, hard overhead key ring (5600 K), cool rims, faint bounce.
    scene.background = new THREE.Color(0x020203);
    scene.environmentIntensity = 0.12;
    floorMat.color.set(0x9a958d);
    const ring = 4;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + 0.6;
      const s = new THREE.SpotLight(0xfff6ea, 95, 22, THREE.MathUtils.degToRad(38), 0.5, 2);
      s.position.set(Math.cos(a) * 4.2, 7.2, Math.sin(a) * 4.2);
      s.target.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
      scene.add(s, s.target);
    }
    const top = new THREE.DirectionalLight(0xfff2e2, 2.2);
    top.position.set(0.5, 10, 1.5);
    top.castShadow = true;
    top.shadow.mapSize.set(2048, 2048);
    Object.assign(top.shadow.camera, { left: -11, right: 11, top: 3, bottom: -3, near: 1, far: 20 });
    top.shadow.bias = -0.0004;
    top.shadow.normalBias = 0.02;
    scene.add(top);
    for (const x of [-1, 1]) {
      const rim = new THREE.DirectionalLight(0xbcd2ff, 0.5);
      rim.position.set(x * 8, 2.5, -6);
      scene.add(rim);
    }
    scene.add(new THREE.HemisphereLight(0x0a0b10, 0x6b655c, 0.35));
  }
}

/** A pose facing `yawDeg` (0 = +Z, toward the default camera) with the root at (x, ·, z). */
function makePose(a: FighterActor, kind: string, x: number, z: number, yawDeg: number, southpaw: boolean): Pose {
  const p = kind === 't' ? tPose(a) : kind === 'relaxed' ? relaxedPose(a) : guardPose(a, southpaw);
  const qy = axisAngle([0, 1, 0], THREE.MathUtils.degToRad(yawDeg));
  const out = new Float32Array(4);
  mulQuat(out, 0, qy, 0, p.rootQuat, 0);
  p.rootQuat.set(out);
  const r = new THREE.Vector3(p.rootPos[0], p.rootPos[1], p.rootPos[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDeg));
  p.rootPos.set([r.x + x, r.y, r.z + z]);
  return p;
}

/** Fighting stance: bladed hips, bent knees, hands up, chin down (built at the origin facing +Z). */
function guardPose(a: FighterActor, southpaw: boolean): Pose {
  const rest = a.rest;
  const p = createPose();
  const s = southpaw ? -1 : 1; // +1: left side leads
  const x = 0;
  const hipY = rest.head[B.hips * 3 + 1];
  p.rootPos.set([x, hipY - 0.07, 0]);
  p.rootQuat.set(axisAngle([0, 1, 0], -0.42 * s));
  const set = (b: number, qq: Float32Array): void => { p.local.set(qq, b * 4); };
  const mul = (a1: Float32Array, b1: Float32Array): Float32Array => { const o = new Float32Array(4); mulQuat(o, 0, a1, 0, b1, 0); return o; };
  set(B.spine, axisAngle([1, 0, 0], 0.06));
  set(B.spine1, mul(axisAngle([0, 1, 0], 0.12 * s), axisAngle([1, 0, 0], 0.08)));
  set(B.spine2, mul(axisAngle([0, 1, 0], 0.1 * s), axisAngle([1, 0, 0], 0.07)));
  set(B.neck, axisAngle([0, 1, 0], 0.08 * s));
  set(B.head, mul(axisAngle([0, 1, 0], 0.1 * s), axisAngle([1, 0, 0], 0.16)));
  set(B.lShoulder, axisAngle([0, 1, 0], -0.18));
  set(B.rShoulder, axisAngle([0, 1, 0], 0.18));
  const w = createWorldPose();
  forwardKinematics(w, p, rest);
  const at = (b: number): [number, number, number] => [w.pos[b * 3], w.pos[b * 3 + 1], w.pos[b * 3 + 2]];
  const head = at(B.head);
  const W = (side: number, up: number, d: number): [number, number, number] => [side, up, d];
  const add = (a1: number[], b1: number[]): [number, number, number] => [a1[0] + b1[0], a1[1] + b1[1], a1[2] + b1[2]];
  const hipL = at(B.lUpLeg), hipR = at(B.rUpLeg);
  const floorAnkle = rest.head[B.lFoot * 3 + 1];
  const lead = s > 0 ? LIMBS.lLeg : LIMBS.rLeg, rear = s > 0 ? LIMBS.rLeg : LIMBS.lLeg;
  const leadHip = s > 0 ? hipL : hipR, rearHip = s > 0 ? hipR : hipL;
  solveTwoBone(p, w, rest, lead, [x + 0.1 * s, floorAnkle, 0.3], add(leadHip, W(0.12 * s, -0.3, 0.6)));
  solveTwoBone(p, w, rest, rear, [x - 0.2 * s, floorAnkle, -0.2], add(rearHip, W(-0.1 * s, -0.3, 0.6)));
  const leadArm = s > 0 ? LIMBS.lArm : LIMBS.rArm, rearArm = s > 0 ? LIMBS.rArm : LIMBS.lArm;
  const leadSh = at(s > 0 ? B.lArm : B.rArm), rearSh = at(s > 0 ? B.rArm : B.lArm);
  // Hands a little lower than a tight shell so the face reads in close-ups.
  solveTwoBone(p, w, rest, leadArm, add(head, W(0.1 * s, -0.16, 0.3)), add(leadSh, W(0.2 * s, -0.5, 0.05)));
  solveTwoBone(p, w, rest, rearArm, add(head, W(-0.14 * s, -0.15, 0.16)), add(rearSh, W(-0.2 * s, -0.5, 0.1)));
  forwardKinematics(w, p, rest);
  set(B.lHand, axisAngle([1, 0, 0], 1.1));
  set(B.rHand, axisAngle([1, 0, 0], 1.1));
  p.face[FACE.breathe] = 0.2;
  return p;
}

/** Standing tall between exchanges: arms down and slightly forward, fists loose. */
function relaxedPose(a: FighterActor): Pose {
  const rest = a.rest;
  const p = createPose();
  p.rootPos.set([0, rest.head[B.hips * 3 + 1] - 0.01, 0]);
  const set = (b: number, qq: Float32Array): void => { p.local.set(qq, b * 4); };
  set(B.head, axisAngle([1, 0, 0], 0.05));
  const w = createWorldPose();
  forwardKinematics(w, p, rest);
  const at = (b: number): [number, number, number] => [w.pos[b * 3], w.pos[b * 3 + 1], w.pos[b * 3 + 2]];
  for (const [limb, sh, side] of [[LIMBS.lArm, B.lArm, 1], [LIMBS.rArm, B.rArm, -1]] as const) {
    const s0 = at(sh);
    solveTwoBone(p, w, rest, limb, [s0[0] + 0.1 * side, s0[1] - 0.5, s0[2] + 0.12], [s0[0] + 0.25 * side, s0[1] - 0.3, s0[2] - 0.2]);
  }
  const hipL = at(B.lUpLeg), hipR = at(B.rUpLeg);
  const floorAnkle = rest.head[B.lFoot * 3 + 1];
  solveTwoBone(p, w, rest, LIMBS.lLeg, [hipL[0] + 0.06, floorAnkle, 0.02], [hipL[0] + 0.05, hipL[1] - 0.4, 0.4]);
  solveTwoBone(p, w, rest, LIMBS.rLeg, [hipR[0] - 0.06, floorAnkle, -0.02], [hipR[0] - 0.05, hipR[1] - 0.4, 0.4]);
  p.face[FACE.breathe] = 0.2;
  return p;
}

function tPose(a: FighterActor): Pose {
  const p = createPose();
  p.rootPos.set([0, a.rest.head[B.hips * 3 + 1], 0]);
  return p;
}

function buildUI(state: CharacterVisualState, actors: FighterActor[], poses: Pose[]): HTMLElement {
  const ui = document.getElementById('ui')!;
  const apply = (): void => { for (const a of actors) a.setVisualState(state); };
  const slider = (label: string, get: () => number, set: (v: number) => void): void => {
    const l = document.createElement('label');
    l.textContent = label;
    const r = document.createElement('input');
    r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.01'; r.value = String(get());
    r.oninput = () => { set(Number(r.value)); apply(); };
    l.appendChild(r);
    ui.appendChild(l);
  };
  slider('sweat', () => state.sweat, (v) => { state.sweat = v; });
  slider('flush', () => state.flush, (v) => { state.flush = v; });
  slider('damage', () => state.damageZones[0], (v) => { state.damageZones = new Array(8).fill(v); state.bloodOnGloves = v; });
  slider('swelling', () => state.swelling[0], (v) => { state.swelling = new Array(8).fill(v); });
  slider('fatigue', () => state.fatigue, (v) => { state.fatigue = v; });
  const face = (label: string, ch: number): void => slider(label, () => poses[0].face[ch], (v) => {
    poses.forEach((p, i) => { p.face[ch] = v; actors[i].applyPose(p); });
  });
  face('mouth open', FACE.mouthOpen);
  face('grimace', FACE.grimace);
  face('wince', FACE.wince);
  face('eyes closed L', FACE.eyesClosedL);
  const links = document.createElement('div');
  links.innerHTML = ['light=studio', 'light=arena', 'fighter=0&close=face', 'fighter=0&close=gloves', 'fighter=0&close=shorts', 'glove=boxing16oz',
    'board=distances', 'board=sweat', 'board=tones', 'board=faces', 'board=hair', 'board=detail', 'board=face', 'shot=wide', 'shot=cageside', 'shot=replay']
    .map((s) => `<a style="color:#e8b24a;margin-right:6px" href="?${s}">${s}</a>`).join(' ');
  ui.appendChild(links);
  return ui;
}

(q.has('board') || q.has('shot') ? venueBoard() : lineup()).catch((e) => {
  document.getElementById('stats')!.textContent = String(e?.stack ?? e);
  console.error(e);
});
