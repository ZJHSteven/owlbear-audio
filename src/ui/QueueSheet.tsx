import { ListMusicIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RuntimePlayCue } from "@/runtime/protocol";

interface QueueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue: RuntimePlayCue[];
  currentCueId?: string;
  onPlayCue: (cueId: string) => void;
  onRemoveCue: (cueId: string) => void;
}

/**
 * 播放队列抽屉。
 *
 * queue 来自 Background 的 LOCAL snapshot，而不是 Action 自己猜一份；因此 Action 关闭
 * 再打开以后，仍能看到隐藏 Background 当前真正持有的顺序。跨玩家广播不会携带完整
 * queue，PLAYER 只知道当前曲目，避免把 DM 的后续编排暴露出去。
 */
export function QueueSheet({
  open,
  onOpenChange,
  queue,
  currentCueId,
  onPlayCue,
  onRemoveCue,
}: QueueSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80">
        <SheetHeader>
          <SheetTitle>播放队列</SheetTitle>
          <SheetDescription>
            当前队列由后台播放器持有。点击任意曲目可立即切换。
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
          {queue.length === 0 ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <ListMusicIcon className="size-6" />
              <p className="text-sm">队列还是空的</p>
              <p className="text-xs">从音乐库播放一首，或把曲目加入队列。</p>
            </div>
          ) : (
            <ItemGroup className="gap-1">
              {queue.map((cue, index) => {
                const isCurrent = cue.id === currentCueId;
                return (
                  <Item key={`${cue.id}-${index}`} size="xs" variant={isCurrent ? "muted" : "default"}>
                    <ItemMedia variant="icon" className="size-7 rounded-md bg-muted text-muted-foreground">
                      <span className="text-[11px] tabular-nums">{index + 1}</span>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full">
                        <span className="truncate">{cue.name}</span>
                        {isCurrent && <Badge variant="secondary">当前</Badge>}
                      </ItemTitle>
                      <ItemDescription className="text-xs">
                        {cue.busId === "MUSIC" ? "音乐" : cue.busId === "AMBIENCE" ? "氛围" : "音效"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`播放 ${cue.name}`}
                        onClick={() => onPlayCue(cue.id)}
                      >
                        <PlayIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={isCurrent}
                        aria-label={`从队列移除 ${cue.name}`}
                        onClick={() => onRemoveCue(cue.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
