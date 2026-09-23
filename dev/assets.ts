/**
 * Asset viewer (dev/assets.html).
 *
 * Motion view: plays any clip of the mocap library on a capsule body built from
 * the canonical rest skeleton, through the real runtime (`MotionLibrary.sample`
 * → `forwardKinematics`). The +Z opponent is a translucent post; the contact
 * frame is marked on the timeline and the striking end effector turns red at
 * contact; planted feet turn green.
 *
 * Texture view: every PBR set on a sphere and a tile under the chosen HDRI.
 *
 * URL parameters
 *   ?clip=punch.jab.orthodox&t=0.4   clip and a fixed time (seconds; pauses)
 *   ?t=contact | start | end | hold  jump to a marker
 *   ?cam=side|iso|front|back|top|other-side  ?mirror=1  ?inplace=1  ?onion=1  ?play=1  ?speed=0.25
 *   ?sheet=punch.jab.orthodox,punch.cross.orthodox,...   a grid of clips at their contact frames
 *   ?view=textures&hdri=arena|street|gym&exposure=1
 *   ?panel=0   hide the side panel (for screenshots)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  B, BONES, BONE_PARENT, createPose, createWorldPose, defaultRest, forwardKinematics,
  type Pose, type WorldPose,
} from '../src/presentation/rig/skeleton';
import { loadMotionLibrary, type MotionClipInfo, type MotionLibrary } from '../src/presentation/assets/motionLibrary';
import { ASSETS, type HdriName, type TextureName } from '../src/presentation/assets/manifest';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
declare global { interface Window { __ready?: boolean; __stats?: unknown } }

if (params.get('panel') === '0') $('panel').classList.add('hidden');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0.3);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const view = params.get('view') === 'textures' ? 'textures' : 'motion';
($('viewSel') as HTMLSelectElement).value = view;
$('viewSel').addEventListener('change', (e) => {
  params.set('view', (e.target as HTMLSelectElement).value);
  location.search = params.toString();
});

// ---------------------------------------------------------------------------
// Capsule body
// ---------------------------------------------------------------------------

const rest = defaultRest();
const DRAWN = BONES.map((n, i) => i).filter((i) => !/Hand(Index|Middle|Ring|Pinky|Thumb)/.test(BONES[i]));
const RADIUS: Record<string, number> = {
  Hips: 0.11, Spine: 0.12, Spine1: 0.13, Spine2: 0.14, Neck: 0.05, Head: 0.1,
  LeftShoulder: 0.05, RightShoulder: 0.05, LeftArm: 0.05, RightArm: 0.05, LeftForeArm: 0.042, RightForeArm: 0.042,
  LeftHand: 0.05, RightHand: 0.05, LeftUpLeg: 0.075, RightUpLeg: 0.075, LeftLeg: 0.055, RightLeg: 0.055,
  LeftFoot: 0.045, RightFoot: 0.045, LeftToeBase: 0.035, RightToeBase: 0.035,
};

/**
 * Each bone's rest-pose geometry (joint at the origin, pointing from its rest
 * head to its rest tail) placed with the bone's world position and rotation.
 * Under the identity-rest convention that is exactly what a skinned mesh does,
 * so twist is visible: hands are flat boxes with a yellow knuckle stripe on the
 * back of the hand (up in the T-pose), feet are boxes with the sole down.
 */
