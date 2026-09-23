/**
 * The pieces of the broadcast package. Each is a pure render of its model
 * (see model.ts); entrance and exit motion is CSS, keyed so a new round, a new
 * knockdown or a new replay re-runs its wipe.
 */
import type { CSSProperties } from 'react';
import {
  type BroadcastBout, type BroadcastFighter, type ClockBugModel, type FinishModel, type KnockdownModel,
  type RoundStatsModel, type ScorecardsModel, feetInches, inchesOf, poundsOf,
} from './model';

const cv = (colour: string): CSSProperties => ({ ['--c' as string]: colour } as CSSProperties);

// ---------------------------------------------------------------- clock bug

export function ClockBug(props: {
  bout: BroadcastBout;
  model: ClockBugModel;
  showSigStrikes?: boolean;
}): JSX.Element {
  const { bout, model } = props;
  const fs = bout.fighters.slice(0, 2);
  return (
    <div className="bo-bug bo-glass" role="status" aria-label="Round clock">
      <div className="bo-bug__mark" aria-hidden="true"><b>BOUT</b><b>LAB</b></div>
      <div className="bo-bug__rows">
        {fs.map((f) => (
          <div key={f.id} className="bo-bug__row" style={cv(f.colour)}>
            <span className="bo-bug__corner" />
            <span className="bo-bug__name">
              {f.first ? <span className="bo-bug__first">{f.first}</span> : null}
              <span className="bo-bug__last">{f.last}</span>
            </span>
            <span />
            <span className="bo-bug__record">{f.record}</span>
          </div>
        ))}
      </div>
      {props.showSigStrikes ? (
        <div className="bo-bug__sig" aria-label="Significant strikes landed">
          {fs.map((f) => (
            <span key={f.id}>
              {model.sig[f.id]?.landed ?? 0}
              {f.id === 0 ? <small>SIG</small> : null}
            </span>
          ))}
        </div>
      ) : null}
      <div className="bo-bug__clock">
        <span className="bo-bug__round">
          {model.status === 'break' ? 'BREAK' : `ROUND ${model.round} / ${model.rounds}`}
        </span>
        <span className="bo-bug__time" data-status={model.status}>{model.clock}</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------- tale of the tape

function TapeRow(props: { label: string; a: JSX.Element | string; b: JSX.Element | string; i: number }): JSX.Element {
  return (
    <div className="bo-tape__row" style={{ animationDelay: `${220 + props.i * 55}ms` }}>
      <span className="bo-tape__val" data-side="0">{props.a}</span>
      <span className="bo-tape__label">{props.label}</span>
      <span className="bo-tape__val" data-side="1">{props.b}</span>
    </div>
  );
}

export function TaleOfTheTape(props: { bout: BroadcastBout }): JSX.Element {
  const [a, b] = props.bout.fighters;
  if (!a || !b) return <></>;
  const both = (pick: (f: BroadcastFighter) => JSX.Element | string): [JSX.Element | string, JSX.Element | string] => [pick(a), pick(b)];
  const rows: [string, [JSX.Element | string, JSX.Element | string]][] = [
    ['RECORD', both((f) => f.record)],
    ['AGE', both((f) => String(f.age))],
    ['HEIGHT', both((f) => <>{feetInches(f.heightCm)}<small>{f.heightCm} cm</small></>)],
    ['REACH', both((f) => <>{inchesOf(f.reachCm)}<small>{f.reachCm} cm</small></>)],
    ['WEIGHT', both((f) => <>{poundsOf(f.weightKg)}<small>{f.weightKg} kg</small></>)],
    ['STANCE', both((f) => f.stance)],
    ['BASE', both((f) => f.base)],
  ];
  return (
    <section className="bo-tape bo-glass" aria-label="Tale of the tape">
      <header className="bo-tape__head">
        <span className="bo-tape__title">TALE OF THE TAPE</span>
        <span className="bo-tape__event">{props.bout.eventTitle} · {props.bout.rulesetLabel}</span>
      </header>
      <div className="bo-tape__names">
        {[a, b].map((f, i) => (
          <div key={f.id} className="bo-tape__fighter" data-side={i} style={cv(f.colour)}>
            <div className="bo-tape__corner">{f.cornerLabel}</div>
            <div className="bo-tape__first">{f.first || ' '}</div>
            <div className="bo-tape__last">{f.last}</div>
            <div className="bo-tape__nick">{f.nickname ? `“${f.nickname}”` : f.weightClass || ' '}</div>
          </div>
        )).reduce<JSX.Element[]>((acc, el, i) => (i === 1 ? [...acc, <div key="vs" className="bo-tape__vs">VS</div>, el] : [...acc, el]), [])}
      </div>
      <div className="bo-tape__rows">
        {rows.map(([label, [va, vb]], i) => <TapeRow key={label} label={label} a={va} b={vb} i={i} />)}
      </div>
    </section>
  );
}

// ----------------------------------------------------------- round card

export function RoundCard(props: { bout: BroadcastBout; round: number; rounds: number }): JSX.Element {
  const [a, b] = props.bout.fighters;
  return (
    <div className="bo-round bo-glass" aria-label={`Round ${props.round}`}>
      <div className="bo-round__num"><small>ROUND</small><b>{props.round}</b></div>
      <div className="bo-round__body">
        <span className="bo-round__of">
          {props.round === props.rounds ? 'FINAL ROUND' : `ROUND ${props.round} OF ${props.rounds}`}
        </span>
        {a && b ? (
          <span className="bo-round__names">
            <span style={cv(a.colour)}><span className="bo-tick" />{a.last}</span>
            <i>VS</i>
            <span style={cv(b.colour)}><span className="bo-tick" />{b.last}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------- end-of-round comparison

export function RoundStatsPanel(props: { bout: BroadcastBout; model: RoundStatsModel }): JSX.Element {
  const [a, b] = props.bout.fighters;
  return (
    <section className="bo-stats bo-glass" aria-label={props.model.title}>
      <header className="bo-stats__head">{props.model.title}</header>
      <div className="bo-stats__names">
        <span style={cv(a?.colour ?? '#fff')}><span className="bo-tick" />{a?.last}</span>
        <span style={cv(b?.colour ?? '#fff')}>{b?.last}<span className="bo-tick" style={{ marginLeft: 'calc(var(--u) * 10)', marginRight: 0 }} /></span>
      </div>
      {props.model.lines.map((l, i) => (
        <div key={l.label} className="bo-stats__line" style={{ animationDelay: `${140 + i * 60}ms` }}>
          <div className="bo-stats__vals">
            <b>{l.values[0]}</b>
            <span>{l.label}</span>
            <b>{l.values[1]}</b>
          </div>
          <div className="bo-stats__bar" aria-hidden="true">
            {l.share === null ? null : (
              <>
                <i style={{ ...cv(a?.colour ?? '#fff'), width: `${l.share * 100}%`, ['--o' as string]: 'left' } as CSSProperties} />
                <i style={{ ...cv(b?.colour ?? '#fff'), width: `${(1 - l.share) * 100}%`, ['--o' as string]: 'right' } as CSSProperties} />
              </>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

// --------------------------------------------------------- knockdown flash

export function KnockdownFlash(props: { bout: BroadcastBout; model: KnockdownModel }): JSX.Element {
  const by = props.bout.fighters[props.model.by];
  const downed = props.bout.fighters[props.model.downed];
  const who = by ?? downed;
  return (
    <div className="bo-kd bo-glass" role="status">
      <span className="bo-kd__label">KNOCKDOWN</span>
      {who ? (
        <span className="bo-kd__who" style={cv(who.colour)}>
          <span className="bo-tick" />{who.last}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- replay

export function ReplayBug(props: { title: string; angle: number; angles: number }): JSX.Element {
  return (
    <div className="bo-replay bo-glass" role="status" aria-label="Replay">
      <span className="bo-replay__tag">REPLAY</span>
      <span className="bo-replay__info">
        <span className="bo-replay__title">{props.title}</span>
        <span className="bo-replay__angle">ANGLE {props.angle} OF {props.angles}</span>
      </span>
    </div>
  );
}

/** The stinger that covers the cut into and out of a replay. */
export function ReplayWipe(): JSX.Element {
  return (
    <div className="bo-wipe" aria-hidden="true">
      <b>BOUT <span>LAB</span></b>
    </div>
  );
}

// ---------------------------------------------------------------- result

export function FinishCard(props: { bout: BroadcastBout; model: FinishModel }): JSX.Element {
  const w = props.model.winner !== null ? props.bout.fighters[props.model.winner] : null;
  return (
    <section className="bo-result bo-glass" style={cv(w?.colour ?? 'var(--brand)')} aria-label="Result">
      <span className="bo-result__corner" />
      <div className="bo-result__who">
        <div className="bo-result__label">{w ? 'WINNER' : 'RESULT'}</div>
        {w ? (
          <>
            <div className="bo-result__first">{w.first || ' '}</div>
            <div className="bo-result__last">{w.last}</div>
          </>
        ) : <div className="bo-result__last">NO WINNER</div>}
      </div>
      <div className="bo-result__how">
        <span className="bo-result__method">{props.model.method}</span>
        <span className="bo-result__when">ROUND {props.model.round} · {props.model.time}</span>
        {props.model.detail ? <span className="bo-result__detail">{props.model.detail}</span> : null}
      </div>
    </section>
  );
}

export function ScorecardReveal(props: { bout: BroadcastBout; model: ScorecardsModel }): JSX.Element {
  const [a, b] = props.bout.fighters;
  const w = props.model.winner !== null ? props.bout.fighters[props.model.winner] : null;
  return (
    <section className="bo-cards bo-glass" aria-label="Official scorecards">
      <header className="bo-cards__head">
        <span className="bo-cards__title">OFFICIAL SCORECARDS</span>
        <span className="bo-tape__event">{props.bout.eventTitle}</span>
      </header>
      <div className="bo-cards__names">
        <span style={cv(a?.colour ?? '#fff')}><span className="bo-tick" />{a?.last}</span>
        <span />
        <span style={cv(b?.colour ?? '#fff')}>{b?.last}<span className="bo-tick" style={{ marginLeft: 'calc(var(--u) * 10)', marginRight: 0 }} /></span>
      </div>
      {props.model.judges.map((j, i) => (
        <div key={j.name} className="bo-cards__row" style={{ animationDelay: `${300 + i * 420}ms` }}>
          <b data-win={j.totals[0] > j.totals[1]}>{j.totals[0]}</b>
          <span>{j.name}</span>
          <b data-win={j.totals[1] > j.totals[0]}>{j.totals[1]}</b>
        </div>
      ))}
      <footer className="bo-cards__verdict">
        <b>{props.model.verdict}</b>
        {w ? <span style={cv(w.colour)}><span className="bo-tick" />{w.first} {w.last}</span> : null}
      </footer>
    </section>
  );
}

// ------------------------------------------------------------- shot label

export function ShotLabel(props: { name: string }): JSX.Element {
  return <div className="bo-shot bo-glass">{props.name}</div>;
}
