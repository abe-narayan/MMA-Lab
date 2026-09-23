/**
 * GAME-PLAN PANEL (docs/design/09 §4.4, 07 §2.6.7).
 *
 * The "visible game plan": for each fighter, the mode he is fighting in right
 * now, the plan lines his corner would say, the adjustments currently active
 * with what triggered each, his belief about the scorecards and whether he is
 * in an emergency state.
 *
 * Every value comes straight from `Sim.intents()` by way of `gamePlanRows`;
 * nothing on this panel is re-derived from the fight, which is what makes it a
 * window into the AI rather than a second opinion about it.
 */
import type { GamePlanRow } from '../replay/viewModel';

function beliefBar(belief: number): JSX.Element {
  const p = Math.round(Math.max(0, Math.min(1, belief)) * 100);
  return (
    <div className="watch-belief" aria-hidden="true">
      <i style={{ width: `${p}%` }} />
    </div>
  );
}

export function GamePlanPanel(props: {
  rows: readonly GamePlanRow[];
  /** The true margin, shown next to the belief when scoring is open (09 §4.4). */
  trueCards?: number[][] | null;
  showTierRules?: boolean;
}): JSX.Element {
  if (props.rows.length === 0) {
    return (
      <section className="panel watch-plan" aria-label="Game plan">
        <div className="panel-head"><span className="panel-title">Game plan</span></div>
        <p className="empty">No plan recorded for this tick.</p>
      </section>
    );
  }
  return (
    <section className="panel watch-plan" aria-label="Game plan">
      <div className="panel-head">
        <span className="panel-title">Game plan</span>
        <span className="frame-read" style={{ marginLeft: 'auto' }}>from Sim.intents()</span>
      </div>
      <div className="watch-plan-grid">
        {props.rows.map((r) => (
          <article key={r.fighterId} className="watch-plan-card" data-corner={r.corner}>
            <header>
              <span className="watch-dot" data-actor={r.corner} aria-hidden="true" />
              <b>{r.name}</b>
              {r.emergency ? <span className="badge badge--bad">emergency</span> : null}
            </header>

            <p className="watch-plan-mode">
              <span className="chip"><b>mode</b><span>{r.modeLabel}</span></span>
              <span className="chip"><b>wants it</b><span>{r.phase}</span></span>
            </p>
            <p className="watch-plan-line">&ldquo;{r.modeLine}&rdquo;</p>

            {r.planLines.length > 0 ? (
              <ul className="watch-plan-lines">
                {r.planLines.map((line, i) => <li key={`${line}-${i}`}>{line}</li>)}
              </ul>
            ) : (
              <p className="muted small">No written plan — style weights only.</p>
            )}

            <div className="watch-plan-section">
              <h4>Active adjustments</h4>
              {r.adjustments.length === 0 ? (
                <p className="muted small">None; he is still on the original plan.</p>
              ) : (
                <ul className="watch-adjust">
                  {r.adjustments.map((a) => (
                    <li key={`${a.id}-${a.sinceRound}`}>
                      <code>{a.id}</code>
                      <span className="muted"> &larr; {a.trigger} (R{a.sinceRound})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="watch-plan-section">
              <h4>Score belief</h4>
              {beliefBar(r.scoreBelief)}
              <p className="small">
                {r.scoreBeliefLabel} <span className="num muted">({r.scoreBelief.toFixed(2)})</span>
                {props.trueCards ? (
                  <span className="muted"> &middot; true cards {props.trueCards
                    .map((rounds) => rounds.reduce((a, b) => a + b, 0))
                    .join(' / ')}</span>
                ) : null}
              </p>
            </div>

            {props.showTierRules && r.tierRules.length > 0 ? (
              <div className="watch-plan-section">
                <h4>Tier rules firing</h4>
                <p className="watch-rules">
                  {r.tierRules.map((id) => <code key={id}>{id}</code>)}
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