class CapsuleBody {
  readonly group = new THREE.Group();
  private readonly limbs: { bone: number; mesh: THREE.Mesh }[] = [];
  readonly mats = new Map<number, THREE.MeshStandardMaterial>();
  constructor(color: number, opacity = 1) {
    const mk = (c: number) => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.55, metalness: 0.05, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    for (const i of DRAWN) {
      const name = BONES[i];
      const side = name.startsWith('Left') ? 0x2f7de1 : name.startsWith('Right') ? 0xe0443a : color;
      const mat = mk(side);
      this.mats.set(i, mat);
      const r = RADIUS[name] ?? 0.04;
      const len = rest.length[i];
      const dir = new THREE.Vector3(
        rest.tail[i * 3] - rest.head[i * 3], rest.tail[i * 3 + 1] - rest.head[i * 3 + 1], rest.tail[i * 3 + 2] - rest.head[i * 3 + 2],
      );
      const mid = dir.clone().multiplyScalar(0.5);
      let geo: THREE.BufferGeometry;
      if (name === 'Head') geo = new THREE.SphereGeometry(r * 1.05, 20, 14).translate(mid.x, mid.y * 0.9, mid.z);
      else if (name.endsWith('Hand')) geo = new THREE.BoxGeometry(Math.abs(dir.x) + 0.02, 0.035, 0.085).translate(mid.x, mid.y, mid.z);
      else if (name.endsWith('Foot')) geo = new THREE.BoxGeometry(0.085, 0.05, Math.abs(dir.z) + 0.03).translate(mid.x, -0.035, mid.z + 0.01);
      else if (name.endsWith('ToeBase')) geo = new THREE.BoxGeometry(0.08, 0.03, Math.abs(dir.z) + 0.02).translate(mid.x, mid.y + 0.004, mid.z);
      else {
        geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 0.6), 6, 14)
          .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()))
          .translate(mid.x, mid.y, mid.z);
      }
      this.add(i, geo, mat, opacity);
      if (name.endsWith('Hand')) {
        const k = new THREE.BoxGeometry(0.018, 0.012, 0.07).translate(mid.x + Math.sign(dir.x) * (Math.abs(dir.x) / 2 + 0.005), mid.y + 0.022, mid.z);
        this.add(i, k, mk(0xffd34d), opacity);
      }
    }
    // a nose so facing is obvious (head rest frame: +Z forward)
    const h = B.head;
    const nose = new THREE.ConeGeometry(0.025, 0.07, 10).rotateX(Math.PI / 2)
      .translate(0, (rest.tail[h * 3 + 1] - rest.head[h * 3 + 1]) * 0.45, 0.11);
    this.add(h, nose, mk(0xffd34d), opacity);
  }
  private add(bone: number, geo: THREE.BufferGeometry, mat: THREE.Material, opacity: number): void {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = opacity >= 1;
    this.group.add(mesh);
    this.limbs.push({ bone, mesh });
  }
  update(w: WorldPose): void {
    for (const { bone: i, mesh } of this.limbs) {
      mesh.position.set(w.pos[i * 3], w.pos[i * 3 + 1], w.pos[i * 3 + 2]);
      mesh.quaternion.set(w.quat[i * 4], w.quat[i * 4 + 1], w.quat[i * 4 + 2], w.quat[i * 4 + 3]);
    }
  }
}

// ---------------------------------------------------------------------------
// Motion view
// ---------------------------------------------------------------------------

