/**
 * CAMERA DIRECTOR DEV PAGE — a real simulated bout, a stand-in set (floor,
 * fence from the arena geometry, capsule fighters), the broadcast director
 * live, the graphics package on top, and the edit on a timeline.
 *
 * URL parameters:
 *   seed=<s> a=<archetype id> b=<archetype id> arena=<arena id>
 *   t=<sim seconds>         seek there (paused) with the camera settled
 *   pre=<s>                 rest on the opening frame for s seconds (the intro)
 *   post=<s>                rest on the final frame for s seconds (the result)
 *   replay=<i>&seg=<j>&p=<0..1>   show replay plan i, angle j, at progress p
 *   mode=<broadcast|cageside|overhead|follow|orbit|free>  lock=<shot kind>
 *   ui=0                    clean feed (no dev bar)   play=1   autoplay
 *   label=1                 shot label on cuts
 *
 * window.__ready is set once the requested moment is on screen.
 */
import * as THREE from 'three';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ARCHETYPES, DEFAULT_SETTINGS, resolveRuleset, type SimConfig, type TickSnapshot } from '../src/sim';
import { loadWatchBout } from '../src/app/replay/bout';
import { BoutPlayer } from '../src/app/replay/player';
import { buildBoutPresentation } from '../src/presentation/stage/bout';
import type { ArenaSet, CameraMode, CameraState, FrameInput } from '../src/presentation/contract';
import {
  createCameraDirector, makeCameraArena, planReplays, ReplaySequencer, segmentRequest, SHOTS, TICK_S,
  attachFreeCamera, fighterPoints, standInWorldPose, wallDistanceAt, postAzimuths, type FighterPoints,
  type ReplayPlan, type ShotKind,
} from '../src/presentation/camera';
import { BroadcastOverlay, makeBroadcastBout } from '../src/app/components/broadcast';
import { createWorldPose, type WorldPose } from '../src/presentation/rig/skeleton';

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: unknown;
    __seek?: (t: number) => void;
    __cam?: (m: string) => void;
    __replay?: (i: number) => void;
  }
}

const q = new URLSearchParams(location.search);
const num = (k: string): number | null => (q.has(k) ? Number(q.get(k)) : null);
const ui = q.get('ui') !== '0';

// ---------------------------------------------------------------------------
// The bout
// ---------------------------------------------------------------------------

const archetypes = Object.values(ARCHETYPES);
const pick = (id: string | null, i: number) => archetypes.find((a) => a.id === id) ?? archetypes[i];
const config: SimConfig = {
  seed: q.get('seed') ?? 'watch-demo',
  mode: '1v1',
  fighters: [pick(q.get('a'), 0), pick(q.get('b'), 1)],
  teams: { teamOf: [0, 1] },
  ruleset: 'mma.unified.3r',
  arena: (q.get('arena') as SimConfig['arena']) ?? 'octagon_30',
  settings: DEFAULT_SETTINGS,
};
const bout = loadWatchBout(config);
const frames = bout.run.frames;
const events = bout.run.events;
const pres = buildBoutPresentation({ config, fighters: bout.fighters, runtimes: bout.runtimes });
const rs = resolveRuleset(config.ruleset);
const lastT = frames[frames.length - 1].t;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const stageEl = document.getElementById('stage') as HTMLDivElement;
const devEl = document.getElementById('dev') as HTMLDivElement;
if (!ui) devEl.classList.add('hidden');
const DEV_H = 128;

function layout(): { w: number; h: number } {
  const availH = window.innerHeight - (ui ? DEV_H : 0);
  let h = availH;
  let w = Math.round((h * 16) / 9);
  if (w > window.innerWidth) {
    w = window.innerWidth;
    h = Math.round((w * 9) / 16);
  }
  stageEl.style.width = `${w}px`;
  stageEl.style.height = `${h}px`;
  return { w, h };
}

// ---------------------------------------------------------------------------
// Stand-in set
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stageEl.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050608');
scene.fog = new THREE.Fog('#050608', 18, 42);
const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 200);

const ca = makeCameraArena(pres.arena, null);
const bounds: ArenaSet['bounds'] = { fightRadiusM: ca.circumradius, outerRadiusM: ca.circumradius + 7, ceilingM: 14 };
const arenaSet = { bounds } as ArenaSet;

