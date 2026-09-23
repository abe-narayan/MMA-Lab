/**
 * Animation browser (dev/anim.html) — the standing animator on a capsule
 * skeleton, so motion can be judged without any character art.
 *
 * Modes (?mode=):
 *   tech      one technique on a live loop (scrub, frame-step, slow motion)
 *   strip     key frames across one technique in a grid (&frames=6&from=-300&to=400, ms around contact)
 *   tiers     the same strip for T0 (top row) and T5 (bottom row)
 *   footwork  advance / circle / retreat pattern, footprints drawn where feet plant
 *   kd        a knockdown (&kd=flash|hurt|ko|body)
 *   bout      a real simulated bout (&a=arch.x&b=arch.y&seed=1&bt=12.5 seconds), live or &ev=N strip
 *               around the N-th landed strike (&evkind=knockdown for knockdowns)
 *
 * Other params: tech, result, def, ta, tb (tier overrides), stance, dist (recorded metres), speed,
 * view=side|front|iso|back|top, panel=0, t (ms) for a still, size (strip cell px).
 * `window.__ready` turns true once the first picture is drawn (for scripts/dev/shot.mjs --until).
 */
import * as THREE from 'three';
import { StandingAnimator } from '../src/presentation/anim/animator';
import {
  archetype, buildScenario, frameAt, presentationFor, restFor, runtimeOf,
  type Scenario, type SynthAction, type SynthBout,
} from '../src/presentation/anim/synth';
import { DEFENCE_MOTION } from '../src/presentation/anim/defence';
import {
  ARCHETYPES, DEFAULT_SETTINGS, TECHNIQUES, boutSeed, simulate,
  type SimConfig, type SimEvent, type StrikeEvent, type TickSnapshot,
} from '../src/sim';
import {
  B, BONES, BONE_COUNT, BONE_PARENT, copyPose, createPose, createWorldPose, forwardKinematics,
  type Pose, type RestSkeleton, type WorldPose,
} from '../src/presentation/rig/skeleton';

declare global {
  interface Window { __ready?: boolean; __seek?: (ms: number) => void; __stats?: unknown }
}

const P = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (P.has(k) ? Number(P.get(k)) : d);
const str = (k: string, d: string): string => P.get(k) ?? d;

let mode = str('mode', 'tech');
let tech = str('tech', 'tech.jab');
let result = str('result', 'landed') as SynthAction['result'];
let def = str('def', '');
let tierA = P.get('ta');
let tierB = P.get('tb');
let stanceA = str('stance', 'orthodox') as 'orthodox' | 'southpaw';
let dist = num('dist', 1.3);
let speed = num('speed', 1);
let view = str('view', 'side');
const cellPx = num('size', 0);

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171d);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303030, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 6, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(40, 80, 0x5a6068, 0x6d737a);
(grid.material as THREE.Material).opacity = 0.5;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.001;
scene.add(grid);

// ---------------------------------------------------------------------------
// Capsule figure
// ---------------------------------------------------------------------------

const R: Record<number, number> = {
  [B.hips]: 0.1, [B.spine]: 0.11, [B.spine1]: 0.12, [B.spine2]: 0.125, [B.neck]: 0.05,
  [B.lShoulder]: 0.05, [B.rShoulder]: 0.05, [B.lArm]: 0.048, [B.rArm]: 0.048,
  [B.lForeArm]: 0.042, [B.rForeArm]: 0.042, [B.lUpLeg]: 0.075, [B.rUpLeg]: 0.075,
  [B.lLeg]: 0.055, [B.rLeg]: 0.055, [B.lFoot]: 0.04, [B.rFoot]: 0.04, [B.lToe]: 0.03, [B.rToe]: 0.03,
};
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
const unitSph = new THREE.SphereGeometry(1, 14, 10);
const Y = new THREE.Vector3(0, 1, 0);

