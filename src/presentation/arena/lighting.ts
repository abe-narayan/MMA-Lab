/**
 * Lighting rigs.
 *
 * Broadcast (octagon, ring): the cage is an island of hard white light under a
 * square truss. One shadow-casting key hangs almost straight above the centre
 * (short, hard-edged shadows directly under the fighters, brow and eye-socket
 * shadow on faces). Everything else is image-based (environment.ts): four
 * fixture banks at the truss corners put light into faces and onto shoulders
 * from every side, the lit canvas below is the bounce fill under chins and
 * arms, and the fixture dots are the specular highlights on sweat. Nothing lights the crowd: the stands use their
 * own fake spill in the crowd shader so the bowl falls away to near black.
 *
 * Units: three.js physically based lights (candela for spot lights, decay 2).
 * Exposure 1.0 through the stage's ACES filmic puts the lit canvas at roughly
 * 0.85-0.92 display white — the brightest large surface in frame, as on television.
 */
import * as THREE from 'three/webgpu';
import type { QualitySettings } from '../contract';
import type { SetKind } from './geometry';

/** Colour temperature (K) to linear RGB, Tanner Helland's fit, normalised. */
export function kelvin(k: number): THREE.Color {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = new THREE.Color().setRGB(
    Math.min(255, Math.max(0, r)) / 255,
    Math.min(255, Math.max(0, g)) / 255,
    Math.min(255, Math.max(0, b)) / 255,
    THREE.SRGBColorSpace,
  );
  const m = Math.max(c.r, c.g, c.b);
  return c.multiplyScalar(1 / m);
}

export interface Rig {
  group: THREE.Group;
  /** Lights that may cast shadows under the current quality. */
  shadowCasters: THREE.SpotLight[];
  setQuality(q: QualitySettings): void;
  dispose(): void;
}

function configureShadow(l: THREE.SpotLight, q: QualitySettings, near: number, far: number): void {
  const on = q.shadows !== 'off';
  l.castShadow = on;
  if (!on) return;
  const size = Math.max(512, Math.min(4096, q.shadowMapSize || 2048));
  if (l.shadow.mapSize.x !== size) {
    l.shadow.mapSize.set(size, size);
    l.shadow.map?.dispose();
    (l.shadow as unknown as { map: unknown }).map = null;
  }
  l.shadow.camera.near = near;
  l.shadow.camera.far = far;
  l.shadow.bias = -0.00015;
  l.shadow.normalBias = 0.02;
  l.shadow.radius = q.shadows === 'soft' ? 2.5 : 1;
  l.shadow.camera.updateProjectionMatrix();
}

function spot(colour: THREE.Color, candela: number, angle: number, penumbra: number): THREE.SpotLight {
  const l = new THREE.SpotLight(colour, candela, 0, angle, penumbra, 2);
  return l;
}

/**
 * Broadcast top light over a cage or ring.
 * `radius` is the lit pool radius at canvas level; `trussY` the truss height.
 */
export function broadcastRig(kind: 'octagon' | 'ring', radius: number, trussY: number, q: QualitySettings): Rig {
  const group = new THREE.Group();
  group.name = 'arena.lights';
  const warmth = kind === 'ring' ? 4900 : 5600;
  const keyCol = kelvin(warmth);

  // Key: straight down from high above the centre (the summed truss), slightly toward
  // the hard-camera side (+z). Hung high so the pool is even to the fence (~92 % at
  // the posts) and the shadows are short and hard directly under the fighters.
  const keyY = trussY + 7;
  // Full intensity to ~5.3 m (past the fence), falling off across the apron so
  // little spills onto the arena floor around the stage.
  const key = spot(keyCol, 0, Math.atan(radius / keyY), 0.15);
  key.position.set(0, keyY, 0.35);
  key.target.position.set(0, 0, 0);
  // Illuminance at the canvas centre E = I / d^2 = 5.2: the canvas (albedo ~0.7)
  // leaves at ~1.15 linear, just under display white through ACES at exposure 1,
  // with the painted marks and scuffs still readable.
  key.intensity = 5.2 * keyY * keyY;
  key.name = 'key';
  group.add(key, key.target);

  // The truss-corner "face" fills are in the image-based environment
  // (environment.ts paints four bright fixture banks at the truss corners): the
  // IBL costs nothing per light, and the floor's contact term (aoNode) occludes
  // it correctly under bodies. Four unshadowed spot lights here cost ~4 ms at
  // 1792x1008 on the Arc 140V (measured; docs/design/PHASE8_NOTES.md).
  //
  // Ultra adds two cool rim spots from the bowl (docs/design/08 §4.3: 7000 K,
  // low intensity) that pick out shoulders and backs against the dark crowd.
  const rims: THREE.SpotLight[] = [];
  for (const [x, z] of [[-radius * 1.9, -radius * 1.6], [radius * 1.9, -radius * 1.4]] as [number, number][]) {
    const l = spot(kelvin(7000), 0, 0.32, 0.8);
    l.position.set(x, trussY + 1.5, z);
    l.target.position.set(0, 1.3, 0);
    const d = Math.hypot(x, trussY + 0.2, z);
    l.intensity = 0.9 * d * d;
    l.name = 'rim';
    rims.push(l);
    group.add(l, l.target);
  }

  const rig: Rig = {
    group,
    shadowCasters: [key],
    setQuality(qq) {
      configureShadow(key, qq, keyY - 3.5, keyY + 1.2);
      rims.forEach((l) => { l.visible = qq.level === 'ultra'; });
    },
    dispose() {
      key.shadow.map?.dispose();
    },
  };
  rig.setQuality(q);
  return rig;
}

