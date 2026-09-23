/**
 * PLACEHOLDER ARENA — the venue until `arena/` lands.
 *
 * Built from the sim's `Arena` geometry so it is always the right shape and
 * size: an off-white canvas polygon (octagon or ring), a dark apron, padded
 * posts and a see-through fence or four ropes, a mat with a border for the
 * grappling arenas, a flat ground for the street. Lit the way 08 §4.3
 * describes, at placeholder fidelity: one camera-side shadow-casting key, a
 * ring of overhead spots, a cool rim and a warm bounce from the canvas. The
 * environment map is a small procedural HDR "arena bowl" (dark, with a band of
 * truss lights overhead) so PBR materials have something to reflect.
 *
 * No branding of any real promotion; the canvas centre carries nothing.
 */
import {
  BoxGeometry, CircleGeometry, Color, CylinderGeometry, DataTexture, DirectionalLight, DoubleSide,
  EquirectangularReflectionMapping, FloatType, Group, HemisphereLight, LinearFilter,
  Mesh, MeshStandardMaterial, PlaneGeometry, RGBAFormat, RingGeometry, Shape, ShapeGeometry, SpotLight,
  TorusGeometry, type Texture,
} from 'three/webgpu';
import type { Arena } from '../../sim';
import type { ArenaSet, FrameInput, QualitySettings } from '../contract';
import type { WorldPose } from '../rig/skeleton';

const CANVAS = 0xd9d6cf;
const APRON = 0x17191d;
const POST = 0x1d1f24;

/** Wall radius at a vertex (centre to corner), metres. */
export function arenaExtent(arena: Arena): { apothem: number; corner: number; sides: number } {
  if (arena.shape === 'polygon') {
    const n = arena.sides ?? 8;
    const a = arena.apothemM ?? 4.6;
    return { apothem: a, corner: a / Math.cos(Math.PI / n), sides: n };
  }
  if (arena.shape === 'square') {
    const h = arena.halfWidthM ?? 3;
    return { apothem: h, corner: h * Math.SQRT2, sides: 4 };
  }
  if (arena.shape === 'circle') {
    const r = arena.apothemM ?? 4.6;
    return { apothem: r, corner: r, sides: 48 };
  }
  return { apothem: 12, corner: 12, sides: 48 };
}

/**
 * Polygon vertices matching the sim's wall planes: the sim puts edge normals at
 * angle (pi/n + 2 pi k/n), so corners sit at (2 pi k / n).
 */
export function arenaCorners(arena: Arena): [number, number][] {
  const { corner, sides } = arenaExtent(arena);
  const out: [number, number][] = [];
  if (arena.shape === 'square') {
    const h = arena.halfWidthM ?? 3;
    return [[h, h], [-h, h], [-h, -h], [h, -h]];
  }
  for (let k = 0; k < sides; k++) {
    const ang = (2 * Math.PI * k) / sides;
    out.push([Math.sin(ang) * corner, Math.cos(ang) * corner]);
  }
  return out;
}

/**
 * A tiny equirectangular HDR of a dark arena bowl: black-blue below the
 * horizon, a warm band of truss lights overhead, a brighter zenith. 64×32
 * texels; the renderer prefilters it into a PMREM on first use.
 */