class Figure {
  readonly group = new THREE.Group();
  private readonly segs: { bone: number; cyl: THREE.Mesh; sph: THREE.Mesh }[] = [];
  private readonly head: THREE.Mesh;
  private readonly nose: THREE.Mesh;
  private readonly gloves: THREE.Mesh[] = [];
  private readonly chest: THREE.Mesh;
  private readonly pelvis: THREE.Mesh;
  constructor(color: number) {
    const base = new THREE.Color(color);
    const left = base.clone().lerp(new THREE.Color(0xffffff), 0.35);
    const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.6 });
    const matL = new THREE.MeshStandardMaterial({ color: left, roughness: 0.6 });
    for (let i = 1; i < BONE_COUNT; i++) {
      const r = R[i];
      if (!r) continue;
      const isLeft = BONES[i].startsWith('Left');
      const m = isLeft ? matL : mat;
      const cyl = new THREE.Mesh(unitCyl, m);
      const sph = new THREE.Mesh(unitSph, m);
      cyl.castShadow = sph.castShadow = true;
      this.group.add(cyl, sph);
      this.segs.push({ bone: i, cyl, sph });
    }
    // Boxes for chest and pelvis so torso twist (blading, hip rotation) is readable.
    this.chest = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.pelvis = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.chest.castShadow = this.pelvis.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.02), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 }));
    stripe.position.set(0, 0, 0.5);
    this.chest.add(stripe);
    this.group.add(this.chest, this.pelvis);
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8b49a, roughness: 0.7 });
    this.head = new THREE.Mesh(unitSph, skin);
    this.head.castShadow = true;
    this.nose = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), skin);
    this.group.add(this.head, this.nose);
    const glove = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4 });
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Mesh(unitSph, glove);
      g.castShadow = true;
      this.gloves.push(g);
      this.group.add(g);
    }
    scene.add(this.group);
  }
  update(w: WorldPose): void {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (const s of this.segs) {
      const i = s.bone;
      const r = R[i];
      a.fromArray(w.pos, i * 3);
      b.fromArray(w.tip, i * 3);
      if (i === B.spine2) b.fromArray(w.pos, B.neck * 3);
      d.subVectors(b, a);
      const L = d.length();
      s.cyl.position.addVectors(a, b).multiplyScalar(0.5);
      s.cyl.quaternion.setFromUnitVectors(Y, d.normalize());
      s.cyl.scale.set(r, L, r);
      s.sph.position.copy(a);
      s.sph.scale.setScalar(r * 1.02);
    }
    const cq = new THREE.Quaternion().fromArray(w.quat, B.spine2 * 4);
    const c0 = new THREE.Vector3().fromArray(w.pos, B.spine2 * 3);
    const c1 = new THREE.Vector3().fromArray(w.pos, B.neck * 3);
    this.chest.position.copy(c0).lerp(c1, 0.45);
    this.chest.quaternion.copy(cq);
    this.chest.scale.set(0.34, c0.distanceTo(c1) + 0.08, 0.2);
    const pq = new THREE.Quaternion().fromArray(w.quat, B.hips * 4);
    this.pelvis.position.fromArray(w.pos, B.hips * 3).add(new THREE.Vector3(0, -0.02, 0).applyQuaternion(pq));
    this.pelvis.quaternion.copy(pq);
    this.pelvis.scale.set(0.3, 0.16, 0.18);
    const hq = new THREE.Quaternion().fromArray(w.quat, B.head * 4);
    const hp = new THREE.Vector3().fromArray(w.pos, B.head * 3);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
    const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
    this.head.position.copy(hp).addScaledVector(up, 0.1).addScaledVector(fw, 0.01);
    this.head.quaternion.copy(hq);
    this.head.scale.set(0.085, 0.11, 0.1);
    this.nose.position.copy(hp).addScaledVector(up, 0.08).addScaledVector(fw, 0.1);
    this.nose.quaternion.copy(hq);
    for (let k = 0; k < 2; k++) {
      const h = k === 0 ? B.lHand : B.rHand;
      const f = k === 0 ? B.lForeArm : B.rForeArm;
      const hpk = new THREE.Vector3().fromArray(w.pos, h * 3);
      const fa = new THREE.Vector3().fromArray(w.pos, f * 3);
      const dir = hpk.clone().sub(fa).normalize();
      this.gloves[k].position.copy(hpk).addScaledVector(dir, 0.045);
      this.gloves[k].scale.set(0.055, 0.055, 0.055);
    }
  }
  set visible(v: boolean) { this.group.visible = v; }
}

