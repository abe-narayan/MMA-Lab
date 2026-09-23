/**
 * Grapple pose browser (dev/grapple.html).
 *
 * Drives the real `GrappleSolver` with hand-built snapshots and draws both
 * fighters as capsule bodies (a = red, b = blue), with the contact targets as
 * yellow dots. Two different body sizes by default (a heavyweight and a
 * flyweight from ARCHETYPES), because a pose that only works for equal bodies
 * does not work.
 *
 * URL parameters
 *   ?node=pos.ground_mount_low          a position node
 *   ?edge=tech.double_drive_through&phase=0.5   an edge in flight (node = its source)
 *   ?sub=sub.rnc&stage=3[&limp=1]       a submission stage (stage 4 = locked / tap)
 *   ?strike=tech.gnp_punch&sphase=0.5   a ground strike on top of the node
 *   ?sizes=1.93,1.65  ?mirror=1  ?postured=1  ?cage=1  ?tier=0,4  ?t=1.5
 *   ?cam=iso|iso2|side|front|back|top|low  ?panel=0  ?play=1
 *   ?sheet=node:pos.ground_mount_low~cam:side;sub:sub.rnc~stage:3;…   a grid of cells
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ARCHETYPES, GRAPPLING_EDGES, POSITIONS, SUBMISSIONS, resolveArena,
  type EngagementSnapshot, type FighterSnapshot, type SimEvent, type TickSnapshot,
} from '../src/sim';
import type { BoutPresentation, FrameInput } from '../src/presentation/contract';
import type { GrappleContext } from '../src/presentation/anim/grappleApi';
import { createPose, createWorldPose, forwardKinematics, type Pose, type RestSkeleton, type WorldPose } from '../src/presentation/rig/skeleton';
import { GrappleSolverImpl, likelyDestination, scaledRest } from '../src/presentation/anim/grapple';
import { bodyCapsules, type Capsule } from '../src/presentation/anim/grapple/capsules';
import { defaultNodeForSub } from '../src/presentation/anim/grapple/subs';
import { wallPlanes } from '../src/presentation/anim/grapple/fence';

const params = new URLSearchParams(location.search);
void ARCHETYPES;

// ---------------------------------------------------------------------------
// Cell description
// ---------------------------------------------------------------------------

interface CellSpec {
  node: string;
  edge: string | null;
  phase: number;
  to: string | null;
  sub: string | null;
  stage: number;
  limp: boolean;
  strike: string | null;
  sphase: number;
  sizes: [number, number];
  mirror: boolean;
  postured: boolean;
  cage: boolean;
  tiers: [number, number];
  t: number;
  cam: string;
  tapT: number;
}

function parseCell(get: (k: string) => string | null): CellSpec {
  const edge = get('edge');
  const sub = get('sub');
  const e = edge ? GRAPPLING_EDGES.find((x) => x.id === edge) : null;
  let node = get('node');
  if (!node && e) node = e.from[0];
  if (!node && sub) node = defaultNodeForSub(sub);
  const sizes = (get('sizes') ?? '1.93,1.65').split(',').map(Number) as [number, number];
  const tiers = (get('tier') ?? '4,4').split(',').map(Number) as [number, number];
  return {
    node: node ?? 'pos.ground_mount_low',
    edge: edge ?? null,
    phase: Number(get('phase') ?? 0.5),
    to: get('to'),
    sub: sub ?? null,
    stage: Number(get('stage') ?? 3),
    limp: get('limp') === '1',
    strike: get('strike'),
    sphase: Number(get('sphase') ?? 0.5),
    sizes,
    mirror: get('mirror') === '1',
    postured: get('postured') === '1',
    cage: get('cage') === '1',
    tiers,
    t: Number(get('t') ?? 0),
    cam: get('cam') ?? 'iso',
    tapT: Number(get('tapt') ?? 0.3),
  };
}

// ---------------------------------------------------------------------------
// Synthetic snapshots
// ---------------------------------------------------------------------------

function fighterSnap(id: number, over: Partial<FighterSnapshot>): FighterSnapshot {
  return {
    id, team: id, x: id === 0 ? -0.075 : 0.075, z: 0, facing: 0, vx: 0, vz: 0, stance: 'orthodox', leadFoot: 0,
    againstFence: false, fenceNormalAngle: 0, posture: 'ground', position: 'pos.ground_mount_low', role: id === 0 ? 'top' : 'bottom',
    partnerId: 1 - id, action: 'idle', actionPhase: 0, actionStage: 'none', actionResult: 'none', defence: 'def.none' as never,
    actionDetail: { startTick: 0, totalMs: 500, contactTick: 3, contactOffsetMs: 0, target: 'head', subLocation: null, side: 'R', targetId: 1 - id, forceNorm: 0.5, direction: 'down' },
    defenceDetail: { phase: 1, side: 'both' },
    stamina: { total: 1, burst: 1 }, damage: { head: 0, body: 0, legs: 0, cut: 0 }, state: 0, states: [], balance: 1,
    sub: { technique: null, stage: 0, progress: 0 }, sig: { landed: 0, attempted: 0 }, intentTag: '',
    grips: [], contacts: { footL: false, footR: false, kneeL: false, kneeR: false, handL: false, handR: false, hipL: false, hipR: false, back: false, chest: false, fence: false },
    damageVisual: { zones: [], swelling: [], cuts: [], bloodOnGloves: 0 },
    fatigueVisual: { f: 0, breathingRate: 0, handsDrop: 0, flatFeet: 0, chinUp: 0 },
    ...over,
  } as FighterSnapshot;
}

const arena = resolveArena('octagon_30');

function contextFor(c: CellSpec, restA: RestSkeleton, restB: RestSkeleton): GrappleContext {
  const inflight = c.edge ? { edge: c.edge, tStart: 0, dur: 1000, phase: c.phase } : null;
  const e: EngagementSnapshot = {
    a: 0, b: 1, node: c.node as EngagementSnapshot['node'], sinceTick: 0, kind: 'ground', cage: c.cage, underhookOwner: null,
    kuzushi: { dir: 0, mag: 2 }, posture: c.postured ? 'postured' : 'chest', inflight,
    rootX: 0, rootZ: 0, rootYaw: 0,
  };
  if (c.cage) {
    // Put the pair near the +Z fence of the octagon so the fence placement runs.
    const ap = arena.apothemM ?? 9;
    e.rootX = 0; e.rootZ = ap - 0.8;
  }
  const subOn = c.sub ? { technique: c.sub as never, stage: Math.min(4, c.stage) as 0 | 1 | 2 | 3 | 4, progress: c.stage / 4 } : null;
  const subAtt = c.sub ? subAttackerFor(c.sub, c.node) : 'a';
  const strikeOver = (who: number): Partial<FighterSnapshot> => {
    if (!c.strike) return {};
    const striker = c.strike.startsWith('tech.bottom') ? 1 : 0;
    if (who !== striker) return {};
    return { action: c.strike as never, actionPhase: c.sphase, actionStage: 'startup', actionDetail: { startTick: 0, totalMs: 600, contactTick: 3, contactOffsetMs: 0, target: 'head', subLocation: null, side: 'R', targetId: 1 - who, forceNorm: 0.6, direction: 'down' } };
  };
  const a = fighterSnap(0, { z: c.cage ? e.rootZ : 0, stance: 'orthodox', sub: subOn && subAtt === 'a' ? subOn : { technique: null, stage: 0, progress: 0 }, ...strikeOver(0) });
  const b = fighterSnap(1, { z: c.cage ? e.rootZ : 0, sub: subOn && subAtt === 'b' ? subOn : { technique: null, stage: 0, progress: 0 }, ...strikeOver(1) });
  if (c.mirror) a.stance = 'southpaw';
  const events: SimEvent[] = [];
  const simTime = c.t;
  if (c.sub && c.stage >= 4) {
    events.push({ tick: Math.round((simTime - c.tapT) * 10), subMs: 0, round: 1, kind: 'submissionFinish', actor: subAtt === 'a' ? 0 : 1, target: subAtt === 'a' ? 1 : 0, text: '', detail: { technique: c.sub, type: c.limp ? 'loc' : 'tap', lockedSeconds: 0 } } as unknown as SimEvent);
  }
  const frame = { v: 4, tick: Math.round(simTime * 10), t: simTime, round: 1, roundTime: simTime, phase: 'round', fighters: [a, b], engagements: [e], referee: { state: 'watching' }, score: { hidden: true } } as unknown as TickSnapshot;
  const input: FrameInput = { frame, next: null, alpha: 0, simTime, events, playbackRate: 1, replay: false, discontinuity: true };
  const bout = { fighters: [], runtimes: [{ grapplingTier: c.tiers[0] }, { grapplingTier: c.tiers[1] }], teamOf: [0, 1], arena, rulesetId: 'mma.unified.3r', glove: 'mma4oz', cornerColours: ['#c0392b', '#2e6fd1'], blood: false, cosmeticSeed: 'dev' } as unknown as BoutPresentation;
  return { bout, input, engagement: e, nextEngagement: null, a, b, restA, restB };
}

function subAttackerFor(sub: string, node: string): 'a' | 'b' {
  const s = SUBMISSIONS.find((x) => x.id === sub) as unknown as { role: string } | undefined;
  if (!s) return 'a';
  if (s.role === 'bottom') return 'b';
  if (s.role === 'either') {
    // Leg entanglements and guard nodes: the bottom (b) attacks.
    if (/ground_(closed|open|half|ashi|5050|saddle|reap|truck|hq)/.test(node) && !/truck/.test(node)) return 'b';
  }
  return 'a';
}

// ---------------------------------------------------------------------------
// Capsule rig
// ---------------------------------------------------------------------------

class CapsuleRig {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private built = false;
  constructor(private readonly colour: number) {}
  update(caps: Capsule[]): void {
    if (!this.built) {
      for (const c of caps) {
        const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]);
        const geo = c.name === 'head' ? new THREE.SphereGeometry(c.r * 1.12, 20, 14) : new THREE.CapsuleGeometry(c.r, Math.max(0.001, L), 6, 12);
        const tint = c.region === 'torso' ? 0.85 : c.region === 'head' ? 1.1 : 1;
        const col = new THREE.Color(this.colour).multiplyScalar(tint);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 }));
        m.castShadow = true; m.receiveShadow = true;
        this.meshes.push(m);
        this.group.add(m);
      }
      this.built = true;
    }
    const up = new THREE.Vector3(0, 1, 0);
    caps.forEach((c, i) => {
      const m = this.meshes[i];
      const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a);
      if (d.lengthSq() > 1e-10) m.quaternion.setFromUnitVectors(up, d.normalize());
    });
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const view = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);
view.appendChild(renderer.domElement);

interface Cell {
  spec: CellSpec;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rigA: CapsuleRig;
  rigB: CapsuleRig;
  markers: THREE.Group;
  label: HTMLDivElement;
  restA: RestSkeleton;
  restB: RestSkeleton;
  solver: GrappleSolverImpl;
  poses: [Pose, Pose];
  worlds: [WorldPose, WorldPose];
  centre: THREE.Vector3;
  controls: OrbitControls | null;
  camSet: boolean;
}

function makeScene(c: CellSpec): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171d);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303030, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 6, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 20;
  scene.add(sun);
  scene.add(sun.target);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.9 }));
  mat.rotation.x = -Math.PI / 2;
  mat.receiveShadow = true;
  scene.add(mat);
  const grid = new THREE.GridHelper(30, 60, 0x8a8478, 0xa9a292);
  (grid.material as THREE.Material).opacity = 0.35;
  (grid.material as THREE.Material).transparent = true;
  grid.position.y = 0.002;
  scene.add(grid);
  if (c.cage) {
    for (const p of wallPlanes(arena)) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.8), new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      w.position.set(p.nx * p.d, 0.9, p.nz * p.d);
      w.lookAt(0, 0.9, 0);
      scene.add(w);
    }
  }
  return scene;
}

function makeCell(spec: CellSpec, interactive: boolean): Cell {
  const scene = makeScene(spec);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  const rigA = new CapsuleRig(0xc23b2e);
  const rigB = new CapsuleRig(0x2f6fd6);
  scene.add(rigA.group, rigB.group);
  const markers = new THREE.Group();
  scene.add(markers);
  const label = document.createElement('div');
  label.className = 'cell-label';
  document.body.appendChild(label);
  const cell: Cell = {
    spec, scene, camera, rigA, rigB, markers, label,
    restA: scaledRest(spec.sizes[0]), restB: scaledRest(spec.sizes[1]),
    solver: new GrappleSolverImpl(), poses: [createPose(), createPose()], worlds: [createWorldPose(), createWorldPose()],
    centre: new THREE.Vector3(), controls: null, camSet: false,
  };
  if (interactive) {
    cell.controls = new OrbitControls(camera, renderer.domElement);
    cell.controls.enableDamping = false;
  }
  return cell;
}

function evaluate(cell: Cell): string {
  const c = cell.spec;
  const ctx = contextFor(c, cell.restA, cell.restB);
  const [pa, pb] = cell.poses;
  const res = cell.solver.evaluate(ctx, pa, pb, cell.worlds[0], cell.worlds[1]);
  forwardKinematics(cell.worlds[0], pa, cell.restA);
  forwardKinematics(cell.worlds[1], pb, cell.restB);
  cell.rigA.update(bodyCapsules(cell.worlds[0], cell.restA));
  cell.rigB.update(bodyCapsules(cell.worlds[1], cell.restB));
  // Centre of the pair: mean of hips and heads.
  const w0 = cell.worlds[0], w1 = cell.worlds[1];
  const pts = [0, 11].flatMap((i) => [w0, w1].map((w) => new THREE.Vector3(w.pos[i * 3], w.pos[i * 3 + 1], w.pos[i * 3 + 2])));
  cell.centre.set(0, 0, 0);
  for (const p of pts) cell.centre.add(p);
  cell.centre.multiplyScalar(1 / pts.length);
  let lab = res.label;
  if (c.edge) {
    const d = c.to ?? likelyDestination(c.edge, c.node).node;
    lab = `${c.edge} @${c.phase.toFixed(2)}  (${c.node} → ${d})`;
  }
  if (c.sub) lab = `${c.sub} stage ${c.stage}${c.stage >= 4 ? (c.limp ? ' (unconscious)' : ' (tap)') : ''}  [${c.node}]`;
  if (c.strike) lab = `${c.strike} @${c.sphase.toFixed(2)}  [${c.node}]`;
  if (!res.handled) lab += '  — UNHANDLED';
  return lab;
}

const CAMS: Record<string, [number, number, number]> = {
  iso: [1.9, 1.1, -1.4], iso2: [-1.9, 1.1, 1.4], side: [2.6, 0.55, 0.0], front: [0.25, 0.9, -2.6], back: [0.25, 0.9, 2.6],
  top: [0.01, 3.6, 0.0], low: [2.3, 0.25, 0.8], side2: [-2.6, 0.55, 0.0],
};

function placeCamera(cell: Cell): void {
  const c = cell.centre;
  const rel = /^(a|b)(face|left|right)$/.exec(cell.spec.cam);
  if (rel) {
    // Relative to a fighter's chest: in front of his belly, or at his side.
    const w = cell.worlds[rel[1] === 'a' ? 0 : 1];
    const q = new THREE.Quaternion(w.quat[5 * 4], w.quat[5 * 4 + 1], w.quat[5 * 4 + 2], w.quat[5 * 4 + 3]);
    let dir = new THREE.Vector3(rel[2] === 'face' ? 0 : rel[2] === 'left' ? 1 : -1, 0, rel[2] === 'face' ? 1 : 0).applyQuaternion(q);
    // Lying face-up: look from beyond his head instead of from the ceiling.
    if (Math.abs(dir.y) > 0.7) dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    dir.y = Math.max(dir.y, 0) * 0.5;
    dir.normalize();
    const ty = Math.max(0.25, c.y * 0.9);
    cell.camera.position.set(c.x + dir.x * 2.3, ty + 0.9, c.z + dir.z * 2.3);
    cell.camera.lookAt(c.x, ty, c.z);
    if (cell.controls) { cell.controls.target.set(c.x, ty, c.z); cell.controls.update(); }
    cell.camSet = true;
    return;
  }
  const off = CAMS[cell.spec.cam] ?? CAMS.iso;
  const standing = c.y > 0.7;
  const k = standing ? 1.0 : 0.85;
  const ty = standing ? c.y * 0.8 : Math.max(0.2, c.y * 0.9);
  cell.camera.position.set(c.x + off[0] * k, ty + off[1] * k, c.z + off[2] * k);
  cell.camera.lookAt(c.x, ty, c.z);
  if (cell.controls) { cell.controls.target.set(c.x, ty, c.z); cell.controls.update(); }
  cell.camSet = true;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const sheet = params.get('sheet');
const cells: Cell[] = [];
if (sheet) {
  for (const item of sheet.split(';').filter(Boolean)) {
    const kv = new Map<string, string>();
    for (const f of item.split('~')) {
      const i = f.indexOf(':');
      kv.set(f.slice(0, i), f.slice(i + 1));
    }
    const get = (k: string) => kv.get(k) ?? params.get(k);
    cells.push(makeCell(parseCell(get), false));
  }
  document.getElementById('panel')!.classList.add('hidden');
} else {
  cells.push(makeCell(parseCell((k) => params.get(k)), true));
  if (params.get('panel') === '0') document.getElementById('panel')!.classList.add('hidden');
}

function layout(): { x: number; y: number; w: number; h: number }[] {
  const W = view.clientWidth, H = view.clientHeight;
  const n = cells.length;
  const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const w = Math.floor(W / cols), h = Math.floor(H / rows);
  return cells.map((_, i) => ({ x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h }));
}

function render(): void {
  const rects = layout();
  const H = view.clientHeight;
  cells.forEach((cell, i) => {
    const r = rects[i];
    const lab = evaluate(cell);
    if (!cell.camSet) placeCamera(cell);
    cell.camera.aspect = r.w / r.h;
    cell.camera.updateProjectionMatrix();
    renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
    renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
    renderer.render(cell.scene, cell.camera);
    cell.label.textContent = lab;
    cell.label.style.left = `${r.x + 8}px`;
    cell.label.style.top = `${r.y + (cells.length === 1 ? 8 : 6)}px`;
    if (cells.length === 1) { cell.label.style.left = `${r.x + 310}px`; }
  });
  const title = document.getElementById('title')!;
  title.style.display = cells.length === 1 ? '' : 'none';
  title.textContent = cells.length === 1 ? cells[0].label.textContent ?? '' : '';
  if (cells.length === 1) cells[0].label.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Panel (single view)
// ---------------------------------------------------------------------------

function fillPanel(): void {
  if (cells.length !== 1) return;
  const cell = cells[0];
  const nodeSel = document.getElementById('node') as HTMLSelectElement;
  for (const p of POSITIONS) nodeSel.add(new Option(p.id, p.id));
  nodeSel.value = cell.spec.node;
  const edgeSel = document.getElementById('edge') as HTMLSelectElement;
  const fillEdges = () => {
    edgeSel.length = 1;
    for (const e of GRAPPLING_EDGES) if ((e.from as readonly string[]).includes(cell.spec.node)) edgeSel.add(new Option(e.id, e.id));
    edgeSel.value = cell.spec.edge ?? '';
  };
  fillEdges();
  const subSel = document.getElementById('sub') as HTMLSelectElement;
  for (const s of SUBMISSIONS) subSel.add(new Option(s.id, s.id));
  subSel.value = cell.spec.sub ?? '';
  const phase = document.getElementById('phase') as HTMLInputElement;
  phase.value = String(cell.spec.phase);
  const stage = document.getElementById('stage') as HTMLSelectElement;
  stage.value = String(cell.spec.stage);
  const strike = document.getElementById('strike') as HTMLSelectElement;
  strike.value = cell.spec.strike ?? '';
  const sizes = document.getElementById('sizes') as HTMLSelectElement;
  sizes.value = cell.spec.sizes.join(',');
  const mirror = document.getElementById('mirror') as HTMLInputElement;
  mirror.checked = cell.spec.mirror;
  const postured = document.getElementById('postured') as HTMLInputElement;
  postured.checked = cell.spec.postured;
  const limp = document.getElementById('limp') as HTMLInputElement;
  limp.checked = cell.spec.limp;
  const cam = document.getElementById('cam') as HTMLSelectElement;
  cam.value = cell.spec.cam;
  const apply = () => {
    const s = cell.spec;
    s.node = nodeSel.value;
    s.edge = edgeSel.value || null;
    s.phase = Number(phase.value);
    s.sub = subSel.value || null;
    s.stage = Number(stage.value);
    s.strike = strike.value || null;
    s.mirror = mirror.checked;
    s.postured = postured.checked;
    s.limp = limp.checked;
    const sz = sizes.value.split(',').map(Number) as [number, number];
    if (sz[0] !== s.sizes[0] || sz[1] !== s.sizes[1]) {
      s.sizes = sz;
      cell.restA = scaledRest(sz[0]); cell.restB = scaledRest(sz[1]);
      cell.scene.remove(cell.rigA.group, cell.rigB.group);
      cell.rigA = new CapsuleRig(0xc23b2e); cell.rigB = new CapsuleRig(0x2f6fd6);
      cell.scene.add(cell.rigA.group, cell.rigB.group);
    }
    if (cam.value !== s.cam) { s.cam = cam.value; cell.camSet = false; }
    render();
  };
  nodeSel.onchange = () => { cell.spec.edge = null; edgeSel.value = ''; cell.spec.node = nodeSel.value; fillEdges(); apply(); };
  for (const el of [edgeSel, phase, subSel, stage, strike, sizes, mirror, postured, limp, cam]) el.addEventListener('input', apply);
  let playing = params.get('play') === '1';
  const btn = document.getElementById('play')!;
  btn.onclick = () => { playing = !playing; };
  let last = performance.now();
  const tick = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (playing) {
      cell.spec.t += dt;
      if (cell.spec.edge) { cell.spec.phase = (cell.spec.phase + dt / 1.5) % 1; phase.value = String(cell.spec.phase); }
      if (cell.spec.strike) cell.spec.sphase = (cell.spec.sphase + dt / 0.7) % 1;
      if (cell.spec.sub && cell.spec.stage >= 4) cell.spec.tapT += dt;
    }
    render();
    const info = document.getElementById('info')!;
    info.textContent = `sizes a ${cell.spec.sizes[0]} m / b ${cell.spec.sizes[1]} m\n${cell.solver.lastLabel}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => { renderer.setSize(view.clientWidth, view.clientHeight); render(); });
render();
fillPanel();
(window as unknown as { __ready: boolean }).__ready = true;
