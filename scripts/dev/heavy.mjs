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
 * Environment: HEAVY_SLOTS (default 2), HEAVY_NEED_GB (default 1.6),
 * HEAVY_HEAP_MB (default 2048), HEAVY_CAP (default 0.93).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { freemem, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';

const SLOTS = Number(process.env.HEAVY_SLOTS ?? 2);
const NEED_GB = Number(process.env.HEAVY_NEED_GB ?? 1.6);
const HEAP_MB = Number(process.env.HEAVY_HEAP_MB ?? 2048);
const CAP = Number(process.env.HEAVY_CAP ?? 0.93);
const STALE_MS = 30 * 60 * 1000;
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

function tryTakeSlot() {
  for (let i = 0; i < SLOTS; i++) {
    const dir = join(LOCK_ROOT, `slot-${i}`);
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid} ${new Date().toISOString()} ${cmd.join(' ')}`);
      return dir;
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
      } catch { /* raced with its owner releasing it */ }
    }
  }
  return null;
}

let slot = null;
let waitedMs = 0;
for (;;) {
  if (memoryAllows()) {
    slot = tryTakeSlot();
    if (slot) break;
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
    try { rmSync(slot, { recursive: true, force: true }); } catch { /* already gone */ }
    slot = null;
  }
};
process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(130); });

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${HEAP_MB}`.trim(),
};
const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code, signal) => {
  release();
  process.exit(code ?? (signal ? 1 : 0));
});