const figs = [new Figure(0xc0392b), new Figure(0x2e6fd8)];
const aimMarker = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
scene.add(aimMarker);
const prints = new THREE.Group();
scene.add(prints);
const printGeo = new THREE.CircleGeometry(0.035, 12);
const printMat = [new THREE.MeshBasicMaterial({ color: 0xff7070 }), new THREE.MeshBasicMaterial({ color: 0x70a0ff })];

// ---------------------------------------------------------------------------
// Scenario / pose sampling
// ---------------------------------------------------------------------------

const A_DEF = str('a', 'arch.champion_complete');
const B_DEF = str('b', 'arch.regional_pro_allrounder');

interface Sampled {
  poses: Pose[];
  worlds: WorldPose[];
  aim: [number, number, number] | null;
  layer: string[];
  tech: (string | null)[];
  feet: { ball: [number, number, number]; planted: boolean }[][];
}

interface Source {
  sb: { frames: TickSnapshot[]; events: SimEvent[] };
  bout: ReturnType<typeof presentationFor>;
  rests: RestSkeleton[];
  contactMs: number;
  endMs: number;
  label: string;
  tiers: (number | undefined)[];
}

function tierOf(v: string | null): number | undefined {
  return v === null || v === '' ? undefined : Number(v);
}

function techScenario(tier: number | undefined, tierDef?: number): Source {
  const defs = [archetype(A_DEF), archetype(B_DEF)];
  const commit = 1037;
  const actions: SynthAction[] = [];
  if (mode === 'kd') {
    actions.push({ fighter: 0, technique: tech === 'tech.jab' ? 'tech.cross' : tech, commitMs: commit, result: 'landed', knockdown: (str('kd', 'flash') as SynthAction['knockdown']), downMs: num('down', 2500) });
  } else if (tech !== 'stance') {
    actions.push({ fighter: 0, technique: tech, commitMs: commit, result, defence: def || undefined });
  }
  const moves = mode === 'footwork' ? footworkMoves() : [];
  const sc: Scenario = {
    fighters: defs, stances: [stanceA, 'orthodox'], start: [[0, 0], [0, dist]],
    durationMs: mode === 'footwork' ? 8000 : 4500, actions, moves,
    execMult: tier !== undefined ? [[1.5, 1.4, 1.25, 1.0, 0.9, 0.85][Math.round(tier)], 1] : undefined,
    fatigue: [num('fatA', 0), num('fatB', 0)],
    states: [P.get('statesA')?.split(',') ?? [], P.get('statesB')?.split(',') ?? []],
  };
  const sb = buildScenario(sc);
  const ev = sb.events.find((e) => e.kind === 'strike');
  const contact = ev ? ev.tick * 100 + ev.subMs : 1500;
  return {
    sb, bout: sb.bout, rests: sb.rests, contactMs: contact, endMs: sc.durationMs - 100,
    label: tech, tiers: [tier, tierDef],
  };
}

function footworkMoves(): Scenario['moves'] {
  const v = num('fv', 1.2);
  return [
    { fighter: 0, fromMs: 800, toMs: 1800, vx: 0, vz: v * 0.8 },
    { fighter: 0, fromMs: 2100, toMs: 3600, vx: v, vz: 0 },
    { fighter: 0, fromMs: 3900, toMs: 4900, vx: 0, vz: -v * 0.8 },
    { fighter: 0, fromMs: 5200, toMs: 6700, vx: -v, vz: 0 },
  ];
}

