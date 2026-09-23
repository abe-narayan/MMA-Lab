/**
 * Arena dev harness: view any venue from broadcast presets with two placeholder
 * mannequins (capsules in a guard pose) and a referee dummy placed by the
 * arena's referee logic, so lighting can be judged on bodies, not just floors.
 *
 *   /dev/arena.html?arena=octagon_30&shot=wide|cageside|overhead|canvas|crowd|ref|jib
 *                  &quality=low|medium|high|ultra&event=knockdown|finish|none
 *                  &pose=standing|ground&hud=0&post=0&backend=webgl2
 *
 *   arena=none       the mannequins alone (a cost baseline)
 *   tex=0            procedural only (skip the CC0 texture downloads)
 *   tm=agx           AgX instead of the stage's ACES
 *   hide=a,b         hide set objects whose name starts with a prefix (arena.crowd, arena.haze, ...)
 *   bench=1          after warm-up, time back-to-back frames (min of 5 trials) into __stats.benchMs
 *   t=95             sim time to start at (crowd reactions are keyed to it)
 *
 * The renderer, tone mapping and bloom here are a local stand-in for the stage
 * module's pipeline (ACES filmic, exposure 1, light bloom), only for judging the set.
 */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ARENAS, type ArenaId, type SimEvent, type TickSnapshot } from '../src/sim';
import type { FrameInput, QualitySettings } from '../src/presentation/contract';
import { createVenue, createVenueAsync } from '../src/presentation/arena';
import { QUALITY_PRESETS } from '../src/presentation/stage/quality';
import { B, BONE_COUNT, createWorldPose, type WorldPose } from '../src/presentation/rig/skeleton';

const qs = new URLSearchParams(location.search);
const arenaId = (qs.get('arena') ?? 'octagon_30') as ArenaId;
const arena = ARENAS[arenaId] ?? ARENAS.octagon_30;
const shot = qs.get('shot') ?? 'wide';
const level = (qs.get('quality') ?? 'high') as QualitySettings['level'];
const eventKind = qs.get('event') ?? 'none';
const poseKind = qs.get('pose') ?? 'standing';
const hudOn = qs.get('hud') !== '0';
const postOn = qs.get('post') !== '0';
const forceWebGL = qs.get('backend') === 'webgl2';
const perf = qs.get('perf') === '1';
const noArena = qs.get('arena') === 'none';

// The stage's canonical presets; the dev page renders at scale 1 (no TAAU here).
const PRESETS: Record<QualitySettings['level'], QualitySettings> = {
  low: { ...QUALITY_PRESETS.low, renderScale: 1 },
  medium: { ...QUALITY_PRESETS.medium, renderScale: 1 },
  high: { ...QUALITY_PRESETS.high, renderScale: 1 },
  ultra: { ...QUALITY_PRESETS.ultra, renderScale: 1 },
};
const quality = PRESETS[level] ?? PRESETS.high;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGPURenderer({ antialias: !perf, forceWebGL, trackTimestamp: perf });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
// Match the stage's output transform (ACES filmic, exposure 1); ?tm=agx for comparison.
renderer.toneMapping = qs.get('tm') === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = quality.shadows !== 'off';
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();
const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 400);

const t0 = performance.now();
const venue = qs.get('tex') === '0'
  ? createVenue(arena, quality, { cosmeticSeed: 'dev-bout-001', cornerColours: ['#c0161d', '#1d56b0'] })
  : await createVenueAsync(arena, quality, { cosmeticSeed: 'dev-bout-001', cornerColours: ['#c0161d', '#1d56b0'] });
const buildMs = performance.now() - t0;
if (!noArena) scene.add(venue.object3d);
const hide = (qs.get('hide') ?? '').split(',').filter(Boolean);
const applyHide = () => venue.object3d.traverse((o) => { if (hide.some((h) => o.name.startsWith(h))) o.visible = false; });
applyHide();
if (qs.get('haze') === '0') venue.object3d.traverse((o) => { if (o.name.startsWith('arena.haze')) o.visible = false; });
scene.environment = qs.get('env') === '0' ? null : venue.environment;

// ---------------------------------------------------------------------------
// Mannequins
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
interface Joints { [k: string]: V3 }

