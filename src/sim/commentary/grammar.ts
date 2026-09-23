/**
 * TEMPLATE GRAMMAR (docs/design/09 §5.3).
 *
 *   line      := segment+
 *   segment   := text | '{' var ('|' filter)* '}' | '[' alt ('|' alt)+ ']'
 *   filter    := cap | lower | upper | poss | article
 *
 * Alternatives are chosen by the commentary sub-RNG, so the same replay always
 * says the same thing; brackets nest, so an alternative may itself contain a
 * variable or a nested choice.
 *
 * An unresolved variable is a hard failure, not a `{placeholder}` leaking onto
 * the screen: `render` returns `null` and the caller drops the candidate. That
 * is what makes "no line ever names a fighter or a technique that is not in
 * this bout" a property of the renderer rather than of every template author.
 */
import type { RNG } from '../rng';

type Node =
  | { t: 'text'; s: string }
  | { t: 'var'; name: string; filters: readonly string[] }
  | { t: 'alt'; options: readonly (readonly Node[])[] };

export type VarTable = Readonly<Record<string, string | undefined>>;

const CACHE = new Map<string, readonly Node[]>();

/** Parse a template string into nodes; cached, because templates are constant. */
export function parseTemplate(template: string): readonly Node[] {
  const hit = CACHE.get(template);
  if (hit) return hit;
  let i = 0;

  function parseSeq(stopAtAltDelims: boolean): Node[] {
    const out: Node[] = [];
    let buf = '';
    const flush = (): void => {
      if (buf.length > 0) {
        out.push({ t: 'text', s: buf });
        buf = '';
      }
    };
    while (i < template.length) {
      const ch = template[i];
      if (stopAtAltDelims && (ch === '|' || ch === ']')) break;
      if (ch === '\\' && i + 1 < template.length) {
        buf += template[i + 1];
        i += 2;
        continue;
      }
      if (ch === '{') {
        flush();
        i++;
        const close = template.indexOf('}', i);
        const body = close < 0 ? template.slice(i) : template.slice(i, close);
        i = close < 0 ? template.length : close + 1;
        const parts = body.split('|').map((p) => p.trim());
        out.push({ t: 'var', name: parts[0], filters: parts.slice(1) });
        continue;
      }
      if (ch === '[') {
        flush();
        i++;
        const options: Node[][] = [];
        for (;;) {
          options.push(parseSeq(true));
          if (template[i] === '|') {
            i++;
            continue;
          }
          if (template[i] === ']') i++;
          break;
        }
        out.push({ t: 'alt', options });
        continue;
      }
      buf += ch;
      i++;
    }
    flush();
    return out;
  }

  const nodes = parseSeq(false);
  CACHE.set(template, nodes);
  return nodes;
}

function applyFilter(value: string, filter: string): string {
  switch (filter) {
    case 'cap':
      return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
    case 'lower':
      return value.toLowerCase();
    case 'upper':
      return value.toUpperCase();
    case 'poss':
      return value.endsWith('s') ? `${value}'` : `${value}'s`;
    case 'article':
      return /^[aeiou]/i.test(value) ? `an ${value}` : `a ${value}`;
    default:
      return value;
  }
}

class MissingVar extends Error {
  constructor(readonly varName: string) {
    super(`commentary: unresolved variable {${varName}}`);
  }
}

function renderNodes(nodes: readonly Node[], vars: VarTable, rng: RNG): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') {
      out += n.s;
    } else if (n.t === 'var') {
      const raw = vars[n.name];
      if (raw === undefined || raw === '') throw new MissingVar(n.name);
      let v = raw;
      for (const f of n.filters) v = applyFilter(v, f);
      out += v;
    } else {
      // One draw per choice point, always, so the stream position is a pure
      // function of the template — a template with one option still draws.
      const pick = n.options.length <= 1 ? (rng.next(), 0) : rng.int(n.options.length);
      out += renderNodes(n.options[pick] ?? [], vars, rng);
    }
  }
  return out;
}

/** Render one template. Returns `null` when a variable could not be resolved. */
export function render(template: string, vars: VarTable, rng: RNG): string | null {
  try {
    return tidy(renderNodes(parseTemplate(template), vars, rng));
  } catch (err) {
    if (err instanceof MissingVar) return null;
    throw err;
  }
}

/** Collapse the whitespace a bracketed alternative can leave behind. */
function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

/** Every variable a template mentions — used by the template self-check. */
export function variablesOf(template: string): readonly string[] {
  const out: string[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.t === 'var') out.push(n.name);
      else if (n.t === 'alt') for (const o of n.options) walk(o);
    }
  };
  walk(parseTemplate(template));
  return out;
}
