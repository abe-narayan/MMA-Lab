/**
 * TRANSPORT AND SELECTION BAR
 *
 * Scrubber on top, then three labelled groups - which bout, how it plays, and
 * how it is filmed. Every control is a real labelled form control; the keyboard
 * shortcuts that duplicate them are printed underneath rather than hidden in a
 * help dialog.
 */

import { useEffect, useState } from 'react';
import type { CameraMode } from '../render';

/** Formats offered in the UI: one athlete against 1 to 5 opponents. */
export const FORMATS = [1, 2, 3, 4, 5];
/** Bouts are numbered 1..1000 per format. */
export const BOUT_COUNT = 1000;
/** Playback rates, relative to simulated time. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

/** m:ss from seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ControlsProps {
  opponents: number;
  boutIndex: number;
  boutCount: number;
  playing: boolean;
  frame: number;
  totalFrames: number;
  seconds: number;
  durationSeconds: number;
  speed: number;
  camera: CameraMode;
  followId: number;
  labels: string[];
  teams: ('A' | 'B')[];
  disabled: boolean;
  onChangeOpponents(n: number): void;
  onChangeBout(n: number): void;
  onRandomBout(): void;
  onToggle(): void;
  onRestart(): void;
  onStep(n: number): void;
  onSeek(frame: number): void;
  onChangeSpeed(s: number): void;
  onChangeCamera(mode: CameraMode): void;
  onResetCamera(): void;
  onChangeFollow(id: number): void;
}

const CAMERAS: { id: CameraMode; label: string; hint: string }[] = [
  { id: 'orbit', label: 'Orbit', hint: 'Free camera - drag inside the cage to orbit' },
  { id: 'top', label: 'Top', hint: 'Overhead view of cage positioning' },
  { id: 'side', label: 'Side', hint: 'Cage-side broadcast angle' },
  { id: 'follow', label: 'Follow', hint: 'Track one fighter' },
];

export function Controls(props: ControlsProps) {
  const {
    opponents, boutIndex, boutCount, playing, frame, totalFrames, seconds, durationSeconds,
    speed, camera, followId, labels, teams, disabled,
  } = props;

  // The bout field is edited as text so that clearing it mid-type does not
  // snap the value back to 1 on every keystroke.
  const [boutText, setBoutText] = useState(String(boutIndex));
  useEffect(() => setBoutText(String(boutIndex)), [boutIndex]);

  const commitBout = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      setBoutText(String(boutIndex));
      return;
    }
    const clamped = Math.min(boutCount, Math.max(1, n));
    setBoutText(String(clamped));
    if (clamped !== boutIndex) props.onChangeBout(clamped);
  };

  const maxFrame = Math.max(0, totalFrames - 1);

  return (
    <section className="controls" aria-label="Playback controls">
      <div className="scrub-row">
        <label className="visually-hidden" htmlFor="scrub">
          Timeline position, frame {frame + 1} of {totalFrames}
        </label>
        <input
          id="scrub"
          className="scrub"
          type="range"
          min={0}
          max={maxFrame}
          step={1}
          value={Math.min(frame, maxFrame)}
          disabled={disabled}
          aria-valuetext={`${clock(seconds)} of ${clock(durationSeconds)}`}
          onChange={(e) => props.onSeek(Number(e.target.value))}
        />
        <span className="frame-read">
          <b>{clock(seconds)}</b> / {clock(durationSeconds)}
          <span aria-hidden="true"> &middot; </span>
          frame <b>{totalFrames ? frame + 1 : 0}</b>/{totalFrames}
        </span>
      </div>

      <div className="ctl-rows">
        <div className="group">
          <span className="group-label" id="grp-format">Format</span>
          <div className="group-row seg" role="group" aria-labelledby="grp-format">
            {FORMATS.map((n) => (
              <button
                key={n}
                type="button"
                className="btn"
                aria-pressed={opponents === n}
                aria-label={`One against ${n} opponent${n === 1 ? '' : 's'}`}
                onClick={() => props.onChangeOpponents(n)}
              >
                1v{n}
              </button>
            ))}
          </div>
        </div>

        <div className="group">
          <label className="group-label" htmlFor="bout-number">Bout</label>
          <div className="group-row">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Previous bout"
              disabled={boutIndex <= 1}
              onClick={() => props.onChangeBout(boutIndex - 1)}
            >
              &minus;
            </button>
            <input
              id="bout-number"
              className="field"
              type="number"
              min={1}
              max={boutCount}
              step={1}
              value={boutText}
              aria-label={`Bout number, 1 to ${boutCount}`}
              onChange={(e) => setBoutText(e.target.value)}
              onBlur={(e) => commitBout(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitBout((e.target as HTMLInputElement).value);
              }}
            />
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Next bout"
              disabled={boutIndex >= boutCount}
              onClick={() => props.onChangeBout(boutIndex + 1)}
            >
              +
            </button>
            <button type="button" className="btn" onClick={props.onRandomBout}>
              Random
            </button>
          </div>
        </div>

        <div className="group">
          <span className="group-label" id="grp-transport">Transport</span>
          <div className="group-row" role="group" aria-labelledby="grp-transport">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Restart from the opening horn (R)"
              title="Restart (R)"
              disabled={disabled}
              onClick={props.onRestart}
            >
              &#8634;
            </button>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Step back one frame (left arrow)"
              title="Step back one tick (left arrow)"
              disabled={disabled}
              onClick={() => props.onStep(-1)}
            >
              &#9664;
            </button>
            <button
              type="button"
              className="btn btn--play"
              aria-label={playing ? 'Pause (space)' : 'Play (space)'}
              title={playing ? 'Pause (space)' : 'Play (space)'}
              disabled={disabled}
              onClick={props.onToggle}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Step forward one frame (right arrow)"
              title="Step forward one tick (right arrow)"
              disabled={disabled}
              onClick={() => props.onStep(1)}
            >
              &#9654;
            </button>
          </div>
        </div>

        <div className="group">
          <label className="group-label" htmlFor="speed">Speed</label>
          <div className="group-row">
            <select
              id="speed"
              className="field"
              value={speed}
              disabled={disabled}
              onChange={(e) => props.onChangeSpeed(Number(e.target.value))}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="group">
          <span className="group-label" id="grp-camera">Camera</span>
          <div className="group-row" role="group" aria-labelledby="grp-camera">
            <div className="seg">
              {CAMERAS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn"
                  title={c.hint}
                  aria-pressed={camera === c.id}
                  aria-label={`${c.label} camera`}
                  onClick={() => props.onChangeCamera(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              aria-label="Reset the camera to its default position"
              onClick={props.onResetCamera}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="group">
          <label className="group-label" htmlFor="follow">Follow</label>
          <div className="group-row">
            <select
              id="follow"
              className="field"
              value={followId}
              disabled={disabled || labels.length === 0}
              onChange={(e) => props.onChangeFollow(Number(e.target.value))}
            >
              {labels.map((label, i) => (
                <option key={label + i} value={i}>
                  {label} &middot; {teams[i] === 'A' ? 'red corner' : 'blue corner'}
                </option>
              ))}
              {labels.length === 0 ? <option value={0}>&mdash;</option> : null}
            </select>
          </div>
        </div>
      </div>

      <p className="keyhints">
        <span><kbd>Space</kbd> play / pause</span>
        <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> step one tick (0.1 s)</span>
        <span><kbd>Shift</kbd> + <kbd>&larr;</kbd><kbd>&rarr;</kbd> step ten</span>
        <span><kbd>R</kbd> restart</span>
        <span>Drag inside the cage to orbit.</span>
      </p>
    </section>
  );
}