/** Orthodox guard, fighter-local (+z forward), metres. */
function guardJoints(): Joints {
  return {
    hips: [0, 0.97, 0], chest: [0, 1.3, 0.03], neck: [0, 1.5, 0.05], head: [0, 1.63, 0.08],
    lSh: [-0.19, 1.43, 0.02], rSh: [0.19, 1.43, -0.02], lEl: [-0.27, 1.2, 0.2], rEl: [0.26, 1.18, 0.1],
    lHa: [-0.13, 1.48, 0.33], rHa: [0.12, 1.47, 0.22], lHip: [-0.1, 0.93, 0.02], rHip: [0.1, 0.93, -0.02],
    lKn: [-0.16, 0.5, 0.26], rKn: [0.15, 0.5, -0.16], lAn: [-0.18, 0.08, 0.3], rAn: [0.18, 0.08, -0.3],
    lToe: [-0.19, 0.03, 0.46], rToe: [0.22, 0.03, -0.16],
  };
}
/** Bottom fighter on his back (guard), fighter-local. */
function groundJoints(top: boolean): Joints {
  if (top) {
    return {
      hips: [0, 0.62, -0.1], chest: [0, 0.78, 0.2], neck: [0, 0.82, 0.42], head: [0, 0.78, 0.55],
      lSh: [-0.2, 0.83, 0.3], rSh: [0.2, 0.83, 0.3], lEl: [-0.3, 0.45, 0.42], rEl: [0.3, 0.45, 0.42],
      lHa: [-0.22, 0.2, 0.62], rHa: [0.2, 0.22, 0.66], lHip: [-0.12, 0.6, -0.1], rHip: [0.12, 0.6, -0.1],
      lKn: [-0.25, 0.08, 0.05], rKn: [0.25, 0.08, 0.05], lAn: [-0.25, 0.08, -0.4], rAn: [0.25, 0.08, -0.4],
      lToe: [-0.25, 0.03, -0.55], rToe: [0.25, 0.03, -0.55],
    };
  }
  return {
    hips: [0, 0.14, 0], chest: [0, 0.16, -0.35], neck: [0, 0.14, -0.58], head: [0, 0.14, -0.72],
    lSh: [-0.2, 0.16, -0.5], rSh: [0.2, 0.16, -0.5], lEl: [-0.3, 0.35, -0.35], rEl: [0.3, 0.35, -0.35],
    lHa: [-0.12, 0.45, -0.22], rHa: [0.12, 0.45, -0.2], lHip: [-0.11, 0.14, 0], rHip: [0.11, 0.14, 0],
    lKn: [-0.35, 0.55, 0.3], rKn: [0.35, 0.55, 0.3], lAn: [-0.3, 0.45, 0.65], rAn: [0.3, 0.45, 0.65],
    lToe: [-0.3, 0.5, 0.8], rToe: [0.3, 0.5, 0.8],
  };
}

const skin = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color('#b77a58'), roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.3 });
const skin2 = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color('#e0b08e'), roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.3 });
const glove = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color('#111113'), roughness: 0.4, clearcoat: 0.5 });

function mannequin(j: Joints, skinMat: THREE.Material, shorts: string, refShirt = false): THREE.Group {
  const g = new THREE.Group();
  const shortsMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(shorts), roughness: 0.75 });
  const shirtMat = refShirt ? new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#2d3440'), roughness: 0.8 }) : null;
  const trousers = refShirt ? new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#0d0d10'), roughness: 0.8 }) : null;
  const seg = (a: V3, b: V3, r: number, m: THREE.Material) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 12);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const ball = (p: V3, r: number, m: THREE.Material, sy = 1) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
    mesh.position.set(...p);
    mesh.scale.set(1, sy, 1.05);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const torso = shirtMat ?? skinMat;
  seg(j.hips!, j.chest!, 0.14, torso);
  seg(j.lSh!, j.rSh!, 0.075, torso);
  seg(j.chest!, j.neck!, 0.06, skinMat);
  ball(j.head!, 0.105, skinMat, 1.18);
  seg(j.lSh!, j.lEl!, 0.052, torso);
  seg(j.rSh!, j.rEl!, 0.052, torso);
  seg(j.lEl!, j.lHa!, 0.043, skinMat);
  seg(j.rEl!, j.rHa!, 0.043, skinMat);
  if (!refShirt) { ball(j.lHa!, 0.062, glove); ball(j.rHa!, 0.062, glove); }
  seg(j.lHip!, j.rHip!, 0.12, trousers ?? shortsMat);
  const mid = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  seg(j.lHip!, mid(j.lHip!, j.lKn!, 0.55), 0.085, trousers ?? shortsMat);
  seg(j.rHip!, mid(j.rHip!, j.rKn!, 0.55), 0.085, trousers ?? shortsMat);
  seg(mid(j.lHip!, j.lKn!, 0.55), j.lKn!, 0.07, trousers ?? skinMat);
  seg(mid(j.rHip!, j.rKn!, 0.55), j.rKn!, 0.07, trousers ?? skinMat);
  seg(j.lKn!, j.lAn!, 0.052, trousers ?? skinMat);
  seg(j.rKn!, j.rAn!, 0.052, trousers ?? skinMat);
  seg(j.lAn!, j.lToe!, 0.04, refShirt ? trousers! : skinMat);
  seg(j.rAn!, j.rToe!, 0.04, refShirt ? trousers! : skinMat);
  return g;
}

