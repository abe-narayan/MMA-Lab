/**
 * BODY DIAGRAM — the frame, drawn from the numbers.
 *
 * Height, reach, leg reach and mass are four fields that interact, and a
 * column of metres cannot tell you that 1.68 m with a 1.98 m reach is a
 * freakish frame, or that 118 kg reads completely differently on 1.70 m than
 * on 2.01 m. The diagram makes those relationships visible while the sliders
 * move.
 *
 * It is a schematic, not a character render: a stick figure at the rig's real
 * proportions plus an explicit arm-span bar. The appearance fields (skin, hair,
 * tattoos) deliberately do not appear here — nothing in appearance may enter a
 * simulation formula, so putting it in the diagram that explains the sim would
 * imply otherwise.
 *
 * All geometry comes from `bodyGeometry`, which is pure and tested; this file
 * only turns coordinates into SVG.
 */

import { bodyGeometry, type BodyInput } from '../model/bodyGeometry';
import { dualLength, dualMass } from '../model/units';

export interface BodyDiagramProps {
  body: BodyInput;
  /** Shown under the figure; suppressed on the dense database preview. */
  showCaption?: boolean;
}

export function BodyDiagram({ body, showCaption = true }: BodyDiagramProps): JSX.Element {
  const g = bodyGeometry(body);
  const cx = g.centreX;

  const shoulderL = cx - g.shoulderHalfW;
  const shoulderR = cx + g.shoulderHalfW;
  const hipL = cx - g.hipHalfW;
  const hipR = cx + g.hipHalfW;
  const waistY = (g.shoulderY + g.hipY) / 2;

  const torso = [
    `M ${shoulderL} ${g.shoulderY}`,
    `L ${shoulderR} ${g.shoulderY}`,
    `L ${cx + g.waistHalfW} ${waistY}`,
    `L ${hipR} ${g.hipY}`,
    `L ${hipL} ${g.hipY}`,
    `L ${cx - g.waistHalfW} ${waistY}`,
    'Z',
  ].join(' ');

  // The arms are drawn as a straight span at the real reach-to-height ratio:
  // the single clearest statement the picture makes is "this is how far this
  // fighter can touch you from".
  const armY = g.shoulderY + (g.hipY - g.shoulderY) * 0.18;
  const spanL = cx - g.armHalfSpan;
  const spanR = cx + g.armHalfSpan;

  const kneeSpread = g.hipHalfW * 0.75;
  const ankleSpread = g.hipHalfW * 0.85;

  const heightLabel = dualLength(body.heightM, 'height');
  const reachLabel = dualLength(body.reachM, 'reach');

  return (
    <figure className="body-diagram">
      <svg
        viewBox={`0 0 ${g.viewBoxW} ${g.viewBoxH}`}
        className="body-diagram-svg"
        role="img"
        aria-label={
          `Schematic figure: ${heightLabel} tall, ${reachLabel} reach, ` +
          `${dualMass(body.massKg)}, ape index ${g.apeIndex.toFixed(3)}, BMI ${g.bmi.toFixed(1)}.`
        }
      >
        {/* Floor line and a fixed 2.00 m gridline, so the figure's height is
            read against something rather than against the last one drawn. */}
        <line x1={8} y1={g.soleY} x2={g.viewBoxW - 8} y2={g.soleY} className="bd-floor" />
        <line x1={8} y1={g.headTopY} x2={g.viewBoxW - 8} y2={g.headTopY} className="bd-guide" />

        {/* Arm span bar */}
        <line x1={spanL} y1={armY} x2={spanR} y2={armY} className="bd-span" strokeWidth={g.limbW} />
        <line x1={spanL} y1={armY - 6} x2={spanL} y2={armY + 6} className="bd-tick" />
        <line x1={spanR} y1={armY - 6} x2={spanR} y2={armY + 6} className="bd-tick" />

        {/* Torso */}
        <path d={torso} className="bd-torso" />

        {/* Neck + head */}
        <line x1={cx} y1={g.headBottomY} x2={cx} y2={g.shoulderY} className="bd-limb" strokeWidth={g.limbW * 1.1} />
        <ellipse
          cx={cx}
          cy={g.headTopY + g.headRadiusY}
          rx={g.headRadiusX}
          ry={g.headRadiusY}
          className="bd-head"
        />

        {/* Legs: the hip height is the measured leg reach, not a fixed fraction. */}
        <line x1={hipL + g.limbW / 2} y1={g.hipY} x2={cx - kneeSpread} y2={g.kneeY} className="bd-limb" strokeWidth={g.limbW} />
        <line x1={cx - kneeSpread} y1={g.kneeY} x2={cx - ankleSpread} y2={g.soleY} className="bd-limb" strokeWidth={g.limbW} />
        <line x1={hipR - g.limbW / 2} y1={g.hipY} x2={cx + kneeSpread} y2={g.kneeY} className="bd-limb" strokeWidth={g.limbW} />
        <line x1={cx + kneeSpread} y1={g.kneeY} x2={cx + ankleSpread} y2={g.soleY} className="bd-limb" strokeWidth={g.limbW} />
      </svg>

      {showCaption ? (
        <figcaption className="body-diagram-caption">
          <span><b>Height</b> {heightLabel}</span>
          <span><b>Reach</b> {reachLabel}</span>
          <span><b>Mass</b> {dualMass(body.massKg)}</span>
          <span title="Reach divided by height. Above 1.03 is a notably long-armed fighter.">
            <b>Ape index</b> {g.apeIndex.toFixed(3)}
          </span>
          <span title="Leg reach as a fraction of standing height. The rig's hip sits here.">
            <b>Leg fraction</b> {g.legFraction.toFixed(3)}
          </span>
          <span title="Mass over height squared. Shown as a frame check, not a performance term.">
            <b>BMI</b> {g.bmi.toFixed(1)}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
