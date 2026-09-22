/**
 * ARENA - the static scenery: octagonal cage, canvas floor, lighting and the
 * pool of abstract impact markers.
 *
 * This module is the lowest layer of the render package, so the few small maths
 * helpers shared by the rig / camera / renderer modules live here too rather
 * than in a sixth file.
 *
 * Deliberate content choices:
 *  - Impacts are shown as a short-lived expanding ring plus a soft flash. There
 *    is no blood, no injury depiction and no damage decal of any kind; the ring
 *    is an abstract "the engine resolved a strike here" marker, nothing more.
 *  - The palette is deliberately muted (slate, bone, one warm accent) so the
 *    scene reads as a broadcast graphic rather than an arcade game, and so it
 *    sits comfortably inside either a light or a dark page.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------- dimensions

/** Matches `DEFAULT_PARAMS.cageRadius`; the engine clamps fighters to this. */
export const CAGE_RADIUS = 4.6;
export const CAGE_HEIGHT = 1.95;
/** Rotation of the octagon so a flat face is toward the default camera. */
export const OCTAGON_PHASE = Math.PI / 8;

// ---------------------------------------------------------------- shared maths

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-arc interpolation between two angles in radians. */
export function lerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  let d = (((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  return a + d * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Zero first and second derivative at both ends - used for strike arcs. */
export function smootherstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Frame-rate independent exponential approach. `lambda` is roughly "how many
 * e-folds per second", so 20 converges in ~0.15 s.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return lerpAngle(current, target, 1 - Math.exp(-lambda * dt));
}

// ---------------------------------------------------------------- disposal

/**
 * Recursively release every GPU resource under `root`. Geometries, materials
 * and any texture referenced by a material are all disposed; three's dispose()
 * calls are idempotent so shared resources are safe.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh> & Partial<THREE.Sprite>;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) disposeMaterial(m);
  });
  root.removeFromParent();
}

export function disposeMaterial(m: THREE.Material): void {
  // Any texture-ish property on the material gets released as well.
  const anyMat = m as unknown as Record<string, unknown>;
  for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
    const tex = anyMat[key];
    if (tex && tex instanceof THREE.Texture) tex.dispose();
  }
  m.dispose();
}

// ---------------------------------------------------------------- palette

export interface ArenaPalette {
  background: THREE.Color;
  fog: THREE.Color;
  mat: string;
  matLine: string;
  matAccent: string;
  deck: number;
  post: number;
  fence: number;
  trim: number;
}

export const PALETTE: ArenaPalette = {
  background: new THREE.Color('#12151a'),
  fog: new THREE.Color('#12151a'),
  mat: '#d7d3c9',
  matLine: '#8d9098',
  matAccent: '#b7452f',
  deck: 0x23272e,
  post: 0x2f343c,
  fence: 0xb9c2cc,
  trim: 0x3a4049,
};

/** Corner colours. Index 0 is the A side; B fighters cycle the blue family. */
export const CORNER_A = 0xb23a2e;
export const CORNER_B = [0x2f6fb0, 0x4a91c8, 0x2a5487, 0x5ab0c9, 0x3a5fa0];

export function cornerColour(team: 'A' | 'B', index: number): number {
  return team === 'A' ? CORNER_A : CORNER_B[index % CORNER_B.length];
}

// ---------------------------------------------------------------- canvas helpers

function createCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/**
 * The canvas floor: a bone-coloured mat with a restrained centre mark. Drawn
 * procedurally so the build never touches the network or ships an image.
 */
function makeMatTexture(): THREE.CanvasTexture {
  const S = 1024;
  const cv = createCanvas(S);
  const g = cv.getContext('2d')!;
  const c = S / 2;

  // Base canvas with a very light vignette so the mat does not read as flat.
  g.fillStyle = PALETTE.mat;
  g.fillRect(0, 0, S, S);
  const vig = g.createRadialGradient(c, c, S * 0.1, c, c, S * 0.62);
  vig.addColorStop(0, 'rgba(255,255,255,0.20)');
  vig.addColorStop(1, 'rgba(60,62,68,0.20)');
  g.fillStyle = vig;
  g.fillRect(0, 0, S, S);

  // Faint canvas weave.
  g.strokeStyle = 'rgba(120,122,128,0.08)';
  g.lineWidth = 1;
  for (let i = 0; i < S; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
  }

  // Octagon outlines, echoing the cage.
  const octagon = (r: number) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + OCTAGON_PHASE;
      const x = c + Math.sin(a) * r;
      const y = c + Math.cos(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
  };

  g.strokeStyle = PALETTE.matLine;
  g.lineWidth = 6;
  g.globalAlpha = 0.55;
  octagon(S * 0.465);
  g.stroke();
  g.lineWidth = 3;
  g.globalAlpha = 0.28;
  octagon(S * 0.30);
  g.stroke();
  g.globalAlpha = 1;

  // Centre mark: a ring, an inner octagon and the project wordmark.
  g.strokeStyle = PALETTE.matAccent;
  g.globalAlpha = 0.5;
  g.lineWidth = 10;
  g.beginPath();
  g.arc(c, c, S * 0.145, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.22;
  g.lineWidth = 4;
  octagon(S * 0.105);
  g.stroke();
  g.globalAlpha = 1;

  g.fillStyle = 'rgba(70,72,78,0.75)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${Math.round(S * 0.052)}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.fillText('MMA SIM', c, c - S * 0.012);
  g.font = `500 ${Math.round(S * 0.021)}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.fillStyle = 'rgba(80,82,88,0.65)';
  g.fillText('MODEL - NOT A PREDICTION', c, c + S * 0.038);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Chain-link fence: white-ish diamonds on transparent, tiled across a panel. */
function makeFenceTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = createCanvas(S);
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 6;
  g.lineCap = 'round';
  const step = S / 4;
  for (let i = -4; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step + S, S); g.stroke();
    g.beginPath(); g.moveTo(i * step, S); g.lineTo(i * step + S, 0); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft ring sprite used for impact markers - abstract, never a wound. */
function makeRingTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = createCanvas(S);
  const g = cv.getContext('2d')!;
  const c = S / 2;
  g.clearRect(0, 0, S, S);
  const grad = g.createRadialGradient(c, c, S * 0.24, c, c, S * 0.48);
  grad.addColorStop(0.0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,1)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft dot used for the flash at the centre of an impact. */
function makeGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = createCanvas(S);
  const g = cv.getContext('2d')!;
  const c = S / 2;
  g.clearRect(0, 0, S, S);
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- impacts

export type ImpactKind = 'landed' | 'blocked' | 'evaded';

const IMPACT_COLOUR: Record<ImpactKind, number> = {
  landed: 0xffcf8d,
  blocked: 0x9fc0e8,
  evaded: 0xa8b0bb,
};

interface Marker {
  ring: THREE.Sprite;
  flash: THREE.Sprite;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  peak: number;
}

/**
 * A small fixed pool of impact markers. Fixed size means no allocation during
 * playback and a trivially bounded amount of GPU memory even in a 1v5 bout.
 */
class ImpactPool {
  readonly group = new THREE.Group();
  private markers: Marker[] = [];
  private cursor = 0;

  constructor(private ringTex: THREE.Texture, private glowTex: THREE.Texture, count = 18) {
    this.group.name = 'impacts';
    for (let i = 0; i < count; i++) {
      const ringMat = new THREE.SpriteMaterial({
        map: ringTex, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      });
      const flashMat = new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      });
      const ring = new THREE.Sprite(ringMat);
      const flash = new THREE.Sprite(flashMat);
      ring.visible = false;
      flash.visible = false;
      ring.renderOrder = 6;
      flash.renderOrder = 6;
      this.group.add(ring, flash);
      this.markers.push({ ring, flash, life: 0, maxLife: 1, from: 0, to: 1, peak: 0 });
    }
  }

  spawn(position: THREE.Vector3, kind: ImpactKind, strength: number): void {
    const m = this.markers[this.cursor];
    this.cursor = (this.cursor + 1) % this.markers.length;
    const s = clamp(strength, 0.25, 1.6);

    m.maxLife = kind === 'landed' ? 0.42 : 0.3;
    m.life = m.maxLife;
    m.from = 0.16 * s;
    m.to = (kind === 'landed' ? 1.05 : 0.7) * s;
    m.peak = kind === 'landed' ? 0.95 : 0.5;

    const colour = IMPACT_COLOUR[kind];
    (m.ring.material as THREE.SpriteMaterial).color.setHex(colour);
    (m.flash.material as THREE.SpriteMaterial).color.setHex(colour);
    m.ring.position.copy(position);
    m.flash.position.copy(position);
    m.ring.visible = true;
    m.flash.visible = kind === 'landed';
  }

  update(dt: number): void {
    for (const m of this.markers) {
      if (m.life <= 0) continue;
      m.life = Math.max(0, m.life - dt);
      const t = 1 - m.life / m.maxLife;      // 0 -> 1 over the marker's life
      const scale = lerp(m.from, m.to, smoothstep(t));
      const fade = m.peak * Math.pow(1 - t, 1.6);
      m.ring.scale.setScalar(scale);
      (m.ring.material as THREE.SpriteMaterial).opacity = fade;
      m.flash.scale.setScalar(scale * 0.7);
      (m.flash.material as THREE.SpriteMaterial).opacity = fade * 0.8 * (1 - t);
      if (m.life <= 0) {
        m.ring.visible = false;
        m.flash.visible = false;
      }
    }
  }

  clear(): void {
    for (const m of this.markers) {
      m.life = 0;
      m.ring.visible = false;
      m.flash.visible = false;
    }
  }
}

// ---------------------------------------------------------------- arena

export interface ArenaOptions {
  showDebug?: boolean;
}

/** Everything that does not move: cage, mat, deck, lights, impact markers. */
export class Arena {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;

  private impacts: ImpactPool;
  private debug: THREE.Object3D | null = null;

  constructor(opts: ArenaOptions = {}) {
    this.group.name = 'arena';

    this.buildDeck();
    this.buildMat();
    this.buildCage();

    // ---- lighting ------------------------------------------------------
    // Warm key from the front-right, cool fill from behind-left and a broad
    // hemisphere term so nothing ever goes fully black. This reads the same
    // whether the surrounding page is light or dark, because the scene supplies
    // all of its own illumination and has its own background colour.
    const hemi = new THREE.HemisphereLight(0xc8d8ec, 0x24282f, 0.85);
    this.group.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2e0, 2.0);
    key.position.set(5.2, 9.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 26;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    this.keyLight = key;
    this.group.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xa9c4e6, 0.55);
    fill.position.set(-6.5, 5.5, -4.5);
    this.group.add(fill);

    const rim = new THREE.DirectionalLight(0xffd7a8, 0.35);
    rim.position.set(0, 4.5, -8.5);
    this.group.add(rim);

    this.group.add(new THREE.AmbientLight(0x3a4150, 0.5));

    // ---- impact markers -------------------------------------------------
    this.impacts = new ImpactPool(makeRingTexture(), makeGlowTexture());
    this.group.add(this.impacts.group);

    if (opts.showDebug) this.buildDebug();
  }

  // -------------------------------------------------------------- geometry

  /** The raised platform the cage stands on. */
  private buildDeck(): void {
    const deckGeo = new THREE.CylinderGeometry(CAGE_RADIUS + 1.25, CAGE_RADIUS + 1.45, 0.55, 8, 1);
    const deck = new THREE.Mesh(
      deckGeo,
      new THREE.MeshStandardMaterial({ color: PALETTE.deck, roughness: 0.92, metalness: 0.02 })
    );
    deck.rotation.y = OCTAGON_PHASE;
    deck.position.y = -0.275;
    deck.receiveShadow = true;
    this.group.add(deck);

    // Thin apron ring just outside the mat, so the mat edge reads cleanly.
    const apronGeo = new THREE.RingGeometry(CAGE_RADIUS - 0.02, CAGE_RADIUS + 1.2, 8, 1, OCTAGON_PHASE);
    const apron = new THREE.Mesh(
      apronGeo,
      new THREE.MeshStandardMaterial({ color: 0x2b3039, roughness: 0.95, side: THREE.DoubleSide })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = 0.002;
    apron.receiveShadow = true;
    this.group.add(apron);
  }

  /** The octagonal canvas itself, textured with the procedural mat graphic. */
  private buildMat(): void {
    const shape = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + OCTAGON_PHASE;
      const x = Math.sin(a) * CAGE_RADIUS;
      const y = Math.cos(a) * CAGE_RADIUS;
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape, 1);
    // ShapeGeometry emits UVs equal to the shape's local x/y, so remap them to
    // 0..1 across the octagon's bounding square for the mat texture.
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / (2 * CAGE_RADIUS) + 0.5;
      uv[i * 2 + 1] = pos.getY(i) / (2 * CAGE_RADIUS) + 0.5;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    const mat = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map: makeMatTexture(),
        roughness: 0.96,
        metalness: 0.0,
      })
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = 0.012;
    mat.receiveShadow = true;
    mat.name = 'mat';
    this.group.add(mat);
  }

  /** Posts, padded post covers, top / mid / bottom rails and the mesh panels. */
  private buildCage(): void {
    const cage = new THREE.Group();
    cage.name = 'cage';

    const postGeo = new THREE.CylinderGeometry(0.065, 0.075, CAGE_HEIGHT + 0.18, 12);
    const postMat = new THREE.MeshStandardMaterial({ color: PALETTE.post, roughness: 0.6, metalness: 0.25 });
    const capGeo = new THREE.SphereGeometry(0.075, 12, 8);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.5, metalness: 0.35 });

    const verts: THREE.Vector2[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + OCTAGON_PHASE;
      verts.push(new THREE.Vector2(Math.sin(a) * CAGE_RADIUS, Math.cos(a) * CAGE_RADIUS));
    }

    for (const v of verts) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(v.x, (CAGE_HEIGHT + 0.18) / 2 - 0.09, v.y);
      post.castShadow = true;
      cage.add(post);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(v.x, CAGE_HEIGHT + 0.09, v.y);
      cage.add(cap);
    }

    // Side length of the octagon, used for both the panels and the rails.
    const sideLen = verts[0].distanceTo(verts[1]);
    const fenceTex = makeFenceTexture();
    fenceTex.repeat.set(Math.max(2, Math.round(sideLen * 2.2)), Math.round(CAGE_HEIGHT * 2.2));

    const panelGeo = new THREE.PlaneGeometry(sideLen, CAGE_HEIGHT);
    const panelMat = new THREE.MeshBasicMaterial({
      map: fenceTex,
      color: PALETTE.fence,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const railGeo = new THREE.BoxGeometry(sideLen, 0.07, 0.07);
    const railMat = new THREE.MeshStandardMaterial({ color: PALETTE.trim, roughness: 0.55, metalness: 0.3 });
    const padGeo = new THREE.BoxGeometry(sideLen, 0.13, 0.1);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x1f242b, roughness: 0.9 });

    for (let i = 0; i < 8; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 8];
      const mid = new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5);
      // Face the panel inward: the outward normal of this side.
      const yaw = Math.atan2(mid.x, mid.y);

      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.set(mid.x, CAGE_HEIGHT / 2, mid.y);
      panel.rotation.y = yaw;
      panel.renderOrder = 4;   // draw after the fighters so blending is stable
      cage.add(panel);

      for (const [y, geo, m] of [
        [CAGE_HEIGHT, railGeo, railMat],
        [CAGE_HEIGHT * 0.62, railGeo, railMat],
        [0.12, padGeo, padMat],
      ] as [number, THREE.BufferGeometry, THREE.Material][]) {
        const rail = new THREE.Mesh(geo, m);
        rail.position.set(mid.x, y, mid.y);
        rail.rotation.y = yaw;
        rail.castShadow = y > 0.2;
        cage.add(rail);
      }
    }

    this.group.add(cage);
  }

  private buildDebug(): void {
    const d = new THREE.Group();
    d.name = 'debug';
    const grid = new THREE.PolarGridHelper(CAGE_RADIUS, 8, 5, 64, 0x44506a, 0x2c3340);
    grid.position.y = 0.02;
    d.add(grid);
    const axes = new THREE.AxesHelper(1.2);
    axes.position.y = 0.05;
    d.add(axes);
    this.debug = d;
    this.group.add(d);
  }

  // -------------------------------------------------------------- public API

  /** Queue an abstract impact marker. `strength` scales its size, 0..1.6. */
  spawnImpact(position: THREE.Vector3, kind: ImpactKind, strength = 1): void {
    this.impacts.spawn(position, kind, strength);
  }

  /** Clears every live marker - used when a different replay is loaded. */
  clearImpacts(): void {
    this.impacts.clear();
  }

  /** Advance marker animation. `dt` is wall-clock seconds. */
  update(dt: number): void {
    this.impacts.update(dt);
  }

  dispose(): void {
    // The shadow map is a render target three does not release for us.
    this.keyLight.shadow.map?.dispose();
    this.keyLight.shadow.dispose();
    this.keyLight.dispose();
    disposeObject3D(this.group);
    this.debug = null;
  }
}
