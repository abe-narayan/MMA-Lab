/**
 * COMMENTARY — barrel (docs/design/09 §5).
 *
 * Nothing under `src/sim/commentary` imports React, the DOM or a wall clock,
 * and nothing draws from the bout RNG.
 */
export { generateCommentary } from './generate';
export { COMMENTABLE_KINDS } from './types';
export type {
  CommentaryLine, CommentaryOptions, CommentaryPriority, CommentaryVoice, IntentSample,
} from './types';
export { PBP, COLOUR, TABLES, lookup } from './templates';
export type { TemplateTable } from './templates';
export { render, parseTemplate, variablesOf } from './grammar';
export { MODES, ADJUSTMENTS, EMERGENCIES, TIER_PHRASES, TIER_LABEL, modeWords } from './lexicon';
export type { ModeWords } from './lexicon';
