/**
 * WATCH KEYBOARD SHORTCUTS — one table for the handler, the help overlay and
 * the tooltips, so what the "?" overlay lists is what the keys do.
 *
 * Pure: `shortcutFor(key event)` maps a key to an action, nothing else.
 */

export type WatchAction =
  | { type: 'togglePlay' }
  | { type: 'pause' }
  | { type: 'step'; frames: number }
  | { type: 'event'; dir: 1 | -1 }
  | { type: 'marker'; dir: 1 | -1 }
  | { type: 'speed'; dir: 1 | -1 }
  | { type: 'speedReset' }
  | { type: 'restart' }
  | { type: 'end' }
  | { type: 'camera'; slot: number }
  | { type: 'fullscreen' }
  | { type: 'help' }
  | { type: 'escape' }
  | { type: 'replayLast' }
  | { type: 'analytics' }
  | { type: 'debug' };

export interface KeyLike {
  code: string;
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The help overlay's rows: keys (as shown) and what they do. */
export const SHORTCUT_HELP: readonly { keys: readonly string[]; what: string }[] = [
  { keys: ['Space', 'K'], what: 'Play / pause' },
  { keys: ['←', '→'], what: 'Step one frame (0.1 s); Shift: one second' },
  { keys: ['J', 'L'], what: 'Slower / faster (0.1× … 4×)' },
  { keys: ['Shift+K'], what: 'Back to 1× speed' },
  { keys: ['[', ']'], what: 'Previous / next event' },
  { keys: [',', '.'], what: 'Previous / next highlight (knockdown, takedown, finish…)' },
  { keys: ['Home', 'End'], what: 'Restart / jump to the end' },
  { keys: ['1–9'], what: 'Cameras: 1 auto (director), 2–7 fixed cameras, 8 follow, 9 free orbit' },
  { keys: ['R'], what: 'Instant replay of the last 8 s' },
  { keys: ['F'], what: 'Fullscreen' },
  { keys: ['A'], what: 'Show / hide analytics' },
  { keys: ['D'], what: 'Debug overlay' },
  { keys: ['?'], what: 'This help' },
  { keys: ['Esc'], what: 'Close help / leave fullscreen' },
];

/** The action for a key press, or null when the Watch screen does not use it. */
export function shortcutFor(e: KeyLike): WatchAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return { type: 'help' };
  switch (e.code) {
    case 'Space':
      return { type: 'togglePlay' };
    case 'KeyK':
      return e.shiftKey ? { type: 'speedReset' } : { type: 'togglePlay' };
    case 'KeyJ':
      return { type: 'speed', dir: -1 };
    case 'KeyL':
      return { type: 'speed', dir: 1 };
    case 'ArrowLeft':
      return { type: 'step', frames: e.shiftKey ? -10 : -1 };
    case 'ArrowRight':
      return { type: 'step', frames: e.shiftKey ? 10 : 1 };
    case 'BracketLeft':
      return { type: 'event', dir: -1 };
    case 'BracketRight':
      return { type: 'event', dir: 1 };
    case 'Comma':
      return { type: 'marker', dir: -1 };
    case 'Period':
      return { type: 'marker', dir: 1 };
    case 'Home':
      return { type: 'restart' };
    case 'End':
      return { type: 'end' };
    case 'KeyF':
      return { type: 'fullscreen' };
    case 'KeyR':
      return { type: 'replayLast' };
    case 'KeyA':
      return { type: 'analytics' };
    case 'KeyD':
      return { type: 'debug' };
    case 'Escape':
      return { type: 'escape' };
    default:
      break;
  }
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (m) return { type: 'camera', slot: Number(m[1]) };
  return null;
}
