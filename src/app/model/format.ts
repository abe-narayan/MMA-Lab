/**
 * SHARED TEXT FORMATTING — one spelling for results and clocks everywhere
 * (Result, History, the Watch screen, the replay library).
 *
 * Clock convention: a *result* time ("R2 3:54") is elapsed time in the round,
 * floored to the second, as official results print it. A *live* round clock
 * counts down, like a broadcast graphic. Both floor, so a finish at 234.6 s
 * is 3:54 elapsed everywhere it appears.
 */

const METHOD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ko: 'KO',
  tko: 'TKO',
  'tko.doctor': 'TKO (doctor stoppage)',
  'tko.corner': 'TKO (corner stoppage)',
  'tko.retirement': 'TKO (retirement)',
  submission: 'Submission',
  'submission.technical': 'Technical submission',
  'decision.unanimous': 'Unanimous decision',
  'decision.split': 'Split decision',
  'decision.majority': 'Majority decision',
  'decision.technical': 'Technical decision',
  draw: 'Draw',
  'draw.majority': 'Majority draw',
  'draw.split': 'Split draw',
  dq: 'Disqualification',
  noContest: 'No contest',
  allOpponentsStopped: 'All opponents stopped',
  escaped: 'Defender escaped',
  separated: 'Separated (no decision)',
  timeLimit: 'Time limit reached',
});

/** "decision.unanimous" (in any case) → "Unanimous decision". Unknown ids are de-camelled, never shouted. */
export function methodText(method: string): string {
  const key = Object.keys(METHOD_LABELS).find((k) => k.toLowerCase() === method.toLowerCase());
  if (key) return METHOD_LABELS[key];
  const words = method.replace(/[._]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** m:ss, floored. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A live round clock counting down: remaining = roundSeconds - elapsed, shown with ceil so 0:00 means over. */
export function roundClockRemaining(elapsed: number, roundSeconds: number): string {
  const left = Math.max(0, Math.ceil(roundSeconds - elapsed - 1e-6));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
