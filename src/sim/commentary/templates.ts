/**
 * TEMPLATE TABLES — the English language pack (docs/design/09 §5.3).
 *
 * Selection key is `${kind}.${result}.${region}.${power}` with fallback to
 * shorter keys, so `strike.landed.head.power` falls back to
 * `strike.landed.head`, then `strike.landed`, then `strike`. Every key carries
 * at least three alternatives (09 §5.3 `[E]`), which `commentary.test.ts`
 * checks rather than trusting.
 *
 * A template may only use variables the candidate builder guarantees for its
 * key family; an unresolved variable drops the line (see `grammar.render`), so
 * a mistake here is a missing line, never a `{placeholder}` on screen.
 */

export type TemplateTable = Readonly<Record<string, readonly string[]>>;

/** Play-by-play: what just happened. */
export const PBP: TemplateTable = Object.freeze({
  // ---- striking ----------------------------------------------------------
  'strike.landed.head.power': [
    '{actor} [lands|connects with] {technique.name|article} [upstairs|to the head]!',
    'Big {technique.name} from {actor} — right down the middle!',
    '{actor} [cracks|catches] {target} with {technique.name|article}!',
    'Oh, {technique.name|article} from {actor} and {target} felt that one.',
  ],
  'strike.landed.head': [
    '{actor} [touches him up|gets home] with {technique.name|article}.',
    '{technique.name|cap} lands for {actor}.',
    '{actor} [pops|snaps] {technique.name|article} into {target|poss} face.',
  ],
  'strike.landed.body': [
    '{actor} [digs|buries] {technique.name|article} into the body.',
    'To the body — {technique.name} from {actor}.',
    '{actor} goes downstairs with {technique.name|article}.',
  ],
  'strike.landed.leg': [
    '{actor} [chops|thuds] {technique.name|article} into the {region}.',
    'Another one to the {region} from {actor}.',
    '{actor} takes the {region} again with {technique.name|article}.',
  ],
  'strike.landed': [
    '{actor} lands {technique.name|article}.',
    '{technique.name|cap} gets through for {actor}.',
    '{actor} scores with {technique.name|article} to the {region}.',
  ],
  'strike.counter': [
    '{actor} waits, and [counters|answers] with {technique.name|article}.',
    'Beautiful counter — {actor} slips and returns {technique.name|article}.',
    '{target} leads, {actor} makes him pay with {technique.name|article}.',
  ],
  'strike.blocked': [
    '{target} [blocks|picks off] the {technique.name}.',
    '{technique.name|cap} from {actor}, blocked high.',
    '{target} gets the guard there in time.',
  ],
  'strike.evaded': [
    '{target} [slips|rolls under] the {technique.name}.',
    '{actor} throws the {technique.name} and {target} is not there.',
    'Not a mark on him — {target} reads the {technique.name}.',
  ],
  'strike.missed': [
    '{actor} misses with the {technique.name}.',
    'Wide — the {technique.name} sails past.',
    '{actor} comes up short with the {technique.name}.',
  ],
  'strike.checked': [
    '{target} checks the {technique.name}.',
    'Shin on shin — {target} checks it.',
    '{actor} kicks into the check and wears it himself.',
  ],
  'strike.caught': [
    '{target} catches the {technique.name}.',
    'Kick caught — and now {actor} is on one leg.',
    '{target} scoops the {technique.name} up.',
  ],
  'strike.interrupted': [
    '{actor} starts the {technique.name} and gets shut down.',
    'The {technique.name} never arrives — {target} beats him to it.',
    '{actor} is interrupted mid-{technique.family}.',
  ],
  strike: [
    '{actor} throws the {technique.name}.',
    '{technique.name|cap}, {actor}.',
    '{actor} lets the {technique.name} go.',
  ],
  'fold.strikes': [
    '[Three|Several] more from {actor} in that burst.',
    '{actor} piles up {count} in a row there.',
    "That's {count} straight from {actor} — {target} is just covering.",
  ],

  // ---- damage ------------------------------------------------------------
  knockdown: [
    '{target} is DOWN! {actor} [drops him|puts him on the canvas]!',
    'DOWN goes {target}! {actor} found it!',
    '{actor} drops him — {target} is on the floor and {actor} follows.',
  ],
  rocked: [
    '{target} is hurt! [The legs went|He is on rubber legs] there!',
    '{actor} has him [badly hurt|wobbled]!',
    '{target} is in deep trouble here.',
  ],
  'stateChange.on': [
    '{state|cap}.',
    '{state|cap} — and this changes the fight.',
    'Look at that: {state}.',
  ],
  'stateChange.off': [
    '{actor} has [shaken that off|cleared his head].',
    "{actor} looks like he's through it.",
    "That's passed for {actor}.",
  ],
  injury: [
    '{actor} is hurt — [and that is not from a punch|that looked like a bad landing].',
    'Something has gone wrong for {actor} there.',
    '{actor} is favouring that badly.',
  ],
  slam: [
    '{actor} [picks him up and dumps him|slams {target} to the canvas]!',
    'Enormous slam by {actor}!',
    '{actor} lifts and drops {target} on his back.',
  ],

  // ---- grappling ---------------------------------------------------------
  'takedown.success': [
    '{actor} [gets it|finishes the shot] — {target} is on his back.',
    "{actor} takes him down, and that's a change of fight.",
    '{actor} plants {target} on the canvas.',
  ],
  'takedown.stuffed': [
    'Stuffed. {target} [sprawls|reads it] and {actor} pays for the shot.',
    '{target} sprawls it out — nothing there for {actor}.',
    '{actor} shoots, {target} is heavy on him, and it dies.',
  ],
  'takedown.countered': [
    '{actor} shoots and {target} turns it around on him!',
    'Countered — {target} takes the back off the shot.',
    '{actor} gives up position on that one.',
  ],
  takedown: [
    '{actor} changes levels on {target}.',
    '{actor} goes for the legs.',
    'Shot from {actor}.',
  ],
  clinch: [
    '{actor} ties him up.',
    'Into the clinch, {actor} driving.',
    '{actor} closes the distance and gets hold of {target}.',
  ],
  clinchBreak: [
    'They break.',
    '{actor} [pushes off|frames and separates].',
    'Separated, back to the open.',
  ],
  positionChange: [
    '{actor} moves to {position.name}.',
    '{actor} improves — {position.name} now.',
    'Position change: {actor} has {position.name}.',
  ],
  scramble: [
    'Scramble — and they are both up for it.',
    'Wild scramble in the middle.',
    'Both men moving; nobody owns this yet.',
  ],
  reversal: [
    '{actor} reverses it!',
    '{actor} turns it over — he is on top now.',
    'Reversal from the bottom by {actor}.',
  ],
  standUp: [
    '{actor} [works back up|gets to his feet].',
    '{actor} is up.',
    'Back to the feet for {actor}.',
  ],
  engagementJoin: [
    '{actor} gets hold of {target}.',
    'They lock up.',
    '{actor} closes on {target}.',
  ],
  disengage: [
    '{actor} [breaks away|gets out of there].',
    '{actor} separates.',
    'Back to open space.',
  ],

  // ---- submissions -------------------------------------------------------
  'submissionStage.1': [
    '{actor} is hunting the {submission.name}.',
    'There is the {submission.name} from {actor}.',
    '{actor} starts working for the {submission.name}.',
  ],
  'submissionStage.2': [
    '{actor} has the {submission.name} — this is real.',
    "That's secured. The {submission.name} is on.",
    '{actor} gets it locked up.',
  ],
  'submissionStage.3': [
    '{actor} is [cranking|finishing] the {submission.name}!',
    '{target} is in serious trouble with this {submission.name}!',
    'This is tight — {target} has to do something.',
  ],
  'submissionStage.4': [
    "That's locked in. {target} is in a bad way.",
    'Locked — and {target} has nowhere to go.',
    '{actor} has it all the way.',
  ],
  submissionStage: [
    '{actor} looks for the {submission.name}.',
    '{submission.name|cap} attempt from {actor}.',
    '{actor} reaches for the {submission.name}.',
  ],
  'submissionFinish.tap': [
    "He taps! {actor} gets the {submission.name}, and that's it!",
    "{target} taps — {submission.name} from {actor}. It's over.",
    "That's a tap! {actor} takes it by {submission.name}.",
  ],
  'submissionFinish.verbal': [
    '{target} calls it — verbal submission to the {submission.name}.',
    'He tells the referee he is done. {submission.name} for {actor}.',
    "{target} says that's enough.",
  ],
  'submissionFinish.loc': [
    '{target} is out! He never tapped — {actor} put him to sleep.',
    '{target} goes to sleep in the {submission.name}. Referee steps in.',
    'He is unconscious. {actor} would not let go of the {submission.name}.',
  ],
  'submissionFinish.injury': [
    "{target} can't continue — that {submission.name} did damage.",
    'Referee waves it off; {target} is hurt.',
    'It ends there, and {target} is holding that arm.',
  ],
  submissionFinish: [
    '{actor} finishes it with the {submission.name}.',
    'The {submission.name} ends it.',
    'It is over — {submission.name}, {actor}.',
  ],

  // ---- officials ---------------------------------------------------------
  refereeWarning: [
    'Referee: {referee.reason}.',
    'A word from the referee — {referee.reason}.',
    '"{referee.reason|cap}!"',
  ],
  refereeCount: ['The count is on.', 'Referee picks up the count.', 'He is counting over {target}.'],
  standingEight: ['Standing eight.', 'The referee takes a standing eight.', 'Eight count — he wants to see the eyes.'],
  refereeBreak: ['Referee breaks them.', '"Break!"', 'Stood up by the referee.'],
  refereeTimeout: ['Time is out.', 'The referee calls time.', 'A pause here.'],
  foul: [
    'Foul — {referee.foul}.',
    'That was {referee.foul}, and the referee saw it.',
    'Illegal: {referee.foul}.',
  ],
  deduction: [
    'Point deducted.',
    'A point comes off for that.',
    "That's a point gone, and it could matter.",
  ],
  refereeStoppage: [
    "The referee has seen enough — it's over!",
    'Stopped! And there is no argument.',
    "That's the finish — the referee steps in.",
  ],
  doctorCheck: ['The doctor takes a look.', 'Doctor in to see that.', 'They want the doctor on this.'],
  cornerStop: ['The corner has pulled him out.', 'The towel comes in.', 'His corner will not let him go back out.'],
  timidityWarning: ['Referee wants more work.', '"You have to engage!"', 'A timidity warning there.'],
  fighterOut: ['And that is the end of it.', 'He is finished.', 'It is done.'],

  // ---- scoring and structure --------------------------------------------
  scorecardRound: ['The round goes on the cards.', 'Cards in for that round.', 'That round is scored.'],
  pointsAwarded: ['Points on the board.', 'That scores.', 'Added to the tally.'],
  judoScore: ['A score there.', 'That is worth points.', 'The officials mark that one.'],
  decision: [
    'We go to the cards.',
    'This one is in the judges’ hands.',
    'The decision comes in.',
  ],
  boutStart: [
    "Here we go — they're under way.",
    'Touch of gloves and away we go.',
    'And we are live.',
  ],
  roundStart: ['Round {round}.', 'Out they come for round {round}.', 'Round {round} is under way.'],
  roundEnd: ['There goes the horn.', 'That is the end of the round.', 'The bell ends round {round}.'],
  boutEnd: ['And that is the fight.', 'It is all over.', 'The contest is finished.'],
  flight: ['{actor} has had enough — he is out of here.', '{actor} turns and leaves.', '{actor} wants no more of this.'],
  streetEnd: ['It ends there.', 'And it is over.', 'That is the end of it.'],
});

