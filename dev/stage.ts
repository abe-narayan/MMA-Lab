/**
 * Stage pipeline test scene (dev/stage.html).
 *
 * Proves each post pass works and measures what it costs:
 *   - a roughness (x) × metalness (y) sphere grid for the PBR response;
 *   - an emissive truss fixture and corner-colour LED strips for bloom;
 *   - two skin-toned spheres (light and dark) for the grade's skin protection;
 *   - a fast orbiting cube for TAA ghosting and replay motion blur;
 *   - a white canvas floor for the "clean whites" check and contact AO.
 *
 * URL: ?q=high&scale=0.7&tm=aces&aa=taau&replay=1&ao=0&bloom=0&... &panel=0
 *      ?backend=webgl2 forces the fallback. `window.__bench()` measures every
 *      pass (logs a table), `window.__stats` exposes the live numbers.
 */
import {
  BoxGeometry, CylinderGeometry, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial,
  PMREMGenerator, SphereGeometry, SpotLight, Color, CircleGeometry, Group, Node,
} from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Stage, qualitySettings, isQualityLevel, FrameMeter, requestedBackend, type PassToggles,
} from '../src/presentation/stage';
import type { QualityLevel } from '../src/presentation/contract';

const params = new URLSearchParams(location.search);
if (params.get('trace') === '1') (Node as unknown as { captureStackTrace: boolean }).captureStackTrace = true;
const level: QualityLevel = isQualityLevel(params.get('q')) ? params.get('q') as QualityLevel : 'high';
const scaleParam = params.get('scale');
const quality = qualitySettings(level, scaleParam ? Number(scaleParam) : undefined);

const TOGGLE_KEYS: (keyof PassToggles)[] = ['ao', 'ssr', 'bloom', 'dof', 'motionBlur', 'grade', 'sharpen', 'vignetteGrain'];
const overrides: Partial<PassToggles> = {};
for (const k of TOGGLE_KEYS) {
  const v = params.get(k);
  if (v !== null) (overrides as Record<string, boolean>)[k] = v === '1' || v === 'true';
}
const aaParam = params.get('aa');
if (aaParam) overrides.aa = aaParam as PassToggles['aa'];
let replay = params.get('replay') === '1';

const view = document.getElementById('view')!;
const panel = document.getElementById('panel')!;
if (params.get('panel') === '0') panel.classList.add('hidden');

const stage = await Stage.create(view, {
  backend: requestedBackend(),
  quality,
  toggles: overrides,
  fixedResolution: true,
  trackTimestamp: params.get('ts') === '1',
});
const tm = (params.get('tm') ?? 'aces') as 'agx' | 'aces' | 'neutral';
stage.setToneMapping(tm, Number(params.get('exposure') ?? 1));
stage.setReplay(replay);

// ---- scene ------------------------------------------------------------------
const { scene } = stage;
const pmrem = new PMREMGenerator(stage.renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.25;
scene.background = new Color(0x07080b);

const floor = new Mesh(
  new CircleGeometry(9, 64),
  new MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.88 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Roughness × metalness grid.
const grid = new Group();
const sphere = new SphereGeometry(0.17, 48, 24);
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 4; j++) {
    const m = new Mesh(sphere, new MeshStandardMaterial({
      color: j < 2 ? 0xb8b8b8 : 0xc9a24a,
      roughness: 0.05 + (i / 5) * 0.9,
      metalness: j % 2 === 0 ? 0 : 1,
    }));
    m.position.set(-1.1 + i * 0.44, 0.45 + j * 0.44, -1.6);
    m.castShadow = true;
    m.receiveShadow = true;
    grid.add(m);
  }
}
scene.add(grid);

// Skin: a light and a dark tone (sRGB values from the Fitzpatrick II and V range).
const skinA = new Mesh(new SphereGeometry(0.34, 64, 32), new MeshStandardMaterial({ color: new Color().setRGB(0.86, 0.64, 0.52, 'srgb'), roughness: 0.55 }));
skinA.position.set(1.7, 0.34, -0.3);
const skinB = new Mesh(new SphereGeometry(0.34, 64, 32), new MeshStandardMaterial({ color: new Color().setRGB(0.42, 0.27, 0.19, 'srgb'), roughness: 0.5 }));
skinB.position.set(2.45, 0.34, -0.9);
for (const s of [skinA, skinB]) { s.castShadow = true; s.receiveShadow = true; scene.add(s); }