async function motionView(): Promise<void> {
  $('texUi').hidden = true;
  scene.background = new THREE.Color(0x14171d);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303030, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 5, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 80, 0x5a6270, 0x454b56);
  grid.position.y = 0.001;
  scene.add(grid);
  // opponent post at +Z
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 24).translate(0, 0.9, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
  post.position.set(0, 0, 1.05);
  scene.add(post);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.005, 0), 0.8, 0xffd34d, 0.12, 0.07);
  scene.add(arrow);

  const lib = await loadMotionLibrary();
  const sheet = params.get('sheet');
  if (sheet) return sheetView(lib, sheet.split(','));

  const sel = $('clip') as HTMLSelectElement;
  for (const c of lib.clips) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.id}${c.mirrorOf ? ' (mirror)' : ''}`;
    sel.appendChild(o);
  }
  let clipId = params.get('clip') ?? 'punch.jab.orthodox';
  if (!lib.has(clipId)) clipId = lib.clips[0].id;
  sel.value = clipId;

  const body = new CapsuleBody(0xd8d2c8);
  scene.add(body.group);
  const onion = [new CapsuleBody(0x8899aa, 0.22), new CapsuleBody(0xff5544, 0.3), new CapsuleBody(0x8899aa, 0.22)];
  for (const o of onion) scene.add(o.group);
  const contactDot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  scene.add(contactDot);
  const pose: Pose = createPose();
  const world = createWorldPose();
  const slider = $('time') as HTMLInputElement;
  let info: MotionClipInfo = lib.info(clipId);
  let t = 0;
  let playing = params.get('play') === '1';
  const tParam = params.get('t');
  const markerTime = (m: string | null): number | null => {
    if (!m) return null;
    const mk = info.markers as Record<string, number> | undefined;
    if (mk && typeof mk[m] === 'number') return mk[m] / info.fps;
    const v = Number(m);
    return Number.isFinite(v) ? v : null;
  };
  const opts = () => ({
    mirror: ($('mirror') as HTMLInputElement).checked,
    rootMotion: ($('inplace') as HTMLInputElement).checked ? 'inPlace' as const : 'full' as const,
  });
  ($('mirror') as HTMLInputElement).checked = params.get('mirror') === '1';
  ($('inplace') as HTMLInputElement).checked = params.get('inplace') === '1';
  ($('onion') as HTMLInputElement).checked = params.get('onion') === '1';
  ($('speed') as HTMLSelectElement).value = params.get('speed') ?? '1';
  ($('cam') as HTMLSelectElement).value = params.get('cam') ?? 'side';

  const setClip = (id: string) => {
    clipId = id;
    info = lib.info(id);
    slider.max = String(info.duration);
    t = 0;
    drawTimeline();
    describe();
    placeOnion();
  };
  const describe = () => {
    const m = info.markers ?? {};
    $('info').textContent = [
      `${info.id}${info.mirrorOf ? `  ← mirror of ${info.mirrorOf}` : ''}`,
      `${info.kind}  ${info.stance}  ${info.frames} f @ ${info.fps} fps  ${info.duration.toFixed(2)} s${info.loop ? '  LOOP' : ''}`,
      info.limb ? `limb ${info.limb} (${info.limbRole})` : '',
      Object.keys(m).length ? `markers ${JSON.stringify(m)}` : '',
      info.techniques ? `portrays ${info.techniques.join(', ')}` : '',
      info.approximates ? `stand-in for ${info.approximates.join(', ')}` : '',
      `plants L ${JSON.stringify(info.footPlants.left)}  R ${JSON.stringify(info.footPlants.right)}`,
      `root Δ ${info.rootMotion.displacement.join(', ')} m`,
      `source ${info.take} [${info.takeFrames.join('–')}] ${info.licence}`,
    ].filter(Boolean).join('\n');
    $('title').textContent = `${info.id}${info.mirrorOf ? ' (mirrored)' : ''}`;
  };
  const drawTimeline = () => {
    const cv = $('timeline') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const x = (f: number) => (f / Math.max(1, info.frames - 1)) * W;
    const plants = (iv: [number, number][], y: number, col: string) => {
      g.fillStyle = col;
      for (const [a, b] of iv) g.fillRect(x(a), y, Math.max(2, x(b) - x(a)), 12);
    };
    plants(info.footPlants.left, 6, '#2f7de1');
    plants(info.footPlants.right, 22, '#e0443a');
    const m = info.markers ?? {};
    const mark = (f: number | undefined, col: string) => {
      if (f === undefined) return;
      g.fillStyle = col;
      g.fillRect(x(f) - 1.5, 0, 3, H);
    };
    mark(m.start, '#9aa');
    mark(m.end, '#9aa');
    mark(m.contact, '#ff2a2a');
    mark(m.hold, '#ffcc33');
    g.fillStyle = '#ddd';
    g.fillRect(x(t * info.fps) - 1, 40, 2, H - 40);
  };
  const placeOnion = () => {
    const show = ($('onion') as HTMLInputElement).checked && !!info.markers;
    const m = info.markers ?? {};
    const frames = [m.start, m.contact ?? m.hold, m.end];
    onion.forEach((o, k) => {
      const f = frames[k];
      o.group.visible = show && f !== undefined;
      if (!o.group.visible) return;
      lib.sample(clipId, f! / info.fps, pose, opts());
      forwardKinematics(world, pose, rest);
      o.update(world);
    });
  };
  sel.addEventListener('change', () => setClip(sel.value));
  slider.addEventListener('input', () => { t = Number(slider.value); playing = false; });
  $('play').addEventListener('click', () => { playing = !playing; });
  for (const id of ['mirror', 'inplace', 'onion']) $(id).addEventListener('change', placeOnion);
  $('cam').addEventListener('change', () => setCam(($('cam') as HTMLSelectElement).value));

  setClip(clipId);
  const t0 = markerTime(tParam);
  if (t0 !== null) { t = t0; playing = params.get('play') === '1'; }
  setCam(($('cam') as HTMLSelectElement).value);

  const contactF = () => info.markers?.contact;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      t += dt * Number(($('speed') as HTMLSelectElement).value);
      if (t > info.duration) t = info.loop ? t % info.duration : 0;
    }
    slider.value = String(t);
    lib.sample(clipId, t, pose, opts());
    forwardKinematics(world, pose, rest);
    body.update(world);
    // striking limb red near contact; planted feet green
    const f = Math.round(t * info.fps);
    for (const [i, mat] of body.mats) {
      const name = BONES[i];
      mat.emissive.setHex(0x000000);
      if (info.limb && contactF() !== undefined && Math.abs(f - contactF()!) <= 1) {
        const limbBone = info.limb.endsWith('Hand') ? [info.limb, info.limb.replace('Hand', 'ForeArm')] : [info.limb, info.limb.replace('Foot', 'Leg'), info.limb.replace('Foot', 'ToeBase')];
        const eff = opts().mirror ? limbBone.map((n) => (n.startsWith('Left') ? `Right${n.slice(4)}` : `Left${n.slice(5)}`)) : limbBone;
        if (eff.includes(name)) mat.emissive.setHex(0xaa0000);
      }
      for (const side of ['left', 'right'] as const) {
        const nm = side === 'left' ? ['LeftFoot', 'LeftToeBase'] : ['RightFoot', 'RightToeBase'];
        const eff = opts().mirror ? (side === 'left' ? 'right' : 'left') : side;
        if (nm.includes(name) && info.footPlants[eff].some(([a, b]) => f >= a && f <= b)) mat.emissive.setHex(0x117711);
      }
    }
    const cp = info.markers?.contactPoint;
    contactDot.visible = !!cp;
    if (cp) contactDot.position.set(opts().mirror ? -cp[0] : cp[0], cp[1], cp[2]);
    drawTimeline();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__stats = { clips: lib.clips.length };
  setTimeout(() => { window.__ready = true; }, 300);
}

function setCam(kind: string): void {
  const tgt = new THREE.Vector3(0, 0.95, 0.3);
  const d = 4.2;
  const pos: Record<string, [number, number, number]> = {
    side: [d, 1.2, 0.3], 'other-side': [-d, 1.2, 0.3], front: [0.4, 1.3, d], back: [0.3, 1.5, -d],
    iso: [d * 0.72, 1.9, d * 0.72], top: [0.01, d * 1.5, 0.3],
  };
  const p = pos[kind] ?? pos.side;
  camera.position.set(p[0], p[1], p[2]);
  controls.target.copy(tgt);
  camera.lookAt(tgt);
}

/** Grid of clips frozen at their contact (or hold / middle) frame, one viewport per clip. */
function sheetView(lib: MotionLibrary, ids: string[]): void {
  const cells = ids.map((c) => { const [id, at] = c.split('@'); return { id, at: at === undefined ? null : Number(at) }; })
    .filter((c) => lib.has(c.id));
  ids = cells.map((c) => c.id);
  const n = ids.length;
  const cols = Math.ceil(Math.sqrt(n * (innerWidth / innerHeight) * 0.75));
  const rows = Math.ceil(n / cols);
  const pose = createPose();
  const world = createWorldPose();
  const which = params.get('t') ?? 'contact';
  const bodies = ids.map((id, k) => {
    const info = lib.info(id);
    const m = (info.markers ?? {}) as Record<string, number>;
    const at = cells[k].at;
    const f = at !== null ? Math.round(at * info.fps) : m[which] ?? m.contact ?? m.hold ?? Math.floor(info.frames / 2);
    lib.sample(id, f / info.fps, pose, { rootMotion: 'inPlace' });
    forwardKinematics(world, pose, rest);
    const b = new CapsuleBody(0xd8d2c8);
    b.update(world);
    b.group.visible = false;
    scene.add(b.group);
    return { b, f };
  });
  const cw = innerWidth / cols, ch = innerHeight / rows;
  ids.forEach((id, k) => {
    const label = document.createElement('div');
    label.className = 'tex-label';
    label.style.transform = 'none';
    label.textContent = `${id}  f${bodies[k].f}`;
    label.style.left = `${(k % cols) * cw + 6}px`;
    label.style.top = `${Math.floor(k / cols) * ch + 6}px`;
    document.body.appendChild(label);
  });
  $('title').hidden = true;
  const cellCam = new THREE.PerspectiveCamera(30, cw / ch, 0.05, 100);
  const camKind = params.get('cam') ?? 'iso';
  const dir: Record<string, [number, number, number]> = {
    iso: [0.72, 0.3, 0.72], side: [1, 0.2, 0], 'other-side': [-1, 0.2, 0], front: [0.1, 0.2, 1], back: [0.1, 0.3, -1], top: [0.01, 1, 0.05],
  };
  const d = dir[camKind] ?? dir.iso;
  const dist = Math.max(3.6, 5.4 * Math.min(1, ch / cw));
  cellCam.position.set(d[0] * dist, 0.95 + d[1] * dist, 0.25 + d[2] * dist);
  cellCam.lookAt(0, 0.9, 0.25);
  renderer.setScissorTest(true);
  const H = renderer.domElement.clientHeight;
  bodies.forEach(({ b }, k) => {
    const c = k % cols, r = Math.floor(k / cols);
    bodies.forEach((o) => { o.b.group.visible = o.b === b; });
    renderer.setViewport(c * cw, H - (r + 1) * ch, cw, ch);
    renderer.setScissor(c * cw, H - (r + 1) * ch, cw, ch);
    renderer.render(scene, cellCam);
  });
  renderer.setScissorTest(false);
  setTimeout(() => { window.__ready = true; }, 300);
}
const labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];

// ---------------------------------------------------------------------------
// Texture view
// ---------------------------------------------------------------------------

async function textureView(): Promise<void> {
  $('motionUi').hidden = true;
  $('texUi').hidden = false;
  const hdriName = (params.get('hdri') ?? 'arena') as HdriName;
  ($('hdri') as HTMLSelectElement).value = hdriName;
  $('hdri').addEventListener('change', (e) => { params.set('hdri', (e.target as HTMLSelectElement).value); location.search = params.toString(); });
  const exposure = Number(params.get('exposure') ?? '1');
  renderer.toneMappingExposure = exposure;
  ($('exposure') as HTMLInputElement).value = String(exposure);
  $('exposure').addEventListener('input', (e) => { renderer.toneMappingExposure = Number((e.target as HTMLInputElement).value); });

  const h = ASSETS.hdri[hdriName];
  const hdr = await new HDRLoader().loadAsync(h.url2k && params.get('res') === '2k' ? h.url2k : h.url1k);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  scene.background = hdr;
  scene.backgroundBlurriness = 0.25;
  scene.backgroundIntensity = 0.6;

  const loader = new THREE.TextureLoader();
  const load = (url: string, srgb: boolean) => {
    const t = loader.load(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const names = Object.keys(ASSETS.textures) as TextureName[];
  const tint: Partial<Record<TextureName, number>> = { leather: 0xc21d1d, satin: 0x1d3fc2 };
  names.forEach((name, k) => {
    const s = ASSETS.textures[name];
    const mat = new THREE.MeshStandardMaterial({
      map: load(s.color, true), normalMap: load(s.normal, false), roughnessMap: load(s.roughness, false),
      aoMap: load(s.ao, false), color: tint[name] ?? 0xffffff,
      metalness: s.metalness ? 1 : 0, metalnessMap: s.metalness ? load(s.metalness, false) : null,
    });
    const col = k % 4, row = Math.floor(k / 4);
    const x = (col - 1.5) * 1.35, z = (row - 0.5) * -1.6;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.45, 64, 48), mat);
    sphere.position.set(x, 0.95, z);
    scene.add(sphere);
    const tile = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.6), mat);
    tile.position.set(x, 0.3, z + 0.1);
    tile.rotation.x = 0.35;
    scene.add(tile);
    const label = document.createElement('div');
    label.className = 'tex-label';
    label.textContent = `${name} — ${s.id.replace('tex.polyhaven.', '')}`;
    document.body.appendChild(label);
    labels.push({ el: label, pos: new THREE.Vector3(x, 1.55, z) });
  });
  $('title').textContent = `HDRI: ${h.id.replace('hdri.polyhaven.', '')}`;
  $('info').textContent = `${h.role}\n${h.url1k}`;
  camera.position.set(0, 2.6, 7.4);
  controls.target.set(0, 0.7, -0.35);
  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    for (const l of labels) {
      const v = l.pos.clone().project(camera);
      l.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      l.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  THREE.DefaultLoadingManager.onLoad = () => { window.__ready = true; };
  setTimeout(() => { window.__ready = true; }, 8000);
}

void BONE_PARENT;
(view === 'textures' ? textureView() : motionView()).catch((e) => {
  $('info').textContent = String(e?.stack ?? e);
  console.error(e);
});
