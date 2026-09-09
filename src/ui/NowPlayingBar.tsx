import { useEffect, useState } from "react";
import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  FastForwardIcon,
  ListIcon,
  ListMusicIcon,
  Music2Icon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
  Repeat2Icon,
  RewindIcon,
  ShuffleIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RuntimePlaybackMode } from "@/runtime/protocol";
import {
  formatTime,
  PLAYBACK_MODE_LABELS,
  PLAYBACK_MODE_ORDER,
  singleSliderValue,
} from "@/ui/playerDisplay";

interface NowPlayingBarProps {
  trackName?: string;
  playing: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  masterDb: number;
  playbackMode: RuntimePlaybackMode;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onMasterDbChange: (db: number) => void;
  onPlaybackModeChange: (mode: RuntimePlaybackMode) => void;
  onOpenQueue: () => void;
}

function PlaybackModeIcon({ mode }: { mode: RuntimePlaybackMode }) {
  if (mode === "REPEAT_ONE") return <Repeat1Icon />;
  if (mode === "REPEAT_ALL") return <Repeat2Icon />;
  if (mode === "SHUFFLE") return <ShuffleIcon />;
  return <ListIcon />;
}

/**
 * 固定在 Action 底部的媒体 transport bar。
 *
 * 它只是一层“遥控器”：真正的 HTMLAudioElement 始终在 Owlbear background iframe。
 * 这点非常重要——如果直接塞一个现成 React AudioPlayer 组件，它会自己创建 <audio>
 * 并成为第二个播放引擎，Action 一关闭音乐也会被销毁，反而破坏我们的同步架构。
 * 因此这里复用成熟播放器的信息架构，同时用 shadcn Button/Slider/Tooltip 组合控件。
 */
export function NowPlayingBar({
  trackName,
  playing,
  paused,
  currentTime,
  duration,
  masterDb,
  playbackMode,
  canGoPrevious,
  canGoNext,
  onTogglePlayback,
  onPrevious,
  onNext,
  onSeek,
  onMasterDbChange,
  onPlaybackModeChange,
  onOpenQueue,
}: NowPlayingBarProps) {
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [volumePreview, setVolumePreview] = useState<number | null>(null);
  const shownTime = scrubTime ?? currentTime;
  const shownVolume = volumePreview ?? masterDb;
  const hasTrack = Boolean(trackName);

  useEffect(() => {
    // GM 切歌后旧的拖动预览不能残留到新曲目。
    setScrubTime(null);
  }, [trackName]);

  function cyclePlaybackMode() {
    const currentIndex = PLAYBACK_MODE_ORDER.indexOf(playbackMode);
    const nextMode = PLAYBACK_MODE_ORDER[(currentIndex + 1) % PLAYBACK_MODE_ORDER.length];
    onPlaybackModeChange(nextMode);
  }

  function skipBy(deltaSeconds: number) {
    if (!hasTrack) return;
    const max = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    onSeek(Math.max(0, Math.min(max, currentTime + deltaSeconds)));
  }

  return (
    <section className="border-t bg-background/95 px-3 py-3 supports-backdrop-filter:backdrop-blur-md">
      <div className="flex flex-col gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Music2Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{trackName ?? "暂无正在播放的音频"}</p>
            <p className="text-xs text-muted-foreground">
              {hasTrack ? (paused ? "已暂停" : playing ? "正在同步到房间" : "已停止") : "从音乐库选择一首开始"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Slider
            aria-label="播放进度"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={Math.min(Math.max(0, shownTime), Math.max(1, duration))}
            disabled={!hasTrack || duration <= 0}
            onValueChange={(value) => setScrubTime(singleSliderValue(value))}
            onValueCommitted={(value) => {
              setScrubTime(null);
              onSeek(singleSliderValue(value));
            }}
          />
          <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatTime(shownTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={shownVolume <= -48 ? "取消静音" : "静音"}
                    onClick={() => onMasterDbChange(shownVolume <= -48 ? 0 : -48)}
                  />
                }
              >
                {shownVolume <= -48 ? <VolumeXIcon /> : <Volume2Icon />}
              </TooltipTrigger>
              <TooltipContent>{shownVolume <= -48 ? "取消静音" : "静音"}</TooltipContent>
            </Tooltip>
            <Slider
              aria-label="本机音量"
              min={-48}
              max={0}
              step={1}
              value={shownVolume}
              className="max-w-20"
              onValueChange={(value) => setVolumePreview(singleSliderValue(value))}
              onValueCommitted={(value) => {
                setVolumePreview(null);
                onMasterDbChange(singleSliderValue(value));
              }}
            />
          </div>

          <div className="flex items-center justify-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" disabled={!hasTrack} aria-label="后退 15 秒" onClick={() => skipBy(-15)} />
                }
              >
                <RewindIcon />
              </TooltipTrigger>
              <TooltipContent>后退 15 秒</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" disabled={!canGoPrevious} aria-label="上一首" onClick={onPrevious} />
                }
              >
                <ChevronsLeftIcon />
              </TooltipTrigger>
              <TooltipContent>上一首</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-lg"
                    className="mx-1 size-11 rounded-full"
                    disabled={!hasTrack}
                    aria-label={paused ? "继续播放" : "暂停"}
                    onClick={onTogglePlayback}
                  />
                }
              >
                {paused || !playing ? <PlayIcon className="size-5" /> : <PauseIcon className="size-5" />}
              </TooltipTrigger>
              <TooltipContent>{paused ? "继续播放" : "暂停"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" disabled={!canGoNext} aria-label="下一首" onClick={onNext} />
                }
              >
                <ChevronsRightIcon />
              </TooltipTrigger>
              <TooltipContent>下一首</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" disabled={!hasTrack} aria-label="前进 15 秒" onClick={() => skipBy(15)} />
                }
              >
                <FastForwardIcon />
              </TooltipTrigger>
              <TooltipContent>前进 15 秒</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center justify-end gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="播放队列" onClick={onOpenQueue} />}
              >
                <ListMusicIcon />
              </TooltipTrigger>
              <TooltipContent>播放队列</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={playbackMode === "SEQUENTIAL" ? "ghost" : "secondary"}
                    size="icon-sm"
                    aria-label={PLAYBACK_MODE_LABELS[playbackMode]}
                    onClick={cyclePlaybackMode}
                  />
                }
              >
                <PlaybackModeIcon mode={playbackMode} />
              </TooltipTrigger>
              <TooltipContent>{PLAYBACK_MODE_LABELS[playbackMode]} · 点击切换</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </section>
  );
}