/** Sports hall for mats: broad, even, cooler overhead light with soft short shadows. */
export function hallRig(half: number, ceilingY: number, q: QualitySettings): Rig {
  const group = new THREE.Group();
  group.name = 'arena.lights';
  const col = kelvin(5000);
  const key = spot(col, 0, Math.atan((half + 4) / ceilingY), 0.6);
  key.position.set(0, ceilingY, 0.8);
  key.target.position.set(0, 0, 0);
  key.intensity = 2.0 * ceilingY * ceilingY;
  group.add(key, key.target);
  const hemi = new THREE.HemisphereLight(kelvin(5200), new THREE.Color(0.35, 0.33, 0.3), 0.25);
  group.add(hemi);
  const fills: THREE.SpotLight[] = [];
  for (const [x, z] of [[8, 6], [-8, 6], [-8, -6], [8, -6]] as [number, number][]) {
    const l = spot(col, 0, 0.9, 0.9);
    l.position.set(x, ceilingY - 0.3, z);
    l.target.position.set(x * 0.2, 0, z * 0.2);
    const d = Math.hypot(x * 0.8, ceilingY, z * 0.8);
    l.intensity = 0.8 * d * d;
    fills.push(l);
    group.add(l, l.target);
  }
  const rig: Rig = {
    group,
    shadowCasters: [key],
    setQuality(qq) {
      configureShadow(key, qq, ceilingY - 4, ceilingY + 2);
      fills.forEach((l, i) => { l.visible = qq.level !== 'low' || i < 2; });
    },
    dispose() { key.shadow.map?.dispose(); },
  };
  rig.setQuality(q);
  return rig;
}

/** Street at night: one sodium lamp over the fight spot (shadowed), two more down the lot. */
export function streetRig(lamps: readonly { x: number; y: number; z: number; main: boolean }[], q: QualitySettings): Rig {
  const group = new THREE.Group();
  group.name = 'arena.lights';
  const sodium = kelvin(2050);
  const spots: THREE.SpotLight[] = [];
  let mainL: THREE.SpotLight | null = null;
  for (const p of lamps) {
    const l = spot(sodium, 0, 1.05, 0.85);
    l.position.set(p.x, p.y, p.z);
    l.target.position.set(p.x * 0.75, 0, p.z * 0.75);
    l.intensity = (p.main ? 1.5 : 1.1) * p.y * p.y;
    group.add(l, l.target);
    spots.push(l);
    if (p.main && !mainL) mainL = l;
  }
  // Cold moonlight / sky fill so silhouettes separate from the night.
  const moon = new THREE.DirectionalLight(new THREE.Color(0.45, 0.55, 0.8), 0.06);
  moon.position.set(-20, 30, -10);
  group.add(moon);
  const rig: Rig = {
    group,
    shadowCasters: mainL ? [mainL] : [],
    setQuality(qq) {
      if (mainL) configureShadow(mainL, qq, 2, 20);
      spots.forEach((l) => { if (l !== mainL) l.visible = qq.level !== 'low'; });
    },
    dispose() { mainL?.shadow.map?.dispose(); },
  };
  rig.setQuality(q);
  return rig;
}

export function rigFor(kind: SetKind): 'broadcast' | 'hall' | 'street' {
  return kind === 'octagon' || kind === 'ring' ? 'broadcast' : kind === 'mat' ? 'hall' : 'street';
}
