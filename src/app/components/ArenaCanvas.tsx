/**
 * ARENA VIEW — 2D top-down.
 *
 * Phase 8 owns the 3D presenter. The existing `src/render/ArenaRenderer` is
 * bound to the *old* engine's vocabulary — a ten-member `ActionKind` enum, a
 * fixed pair of hard-coded athletes and a fixed octagon — so adapting it to a
 * v4 `TickSnapshot` would mean inventing a lossy mapping from several hundred
 * technique ids down to ten, and would still show the wrong arena for every
 * ruleset but one. This is the documented fallback instead: a clear top-down
 * board showing positions, facings, engagement links, the fence, cage pressure
 * and strike markers, drawn from the same `TickSnapshot` the 3D presenter will
 * read.
 *
 * It is a pure function of (frame, next, alpha, window): nothing is animated
 * off a wall clock except the fade of a strike marker, which cannot change
 * what is depicted.
 */
import { useEffect, useRef } from 'react';
import type { Arena, SimEvent, TickSnapshot } from '../../sim';

export type CameraMode = 'top' | 'broadcast' | 'follow' | 'free';

export const CAMERA_MODES: readonly { id: CameraMode; label: string; hint: string }[] = [
  { id: 'broadcast', label: 'Broadcast', hint: 'Framed on the action, cuts with the fight' },
  { id: 'top', label: 'Overhead', hint: 'The whole arena, fixed' },
  { id: 'follow', label: 'Follow', hint: 'Tight on one fighter' },
  { id: 'free', label: 'Free', hint: 'Drag to pan, wheel to zoom' },
];

export interface ArenaCanvasProps {
  frame: TickSnapshot | null;
  next: TickSnapshot | null;
  alpha: number;
  arena: Arena;
  /** Events in the last second or so, for the strike markers. */
  window: readonly SimEvent[];
  camera: CameraMode;
  /** Fighter to follow in `follow` mode. */
  followId: number;
  corners: readonly string[];
  labels: readonly string[];
}

interface View {
  cx: number;
  cz: number;
  zoom: number;
}