function wallPoints(y: number, extra = 0, n = 64): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const posts = postAzimuths(ca);
  const list = posts.length ? posts : Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2);
  for (const a of list) {
    const r = (posts.length ? ca.circumradius : wallDistanceAt(ca, a)) + extra;
    pts.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
  }
  return pts;
}

function polygonShape(r: number): THREE.Shape {
  const pts = wallPoints(0, r - ca.circumradius);
  // Shape lives in (x, y); we lay it flat by rotating -90° about X, which maps y -> -z.
  return new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
}

function buildSet(): void {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#0c0d10', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  if (ca.shape !== 'unbounded') {
    const apron = new THREE.Mesh(new THREE.ShapeGeometry(polygonShape(ca.circumradius + 1.3)), new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.9 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = 0.004;
    scene.add(apron);
    const canvasMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.85 });
    const canvasMesh = new THREE.Mesh(new THREE.ShapeGeometry(polygonShape(ca.circumradius)), canvasMat);
    canvasMesh.rotation.x = -Math.PI / 2;
    canvasMesh.position.y = 0.01;
    canvasMesh.receiveShadow = true;
    scene.add(canvasMesh);
    // Centre mark.
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.22, 96), new THREE.MeshBasicMaterial({ color: '#b08a3a' }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    scene.add(ring);

    // Fence: posts, pads, chain-link panels, top rail.
    const tex = chainLinkTexture();
    const posts = wallPoints(0);
    const h = ca.wallHeight || 1.95;
    const postMat = new THREE.MeshStandardMaterial({ color: '#101114', roughness: 0.6 });
    const padMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.8 });
    const railMat = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.5 });
    const meshMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 });
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h + 0.12, 12), postMat);
      post.position.set(p.x, (h + 0.12) / 2, p.z);
      scene.add(post);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.5, 16), padMat);
      pad.position.set(p.x * 0.985, 0.95, p.z * 0.985);
      scene.add(pad);
      const nxt = posts[(i + 1) % posts.length];
      const len = p.distanceTo(nxt);
      const mid = p.clone().add(nxt).multiplyScalar(0.5);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, h - 0.12), meshMat);
      panel.position.set(mid.x, 0.12 + (h - 0.12) / 2, mid.z);
      panel.lookAt(0, panel.position.y, 0);
      const ptex = tex.clone();
      ptex.needsUpdate = true;
      ptex.repeat.set(len / 0.12, (h - 0.12) / 0.12);
      const pm = meshMat.clone();
      pm.map = ptex;
      panel.material = pm;
      scene.add(panel);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 10), railMat);
      rail.position.set(mid.x, h, mid.z);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nxt.clone().sub(p).normalize());
      scene.add(rail);
    }
  }

  // Crowd tiers: seeded dark boxes with a few lit faces.
  let s = 1234567;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
  const seatGeo = new THREE.BoxGeometry(0.42, 0.9, 0.35);
  const count = 1400;
  const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), count);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const r0 = ca.circumradius + 2.6;
  for (let i = 0; i < count; i++) {
    const tier = Math.floor(rnd() * 7);
    const a = rnd() * Math.PI * 2;
    const r = r0 + tier * 0.95 + rnd() * 0.2;
    m.makeRotationY(a + Math.PI);
    m.setPosition(Math.sin(a) * r, 0.45 + tier * 0.55, Math.cos(a) * r);
    seats.setMatrixAt(i, m);
    col.setHSL(0.6 + rnd() * 0.3, 0.2, 0.05 + rnd() * 0.12);
    seats.setColorAt(i, col);
  }
  scene.add(seats);

  scene.add(new THREE.HemisphereLight('#8a93a6', '#0b0c0f', 0.35));
  const key = new THREE.DirectionalLight('#fff6e8', 2.4);
  key.position.set(1.5, 12, 1.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 30;
  scene.add(key);
  const fillA = new THREE.PointLight('#dfe8ff', 18, 20, 1.6);
  fillA.position.set(-5, 7, -5);
  scene.add(fillA);
  const fillB = new THREE.PointLight('#fff1dc', 18, 20, 1.6);
  fillB.position.set(5, 7, 5);
  scene.add(fillB);
}

function chainLinkTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(24,26,30,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// Capsule fighters
// ---------------------------------------------------------------------------

interface Body {
  group: THREE.Group;
  parts: Record<string, THREE.Mesh>;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();

function makeBody(i: number): Body {
  const skinTone = pres.fighters[i].appearance?.skinTone ?? 0.4;
  const skin = new THREE.Color().setHSL(0.07, 0.42, 0.72 - skinTone * 0.45);
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55 });
  const kit = new THREE.MeshStandardMaterial({ color: pres.cornerColours[i], roughness: 0.6 });
  const glove = new THREE.MeshStandardMaterial({ color: new THREE.Color(pres.cornerColours[i]).multiplyScalar(0.7), roughness: 0.4 });
  const group = new THREE.Group();
  // A limb is a unit cylinder stretched between two joints, with a sphere
  // child at each end (kept round by undoing the stretch).
  const cap = (r: number, mat: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14), mat);
    mesh.castShadow = true;
    for (const end of [-0.5, 0.5]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
      ball.position.y = end;
      ball.castShadow = true;
      ball.name = 'end';
      mesh.add(ball);
    }
    group.add(mesh);
    return mesh;
  };
  const ball = (r: number, mat: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const parts: Record<string, THREE.Mesh> = {
    torso: cap(0.16, skinMat), head: ball(0.115, skinMat), shorts: cap(0.175, kit),
    armL: cap(0.05, skinMat), armR: cap(0.05, skinMat), foreL: cap(0.045, skinMat), foreR: cap(0.045, skinMat),
    thighL: cap(0.075, skinMat), thighR: cap(0.075, skinMat), shinL: cap(0.06, skinMat), shinR: cap(0.06, skinMat),
    gloveL: ball(0.07, glove), gloveR: ball(0.07, glove),
  };
  scene.add(group);
  return { group, parts };
}

function place(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, _r: number): void {
  const d = tmpA.copy(b).sub(a);
  const len = Math.max(0.02, d.length());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  mesh.scale.set(1, len, 1);
  for (const c of mesh.children) c.scale.set(1, 1 / len, 1);
}

const v = (p: readonly number[]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

function poseBody(b: Body, p: FighterPoints): void {
  const left = new THREE.Vector3(Math.cos(p.facing), 0, -Math.sin(p.facing));
  const hips = v(p.hips);
  const chest = v(p.chest);
  const neck = v(p.neck);
  const lying = p.posture === 'ground' || p.posture === 'down' || p.posture === 'out';
  const sideL = left;
  const shL = chest.clone().addScaledVector(sideL, 0.2).add(new THREE.Vector3(0, 0.08, 0));
  const shR = chest.clone().addScaledVector(sideL, -0.2).add(new THREE.Vector3(0, 0.08, 0));
  const hipL = hips.clone().addScaledVector(left, 0.1);
  const hipR = hips.clone().addScaledVector(left, -0.1);
  const handL = v(p.handL);
  const handR = v(p.handR);
  const footL = v(p.footL).add(new THREE.Vector3(0, 0.06, 0));
  const footR = v(p.footR).add(new THREE.Vector3(0, 0.06, 0));
  const elbow = (sh: THREE.Vector3, hand: THREE.Vector3, side: number): THREE.Vector3 =>
    sh.clone().add(hand).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.12, 0)).addScaledVector(left, 0.08 * side);
  const knee = (hip: THREE.Vector3, foot: THREE.Vector3): THREE.Vector3 => {
    const fwd = new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing));
    return hip.clone().add(foot).multiplyScalar(0.5).addScaledVector(fwd, lying ? 0 : 0.1).add(new THREE.Vector3(0, lying ? 0.12 : 0, 0));
  };
  const eL = elbow(shL, handL, 1);
  const eR = elbow(shR, handR, -1);
  const kL = knee(hipL, footL);
  const kR = knee(hipR, footR);
  place(b.parts.torso, hips.clone().add(new THREE.Vector3(0, 0.05, 0)), neck, 0.32);
  b.parts.head.position.copy(v(p.head));
  place(b.parts.shorts, hips.clone().add(new THREE.Vector3(0, -0.12, 0)), hips.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.35);
  place(b.parts.armL, shL, eL, 0.1);
  place(b.parts.armR, shR, eR, 0.1);
  place(b.parts.foreL, eL, handL, 0.09);
  place(b.parts.foreR, eR, handR, 0.09);
  place(b.parts.thighL, hipL, kL, 0.15);
  place(b.parts.thighR, hipR, kR, 0.15);
  place(b.parts.shinL, kL, footL, 0.12);
  place(b.parts.shinR, kR, footR, 0.12);
  b.parts.gloveL.position.copy(handL);
  b.parts.gloveR.position.copy(handR);
}

