/**
 * LIVE DERIVED PANEL — what the sim will actually make of this fighter.
 *
 * This is the creator's honesty surface. The user authors stored numbers; the
 * bout runs on derived ones, and between them sit the age curves, the career
 * penalties, the cross-discipline transfer matrix and the tier gates. Any of
 * those can make a slider do something surprising, so the panel shows the
 * outcome *and* prints `deriveRuntime`'s own `derivation` lines verbatim —
 * the same arithmetic the legacy Model tab has shown since the v3 engine.
 *
 * Verbatim matters. A paraphrase would be a second implementation of the
 * formula, free to drift; the point is that a reviewer can check a number
 * without reading the code.
 */

import { useState } from 'react';
import type { FighterRuntime } from '../../sim';
import { derivedGroups, disciplineTierRows, subSkillDeltas } from '../model/derivedModel';
import { TierBadge } from './TierBadge';

export interface DerivedPanelProps {
  runtime: FighterRuntime | null;
  /** Why the derivation failed, when it did. */
  error: string | null;
}

export function DerivedPanel({ runtime, error }: DerivedPanelProps): JSX.Element {
  const [showDerivation, setShowDerivation] = useState(false);
  const [openDiscipline, setOpenDiscipline] = useState<string | null>(null);

  if (runtime === null) {
    return (
      <div className="derived derived--broken">
        <div className="panel-head">
          <span className="panel-title">Derived</span>
          <span className="badge badge--bad">will not derive</span>
        </div>
        <p className="fc-note">
          The definition cannot be turned into a runtime yet, so there is nothing honest to show.
          Your edits are safe &mdash; fix the errors listed beside the form and the panel comes back.
        </p>
        {error ? <pre className="derived-error mono">{error}</pre> : null}
      </div>
    );
  }

  const tiers = disciplineTierRows(runtime);
  const groups = derivedGroups(runtime);

  return (
    <div className="derived">
      <div className="panel-head">
        <span className="panel-title">Derived</span>
        <span className="badge badge--ok">live</span>
        <span className="derived-sub mono">
          {runtime.name} &middot; {runtime.derivation.length} derivation lines
        </span>
      </div>

      <section className="derived-section">
        <h4 className="derived-h">Discipline tiers</h4>
        <ul className="derived-tiers">
          {tiers.map((d) => {
            const open = openDiscipline === d.id;
            const transfer = d.mean - d.nativeMean;
            return (
              <li key={d.id} className={`derived-tier${d.trained ? '' : ' is-untrained'}`}>
                <button
                  type="button"
                  className="derived-tier-btn"
                  aria-expanded={open}
                  onClick={() => setOpenDiscipline(open ? null : d.id)}
                >
                  <TierBadge tier={d.tier} muted={!d.trained} />
                  <span className="derived-tier-name">{d.label}</span>
                  <span className="derived-tier-meta mono">
                    mean {d.mean.toFixed(1)}
                    {Math.abs(transfer) >= 0.05 ? (
                      <em className={transfer > 0 ? 'is-up' : 'is-down'}>
                        {transfer > 0 ? '+' : ''}{transfer.toFixed(1)} transfer
                      </em>
                    ) : null}
                    {' · '}
                    {d.yearsTrained.toFixed(1)}yr
                    {d.effectiveYears > d.yearsTrained
                      ? ` (${d.effectiveYears.toFixed(1)} eff.)`
                      : ''}
                  </span>
                </button>

                {open ? (
                  <table className="derived-subskills">
                    <caption className="visually-hidden">
                      {d.label} sub-skills: stored value, effective value after cross-discipline
                      transfer, and the difference.
                    </caption>
                    <thead>
                      <tr><th scope="col">Skill</th><th scope="col">Stored</th><th scope="col">Effective</th><th scope="col">&Delta;</th></tr>
                    </thead>
                    <tbody>
                      {subSkillDeltas(runtime, d.id).map((s) => (
                        <tr key={s.skill}>
                          <th scope="row">{s.label}</th>
                          <td className="num">{s.native.toFixed(0)}</td>
                          <td className="num">{s.effective.toFixed(1)}</td>
                          <td className={`num ${s.delta > 0.05 ? 'is-up' : s.delta < -0.05 ? 'is-down' : ''}`}>
                            {Math.abs(s.delta) < 0.05 ? '—' : `${s.delta > 0 ? '+' : ''}${s.delta.toFixed(1)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {groups.map((g) => (
        <section className="derived-section" key={g.id}>
          <h4 className="derived-h">{g.title}</h4>
          <dl className="derived-rows">
            {g.rows.map((r) => (
              <div className="derived-row" key={r.label}>
                <dt>{r.label}</dt>
                <dd className="num">{r.value}</dd>
                {r.note ? <p className="derived-note">{r.note}</p> : null}
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="derived-section">
        <h4 className="derived-h">
          <button
            type="button"
            className="derived-toggle"
            aria-expanded={showDerivation}
            onClick={() => setShowDerivation((v) => !v)}
          >
            {showDerivation ? '▾' : '▸'} Derivation, verbatim ({runtime.derivation.length} lines)
          </button>
        </h4>
        {showDerivation ? (
          <>
            <p className="fc-note">
              Emitted by <code>deriveRuntime</code> in evaluation order and printed unchanged.
              Every number above is one of these lines.
            </p>
            <ol className="derivation-lines mono">
              {runtime.derivation.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </>
        ) : null}
      </section>
    </div>
  );
}
