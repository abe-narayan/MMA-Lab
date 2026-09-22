/**
 * MODEL TAB
 *
 * The point of this tab is that nothing in the simulation is hidden. It shows
 * the two athlete profiles as supplied, the attributes derived from them with
 * the arithmetic that produced each one (`derivationNotes`), and then every
 * single parameter the engine runs on, grouped the way `params.ts` groups them.
 */

import { ATHLETE_A, ATHLETE_B, deriveAttributes, type AthleteProfile } from '../engine/fighter';
import { DEFAULT_PARAMS, type Params } from '../engine/params';
import { DEFAULT_PARAMS_HASH } from '../engine/recorder';

interface ParamGroup {
  title: string;
  note: string;
  keys: (keyof Params)[];
}

const PARAM_GROUPS: ParamGroup[] = [
  {
    title: 'Time base',
    note: 'Fixed timestep. Everything in the engine is counted in ticks, so the same seed produces the same tick sequence on any machine.',
    keys: ['dt', 'rounds', 'roundSeconds', 'breakSeconds'],
  },
  {
    title: 'Arena',
    note: 'A regulation-sized octagon. Position is simulated in metres and fighters cannot leave the cage.',
    keys: ['cageRadius'],
  },
  {
    title: 'Attribute derivation',
    note: 'How body metrics, lifts and training years become model attributes. Lifting is used only as strength relative to bodyweight, never as an absolute load, and experience saturates.',
    keys: [
      'refBodyMassKg', 'refRelStrength', 'tkdTransfer', 'boxTransfer',
      'tauStriking', 'tauGrappling', 'tauTechnical', 'strengthWeight', 'massPowerWeight',
    ],
  },
  {
    title: 'Movement',
    note: 'Steering and integration. Mass costs speed; technique buys some of it back.',
    keys: ['baseSpeed', 'speedSkillBonus', 'speedMassPenalty', 'accel', 'drag', 'staminaSpeedFactor'],
  },
  {
    title: 'Stamina',
    note: 'Conditioning changes stamina economy only. It never adds fresh capability.',
    keys: [
      'staminaMax', 'staminaRegenStanding', 'staminaRegenConditioning', 'staminaDrainMove',
      'staminaDrainClinch', 'staminaDrainGroundTop', 'staminaDrainGroundBottom',
      'staminaDrainDamage', 'breakRecovery',
    ],
  },
  {
    title: 'Balance',
    note: 'Committing to a big strike spends balance; balance recovers on its own.',
    keys: ['balanceMax', 'balanceRegen'],
  },
  {
    title: 'Striking',
    note: 'Every strike is one logistic roll. The base rate is an assumption; skill, technique, guard, evasion and fatigue shift it on the logit scale.',
    keys: [
      'strikeBaseHit', 'strikeSkillGain', 'strikeTechniqueGain', 'blockLogit',
      'evadeLogit', 'strikeFatigueLogit', 'defenceFatigueLogit',
    ],
  },
  {
    title: 'Impact',
    note: 'An abstract 0-100 index. Its only role is to trigger an administrative referee stoppage; no injury or medical outcome is modelled.',
    keys: [
      'damagePowerScale', 'damageVariation', 'damageBlockedFraction', 'knockdownThreshold',
      'knockdownChance', 'tkoDamage', 'damageRecoveryPerRound',
    ],
  },
  {
    title: 'Grappling',
    note: 'Takedowns, clinch entries, passes, sweeps, stand-ups and submissions, each a per-attempt or per-tick probability shifted by strength, mass and grappling experience.',
    keys: [
      'takedownBaseChance', 'takedownStrengthGain', 'takedownMassGain', 'takedownSkillGain',
      'sprawlLogit', 'clinchBaseChance', 'clinchStrengthGain', 'passBase', 'sweepBase',
      'standUpBase', 'subProgressBase', 'subEscapeBase',
    ],
  },
  {
    title: 'Referee',
    note: 'The referee is modelled explicitly: it checks a battered fighter on a clock, counts unanswered ground strikes, and stands up a stalled position.',
    keys: ['refCheckSeconds', 'groundedStrikeStopCount', 'standUpAfterStalledSeconds'],
  },
  {
    title: 'Scoring',
    note: 'Three judges score each round from the same tallies, with independent per-round noise.',
    keys: ['scoreSigStrike', 'scoreTakedown', 'scoreControlPerSecond', 'scoreSubAttempt', 'judgeNoise'],
  },
  {
    title: 'Bout-to-bout variation',
    note: 'Why two bouts from the same profiles are never identical: a per-bout form multiplier, jittered tendencies and a softmax temperature on action choice.',
    keys: ['formSd', 'tendencySd', 'decisionNoise'],
  },
  {
    title: 'Handicap format (1 vs N)',
    note: 'There is deliberately no "numbers bonus" constant. How many opponents can reach the lone fighter at once emerges from cage geometry and reach. Only these three terms are added.',
    keys: ['teamSpreadRadians', 'swarmStaminaPenalty', 'focusPenaltyLogit'],
  },
];

