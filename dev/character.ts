/**
 * Character lookdev: the 15 archetypes in a guard pose under a studio light or a hard arena top
 * light. Query parameters (all optional):
 *
 *   light=studio|arena   sweat=0..1  flush=0..1  damage=0..1  swell=0..1  cuts=0|1  blood=0|1
 *   tone=0..1 (override every fighter)   face=0..9   hair=<style>   glove=mma4oz|boxing10oz|boxing16oz|grappling|bare
 *   fighter=<index>  (show one)   close=face|gloves|shorts|body   lod=0..3   pose=guard|t
 *   yaw=<deg> pitch=<deg> dist=<m>  (camera orbit)   clean=1 (hide UI)   backend=webgl2
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ARCHETYPES, ARENAS, deriveRuntime, resolveParams, type FighterDefinition } from '../src/sim';
import type { BoutPresentation, CharacterVisualState, GloveKind, QualitySettings } from '../src/presentation/contract';
import { createCharacterFactory, FighterActor } from '../src/presentation/character';
import {
  B, createPose, createWorldPose, forwardKinematics, FACE, type Pose,
} from '../src/presentation/rig/skeleton';
import { LIMBS, solveTwoBone, axisAngle } from '../src/presentation/rig/ik';
import { mulQuat } from '../src/presentation/rig/skeleton';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
if (q.get('clean') === '1') document.body.classList.add('clean');

const QUALITY: QualitySettings = {
  level: 'high', renderScale: 1, upscale: 'none', antialias: 'fxaa', maxPixelRatio: 1.5, shadows: 'soft',
  shadowMapSize: 2048, ambientOcclusion: false, screenSpaceReflections: false, bloom: false,
  replayDepthOfField: false, replayMotionBlur: false, skinScattering: q.get('sss') !== '0', sweatAndDamage: true,
  crowd: 'off', crowdCount: 0, maxCharacterLOD: 0,
};

// Lookdev variety: the archetypes all ship the same default appearance, so the page dresses them
// (this is presentation-side test data only; the sim definitions are never modified).
const LOOKS: { tone: number; face: number; hair: string; colour: string; facial: string; tattoos?: string[]; kit?: [string, string] }[] = [
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

function dress(def: FighterDefinition, i: number): FighterDefinition {
  const L = LOOKS[i % LOOKS.length];
  const tone = q.has('tone') ? num('tone', 0.5) : L.tone;
  return {
    ...def,
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

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: q.get('backend') === 'webgl2' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  const light = q.get('light') ?? 'arena';
  setupLights(scene, renderer, light);

  const all = Object.values(ARCHETYPES);
  const pick = q.has('fighters') ? q.get('fighters')!.split(',').map((i) => all[Number(i) % all.length])
    : q.has('fighter') ? [all[num('fighter', 0) % all.length]] : all;
  const params = resolveParams();
  const defs = pick.map((d) => dress(d, all.indexOf(d)));
  const glove = (q.get('glove') ?? 'mma4oz') as GloveKind;
  const bout: BoutPresentation = {
    fighters: defs,
    runtimes: defs.map((d) => deriveRuntime(d, params, { explain: false })),
    teamOf: defs.map((_, i) => i % 2),
    arena: ARENAS.octagon_30,
    rulesetId: glove.startsWith('boxing') ? 'boxing' : 'mma.unified',
    glove,
    cornerColours: defs.map((_, i) => (i % 2 ? '#1d4fb8' : '#c01824')),
    blood: q.get('blood') !== '0',
    cosmeticSeed: 'lookdev',
  };

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
    const pose = q.get('pose') === 't' ? tPose(a, x) : guardPose(a, x, defs[i].body.stance === 'southpaw');
    pose.face[FACE.mouthOpen] = num('mouth', 0);
    pose.face[FACE.grimace] = num('grimace', 0);
    pose.face[FACE.wince] = num('wince', 0);
    poses.push(pose);
    a.applyPose(pose);
    a.setLOD(num('lod', 0) as 0);
  }
  const buildMs = actors.map((a) => a.buildMs);

  const state: CharacterVisualState = {
    sweat: num('sweat', 0.25), flush: num('flush', 0.2),
    damageZones: new Array(8).fill(num('damage', 0)), swelling: new Array(8).fill(num('swell', num('damage', 0) * 0.8)),
    cuts: q.get('cuts') === '1' ? [
      { site: 'brow_L', severity: 2, bleeding: true, ageS: 25 },
      { site: 'nose_bridge', severity: 1, bleeding: false, ageS: 60 },
      { site: 'cheek_R', severity: 1, bleeding: true, ageS: 8 },
    ] : [],
    bloodOnGloves: num('damage', 0), blood: q.get('blood') !== '0', fatigue: 0.3,
  };
  const ui = buildUI(state, actors, poses);
  for (const a of actors) a.setVisualState(state);

  // Camera.
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

  const stats = document.getElementById('stats')!;
  let frames = 0;
  let last = performance.now();
  let fpsAcc = 0;
  const tris = actors.map((a) => Math.round(a.triangles()));
  const tick = (): void => {
    controls.update();
    renderer.render(scene, camera);
    frames++;
    const now = performance.now();
    fpsAcc += now - last;
    last = now;
    if (frames % 30 === 0) {
      const ms = fpsAcc / 30;
      fpsAcc = 0;
      const info = renderer.info.render;
      stats.textContent = `${renderer.backend.constructor.name}  ${ms.toFixed(1)} ms/frame  calls ${info.drawCalls}  tris ${info.triangles}\n` +
        `preload ${tPreload.toFixed(0)} ms  build/fighter ${avg(buildMs).toFixed(0)} ms (max ${Math.max(...buildMs).toFixed(0)})  LOD0 tris/fighter ${Math.max(...tris)}`;
      (window as unknown as { __stats: unknown }).__stats = {
        backend: renderer.backend.constructor.name, frameMs: ms, drawCalls: info.drawCalls, triangles: info.triangles,
        preloadMs: tPreload, buildMs: avg(buildMs), buildMaxMs: Math.max(...buildMs), trisPerFighter: Math.max(...tris),
      };
    }
    if (frames === 20) (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(tick);
  };
  void ui;
  tick();
}

const avg = (a: number[]): number => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

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
    // Arena: very dark surround, hard overhead key ring (5600 K), cool rims, faint canvas bounce.
    scene.background = new THREE.Color(0x020203);
    scene.environmentIntensity = 0.12;
    floorMat.color.set(0x9a958d);
    const ring = 4;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + 0.6;
      const s = new THREE.SpotLight(0xfff6ea, 95, 22, THREE.MathUtils.degToRad(38), 0.5, 2);
      s.position.set(Math.cos(a) * 4.2, 7.2, Math.sin(a) * 4.2);
      s.target.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
      s.castShadow = false;
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0005;
      s.shadow.normalBias = 0.02;
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
    const bounce = new THREE.HemisphereLight(0x0a0b10, 0x6b655c, 0.35);
    scene.add(bounce);
  }
}

/** Fighting stance: bladed hips, bent knees, hands up, chin down. */
function guardPose(a: FighterActor, x: number, southpaw: boolean): Pose {
  const rest = a.rest;
  const p = createPose();
  const s = southpaw ? -1 : 1; // +1: left side leads
  const hipY = rest.head[B.hips * 3 + 1];
  p.rootPos.set([x, hipY - 0.07, 0]);
  const blade = axisAngle([0, 1, 0], -0.42 * s);
  p.rootQuat.set(blade);
  const set = (b: number, qq: Float32Array): void => { p.local.set(qq, b * 4); };
  const mul = (a1: Float32Array, b1: Float32Array): Float32Array => { const o = new Float32Array(4); mulQuat(o, 0, a1, 0, b1, 0); return o; };
  set(B.spine, axisAngle([1, 0, 0], 0.06));
  set(B.spine1, mul(axisAngle([0, 1, 0], 0.12 * s), axisAngle([1, 0, 0], 0.08)));
  set(B.spine2, mul(axisAngle([0, 1, 0], 0.1 * s), axisAngle([1, 0, 0], 0.07)));
  set(B.neck, axisAngle([0, 1, 0], 0.08 * s));
  set(B.head, mul(axisAngle([0, 1, 0], 0.1 * s), axisAngle([1, 0, 0], 0.16)));
  // Shoulders roll forward and up a little (a guard hunches).
  set(B.lShoulder, axisAngle([0, 1, 0], -0.18));
  set(B.rShoulder, axisAngle([0, 1, 0], 0.18));
  const w = createWorldPose();
  forwardKinematics(w, p, rest);
  const at = (b: number): [number, number, number] => [w.pos[b * 3], w.pos[b * 3 + 1], w.pos[b * 3 + 2]];
  const head = at(B.head);
  // Offsets in world axes (the opponent is toward +Z, the camera).
  const W = (side: number, up: number, d: number): [number, number, number] => [side, up, d];
  const add = (a1: number[], b1: number[]): [number, number, number] => [a1[0] + b1[0], a1[1] + b1[1], a1[2] + b1[2]];
  // Feet: lead foot forward and slightly in, rear foot back and out; knees soft and out.
  const hipL = at(B.lUpLeg), hipR = at(B.rUpLeg);
  const floorAnkle = rest.head[B.lFoot * 3 + 1];
  const lead = s > 0 ? LIMBS.lLeg : LIMBS.rLeg, rear = s > 0 ? LIMBS.rLeg : LIMBS.lLeg;
  const leadHip = s > 0 ? hipL : hipR, rearHip = s > 0 ? hipR : hipL;
  solveTwoBone(p, w, rest, lead, [x + 0.1 * s, floorAnkle, 0.3], add(leadHip, W(0.12 * s, -0.3, 0.6)));
  solveTwoBone(p, w, rest, rear, [x - 0.2 * s, floorAnkle, -0.2], add(rearHip, W(-0.1 * s, -0.3, 0.6)));
  // Hands: lead fist out in front of the chin, rear fist by the cheek; elbows tucked.
  const leadArm = s > 0 ? LIMBS.lArm : LIMBS.rArm, rearArm = s > 0 ? LIMBS.rArm : LIMBS.lArm;
  const leadSh = at(s > 0 ? B.lArm : B.rArm), rearSh = at(s > 0 ? B.rArm : B.lArm);
  solveTwoBone(p, w, rest, leadArm, add(head, W(0.06 * s, -0.07, 0.3)), add(leadSh, W(0.2 * s, -0.5, 0.05)));
  solveTwoBone(p, w, rest, rearArm, add(head, W(-0.09 * s, -0.06, 0.13)), add(rearSh, W(-0.2 * s, -0.5, 0.1)));
  forwardKinematics(w, p, rest);
  // Turn the fists: knuckles toward the opponent, palms in.
  set(B.lHand, axisAngle([1, 0, 0], 1.1));
  set(B.rHand, axisAngle([1, 0, 0], 1.1));
  p.face[FACE.breathe] = 0.2;
  return p;
}

function tPose(a: FighterActor, x: number): Pose {
  const p = createPose();
  p.rootPos.set([x, a.rest.head[B.hips * 3 + 1], 0]);
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
  const face = (label: string, ch: number): void => slider(label, () => poses[0].face[ch], (v) => {
    poses.forEach((p, i) => { p.face[ch] = v; actors[i].applyPose(p); });
  });
  face('mouth open', FACE.mouthOpen);
  face('grimace', FACE.grimace);
  face('wince', FACE.wince);
  face('eyes closed L', FACE.eyesClosedL);
  const links = document.createElement('div');
  links.innerHTML = ['light=studio', 'light=arena', 'fighter=0&close=face', 'fighter=0&close=gloves', 'fighter=0&close=shorts', 'glove=boxing16oz']
    .map((s) => `<a style="color:#e8b24a;margin-right:6px" href="?${s}">${s}</a>`).join(' ');
  ui.appendChild(links);
  return ui;
}

main().catch((e) => {
  document.getElementById('stats')!.textContent = String(e?.stack ?? e);
  console.error(e);
});