interface Placed { group: THREE.Group; joints: Joints; x: number; z: number; yaw: number }
const ground = poseKind === 'ground';
const fighters: Placed[] = [
  { joints: ground ? groundJoints(true) : guardJoints(), x: ground ? 0.2 : -0.95, z: ground ? 0.55 : 0.35, yaw: ground ? Math.PI : Math.PI / 2 - 0.15, group: new THREE.Group() },
  { joints: ground ? groundJoints(false) : guardJoints(), x: ground ? 0.2 : 0.95, z: ground ? 0.1 : -0.2, yaw: ground ? 0 : -Math.PI / 2 - 0.1, group: new THREE.Group() },
];
fighters[0]!.group = mannequin(fighters[0]!.joints, skin, '#b3161c');
fighters[1]!.group = mannequin(fighters[1]!.joints, skin2, '#1b4f9c');
for (const f of fighters) {
  f.group.position.set(f.x, 0, f.z);
  f.group.rotation.y = f.yaw;
  scene.add(f.group);
}
const refJ = guardJoints();
// Referee stands tall, hands low.
refJ.lHa = [-0.25, 0.95, 0.12]; refJ.rHa = [0.25, 0.95, 0.12]; refJ.lEl = [-0.27, 1.18, 0.02]; refJ.rEl = [0.27, 1.18, 0.02];
refJ.lKn = [-0.12, 0.5, 0.04]; refJ.rKn = [0.12, 0.5, -0.02]; refJ.lAn = [-0.13, 0.08, 0.02]; refJ.rAn = [0.13, 0.08, -0.04];
refJ.lToe = [-0.14, 0.03, 0.17]; refJ.rToe = [0.14, 0.03, 0.12];
const refGroup = mannequin(refJ, skin2, '#101010', true);
scene.add(refGroup);

/** Fill a WorldPose's bones from mannequin joints (only the bones the arena reads). */
function worldPoseOf(p: Placed): WorldPose {
  const w = createWorldPose();
  const m = new THREE.Matrix4().makeRotationY(p.yaw).setPosition(p.x, 0, p.z);
  const set = (bone: number, j: V3) => {
    const v = new THREE.Vector3(...j).applyMatrix4(m);
    w.pos.set([v.x, v.y, v.z], bone * 3);
  };
  const J = p.joints;
  set(B.hips, J.hips!); set(B.spine1, J.chest!); set(B.spine2, J.chest!); set(B.head, J.head!);
  set(B.lLeg, J.lKn!); set(B.rLeg, J.rKn!); set(B.lFoot, J.lAn!); set(B.rFoot, J.rAn!);
  set(B.lHand, J.lHa!); set(B.rHand, J.rHa!);
  void BONE_COUNT;
  return w;
}
const poses = fighters.map(worldPoseOf);

// ---------------------------------------------------------------------------
// A fake frame and event list
// ---------------------------------------------------------------------------

