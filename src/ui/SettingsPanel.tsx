import { BellRingIcon, GaugeIcon, RotateCcwIcon, Volume2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import type { RuntimeSnapshot } from "@/runtime/protocol";
import {
  CATEGORY_LABELS,
  PLAYBACK_MODE_LABELS,
  PRESET_LABELS,
  singleSliderValue,
} from "@/ui/playerDisplay";
import type { LocalPlayerPreferences } from "@/ui/playerPreferences";

interface SettingsPanelProps {
  preferences: LocalPlayerPreferences;
  snapshot: RuntimeSnapshot | null;
  onPreferencesChange: (preferences: LocalPlayerPreferences) => void;
  onResetWelcome: () => void;
}

/**
 * v0.1 设置页只放真正影响体验的本机偏好，不制造“高级设置”占位项。
 *
 * - 默认转码质量 / 分类：减少每次导入重复选择；
 * - 播放模式 / crossfade：决定 DM 临场切歌行为；
 * - 本机监听音量：只影响当前设备；
 * - 诊断：直接展示 Background 角色和媒体状态，方便排查 PLAYER 初始化问题。
 */
export function SettingsPanel({
  preferences,
  snapshot,
  onPreferencesChange,
  onResetWelcome,
}: SettingsPanelProps) {
  function patch(next: Partial<LocalPlayerPreferences>) {
    onPreferencesChange({ ...preferences, ...next });
  }

  return (
    <div className="flex flex-col gap-5 px-3 pb-28 pt-3">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium">默认行为</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">这些设置只保存在当前浏览器。</p>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel>默认转码质量</FieldLabel>
            <Select
              value={preferences.defaultPreset}
              onValueChange={(value) => patch({ defaultPreset: value as LocalPlayerPreferences["defaultPreset"] })}
            >
              <SelectTrigger className="w-full"><SelectValue>{PRESET_LABELS[preferences.defaultPreset]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="SPEECH">{PRESET_LABELS.SPEECH}</SelectItem>
                  <SelectItem value="AMBIENCE">{PRESET_LABELS.AMBIENCE}</SelectItem>
                  <SelectItem value="MUSIC">{PRESET_LABELS.MUSIC}</SelectItem>
                  <SelectItem value="ARCHIVE">{PRESET_LABELS.ARCHIVE}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>默认导入分类</FieldLabel>
            <Select
              value={preferences.defaultCategory}
              onValueChange={(value) => patch({ defaultCategory: value as LocalPlayerPreferences["defaultCategory"] })}
            >
              <SelectTrigger className="w-full"><SelectValue>{CATEGORY_LABELS[preferences.defaultCategory]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="MUSIC">{CATEGORY_LABELS.MUSIC}</SelectItem>
                  <SelectItem value="AMBIENCE">{CATEGORY_LABELS.AMBIENCE}</SelectItem>
                  <SelectItem value="SFX">{CATEGORY_LABELS.SFX}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>默认播放模式</FieldLabel>
            <Select
              value={preferences.playbackMode}
              onValueChange={(value) => patch({ playbackMode: value as LocalPlayerPreferences["playbackMode"] })}
            >
              <SelectTrigger className="w-full"><SelectValue>{PLAYBACK_MODE_LABELS[preferences.playbackMode]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="SEQUENTIAL">{PLAYBACK_MODE_LABELS.SEQUENTIAL}</SelectItem>
                  <SelectItem value="REPEAT_ONE">{PLAYBACK_MODE_LABELS.REPEAT_ONE}</SelectItem>
                  <SelectItem value="REPEAT_ALL">{PLAYBACK_MODE_LABELS.REPEAT_ALL}</SelectItem>
                  <SelectItem value="SHUFFLE">{PLAYBACK_MODE_LABELS.SHUFFLE}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>切歌交叉淡化</FieldLabel>
              <span className="text-xs tabular-nums text-muted-foreground">
                {preferences.crossfadeSeconds.toFixed(1)} 秒
              </span>
            </div>
            <Slider
              min={0}
              max={5}
              step={0.1}
              value={preferences.crossfadeSeconds}
              onValueChange={(value) => patch({ crossfadeSeconds: singleSliderValue(value) })}
            />
            <FieldDescription>0 秒为直接切换；1–2 秒通常更适合跑团背景音乐。</FieldDescription>
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel className="flex items-center gap-2"><Volume2Icon className="size-4" />本机监听音量</FieldLabel>
              <span className="text-xs tabular-nums text-muted-foreground">{preferences.masterDb} dB</span>
            </div>
            <Slider
              min={-48}
              max={0}
              step={1}
              value={preferences.masterDb}
              onValueCommitted={(value) => patch({ masterDb: singleSliderValue(value) })}
            />
            <FieldDescription>只影响你当前浏览器，不会改变 PLAYER 或其他 DM 的音量。</FieldDescription>
          </Field>
        </FieldGroup>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <GaugeIcon className="size-4" />
          <h2 className="text-sm font-medium">运行状态</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <p className="text-muted-foreground">Background 角色</p>
            <div className="mt-1"><Badge variant="secondary">{snapshot?.role ?? "等待握手"}</Badge></div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <p className="text-muted-foreground">媒体权限</p>
            <div className="mt-1"><Badge variant="secondary">{snapshot?.isUnlocked ? "可播放" : "需用户手势"}</Badge></div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <p className="text-muted-foreground">Transport</p>
            <p className="mt-1 font-medium">{snapshot?.transport.phase ?? "未连接"}</p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <p className="text-muted-foreground">后台队列</p>
            <p className="mt-1 font-medium">{snapshot?.transport.queue.length ?? 0} 首</p>
          </div>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <BellRingIcon className="size-4" />
          <h2 className="text-sm font-medium">引导与公告</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          需要重新查看 Owlbear Collection、上传/登记限制或 PLAYER 使用说明时，可以重置欢迎页。
        </p>
        <Button variant="outline" size="sm" className="w-fit" onClick={onResetWelcome}>
          <RotateCcwIcon data-icon="inline-start" />
          重新显示欢迎页
        </Button>
      </section>
    </div>
  );
}
