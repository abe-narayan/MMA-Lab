#!/usr/bin/env node
/**
 * Resource governor for heavy local commands (typecheck, test runs, builds,
 * asset processing, headless render batches).
 *
 *   node scripts/dev/heavy.mjs npx tsc --noEmit
 *   node scripts/dev/heavy.mjs npx vitest run tests/foo.test.ts
 *
 * Why this exists: the development machine is a 16 GB laptop that normally
 * sits at ~80 % memory use with its usual desktop load, and the project rule is
 * that combined CPU and RAM stay at or below 93 %. Several agents working in
 * parallel each running `tsc` (~1.5 GB) or a test suite would breach that
 * without coordination. This wrapper:
 *
 *   1. takes one of `SLOTS` semaphore slots (atomic `mkdir` locks), so at most
 *      that many heavy jobs run at once across every process on the machine;
 *   2. waits until free memory would stay above the cap after the job starts
 *      (`need` GB, default 1.6), re-checking every few seconds;
 *   3. bounds the child's V8 heap so one job cannot eat the headroom;
 *   4. releases the slot however the child exits, and reclaims slots left by a
 *      crashed holder after `STALE_MS`.
 *
 * CPU: the cap covers CPU as well as memory, and the jobs that spike it
 * (headless Chromium compiling shaders, esbuild, tsc) are multi-threaded. So
 * the wrapper also
 *   5. waits until machine-wide CPU use is below `CPU_START` before starting;
 *   6. on Windows, confines itself to `AFFINITY` cores (default 6 of 8, mask
 *      0x3F) at below-normal priority before spawning; both are inherited by
 *      every child process (Chromium's GPU and renderer processes included),
 *      so one heavy job can never take more than 75 % of the CPU, and the
 *      desktop keeps two cores even while two jobs run.
 *
 * Environment: HEAVY_SLOTS (default 3; the memory and CPU gates, not the slot
 * count, are what hold the 93 % cap), HEAVY_NEED_GB (default 1.6),
 * HEAVY_HEAP_MB (default 2048), HEAVY_CAP (default 0.93),
 * HEAVY_CPU_START (default 0.70), HEAVY_AFFINITY (hex mask, default 3F).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, cpus, freemem, setPriority, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';

const SLOTS = Number(process.env.HEAVY_SLOTS ?? 3);
const NEED_GB = Number(process.env.HEAVY_NEED_GB ?? 1.6);
const HEAP_MB = Number(process.env.HEAVY_HEAP_MB ?? 2048);
const CAP = Number(process.env.HEAVY_CAP ?? 0.93);
const CPU_START = Number(process.env.HEAVY_CPU_START ?? 0.70);
const AFFINITY = process.env.HEAVY_AFFINITY ?? '3F';
// A slot whose owner process is gone is reclaimed at once; a live owner keeps
// its slot however long its job runs (up to a 12 h safety net).
const STALE_MS = 12 * 60 * 60 * 1000;
const GATE_STALE_MS = 60 * 1000;
// After starting a job, hold the start gate this long so the job's memory shows
// up in freemem() before the next waiter checks it.
const GATE_HOLD_MS = 8000;
const POLL_MS = 3000;
const LOCK_ROOT = join(tmpdir(), 'boutlab-heavy-locks');

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  console.error('usage: node scripts/dev/heavy.mjs <command> [args...]');
  process.exit(2);
}

mkdirSync(LOCK_ROOT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function memoryAllows() {
  const total = totalmem();
  const free = freemem();
  const afterStart = free - NEED_GB * 1024 ** 3;
  return afterStart >= total * (1 - CAP);
}

/** Machine-wide CPU busy fraction over a short window, from os.cpus() tick deltas. */
async function cpuBusy(windowMs = 1200) {
  const snap = () => cpus().map((c) => c.times);
  const a = snap();
  await sleep(windowMs);
  const b = snap();
  let idle = 0, total = 0;
  for (let i = 0; i < a.length; i++) {
    const da = Object.values(a[i]).reduce((x, y) => x + y, 0);
    const db = Object.values(b[i]).reduce((x, y) => x + y, 0);
    total += db - da;
    idle += b[i].idle - a[i].idle;
  }
  return total > 0 ? 1 - idle / total : 0;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function ownerPid(dir) {
  try { return Number(readFileSync(join(dir, 'owner'), 'utf8').split(' ')[0]); } catch { return NaN; }
}

/** Remove a lock dir whose owner process is dead, or that is older than `maxAgeMs`. */
function reapIfStale(dir, maxAgeMs) {
  try {
    const age = Date.now() - statSync(dir).mtimeMs;
    const pid = ownerPid(dir);
    // A dir without an owner file is being created right now; give it a moment.
    const dead = Number.isNaN(pid) ? age > 10000 : !pidAlive(pid);
    if (dead || age > maxAgeMs) rmSync(dir, { recursive: true, force: true });
  } catch { /* raced with its owner releasing it */ }
}

function takeLock(dir) {
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, 'owner'), `${process.pid} ${new Date().toISOString()} ${cmd.join(' ')}`);
    return true;
  } catch {
    return false;
  }
}

