/**
 * `usePlayhead(signal, select, hz)` — subscribe a Watch panel to the playhead.
 *
 * The component re-renders only when `select()` returns a different value
 * (`Object.is`), and at most `hz` times a second; a change that arrives inside
 * the interval is delivered at its end (trailing edge), so the last value is
 * never lost when playback pauses. `select` reads the transport directly and
 * must return a primitive or a memoised object.
 */
import { useEffect, useRef, useState } from 'react';
import { Throttle, type PlayheadSignal } from '../../replay/playhead';

export function usePlayhead<T>(signal: PlayheadSignal | null, select: () => T, hz = 10): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const [value, setValue] = useState<T>(select);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!signal) return undefined;
    const throttle = new Throttle(hz);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = (): void => {
      timer = null;
      const now = performance.now();
      throttle.mark(now);
      const next = selectRef.current();
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        setValue(() => next);
      }
    };
    const onChange = (): void => {
      if (timer !== null) return;
      const now = performance.now();
      if (throttle.due(now)) push();
      else timer = setTimeout(push, throttle.wait(now));
    };
    const off = signal.subscribe(onChange);
    // The selector may already differ from the initial state (e.g. a seek
    // between render and effect).
    onChange();
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [signal, hz]);

  // A new selector (other dependencies changed) is read on the next render.
  const fresh = select();
  return Object.is(fresh, value) ? value : fresh;
}
