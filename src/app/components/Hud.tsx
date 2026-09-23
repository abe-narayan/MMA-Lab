/**
 * WATCH HUD — names, records, the round clock, running and per-round stats,
 * and the damage/stamina indicators (09 §4.4, §4.5).
 *
 * Everything here is read from `hudModel`, so the panel is exactly as accurate
 * as the frame on screen: scrub backwards and the numbers go back with it.
 */
import type { HudModel, HudFighterRow } from '../replay/viewModel';

function pct(v: number): string {
  return `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
}

function Meter(props: {
  kind: 'stamina' | 'burst' | 'damage';
  label: string;
  fraction: number;
  read: string;
  warn?: boolean;
}): JSX.Element {
  return (
    <div className="meter-row">
      <span className="meter-name">{props.label}</span>
      <div
        className={`meter meter--${props.kind}`}
        data-low={props.warn ? 'true' : 'false'}
        aria-hidden="true"
      >
        <i style={{ width: pct(props.fraction) }} />
      </div>
      <span className="meter-value">{props.read}</span>
    </div>
  );
}

function FighterCard(props: { row: HudFighterRow }): JSX.Element {
  const f = props.row;
  return (
    <article className="watch-hud-card" data-corner={f.corner} data-down={f.down ? 'true' : 'false'}>
      <header className="watch-hud-name">
        <span className="watch-dot" data-actor={f.corner} aria-hidden="true" />
        <span className="watch-hud-title">{f.name}</span>
        <span className="watch-hud-record num">{f.record}</span>
      </header>
      <p className="watch-hud-sub">
        <span className="chip"><b>tier</b><span>{f.tier}</span></span>
        <span className="chip"><b>state</b><span>{f.posture}</span></span>
        <span className="chip"><b>node</b><span>{f.position}</span></span>
        <span className="chip"><b>intent</b><span>{f.intentTag}</span></span>
      </p>

      <Meter
        kind="stamina"
        label="Gas tank"
        fraction={f.stamina}
        read={pct(f.stamina)}
        warn={f.stamina < 0.35}
      />
      <Meter kind="burst" label="Burst" fraction={f.burst} read={pct(f.burst)} warn={f.burst < 0.2} />
      <Meter
        kind="damage"
        label="Head"
        fraction={f.damage.head}
        read={pct(f.damage.head)}
        warn={f.damage.head > 0.7}
      />
      <Meter kind="damage" label="Body" fraction={f.damage.body} read={pct(f.damage.body)} />
      <Meter kind="damage" label="Legs" fraction={f.damage.legs} read={pct(f.damage.legs)} />

      <dl className="watch-hud-stats">
        <div>
          <dt>Sig. (bout)</dt>
          <dd className="num">{f.sig.landed}/{f.sig.attempted}</dd>
        </div>
        <div>
          <dt>Sig. (round)</dt>
          <dd className="num">{f.roundSig.landed}/{f.roundSig.attempted}</dd>
        </div>
      </dl>

      {f.states.length > 0 ? (
        <p className="watch-states">
          {f.states.slice(0, 6).map((s) => (
            <span key={s} className="badge badge--bad">{s.replace(/^state\./, '')}</span>
          ))}
        </p>
      ) : null}
    </article>
  );
}

export function Hud(props: { model: HudModel | null; loading?: boolean }): JSX.Element {
  const m = props.model;
  if (!m) {
    return (
      <section className="panel watch-hud" aria-label="Live bout state">
        <div className="panel-head"><span className="panel-title">Live state</span></div>
        <p className="empty">{props.loading ? 'Rebuilding the bout from its seed…' : 'No bout loaded.'}</p>
      </section>
    );
  }
  return (
    <section className="panel watch-hud" aria-label="Live bout state">
      <div className="hud-clock">
        <div>
          <span className="clock-label">Round</span>
          <span className="clock-value">
            {m.round}
            <small> / {m.rounds}</small>
          </span>
        </div>
        <div>
          <span className="clock-label">Clock</span>
          <span className="clock-value num">{m.clock}</span>
        </div>
        <div>
          <span className="clock-label">Phase</span>
          <span className="clock-value">{m.phase}</span>
        </div>
        <div>
          <span className="clock-label">Referee</span>
          <span className="clock-value">
            {m.referee.state}
            {m.referee.count !== undefined ? <small> {m.referee.count}</small> : null}
          </span>
        </div>
      </div>

      <div className="watch-hud-grid">
        {m.fighters.map((f) => <FighterCard key={f.id} row={f} />)}
      </div>

      {m.cards ? (
        <p className="watch-hud-cards">
          Open scoring:{' '}
          {m.cards.map((rounds, j) => (
            <span key={j} className="chip"><b>J{j + 1}</b><span className="num">{rounds.join(' ')}</span></span>
          ))}
        </p>
      ) : (
        <p className="watch-hud-cards muted">Cards hidden until the decision.</p>
      )}
    </section>
  );
}
