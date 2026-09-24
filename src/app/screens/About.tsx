/**
 * ABOUT THE MODEL — the v4 replacement for the legacy v3 "Model" notes.
 *
 * Three things a user should be able to find without opening the repo: what
 * the simulation models and what it deliberately does not (docs/DESIGN.md
 * §1-§6, condensed), the calibration anchors it is tuned against, and every
 * tunable number in the parameter registry with its unit and provenance tag.
 * The registry is read live from `PARAMS`, so this page cannot drift from the
 * build it ships in.
 */

import { useMemo, useState } from 'react';
import { DEFAULT_PARAMS_HASH, PARAMS, SIM_ENGINE_VERSION, type ParamSection } from '../../sim';
import { PROFILE_PARAMS, UNMODELLED_CONCEPTS } from '../model/profileModel';
import { EmptyState, Field, StatusBadge, IconSearch } from '../ui';

const PRINCIPLES: readonly { title: string; body: string }[] = [
  { title: 'A bout is a pure function of its seed', body: 'Fixed 0.1 s tick, one seeded random stream with a fixed draw order. The same seed, fighters, ruleset, arena and settings give the same fight on any machine; every replay is verified by digest.' },
  { title: 'Fighters are attributes, skills and tiers', body: 'A body, 14 physical and 6 mental attributes (0-100), named sub-skills in ten disciplines, and a derived tier T0-T5 per discipline. Experts differ from novices in anticipation, accuracy and economy, not reaction time.' },
  { title: 'Standing exchanges', body: 'Range is asymmetric (each fighter has their own reach). A strike is a landing roll adjusted by skill gap, setup, feints, fatigue and the defender’s read, then a placement and a force drawn from a right-skewed distribution.' },
  { title: 'Grappling is a graph', body: '74 positions and 186 transitions: takedowns, throws, passes, sweeps, escapes and get-ups, each with a duration, a base probability, skill gains and counters. The cage is a state on every relevant edge.' },
  { title: 'Submissions are contested', body: 'Setup, entry, secure and finish are four stages, and the defender fights each one. Chokes put a fighter out about nine seconds after being locked; most finishes are taps.' },
  { title: 'Damage, fatigue and officials', body: 'Six body regions with acute and structural pools; knockdowns from a rotational-acceleration logistic; three fatigue pools. Referees act on observable cues with a measured lag; judges score with fitted weights plus per-judge noise.' },
];

const FINDINGS: readonly string[] = [
  'Height and reach do not change win probability in the reference data; reach changes how fighters fight, not the odds.',
  'Age is the physical factor that matters most: roughly 1.5 to 2 percentage points per year of age gap.',
  'Fatigue costs volume, accuracy and defence, not punch force.',
  'Fighters behind on the cards cut their takedowns and hunt stand-up finishes.',
  'A realistic simulation is only about 62 % predictable in evenly rated matchups; much above 70 % is under-randomised.',
  'Judges weight a knockdown about five times a takedown and about eleven times a significant strike.',
];

const ANCHORS: readonly [string, string][] = [
  ['Significant strikes landed per minute', '3.9 ± 0.4'],
  ['Significant strike accuracy', '46 % ± 3'],
  ['Accuracy to head / body / leg', '38 / 70 / 81 %'],
  ['Fight time at distance / clinch / ground', '61 / 15 / 24 %'],
  ['Knockdowns per fighter per 15 min', '0.30'],
  ['Takedowns attempted / landed per 15 min', '4.0 / 1.45'],
  ['Submission attempts per 15 min', '0.45 to 0.6'],
  ['KO-TKO / submission / decision', '32 / 18 / 49 % ± 3'],
  ['Decisions: unanimous / split / majority', '77 / 20 / 2.5 %'],
];

const SECTION_LABEL: Readonly<Record<ParamSection, string>> = {
  core: 'Core', fighter: 'Fighter', striking: 'Striking', grappling: 'Grappling', submissions: 'Submissions',
  damage: 'Damage', rules: 'Rules', ai: 'Strategy and AI', multi: 'Multi-fighter', stats: 'Statistics',
  commentary: 'Commentary', batch: 'Batch',
};

function provenance(tag: string): { label: string; tone: 'ok' | 'info' | 'warn' } {
  if (tag.startsWith('[S')) return { label: 'Sourced', tone: 'ok' };
  if (tag.startsWith('[D')) return { label: 'Derived', tone: 'info' };
  return { label: 'Assumption', tone: 'warn' };
}

const PAGE = 60;

