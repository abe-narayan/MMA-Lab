/**
 * SKIN — a TSL node material that reads as human skin under a hard arena top light.
 *
 * Lighting (SkinLightingModel, replacing the physical model's direct term):
 *  - Diffuse: pre-integrated-style scattering approximated per channel. Each channel's N·L is
 *    wrapped by an amount proportional to the surface curvature (from screen-space derivatives of
 *    the smooth normal) times that channel's scattering distance (red ≫ green > blue), so the
 *    terminator bleeds red on noses, lips, fingers and ears and stays tight on flat backs. Red also
 *    reads the *smooth* normal (its light has diffused past the micro-relief), blue the detailed one.
 *  - Thin-geometry back-scatter (ears, fingers, nostrils): light from behind leaks through as the
 *    scatter colour.
 *  - Specular: two GGX lobes (roughness r and ~1.8r, mixed 0.85/0.15), F0 ≈ 0.028 (ior 1.4).
 *  - Sweat: a clear-coat film (physical model's clear coat) with bead normals.
 *  - With `QualitySettings.skinScattering` off the wrap is a fixed, cheap wrapped diffuse.
 *
 * Surface (fragment graph): tone palette with palms/soles, lips, areolae and nails from MPFB's UV
 * masks; procedural hairline / fade / buzz, eyebrows and stubble/beard in canonical head space;
 * cavity darkening from muscle definition; flush; per-zone damage (redness → purple bruise);
 * cuts (closed marks, or bleeding with a drip); sweat darkening and gloss; tattoos.
 */
import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, clamp, dot, float, fwidth, length, max, min, mix, mx_noise_float,
  mx_worley_noise_float, mx_cell_noise_float, normalMap, normalView, normalViewGeometry, positionView,
  positionViewDirection, pow, smoothstep, texture, uniform, uniformArray, uv, vec2, vec3, vec4, exp,
  atan, cos, sin, select, floor, varying, BRDF_GGX, BRDF_Lambert, F_Schlick, clearcoat as ccProp,
  clearcoatRoughness as ccRough, specularColor, clearcoatNormalView, step, diffuseContribution, roughness as roughProp,
} from 'three/tsl';
import type { CanonicalLandmarks } from './canonical';
import type { SkinPalette, RGB } from './appearance';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any; // TSL node graphs are dynamically typed; @types/three's generics add noise here.

// ---------------------------------------------------------------------------
// Lighting model
// ---------------------------------------------------------------------------

const CLEARCOAT_F0 = vec3(0.04);
const CLEARCOAT_F90 = vec3(1);

class SkinLightingModel extends THREE.PhysicalLightingModel {
  constructor(private readonly scattering: boolean) {
    super(true, false, false, false, false, false);
  }

  direct(input: { lightDirection: N; lightColor: N; reflectedLight: N }, builder: N): void {
    const { lightDirection: L, lightColor, reflectedLight } = input;
    const mat = builder.material as SkinNodeMaterial;
    const V = positionViewDirection;
    const Nd: N = normalView;
    const Ns: N = normalViewGeometry;

    // Per-channel N·L: red from the smooth normal, blue from the detailed one.
    const ndlD: N = Nd.dot(L);
    const ndlS: N = Ns.dot(L);
    const ndl: N = vec3(mix(ndlS, ndlD, 0.3), mix(ndlS, ndlD, 0.75), ndlD);

    let wrap: N;
    if (this.scattering) {
      // Curvature (1/m) from screen derivatives, clamped to a sane range.
      const curv: N = clamp(length(fwidth(Ns)).div(max(length(fwidth(positionView)), 1e-5)), 0, 180);
      // Scatter distances (m) per channel × curvature, plus a floor so flat skin is not Lambert.
      wrap = mat.scatterNode.mul(curv).add(vec3(0.16, 0.07, 0.045)).mul(mat.scatterAmountNode).min(vec3(1.2, 0.7, 0.5));
    } else {
      wrap = vec3(0.3, 0.12, 0.08).mul(mat.scatterAmountNode);
    }
    const dw: N = ndl.add(wrap).div(wrap.add(1)).clamp(0, 1);
    // Keep the lit side close to Lambert and soften only through the terminator.
    const diffuseTerm: N = dw.pow(wrap.add(1));
    // A touch of red in the terminator band (light that entered on the lit side and exits here).
    const band: N = smoothstep(0.35, 0.0, ndlS).mul(smoothstep(-0.35, 0.0, ndlS)).mul(0.22).mul(mat.scatterAmountNode);
    const terminator: N = mat.scatterColorNode.mul(band);

    const halfDir: N = L.add(V).normalize();
    const dotVH: N = V.dot(halfDir).clamp();
    const F: N = F_Schlick({ f0: specularColor, f90: float(1), dotVH } as N);

    reflectedLight.directDiffuse.addAssign(
      lightColor.mul(diffuseTerm.add(terminator)).mul(BRDF_Lambert({ diffuseColor: diffuseContribution } as N)).mul(F.oneMinus()),
    );

    // Thin-geometry back-scatter.
    const back: N = V.dot(L.add(Ns.mul(0.35)).normalize().negate()).clamp().pow(3).mul(mat.thinNode).mul(0.55);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(mat.scatterColorNode).mul(diffuseContribution).mul(back));

