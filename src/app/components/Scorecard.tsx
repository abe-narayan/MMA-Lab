/**
 * SCORECARD (09 §4.2).
 *
 * Per judge, per round, plus totals. When the ruleset hides the cards the
 * panel says so rather than showing numbers the audience is not meant to have
 * — the game-plan panel's "score belief" is the interesting number until then.
 */
import type { BoutResult } from '../../sim';
import type { Corner, ScorecardModel } from '../replay/viewModel';

export function Scorecard(props: {
  model: ScorecardModel;
  names: readonly string[];
  corners: readonly Corner[];
  result: BoutResult | null;
  /** Hide the numbers until the bout has ended, as a live broadcast would. */
  reveal: boolean;
}): JSX.Element {
  const { model, names, corners } = props;
  const blind = model.hidden && !props.reveal;

  return (
    <section className="panel watch-cards" aria-label="Scorecards">
      <div className="panel-head">
        <span className="panel-title">Scorecards</span>
        {props.result ? (
          <span className="frame-read" style={{ marginLeft: 'auto' }}>{props.result.method}</span>
        ) : null}
      </div>

      {blind ? (
        <p className="empty">Cards hidden until the decision (judging mode: hidden).</p>
      ) : model.judges.length === 0 ? (
        <p className="empty">No rounds scored yet.</p>
      ) : (
        <table className="watch-stat-table">
          <thead>
            <tr>
              <th scope="col">Judge</th>
              {model.rounds.map((r) => <th key={r} scope="col">R{r}</th>)}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {model.judges.map((j) => (
              <tr key={j.name}>
                <th scope="row">{j.name}</th>
                {j.rounds.map((card, i) => (
                  <td key={i} className="num">{card.join('-')}</td>
                ))}
                <td className="num" data-lead="true">{j.totals.join('-')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="watch-cards-key">
        {names.map((n, i) => (
          <span key={n + i} className="chip">
            <span className="watch-dot" data-actor={corners[i]} aria-hidden="true" />
            <span>{n}</span>
          </span>
        ))}
      </p>
    </section>
  );
}