const PARAM_NOTES: Partial<Record<keyof Params, string>> = {
  dt: 'seconds per simulation tick',
  rounds: 'rounds in a bout',
  roundSeconds: 'length of a round, seconds',
  breakSeconds: 'rest between rounds, seconds',
  cageRadius: 'metres, centre to fence',
  refBodyMassKg: 'reference mass for the mass index, kg',
  refRelStrength: 'reference (bench + squat + deadlift) / bodyweight',
  tkdTransfer: 'one year of Taekwondo counted as this many years of relevant striking',
  boxTransfer: 'one year of boxing counted as this many years',
  tauStriking: 'saturation constant for striking experience, years',
  tauGrappling: 'saturation constant for grappling experience, years',
  tauTechnical: 'saturation constant for general ring craft, years',
  strengthWeight: 'weight on log relative strength in the power index',
  massPowerWeight: 'weight on log relative mass in the power index',
  baseSpeed: 'm/s at full stamina for a technique index of 0',
  speedSkillBonus: 'extra m/s at technique index 1',
  speedMassPenalty: 'm/s lost per unit of log mass ratio',
  accel: 'm/s squared',
  drag: 'velocity damping per second',
  staminaSpeedFactor: 'share of speed lost at empty stamina',
  staminaMax: 'base stamina pool before conditioning',
  staminaRegenStanding: 'points per second at conditioning 0',
  staminaRegenConditioning: 'extra points per second at conditioning 1',
  staminaDrainMove: 'per second at full movement speed',
  staminaDrainClinch: 'per second in the clinch',
  staminaDrainGroundTop: 'per second on top',
  staminaDrainGroundBottom: 'per second underneath',
  staminaDrainDamage: 'per unit of impact absorbed',
  breakRecovery: 'fraction of missing stamina restored between rounds',
  balanceMax: 'balance pool',
  balanceRegen: 'points per second',
  strikeBaseHit: 'probability a strike lands cleanly against a neutral defender',
  strikeSkillGain: 'logit gain per unit of striking-index difference',
  strikeTechniqueGain: 'logit gain per unit of technique difference',
  blockLogit: 'logit penalty from an active guard',
  evadeLogit: 'logit penalty from a successful evasion',
  strikeFatigueLogit: 'logit penalty per unit of attacker fatigue',
  defenceFatigueLogit: 'logit gain per unit of defender fatigue',
  damagePowerScale: 'multiplies each action base impact',
  damageVariation: 'lognormal sd of the per-strike impact roll',
  damageBlockedFraction: 'share of impact that gets through a block',
  knockdownThreshold: 'single-strike impact that can drop someone',
  knockdownChance: 'probability at that threshold',
  tkoDamage: 'impact index at which the referee steps in',
  damageRecoveryPerRound: 'impact index shed during the break',
  takedownBaseChance: 'base probability of a completed takedown',
  takedownStrengthGain: 'logit gain per unit of strength-index difference',
  takedownMassGain: 'logit gain per unit of log mass ratio',
  takedownSkillGain: 'logit gain per unit of grappling-index difference',
  sprawlLogit: 'logit penalty from a successful sprawl',
  clinchBaseChance: 'base probability of a clinch entry',
  clinchStrengthGain: 'logit gain per unit of strength-index difference',
  passBase: 'per-tick probability of passing the guard',
  sweepBase: 'per-tick probability of sweeping from the bottom',
  standUpBase: 'per-tick probability of standing back up',
  subProgressBase: 'submission progress per tick when unopposed; tap at 1.0',
  subEscapeBase: 'per-tick probability of escaping a submission',
  refCheckSeconds: 'how often the referee evaluates a battered fighter',
  groundedStrikeStopCount: 'unanswered ground strikes before a stoppage',
  standUpAfterStalledSeconds: 'stand-up call after a stalled position, seconds',
  scoreSigStrike: 'score per significant strike landed',
  scoreTakedown: 'score per completed takedown',
  scoreControlPerSecond: 'score per second of control',
  scoreSubAttempt: 'score per submission attempt',
  judgeNoise: 'per-judge, per-round noise on the round margin',
  formSd: 'per-bout form multiplier, sd on the log scale',
  tendencySd: 'per-bout jitter on action tendencies',
  decisionNoise: 'softmax temperature on action selection',
  teamSpreadRadians: 'how widely the group fans out around the lone fighter',
  swarmStaminaPenalty: 'extra stamina drain per additional engaged opponent',
  focusPenaltyLogit: 'defensive logit lost per additional engaged opponent',
};