    // Two specular lobes.
    const irr: N = Nd.dot(L).clamp().mul(lightColor);
    const r1: N = roughProp;
    const r2: N = roughProp.mul(1.8).min(1);
    const s1: N = BRDF_GGX({ lightDirection: L, f0: specularColor, f90: float(1), roughness: r1 } as N);
    const s2: N = BRDF_GGX({ lightDirection: L, f0: specularColor, f90: float(1), roughness: r2 } as N);
    reflectedLight.directSpecular.addAssign(irr.mul(s1.mul(0.85).add(s2.mul(0.15))).mul(mat.specOcclusionNode));

    // Sweat film (clear coat).
    const ccN: N = clearcoatNormalView;
    const dotNLcc: N = ccN.dot(L).clamp();
    (this as N).clearcoatSpecularDirect.addAssign(dotNLcc.mul(lightColor).mul(
      BRDF_GGX({ lightDirection: L, f0: CLEARCOAT_F0, f90: CLEARCOAT_F90, roughness: ccRough, normalView: ccN } as N),
    ));
    void ccProp;
  }
}

export class SkinNodeMaterial extends THREE.MeshPhysicalNodeMaterial {
  scatterNode: N = vec3(0.0028, 0.0011, 0.0006);
  scatterAmountNode: N = float(1);
  scatterColorNode: N = vec3(0.9, 0.3, 0.2);
  thinNode: N = float(0);
  specOcclusionNode: N = float(1);
  scattering = true;

  setupLightingModel(): N {
    return new SkinLightingModel(this.scattering);
  }
}

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

export interface HairLook {
  /** 0 bald … 1 dense scalp coverage painted on the skin. */
  scalp: number;
  /** Hairline raise at the front and temples (receding), in eye radii. */
  recede: number;
  /** Fade: 0 none, 1 skin-fade from the ear line. */
  fade: number;
  stubble: number;
  beard: number;
  goatee: number;
  moustache: number;
  /** Cornrow / braid parting lines painted on the scalp (0/1). */
  rows: number;
}

/**
 * One fighter's skin parameters. The skin material is shared by every fighter (one compiled
 * pipeline); each mesh carries its own `SkinState` in `userData.skin`, and the material's uniforms
 * read it per draw (`onObjectUpdate`).
 */
export interface SkinState {
  base: THREE.Vector3; palm: THREE.Vector3; lips: THREE.Vector3; dark: THREE.Vector3; flushCol: THREE.Vector3;
  nail: THREE.Vector3; scatter: THREE.Vector3; hair: THREE.Vector3; brow: THREE.Vector3;
  hairScalp: number; hairRecede: number; hairFade: number; stubble: number; beard: number; goatee: number;
  moustache: number; rows: number;
  tone: number; definition: number; age: number;
  sweat: number; flush: number; time: number;
  dmgA: THREE.Vector4; dmgB: THREE.Vector4; bruiseA: THREE.Vector4; bruiseB: THREE.Vector4;
  cutPos: THREE.Vector4[]; cutInfo: THREE.Vector4[]; bloodOn: number;
  /** 12 tattoo slot flags (TattooSlot order) packed in three vec4s. */
  tattoo: THREE.Vector4[]; tattooTint: THREE.Vector3;
  wrapOn: number; wrapCol: THREE.Vector3; tape: number;
}

export function makeSkinState(): SkinState {
  const v3 = (): THREE.Vector3 => new THREE.Vector3(0.5, 0.4, 0.35);
  const v4 = (): THREE.Vector4 => new THREE.Vector4();
  return {
    base: v3(), palm: v3(), lips: v3(), dark: v3(), flushCol: v3(), nail: v3(), scatter: v3(), hair: v3(), brow: v3(),
    hairScalp: 0, hairRecede: 0, hairFade: 0, stubble: 0, beard: 0, goatee: 0, moustache: 0, rows: 0,
    tone: 0.5, definition: 0.5, age: 0, sweat: 0, flush: 0, time: 0,
    dmgA: v4(), dmgB: v4(), bruiseA: v4(), bruiseB: v4(),
    cutPos: [v4(), v4(), v4(), v4()], cutInfo: [v4(), v4(), v4(), v4()], bloodOn: 1,
    tattoo: [v4(), v4(), v4()], tattooTint: new THREE.Vector3(0.02, 0.025, 0.03),
    wrapOn: 0, wrapCol: new THREE.Vector3(0.6, 0.6, 0.6), tape: 0,
  };
}