// ---------------------------------------------------------------------------
// Director, transport, replays
// ---------------------------------------------------------------------------

buildSet();
const bodies = pres.fighters.map((_, i) => makeBody(i));
const poses: WorldPose[] = pres.fighters.map(() => createWorldPose());
const statures = pres.runtimes.map((r) => r.body.heightM);

const director = createCameraDirector();
director.setBout(pres, arenaSet);
director.setRecording(frames, events);
const lockParam = q.get('lock') as ShotKind | null;
if (lockParam && lockParam in SHOTS) director.lockShot(lockParam);
let mode: CameraMode = (q.get('mode') as CameraMode) ?? 'broadcast';
director.setRequest({ mode, followId: 0 });
attachFreeCamera(renderer.domElement, director.free);

const player = new BoutPlayer({ frames, events });
const plans = planReplays(events, frames);
const seq = new ReplaySequencer(plans);
const broadcast = makeBroadcastBout({
  fighters: bout.fighters, runtimes: bout.runtimes, cornerColours: pres.cornerColours,
  stats: bout.run.stats, result: bout.run.result, rounds: rs.rounds.count, roundSeconds: rs.rounds.lengthS,
  breakSeconds: rs.rounds.breakS,
});

let discontinuity = true;
let lastState: CameraState | null = null;
let showLabel = q.get('label') === '1';

function frameInput(realDt: number): { input: FrameInput; frame: TickSnapshot } {
  void realDt;
  const frame = player.current ?? frames[0];
  const next = player.next;
  const alpha = player.atEnd ? 0 : player.alpha;
  const simTime = frame.t + alpha * TICK_S;
  const input: FrameInput = {
    frame, next, alpha, simTime,
    events: events.filter((e) => e.tick > frame.tick - 25 && e.tick <= frame.tick),
    playbackRate: player.speed, replay: seq.state !== null, discontinuity,
  };
  discontinuity = false;
  return { input, frame };
}

function stepCamera(realDt: number): CameraState {
  const { input, frame } = frameInput(realDt);
  const pts = fighterPoints(frame, input.next, input.alpha, [], statures);
  pts.forEach((p, i) => {
    standInWorldPose(p, poses[i]);
    poseBody(bodies[i], p);
  });
  director.setReplay(seq.state);
  const s = director.update(input, poses, realDt);
  lastState = s;
  return s;
}

