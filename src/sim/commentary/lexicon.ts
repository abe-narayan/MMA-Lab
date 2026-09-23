/**
 * COMMENTARY LEXICON — the words for chapter 07's ids.
 *
 * The AI speaks in ids (`mode.wrestle_control`, `adj.td_stuffed_x2`); a
 * broadcast speaks in sentences. This file is the whole of that translation,
 * kept apart from the templates so a language pack can replace it wholesale.
 *
 * The `plan` column is what makes the game-plan explicable: it is the line a
 * corner would actually say, which is what 09 §5.2 asks the colour register to
 * produce ("he's using the long guard to keep the shorter fighter at the end of
 * his jab") rather than a restatement of the id.
 */

export interface ModeWords {
  /** Noun phrase: "the wrestle-and-control plan". */
  name: string;
  /** What the corner wants, in one line. */
  plan: string;
  /** The tool this mode leans on, for range-control lines. */
  tool: string;
  /** Where this mode wants the fight. */
  range: 'long' | 'mid' | 'short' | 'ground';
}

export const MODES: Readonly<Record<string, ModeWords>> = Object.freeze({
  'mode.distance_striking': {
    name: 'long-range striking',
    plan: 'keep it long behind the jab and the teep',
    tool: 'jab',
    range: 'long',
  },
  'mode.pressure_striking': {
    name: 'pressure striking',
    plan: 'walk him down and make him fight going backwards',
    tool: 'pressure',
    range: 'mid',
  },
  'mode.counter_striking': {
    name: 'counter striking',
    plan: 'make him lead, then punish the way back out',
    tool: 'counter right hand',
    range: 'mid',
  },
  'mode.sprawl_and_brawl': {
    name: 'sprawl-and-brawl',
    plan: 'stuff the shot and keep this fight standing',
    tool: 'sprawl',
    range: 'mid',
  },
  'mode.wrestle_control': {
    name: 'wrestle-and-control',
    plan: 'get him down and hold him there',
    tool: 'double leg',
    range: 'short',
  },
  'mode.clinch_grind': {
    name: 'the clinch grind',
    plan: 'tie him up on the fence and make it ugly',
    tool: 'underhook',
    range: 'short',
  },
  'mode.submission_hunt': {
    name: 'submission hunting',
    plan: 'get it to the mat and hunt the neck',
    tool: 'guard',
    range: 'ground',
  },
  'mode.outnumbered': {
    name: 'survival',
    plan: 'stay off the fence, keep them in a line, look for the way out',
    tool: 'footwork',
    range: 'mid',
  },
  idle: { name: 'no plan at all', plan: 'nothing agreed', tool: 'instinct', range: 'mid' },
});

export function modeWords(id: string | undefined): ModeWords | null {
  if (!id) return null;
  return MODES[id] ?? null;
}

/** `adj.*` → what the fighter noticed, and what he is doing about it. */
export const ADJUSTMENTS: Readonly<Record<string, { signal: string; answer: string }>> =
  Object.freeze({
    'adj.drop_family': {
      signal: 'that shot has stopped landing',
      answer: 'he has taken it out of the rotation',
    },
    'adj.defend_family': {
      signal: 'he keeps getting caught with the same shot',
      answer: 'the guard has come up for it',
    },
    'adj.td_stuffed_x2': {
      signal: 'two takedowns stuffed in the open',
      answer: 'he is going to the fence for the next one',
    },
    'adj.taken_down_x2': {
      signal: 'he has been put down twice',
      answer: 'hands only now, and back to the middle of the cage',
    },
    'adj.opp_tired': { signal: 'the other man is fading', answer: 'he is pressing him for it' },
    'adj.opp_hurt': { signal: 'he has him hurt', answer: 'he is going after the finish' },
    'adj.self_low_stamina': {
      signal: 'his own tank is low',
      answer: 'economy mode — fewer shots, better ones',
    },
    'adj.behind_final': {
      signal: 'he believes he is down a round',
      answer: 'he is trying to steal it on volume',
    },
    'adj.need_finish': { signal: 'he needs the finish', answer: 'he is headhunting for it' },
    'adj.ahead': { signal: 'he thinks he is ahead', answer: 'no reason to gamble now' },
    'adj.cut_vision': { signal: 'that eye is closing', answer: 'he is circling away from it' },
    'adj.cage_trapped': { signal: 'he is living on the fence', answer: 'he has to get off it' },
    'adj.opp_adjusted': {
      signal: 'the other corner changed something',
      answer: 'and he has already read it',
    },
    'adj.leg_damaged': { signal: 'that lead leg is gone', answer: 'he is switching his weight off it' },
    'adj.opp_leg_damaged': {
      signal: 'the other leg is compromised',
      answer: 'he keeps going back to it',
    },
    'adj.trap_set': {
      signal: 'he has shown that same look three times',
      answer: 'he showed it for a reason',
    },
  });