let boutCache: { key: string; src: Source } | null = null;
function boutSource(): Source {
  const seed = num('seed', 1);
  const key = `${A_DEF}|${B_DEF}|${seed}`;
  if (boutCache?.key === key) return boutCache.src;
  const defs = [archetype(A_DEF), archetype(B_DEF)];
  const cfg: SimConfig = {
    seed: boutSeed('anim-dev', '1v1', seed), mode: '1v1', fighters: defs, teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
  const r = simulate(cfg, { record: true });
  const runtimes = defs.map(runtimeOf);
  const src: Source = {
    sb: { frames: r.frames!, events: r.events }, bout: presentationFor(defs, runtimes, `bout-${seed}`),
    rests: runtimes.map(restFor), contactMs: num('bt', 10) * 1000, endMs: r.frames![r.frames!.length - 1].t * 1000,
    label: `${defs[0].short} vs ${defs[1].short} · ${r.result.method} ${r.result.totalSeconds.toFixed(0)}s`, tiers: [undefined, undefined],
  };
  // Strip around the N-th event of a kind.
  if (P.has('ev')) {
    const kind = str('evkind', 'strike');
    const list = r.events.filter((e) => e.kind === kind && (kind !== 'strike' || (e as StrikeEvent).detail.result === str('evres', 'landed')));
    const e = list[Math.min(list.length - 1, num('ev', 0))];
    if (e) {
      src.contactMs = e.tick * 100 + e.subMs;
      src.label += ` · ${kind} ${e.text}`;
    }
  }
  boutCache = { key, src };
  return src;
}

function makeAnimator(src: Source): StandingAnimator {
  const an = new StandingAnimator({ tierOverride: (i) => src.tiers[i] });
  an.setBout(src.bout, src.rests);
  return an;
}

/** Run the animator continuously from 0 and capture poses at the requested times. */
function sample(src: Source, times: number[], startMs = 0): Sampled[] {
  const an = makeAnimator(src);
  const out = [createPose(), createPose()];
  const sorted = [...times].map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
  const res: Sampled[] = new Array(times.length);
  let t = Math.max(0, startMs);
  let first = true;
  const step = 1000 / 120;
  for (const { t: want, i } of sorted) {
    while (t < want - 1e-6) {
      const tt = Math.min(want, t + step);
      an.evaluate(frameAt(src.sb, tt, first), step / 1000, out);
      first = false;
      t = tt;
    }
    if (first) { an.evaluate(frameAt(src.sb, want, true), 0, out); first = false; }
    const worlds = out.map((p, k) => forwardKinematics(createWorldPose(), p, src.rests[k]));
    const poses = out.map((p) => { const c = createPose(); copyPose(c, p); return c; });
    const d0 = an.debug(0);
    const aimT = d0.ikTargets.find((x) => x.name === 'aim' || x.name === 'kick');
    res[i] = {
      poses, worlds, aim: aimT ? aimT.pos : null,
      layer: [an.debug(0).layer, an.debug(1).layer], tech: [d0.technique, an.debug(1).technique],
      feet: [0, 1].map((k) => an.fighterState(k)!.feet.map((f) => ({ ball: [f.ball[0], f.ball[1], f.ball[2]] as [number, number, number], planted: !f.swing }))),
    };
  }
  return res;
}

// ---------------------------------------------------------------------------
// Cameras and drawing
// ---------------------------------------------------------------------------

const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);