/** Remove a lock only while this process owns it (a reaped-and-retaken lock is someone else's). */
function releaseLock(dir) {
  if (ownerPid(dir) === process.pid) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}

function tryTakeSlot() {
  for (let i = 0; i < SLOTS; i++) {
    const dir = join(LOCK_ROOT, `slot-${i}`);
    if (takeLock(dir)) return dir;
    reapIfStale(dir, STALE_MS);
  }
  return null;
}

// The resource checks and the start happen under a machine-wide start gate,
// held for GATE_HOLD_MS after the start, so two waiters can't both pass the
// memory check on the same free memory.
const GATE = join(LOCK_ROOT, 'start-gate');
let slot = null;
let waitedMs = 0;
for (;;) {
  if (takeLock(GATE)) {
    if (memoryAllows() && (await cpuBusy()) < CPU_START) slot = tryTakeSlot();
    if (slot) break;
    releaseLock(GATE);
  } else {
    reapIfStale(GATE, GATE_STALE_MS);
  }
  if (waitedMs % 30000 === 0) {
    const pct = (100 * (1 - freemem() / totalmem())).toFixed(0);
    console.error(`[heavy] waiting (RAM ${pct}% used, slots busy or memory short) for: ${cmd.join(' ')}`);
  }
  await sleep(POLL_MS);
  waitedMs += POLL_MS;
}

const release = () => {
  if (slot) {
    releaseLock(slot);
    slot = null;
  }
  releaseLock(GATE);
};
process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(130); });

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${HEAP_MB}`.trim(),
};
// Confine THIS process before spawning: Windows children inherit the parent's
// CPU affinity mask, and a below-normal parent's priority class, so the whole
// job tree (shell, npx, node, Chromium's GPU and renderer processes) runs on
// `AFFINITY` cores at below-normal priority. The job itself is spawned exactly
// as before, so its exit code reaches the caller unchanged. (A `start /affinity`
// wrapper was tried and rejected: `start /wait` swallows the exit code, which
// would make a failing typecheck look green.)
if (process.platform === 'win32') {
  try {
    setPriority(process.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process -Id ${process.pid}).ProcessorAffinity = 0x${AFFINITY}`], { stdio: 'ignore' });
  } catch { /* best effort: the memory and slot gates still apply */ }
}
// Windows needs a shell to run .cmd shims (npx, npm). Quote each argument so
// spaces don't split it and cmd.exe metacharacters (& | < > ^) stay literal.
const winQuote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
const child = process.platform === 'win32'
  ? spawn(cmd.map(winQuote).join(' '), { stdio: 'inherit', env, shell: true })
  : spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env });
setTimeout(() => releaseLock(GATE), GATE_HOLD_MS).unref();
child.on('exit', (code, signal) => {
  release();
  process.exit(code ?? (signal ? 1 : 0));
});
