import { useRef, useState } from "react";
import { FileAudioIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ImportPresetId } from "@/import/transcode";
import type { TrackCategory } from "@/library/simpleLibrary";
import { CATEGORY_LABELS, PRESET_LABELS } from "@/ui/playerDisplay";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPreset: ImportPresetId;
  defaultCategory: TrackCategory;
  busy: boolean;
  progress: number | null;
  status: string;
  pendingCount: number;
  onImport: (files: File[], preset: ImportPresetId, category: TrackCategory) => void;
  onRecoverPending: () => void;
}

/**
 * “添加音频”完整流程窗口。
 *
 * 文件选择、质量、分类放在同一个 Dialog，避免旧版把“导入与管理”永久占据主界面。
 * 真正执行时仍由父组件调用浏览器本地转码 + Owlbear Asset API；这个组件只负责把
 * 流程呈现得像一个普通上传器，不自己碰播放器或 SDK。
 */
export function ImportDialog({
  open,
  onOpenChange,
  defaultPreset,
  defaultCategory,
  busy,
  progress,
  status,
  pendingCount,
  onImport,
  onRecoverPending,
}: ImportDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [preset, setPreset] = useState<ImportPresetId>(defaultPreset);
  const [category, setCategory] = useState<TrackCategory>(defaultCategory);
  const inputRef = useRef<HTMLInputElement>(null);

  function closeIfIdle(nextOpen: boolean) {
    if (busy && !nextOpen) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      // 关闭后回到用户在设置页配置的默认值，下一次打开就是干净的新导入任务。
      setFiles([]);
      setPreset(defaultPreset);
      setCategory(defaultCategory);
    }
  }

  return (
    <Dialog open={open} onOpenChange={closeIfIdle}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加音频</DialogTitle>
          <DialogDescription>
            批量选择本地音频，浏览器会先转成适合 Owlbear 储存和同步播放的 Opus/WebM。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>本地文件</FieldLabel>
            <button
              type="button"
              className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-4 text-center transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-background shadow-sm ring-1 ring-foreground/10">
                <FileAudioIcon className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {files.length ? `已选择 ${files.length} 个文件` : "选择一个或多个音频文件"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  MP3 / WAV / M4A / AAC / FLAC / OGG 等浏览器可解码格式
                </p>
              </div>
            </button>
            {files.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-lg border bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
                {files.map((file) => <div key={`${file.name}-${file.size}`} className="truncate py-0.5">{file.name}</div>)}
              </div>
            )}
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.flac,.aac"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </Field>

          <Field>
            <FieldLabel>音质</FieldLabel>
            <Select value={preset} onValueChange={(value) => setPreset(value as ImportPresetId)}>
              <SelectTrigger className="w-full">
                <SelectValue>{PRESET_LABELS[preset]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="SPEECH">{PRESET_LABELS.SPEECH}</SelectItem>
                  <SelectItem value="AMBIENCE">{PRESET_LABELS.AMBIENCE}</SelectItem>
                  <SelectItem value="MUSIC">{PRESET_LABELS.MUSIC}</SelectItem>
                  <SelectItem value="ARCHIVE">{PRESET_LABELS.ARCHIVE}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>普通背景音乐默认 96 kbps；氛围长音频可用 64 kbps 节省 Owlbear 空间。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>分类</FieldLabel>
            <Select value={category} onValueChange={(value) => setCategory(value as TrackCategory)}>
              <SelectTrigger className="w-full">
                <SelectValue>{CATEGORY_LABELS[category]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="MUSIC">{CATEGORY_LABELS.MUSIC}</SelectItem>
                  <SelectItem value="AMBIENCE">{CATEGORY_LABELS.AMBIENCE}</SelectItem>
                  <SelectItem value="SFX">{CATEGORY_LABELS.SFX}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        {progress !== null && (
          <div className="flex flex-col gap-1.5">
            <Progress value={Math.round(progress * 100)} />
            <p className="text-xs text-muted-foreground">{status}</p>
          </div>
        )}

        {pendingCount > 0 && !busy && (
          <Alert>
            <UploadIcon />
            <AlertTitle>有 {pendingCount} 个上次未完成登记的音频</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>文件已经走过转码/保存流程，但插件还没有拿回 Owlbear 的正式播放 URL。</span>
              <Button size="sm" variant="outline" onClick={onRecoverPending}>继续登记</Button>
            </AlertDescription>
          </Alert>
        )}

        {progress === null && status && (
          <p className="text-xs leading-relaxed text-muted-foreground">{status}</p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => closeIfIdle(false)}>取消</Button>
          <Button
            disabled={busy || files.length === 0}
            onClick={() => onImport(files, preset, category)}
          >
            {busy ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <UploadIcon data-icon="inline-start" />}
            转换并上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