// A standing "fighter" proxy for scale and contact shadows.
const body = new Mesh(new CylinderGeometry(0.17, 0.14, 1.75, 32), new MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.7 }));
body.position.set(-1.9, 0.875, -0.2);
body.castShadow = true;
scene.add(body);

// Emissive truss fixture and LED strips (bloom sources).
const fixture = new Mesh(new BoxGeometry(1.6, 0.06, 0.35), new MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4e6, emissiveIntensity: 12 }));
fixture.position.set(0, 3.1, -2.6);
scene.add(fixture);
const ledRed = new Mesh(new BoxGeometry(1.4, 0.05, 0.05), new MeshStandardMaterial({ color: 0x000000, emissive: 0xd8202c, emissiveIntensity: 5 }));
ledRed.position.set(-2.4, 0.03, 0.8);
const ledBlue = new Mesh(new BoxGeometry(1.4, 0.05, 0.05), new MeshStandardMaterial({ color: 0x000000, emissive: 0x2050e0, emissiveIntensity: 5 }));
ledBlue.position.set(2.4, 0.03, 0.8);
scene.add(ledRed, ledBlue);

// Fast mover for TAA ghosting and motion blur.
const mover = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshStandardMaterial({ color: 0xc8202a, roughness: 0.4 }));
mover.castShadow = true;
scene.add(mover);

// Lights: camera-side key with shadows, a ring of overhead spots, cool rims, bounce.
const key = new DirectionalLight(0xfff6ee, 1.3);
key.position.set(2.5, 8, 5);
key.castShadow = true;
key.shadow.camera.left = -5; key.shadow.camera.right = 5;
key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
key.shadow.camera.near = 1; key.shadow.camera.far = 20;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
for (let k = 0; k < 6; k++) {
  const a = (k / 6) * Math.PI * 2;
  const s = new SpotLight(0xfff3e8, 28, 16, 0.5, 0.5, 2);
  s.position.set(Math.sin(a) * 4, 7, Math.cos(a) * 4);
  s.target.position.set(0, 0, 0);
  scene.add(s, s.target);
}
const rim = new SpotLight(0xbcd4ff, 30, 20, 0.5, 0.6, 2);
rim.position.set(-6, 4, -6);
scene.add(rim);
scene.add(new HemisphereLight(0x1a1d24, 0x6b5d4c, 0.35));
stage.applyShadowPolicy(scene);

// ---- camera ------------------------------------------------------------------
const cam = { position: [0.4, 1.75, 5.6] as [number, number, number], target: [0.1, 0.8, -0.6] as [number, number, number] };
let cutFlag = false;
function setCamera(): void {
  stage.setCameraState({
    position: cam.position, target: cam.target, fovDeg: 42, rollRad: 0,
    focusM: 4.2, dof: replay ? 1 : 0, cut: cutFlag, shotName: 'TEST',
  });
  cutFlag = false;
}

// ---- loop --------------------------------------------------------------------
const meter = new FrameMeter();
let frame = 0;
function animate(i: number): void {
  const t = i / 60;
  mover.position.set(Math.sin(t * 3.2) * 2.6, 1.1, Math.cos(t * 3.2) * 1.2 + 0.4);
  mover.rotation.set(t * 4, t * 3, 0);
}

function publishStats(): void {
  const info = stage.info();
  (window as unknown as { __stats: unknown }).__stats = {
    backend: stage.backend, level: stage.quality.level, fps: Math.round(meter.fps * 10) / 10,
    frameMs: Math.round(meter.frameMs * 100) / 100, drawCalls: info.drawCalls, triangles: info.triangles,
    internalWidth: info.internalWidth, internalHeight: info.internalHeight,
    outputWidth: info.outputWidth, outputHeight: info.outputHeight, toggles: stage.toggles,
  };
  const s = (window as unknown as { __stats: Record<string, unknown> }).__stats;
  document.getElementById('stats')!.textContent =
    `${s.backend}  ${s.level}\n${s.fps} fps  ${s.frameMs} ms\n${info.internalWidth}×${info.internalHeight} → ${info.outputWidth}×${info.outputHeight}\n${info.drawCalls} draws  ${info.triangles} tris`;
}

let benchmarking = false;
function loop(now: number): void {
  if (!benchmarking) {
    animate(frame++);
    setCamera();
    stage.render();
    meter.tick(now);
    if (frame % 10 === 0) publishStats();
  }
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => stage.resize());
requestAnimationFrame(loop);
stage.warmUp();

