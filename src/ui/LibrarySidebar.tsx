import {
  AudioLinesIcon,
  FolderIcon,
  LibraryIcon,
  MenuIcon,
  Music2Icon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { SimpleLibraryTrack, TrackCategory } from "@/library/simpleLibrary";

export type LibraryFilter =
  | { kind: "ALL" }
  | { kind: "CATEGORY"; category: TrackCategory }
  | { kind: "GROUP"; group: string };

interface LibrarySidebarProps {
  tracks: SimpleLibraryTrack[];
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
}

function sameFilter(left: LibraryFilter, right: LibraryFilter): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "CATEGORY" && right.kind === "CATEGORY") return left.category === right.category;
  if (left.kind === "GROUP" && right.kind === "GROUP") return left.group === right.group;
  return left.kind === "ALL";
}

/**
 * 音乐库左侧抽屉。
 *
 * Owlbear Action 宽度只有约 420px，不适合永久占一列 sidebar，所以这里用 Sheet：
 * 用户点左上角菜单时从左边滑出，宿主区域被半透明/blur 遮罩；选择后 SheetClose
 * 的行为由受控 open 状态完成，立即回到曲目列表。
 */
export function LibrarySidebar({ tracks, filter, onFilterChange }: LibrarySidebarProps) {
  const groups = [...new Set(tracks.map((track) => track.group.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const options: Array<{
    label: string;
    filter: LibraryFilter;
    icon: typeof LibraryIcon;
    count: number;
  }> = [
    { label: "全部", filter: { kind: "ALL" }, icon: LibraryIcon, count: tracks.length },
    {
      label: "音乐",
      filter: { kind: "CATEGORY", category: "MUSIC" },
      icon: Music2Icon,
      count: tracks.filter((track) => track.category === "MUSIC").length,
    },
    {
      label: "氛围",
      filter: { kind: "CATEGORY", category: "AMBIENCE" },
      icon: SparklesIcon,
      count: tracks.filter((track) => track.category === "AMBIENCE").length,
    },
    {
      label: "音效",
      filter: { kind: "CATEGORY", category: "SFX" },
      icon: AudioLinesIcon,
      count: tracks.filter((track) => track.category === "SFX").length,
    },
  ];

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="打开音乐库分类" />
        }
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader>
          <SheetTitle>音乐库</SheetTitle>
          <SheetDescription>按类型或文件夹筛选。选择后侧栏会自动收起。</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-1 px-3 pb-3">
          {options.map((option) => {
            const Icon = option.icon;
            const selected = sameFilter(filter, option.filter);
            return (
              <SheetTrigger
                key={option.label}
                render={
                  <Button
                    variant={selected ? "secondary" : "ghost"}
                    className="h-9 w-full justify-start"
                    onClick={() => onFilterChange(option.filter)}
                  />
                }
              >
                <Icon data-icon="inline-start" />
                <span className="flex-1 text-left">{option.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
              </SheetTrigger>
            );
          })}

          {groups.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">文件夹</p>
              {groups.map((group) => {
                const nextFilter: LibraryFilter = { kind: "GROUP", group };
                const selected = sameFilter(filter, nextFilter);
                const count = tracks.filter((track) => track.group === group).length;
                return (
                  <SheetTrigger
                    key={group}
                    render={
                      <Button
                        variant={selected ? "secondary" : "ghost"}
                        className="h-9 w-full justify-start"
                        onClick={() => onFilterChange(nextFilter)}
                      />
                    }
                  >
                    <FolderIcon data-icon="inline-start" />
                    <span className="flex-1 truncate text-left">{group}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                  </SheetTrigger>
                );
              })}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