function applyCamera(s: CameraState): void {
  cam.position.set(s.position[0], s.position[1], s.position[2]);
  cam.up.set(0, 1, 0);
  cam.lookAt(s.target[0], s.target[1], s.target[2]);
  cam.rotateZ(s.rollRad);
  cam.fov = s.fovDeg;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Overlay (React)
// ---------------------------------------------------------------------------

const overlayHost = document.createElement('div');
stageEl.appendChild(overlayHost);
const root = createRoot(overlayHost);
let overlayKey = '';
function renderOverlay(force = false): void {
  const st = seq.state;
  const key = `${player.frame}|${st?.plan.id ?? ''}|${st?.segmentIndex ?? ''}|${seq.wipeKey}|${lastState?.shotName}|${showLabel}`;
  if (!force && key === overlayKey) return;
  overlayKey = key;
  root.render(createElement(BroadcastOverlay, {
    bout: broadcast, frame: player.current, events, replay: st, replayWipeKey: seq.wipeKey,
    shot: lastState, showShotLabel: showLabel,
  }));
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const tl = document.getElementById('timeline') as HTMLCanvasElement;
const PRE = 12;
const POST = 30;
const KIND_COLOUR: Record<string, string> = {
  main: '#3b4a63', mainTight: '#56688a', reverse: '#6b5a8a', cageside: '#2f7d6d', ground: '#2a9d6f', overhead: '#9b6a2b',
  jib: '#8a3d6b', corner: '#7a3434', finish: '#b08a3a', follow: '#555', orbit: '#555', free: '#555',
};
const tMin = -PRE;
const tMax = lastT + POST;
const xOf = (t: number, w: number): number => ((t - tMin) / (tMax - tMin)) * w;

function drawTimeline(): void {
  if (!ui) return;
  const dpr = window.devicePixelRatio || 1;
  const w = tl.clientWidth;
  const h = tl.clientHeight;
  if (tl.width !== Math.round(w * dpr)) {
    tl.width = Math.round(w * dpr);
    tl.height = Math.round(h * dpr);
  }
  const g = tl.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, w, h);
  const plan = director.plan;
  // Shots.
  const entries = plan?.entries ?? [];
  entries.forEach((e, i) => {
    const t0 = i === 0 ? tMin : e.startT;
    const t1 = entries[i + 1]?.startT ?? tMax;
    const x0 = xOf(t0, w);
    const x1 = xOf(t1, w);
    g.fillStyle = KIND_COLOUR[e.kind] ?? '#444';
    g.fillRect(x0, 30, Math.max(1, x1 - x0), 26);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(x0, 26, 1.5, 34); // cut marker
    if (x1 - x0 > 34) {
      g.fillStyle = '#e8edf5';
      g.font = '10px ui-monospace, monospace';
      g.fillText(SHOTS[e.kind].label.replace('CAGESIDE ', 'CS ').slice(0, Math.floor((x1 - x0) / 6.2)), x0 + 3, 47);
    }
  });
  // Rounds.
  for (const e of events) {
    if (e.kind !== 'roundStart' && e.kind !== 'roundEnd') continue;
    const x = xOf(e.tick * TICK_S, w);
    g.fillStyle = e.kind === 'roundStart' ? '#e9b44c' : '#6d7485';
    g.fillRect(x, 0, 1, h);
  }
  // Strikes (contacts) and big moments.
  for (const e of events) {
    const x = xOf(e.tick * TICK_S + e.subMs / 1000, w);
    if (e.kind === 'strike') {
      const d = (e as { detail: { result: string; forceN?: number } }).detail;
      const landed = d.result === 'landed';
      g.fillStyle = landed ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)';
      const hh = landed ? 4 + Math.min(10, (d.forceN ?? 0) / 300) : 3;
      g.fillRect(x, 70 - hh, 1, hh);
    } else if (e.kind === 'knockdown' || e.kind === 'refereeStoppage' || e.kind === 'submissionFinish') {
      g.fillStyle = e.kind === 'knockdown' ? '#ff4a4a' : '#ffd24a';
      g.beginPath();
      g.moveTo(x, 58); g.lineTo(x - 5, 70); g.lineTo(x + 5, 70); g.closePath();
      g.fill();
    }
  }
  // Blocked cuts.
  for (const b of plan?.blocked ?? []) {
    g.fillStyle = b.reason === 'strike' ? '#ff8c3a' : '#8a7cff';
    g.fillRect(xOf(b.tick * TICK_S, w), 22, 1, 5);
  }
  // Replay plans: source bracket + air marker.
  g.font = '10px ui-monospace, monospace';
  plans.forEach((p) => {
    const x0 = xOf(p.fromTick * TICK_S, w);
    const x1 = xOf(p.toTick * TICK_S, w);
    const xa = xOf(p.airTick * TICK_S, w);
    g.fillStyle = '#e9b44c';
    g.fillRect(x0, 4, Math.max(2, x1 - x0), 4);
    g.strokeStyle = 'rgba(233,180,76,0.5)';
    g.beginPath();
    g.moveTo(x1, 6); g.lineTo(xa, 16); g.stroke();
    g.beginPath();
    g.moveTo(xa, 11); g.lineTo(xa + 5, 16); g.lineTo(xa, 21); g.lineTo(xa - 5, 16); g.closePath();
    g.fill();
    g.fillStyle = '#e9d7b0';
    g.fillText(p.title, xa + 7, 19);
  });
  // Playhead.
  const tNow = director.debug().timeline;
  const shownT = seq.state ? player.t : (player.frame === 0 && !player.playing ? -Math.min(PRE, director.debug().timeline) : tNow);
  g.fillStyle = seq.state ? '#e9b44c' : '#ffffff';
  g.fillRect(xOf(shownT, w) - 1, 0, 2, h);
  g.fillStyle = '#7c8699';
  g.fillText('replays', 4, 12);
  g.fillText('shots', 4, 26);
  g.fillText('strikes / KD', 4, 82);
}

