/**
 * BROADCAST OVERLAY — the on-screen graphics package over the 3D picture.
 *
 * Mount it as the last child of the element that holds the canvas (that
 * element must be `position: relative`); it fills it, ignores pointer input,
 * and scales every graphic to the picture's height.
 *
 *   <div className="stage" style={{ position: 'relative' }}>
 *     <canvas … />
 *     <BroadcastOverlay
 *       bout={broadcastBout}            // makeBroadcastBout(…) once per bout
 *       frame={player.current}          // the frame on screen
 *       events={bout.run.events}        // the whole recorded stream
 *       replay={sequencer.state}        // ReplaySequencer state, or null
 *       replayWipeKey={sequencer.wipeKey}
 *       shot={presenter.shot()}         // CameraState, for the optional shot label
 *     />
 *   </div>
 *
 * Everything shown is a function of those props (model.ts), so a seek or a
 * replay shows exactly what a live viewer saw at that moment.
 */
import { useMemo, useRef } from 'react';
import type { SimEvent, TickSnapshot } from '../../../sim';
import { type BroadcastBout, broadcastScene } from './model';
import {
  ClockBug, FinishCard, KnockdownFlash, ReplayBug, ReplayWipe, RoundCard, RoundStatsPanel, ScorecardReveal,
  ShotLabel, TaleOfTheTape,
} from './parts';
import './broadcast.css';

/** Structural slice of the camera's `ReplayState` the graphics read. */
export interface OverlayReplay {
  plan: { id: string; title: string; segments: readonly unknown[] };
  segmentIndex: number;
}

export interface BroadcastOverlayProps {
  bout: BroadcastBout;
  frame: TickSnapshot | null;
  events: readonly SimEvent[];
  /** The instant replay on air (ReplaySequencer.state), or null for live. */
  replay?: OverlayReplay | null;
  /** ReplaySequencer.wipeKey: every change plays the replay stinger. */
  replayWipeKey?: number;
  /** The camera state (Presenter3D.shot()); drives the optional shot label. */
  shot?: { shotName: string; cut: boolean } | null;
  /** Significant-strike counter in the clock bug (default on). */
  showSigStrikes?: boolean;
  /** Small label naming the camera after each cut (default off). */
  showShotLabel?: boolean;
  /** Tale of the tape on the opening frame (default on). */
  taleOfTheTape?: boolean;
  /** Hide everything (a "clean feed"). */
  hidden?: boolean;
}

export function BroadcastOverlay(props: BroadcastOverlayProps): JSX.Element | null {
  const { bout, frame, events } = props;
  const replay = props.replay ?? null;
  const scene = useMemo(
    () => broadcastScene(bout, frame, events, { replay: !!replay, taleOfTheTape: props.taleOfTheTape }),
    [bout, frame, events, replay, props.taleOfTheTape],
  );

  // A counter that moves on every cut, so the shot label re-animates.
  const cuts = useRef({ n: 0, name: '' });
  if (props.shot && (props.shot.cut || props.shot.shotName !== cuts.current.name)) {
    cuts.current = { n: cuts.current.n + 1, name: props.shot.shotName };
  }

  if (props.hidden) return null;
  const wipeKey = props.replayWipeKey ?? 0;

  return (
    <div className="bo-root" aria-live="polite">
      <div className="bo-frame">
        {scene.tape ? <TaleOfTheTape bout={bout} /> : null}
        {scene.roundCard ? (
          <RoundCard key={`r${scene.roundCard.key}`} bout={bout} round={scene.roundCard.round} rounds={scene.roundCard.rounds} />
        ) : null}
        {scene.roundStats ? <RoundStatsPanel key={scene.roundStats.title} bout={bout} model={scene.roundStats} /> : null}
        {scene.knockdown ? <KnockdownFlash key={`kd${scene.knockdown.tick}`} bout={bout} model={scene.knockdown} /> : null}
        {scene.clock ? (
          <ClockBug bout={bout} model={scene.clock} showSigStrikes={props.showSigStrikes !== false} />
        ) : null}
        {scene.finish ? <FinishCard bout={bout} model={scene.finish} /> : null}
        {scene.scorecards ? <ScorecardReveal bout={bout} model={scene.scorecards} /> : null}
        {replay ? (
          <ReplayBug
            key={replay.plan.id}
            title={replay.plan.title}
            angle={replay.segmentIndex + 1}
            angles={replay.plan.segments.length}
          />
        ) : null}
        {props.showShotLabel && props.shot && !replay ? (
          <ShotLabel key={`s${cuts.current.n}`} name={props.shot.shotName} />
        ) : null}
        {wipeKey > 0 ? <ReplayWipe key={`w${wipeKey}`} /> : null}
      </div>
    </div>
  );
}
