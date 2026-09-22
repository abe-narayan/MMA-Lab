/**
 * LIVE HUD
 *
 * Reads straight from the current TickSnapshot, so it is exact for the frame on
 * screen rather than an average. Stamina and the stoppage threshold are
 * per-fighter (they come from the derived attributes), so the meters are scaled
 * per fighter rather than against a shared 0-100.
 */

import { ACTION_LABEL } from '../engine/actions';
import { DEFAULT_PARAMS } from '../engine/params';
import type { TickSnapshot } from '../engine/types';
import { clock } from './Controls';

export interface HudScale {
  staminaMax: number;
  durability: number;
}

export interface HudProps {
  frame: TickSnapshot | null;
  labels: string[];
  teams: ('A' | 'B')[];
  scales: HudScale[];
  totalFrames: number;
  frameIndex: number;
  loading: boolean;
}

const POSTURE_LABEL: Record<string, string> = {
  standing: 'standing',
  clinch: 'clinch',
  ground: 'ground',
  down: 'down',
};

const DEFENSE_LABEL: Record<string, string> = {
  neutral: 'neutral',
  highGuard: 'high guard',
  slip: 'slipping',
  parry: 'parrying',
  sprawl: 'sprawling',
  frame: 'framing',
  subDefend: 'defending sub',
};

function pct(value: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function Meter(props: { kind: 'stamina' | 'balance' | 'damage'; label: string; fraction: number; read: string }) {
  return (
    <div className="meter-row">
      <span className="meter-name">{props.label}</span>
      <div
        className={`meter meter--${props.kind}`}
        data-low={props.kind === 'stamina' && props.fraction < 35 ? 'true' : 'false'}
        aria-hidden="true"
      >
        <i style={{ width: `${props.fraction}%` }} />
      </div>
      <span className="meter-value">{props.read}</span>
    </div>
  );
}

export function Hud(props: HudProps) {
  const { frame, labels, teams, scales, totalFrames, frameIndex, loading } = props;

  if (!frame) {
    return (
      <section className="panel hud" aria-label="Live bout state">
        <div className="panel-head">
          <span className="panel-title">Live state</span>
        </div>
        <p className="empty">{loading ? 'Rebuilding the bout from its seed…' : 'No bout loaded.'}</p>
      </section>
    );
  }

  let scoreA = 0;
  let scoreB = 0;
  frame.fighters.forEach((f, i) => {
    if (teams[i] === 'A') scoreA += f.score;
    else scoreB += f.score;
  });
  const margin = scoreA - scoreB;

  return (
    <section className="panel hud" aria-label="Live bout state">
      <div className="hud-clock">
        <div>
          <span className="clock-label">Round</span>
          <span className="clock-value">
            {frame.round}
            <small> / {DEFAULT_PARAMS.rounds}</small>
          </span>
        </div>
        <div>
          <span className="clock-label">Round clock</span>
          <span className="clock-value">
            {clock(frame.roundTime)}
            <small> / {clock(DEFAULT_PARAMS.roundSeconds)}</small>
          </span>
        </div>
        <div>
          <span className="clock-label">Bout clock</span>
          <span className="clock-value">
            {clock(frame.t)}
            <small> {frame.phase}</small>
          </span>
        </div>
      </div>

      <div className="hud-score">
        <span>
          Running score <b className="num">{scoreA.toFixed(1)}</b>
          <span aria-hidden="true"> &ndash; </span>
          <b className="num">{scoreB.toFixed(1)}</b>
        </span>
        <span>
          margin{' '}
          <b className="num">
            {margin >= 0 ? '+' : '−'}
            {Math.abs(margin).toFixed(1)}
          </b>{' '}
          {margin >= 0 ? 'red' : 'blue'}
        </span>
      </div>

      {frame.fighters.map((f, i) => {
        const team = teams[i] ?? (i === 0 ? 'A' : 'B');
        const scale = scales[i] ?? { staminaMax: DEFAULT_PARAMS.staminaMax, durability: DEFAULT_PARAMS.tkoDamage };
        const staminaPct = pct(f.stamina, scale.staminaMax);
        const balancePct = pct(f.balance, DEFAULT_PARAMS.balanceMax);
        const damagePct = pct(f.damage, scale.durability);
        const action = ACTION_LABEL[f.action] ?? f.action;

        return (
          <article
            className="fighter-card"
            data-team={team}
            data-out={f.out ? 'true' : 'false'}
            key={f.id}
            aria-label={`${labels[i] ?? `Fighter ${f.id}`} state`}
          >
            <div className="fc-head">
              <span className="fc-name">{labels[i] ?? `F${f.id}`}</span>
              <span className="fc-corner">{team === 'A' ? 'red corner' : 'blue corner'}</span>
              <span className="fc-score">
                score <b className="num">{f.score.toFixed(1)}</b>
              </span>
            </div>

            <div className="meters">
              <Meter
                kind="stamina"
                label="Stamina"
                fraction={staminaPct}
                read={`${Math.round(staminaPct)}%`}
              />
              <Meter
                kind="balance"
                label="Balance"
                fraction={balancePct}
                read={`${Math.round(balancePct)}%`}
              />
              <Meter
                kind="damage"
                label="Impact"
                fraction={damagePct}
                read={`${Math.round(f.damage)}`}
              />
            </div>

            <div className="fc-state">
              <span className="tag">
                <b>{POSTURE_LABEL[f.posture] ?? f.posture}</b>
              </span>
              {f.posture === 'ground' && f.groundPosition !== 'none' ? (
                <span className="tag">
                  <b>{f.groundPosition}</b> {f.groundRole !== 'none' ? f.groundRole : ''}
                </span>
              ) : null}
              <span className={`tag ${f.action !== 'idle' ? 'tag--action' : ''}`}>{action}</span>
              {f.actionResult !== 'none' ? (
                <span className={`tag ${f.actionResult === 'landed' ? 'tag--landed' : ''}`}>
                  {f.actionResult}
                </span>
              ) : null}
              <span className="tag">{DEFENSE_LABEL[f.defense] ?? f.defense}</span>
              {f.subProgress > 0 ? (
                <span className="tag tag--alert">sub {Math.round(f.subProgress * 100)}%</span>
              ) : null}
              {f.down ? <span className="tag tag--alert">down</span> : null}
              {f.out ? <span className="tag tag--alert">out of the bout</span> : null}
            </div>

            <div className="fc-tally">
              <span>
                sig strikes <b>{f.sigLanded}</b>/{f.sigAttempted}
              </span>
              <span>
                accuracy <b>{f.sigAttempted ? Math.round((f.sigLanded / f.sigAttempted) * 100) : 0}%</b>
              </span>
            </div>
          </article>
        );
      })}

      <div className="hud-score" aria-hidden="true">
        <span>
          tick <b className="num">{frame.tick}</b> &middot; frame{' '}
          <b className="num">{frameIndex + 1}</b>/{totalFrames}
        </span>
        <span>0.1 s per tick</span>
      </div>
    </section>
  );
}