function arenaRadius(arena: Arena): number {
  if (arena.shape === 'square') return (arena.halfWidthM ?? 5) * Math.SQRT2;
  if (arena.shape === 'unbounded') return 8;
  return arena.apothemM ?? 4.6;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

export function ArenaCanvas(props: ArenaCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View>({ cx: 0, cz: 0, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Free-camera input. Deliberately imperative: the view is a render detail,
  // not application state, and routing it through React would re-render the
  // whole screen on every mouse move.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e: WheelEvent): void => {
      if (props.camera !== 'free') return;
      e.preventDefault();
      const v = viewRef.current;
      v.zoom = Math.max(0.4, Math.min(6, v.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    const onDown = (e: PointerEvent): void => {
      if (props.camera !== 'free') return;
      dragRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d || props.camera !== 'free') return;
      const v = viewRef.current;
      const scale = (Math.min(canvas.clientWidth, canvas.clientHeight) / (2 * arenaRadius(props.arena) + 1)) * v.zoom;
      v.cx -= (e.clientX - d.x) / scale;
      v.cz += (e.clientY - d.y) / scale;
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (): void => {
      dragRef.current = null;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [props.camera, props.arena]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = props.frame;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 420;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = cssVar(canvas, '--surface', '#111820');
    const line = cssVar(canvas, '--line', '#253140');
    const faint = cssVar(canvas, '--faint', '#64768a');
    const text = cssVar(canvas, '--text', '#e6edf3');
    const accent = cssVar(canvas, '--accent', '#e0a63c');
    const cornerColours = [
      cssVar(canvas, '--corner-a', '#e2543f'),
      cssVar(canvas, '--corner-b', '#3f92d2'),
      cssVar(canvas, '--ok', '#57a97f'),
      cssVar(canvas, '--warn', '#d5a33f'),
    ];

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (!frame) return;

    // ---- camera ----------------------------------------------------------
    const R = arenaRadius(props.arena);
    const v = viewRef.current;
    let cx = 0;
    let cz = 0;
    let zoom = 1;
    const fighters = frame.fighters;
    if (props.camera === 'broadcast' && fighters.length > 0) {
      cx = fighters.reduce((s, f) => s + f.x, 0) / fighters.length;
      cz = fighters.reduce((s, f) => s + f.z, 0) / fighters.length;
      const spread = Math.max(
        1.5,
        ...fighters.map((f) => Math.hypot(f.x - cx, f.z - cz)),
      );
      zoom = Math.max(1, Math.min(2.6, R / (spread + 1.4)));
    } else if (props.camera === 'follow') {
      const f = fighters[props.followId] ?? fighters[0];
      if (f) {
        cx = f.x;
        cz = f.z;
      }
      zoom = 2.2;
    } else if (props.camera === 'free') {
      cx = v.cx;
      cz = v.cz;
      zoom = v.zoom;
    }

    const scale = (Math.min(w, h) / (2 * R + 1)) * zoom;
    const px = (x: number): number => w / 2 + (x - cx) * scale;
    const py = (z: number): number => h / 2 - (z - cz) * scale;

    // ---- arena -----------------------------------------------------------
    ctx.lineWidth = 2;
    ctx.strokeStyle = line;
    ctx.beginPath();
    if (props.arena.shape === 'polygon') {
      const n = props.arena.sides ?? 8;
      const a = props.arena.apothemM ?? 4.6;
      const circum = a / Math.cos(Math.PI / n);
      for (let k = 0; k <= n; k++) {
        const ang = Math.PI / n + (2 * Math.PI * k) / n;
        const x = circum * Math.sin(ang + Math.PI / n);
        const z = circum * Math.cos(ang + Math.PI / n);
        if (k === 0) ctx.moveTo(px(x), py(z));
        else ctx.lineTo(px(x), py(z));
      }
    } else if (props.arena.shape === 'square') {
      const hw = props.arena.halfWidthM ?? 4;
      ctx.rect(px(-hw), py(hw), 2 * hw * scale, 2 * hw * scale);
    } else if (props.arena.shape === 'circle') {
      ctx.arc(px(0), py(0), (props.arena.apothemM ?? 4.6) * scale, 0, Math.PI * 2);
    } else {
      ctx.arc(px(0), py(0), R * scale, 0, Math.PI * 2);
      ctx.setLineDash([6, 6]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // centre mark
    ctx.strokeStyle = faint;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(px(0), py(0), 0.9 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ---- engagement links -------------------------------------------------
    for (const e of frame.engagements) {
      const a = fighters[e.a];
      const b = e.b >= 0 ? fighters[e.b] : null;
      if (!a || !b) continue;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px(a.x), py(a.z));
      ctx.lineTo(px(b.x), py(b.z));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(e.node, (px(a.x) + px(b.x)) / 2, (py(a.z) + py(b.z)) / 2 - 8);
    }

    // ---- fighters ---------------------------------------------------------
    const nextFrame = props.next;
    fighters.forEach((f, i) => {
      const nf = nextFrame?.fighters[i];
      const t = nf ? Math.max(0, Math.min(1, props.alpha)) : 0;
      const x = nf ? lerp(f.x, nf.x, t) : f.x;
      const z = nf ? lerp(f.z, nf.z, t) : f.z;
      const facing = nf ? angleLerp(f.facing, nf.facing, t) : f.facing;
      const colour = cornerColours[Math.min(f.team, cornerColours.length - 1)];
      const r = 0.33 * scale;

      // cage pressure
      if (f.againstFence) {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(x), py(z), r * 1.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // body, dimmed by accumulated head damage
      ctx.fillStyle = colour;
      ctx.globalAlpha = f.posture === 'out' ? 0.25 : 1 - Math.min(0.5, f.damage.head * 0.5);
      ctx.beginPath();
      ctx.arc(px(x), py(z), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // down / out ring
      if (f.posture === 'down' || f.posture === 'out' || f.posture === 'ground') {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(x), py(z), r * 1.35, 0, Math.PI * 2);
        ctx.stroke();
      }

      // facing
      ctx.strokeStyle = text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px(x), py(z));
      ctx.lineTo(px(x + Math.sin(facing) * 0.75), py(z + Math.cos(facing) * 0.75));
      ctx.stroke();

      // stamina arc
      const stam = Math.max(0, Math.min(1, f.stamina.total));
      ctx.strokeStyle = stam < 0.35 ? cssVar(canvas, '--alert', '#cf5a4e') : cssVar(canvas, '--ok', '#57a97f');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px(x), py(z), r * 1.9, -Math.PI / 2, -Math.PI / 2 + stam * Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = text;
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(props.labels[i] ?? `F${i}`, px(x), py(z) - r * 2.3);
    });

    // ---- strike markers ---------------------------------------------------
    for (const e of props.window) {
      if (e.kind !== 'strike') continue;
      const d = (e as { detail: { result?: string } }).detail;
      const target = fighters[e.target];
      if (!target) continue;
      const age = Math.max(0, frame.tick - e.tick);
      const fade = Math.max(0, 1 - age / 12);
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      ctx.lineWidth = 2;
      ctx.strokeStyle = d.result === 'landed'
        ? cssVar(canvas, '--alert', '#cf5a4e')
        : faint;
      ctx.beginPath();
      ctx.arc(px(target.x), py(target.z), 0.35 * scale + (1 - fade) * 0.7 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- caption -----------------------------------------------------------
    ctx.fillStyle = faint;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${props.arena.name} · top-down · camera: ${props.camera}`,
      10,
      h - 10,
    );
  }, [props.frame, props.next, props.alpha, props.arena, props.window, props.camera,
    props.followId, props.labels, props.corners]);

  return (
    <div className="watch-stage">
      <canvas
        ref={canvasRef}
        className="watch-canvas"
        role="img"
        aria-label="Top-down view of the bout"
        data-camera={props.camera}
      />
    </div>
  );
}