function aimCamera(c: THREE.PerspectiveCamera, worlds: WorldPose[], aspect: number): void {
  const a = new THREE.Vector3().fromArray(worlds[0].pos, 0);
  const b = worlds[1] ? new THREE.Vector3().fromArray(worlds[1].pos, 0) : a.clone();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = 0.95;
  const axis = b.clone().sub(a);
  axis.y = 0;
  if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1);
  axis.normalize();
  const side = new THREE.Vector3(axis.z, 0, -axis.x);
  const span = Math.max(1.6, a.distanceTo(b) + 1.3);
  const vfov = 30 * Math.PI / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const byW = (span / 2) / Math.tan(hfov / 2);
  const byH = (2.15 / 2) / Math.tan(vfov / 2);
  const dist0 = Math.max(byW, byH) + 0.5;
  let dir: THREE.Vector3;
  switch (view) {
    case 'front': dir = axis.clone().multiplyScalar(-1).add(side.clone().multiplyScalar(-0.65)).add(new THREE.Vector3(0, 0.3, 0)); break;
    case 'back': dir = axis.clone().add(side.clone().multiplyScalar(-0.65)).add(new THREE.Vector3(0, 0.3, 0)); break;
    case 'iso': dir = side.clone().multiplyScalar(-1).add(axis.clone().multiplyScalar(0.8)).add(new THREE.Vector3(0, 0.3, 0)); break;
    case 'top': dir = new THREE.Vector3(0, 1, 0).add(side.clone().multiplyScalar(0.05)); break;
    default: dir = side.clone().multiplyScalar(-1).add(new THREE.Vector3(0, 0.08, 0));
  }
  dir.normalize();
  c.aspect = aspect;
  c.fov = 30;
  c.position.copy(mid).addScaledVector(dir, dist0 * (view === 'top' ? 1.1 : 1));
  c.lookAt(mid);
  c.updateProjectionMatrix();
}

const labels = document.getElementById('labels')!;
function label(text: string, x: number, y: number, small = false): void {
  const d = document.createElement('div');
  d.className = small ? 'lab small' : 'lab';
  d.textContent = text;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  labels.appendChild(d);
}

