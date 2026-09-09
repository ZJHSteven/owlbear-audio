import {
  ChevronsRightIcon,
  ListPlusIcon,
  MoreHorizontalIcon,
  Music2Icon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SimpleLibraryTrack } from "@/library/simpleLibrary";
import { CATEGORY_LABELS, formatTime } from "@/ui/playerDisplay";

interface TrackListProps {
  tracks: SimpleLibraryTrack[];
  currentCueId?: string;
  busy: boolean;
  onPlayNow: (track: SimpleLibraryTrack) => void;
  onPlayNext: (track: SimpleLibraryTrack) => void;
  onAddToQueue: (track: SimpleLibraryTrack) => void;
  onRemove: (track: SimpleLibraryTrack) => void;
}

/**
 * Spotify/媒体库范式的紧凑曲目列表。
 *
 * 每一行只长期保留“封面占位 + 名称 + 次要信息 + 更多”；立即播放/下一首/加入队列
 * 在鼠标悬停或键盘聚焦时出现，避免旧版把每个动作都铺成一个大按钮导致视觉噪声。
 * 所有图标均来自 Lucide，不手绘 SVG；文字解释放在 Tooltip。
 */
export function TrackList({
  tracks,
  currentCueId,
  busy,
  onPlayNow,
  onPlayNext,
  onAddToQueue,
  onRemove,
}: TrackListProps) {
  return (
    <ItemGroup className="gap-1">
      {tracks.map((track) => {
        const isCurrent = currentCueId === track.id;
        return (
          <Item
            key={track.id}
            size="sm"
            variant={isCurrent ? "muted" : "default"}
            className="group/track flex-nowrap px-2 py-2 hover:bg-muted/60"
          >
            <ItemMedia
              variant="image"
              className="relative flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
              <Music2Icon />
              <Button
                variant="secondary"
                size="icon-sm"
                disabled={busy}
                className="absolute inset-0 m-auto opacity-0 shadow-sm transition-opacity group-hover/track:opacity-100 group-focus-within/track:opacity-100"
                aria-label={`立即播放 ${track.name}`}
                onClick={() => onPlayNow(track)}
              >
                <PlayIcon />
              </Button>
            </ItemMedia>

            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle className="max-w-full">
                <span className="truncate">{track.name}</span>
                {isCurrent && <Badge variant="secondary">正在播放</Badge>}
              </ItemTitle>
              <ItemDescription className="line-clamp-1 text-xs">
                {CATEGORY_LABELS[track.category]}
                {track.group ? ` · ${track.group}` : ""}
                {track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : ""}
                {track.durationSeconds ? ` · ${formatTime(track.durationSeconds)}` : ""}
              </ItemDescription>
            </ItemContent>

            <ItemActions className="shrink-0 gap-0.5">
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/track:opacity-100 group-focus-within/track:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label="下一首播放"
                        onClick={() => onPlayNext(track)}
                      />
                    }
                  >
                    <ChevronsRightIcon />
                  </TooltipTrigger>
                  <TooltipContent>下一首播放</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label="加入播放队列"
                        onClick={() => onAddToQueue(track)}
                      />
                    }
                  >
                    <ListPlusIcon />
                  </TooltipTrigger>
                  <TooltipContent>加入播放队列</TooltipContent>
                </Tooltip>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={`更多：${track.name}`} />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => onPlayNow(track)}>
                      <PlayIcon />
                      立即播放
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPlayNext(track)}>
                      <ChevronsRightIcon />
                      下一首播放
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAddToQueue(track)}>
                      <ListPlusIcon />
                      加入播放队列
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => onRemove(track)}>
                      <Trash2Icon />
                      从本机音乐库移除
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>
        );
      })}
    </ItemGroup>
  );
}