tl.addEventListener('click', (ev) => {
  const r = tl.getBoundingClientRect();
  const t = tMin + ((ev.clientX - r.left) / r.width) * (tMax - tMin);
  seek(Math.max(0, Math.min(lastT, t)));
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function seek(t: number): void {
  if (seq.state) seq.stop(player);
  player.seekTick(Math.round(t / TICK_S));
  seq.reset(player.tick);
  discontinuity = true;
}

const playBtn = document.getElementById('play') as HTMLButtonElement;
function setPlaying(p: boolean): void {
  if (p) player.play();
  else player.pause();
  playBtn.textContent = player.playing ? 'Pause' : 'Play';
}
playBtn.onclick = () => setPlaying(!player.playing);
(document.getElementById('back') as HTMLButtonElement).onclick = () => seek(player.t - 5);
(document.getElementById('fwd') as HTMLButtonElement).onclick = () => seek(player.t + 5);

const speedsEl = document.getElementById('speeds')!;
for (const s of [0.25, 0.5, 1, 2, 4, 8]) {
  const b = document.createElement('button');
  b.textContent = `${s}×`;
  b.onclick = () => {
    player.setSpeed(s);
    [...speedsEl.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
  };
  b.setAttribute('aria-pressed', String(s === 1));
  speedsEl.appendChild(b);
}

const modesEl = document.getElementById('modes')!;
const MODES: CameraMode[] = ['broadcast', 'cageside', 'overhead', 'follow', 'orbit', 'free'];
function setMode(m: CameraMode): void {
  mode = m;
  director.setRequest({ mode, followId: 0 });
  [...modesEl.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === m)));
}
for (const m of MODES) {
  const b = document.createElement('button');
  b.textContent = m;
  b.onclick = () => setMode(m);
  modesEl.appendChild(b);
}
setMode(mode);

const lockEl = document.getElementById('lock') as HTMLSelectElement;
for (const k of ['', 'main', 'mainTight', 'reverse', 'cageside', 'ground', 'overhead', 'jib', 'corner', 'finish']) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = k || '(director)';
  lockEl.appendChild(o);
}
lockEl.value = lockParam ?? '';
lockEl.onchange = () => director.lockShot((lockEl.value || null) as ShotKind | null);

const replaysEl = document.getElementById('replays')!;
plans.forEach((p, i) => {
  const b = document.createElement('button');
  b.textContent = `${p.title} @${(p.airTick * TICK_S).toFixed(0)}s`;
  b.onclick = () => playReplay(i);
  replaysEl.appendChild(b);
});
const labelEl = document.getElementById('shotlabel') as HTMLInputElement;
labelEl.checked = showLabel;
labelEl.onchange = () => {
  showLabel = labelEl.checked;
};

function playReplay(i: number): void {
  const p = plans[i];
  if (!p) return;
  seq.play(p, player);
  discontinuity = true;
}

