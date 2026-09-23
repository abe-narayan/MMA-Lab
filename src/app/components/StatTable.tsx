/**
 * STAT TABLE — the UFCStats-compatible tallies of 09 §4.1, per round or for
 * the bout, straight out of `computeStats`.
 */
import type { StatRow } from '../replay/viewModel';
import type { Corner } from '../replay/viewModel';

export interface StatTableProps {
  title: string;
  rows: readonly StatRow[];
  names: readonly string[];
  corners: readonly Corner[];
  /** Round selector; omitted for the bout total. */
  rounds?: readonly number[];
  selectedRound?: number;
  onSelectRound?(round: number): void;
}

function leader(row: StatRow): number {
  const nums = row.values.map((v) => parseFloat(v) || 0);
  let best = 0;
  for (let i = 1; i < nums.length; i++) {
    if (row.higherIsBetter ? nums[i] > nums[best] : nums[i] < nums[best]) best = i;
  }
  return nums.every((n) => n === nums[0]) ? -1 : best;
}

export function StatTable(props: StatTableProps): JSX.Element {
  return (
    <section className="panel watch-stats" aria-label={props.title}>
      <div className="panel-head">
        <span className="panel-title">{props.title}</span>
        {props.rounds && props.rounds.length > 0 ? (
          <span className="seg" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn"
              aria-pressed={props.selectedRound === 0}
              onClick={() => props.onSelectRound?.(0)}
            >
              Bout
            </button>
            {props.rounds.map((r) => (
              <button
                key={r}
                type="button"
                className="btn"
                aria-pressed={props.selectedRound === r}
                onClick={() => props.onSelectRound?.(r)}
              >
                R{r}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {props.rows.length === 0 ? (
        <p className="empty">No statistics for this round yet.</p>
      ) : (
        <table className="watch-stat-table">
          <thead>
            <tr>
              <th scope="col">Statistic</th>
              {props.names.map((n, i) => (
                <th key={n + i} scope="col">
                  <span className="watch-dot" data-actor={props.corners[i]} aria-hidden="true" />
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => {
              const lead = leader(row);
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className="num" data-lead={i === lead ? 'true' : 'false'}>{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