/** `emergency.*` and the hurt/finisher behaviour ids the policy emits. */
export const EMERGENCIES: Readonly<Record<string, string>> = Object.freeze({
  hurt: 'he is hurt and he knows it',
  clinch: 'he is hurt and looking to grab hold',
  cover: 'he is hurt and covering on the fence',
  shoot: 'he is hurt and shooting for a leg to buy time',
  angle: 'he is hurt and trying to angle out of there',
  counter: 'he is hurt and still countering',
  finish: 'he smells the finish',
  reckless: 'he has stopped picking his shots',
  measured: 'he is staying measured — straight punches, no wild swinging',
  trap: 'he is setting a trap rather than swinging for it',
  survive: 'he is in survival mode',
  stealRound: 'he is trying to steal this round',
  needFinish: 'he knows he needs a finish',
});

/**
 * 09 §5.4's tier bands, as things a commentator would actually say. The index
 * is the tier, 0-5; each band has several so a bout does not repeat itself.
 */
export const TIER_PHRASES: readonly (readonly string[])[] = Object.freeze([
  [
    'no real stance, just swinging',
    'the hands are down and the feet are square',
    'he is throwing from the hip and hoping',
  ],
  [
    'raw, but willing',
    'he telegraphs that right hand from a mile away',
    'brave, and that is about all there is so far',
  ],
  [
    'the fundamentals are there, the timing is not',
    'he knows the shots; he is a beat late on all of them',
    'amateur-clean, and honest about it',
  ],
  [
    'sharp fundamentals',
    'everything is in the right order — jab, angle, shot',
    'a proper regional professional, nothing wasted',
  ],
  [
    'elite feint game',
    'layered defence — he never gives you the same look twice',
    'he is a full beat ahead of the exchange',
  ],
  [
    "that is a champion's composure",
    'he is reading the level change before it starts',
    'he is not reacting to this fight, he is writing it',
  ],
]);

/** A tier-banded epithet for a fighter's overall level. */
export const TIER_LABEL: readonly string[] = Object.freeze([
  'brand new', 'a beginner', 'an amateur', 'a regional professional', 'elite', 'a champion',
]);

/** Region ids → the words a broadcast uses. */
export const REGION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  head: 'head',
  body: 'body',
  leadLeg: 'lead leg',
  rearLeg: 'rear leg',
  arms: 'arms',
});

/** `state.*` ids worth a line, and the line's substance. */
export const STATE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  'state.rocked': 'he is rocked',
  'state.wobbled': 'the legs went',
  'state.adrenaline_dump': 'the adrenaline has him breathing hard already',
  'state.gassed': 'the tank is empty',
  'state.winded': 'that took the wind out of him',
  'state.leg_compromised': 'the lead leg is compromised',
  'state.vision_impaired': 'he cannot see out of that eye',
  'state.cut': 'he is cut',
  'state.nose_broken': 'the nose is broken',
  'state.jaw_hurt': 'the jaw is hurting him',
  'state.ko': 'he is out',
});

export function stateWords(id: string | undefined): string | null {
  if (!id) return null;
  return STATE_WORDS[id] ?? null;
}
