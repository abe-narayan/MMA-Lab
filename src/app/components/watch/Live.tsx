/**
 * The two self-updating picture layers of the Watch screen:
 *
 *  - `LiveOverlay`: the broadcast graphics over the 3D picture (clock bug,
 *    round cards, knockdown flash, REPLAY bug...), refreshed from the playhead
 *    at 10 Hz — what a viewer can read — instead of with the whole screen.
 *  - `Board2D`: the 2D board, which interpolates between ticks and so needs
 *    the sub-tick alpha every display frame; only this component re-renders
 *    at display rate, never the screen around it.
 */
import { memo, useMemo } from 'react';
import { eventWindow, type Arena } from '../../../sim';
import type { BoutPlayer } from '../../replay/player';
import type { PlayheadSignal } from '../../replay/playhead';
import type { ReplaySequencer } from '../../../presentation/camera';
import { BroadcastOverlay, type BroadcastBout } from '../broadcast';
import { ArenaCanvas, type CameraMode } from '../ArenaCanvas';
import type { WatchBout } from '../../replay/bout';
import { replayKey } from '../../replay/broadcast';
import { usePlayhead } from './usePlayhead';

export interface LiveOverlayProps {
  player: BoutPlayer;
  signal: PlayheadSignal;
  sequencer: ReplaySequencer | null;
  bout: BroadcastBout;
  events: WatchBout['run']['events'];
  shot: { shotName: string; cut: boolean } | null;
}

function LiveOverlayInner(props: LiveOverlayProps): JSX.Element {
  const { player, signal, sequencer } = props;
  const key = usePlayhead(signal, () => `${player.frame}|${replayKey(sequencer?.state)}|${sequencer?.wipeKey ?? 0}`, 10);
  const frame = player.current;
  const replay = sequencer?.state ?? null;
  // `key` is what changed; the objects below are read fresh from the transport.
  void key;
  return (
    <BroadcastOverlay
      bout={props.bout}
      frame={frame}
      events={props.events}
      replay={replay}
      replayWipeKey={sequencer?.wipeKey ?? 0}
      shot={props.shot}
    />
  );
}

export const LiveOverlay = memo(LiveOverlayInner);

export interface Board2DProps {
  player: BoutPlayer;
  signal: PlayheadSignal;
  bout: WatchBout;
  arena: Arena;
  camera: CameraMode;
  followId: number;
  corners: readonly string[];
  labels: readonly string[];
}

function Board2DInner(props: Board2DProps): JSX.Element {
  const { player, signal, bout } = props;
  // Frame plus sub-tick alpha: changes every display frame while playing.
  const pos = usePlayhead(signal, () => player.frame + player.alpha, Infinity);
  const frame = player.current;
  const tick = frame?.tick ?? 0;
  const window = useMemo(() => eventWindow(bout.run.events, tick - 12, tick).events, [bout, tick]);
  return (
    <ArenaCanvas
      frame={frame}
      next={player.next}
      alpha={pos - Math.floor(pos)}
      arena={props.arena}
      window={window}
      camera={props.camera}
      followId={props.followId}
      corners={props.corners}
      labels={props.labels}
    />
  );
}

export const Board2D = memo(Board2DInner);