export function setPalette(u: SkinState, p: SkinPalette, hair: RGB): void {
  u.base.set(...p.base); u.palm.set(...p.palm); u.lips.set(...p.lips);
  u.dark.set(...p.dark); u.flushCol.set(...p.flush); u.nail.set(...p.nail);
  u.scatter.set(...p.scatter);
  u.hair.set(...hair);
  u.brow.set(hair[0] * 0.8, hair[1] * 0.8, hair[2] * 0.8);
}

/** A uniform that takes its value from `object.userData[slot]` at draw time. */
export function objectUniform(slot: string, get: (s: N) => unknown, init: unknown): N {
  return (uniform as N)(init).onObjectUpdate(({ object }: { object: THREE.Object3D }) => {
    const s = object.userData[slot];
    return s ? get(s) : undefined;
  });
}

type SkinUniforms = Record<Exclude<keyof SkinState, 'cutPos' | 'cutInfo' | 'tattoo'>, N> & { cutPos: N[]; cutInfo: N[]; tattoo: N[] };

function makeSkinUniforms(): SkinUniforms {
  const proto = makeSkinState();
  const out: Record<string, N> = {};
  for (const [k, v] of Object.entries(proto)) {
    if (Array.isArray(v)) out[k] = v.map((x, i) => objectUniform('skin', (s) => s[k][i], x.clone()));
    else out[k] = objectUniform('skin', (s) => s[k], typeof v === 'number' ? v : (v as THREE.Vector3).clone());
  }
  return out as SkinUniforms;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

export interface SkinTextures {
  /** RGBA: lips, fingernails, toenails, areolae (MPFB UV masks). */
  maskA: THREE.Texture;
  /** RGBA: ears, eyelids, face, 0. */
  maskB: THREE.Texture;
  detail: THREE.Texture;
  sweat: THREE.Texture;
}

export interface SkinOptions {
  scattering: boolean;
  sweatAndDamage: boolean;
  /** Canonical landmarks (constants baked into the graph). */
  lm: CanonicalLandmarks;
}

const V3c = (v: readonly number[]): N => vec3(v[0], v[1], v[2]);

export function createSkinMaterial(tex: SkinTextures, opt: SkinOptions): SkinNodeMaterial {
  const m = new SkinNodeMaterial();
  const u = makeSkinUniforms();
  m.scattering = opt.scattering;
  const lm = opt.lm;
  const eyeR = 0.0118;

  const vUv: N = uv();
  // Packed per-vertex inputs (bodyMesh.ts): unpacked in the vertex stage, then interpolated.
  const aRef: N = attribute('aRef', 'vec4');
  const aMisc: N = attribute('aMisc', 'vec4');
  const unpack3 = (v: N): N => {
    const a: N = floor(v.div(65536));
    const r: N = v.sub(a.mul(65536));
    const b: N = floor(r.div(256));
    return vec3(a, b, r.sub(b.mul(256))).div(255);
  };
  const ref: N = aRef.xyz;
  const z012: N = varying(unpack3(aRef.w), 'vZ012');
  const z345: N = varying(unpack3(aMisc.z), 'vZ345');
  const z67: N = varying(unpack3(aMisc.w), 'vZ67');
  const pto: N = varying(unpack3(aMisc.x), 'vPTO');
  const misc: N = vec4(pto, aMisc.y);
  const fx: N = attribute('aFx', 'vec4');
  const zA: N = vec4(z012, z345.x);
  const zB: N = vec4(z345.y, z345.z, z67.x, z67.y);

  const mA: N = texture(tex.maskA, vUv);
  const mB: N = texture(tex.maskB, vUv);
  const lipsM: N = smoothstep(0.45, 0.85, mA.r);
  const nailM: N = smoothstep(0.3, 0.7, max(mA.g, mA.b));
  const areolaM: N = smoothstep(0.2, 0.8, mA.a);
  const earM: N = mB.r;
  const lidM: N = mB.g;
  const mouthM: N = smoothstep(0.3, 0.7, mB.a);

  // --- head space -------------------------------------------------------------------------
  const eyeMid: N = vec3((lm.eyeL[0] + lm.eyeR[0]) / 2, (lm.eyeL[1] + lm.eyeR[1]) / 2, (lm.eyeL[2] + lm.eyeR[2]) / 2);
  const eyeX = (lm.eyeL[0] - lm.eyeR[0]) / 2;
  const hc: N = V3c(lm.headCentre);
  const q: N = ref.sub(hc);
  const theta: N = abs(atan(q.x, q.z)); // 0 front … π back
  const ey: N = ref.y.sub(eyeMid.y).div(eyeR); // height above the eyes, in eye radii
  const headW: N = smoothstep(lm.neckY - 0.02, lm.neckY + 0.04, ref.y); // above the neck joint

  // Hairline height (eye radii above the eyes) as a function of angle around the head.
  const recede: N = u.hairRecede;
  const hlFront: N = float(4.7).add(recede);
  const hlTemple: N = float(4.0).add(recede.mul(1.6));
  // Angles measured from the head centre: temple ≈ 0.9, sideburn ≈ 1.65, ear ≈ 1.95, nape = π.
  const hairline: N = select(theta.lessThan(0.7), mix(hlFront, hlTemple, theta.div(0.7)),
    select(theta.lessThan(1.35), mix(hlTemple, hlTemple.sub(1.0), smoothstep(0.7, 1.35, theta)),
      select(theta.lessThan(1.75), mix(hlTemple.sub(1.0), float(-1.0), smoothstep(1.35, 1.6, theta)),
        select(theta.lessThan(2.25), mix(float(-1.0), float(1.4), smoothstep(1.72, 1.85, theta)),
          mix(float(1.4), float(-5.5), smoothstep(2.25, 2.9, theta))))));
  const edgeNoise: N = mx_noise_float(ref.mul(160)).mul(0.35);
  const scalpRegion: N = smoothstep(-0.25, 0.35, ey.sub(hairline).add(edgeNoise)).mul(headW).mul(float(1).sub(earM.mul(1.5)).clamp());
  // Fade: density drops toward the ear line on the sides and back.
  const fadeD: N = mix(float(1), smoothstep(-1.0, 3.0, ey).mul(smoothstep(0.5, 1.2, theta)).add(smoothstep(1.0, 0.5, theta)).clamp(), u.hairFade);
  // Follicle speckle (fades out when a follicle would be smaller than a pixel).
  const fol: N = mx_cell_noise_float(ref.mul(1400));
  const folAA: N = smoothstep(0.0006, 0.0002, length(fwidth(ref)));
  const speckle: N = mix(float(0.75), smoothstep(0.35, 0.9, fol), folAA);
  const rowsLine: N = smoothstep(0.55, 0.9, abs(sin(ref.x.mul(170).add(sin(ref.z.mul(60)).mul(0.4))))).mul(u.rows);
  const scalpCov: N = scalpRegion.mul(u.hairScalp).mul(fadeD).mul(speckle.mul(0.5).add(0.5)).mul(float(1).sub(rowsLine.mul(0.8)));

  // Eyebrows.
  const brow = (side: number): N => {
    const bu: N = ref.x.mul(side).sub(eyeX).div(eyeR); // outward from the eye centre
    const bv: N = ey;
    const centre: N = float(1.5).add(bu.add(0.15).mul(bu.add(0.15)).mul(-0.12)).add(0.25);
    const thick: N = mix(float(0.42), float(0.16), smoothstep(-0.9, 1.6, bu));
        const span: N = smoothstep(-1.15, -0.8, bu).mul(smoothstep(1.85, 1.35, bu));
    // Hairs grow up and outward at the inner end, flatten along the arch toward the tail.
    const along: N = ref.x.mul(side).mul(2600).add(ref.y.mul(mix(float(1500), float(600), smoothstep(-0.8, 1.2, bu))));
    const strokes: N = smoothstep(0.2, 0.9, mx_cell_noise_float(vec3(along, ref.y.mul(5200).sub(ref.x.mul(side).mul(900)), 0)));
    const density: N = smoothstep(-1.1, -0.5, bu).mul(0.35).add(0.65).mul(smoothstep(1.9, 0.9, bu).mul(0.4).add(0.6));
    const soft: N = smoothstep(thick.mul(1.25), thick.mul(0.35), abs(bv.sub(centre)));
    return soft.mul(span).mul(density).mul(mix(float(0.35), float(1), strokes)).mul(smoothstep(lm.eyeL[2] - 0.02, lm.eyeL[2] - 0.005, ref.z));
  };
  const browM: N = max(brow(1), brow(-1)).mul(headW);

  // Beard regions (in eye radii relative to the eyes).
  const ax: N = abs(ref.x.sub(eyeMid.x)).div(eyeR);
  const lipsY = (lm.lips[1] - (lm.eyeL[1] + lm.eyeR[1]) / 2) / eyeR;
  const noseY = (lm.noseTip[1] - (lm.eyeL[1] + lm.eyeR[1]) / 2) / eyeR;
  const chinY = (lm.chin[1] - (lm.eyeL[1] + lm.eyeR[1]) / 2) / eyeR;
  const front: N = smoothstep(1.45, 1.2, theta);
  // Beard top edge: from the sideburn at the ear diagonally down to the corner of the mouth.
  const cheekLine: N = mix(float(-4.6), float(-1.6), smoothstep(1.6, 6.8, ax)).add(edgeNoise.mul(0.7));
  const neckLine: N = float(chinY - 1.6).add(ax.mul(0.3));
  const beardRegion: N = smoothstep(0.9, -0.9, ey.sub(cheekLine)).mul(smoothstep(-0.4, 0.4, ey.sub(neckLine))).mul(front).mul(headW.max(smoothstep(lm.neckY - 0.06, lm.neckY - 0.02, ref.y)));
  const mous: N = smoothstep(2.1, 1.6, ax).mul(smoothstep(lipsY + 0.2, lipsY + 0.6, ey)).mul(smoothstep(noseY - 0.5, noseY - 1.0, ey));
  const goat: N = smoothstep(1.9, 1.4, ax).mul(smoothstep(chinY - 1.8, chinY - 1.0, ey)).mul(smoothstep(lipsY - 0.3, lipsY - 0.7, ey)).max(mous);
  const beardAmt: N = max(max(beardRegion.mul(u.beard), goat.mul(u.goatee)), mous.mul(u.moustache));
  const stubbleAmt: N = beardRegion.max(mous).mul(u.stubble);
  const noLip: N = float(1).sub(lipsM);
  // Beard: short curled strands with density falling off at the edges; stubble: follicle dots
  // over a blue-grey shadow (the hair sits under the skin surface).
  const bStr: N = mx_cell_noise_float(ref.mul(vec3(1900, 2600, 1900)));
  const beardCov: N = smoothstep(0.1, 0.55, beardAmt).mul(mix(float(0.45), float(1), smoothstep(0.25, 0.7, bStr))).mul(noLip).mul(0.92);
  const stubbleCov: N = stubbleAmt.mul(mix(float(0.12), float(0.5), speckle)).mul(noLip);

  // --- colour --------------------------------------------------------------------------
  // One noise octave shared by pigment mottling, bruise blotching and cloth layering.
  const n1: N = mx_noise_float(ref.mul(24));
  const mott: N = n1.mul(0.06);
  let col: N = u.base.mul(mott.add(1));
  col = mix(col, u.palm, misc.x);
  // Natural redness where blood runs close to the surface (ears, nose, cheeks, knuckles).
  const haem: N = fx.y.mul(0.14).add(earM.mul(0.25)).mul(float(1).sub(u.tone.mul(0.7)));
  col = mix(col, col.mul(vec3(1.12, 0.86, 0.84)), haem);
  col = mix(col, u.dark, areolaM.mul(0.85));
  col = mix(col, u.lips, lipsM.mul(0.7));
  col = mix(col, u.nail, nailM);
  col = mix(col, col.mul(vec3(0.82, 0.74, 0.74)), lidM.mul(0.35));
  // Inside of the mouth: dark, red, wet.
  col = mix(col, vec3(0.035, 0.008, 0.008), mouthM.mul(0.95));
  // Muscle definition: creases darken slightly (occluded, and thinner fat shows fascia lines).
  const cav: N = misc.w;
  col = col.mul(float(1).sub(cav.max(0).mul(u.definition.mul(0.5).add(0.15))));
  // Hair painted on the skin.
  col = mix(col, u.hair, scalpCov.mul(0.92));
  col = mix(col, u.brow, browM.mul(0.9));
  col = mix(col, mix(col.mul(vec3(0.62, 0.66, 0.7)), u.hair, 0.55), stubbleCov);
  col = mix(col, u.hair, beardCov);

  // --- normals ------------------------------------------------------------------------
  // MakeHuman's UV atlas gives the face about twice the texel density of the body, so the body
  // samples the pore texture at a finer tiling to keep pores roughly the same size in metres.
  const faceM: N = smoothstep(0.2, 0.6, mB.b);
  const det: N = mix(texture(tex.detail, vUv.mul(80)), texture(tex.detail, vUv.mul(38)), faceM);
  const det2: N = texture(tex.detail, vUv.mul(11).add(0.37));
  const nxy: N = det.xy.sub(0.5).mul(mix(float(0.4), float(0.55), faceM)).add(det2.xy.sub(0.5).mul(0.25)).mul(float(1).sub(scalpCov.mul(0.6)));
  let wet: N = float(0);
  let beadXY: N = vec2(0, 0);
  if (opt.sweatAndDamage) {
    const sw: N = texture(tex.sweat, vUv.mul(vec2(22, 16)).add(vec2(0, u.time.mul(0.004))));
    const film: N = u.sweat.mul(fx.x).mul(1.15).clamp();
    wet = film.mul(mix(float(0.55), float(1), sw.a));
    beadXY = sw.xy.sub(0.5).mul(sw.a).mul(film).mul(1.6);
  }
  m.normalNode = normalMap(vec3(nxy.add(0.5), 1)) as N;
  m.clearcoatNormalNode = normalMap(vec3(nxy.mul(0.3).add(beadXY).add(0.5), 1)) as N;

  // --- dynamic: flush, damage, cuts, sweat ---------------------------------------------
  let rough: N = mix(float(0.47), float(0.36), misc.z);
  rough = mix(rough, float(0.42), lipsM);
  rough = mix(rough, float(0.25), nailM);
  rough = mix(rough, float(0.5), mouthM);
  rough = mix(rough, float(0.55), misc.x);
  rough = mix(rough, float(0.62), max(scalpCov, max(beardCov, stubbleCov.mul(0.6))));
  rough = rough.add(float(1).sub(det.a).mul(0.12)).add(u.age.mul(0.05));

  let coat: N = float(0);
  let coatRough: N = float(0.12);
  if (opt.sweatAndDamage) {
    const visible: N = float(1).sub(u.tone.mul(0.6));
    col = mix(col, col.mul(u.flushCol.mul(0.6).add(vec3(0.82, 0.74, 0.72))), u.flush.mul(fx.y).mul(0.7).mul(visible));

    // Damage: fresh redness, then purple-blue bruising as a zone's damage matures.
    const red: N = dot(zA, u.dmgA).add(dot(zB, u.dmgB)).clamp();
    const bru: N = dot(zA, u.bruiseA).add(dot(zB, u.bruiseB)).clamp();
    const blot: N = n1.mul(0.25).add(0.85);
    col = mix(col, col.mul(vec3(1.25, 0.62, 0.6)), red.mul(blot).mul(0.75).mul(float(1).sub(u.tone.mul(0.45))));
    col = mix(col, col.mul(vec3(0.62, 0.45, 0.62)), bru.mul(blot).mul(0.8));
    rough = rough.sub(red.mul(0.05));

    // Cuts: four slots. cutPos = (x, y, z, severity 0 = none), cutInfo = (bleeding, ageS, 0, 0).
    let cutMark: N = float(0);
    let blood: N = float(0);
    for (let i = 0; i < 4; i++) {
      const cp: N = u.cutPos[i];
      const ci: N = u.cutInfo[i];
      const sev: N = cp.w;
      const d: N = ref.sub(cp.xyz);
      // Half-length 3 / 5.5 / 8 mm for severity 1-3 (docs/design/08 §4.1.4: 6 / 12 / 20 mm wide).
      const len: N = sev.mul(0.0025).add(0.0005);
      const along: N = abs(d.x).div(len);
      // A split: widest in the middle, tapering to the ends, with a ragged edge.
      const wid: N = sev.mul(0.00035).add(0.0004).mul(float(1).sub(along.mul(along)).max(0).sqrt());
      const jag: N = edgeNoise.mul(0.6).add(sin(ref.x.mul(2300)).mul(0.15));
      const across: N = abs(d.y.add(d.x.mul(0.18)).add(jag.mul(0.0006)));
      const depth: N = step(abs(d.z), 0.02);
      const line: N = smoothstep(wid.add(0.0002), wid.mul(0.3), across).mul(step(along, 1)).mul(step(1e-4, sev)).mul(depth);
      cutMark = max(cutMark, line);
      // Drip: a run down from the middle of the cut, wider at the top, wandering, beading at the
      // end, growing with the cut's age while it bleeds (capped at ~4 cm).
      const run: N = min(ci.y.mul(0.0012).add(0.004), float(0.04)).mul(ci.x).mul(u.bloodOn);
      const wob: N = sin(ref.y.mul(260).add(i * 2.1)).mul(0.0012).add(sin(ref.y.mul(610).add(i)).mul(0.0005));
      const t: N = d.y.negate().div(run.max(1e-4)).clamp(); // 0 at the cut, 1 at the drip's end
      const dripW: N = mix(sev.mul(0.0006).add(0.0009), float(0.0005), t).add(smoothstep(0.8, 1, t).mul(0.0006));
      const drip: N = smoothstep(dripW, dripW.mul(0.45), abs(d.x.add(wob).sub(0.001 * (i - 1.5))))
        .mul(smoothstep(run.negate().sub(0.0015), run.negate().add(0.0005), d.y)).mul(smoothstep(0.001, -0.0005, d.y))
        .mul(step(1e-4, sev)).mul(depth);
      const pool: N = smoothstep(wid.mul(2.2).add(0.0008), wid, across).mul(step(along, 1.15)).mul(step(1e-4, sev)).mul(depth)
        .mul(ci.x).mul(u.bloodOn);
      blood = max(blood, max(drip, pool));
      // Surrounding redness.
      col = mix(col, col.mul(vec3(1.2, 0.7, 0.68)), exp(d.dot(d).div(len.mul(len).mul(2.5)).negate()).mul(step(1e-4, sev)).mul(0.5));
    }
    const closed: N = vec3(0.13, 0.035, 0.03);
    col = mix(col, closed, cutMark.mul(0.9));
    col = mix(col, vec3(0.2, 0.004, 0.006), blood);
    rough = mix(rough, float(0.12), blood);
    coat = max(coat, blood.mul(0.9));

    // Sweat: darker (wet skin scatters less), glossier.
    col = col.mul(float(1).sub(wet.mul(0.14)));
    rough = mix(rough, float(0.3), wet.mul(0.6));
    coat = max(coat, wet.mul(0.85)).mul(float(1).sub(mouthM));
    coatRough = mix(float(0.16), float(0.07), wet);
  }

  // --- tattoos -------------------------------------------------------------------------
  col = applyTattoos(col, ref, u, lm);

  // --- hand wraps and ankle tape (cloth painted over the skin) --------------------------
  const layers: N = n1.mul(0.08).add(0.92)
    .mul(smoothstep(0.1, 0.6, abs(sin(ref.x.mul(120).add(ref.y.mul(90)).add(ref.z.mul(60))))).mul(0.18).add(0.82));
  const wrapM: N = smoothstep(0.35, 0.6, fx.z).mul(u.wrapOn);
  const tapeM: N = smoothstep(0.045, 0.06, ref.y).mul(smoothstep(0.15, 0.135, ref.y)).mul(smoothstep(0.02, 0.04, abs(ref.x))).mul(u.tape);
  const cloth: N = max(wrapM, tapeM);
  col = mix(col, mix(u.wrapCol, vec3(0.62, 0.6, 0.56), tapeM).mul(layers), cloth);
  rough = mix(rough, float(0.85), cloth);
  coat = coat.mul(float(1).sub(cloth));

  m.colorNode = vec4(col, 1) as N;
  m.roughnessNode = rough.clamp(0.08, 0.9) as N;
  m.metalnessNode = float(0) as N;
  m.iorNode = float(1.4) as N;
  m.specularIntensityNode = float(1).sub(max(scalpCov, beardCov).mul(0.5)) as N;
  m.clearcoatNode = coat as N;
  m.clearcoatRoughnessNode = coatRough as N;
  m.specOcclusionNode = det.a.mul(0.35).add(0.65).mul(float(1).sub(cav.max(0).mul(0.4))).mul(float(1).sub(mouthM.mul(0.8)));
  m.thinNode = max(misc.y, earM.mul(0.9));
  m.scatterColorNode = u.scatter;
  m.scatterAmountNode = float(1).sub(u.tone.mul(0.35));
  return m;
}

/**
 * Tattoos (procedural, original designs — no real tattoo art): tribal-style bands and
 * blackwork shapes built from noise and stripes in canonical body space. Slots follow
 * `TattooSlot` order: leftArmFull, rightArmFull, leftForearm, rightForearm, chest, stomach, back,
 * neck, leftLeg, rightLeg, leftCalf, rightCalf.
 */
function applyTattoos(col: N, ref: N, u: SkinUniforms, lm: CanonicalLandmarks): N {
  const t0: N = u.tattoo[0], t1: N = u.tattoo[1], t2: N = u.tattoo[2];
  const x: N = ref.x, y: N = ref.y, z: N = ref.z;
  const ax: N = abs(x);
  const shoulderX = Math.abs(lm.earL[0]) + 0.1;
  // Arm coordinate along the T-pose arm (+X for left).
  const armBand = (side: number, x0: number, x1: number): N => {
    const s: N = x.mul(side);
    return smoothstep(x0, x0 + 0.01, s).mul(smoothstep(x1, x1 - 0.01, s)).mul(smoothstep(1.2, 1.3, y));
  };
  const blackwork = (p: N, scale: number): N => {
    const n: N = mx_noise_float(p.mul(scale));
    const w: N = mx_worley_noise_float(p.mul(scale * 0.8));
    const ring: N = smoothstep(0.05, 0.0, abs(n.mul(0.9).sub(0.1)).sub(0.06));
    const blob: N = smoothstep(0.25, 0.15, w).mul(smoothstep(0.1, 0.3, n));
    return max(ring, blob);
  };
  const tribal = (a: N, b: N, freq: number): N => {
    // Interlocking points: sharp stripes warped by a slow wave.
    const wave: N = sin(a.mul(freq)).mul(0.5).add(sin(a.mul(freq * 2.7).add(1.3)).mul(0.25));
    const stripe: N = abs(sin(b.mul(freq * 0.8).add(wave.mul(2.2))));
    return smoothstep(0.55, 0.75, stripe).mul(smoothstep(0.2, 0.5, abs(cos(a.mul(freq * 0.5)))));
  };
  // One blackwork field serves every blackwork slot (keeps the shader small).
  const bw: N = blackwork(ref, 26);
  let ink: N = float(0);
  // Full sleeves (shoulder → wrist) and forearm pieces.
  ink = max(ink, armBand(1, shoulderX, shoulderX + 0.5).mul(bw).mul(t0.x));
  ink = max(ink, armBand(-1, shoulderX, shoulderX + 0.5).mul(tribal(ax, atan(y.sub(1.4), z), 14)).mul(t0.y));
  ink = max(ink, armBand(1, shoulderX + 0.3, shoulderX + 0.48).mul(bw).mul(t0.z));
  ink = max(ink, armBand(-1, shoulderX + 0.3, shoulderX + 0.48).mul(tribal(ax.mul(2), atan(y.sub(1.4), z), 10)).mul(t0.w));
  // Chest piece (two wings across the pectorals), stomach script-like band, back piece, neck.
  const chest: N = smoothstep(1.28, 1.32, y).mul(smoothstep(1.45, 1.41, y)).mul(smoothstep(0.02, 0.05, z)).mul(smoothstep(0.2, 0.17, ax));
  ink = max(ink, chest.mul(tribal(ax.mul(1.6), y, 22)).mul(t1.x));
  const stomach: N = smoothstep(1.02, 1.05, y).mul(smoothstep(1.12, 1.09, y)).mul(smoothstep(0.03, 0.06, z)).mul(smoothstep(0.13, 0.1, ax));
  ink = max(ink, stomach.mul(smoothstep(0.35, 0.6, abs(sin(x.mul(260))).mul(abs(sin(y.mul(180)))))).mul(t1.y));
  const backP: N = smoothstep(1.15, 1.2, y).mul(smoothstep(1.48, 1.44, y)).mul(smoothstep(-0.02, -0.06, z)).mul(smoothstep(0.19, 0.15, ax));
  ink = max(ink, backP.mul(bw).mul(t1.z));
  const neck: N = smoothstep(lm.neckY - 0.05, lm.neckY - 0.03, y).mul(smoothstep(lm.neckY + 0.05, lm.neckY + 0.03, y)).mul(smoothstep(0.0, 0.03, abs(x)));
  ink = max(ink, neck.mul(tribal(atan(x, z), y, 9)).mul(t1.w));
  // Legs: thigh (full) and calf.
  const leg = (side: number, y0: number, y1: number): N =>
    smoothstep(0.0, 0.03, x.mul(side)).mul(smoothstep(y0, y0 + 0.02, y)).mul(smoothstep(y1, y1 - 0.02, y));
  ink = max(ink, leg(1, 0.5, 0.85).mul(bw).mul(t2.x));
  ink = max(ink, leg(-1, 0.5, 0.85).mul(tribal(atan(x.add(0.1), z), y, 12)).mul(t2.y));
  ink = max(ink, leg(1, 0.12, 0.4).mul(bw).mul(t2.z));
  ink = max(ink, leg(-1, 0.12, 0.4).mul(tribal(atan(x.sub(0.1), z), y, 16)).mul(t2.w));
  // Ink sits under the epidermis: multiply, slightly translucent.
  return mix(col, col.mul(u.tattooTint.mul(6).add(0.08)), ink.clamp().mul(0.85));
}

export { vec4 };
export type { N as TSLNode };
void If; void Fn; void pow; void cos;