// ---- panel ------------------------------------------------------------------
const bSel = document.getElementById('backend') as HTMLSelectElement;
bSel.value = requestedBackend();
bSel.onchange = () => { params.set('backend', bSel.value); location.search = params.toString(); };
const qSel = document.getElementById('quality') as HTMLSelectElement;
qSel.value = level;
qSel.onchange = () => { params.set('q', qSel.value); params.delete('scale'); location.search = params.toString(); };
const tmSel = document.getElementById('tm') as HTMLSelectElement;
tmSel.value = tm;
tmSel.onchange = () => stage.setToneMapping(tmSel.value as 'agx', 1);
const aaSel = document.getElementById('aa') as HTMLSelectElement;
aaSel.value = aaParam ?? '';
aaSel.onchange = () => { if (aaSel.value) params.set('aa', aaSel.value); else params.delete('aa'); location.search = params.toString(); };
const toggles = document.getElementById('toggles')!;
for (const k of [...TOGGLE_KEYS, 'replay'] as const) {
  const lab = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = k === 'replay' ? replay : stage.toggles[k];
  cb.onchange = () => {
    if (k === 'replay') { replay = cb.checked; stage.setReplay(replay); return; }
    stage.setQuality(stage.quality, { ...stage.toggles, [k]: cb.checked });
    stage.applyShadowPolicy(scene);
  };
  lab.append(cb, k);
  toggles.append(lab);
}
document.getElementById('cut')!.onclick = () => {
  cutFlag = true;
  cam.position = cam.position[0] > 0 ? [-3.8, 1.4, 3.6] : [0.4, 1.75, 5.6];
};

// ---- benchmark ----------------------------------------------------------------
async function measure(label: string, t: Partial<PassToggles>, replayOn: boolean): Promise<{ label: string; ms: number }> {
  stage.setQuality(stage.quality, t);
  stage.applyShadowPolicy(scene);
  stage.setReplay(replayOn);
  replay = replayOn;
  setCamera();
  // Warm-up: compile shaders and fill temporal history.
  for (let i = 0; i < 20; i++) { animate(i); stage.render(); }
  await stage.benchmark(5, animate);
  const ms = await stage.benchmark(90, animate);
  return { label, ms: Math.round(ms * 100) / 100 };
}

async function bench(): Promise<unknown> {
  benchmarking = true;
  const base = { ...stage.toggles };
  const rows: { label: string; ms: number }[] = [];
  rows.push(await measure('full live', base, false));
  if (base.ao) rows.push(await measure('- ao', { ...base, ao: false }, false));
  if (base.bloom) rows.push(await measure('- bloom', { ...base, bloom: false }, false));
  if (base.grade) rows.push(await measure('- grade', { ...base, grade: false }, false));
  if (base.sharpen) rows.push(await measure('- sharpen', { ...base, sharpen: false }, false));
  if (base.vignetteGrain) rows.push(await measure('- vignette/grain', { ...base, vignetteGrain: false }, false));
  rows.push(await measure('aa none', { ...base, aa: 'none', sharpen: false }, false));
  rows.push(await measure('+ ssr', { ...base, ssr: true }, false));
  rows.push(await measure('replay dof', { ...base, dof: true, motionBlur: false }, true));
  rows.push(await measure('replay mb', { ...base, dof: false, motionBlur: true }, true));
  rows.push(await measure('replay dof+mb', { ...base, dof: true, motionBlur: true }, true));
  rows.push(await measure('no post (aa none, all off)', { ao: false, ssr: false, bloom: false, aa: 'none', dof: false, motionBlur: false, grade: false, sharpen: false, vignetteGrain: false }, false));
  stage.setQuality(stage.quality, base);
  stage.applyShadowPolicy(scene);
  replay = false;
  stage.setReplay(false);
  const info = stage.info();
  const result = { backend: stage.backend, level: stage.quality.level, internal: `${info.internalWidth}x${info.internalHeight}`, output: `${info.outputWidth}x${info.outputHeight}`, rows };
  console.log('BENCH ' + JSON.stringify(result));
  benchmarking = false;
  return result;
}
(window as unknown as { __bench: () => Promise<unknown> }).__bench = bench;
document.getElementById('bench')!.onclick = () => { void bench(); };
(window as unknown as { __ready: boolean }).__ready = true;