function drawCell(s: Sampled, x: number, y: number, w: number, h: number, showPrints: boolean): void {
  for (let k = 0; k < 2; k++) {
    if (s.worlds[k]) { figs[k].visible = true; figs[k].update(s.worlds[k]); } else figs[k].visible = false;
  }
  aimMarker.visible = !!s.aim;
  if (s.aim) aimMarker.position.fromArray(s.aim);
  prints.clear();
  if (showPrints) {
    for (let k = 0; k < 2; k++) {
      for (const f of s.feet[k]) {
        if (!f.planted) continue;
        const m = new THREE.Mesh(printGeo, printMat[k]);
        m.rotation.x = -Math.PI / 2;
        m.position.set(f.ball[0], 0.004, f.ball[2]);
        prints.add(m);
      }
    }
  }
  aimCamera(cam, s.worlds, w / h);
  const H = renderer.domElement.height;
  renderer.setViewport(x, H - y - h, w, h);
  renderer.setScissor(x, H - y - h, w, h);
  renderer.render(scene, cam);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function stripTimes(src: Source): number[] {
  const n = num('frames', 6);
  const from = num('from', -260);
  const to = num('to', 450);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(src.contactMs + from + (to - from) * (n === 1 ? 0 : i / (n - 1)));
  return out;
}

function renderStrip(rows: { src: Source; title: string }[]): void {
  labels.innerHTML = '';
  const W = innerWidth, H = innerHeight;
  renderer.setScissor(0, 0, W, H);
  renderer.setViewport(0, 0, W, H);
  renderer.setClearColor(0x0b0d11);
  renderer.clear();
  const n = num('frames', 6);
  const cols = Math.min(n, num('cols', 6));
  const rowsPer = Math.ceil(n / cols);
  const totalRows = rows.length * rowsPer;
  const cw = cellPx || Math.floor(W / cols);
  const ch = Math.floor((H - 24 * rows.length) / totalRows);
  let yy = 0;
  for (const r of rows) {
    label(r.title, 8, yy + 2);
    yy += 22;
    const times = stripTimes(r.src);
    const startMs = mode === 'bout' ? Math.max(0, r.src.contactMs - 3000) : 0;
    const samples = sample(r.src, times, startMs);
    samples.forEach((s, i) => {
      const cx = (i % cols) * cw;
      const cy = yy + Math.floor(i / cols) * ch;
      drawCell(s, cx, cy, cw - 2, ch - 2, true);
      const dt = Math.round(times[i] - r.src.contactMs);
      label(`${dt === 0 ? 'CONTACT' : (dt > 0 ? '+' : '') + dt + ' ms'}`, cx + 6, cy + 4);
      label(`${s.tech[0] ?? '-'}  [${s.layer[0]}]\nB: ${s.layer[1]}`, cx + 6, cy + ch - 34, true);
    });
    yy += rowsPer * ch;
  }
  window.__ready = true;
}

let live: { src: Source; an: StandingAnimator; t: number; playing: boolean; out: Pose[]; lastT: number } | null = null;

function startLive(src: Source): void {
  const t0 = P.has('t') ? num('t', 0) : Math.max(0, src.contactMs - 900);
  live = { src, an: makeAnimator(src), t: t0, playing: !P.has('t'), out: [createPose(), createPose()], lastT: -1 };
  seekLive(t0);
}

function seekLive(ms: number): void {
  if (!live) return;
  // Re-run from a little earlier so footwork state is the one continuous play would have.
  const start = mode === 'bout' ? Math.max(0, ms - 4000) : 0;
  live.an = makeAnimator(live.src);
  let t = start;
  let first = true;
  while (t < ms) {
    t = Math.min(ms, t + 1000 / 60);
    live.an.evaluate(frameAt(live.src.sb, t, first), 1 / 60, live.out);
    first = false;
  }
  if (first) live.an.evaluate(frameAt(live.src.sb, ms, true), 0, live.out);
  live.t = ms;
  live.lastT = ms;
}

function drawLive(): void {
  if (!live) return;
  labels.innerHTML = '';
  const W = innerWidth, H = innerHeight;
  renderer.setClearColor(0x0b0d11);
  const worlds = live.out.map((p, k) => forwardKinematics(createWorldPose(), p, live!.src.rests[k]));
  const d0 = live.an.debug(0);
  const aimT = d0.ikTargets.find((x) => x.name === 'aim' || x.name === 'kick');
  const feet = [0, 1].map((k) => live!.an.fighterState(k)!.feet.map((f) => ({ ball: [f.ball[0], f.ball[1], f.ball[2]] as [number, number, number], planted: !f.swing })));
  drawCell({ poses: live.out, worlds, aim: aimT ? aimT.pos : null, layer: [d0.layer, live.an.debug(1).layer], tech: [d0.technique, null], feet }, 0, 0, W, H, true);
  const dt = Math.round(live.t - live.src.contactMs);
  label(`${live.src.label}   t=${(live.t / 1000).toFixed(3)} s   (${dt >= 0 ? '+' : ''}${dt} ms from contact)`, 270, 10);
  label(`A: ${d0.technique ?? '-'}  [${d0.layer}]   B: [${live.an.debug(1).layer}]\nA tier tags: ${d0.tierRules.join(' ')}`, 270, 30, true);
  (document.getElementById('info') as HTMLElement).textContent = `t ${(live.t / 1000).toFixed(3)} s\nA ${d0.layer}\nB ${live.an.debug(1).layer}`;
  (document.getElementById('scrub') as HTMLInputElement).value = String(Math.round(1000 * live.t / live.src.endMs));
  window.__ready = true;
}

let lastFrame = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (live && live.playing) {
    let t = live.t + dt * 1000 * speed;
    if (t > live.src.endMs) {
      t = mode === 'bout' ? live.src.endMs : 0;
      live.an = makeAnimator(live.src);
      live.an.evaluate(frameAt(live.src.sb, t, true), 0, live.out);
    } else live.an.evaluate(frameAt(live.src.sb, t, false), dt, live.out);
    live.t = t;
  }
  if (live) drawLive();
  requestAnimationFrame(tick);
}