export function About(): JSX.Element {
  const all = PARAMS.all;
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<'all' | ParamSection>('all');
  const [prov, setProv] = useState<'all' | 'Sourced' | 'Derived' | 'Assumption'>('all');
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const c = { Sourced: 0, Derived: 0, Assumption: 0 };
    for (const p of all) c[provenance(p.tag).label as keyof typeof c]++;
    return c;
  }, [all]);

  const sections = useMemo(() => [...new Set(all.map((p) => p.section))], [all]);

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((p) => (section === 'all' || p.section === section)
      && (prov === 'all' || provenance(p.tag).label === prov)
      && words.every((w) => `${p.id} ${p.note ?? ''} ${p.unit}`.toLowerCase().includes(w)));
  }, [all, query, section, prov]);

  const live = PROFILE_PARAMS.filter((p) => p.status === 'live').length;

  return (
    <div className="about">
      <header className="page-head">
        <div>
          <h1 className="page-title">About the model</h1>
          <p className="page-sub">
            What BOUT LAB simulates, what it is calibrated against, and every number it runs on.
            Engine <span className="mono">{SIM_ENGINE_VERSION}</span>, parameter set{' '}
            <span className="mono">{DEFAULT_PARAMS_HASH.slice(0, 12)}</span>.
          </p>
        </div>
      </header>

      <section className="ui-card ui-card--pad about-disclaimer" aria-labelledby="about-toy">
        <h2 className="section-title" id="about-toy">A modelling toy, not a predictor</h2>
        <p>
          Every probability in BOUT LAB is either taken from published fight data and sports-science
          literature or is an explicit, labelled assumption. The output describes this model; it is
          not a validated prediction of what would happen between real people, and no real athlete,
          promotion or event is represented.
        </p>
        <p>
          The simulation models a regulated, refereed contest. Accumulated impact is an abstract
          index whose role is to trigger a referee or doctor stoppage; no injury, medical outcome or
          lasting harm is modelled or shown.
        </p>
      </section>

      <section className="about-section" aria-labelledby="about-how">
        <h2 className="section-title" id="about-how">How a bout is simulated</h2>
        <div className="about-grid">
          {PRINCIPLES.map((p) => (
            <article key={p.title} className="ui-card ui-card--pad about-principle">
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="about-two">
        <section className="about-section" aria-labelledby="about-findings">
          <h2 className="section-title" id="about-findings">Findings the model follows</h2>
          <p className="section-sub">Where the evidence overrules intuition, the evidence wins.</p>
          <ol className="about-findings">
            {FINDINGS.map((f) => <li key={f}>{f}</li>)}
          </ol>
        </section>

        <section className="about-section" aria-labelledby="about-anchors">
          <h2 className="section-title" id="about-anchors">Calibration anchors</h2>
          <p className="section-sub">Per fighter, modern elite MMA. The full 129-row acceptance table is in the design rulebook, chapter 09.</p>
          <div className="table-wrap">
            <table className="ui-table">
              <thead><tr><th scope="col">Metric</th><th scope="col" className="num">Target</th></tr></thead>
              <tbody>
                {ANCHORS.map(([k, v]) => (
                  <tr key={k}><th scope="row" style={{ fontWeight: 400 }}>{k}</th><td className="num">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="about-section" aria-labelledby="about-editor">
        <h2 className="section-title" id="about-editor">The fighter editor is tested against the simulation</h2>
        <p className="section-sub">
          {live} controls in the fighter editor&rsquo;s profile view are each covered by an automated
          test that runs a deterministic batch with the control low and high and checks that a related
          statistic moves. Concepts the model does not represent separately are listed rather than
          offered as sliders that do nothing:
        </p>
        <ul className="about-unmodelled">
          {UNMODELLED_CONCEPTS.map((c) => (
            <li key={c.concept}><b>{c.concept}.</b> {c.carriedBy}</li>
          ))}
        </ul>
      </section>

      <section className="about-section" aria-labelledby="about-params">
        <h2 className="section-title" id="about-params">Every parameter</h2>
        <p className="section-sub">
          {all.length.toLocaleString()} tunables, each with a unit and a provenance tag:{' '}
          {counts.Sourced.toLocaleString()} sourced, {counts.Derived.toLocaleString()} derived,{' '}
          {counts.Assumption.toLocaleString()} explicit assumptions.
        </p>
        <div className="about-filters" role="search">
          <Field label="Search parameters">
            {(p) => (
              <div className="about-search">
                <IconSearch aria-hidden="true" />
                <input
                  id={p.id}
                  className="field"
                  type="search"
                  placeholder="e.g. jab, takedown, stoppage"
                  value={query}
                  aria-describedby={p.describedBy}
                  onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
                />
              </div>
            )}
          </Field>
          <Field label="Section">
            {(p) => (
              <select id={p.id} className="field" value={section} onChange={(e) => { setSection(e.target.value as 'all' | ParamSection); setLimit(PAGE); }}>
                <option value="all">All sections</option>
                {sections.map((s) => <option key={s} value={s}>{SECTION_LABEL[s] ?? s}</option>)}
              </select>
            )}
          </Field>
          <Field label="Provenance">
            {(p) => (
              <select id={p.id} className="field" value={prov} onChange={(e) => { setProv(e.target.value as typeof prov); setLimit(PAGE); }}>
                <option value="all">Any</option>
                <option value="Sourced">Sourced</option>
                <option value="Derived">Derived</option>
                <option value="Assumption">Assumption</option>
              </select>
            )}
          </Field>
        </div>
        <p className="about-count" role="status">
          Showing {Math.min(limit, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}
        </p>
        {filtered.length === 0 ? (
          <EmptyState compact icon={<IconSearch />} title="No parameter matches">
            Try a shorter search, or set the section and provenance filters back to all.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="ui-table about-params">
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col" className="num">Value</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Calibration</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((p) => {
                  const pv = provenance(p.tag);
                  return (
                    <tr key={p.id}>
                      <th scope="row">
                        <code className="mono about-pid">{p.id}</code>
                        {p.note ? <span className="about-note">{p.note}</span> : null}
                      </th>
                      <td className="num">{Number.isInteger(p.value) ? p.value : p.value.toPrecision(4)}</td>
                      <td className="mono about-unit">{p.unit}</td>
                      <td><StatusBadge tone={pv.tone} title={p.tag}>{pv.label}</StatusBadge></td>
                      <td>{p.free ? <StatusBadge tone="outline">Tunable</StatusBadge> : <StatusBadge>Fixed</StatusBadge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {limit < filtered.length ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="ui-btn" onClick={() => setLimit((l) => l + PAGE * 4)}>
              Show more
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
