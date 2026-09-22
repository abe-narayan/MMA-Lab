/**
 * BODY DIAGRAM GEOMETRY — the schematic that answers "what did I just build?".
 *
 * A number column cannot tell you that you have made a 1.68 m fighter with a
 * 1.98 m reach, or that 118 kg on a 1.70 m frame is a different animal from
 * 118 kg on a 2.01 m frame. The diagram exists to make those two facts visible
 * at a glance while the sliders move.
 *
 * It is deliberately schematic: a stick figure with real proportions, not a
 * character render. The proportions follow the same rig rules the sim's own
 * derivation uses (01 §2.1.2) so the picture cannot say something the engine
 * disagrees with, but the widths are illustrative, not simulated.
 *
 * Pure arithmetic, no React, no DOM — which is also what makes it testable.
 */

export interface BodyInput {
  heightM: number;
  reachM: number;
  legReachM: number;
  massKg: number;
  bodyFatPct: number;
  /** Somatotype blend; need not sum to exactly 1, it is normalised here. */
  build: { ecto: number; meso: number; endo: number };
  stance: string;
}

export interface BodyGeometry {
  /** The SVG user-space box the figure is drawn in. */
  viewBoxW: number;
  viewBoxH: number;
  /** Vertical landmarks, top of head to sole, in user space. */
  headTopY: number;
  headBottomY: number;
  shoulderY: number;
  hipY: number;
  kneeY: number;
  soleY: number;
  centreX: number;
  headRadiusX: number;
  headRadiusY: number;
  shoulderHalfW: number;
  waistHalfW: number;
  hipHalfW: number;
  /** Half of the fingertip-to-fingertip span, as drawn. */
  armHalfSpan: number;
  /** Stroke width for the limbs; thicker bodies get thicker limbs. */
  limbW: number;
  /** Derived readouts the caption prints. */
  bmi: number;
  /** reach / height. Above 1.0 is a long-armed fighter. */
  apeIndex: number;
  /** Fraction of standing height that is leg. */
  legFraction: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The tallest and shortest figure the box can hold, so the scale is shared. */
const MIN_H = 1.45;
const MAX_H = 2.10;

const VIEW_W = 200;
const VIEW_H = 240;
/** Vertical padding so the tallest figure still has air above the head. */
const PAD_Y = 10;

/**
 * Build the diagram's coordinates from the body block.
 *
 * Two fighters are only comparable if they share a scale, so height maps onto
 * the box linearly rather than filling it: a 1.65 m fighter genuinely draws
 * shorter than a 1.95 m one. Everything else is expressed as a fraction of the
 * *drawn* height, except the arm span and leg length, which come from their own
 * measurements — that is the whole point of the picture.
 */
export function bodyGeometry(input: BodyInput): BodyGeometry {
  const heightM = clamp(safe(input.heightM, 1.78), MIN_H, MAX_H);
  const reachM = clamp(safe(input.reachM, heightM), 1.2, 2.5);
  const legReachM = clamp(safe(input.legReachM, heightM * 0.575), 0.5, 1.4);
  const massKg = clamp(safe(input.massKg, 77), 35, 220);
  const bodyFatPct = clamp(safe(input.bodyFatPct, 12), 2, 50);

  const sum = Math.max(1e-6, input.build.ecto + input.build.meso + input.build.endo);
  const meso = clamp(input.build.meso / sum, 0, 1);
  const endo = clamp(input.build.endo / sum, 0, 1);

  const usableH = VIEW_H - PAD_Y * 2;
  // Fraction of the box the tallest figure gets; the shortest gets 0.78 of it.
  const drawn = usableH * (0.78 + 0.22 * ((heightM - MIN_H) / (MAX_H - MIN_H)));

  const soleY = VIEW_H - PAD_Y;
  const headTopY = soleY - drawn;

  // Rig fractions, 01 §2.1.2: head 0.13 H, neck 0.05 H.
  const headH = drawn * 0.13;
  const headBottomY = headTopY + headH;
  const shoulderY = headBottomY + drawn * 0.05;

  // Leg length is measured, not assumed: a long-legged fighter has a high hip.
  const legFraction = clamp(legReachM / heightM, 0.40, 0.68);
  const hipY = soleY - drawn * legFraction;
  const kneeY = hipY + (soleY - hipY) * 0.52;

  // Mass relative to what this height "should" weigh (23.5 x H^2, 01 §2.1.2).
  // Bulk is what makes a heavyweight read as a heavyweight rather than as a
  // scaled-up flyweight.
  const refMass = 23.5 * heightM * heightM;
  const bulk = clamp(massKg / refMass, 0.7, 1.9);

  const shoulderHalfW = drawn * 0.10 * (0.86 + 0.28 * meso) * Math.pow(bulk, 0.55);
  const hipHalfW = shoulderHalfW * (0.66 + 0.20 * endo);
  // Body fat above the 10% reference is where the waist goes, matching the
  // sim's own waistScale = 1 + 0.012 x (bodyFat - 10).
  const waistHalfW = hipHalfW * clamp(1 + 0.012 * (bodyFatPct - 10), 0.8, 1.6);

  // Arm span is drawn at the real ratio to height: the span crossbar is the
  // single clearest statement the diagram makes.
  const armHalfSpan = (drawn * (reachM / heightM)) / 2;

  const limbW = clamp(drawn * 0.016 * Math.pow(bulk, 0.7), 1.6, 9);

  return {
    viewBoxW: VIEW_W,
    viewBoxH: VIEW_H,
    headTopY: round(headTopY),
    headBottomY: round(headBottomY),
    shoulderY: round(shoulderY),
    hipY: round(hipY),
    kneeY: round(kneeY),
    soleY: round(soleY),
    centreX: VIEW_W / 2,
    headRadiusX: round(headH * 0.38),
    headRadiusY: round(headH * 0.5),
    shoulderHalfW: round(shoulderHalfW),
    waistHalfW: round(waistHalfW),
    hipHalfW: round(hipHalfW),
    armHalfSpan: round(armHalfSpan),
    limbW: round(limbW),
    bmi: round(massKg / (heightM * heightM), 1),
    apeIndex: round(reachM / heightM, 3),
    legFraction: round(legFraction, 3),
  };
}

function safe(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function round(v: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}