function build(): void {
  window.__ready = false;
  live = null;
  labels.innerHTML = '';
  if (mode === 'strip') {
    renderStrip([{ src: techScenario(tierOf(tierA), tierOf(tierB)), title: `${tech} · ${result}${def ? ' · ' + def : ''} · tier ${tierA ?? 'own'}` }]);
  } else if (mode === 'tiers') {
    renderStrip([
      { src: techScenario(0, tierOf(tierB)), title: `T0 brand new · ${tech} · ${result}` },
      { src: techScenario(5, tierOf(tierB)), title: `T5 champion · ${tech} · ${result}` },
    ]);
  } else if (mode === 'bout') {
    const src = boutSource();
    if (P.has('ev') || P.has('frames')) renderStrip([{ src, title: src.label }]);
    else startLive(src);
  } else if (P.has('frames')) {
    const src = techScenario(tierOf(tierA), tierOf(tierB));
    if (mode === 'footwork') src.contactMs = 0;
    renderStrip([{ src, title: `${mode} · ${tech} · ${mode === 'kd' ? str('kd', 'flash') : result} · tier ${tierA ?? 'own'}` }]);
  } else {
    startLive(techScenario(tierOf(tierA), tierOf(tierB)));
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const techSel = $<HTMLSelectElement>('tech');
techSel.innerHTML = ['stance', ...TECHNIQUES.map((t) => t.id)].map((id) => `<option>${id}</option>`).join('');
const defSel = $<HTMLSelectElement>('defence');
defSel.innerHTML = ['', ...Object.keys(DEFENCE_MOTION)].map((id) => `<option value="${id}">${id || '(recorded none)'}</option>`).join('');
const sync = (): void => {
  $<HTMLSelectElement>('mode').value = mode;
  techSel.value = tech;
  $<HTMLSelectElement>('result').value = result;
  defSel.value = def;
  $<HTMLSelectElement>('tierA').value = tierA ?? '';
  $<HTMLSelectElement>('tierB').value = tierB ?? '';
  $<HTMLSelectElement>('stance').value = stanceA;
  $<HTMLInputElement>('dist').value = String(dist);
  $<HTMLSelectElement>('speed').value = String(speed);
  $<HTMLSelectElement>('viewSel').value = view;
};
sync();
$('apply').onclick = () => {
  mode = $<HTMLSelectElement>('mode').value;
  tech = techSel.value;
  result = $<HTMLSelectElement>('result').value as SynthAction['result'];
  def = defSel.value;
  tierA = $<HTMLSelectElement>('tierA').value || null;
  tierB = $<HTMLSelectElement>('tierB').value || null;
  stanceA = $<HTMLSelectElement>('stance').value as 'orthodox' | 'southpaw';
  dist = Number($<HTMLInputElement>('dist').value);
  build();
};
$<HTMLSelectElement>('speed').onchange = (e) => { speed = Number((e.target as HTMLSelectElement).value); };
$<HTMLSelectElement>('viewSel').onchange = (e) => { view = (e.target as HTMLSelectElement).value; if (!live) build(); };
$('play').onclick = () => { if (live) { live.playing = !live.playing; $('play').textContent = live.playing ? 'Pause' : 'Play'; } };
$('stepF').onclick = () => { if (live) { live.playing = false; live.t += 1000 / 60; live.an.evaluate(frameAt(live.src.sb, live.t, false), 1 / 60, live.out); } };
$('stepB').onclick = () => { if (live) { live.playing = false; seekLive(Math.max(0, live.t - 1000 / 60)); } };
$<HTMLInputElement>('scrub').oninput = (e) => {
  if (!live) return;
  live.playing = false;
  seekLive(Number((e.target as HTMLInputElement).value) / 1000 * live.src.endMs);
};
if (P.get('panel') === '0') $('panel').classList.add('hidden');
window.__seek = (ms: number) => { if (live) { live.playing = false; seekLive(ms); drawLive(); } };
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); if (!live) build(); });

build();
requestAnimationFrame(tick);
void B;
void BONE_PARENT;
void ARCHETYPES;
