/**
 * DEBUG OVERLAY — the spectator's view of the machine.
 *
 * State-graph position and role, the action the scheduler is running, the
 * defence held, the chapter-01 tier rows currently firing, the AI's decision
 * state (mode, active adjustments, score belief) and the stamina and regional
 * damage pools.
 *
 * `FighterIntent` exposes the *outcome* of the utility pass rather than the
 * per-action scores, so this panel labels what it shows for what it is instead
 * of implying it has the softmax table.
 */
import type { DebugFighterRow } from '../replay/viewModel';

function bar(value: number, warn = false): JSX.Element {
  return (
    <div className="meter meter--damage" data-low={warn ? 'true' : 'false'} aria-hidden="true">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function DebugOverlay(props: {
  rows: readonly DebugFighterRow[];
  tick: number;
  digest: string;
  rngDraws: number;
}): JSX.Element {
  return (
    <section className="panel watch-debug" aria-label="Debug overlay">
      <div className="panel-head">
        <span className="panel-title">Debug</span>
        <span className="frame-read" style={{ marginLeft: 'auto' }}>
          tick <b>{props.tick}</b> &middot; draws <b>{props.rngDraws}</b>
        </span>
      </div>
      <p className="watch-debug-digest num">digest {props.digest.slice(0, 16)}…</p>
      <div className="watch-debug-grid">
        {props.rows.map((r) => (
          <article key={r.id} className="watch-debug-card">
            <header><b>{r.name}</b> <span className="muted">#{r.id}</span></header>

            <h4>State graph</h4>
            <p className="watch-kv">
              <span className="chip"><b>node</b><span>{r.node}</span></span>
              <span className="chip"><b>role</b><span>{r.role}</span></span>
              <span className="chip"><b>posture</b><span>{r.posture}</span></span>
              <span className="chip"><b>balance</b><span className="num">{r.balance.toFixed(2)}</span></span>
            </p>

            <h4>Action</h4>
            <p className="watch-kv">
              <span className="chip"><b>action</b><span>{r.action}</span></span>
              <span className="chip"><b>stage</b><span>{r.actionStage}</span></span>
              <span className="chip"><b>phase</b><span className="num">{r.actionPhase.toFixed(2)}</span></span>
              <span className="chip"><b>defence</b><span>{r.defence}</span></span>
            </p>

            <h4>AI decision state</h4>
            <p className="watch-kv">
              <span className="chip"><b>intent</b><span>{r.intentTag}</span></span>
              <span className="chip"><b>mode</b><span>{r.mode}</span></span>
              <span className="chip"><b>belief</b><span className="num">{r.scoreBelief.toFixed(2)}</span></span>
            </p>
            {r.adjustments.length > 0 ? (
              <ul className="watch-adjust">
                {r.adjustments.map((a) => <li key={a}><code>{a}</code></li>)}
              </ul>
            ) : <p className="muted small">no adjustments active</p>}

            <h4>Tier rules firing</h4>
            {r.tierRules.length === 0 ? (
              <p className="muted small">none this decision</p>
            ) : (
              <p className="watch-rules">{r.tierRules.map((id) => <code key={id}>{id}</code>)}</p>
            )}
            {r.animationTags.length > 0 ? (
              <p className="watch-rules">
                {r.animationTags.map((t) => <code key={t} className="watch-anim">{t}</code>)}
              </p>
            ) : null}

            <h4>Condition</h4>
            <div className="watch-debug-meters">
              <span>stamina</span>{bar(r.stamina.total, r.stamina.total < 0.35)}
              <span>burst</span>{bar(r.stamina.burst, r.stamina.burst < 0.2)}
              <span>head</span>{bar(r.damage.head, r.damage.head > 0.7)}
              <span>body</span>{bar(r.damage.body)}
              <span>legs</span>{bar(r.damage.legs)}
              <span>cut</span>{bar(r.damage.cut)}
            </div>
            {r.damageZones.length > 0 ? (
              <p className="watch-zones num">
                zones {r.damageZones.map((z) => z.toFixed(2)).join(' ')}
              </p>
            ) : null}
            {r.states.length > 0 ? (
              <p className="watch-rules">{r.states.map((s) => <code key={s}>{s}</code>)}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