function fighterSnap(id: number, p: Placed): TickSnapshot['fighters'][number] {
  return {
    id, team: id, x: p.x, z: p.z, facing: p.yaw, vx: 0, vz: 0, stance: 'orthodox', leadFoot: 0, againstFence: false,
    fenceNormalAngle: 0, posture: ground ? 'ground' : 'standing', position: 'standing_neutral' as never,
    role: ground ? (id === 0 ? 'top' : 'bottom') : 'none', partnerId: ground ? 1 - id : null, action: 'idle', actionPhase: 0,
    actionStage: 'none', actionResult: 'none', defence: 'none' as never,
    actionDetail: { startTick: 0, totalMs: 0, contactTick: 0, contactOffsetMs: 0, target: 'none', subLocation: null, side: 'L', targetId: null, forceNorm: 0, direction: 'front' },
    defenceDetail: { phase: 1, side: 'both' }, stamina: { total: 1, burst: 1 }, damage: { head: 0, body: 0, legs: 0, cut: 0 },
    state: 0, states: [], balance: 1, sub: { technique: null, stage: 0, progress: 0 }, sig: { landed: 0, attempted: 0 },
    intentTag: '', grips: [],
    contacts: { footL: true, footR: true, kneeL: false, kneeR: false, handL: false, handR: false, hipL: false, hipR: false, back: false, chest: false, fence: false },
    damageVisual: { zones: [0, 0, 0, 0, 0, 0, 0, 0], swelling: [0, 0, 0, 0, 0, 0, 0, 0], cuts: [], bloodOnGloves: 0 },
    fatigueVisual: { f: 0, breathingRate: 0, handsDrop: 0, flatFeet: 0, chinUp: 0 },
  };
}

let simTime = Number(qs.get('t') ?? 95);
const events: SimEvent[] = [];
const evAt = (kind: SimEvent['kind'], t: number): SimEvent => ({
  tick: Math.floor(t * 10), subMs: 0, round: 1, kind, actor: 0, target: 1, text: '', detail: {},
} as SimEvent);
if (eventKind === 'knockdown') events.push(evAt('knockdown', simTime - 1.2));
if (eventKind === 'finish') events.push(evAt('knockdown', simTime - 3), evAt('refereeStoppage', simTime - 1.5));

function frameAt(t: number): FrameInput {
  const snap: TickSnapshot = {
    v: 4, tick: Math.floor(t * 10), t, round: 1, roundTime: t, phase: 'round',
    fighters: fighters.map((p, i) => fighterSnap(i, p)),
    engagements: ground ? [{ a: 0, b: 1, node: 'closed_guard' as never, sinceTick: 0, kind: 'ground', cage: false, underhookOwner: null, kuzushi: { dir: 0, mag: 0 }, posture: 'postured', inflight: null, rootX: 0.2, rootZ: 0.3, rootYaw: 0 }] : [],
    referee: { state: eventKind === 'finish' ? 'stopping' : 'watching', target: 1 },
    score: { hidden: true },
  };
  return { frame: snap, next: null, alpha: 0, simTime: t, events, playbackRate: 1, replay: false, discontinuity: false };
}

// ---------------------------------------------------------------------------
// Camera presets
// ---------------------------------------------------------------------------

const k = venue.kind;
const stageScale = arena.shape === 'polygon' ? (arena.apothemM ?? 4.57) / 4.57 : arena.shape === 'square' ? (arena.halfWidthM ?? 3) / 3.3 : 1;
function setShot(name: string): void {
  let pos: V3 = [0, 6.2, 13.5];
  let tgt: V3 = [0, 0.7, 0];
  let fov = 36;
  if (k === 'street') { pos = [1.5, 3.2, 10.5]; tgt = [0, 0.9, 0]; fov = 42; }
  if (k === 'mat') { pos = [0, 7.5, 14]; tgt = [0, 0.4, 0]; fov = 42; }
  switch (name) {
    case 'cageside': pos = k === 'street' ? [2.2, 1.6, 4.6] : [1.2 * stageScale, 2.55, 6.2 * stageScale]; tgt = [0, 1.0, 0]; fov = 34; break;
    case 'overhead': pos = [0, 14, 0.01]; tgt = [0, 0, 0]; fov = 52; break;
    case 'canvas': pos = [1.6, 0.9, 2.6]; tgt = [0.2, 0.2, 0]; fov = 55; break;
    case 'crowd': pos = [0, 2.2, -3]; tgt = [2, 3.5, 20]; fov = 62; break;
    case 'ref': pos = [3.5, 1.7, 3.5]; tgt = [0, 1.1, 0]; fov = 50; break;
    case 'jib': pos = [-9, 9, 9]; tgt = [0, 0.5, 0]; fov = 40; break;
    default: if (k !== 'street' && k !== 'mat') { pos = [0, 6.2 * stageScale, 13.5 * stageScale]; }
  }
  camera.position.set(...pos);
  camera.lookAt(...tgt);
  camera.fov = fov;
  camera.updateProjectionMatrix();
}
setShot(shot);
(window as unknown as { __cam: (s: string) => void }).__cam = setShot;