function ProfileCard(props: { profile: AthleteProfile; team: 'A' | 'B'; corner: string }) {
  const { profile, team, corner } = props;
  const d = deriveAttributes(profile, DEFAULT_PARAMS);
  const liftTotal = profile.benchLb + profile.squatLb + profile.deadliftLb;

  return (
    <article className="athlete" data-team={team}>
      <h4>{profile.name}</h4>
      <div className="sub">{corner}</div>

      <dl className="attr-list">
        <div className="attr">
          <dt>Supplied</dt>
          <dd>
            {Math.floor(profile.heightIn / 12)}&prime;{profile.heightIn % 12}&Prime; &middot;{' '}
            {profile.weightLb} lb &middot; age {profile.ageYears}
          </dd>
        </div>
        <div className="attr">
          <dt>Lifts (bench / squat / dead)</dt>
          <dd>
            {profile.benchLb} / {profile.squatLb} / {profile.deadliftLb} lb
          </dd>
        </div>
        <div className="attr">
          <dt>Lift total, relative</dt>
          <dd>
            {liftTotal} lb &middot; {(liftTotal / profile.weightLb).toFixed(2)}&times; bw
          </dd>
        </div>
        <div className="attr">
          <dt>Training</dt>
          <dd>
            TKD {profile.taekwondoYears} &middot; box {profile.boxingYears} &middot; grap{' '}
            {profile.grapplingYears} yr
          </dd>
        </div>
        <div className="attr">
          <dt>Conditioning</dt>
          <dd>
            {profile.conditioning.toFixed(2)} &middot; {profile.trainingDaysPerWeek} d/wk
          </dd>
        </div>

        <div className="attr">
          <dt>Mass / height / reach</dt>
          <dd>
            {d.massKg.toFixed(1)} kg &middot; {d.heightM.toFixed(2)} m &middot; {d.reachM.toFixed(2)} m
          </dd>
        </div>
        <div className="attr">
          <dt>Mass index</dt>
          <dd>{d.massIndex.toFixed(3)}</dd>
        </div>
        <div className="attr">
          <dt>Strength index</dt>
          <dd>{d.strengthIndex.toFixed(3)}</dd>
        </div>
        <div className="attr">
          <dt>Striking index</dt>
          <dd>{d.strikingIndex.toFixed(3)}</dd>
        </div>
        <div className="attr">
          <dt>Grappling index</dt>
          <dd>{d.grapplingIndex.toFixed(3)}</dd>
        </div>
        <div className="attr">
          <dt>Technique index</dt>
          <dd>{d.techniqueIndex.toFixed(3)}</dd>
        </div>
        <div className="attr">
          <dt>Power index</dt>
          <dd>{d.powerIndex.toFixed(3)}</dd>
        </div>
        <div className="attr">
          <dt>Speed</dt>
          <dd>{d.speed.toFixed(2)} m/s</dd>
        </div>
        <div className="attr">
          <dt>Stamina pool / regen</dt>
          <dd>
            {d.staminaMax.toFixed(0)} &middot; {d.staminaRegen.toFixed(2)}/s
          </dd>
        </div>
        <div className="attr">
          <dt>Stoppage threshold</dt>
          <dd>{d.durability.toFixed(0)}</dd>
        </div>
      </dl>

      <ul className="notes" aria-label={`How ${profile.name}'s attributes were derived`}>
        {d.derivationNotes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </article>
  );
}

export function ModelNotes() {
  return (
    <div className="model">
      <section>
        <h2>What this model is, and what it is not</h2>
        <p>
          Bout Lab is a modelling toy. It simulates a regulated, refereed contest under
          unified-style rules between two profiles, tick by tick, from a seed. Every probability,
          weight and threshold below was chosen by hand to be plausible. None of them was fitted to
          real fight data, and no part of the model has been validated against real outcomes.
          Results describe this model and nothing else &mdash; they are not a prediction about what
          would happen between real people.
        </p>
        <p>
          Accumulated impact is represented as an abstract 0&ndash;100 index whose only function is
          to trigger an administrative referee stoppage. No injury, wound, medical outcome or
          lasting harm is modelled, computed or depicted anywhere in this project.
        </p>
      </section>

      <section>
        <h3>Derived attributes</h3>
        <p>
          The profiles supply body metrics, three one-rep-max lifts and training history. None of
          those is a fighting attribute, so each is translated explicitly. Every arrow below is the
          exact arithmetic the engine used.
        </p>
        <div className="tape">
          <ProfileCard profile={ATHLETE_A} team="A" corner="red corner" />
          <ProfileCard profile={ATHLETE_B} team="B" corner="blue corner" />
        </div>
      </section>

      <section>
        <div className="callout">
          <h3>Four choices that drive everything else</h3>
          <p>
            1. Lifting strength is never a direct proxy for fighting ability: it enters only as
            strength relative to bodyweight, on a log scale. 2. Experience saturates, so the fifth
            year of training is worth far less than the first. 3. One year of Taekwondo counts as
            0.6 of a boxing year for this ruleset &mdash; a judgement call, not a measurement.
            4. Conditioning changes stamina economy only; it never adds capability.
          </p>
        </div>
      </section>

      <section>
        <h3>Every parameter</h3>
        <p>
          These are the defaults every bout in this build was run with. Parameter set fingerprint{' '}
          <span className="mono">{DEFAULT_PARAMS_HASH}</span> &mdash; a replay whose{' '}
          <span className="mono">paramsHash</span> differs was produced by a different model.
        </p>

        {PARAM_GROUPS.map((group) => (
          <div className="table-wrap" key={group.title}>
            <table className="params">
              <caption>{group.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">Value</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {group.keys.map((k) => (
                  <tr key={String(k)}>
                    <th scope="row" className="k">{String(k)}</th>
                    <td className="v">{String(DEFAULT_PARAMS[k])}</td>
                    <td className="d">{PARAM_NOTES[k] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="group-note">{group.note}</p>
          </div>
        ))}
      </section>

      <section>
        <h3>How a replay works</h3>
        <p>
          The engine is a pure function of seed, parameters and profiles, so a replay file stores
          the seed and the complete event timeline rather than thousands of frames of poses. Opening
          a bout re-runs the simulation from its seed and compares a fingerprint of the whole
          per-tick state stream against the one recorded in the file. If those disagree, the replay
          is marked <span className="mono">digest mismatch</span> instead of quietly showing a
          different bout.
        </p>
      </section>
    </div>
  );
}
