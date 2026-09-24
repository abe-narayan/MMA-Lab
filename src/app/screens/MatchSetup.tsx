/**
 * MATCH SETUP — docs/design/09 §3.1–§3.4; layout: docs/design/UI_PASS.md
 * ("UI pass 2").
 *
 * Four numbered steps, read top to bottom: **Fighters → Rules → Options →
 * Run**. Everything a first-time user needs is visible (two fighters are
 * already picked, every other setting has its default, so "Run bout" works
 * straight away); everything else sits behind a closed "Advanced" section
 * that says how many of its values differ from the defaults. Help is a
 * one-line hint or an (i) tooltip beside the label, not a paragraph under
 * every field.
 *
 * Principles kept from the first pass:
 *
 * **Nothing is blocked that is merely unusual.** A non-standard ruleset ×
 * arena pairing warns and runs (09 §3.3); an openweight bout between 60 kg
 * and 120 kg warns and runs. Run is disabled only for an empty slot, a
 * missing fighter, the same fighter twice or an empty seed — the cases where
 * there is no `SimConfig` to build — and each of those is shown inline, at
 * the field that causes it.
 *
 * **Realism trade-offs are stated beside the control.** `arcade` and
 * `ironman` invalidate the calibration targets, and the options step says so.
 *
 * **The seed is visible.** A bout is a pure function of it, so it is a field
 * with Copy and New seed, in the Run step.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ARENAS, DEFAULT_SETTINGS, type ArenaId, type FighterDefinition, type MatchMode, type MatchSettings,
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
import { topDisciplineLabel } from '../model/fieldMeta';
import {
  Alert, Button, Disclosure, InfoTip, LabelRow, Segmented, StatusBadge, Step, Switch,
  IconCopy, IconDice, IconPlay, IconX,
} from '../ui';

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

/** One line per mode under the mode switch; the full rule is in the tooltip. */
const MODE_SHORT: Readonly<Record<MatchMode, string>> = {
  '1v1': 'Two fighters, one winner. Finishes follow the ruleset; otherwise the judges decide.',
  teams: 'Two teams. A team loses when its last fighter is stopped.',
  ffa: 'Everyone for themselves. Last one standing wins.',
  crowd: 'One defender against a group, under street rules. The defender wins by stopping everyone or escaping.',
};
const MODE_LABEL: Readonly<Record<MatchMode, string>> = {
  '1v1': 'One on one', teams: 'Teams', ffa: 'Free-for-all', crowd: 'One vs many',
};

const INTRO_KEY = 'bout-lab.intro.v2';

/** Settings behind the "Advanced" disclosures, for the "n changed" notes. */
const TIMING_KEYS = ['rounds', 'roundSeconds', 'restSeconds', 'maxSeconds', 'weighIn', 'mismatchMode'] as const;
const OFFICIAL_KEYS = ['refereeStrictness', 'judgingMode', 'judgeCulture', 'homeFighter'] as const;

