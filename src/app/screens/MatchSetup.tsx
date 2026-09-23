/**
 * MATCH SETUP — docs/design/09 §3.1–§3.4.
 *
 * Build a bout: a mode, the fighters on each side, a ruleset, an arena, the
 * match settings, and the seed that makes the whole thing reproducible.
 *
 * Three principles the layout follows.
 *
 * **Nothing is blocked that is merely unusual.** A non-standard ruleset ×
 * arena pairing warns and runs (09 §3.3 says "allowed with a UI warning"). An
 * openweight bout between 60 kg and 120 kg warns and runs. The only disabled
 * Run button is one with an empty slot, a missing fighter or an empty seed —
 * the cases where there is literally no `SimConfig` to build.
 *
 * **Every setting says what it does, and where realism and playability pull
 * against each other, which way the default goes and what it costs.** The
 * damage-realism table is the clearest case: `arcade` invalidates the
 * calibration targets, and the screen says so beside the control rather than
 * in a manual nobody opens.
 *
 * **The seed is visible.** A bout is a pure function of it. If it is not on
 * screen and copyable, the determinism guarantee is a claim rather than a
 * feature.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ARENAS, type ArenaId, type FighterDefinition, type MatchMode, type MatchSettings,
  type RulesetId, type WeightClassId,
} from '../../sim';
import type { FighterRecord } from '../store/types';
import type { FighterStoreApi } from '../storeApi';
import type { MatchStoreApi } from '../run/matchStore';
import { historyEntryFor, runBout, type BoutProgress, type BoutRunOutcome } from '../run/runBout';
import {
  ARENA_IDS, CROWD_MAX_ATTACKERS, CROWD_MIN_ATTACKERS, DAMAGE_REALISM, FFA_MAX, FFA_MIN,
  JUDGE_CULTURES, JUDGING_MODES, MATCH_MODES, MISMATCH_MODES, REFEREE_STRICTNESS, RULESET_IDS,
  RULESET_LABELS, SETTING_HELP, SPEEDS, TEAM_PRESET_IDS, WEIGH_INS, WEIGHT_CLASSES,
  buildSimConfig, mismatchWarnings, newSeed, pairingWarning, resizeSlots, rulesetClock, slotPlan,
  type MatchDraft, type MatchWarning, type TeamPresetId,
} from '../model/matchModel';

export interface MatchSetupProps {
  store: FighterStoreApi;
  matchStore: MatchStoreApi;
  /** Bumped by the shell when the fighter database changes. */
  revision: number;
  draft: MatchDraft;
  onDraftChange: (next: MatchDraft) => void;
  /** Called with the finished bout so the shell can open the result screen. */
  onRan: (outcome: BoutRunOutcome) => void;
}

interface RunState {
  status: 'idle' | 'running' | 'failed';
  progress?: BoutProgress;
  message?: string;
  cancel?: () => void;
}

