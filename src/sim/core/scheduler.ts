/**
 * ACTION SCHEDULER — commitment, sub-tick contact timing and interrupts.
 *
 * The old engine gave every action an integer number of ticks and resolved it
 * on a fixed tick offset. That made a jab and a head kick differ only by a
 * couple of ticks and made simultaneous exchanges resolve in fighter-id order,
 * which is not how trades work.
 *
 * Here a technique carries real millisecond timings, and a commitment made in
 * phase P3 of tick k schedules a contact at an absolute millisecond:
 *
 *     o        = (decisionOffsetMs + jitter) mod 100      jitter ~ U{0..99}
 *     T_commit = k*100 + o
 *     T_c      = T_commit + technique.contactMs
 *     tick_c   = floor(T_c / 100)      subMs = T_c mod 100
 *
 * Contacts resolve in `(subMs, actorId, seq)` order, so two fighters who commit
 * in the same tick land in the order their punches actually arrive, and both
 * can land — which is what produces trades and double knockdowns.
 *
 * Every value is an integer millisecond. There is no floating-point comparison
 * anywhere in the ordering, so the queue order is identical on every machine.
 *
 * See docs/design/09 §2.2–2.4.
 */

export type ContactKind = 'strike' | 'grapple' | 'submission' | 'movement' | 'defence';

export interface ScheduledContact {
  /** Absolute contact time, integer milliseconds from the opening horn. */
  tMs: number;
  tick: number;
  /** Intra-tick offset in [0, 100). Part of the ordering contract. */
  subMs: number;
  actorId: number;
  targetId: number;
  kind: ContactKind;
  /** Technique / edge / submission id, depending on `kind`. */
  what: string;
  /** Monotonic per-bout counter; keeps one actor's contacts in commit order. */
  seq: number;
  /** When the commitment was made, for interrupt checks and phase reporting. */
  commitMs: number;
  /** Total committed duration, so the fighter is busy until commitMs + totalMs. */
  totalMs: number;
  /** Opaque payload the resolving module interprets. */
  payload?: unknown;
  /** Set when an interrupt or a failed precondition cancelled this contact. */
  cancelled?: boolean;
  cancelReason?: string;
}

/**
 * A binary min-heap over `(tMs, subMs, actorId, seq)`. A sorted array would be
 * simpler but a bout enqueues tens of thousands of contacts; the heap keeps the
 * hot path O(log n) without changing any ordering.
 */
export class ContactQueue {
  private heap: ScheduledContact[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(c: ScheduledContact): void {
    this.heap.push(c);
    this.up(this.heap.length - 1);
  }

  /** The earliest contact, or null. Does not remove it. */
  peek(): ScheduledContact | null {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  pop(): ScheduledContact | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.down(0);
    }
    return top;
  }

  /** Pop every contact due strictly before `limitMs`, in resolution order. */
  popDue(limitMs: number): ScheduledContact[] {
    const out: ScheduledContact[] = [];
    while (this.heap.length > 0 && this.heap[0].tMs < limitMs) {
      out.push(this.pop()!);
    }
    return out;
  }

  /** Mark an actor's pending contacts cancelled (an interrupt, a knockdown). */
  cancelFor(actorId: number, reason: string): number {
    let n = 0;
    for (const c of this.heap) {
      if (c.actorId === actorId && !c.cancelled) {
        c.cancelled = true;
        c.cancelReason = reason;
        n++;
      }
    }
    return n;
  }

  /** Pending, uncancelled contact for an actor, if any. */
  pendingFor(actorId: number): ScheduledContact | null {
    let best: ScheduledContact | null = null;
    for (const c of this.heap) {
      if (c.actorId !== actorId || c.cancelled) continue;
      if (best === null || compare(c, best) < 0) best = c;
    }
    return best;
  }

  clear(): void {
    this.heap.length = 0;
  }

  private up(i: number): void {
    const item = this.heap[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (compare(item, this.heap[p]) >= 0) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = item;
  }

  private down(i: number): void {
    const n = this.heap.length;
    const item = this.heap[i];
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && compare(this.heap[r], this.heap[l]) < 0 ? r : l;
      if (compare(this.heap[c], item) >= 0) break;
      this.heap[i] = this.heap[c];
      i = c;
    }
    this.heap[i] = item;
  }
}

/** The total order contacts resolve in. Ties broken by actor id, then sequence. */
export function compare(a: ScheduledContact, b: ScheduledContact): number {
  if (a.tMs !== b.tMs) return a.tMs - b.tMs;
  if (a.subMs !== b.subMs) return a.subMs - b.subMs;
  if (a.actorId !== b.actorId) return a.actorId - b.actorId;
  return a.seq - b.seq;
}

export interface CommitRequest {
  actorId: number;
  targetId: number;
  kind: ContactKind;
  what: string;
  /** Milliseconds from commitment to contact. */
  contactMs: number;
  /** Total commitment: startup + active + recovery. */
  totalMs: number;
  payload?: unknown;
}

/**
 * Schedules commitments. One instance per bout; `seq` is the per-bout counter
 * that keeps a single fighter's combination strikes in the order thrown.
 */
export class Scheduler {
  readonly queue = new ContactQueue();
  private seq = 0;

  constructor(private readonly dtMs: number) {}

  /**
   * Commit an action during tick `tick`. `jitter` must be the draw the caller
   * already took from the bout RNG (the draw is always taken, even when the
   * branch is inactive, so the stream position stays a pure function of state —
   * see docs/design/09 §2.7).
   */
  commit(req: CommitRequest, tick: number, decisionOffsetMs: number, jitter: number): ScheduledContact {
    const o = (Math.round(decisionOffsetMs) + jitter) % this.dtMs;
    const commitMs = tick * this.dtMs + o;
    const tMs = commitMs + Math.round(req.contactMs);
    const contact: ScheduledContact = {
      tMs,
      tick: Math.floor(tMs / this.dtMs),
      subMs: tMs % this.dtMs,
      actorId: req.actorId,
      targetId: req.targetId,
      kind: req.kind,
      what: req.what,
      seq: this.seq++,
      commitMs,
      totalMs: Math.round(req.totalMs),
      payload: req.payload,
    };
    this.queue.push(contact);
    return contact;
  }

  /** Contacts due within tick `tick`, in resolution order. */
  due(tick: number): ScheduledContact[] {
    return this.queue.popDue((tick + 1) * this.dtMs);
  }

  reset(): void {
    this.queue.clear();
  }

  get pendingCount(): number {
    return this.queue.size;
  }
}

/**
 * Progress through a commitment at an absolute time, for the snapshot.
 * `actionPhase` is 0-1 across the whole commitment; `actionStage` says which
 * part of it the fighter is in, which is what the animation layer blends on.
 */
export function actionProgress(
  contact: ScheduledContact, nowMs: number, startupMs: number, activeMs: number
): { phase: number; stage: 'startup' | 'contact' | 'recovery' | 'none' } {
  const elapsed = nowMs - contact.commitMs;
  if (elapsed < 0 || elapsed > contact.totalMs) return { phase: 0, stage: 'none' };
  const phase = contact.totalMs > 0 ? Math.min(1, elapsed / contact.totalMs) : 1;
  const stage =
    elapsed < startupMs ? 'startup'
      : elapsed < startupMs + activeMs ? 'contact'
        : 'recovery';
  return { phase, stage };
}