function changedCount(settings: MatchSettings, keys: readonly (keyof MatchSettings)[]): number {
  return keys.filter((k) => settings[k] !== undefined && settings[k] !== DEFAULT_SETTINGS[k]).length;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function readIntroDismissed(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function MatchSetup({
  store, matchStore, revision, draft, onDraftChange, onRan,
}: MatchSetupProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [allClasses, setAllClasses] = useState(false);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [message, setMessage] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(() => !readIntroDismissed());

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

  const pairing = pairingWarning(draft.ruleset, draft.arena);
  const realism = DAMAGE_REALISM.find((d) => d.id === draft.settings.damageRealism) ?? DAMAGE_REALISM[0];

  /** Size and level warnings; the pairing and realism notes are shown at their own fields. */
  const warnings = useMemo<MatchWarning[]>(() => mismatchWarnings(
    chosen,
    draft.settings,
    (def) => byId.get(def.id)?.summary.overallTier ?? 0,
  ), [draft.settings, chosen, byId]);

  /** Inline validation, per slot: empty, missing from the database, or a repeat of an earlier slot. */
  const slotErrors = useMemo(() => {
    const out = new Map<number, string>();
    const seen = new Map<string, string>();
    for (const slot of plan) {
      const id = draft.slots[slot.index] ?? null;
      if (!id) {
        out.set(slot.index, 'Pick a fighter.');
        continue;
      }
      if (!byId.has(id)) {
        out.set(slot.index, 'This fighter is no longer in the database. Pick another.');
        continue;
      }
      const first = seen.get(id);
      if (first) {
        out.set(slot.index, `Already fighting as ${first}. Duplicate the fighter in the database to use them twice.`);
        continue;
      }
      seen.set(id, slot.label);
    }
    return out;
  }, [plan, draft.slots, byId]);

  const seedError = draft.seed.trim() === '' ? 'Enter a seed, or press New seed.' : null;
  const ready = build.problems.length === 0;
  const running = run.status === 'running';

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

  const swapCorners = useCallback(() => {
    if (draft.slots.length !== 2) return;
    const [a, b] = draft.slots;
    // Home advantage follows the fighter, not the corner.
    const home = draft.settings.homeFighter;
    onDraftChange({
      ...draft,
      slots: [b, a],
      settings: { ...draft.settings, homeFighter: home === undefined ? undefined : 1 - home },
    });
  }, [draft, onDraftChange]);

  const rollSeed = useCallback(() => {
    patch({ seed: newSeed('bout', Date.now()) });
  }, [patch]);

  const copySeed = useCallback(() => {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } })
      .navigator?.clipboard;
    if (!clip) {
      setMessage('This browser will not let the page write to the clipboard. Select the seed and copy it by hand.');
      return;
    }
    void clip.writeText(draft.seed).then(
      () => setMessage('Seed copied.'),
      () => setMessage('The clipboard refused. Select the seed and copy it by hand.'),
    );
  }, [draft.seed]);

  const dismissIntro = useCallback(() => {
    setIntroOpen(false);
    try { localStorage.setItem(INTRO_KEY, 'dismissed'); } catch { /* not remembered */ }
  }, []);

  // A "Seed copied." note should not linger over the next edit.
  useEffect(() => {
    if (message !== 'Seed copied.') return undefined;
    const h = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(h);
  }, [message]);

  // ---- running -----------------------------------------------------------

  const start = useCallback(() => {
    const config = build.config;
    if (!config) return;
    setMessage(null);
    const handle = runBout(config, {
      record: true,
      onProgress: (p) => setRun((s) => (s.status === 'running' ? { ...s, progress: p } : s)),
    });
    const startedAt = Date.now();
    // A double-click on Run must never cancel: the Cancel control lives in
    // the progress strip, away from Run, and ignores clicks for 700 ms.
    const guardedCancel = (): void => {
      if (Date.now() - startedAt < 700) return;
      handle.cancel();
    };
    setRun({ status: 'running', cancel: guardedCancel });
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
        if (text.includes('cancelled')) {
          setRun({ status: 'idle' });
          setMessage('Cancelled. Nothing was saved; run it again with the same seed for the same fight.');
        }
        else setRun({ status: 'failed', message: text });
      },
    );
  }, [build.config, matchStore, onRan]);

  // ---- derived display values ----------------------------------------------

  const clock = rulesetClock(draft.ruleset);
  const isStreet = draft.ruleset === 'street';
  const hasCap = isStreet || draft.mode === 'crowd';
  const rounds = draft.settings.rounds ?? clock.rounds;
  const roundSeconds = draft.settings.roundSeconds ?? clock.roundSeconds;
  const restSeconds = draft.settings.restSeconds ?? clock.restSeconds;
  const timingLine = hasCap
    ? `No rounds · ends after ${mmss(draft.settings.maxSeconds ?? 180)} at most`
    : `${rounds} × ${mmss(roundSeconds)} · ${mmss(restSeconds)} rest`;
  const classes = allClasses ? WEIGHT_CLASSES : WEIGHT_CLASSES.filter((c) => c.common);
  const timingChanged = changedCount(draft.settings, TIMING_KEYS);
  const officialsChanged = changedCount(draft.settings, OFFICIAL_KEYS);
  const filled = plan.length - slotErrors.size;
  const nameOf = (id: string | null | undefined): string => (id ? byId.get(id)?.summary.name ?? id : '—');
  const matchupLine = plan.length === 2
    ? `${nameOf(draft.slots[0])} vs ${nameOf(draft.slots[1])}`
    : `${plan.length} fighters · ${MODE_LABEL[draft.mode]}`;

  const runButton = (
    <Button
      variant="primary"
      size="lg"
      icon={<IconPlay />}
      onClick={start}
      disabled={!ready || running}
      busy={running}
      title={ready ? 'Simulate this bout' : `Not ready: ${build.problems[0] ?? ''}`}
    >
      {running ? 'Running…' : 'Run bout'}
    </Button>
  );

  return (
    <div className="ms setup">
      <header className="ms-head page-head">
        <div>
          <h1 className="page-title">Match setup</h1>
          <p className="page-sub">
            Simulate one bout, then watch it or read the scorecards. Two fighters are already
            picked and every setting has a default, so you can press Run straight away.
          </p>
        </div>
        <div className="page-actions">{runButton}</div>
      </header>

      {introOpen ? (
        <div className="setup-intro" role="note" aria-label="Getting started">
          <div>
            <b>New to Bout Lab?</b> It simulates combat-sport bouts between fighters you define,
            second by second, and lets you replay them in 3D.
            <ol>
              <li>Press <b>Run bout</b> with the two fighters below, or pick your own.</li>
              <li>Read the result, or open <b>Watch</b> to see the fight.</li>
              <li>Use <b>Batch simulation</b> to see who wins over thousands of bouts, and <b>Fighters</b> to build your own.</li>
            </ol>
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss the introduction" icon={<IconX />} onClick={dismissIntro} />
        </div>
      ) : null}

      {running ? (
        <p className="ms-progress" role="status">
          <span className="ui-spinner" aria-hidden="true" />
          Simulating in the background
          {run.progress ? ` — round ${run.progress.round}, ${Math.floor(run.progress.tick / 10).toLocaleString()} s of fight time` : '…'}
          {run.cancel ? (
            <button type="button" className="btn ms-progress-cancel" onClick={run.cancel}>Cancel</button>
          ) : null}
        </p>
      ) : null}
      {run.status === 'failed' ? (
        <Alert tone="alert">The bout failed: {run.message}</Alert>
      ) : null}
      {message ? <Alert tone="info">{message}</Alert> : null}

      {/* ---- 1 · fighters ------------------------------------------------ */}
      <Step
        n={1}
        title="Fighters"
        sub={MODE_SHORT[draft.mode]}
        status={slotErrors.size === 0 ? `${plan.length} ready` : `${slotErrors.size} to fix`}
        statusTone={slotErrors.size === 0 ? 'ok' : 'warn'}
        actions={plan.length === 2 ? <Button size="sm" variant="ghost" onClick={swapCorners}>Swap corners</Button> : undefined}
      >
        <div className="setup-row">
          <div className="setup-field">
            <LabelRow
              label="Format"
              tip={MATCH_MODES.find((m) => m.id === draft.mode)?.help}
            />
            <Segmented<MatchMode>
              label="Format"
              value={draft.mode}
              onChange={(m) => patch({ mode: m })}
              options={MATCH_MODES.map((m) => ({ value: m.id as MatchMode, label: MODE_LABEL[m.id as MatchMode], title: m.help }))}
            />
          </div>

          {draft.mode === 'teams' ? (
            <div className="setup-field">
              <LabelRow label="Team sizes" tip="Sides need not be equal. In 1v3 and 1v5 the lone fighter is team A; only a few attackers can engage at once." />
              <Segmented<TeamPresetId>
                label="Team sizes"
                value={draft.teamPreset}
                onChange={(v) => patch({ teamPreset: v })}
                options={TEAM_PRESET_IDS.map((p) => ({ value: p, label: p }))}
              />
            </div>
          ) : null}

          {draft.mode === 'ffa' ? (
            <div className="setup-field">
              <LabelRow label="Fighters" tip="Two to six, each on their own team." />
              <Segmented<string>
                label="Number of fighters"
                value={String(draft.ffaCount)}
                onChange={(v) => patch({ ffaCount: Number(v) })}
                options={range(FFA_MIN, FFA_MAX).map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          ) : null}

          {draft.mode === 'crowd' ? (
            <div className="setup-field">
              <LabelRow label="Attackers" tip="Two to eight. Crowd mode expects the street ruleset: no rounds and no referee." />
              <Segmented<string>
                label="Number of attackers"
                value={String(draft.crowdAttackers)}
                onChange={(v) => patch({ crowdAttackers: Number(v) })}
                options={range(CROWD_MIN_ATTACKERS, CROWD_MAX_ATTACKERS).map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          ) : null}

          {records.length > 8 ? (
            <div className="setup-field setup-field--grow">
              <LabelRow htmlFor="ms-search" label="Filter the lists" />
              <input
                id="ms-search"
                className="field"
                type="search"
                placeholder="Name, nickname or tag"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-describedby="ms-search-count"
              />
              <span id="ms-search-count" className="visually-hidden">
                {matching.length} of {records.length} fighters match.
              </span>
            </div>
          ) : null}
        </div>

        {records.length === 0 ? (
          <Alert tone="warn">The fighter database is empty or could not be read. Add or import fighters on the Fighters page.</Alert>
        ) : null}

        <div className={`setup-slots${plan.length === 2 ? ' setup-slots--pair' : ''}`}>
          {plan.map((slot) => {
            const id = draft.slots[slot.index] ?? '';
            const rec = id ? byId.get(id) : undefined;
            const err = slotErrors.get(slot.index) ?? null;
            // Keep the current pick visible even when the filter excludes it,
            // so typing in the filter cannot silently unset a slot.
            const options = rec && !matching.some((m) => m.definition.id === id)
              ? [rec, ...matching]
              : matching;
            const errId = `ms-slot-${slot.index}-err`;
            return (
              <div key={slot.index} className="setup-slot-wrap">
                <div className={`ms-slot ms-slot--team${slot.team}`} data-invalid={err ? true : undefined}>
                  <label htmlFor={`ms-slot-${slot.index}`}>{slot.label}</label>
                  <select
                    id={`ms-slot-${slot.index}`}
                    className="field"
                    value={id}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? errId : undefined}
                    onChange={(e) => setSlot(slot.index, e.target.value)}
                  >
                    <option value="">Pick a fighter…</option>
                    {options.map((r) => (
                      <option key={r.definition.id} value={r.definition.id}>
                        {r.summary.name} · T{r.summary.overallTier} · {r.summary.weightClass}
                      </option>
                    ))}
                  </select>
                  {rec ? (
                    <p className="ms-slot-meta">
                      {topDisciplineLabel(rec.summary.topDiscipline)} · {rec.summary.recordLine} · {rec.summary.heightCm} cm, {rec.summary.reachCm} cm reach
                    </p>
                  ) : null}
                  {err ? <p className="ui-field-error" id={errId}>{err}</p> : null}
                </div>
              </div>
            );
          })}
        </div>
        {filled < plan.length && records.length > 0 ? (
          <p className="ui-field-hint">Tip: fighters can be created and imported on the Fighters page.</p>
        ) : null}
      </Step>

      {/* ---- 2 · rules ----------------------------------------------------- */}
      <Step
        n={2}
        title="Rules"
        sub={`${RULESET_LABELS[draft.ruleset]} · ${ARENAS[draft.arena].name} · ${timingLine}`}
        status={pairing ? 'Non-standard venue' : undefined}
        statusTone="warn"
      >
        <div className="setup-grid">
          <div className="setup-field">
            <LabelRow htmlFor="ms-ruleset" label="Ruleset" tip="What is legal, how rounds work, who scores and when the referee steps in." />
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
          </div>

          <div className="setup-field" data-invalid={pairing ? 'warn' : undefined}>
            <LabelRow htmlFor="ms-arena" label="Arena" tip="The arena is an input, not scenery: it sets where the wall is, what it does to a pinned fighter and how hard the floor is. Concrete triples fall impact." />
            <select
              id="ms-arena"
              className="field"
              value={draft.arena}
              aria-describedby={pairing ? 'ms-arena-warn' : undefined}
              onChange={(e) => patch({ arena: e.target.value as ArenaId })}
            >
              {ARENA_IDS.map((id) => (
                <option key={id} value={id}>{ARENAS[id].name}</option>
              ))}
            </select>
            {pairing ? (
              <p className="setup-warn" id="ms-arena-warn">
                Not where this ruleset is normally held. It will still run.
                <InfoTip text={pairing} label="Why is this venue non-standard?" />
              </p>
            ) : null}
          </div>

          <div className="setup-field">
            <LabelRow htmlFor="ms-class" label="Weight class" tip="Openweight skips the class check. A class checks each fighter's weight against its limit (catchweight allows a 5 lb gap)." />
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
          </div>
        </div>

        <Disclosure
          summary="Round timing and weigh-in"
          summaryNote={timingChanged > 0 ? `${timingChanged} changed` : 'Ruleset defaults'}
        >
          <div className="setup-grid setup-grid--tight">
            {hasCap ? (
              <NumberField
                id="ms-maxsec" label="Time limit (s)" value={draft.settings.maxSeconds}
                placeholder="180" min={10} max={3600}
                tip={SETTING_HELP.maxSeconds}
                onChange={(v) => patchSettings({ maxSeconds: v })}
              />
            ) : (
              <>
                <NumberField
                  id="ms-rounds" label="Rounds" value={draft.settings.rounds}
                  placeholder={String(clock.rounds)} min={1} max={12}
                  tip={`Leave blank for the ruleset's ${clock.rounds}.`}
                  onChange={(v) => patchSettings({ rounds: v })}
                />
                <NumberField
                  id="ms-roundlen" label="Round length (s)" value={draft.settings.roundSeconds}
                  placeholder={String(clock.roundSeconds)} min={30} max={1800}
                  tip={`Leave blank for the ruleset's ${clock.roundSeconds} s.`}
                  onChange={(v) => patchSettings({ roundSeconds: v })}
                />
                <NumberField
                  id="ms-rest" label="Rest (s)" value={draft.settings.restSeconds}
                  placeholder={String(clock.restSeconds)} min={0} max={300}
                  tip={SETTING_HELP.restSeconds}
                  onChange={(v) => patchSettings({ restSeconds: v })}
                />
              </>
            )}
            <ChoiceField
              id="ms-weighin" label="Weigh-in" value={draft.settings.weighIn}
              choices={WEIGH_INS}
              onChange={(v) => patchSettings({ weighIn: v })}
            />
            <ChoiceField
              id="ms-mismatch" label="Size mismatch" value={draft.settings.mismatchMode}
              choices={MISMATCH_MODES}
              onChange={(v) => patchSettings({ mismatchMode: v })}
            />
          </div>
          <Switch
            checked={allClasses}
            onChange={setAllClasses}
            label="List every ABC weight class (adds the super classes, atomweight and cruiserweight)"
          />
        </Disclosure>
      </Step>

      {/* ---- 3 · options ---------------------------------------------------- */}
      <Step
        n={3}
        title="Options"
        sub="How hard the fighters hit, and how the bout is shown."
        status={realism.calibrated ? undefined : 'Not calibrated'}
        statusTone="warn"
      >
        <div className="setup-field">
          <LabelRow label="Damage" tip={realism.tradeoff} />
          <Segmented<MatchSettings['damageRealism']>
            label="Damage realism"
            value={draft.settings.damageRealism}
            onChange={(v) => patchSettings({ damageRealism: v })}
            options={DAMAGE_REALISM.map((r) => ({
              value: r.id,
              label: r.id === 'realism' ? 'Realistic' : r.label,
              title: r.changes,
            }))}
          />
          <p className="ui-field-hint">
            {realism.calibrated
              ? 'Knockouts, stoppages and decisions happen at their real-world rates.'
              : `${realism.changes} Results no longer match the calibration targets.`}
          </p>
        </div>

        <div className="setup-row">
          <div className="setup-field">
            <LabelRow label="Watch at" tip={SETTING_HELP.speed} />
            <Segmented<string>
              label="Playback speed"
              value={String(draft.settings.speed)}
              onChange={(v) => patchSettings({ speed: Number(v) as MatchSettings['speed'] })}
              options={SPEEDS.filter((s) => s <= 4).map((s) => ({ value: String(s), label: `${s}×` }))}
            />
          </div>
          <div className="setup-field setup-switches">
            <span className="setup-switch">
              <Switch checked={draft.settings.commentary} onChange={(v) => patchSettings({ commentary: v })} label="Commentary" />
            </span>
            <span className="setup-switch">
              <Switch checked={draft.settings.blood} onChange={(v) => patchSettings({ blood: v })} label="Blood" />
            </span>
            <span className="ui-field-hint">Display only: neither changes the fight.</span>
          </div>
        </div>

        <Disclosure
          summary="Referee, judges and crowd"
          summaryNote={officialsChanged > 0 ? `${officialsChanged} changed` : 'Defaults'}
        >
          <div className="setup-grid">
            <ChoiceField
              id="ms-ref" label="Referee" value={draft.settings.refereeStrictness}
              choices={REFEREE_STRICTNESS}
              onChange={(v) => patchSettings({ refereeStrictness: v })}
            />
            <ChoiceField
              id="ms-judging" label="Scorecards" value={draft.settings.judgingMode}
              choices={JUDGING_MODES}
              onChange={(v) => patchSettings({ judgingMode: v })}
            />
            <ChoiceField
              id="ms-culture" label="Judging criteria" value={draft.settings.judgeCulture}
              choices={JUDGE_CULTURES}
              onChange={(v) => patchSettings({ judgeCulture: v })}
            />
            <div className="setup-field">
              <LabelRow htmlFor="ms-home" label="Home crowd" tip={SETTING_HELP.homeFighter} />
              <select
                id="ms-home"
                className="field"
                value={draft.settings.homeFighter === undefined ? '' : String(draft.settings.homeFighter)}
                onChange={(e) => patchSettings({
                  homeFighter: e.target.value === '' ? undefined : Number(e.target.value),
                })}
              >
                <option value="">Neutral</option>
                {plan.map((slot) => (
                  <option key={slot.index} value={slot.index}>
                    {slot.label}
                    {draft.slots[slot.index] ? ` — ${nameOf(draft.slots[slot.index])}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Disclosure>
      </Step>

      {/* ---- 4 · run ------------------------------------------------------ */}
      <Step
        n={4}
        title="Run"
        sub={ready ? matchupLine : 'Fix the items above to run.'}
        status={ready ? 'Ready' : `${build.problems.length} to fix`}
        statusTone={ready ? 'ok' : 'alert'}
      >
        <dl className="setup-summary">
          <div><dt>Bout</dt><dd>{matchupLine}</dd></div>
          <div><dt>Rules</dt><dd>{RULESET_LABELS[draft.ruleset]} · {timingLine}</dd></div>
          <div><dt>Arena</dt><dd>{ARENAS[draft.arena].name}</dd></div>
          <div>
            <dt>Damage</dt>
            <dd>
              {realism.id === 'realism' ? 'Realistic' : realism.label}
              {realism.calibrated ? null : <> <StatusBadge tone="warn">not calibrated</StatusBadge></>}
            </dd>
          </div>
        </dl>

        {warnings.length > 0 ? (
          <ul className="ms-warnlist setup-warnings">
            {warnings.map((w) => (
              <li key={w.text} className={`ms-warn ms-warn--${w.level}`}>{w.text}</li>
            ))}
          </ul>
        ) : null}

        <div className="setup-field" data-invalid={seedError ? true : undefined}>
          <LabelRow htmlFor="ms-seed" label="Seed" tip={SETTING_HELP.seed} />
          <div className="setup-seed">
            <input
              id="ms-seed"
              className="field mono"
              type="text"
              value={draft.seed}
              spellCheck={false}
              aria-invalid={seedError ? true : undefined}
              aria-describedby={seedError ? 'ms-seed-err' : 'ms-seed-hint'}
              onChange={(e) => patch({ seed: e.target.value })}
            />
            <Button icon={<IconDice />} onClick={rollSeed}>New seed</Button>
            <Button icon={<IconCopy />} onClick={copySeed}>Copy</Button>
          </div>
          {seedError
            ? <p className="ui-field-error" id="ms-seed-err">{seedError}</p>
            : <p className="ui-field-hint" id="ms-seed-hint">The same seed and settings always give the same fight.</p>}
        </div>

        {!ready ? (
          <ul className="setup-problems" aria-label="Before you can run">
            {build.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}

        <div className="setup-run">{runButton}</div>
      </Step>
    </div>
  );
}

// --------------------------------------------------------------------------
// Small shared controls
// --------------------------------------------------------------------------

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/**
 * A number box whose blank means "use the ruleset". Out-of-range input is
 * kept as typed and flagged inline (never silently clamped); the draft only
 * receives valid values.
 */
function NumberField({
  id, label, value, placeholder, min, max, tip, onChange,
}: {
  id: string; label: string; value: number | undefined; placeholder: string;
  min: number; max: number; tip: string; onChange: (v: number | undefined) => void;
}): JSX.Element {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  // Follow outside changes (a ruleset switch, a rematch) unless mid-edit of an invalid value.
  useEffect(() => {
    setText((t) => {
      if (value === undefined) return isValid(t) ? '' : t;
      return t.trim() !== '' && Number(t) === value ? t : String(value);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function isValid(t: string): boolean {
    const n = Number(t);
    return Number.isInteger(n) && n >= min && n <= max;
  }

  const error = text.trim() !== '' && !isValid(text) ? `Enter a whole number from ${min} to ${max}.` : null;
  return (
    <div className="setup-field setup-field--num" data-invalid={error ? true : undefined}>
      <LabelRow htmlFor={id} label={label} tip={tip} />
      <input
        id={id}
        className="field"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === '') onChange(undefined);
          else if (isValid(raw)) onChange(Number(raw));
        }}
      />
      {error ? <p className="ui-field-error" id={`${id}-err`}>{error}</p> : null}
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
    <div className="setup-field">
      <LabelRow htmlFor={id} label={label} tip={active?.help} />
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </div>
  );
}