export function MatchSetup({
  store, matchStore, revision, draft, onDraftChange, onRan,
}: MatchSetupProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [allClasses, setAllClasses] = useState(false);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [message, setMessage] = useState<string | null>(null);

  const records = useMemo<FighterRecord[]>(() => {
    try {
      return store.list();
    } catch {
      return [];
    }
  }, [store, revision]);

  const byId = useMemo(() => {
    const m = new Map<string, FighterRecord>();
    for (const r of records) m.set(r.definition.id, r);
    return m;
  }, [records]);

  const lookup = useCallback(
    (id: string): FighterDefinition | undefined => byId.get(id)?.definition,
    [byId],
  );

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q === ''
      ? records
      : records.filter((r) => `${r.summary.name} ${r.summary.short} ${r.tags.join(' ')}`
        .toLowerCase().includes(q));
    return [...list].sort((a, b) => a.summary.name.localeCompare(b.summary.name));
  }, [records, search]);

  const plan = useMemo(() => slotPlan(draft), [draft]);
  const build = useMemo(() => buildSimConfig(draft, lookup), [draft, lookup]);

  const chosen = useMemo(
    () => draft.slots
      .map((id) => (id ? lookup(id) : undefined))
      .filter((d): d is FighterDefinition => Boolean(d)),
    [draft.slots, lookup],
  );

  const warnings = useMemo<MatchWarning[]>(() => {
    const out: MatchWarning[] = [];
    const pair = pairingWarning(draft.ruleset, draft.arena);
    if (pair) out.push({ level: 'warning', text: pair });
    out.push(...mismatchWarnings(
      chosen,
      draft.settings,
      (def) => byId.get(def.id)?.summary.overallTier ?? 0,
    ));
    const realism = DAMAGE_REALISM.find((d) => d.id === draft.settings.damageRealism);
    if (realism && !realism.calibrated) {
      out.push({ level: 'note', text: `Damage realism "${realism.label}": ${realism.tradeoff}` });
    }
    return out;
  }, [draft.ruleset, draft.arena, draft.settings, chosen, byId]);

  // ---- draft edits -------------------------------------------------------

  const patch = useCallback((p: Partial<MatchDraft>) => {
    onDraftChange(resizeSlots({ ...draft, ...p }));
  }, [draft, onDraftChange]);

  const patchSettings = useCallback((p: Partial<MatchSettings>) => {
    onDraftChange({ ...draft, settings: { ...draft.settings, ...p } });
  }, [draft, onDraftChange]);

  const setSlot = useCallback((index: number, id: string) => {
    const slots = [...draft.slots];
    slots[index] = id === '' ? null : id;
    onDraftChange({ ...draft, slots });
  }, [draft, onDraftChange]);

  const rollSeed = useCallback(() => {
    patch({ seed: newSeed('bout', Date.now()) });
  }, [patch]);

  const copySeed = useCallback(() => {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } })
      .navigator?.clipboard;
    if (!clip) {
      setMessage('This browser will not let the page write to the clipboard. The seed is in the field above — select it and copy.');
      return;
    }
    void clip.writeText(draft.seed).then(
      () => setMessage('Seed copied.'),
      () => setMessage('The clipboard refused. Select the seed field and copy it by hand.'),
    );
  }, [draft.seed]);

  // ---- running -----------------------------------------------------------

  const start = useCallback(() => {
    const config = build.config;
    if (!config) return;
    setMessage(null);
    const handle = runBout(config, {
      record: true,
      onProgress: (p) => setRun((s) => (s.status === 'running' ? { ...s, progress: p } : s)),
    });
    setRun({ status: 'running', cancel: handle.cancel });
    handle.promise.then(
      (outcome) => {
        setRun({ status: 'idle' });
        const written = matchStore.putHistory(historyEntryFor(outcome.run));
        if (!written.ok) {
          setMessage('The bout ran, but saving it to history failed — it is still watchable now, '
            + 'and it is reproducible from its seed either way.');
        }
        onRan(outcome);
      },
      (err: unknown) => {
        const text = err instanceof Error ? err.message : String(err);
        if (text.includes('cancelled')) setRun({ status: 'idle' });
        else setRun({ status: 'failed', message: text });
      },
    );
  }, [build.config, matchStore, onRan]);

  const clock = rulesetClock(draft.ruleset);
  const isStreet = draft.ruleset === 'street';
  const classes = allClasses ? WEIGHT_CLASSES : WEIGHT_CLASSES.filter((c) => c.common);

  return (
    <div className="ms">
      <header className="ms-head">
        <div>
          <h2 className="fc-h">Match setup</h2>
          <p className="fc-blurb">
            A bout is a pure function of the seed and everything on this page. Two runs of the same
            setup are the same fight, on any machine — which is why the seed is a field and not a
            hidden detail.
          </p>
        </div>
        <div className="fdb-actions">
          <button
            type="button"
            className="btn btn--play"
            onClick={start}
            disabled={build.problems.length > 0 || run.status === 'running'}
          >
            {run.status === 'running' ? 'Running…' : 'Run bout'}
          </button>
          {run.status === 'running' && run.cancel ? (
            <button type="button" className="btn" onClick={run.cancel}>Cancel</button>
          ) : null}
        </div>
      </header>

      {run.status === 'running' ? (
        <p className="ms-progress mono" role="status">
          Simulating in a background worker so the page stays live
          {run.progress ? ` — round ${run.progress.round}, tick ${run.progress.tick.toLocaleString()}` : '…'}
        </p>
      ) : null}
      {run.status === 'failed' ? (
        <p className="ms-warn ms-warn--error" role="alert">The bout failed: {run.message}</p>
      ) : null}
      {message ? <p className="creator-message" role="status">{message}</p> : null}

      {/* ---- mode ---------------------------------------------------- */}
      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Mode</h3>
        <div className="ms-modes">
          {MATCH_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className="ms-mode"
              aria-pressed={draft.mode === m.id}
              onClick={() => patch({ mode: m.id as MatchMode })}
            >
              <span className="ms-mode-name">{m.label}</span>
              <span className="ms-mode-help">{m.help}</span>
            </button>
          ))}
        </div>

        {draft.mode === 'teams' ? (
          <div className="fc-field fc-field--narrow">
            <label htmlFor="ms-preset">Team preset</label>
            <select
              id="ms-preset"
              className="field"
              value={draft.teamPreset}
              onChange={(e) => patch({ teamPreset: e.target.value as TeamPresetId })}
            >
              {TEAM_PRESET_IDS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <p className="fc-help">
              Sides need not be equal. In 1v3 and 1v5 the lone fighter is on team A; the
              multi-opponent manager limits how many attackers can engage at once.
            </p>
          </div>
        ) : null}

        {draft.mode === 'ffa' ? (
          <div className="fc-field fc-field--narrow">
            <label htmlFor="ms-ffa">Fighters</label>
            <input
              id="ms-ffa"
              className="field"
              type="number"
              min={FFA_MIN}
              max={FFA_MAX}
              value={draft.ffaCount}
              onChange={(e) => patch({ ffaCount: Number(e.target.value) })}
            />
            <p className="fc-help">Two to six, every one on their own team. Last one standing wins.</p>
          </div>
        ) : null}

        {draft.mode === 'crowd' ? (
          <div className="fc-field fc-field--narrow">
            <label htmlFor="ms-crowd">Attackers</label>
            <input
              id="ms-crowd"
              className="field"
              type="number"
              min={CROWD_MIN_ATTACKERS}
              max={CROWD_MAX_ATTACKERS}
              value={draft.crowdAttackers}
              onChange={(e) => patch({ crowdAttackers: Number(e.target.value) })}
            />
            <p className="fc-help">
              Two to eight. Crowd mode expects the street ruleset: no rounds, no referee, and the
              hard cap below is the only thing that ends an indecisive fight.
            </p>
          </div>
        ) : null}
      </section>

      {/* ---- fighters ------------------------------------------------- */}
      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Fighters</h3>
        <div className="fc-field fc-field--narrow">
          <label htmlFor="ms-search">Search the database</label>
          <input
            id="ms-search"
            className="field"
            type="search"
            placeholder="name, nickname, tag"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="fc-help">
            Filters the pickers below. {matching.length} of {records.length} fighters match.
          </p>
        </div>

        <div className="ms-slots">
          {plan.map((slot) => {
            const id = draft.slots[slot.index] ?? '';
            const rec = id ? byId.get(id) : undefined;
            // Keep the current pick visible even when the search excludes it,
            // so typing in the box cannot silently unset a slot.
            const options = rec && !matching.some((m) => m.definition.id === id)
              ? [rec, ...matching]
              : matching;
            return (
              <div key={slot.index} className={`ms-slot ms-slot--team${slot.team}`}>
                <label htmlFor={`ms-slot-${slot.index}`}>{slot.label}</label>
                <select
                  id={`ms-slot-${slot.index}`}
                  className="field"
                  value={id}
                  onChange={(e) => setSlot(slot.index, e.target.value)}
                >
                  <option value="">— pick a fighter —</option>
                  {options.map((r) => (
                    <option key={r.definition.id} value={r.definition.id}>
                      {r.summary.name} · T{r.summary.overallTier} · {r.summary.weightClass}
                    </option>
                  ))}
                </select>
                {rec ? (
                  <p className="ms-slot-meta mono">
                    {rec.summary.recordLine} · {rec.summary.heightCm} cm · {rec.summary.reachCm} cm reach
                    {' · '}{rec.summary.topDiscipline}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- ruleset and arena ---------------------------------------- */}
      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Ruleset and arena</h3>
        <div className="fc-grid">
          <div className="fc-field">
            <label htmlFor="ms-ruleset">Ruleset</label>
            <select
              id="ms-ruleset"
              className="field"
              value={draft.ruleset}
              onChange={(e) => patch({ ruleset: e.target.value as RulesetId })}
            >
              {RULESET_IDS.map((id) => (
                <option key={id} value={id}>{RULESET_LABELS[id]}</option>
              ))}
            </select>
            <p className="fc-help">
              The ruleset owns what is legal, how rounds work, who scores and when the referee
              steps in. Default rounds: {clock.rounds} × {clock.roundSeconds} s, {clock.restSeconds} s rest.
            </p>
          </div>

          <div className="fc-field">
            <label htmlFor="ms-arena">Arena</label>
            <select
              id="ms-arena"
              className="field"
              value={draft.arena}
              onChange={(e) => patch({ arena: e.target.value as ArenaId })}
            >
              {ARENA_IDS.map((id) => (
                <option key={id} value={id}>{ARENAS[id].name}</option>
              ))}
            </select>
            <p className="fc-help">
              The arena is an input, not scenery: it sets where the wall is, what the wall does to
              a pinned fighter, and how hard the floor is. Concrete multiplies fall impact by 3.
            </p>
          </div>
        </div>
      </section>

      {/* ---- settings -------------------------------------------------- */}
      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Match settings</h3>

        <div className="fc-grid fc-grid--tight">
          <NumberField
            id="ms-rounds" label="Rounds" value={draft.settings.rounds}
            placeholder={String(clock.rounds)} min={1} max={12}
            help={SETTING_HELP.rounds}
            onChange={(v) => patchSettings({ rounds: v })}
          />
          <NumberField
            id="ms-roundlen" label="Round length (s)" value={draft.settings.roundSeconds}
            placeholder={String(clock.roundSeconds)} min={30} max={1800}
            help={SETTING_HELP.roundSeconds}
            onChange={(v) => patchSettings({ roundSeconds: v })}
          />
          <NumberField
            id="ms-rest" label="Rest (s)" value={draft.settings.restSeconds}
            placeholder={String(clock.restSeconds)} min={0} max={300}
            help={SETTING_HELP.restSeconds}
            onChange={(v) => patchSettings({ restSeconds: v })}
          />
          {isStreet || draft.mode === 'crowd' ? (
            <NumberField
              id="ms-maxsec" label="Hard cap (s)" value={draft.settings.maxSeconds}
              placeholder="180" min={10} max={3600}
              help={SETTING_HELP.maxSeconds}
              onChange={(v) => patchSettings({ maxSeconds: v })}
            />
          ) : null}
        </div>

        <div className="fc-grid">
          <div className="fc-field">
            <label htmlFor="ms-class">Weight class</label>
            <select
              id="ms-class"
              className="field"
              value={draft.settings.weightClass}
              onChange={(e) => patchSettings({
                weightClass: e.target.value as WeightClassId | 'openweight' | 'catchweight',
              })}
            >
              <option value="openweight">Openweight (no class)</option>
              <option value="catchweight">Catchweight</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} — {c.limitLb} lb / {c.limitKg.toFixed(1)} kg
                </option>
              ))}
            </select>
            <div className="fc-field fc-field--checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={allClasses}
                  onChange={(e) => setAllClasses(e.target.checked)}
                />
                <span> Show all ABC classes</span>
              </label>
            </div>
            <p className="fc-help">
              The nine classes a promotion actually uses are shown by default; the "super" classes,
              atomweight and cruiserweight are behind the toggle.
            </p>
          </div>

          <ChoiceField
            id="ms-weighin" label="Weigh-in" value={draft.settings.weighIn}
            choices={WEIGH_INS}
            onChange={(v) => patchSettings({ weighIn: v })}
          />
          <ChoiceField
            id="ms-mismatch" label="Mismatch mode" value={draft.settings.mismatchMode}
            choices={MISMATCH_MODES}
            onChange={(v) => patchSettings({ mismatchMode: v })}
          />
          <ChoiceField
            id="ms-ref" label="Referee strictness" value={draft.settings.refereeStrictness}
            choices={REFEREE_STRICTNESS}
            onChange={(v) => patchSettings({ refereeStrictness: v })}
          />
          <ChoiceField
            id="ms-judging" label="Judging mode" value={draft.settings.judgingMode}
            choices={JUDGING_MODES}
            onChange={(v) => patchSettings({ judgingMode: v })}
          />
          <ChoiceField
            id="ms-culture" label="Judge culture" value={draft.settings.judgeCulture}
            choices={JUDGE_CULTURES}
            onChange={(v) => patchSettings({ judgeCulture: v })}
          />
        </div>

        <fieldset className="fc-fieldset">
          <legend>Damage realism</legend>
          <div className="ms-realism">
            {DAMAGE_REALISM.map((row) => (
              <label key={row.id} className={`ms-realism-row${draft.settings.damageRealism === row.id ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="ms-realism"
                  value={row.id}
                  checked={draft.settings.damageRealism === row.id}
                  onChange={() => patchSettings({ damageRealism: row.id })}
                />
                <span className="ms-realism-name">
                  {row.label}
                  {row.calibrated
                    ? <em className="tag">calibrated</em>
                    : <em className="tag tag--alert">not calibrated</em>}
                </span>
                <span className="ms-realism-changes">{row.changes}</span>
                <span className="ms-realism-tradeoff">{row.tradeoff}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="fc-grid">
          <div className="fc-field">
            <label htmlFor="ms-home">Home fighter</label>
            <select
              id="ms-home"
              className="field"
              value={draft.settings.homeFighter === undefined ? '' : String(draft.settings.homeFighter)}
              onChange={(e) => patchSettings({
                homeFighter: e.target.value === '' ? undefined : Number(e.target.value),
              })}
            >
              <option value="">Neutral crowd</option>
              {plan.map((slot) => (
                <option key={slot.index} value={slot.index}>
                  {slot.label}
                  {draft.slots[slot.index] ? ` — ${byId.get(draft.slots[slot.index] as string)?.summary.name ?? ''}` : ''}
                </option>
              ))}
            </select>
            <p className="fc-help">{SETTING_HELP.homeFighter}</p>
          </div>

          <div className="fc-field">
            <label htmlFor="ms-speed">Playback speed</label>
            <select
              id="ms-speed"
              className="field"
              value={String(draft.settings.speed)}
              onChange={(e) => patchSettings({ speed: Number(e.target.value) as MatchSettings['speed'] })}
            >
              {SPEEDS.map((s) => <option key={s} value={String(s)}>{s}×</option>)}
            </select>
            <p className="fc-help">{SETTING_HELP.speed}</p>
          </div>

          <div className="fc-field fc-field--checkbox">
            <label>
              <input
                type="checkbox"
                checked={draft.settings.blood}
                onChange={(e) => patchSettings({ blood: e.target.checked })}
              />
              <span>Blood</span>
            </label>
            <p className="fc-help">{SETTING_HELP.blood}</p>
          </div>

          <div className="fc-field fc-field--checkbox">
            <label>
              <input
                type="checkbox"
                checked={draft.settings.commentary}
                onChange={(e) => patchSettings({ commentary: e.target.checked })}
              />
              <span>Commentary</span>
            </label>
            <p className="fc-help">{SETTING_HELP.commentary}</p>
          </div>
        </div>
      </section>

      {/* ---- seed ------------------------------------------------------ */}
      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Seed</h3>
        <div className="fc-input-row">
          <input
            id="ms-seed"
            className="field mono"
            type="text"
            aria-label="Bout seed"
            value={draft.seed}
            onChange={(e) => patch({ seed: e.target.value })}
          />
          <button type="button" className="btn" onClick={rollSeed}>Random seed</button>
          <button type="button" className="btn" onClick={copySeed}>Copy</button>
        </div>
        <p className="fc-help">{SETTING_HELP.seed}</p>
      </section>

      {/* ---- warnings and problems ------------------------------------- */}
      {build.problems.length > 0 ? (
        <ul className="ms-warnlist">
          {build.problems.map((p) => (
            <li key={p} className="ms-warn ms-warn--error">{p}</li>
          ))}
        </ul>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="ms-warnlist">
          {warnings.map((w) => (
            <li key={w.text} className={`ms-warn ms-warn--${w.level}`}>{w.text}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Small shared controls
// --------------------------------------------------------------------------

function NumberField({
  id, label, value, placeholder, min, max, help, onChange,
}: {
  id: string; label: string; value: number | undefined; placeholder: string;
  min: number; max: number; help: string; onChange: (v: number | undefined) => void;
}): JSX.Element {
  return (
    <div className="fc-field fc-field--narrow">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="field"
        type="number"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === '') onChange(undefined);
          else onChange(Math.min(max, Math.max(min, Number(raw))));
        }}
      />
      <p className="fc-help">{help}</p>
    </div>
  );
}

function ChoiceField<T extends string>({
  id, label, value, choices, onChange,
}: {
  id: string; label: string; value: T;
  choices: readonly { id: T; label: string; help: string }[];
  onChange: (v: T) => void;
}): JSX.Element {
  const active = choices.find((c) => c.id === value);
  return (
    <div className="fc-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <p className="fc-help">{active?.help}</p>
    </div>
  );
}