// ---------------------------------------------------------------------------
// Post (local stand-in) and loop
// ---------------------------------------------------------------------------

let pipeline: THREE.RenderPipeline | null = null;
if (postOn && quality.bloom) {
  pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const col = scenePass.getTextureNode('output');
  pipeline.outputNode = col.add(bloom(col, 0.18, 0.35, 1.2));
}

const hud = document.getElementById('hud')!;
if (!hudOn) hud.classList.add('hidden');
let frames = 0;
const gpuSamples: number[] = [];
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
let total = 0;
let acc = 0;
let last = performance.now();
let fps = 0;
const info = renderer.info as unknown as { render: { drawCalls: number; triangles: number } };

function tick(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  simTime += dt;
  const input = frameAt(simTime);
  venue.update(input, poses, dt);
  const r = venue.referee;
  if (r) {
    refGroup.visible = true;
    refGroup.position.set(r.x, 0, r.z);
    refGroup.rotation.y = r.facing;
    refGroup.scale.y = 1 - r.crouch * 0.25;
  } else refGroup.visible = false;
  if (hide.length) applyHide();
  if (pipeline) pipeline.render(); else renderer.render(scene, camera);
  if (perf && total > 30) {
    void renderer.resolveTimestampsAsync('render').then((ms) => {
      if (typeof ms === 'number' && ms > 0) { gpuSamples.push(ms); if (gpuSamples.length > 120) gpuSamples.shift(); }
    });
  }
  frames++;
  total++;
  acc += dt;
  if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
  const s = venue.stats();
  const stats = {
    backend, arena: arena.id, shot, quality: quality.level, fps: Math.round(fps), drawCalls: info.render.drawCalls,
    triangles: info.render.triangles, setTriangles: s.triangles, setDraws: s.drawCalls, crowdFigures: s.crowdFigures,
    buildMs: Math.round(buildMs), benchMs: benchMs === null ? undefined : +benchMs.toFixed(2), gpuMs: perf ? +median(gpuSamples).toFixed(2) : undefined, gpuN: gpuSamples.length, crowd: venue.crowd, referee: r && { x: +r.x.toFixed(2), z: +r.z.toFixed(2), g: r.gesture },
  };
  (window as unknown as { __stats: unknown }).__stats = stats;
  if (hudOn) hud.textContent = JSON.stringify(stats, null, 1).replace(/[{}"]/g, '');
  if (qs.get('bench') === '1' && total === 90) void (window as unknown as { __bench: (n: number) => Promise<number> }).__bench(60);
  if (total > 20) (window as unknown as { __ready: boolean }).__ready = true;
  requestAnimationFrame(tick);
}
/**
 * GPU throughput benchmark: render `n` frames back to back, wait for the GPU
 * queue to drain, report wall ms per frame (vsync-free, includes shadow pass).
 */
let benchMs: number | null = null;
(window as unknown as { __bench: (n: number) => Promise<number> }).__bench = async (n: number) => {
  const device = (renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
  const drain = async () => { if (device) await device.queue.onSubmittedWorkDone(); else await new Promise((r) => setTimeout(r, 50)); };
  for (let i = 0; i < 5; i++) renderer.render(scene, camera);
  await drain();
  // Minimum of five trials: other processes share the GPU, the minimum is the
  // closest to this scene's own cost.
  let best = Infinity;
  for (let trial = 0; trial < 5; trial++) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.render(scene, camera);
    await drain();
    best = Math.min(best, (performance.now() - t0) / n);
  }
  benchMs = best;
  (window as unknown as { __benchDone: boolean }).__benchDone = true;
  return benchMs;
};
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
camera.aspect = innerWidth / innerHeight;
camera.updateProjectionMatrix();
requestAnimationFrame(tick);
