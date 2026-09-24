// The worker path of runBout: the run request has to actually reach the
// worker. (It once built the message and never posted it, so every bout run
// from the app waited forever; the other tests all force the main thread.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBout } from '../src/app/run/runBout';
import type { SimConfig } from '../src/sim';

class FakeWorker {
  static last: FakeWorker | null = null;
  posted: Array<{ type: string; id: string }> = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: { type: string; id: string }): void {
    this.posted.push(msg);
    if (msg.type === 'run') {
      // Answer like the real worker does when a bout fails.
      queueMicrotask(() => this.onmessage?.({ data: { type: 'error', id: msg.id, message: 'stub' } } as MessageEvent));
    }
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('runBout worker path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.last = null;
  });

  it('posts the run request to the worker and settles on its reply', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const handle = runBout({} as SimConfig, { record: false });
    await expect(handle.promise).rejects.toThrow('stub');
    const w = FakeWorker.last!;
    expect(w.posted.map((m) => m.type)).toEqual(['run']);
    expect(w.terminated).toBe(true);
  });
});