const readout = document.getElementById('readout')!;
function updateReadout(): void {
  if (!ui) return;
  const d = director.debug();
  const s = lastState;
  const st = seq.state;
  readout.textContent = [
    `${d.label.padEnd(20)} ${d.source}/${d.reason}  ${d.shotSeconds.toFixed(1)}s in shot   t=${player.t.toFixed(1)}s  tick ${player.tick}`,
    `fov ${s?.fovDeg.toFixed(1)}°  dof ${s?.dof.toFixed(2)} @ ${s?.focusM.toFixed(1)}m  ${d.blocked ?? ''}${st ? `   REPLAY ${st.plan.title} ${st.segmentIndex + 1}/${st.plan.segments.length} @${st.segment.speed}×` : ''}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Loop and deterministic capture
// ---------------------------------------------------------------------------

function resize(): void {
  const { w, h } = layout();
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = `${w}px`;
  renderer.domElement.style.height = `${h}px`;
  cam.aspect = w / h;
  director.setAspect(w / h);
}
window.addEventListener('resize', resize);
resize();

function draw(): void {
  if (lastState) applyCamera(lastState);
  renderer.render(scene, cam);
  renderOverlay();
  drawTimeline();
  updateReadout();
}

let last = performance.now();
let frameMs = 0;
// A capture URL (t / pre / post / replay) holds its moment still until the
// viewer touches a control, so a screenshot is the same however long it waits.
let frozen = ['t', 'pre', 'post', 'replay'].some((k) => q.has(k)) && q.get('play') !== '1';
document.getElementById('bar')!.addEventListener('click', () => { frozen = false; }, true);
tl.addEventListener('click', () => { frozen = false; }, true);
renderer.domElement.addEventListener('pointerdown', () => { frozen = false; });
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  if (player.playing || seq.state) {
    player.advance(dt);
    seq.update(player);
    if (!player.playing && !seq.state) playBtn.textContent = 'Play';
  }
  if (!frozen) stepCamera(dt);
  draw();
  frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
  window.__stats = { frameMs: +frameMs.toFixed(2), shot: lastState?.shotName, t: player.t };
  requestAnimationFrame(loop);
}

/** Settle the camera at the requested moment with fixed steps, so captures are repeatable. */
function settleAt(): void {
  const STEP = 1 / 30;
  const replayIdx = num('replay');
  const pre = num('pre');
  const post = num('post');
  if (replayIdx !== null && plans[replayIdx]) {
    const p: ReplayPlan = plans[replayIdx];
    const segIdx = Math.min(p.segments.length - 1, Math.max(0, num('seg') ?? 0));
    const prog = Math.min(1, Math.max(0, num('p') ?? 0.5));
    player.seekTick(p.airTick);
    seq.play(p, player);
    // Jump straight to the requested angle.
    for (let k = 0; k < segIdx; k++) {
      player.stopInstantReplay();
      seq.update(player);
    }
    discontinuity = true;
    const seg = p.segments[segIdx];
    const span = (seg.toTick - seg.fromTick) * TICK_S / seg.speed;
    const steps = Math.max(1, Math.round((prog * span) / STEP));
    for (let k = 0; k < steps; k++) {
      player.advance(STEP);
      stepCamera(STEP);
    }
    player.pause();
    void segmentRequest;
    return;
  }
  if (pre !== null) {
    player.seekFrame(0);
    discontinuity = true;
    for (let k = 0; k < Math.round(pre / STEP); k++) stepCamera(STEP);
    return;
  }
  if (post !== null) {
    player.seekFrame(frames.length - 1);
    discontinuity = true;
    for (let k = 0; k < Math.round(post / STEP); k++) stepCamera(STEP);
    return;
  }
  const t = num('t');
  if (t !== null) {
    const t0 = Math.max(0.1, t - 8);
    player.seekTick(Math.round(t0 / TICK_S));
    discontinuity = true;
    player.play();
    const target = Math.round(t / TICK_S);
    let guard = 0;
    while (player.tick < target && guard++ < 100000) {
      player.advance(STEP);
      stepCamera(STEP);
    }
    player.pause();
    return;
  }
  player.seekFrame(0);
  stepCamera(STEP);
}

settleAt();
stepCamera(0);
draw();
if (q.get('play') === '1') setPlaying(true);
requestAnimationFrame((n) => {
  last = n;
  // Let React paint the overlay and fonts load before a capture is taken.
  document.fonts.ready.then(() => {
    renderOverlay(true);
    window.__ready = true;
  });
  requestAnimationFrame(loop);
});

window.__seek = (t: number) => seek(t);
window.__cam = (m: string) => setMode(m as CameraMode);
window.__replay = (i: number) => playReplay(i);