/** Colour: what it means, why it is happening, what it says about the men. */
export const COLOUR: TemplateTable = Object.freeze({
  planSet: [
    '{actor|poss} plan is plain enough: {intent.plan}.',
    'Watch what {actor} wants here — {intent.plan}.',
    '{actor} came in to {intent.plan}, and that is what the corner has been saying all week.',
  ],
  intentChange: [
    '{actor} has [switched to|gone to] {intent.mode} — {intent.trigger}.',
    "That's a change: {actor} is on {intent.mode} now, and it is because {intent.trigger}.",
    '{actor} was not getting anywhere, so {intent.mode} it is: {intent.answer}.',
  ],
  adjustment: [
    '{actor} has worked something out — {intent.trigger}, and {intent.answer}.',
    'There is the adjustment: {intent.trigger}. {intent.answer|cap}.',
    '{actor} noticed it too — {intent.trigger}. {intent.answer|cap}.',
  ],
  cornerCue: [
    "The corner wanted that: {intent.trigger}. Let's see if he listens.",
    '{actor|poss} corner asked for exactly this between rounds — {intent.trigger}.',
    'That is straight off the stool: {intent.trigger}.',
  ],
  'cornerCue.ignored': [
    '{actor|poss} corner asked for {intent.trigger}, and he has not done it.',
    'They told him {intent.trigger}. He is not listening.',
    'The cue was {intent.trigger} — it went in one ear.',
  ],
  scoreUpdate: [
    '{actor} thinks he is {score.belief}; the cards may say otherwise.',
    'You can see {actor} believes he is {score.belief} here.',
    '{actor} is fighting like a man who thinks he is {score.belief}.',
  ],
  emergency: [
    '{actor}: {intent.emergency}. That is the fight now.',
    '{actor}: {intent.emergency}.',
    'Look at {actor} — {intent.emergency}.',
  ],
  paceShift: [
    '{actor} has changed the pace here.',
    'The tempo has moved, and it is {actor} doing it.',
    '{actor} is [picking it up|slowing this down] deliberately.',
  ],
  stanceSwitch: [
    '{actor} switches stance — {intent.trigger}.',
    'Southpaw, orthodox: {actor} is changing the picture on purpose.',
    '{actor} has switched, and that is not an accident.',
  ],
  targetSwitch: [
    '{actor} has turned to the bigger threat.',
    '{actor} picks a new man.',
    '{actor} changes targets.',
  ],
  roleAssign: [
    '{actor} is taking the holding job.',
    'They have split the work: {actor} has his role.',
    '{actor} knows exactly what he is there to do.',
  ],
  trap: [
    '{actor} has shown that same look three times now — he showed it for a reason.',
    'That is a trap being built by {actor}.',
    '{actor} is not repeating himself by accident.',
  ],
  read: [
    '{actor} saw that coming before it left the ground.',
    '{actor} read it — {tier.phrase.actor}.',
    'He knew. {actor} knew exactly what was coming.',
  ],
  feint: [
    '{target} bit on the feint, and {actor} was waiting.',
    '{actor} sells it, {target} buys it.',
    'Feint, reaction, punish — {actor} is playing a different game.',
  ],

  // ---- derived observations (09 §5.2, 07 §2.8 evt.* rows) ----------------
  'range.control': [
    '{actor} is using the long guard to keep the shorter man at the end of his {intent.tool}.',
    'Look at the geometry: {actor} will not let {target} inside the {intent.tool}.',
    '{actor} has owned the distance for the last {seconds} seconds — {target} cannot get past the {intent.tool}.',
  ],
  'cage.cut': [
    '{actor} cut the cage off and put {target} on the fence.',
    'That is not chasing — {actor} is taking the space away a step at a time.',
    '{target} is walking backwards into the fence, and {actor} built that.',
  ],
  'reach.advantage': [
    '{actor} is using every inch of that reach.',
    '{reach} centimetres of reach, and {actor} is spending all of it.',
    '{target} has to cross a lot of empty floor to touch {actor}.',
  ],
  'tier.intro': [
    '{actor}: {tier.phrase.actor}.',
    'Watch {actor} for a moment — {tier.phrase.actor}.',
    'If you want the measure of {actor}: {tier.phrase.actor}.',
  ],
  'tier.contrast': [
    '{actor} is {tier.actor}, {target} is {tier.target}, and the gap is visible.',
    'This is {tier.actor} against {tier.target}, and it looks it.',
    'Levels: {tier.actor} versus {tier.target}.',
  ],
  'stat.drop': [
    '{actor} is {stat.sig} of {stat.sigAttempted} this round.',
    '{stat.sig} landed from {stat.sigAttempted} thrown for {actor} in the round.',
    'The numbers on {actor}: {stat.sig} of {stat.sigAttempted}, {stat.head} of them upstairs.',
  ],
  'round.summary': [
    'Round {round} to the numbers: {actor} {stat.sig}, {target} {stat.sigOpp}.',
    'On volume that is {actor} {stat.sig} to {stat.sigOpp} for round {round}.',
    'Significant strikes in round {round}: {actor} {stat.sig}, {target} {stat.sigOpp}.',
  ],
  'state.colour': [
    '{state|cap} — and that is the story of this fight now.',
    'You can see it: {state}.',
    '{state|cap}. It is not going to get better.',
  ],
});

/** Every table the generator consults, in lookup order. */
export const TABLES: Readonly<Record<'pbp' | 'colour', TemplateTable>> = Object.freeze({
  pbp: PBP,
  colour: COLOUR,
});

/**
 * Longest-prefix lookup: `a.b.c` -> `a.b` -> `a`. Returns the key that matched
 * so the caller can tag the line with it.
 */
export function lookup(
  table: TemplateTable,
  key: string,
): { key: string; alternatives: readonly string[] } | null {
  let k = key;
  for (;;) {
    const hit = table[k];
    if (hit && hit.length > 0) return { key: k, alternatives: hit };
    const cut = k.lastIndexOf('.');
    if (cut < 0) return null;
    k = k.slice(0, cut);
  }
}