export function arenaEnvironment(): DataTexture {
  const w = 64, h = 32;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h; // 1 = zenith (three's equirect v)
    const elev = (v - 0.5) * Math.PI; // -pi/2 .. pi/2
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let r = 0.012, g = 0.013, b = 0.018; // the bowl
      if (elev > 0.55 && elev < 0.95) {
        // Truss band: a ring of fixtures (six bright patches).
        const patch = Math.pow(Math.max(0, Math.cos(u * Math.PI * 12)), 8);
        r += 0.4 + 5 * patch; g += 0.38 + 4.8 * patch; b += 0.35 + 4.5 * patch;
      } else if (elev >= 0.95) {
        r += 0.25; g += 0.25; b += 0.26;
      } else if (elev < -0.2) {
        // Canvas bounce from below.
        r += 0.09; g += 0.085; b += 0.075;
      }
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 1;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class PlaceholderArena implements ArenaSet {
  readonly object3d = new Group();
  readonly bounds: { fightRadiusM: number; outerRadiusM: number; ceilingM: number };
  readonly environment: Texture;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly arena: Arena) {
    this.object3d.name = 'placeholder-arena';
    const { corner } = arenaExtent(arena);
    this.bounds = { fightRadiusM: corner, outerRadiusM: corner + 6, ceilingM: 9 };
    this.environment = arenaEnvironment();
    this.disposables.push(this.environment);
    this.buildFloor();
    if (arena.wall === 'fence') this.buildFence();
    else if (arena.wall === 'ropes') this.buildRing();
    this.buildLights();
  }

  private mat(p: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial {
    const m = new MeshStandardMaterial(p);
    this.disposables.push(m);
    return m;
  }

  private add(mesh: Mesh, shadows: { cast?: boolean; receive?: boolean } = {}): Mesh {
    mesh.castShadow = shadows.cast === true;
    mesh.receiveShadow = shadows.receive !== false;
    this.disposables.push(mesh.geometry);
    this.object3d.add(mesh);
    return mesh;
  }

  private buildFloor(): void {
    const a = this.arena;
    // The surrounding floor of the venue, dark so the lit canvas pops.
    const venue = new Mesh(new CircleGeometry(40, 48), this.mat({ color: 0x0b0c0f, roughness: 0.95 }));
    venue.rotation.x = -Math.PI / 2;
    venue.position.y = -0.62;
    this.add(venue);

    if (a.shape === 'unbounded') {
      const ground = new Mesh(new PlaneGeometry(60, 60), this.mat({
        color: a.surface === 'grass' ? 0x3d5a2c : 0x5a5a58, roughness: 0.95,
      }));
      ground.rotation.x = -Math.PI / 2;
      this.add(ground);
      return;
    }

    const corners = arenaCorners(a);
    const shape = new Shape();
    // Shape lives in (x, y); after rotating -90° about X, shape y becomes -z.
    corners.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    const isMat = a.surface === 'mat' || a.surface === 'tatami';
    const floorColour = a.surface === 'tatami' ? 0x2f7d4f : a.surface === 'mat' ? 0x2a4f8c : CANVAS;
    const canvas = new Mesh(new ShapeGeometry(shape), this.mat({ color: floorColour, roughness: 0.9 }));
    canvas.rotation.x = -Math.PI / 2;
    this.add(canvas);

    if (isMat) {
      // Competition border: a band around the contest area.
      const h = a.halfWidthM ?? 4;
      const outer = new Shape();
      outer.moveTo(-h - 1, -h - 1); outer.lineTo(h + 1, -h - 1); outer.lineTo(h + 1, h + 1); outer.lineTo(-h - 1, h + 1); outer.closePath();
      const border = new Mesh(new ShapeGeometry(outer), this.mat({ color: a.surface === 'tatami' ? 0xc8b25a : 0xb0303a, roughness: 0.9 }));
      border.rotation.x = -Math.PI / 2;
      border.position.y = -0.004;
      this.add(border);
      return;
    }

    // Apron: a raised dark skirt beyond the wall.
    const apron = new Mesh(new CylinderGeometry(this.bounds.fightRadiusM + 1.1, this.bounds.fightRadiusM + 1.2, 0.6, corners.length, 1, true),
      this.mat({ color: APRON, roughness: 0.8, side: DoubleSide }));
    apron.position.y = -0.3;
    apron.rotation.y = corners.length === 4 ? Math.PI / 4 : 0;
    this.add(apron);
    const apronTop = new Mesh(new RingGeometry(this.bounds.fightRadiusM * 0.98, this.bounds.fightRadiusM + 1.1, corners.length, 1),
      this.mat({ color: 0x24272d, roughness: 0.85 }));
    apronTop.rotation.x = -Math.PI / 2;
    apronTop.rotation.z = corners.length === 4 ? Math.PI / 4 : Math.PI / 2;
    apronTop.position.y = -0.005;
    this.add(apronTop);
  }

  private buildFence(): void {
    const corners = arenaCorners(this.arena);
    const height = 1.95;
    const postMat = this.mat({ color: POST, roughness: 0.6 });
    const padMat = this.mat({ color: 0x101114, roughness: 0.7 });
    // Chain-link at placeholder fidelity: a dark, mostly transparent panel.
    const meshMat = this.mat({ color: 0x0c0d10, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.22, side: DoubleSide, depthWrite: false });
    const n = corners.length;
    for (let k = 0; k < n; k++) {
      const [x0, z0] = corners[k];
      const [x1, z1] = corners[(k + 1) % n];
      const post = new Mesh(new CylinderGeometry(0.07, 0.07, height + 0.1, 16), postMat);
      post.position.set(x0, (height + 0.1) / 2, z0);
      this.add(post, { cast: true });
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const panel = new Mesh(new PlaneGeometry(len, height - 0.15), meshMat);
      panel.position.set((x0 + x1) / 2, (height - 0.15) / 2 + 0.1, (z0 + z1) / 2);
      panel.rotation.y = yaw - Math.PI / 2;
      panel.renderOrder = 2;
      this.add(panel, { receive: false });
      const rail = new Mesh(new BoxGeometry(0.12, 0.12, len), padMat);
      rail.position.set((x0 + x1) / 2, height, (z0 + z1) / 2);
      rail.rotation.y = yaw;
      this.add(rail, { cast: true });
      const base = new Mesh(new BoxGeometry(0.1, 0.18, len), padMat);
      base.position.set((x0 + x1) / 2, 0.09, (z0 + z1) / 2);
      base.rotation.y = yaw;
      this.add(base);
    }
  }

  private buildRing(): void {
    const corners = arenaCorners(this.arena);
    const ropeHeights = [0.46, 0.76, 1.07, 1.37];
    const ropeMat = this.mat({ color: 0xe8e6e0, roughness: 0.5 });
    const cornerColours = [0xb3262e, 0x404348, 0x264fa3, 0x404348];
    corners.forEach(([x, z], k) => {
      const post = new Mesh(new CylinderGeometry(0.09, 0.09, 1.55, 16), this.mat({ color: cornerColours[k % 4], roughness: 0.6 }));
      post.position.set(x, 0.775, z);
      this.add(post, { cast: true });
      const [x1, z1] = corners[(k + 1) % corners.length];
      const len = Math.hypot(x1 - x, z1 - z);
      const yaw = Math.atan2(x1 - x, z1 - z);
      for (const hgt of ropeHeights) {
        const rope = new Mesh(new CylinderGeometry(0.02, 0.02, len, 8), ropeMat);
        rope.position.set((x + x1) / 2, hgt, (z + z1) / 2);
        rope.rotation.set(Math.PI / 2, 0, 0);
        rope.rotation.y = yaw;
        rope.rotation.order = 'YXZ';
        this.add(rope, { cast: true });
      }
    });
  }

  private buildLights(): void {
    const r = this.bounds.fightRadiusM;
    // Camera-side key (08 §4.3): the only shadow caster.
    const key = new DirectionalLight(0xfff4ea, 1.6);
    key.position.set(3, 11, 7);
    key.castShadow = true;
    const ext = r + 1.5;
    key.shadow.camera.left = -ext; key.shadow.camera.right = ext;
    key.shadow.camera.top = ext; key.shadow.camera.bottom = -ext;
    key.shadow.camera.near = 2; key.shadow.camera.far = 30;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    this.object3d.add(key, key.target);

    // Six-fixture key ring on the truss, 7 m up, aimed 50° down (5600 K).
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const s = new SpotLight(0xfff1e2, 90, 22, 0.62, 0.55, 2);
      s.position.set(Math.sin(a) * (r + 1), 7, Math.cos(a) * (r + 1));
      s.target.position.set(Math.sin(a) * r * 0.2, 0, Math.cos(a) * r * 0.2);
      this.object3d.add(s, s.target);
    }
    // Cool rims from the bowl (7000 K).
    for (const sx of [-1, 1]) {
      const rim = new SpotLight(0xc4d6ff, 45, 30, 0.45, 0.7, 2);
      rim.position.set(sx * (r + 7), 4.5, -sx * (r + 5));
      rim.target.position.set(0, 1.2, 0);
      this.object3d.add(rim, rim.target);
    }
    // Warm bounce from the canvas, dark arena above.
    this.object3d.add(new HemisphereLight(0x15171c, 0x6e6254, 0.5));

    // Truss fixtures as visible emissive shapes (bloom sources).
    const fixtureMat = this.mat({ color: 0x111111, emissive: new Color(0xfff3e4), emissiveIntensity: 9 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const f = new Mesh(new CylinderGeometry(0.28, 0.22, 0.18, 20), fixtureMat);
      f.position.set(Math.sin(a) * (r + 1), 7.1, Math.cos(a) * (r + 1));
      this.add(f, { receive: false });
    }
    const truss = new Mesh(new TorusGeometry(r + 1, 0.08, 8, 48), this.mat({ color: 0x1b1c20, roughness: 0.6, metalness: 0.6 }));
    truss.rotation.x = Math.PI / 2;
    truss.position.y = 7.3;
    this.add(truss, { receive: false });
  }

  update(_input: FrameInput, _fighters: readonly WorldPose[], _realDt: number): void { /* static set */ }

  setQuality(_q: QualitySettings): void { /* the stage applies the shadow policy */ }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.object3d.removeFromParent();
  }
}

export function createPlaceholderArena(arena: Arena): ArenaSet {
  return new PlaceholderArena(arena);
}

