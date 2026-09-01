# Owlbear Audio — 当前状态

更新时间：2026-09-01

## 当前产品定义

当前发布目标是 **v0.1：Tracks-like 轻量音乐库 + Owlbear 自有媒体存储**。

第一版不交付完整 Show Control。高级方向仍保留，但 Scene / Devamp / Cue Cart / Audition / Deck / Waveform 等在真正做成用户功能前一律视为“未实现”。

## v0.1 用户入口

- **Action Popover 是唯一可见入口。**
- `background_url` 是隐藏 AudioEngine / 同步 runtime，不是用户页面。
- v0.1 不提供 Studio Modal、Tool、Context Menu、Diagnostics 或 Probe 页面。

### GM

`打开 Action → 音乐库 → 导入/添加音频 → 搜索 → 播放/暂停/停止 → 调本机音量`

### PLAYER

`打开 Action → 查看当前音乐 → 必要时点一次“启用声音” → 自动跟随 GM → 调本机音量/静音`

## 已实现

### 存储 / 导入

- 本地常见音频由 Mediabunny + WebCodecs 在浏览器内转换。
- 当前默认输出：48 kHz Opus / Music 96 kbps。
- WebM envelope 含完整 Opus 音轨 + 单个 64×64 VP9 封面帧，满足 Owlbear thumbnail 要求。
- 转码器通过 dynamic import lazy-load；打开播放器不会加载转码模块。
- `OBR.assets.uploadImages()` 打开 Owlbear 原生保存流程。
- 用户保存到专用 `Owlbear Audio` Collection 后，在 Action 点“完成导入”，用 `downloadImages()` 选回刚上传资产并写入本机音乐库索引。
- “添加已有音频”可随时从 Owlbear 资产选择器重新建立本机索引。
- 本机音乐库按 CDN URL 去重并保存在 localStorage。

### 播放 / 同步

- Background iframe 是唯一 AudioEngine owner。
- GM 第一次点“播放”时，同一个用户手势执行 unlock + play，不再显示独立 Enable Audio 步骤。
- 音乐默认循环。
- 切换音乐使用短 equal-power crossfade。
- 支持暂停、继续、停止、Master 音量。
- GM authoritative NOW 状态通过 Owlbear Broadcast 同步给玩家。
- PLAYER 支持首次音频解锁、自动追当前进度、本机 Master / Mute。
- Room metadata 保存公开 NOW checkpoint，用于玩家晚加入恢复。

### UI / UX

- UI 基础：React 19 + shadcn 风格源码组件 + Radix UI + Tailwind CSS v4 + Geist + Lucide。
- `OBR.theme` 映射到 design tokens，跟随 Owlbear Light/Dark 与宿主颜色。
- 正常 UI 已移除 Vite starter、Probe、Diagnostics、Try Demo、Studio 占位页和中英混杂开发文案。
- Action 内容无固定内部宽度，使用单列 flex/list、`min-w-0` 和触控尺寸按钮，面向桌面与手机同一布局。

## 已真实验证的底层事实

- `.opus` 不能直接作为 Owlbear asset 上传。
- audio-only WebM 会因无法生成 thumbnail 而失败。
- 单帧 VP9 + Opus WebM 可成功上传。
- 真实上传曾抓到：WebM object POST 200、WebP thumbnail POST 200、`user_assets` POST 201。
- Owlbear 不改写原 WebM；回下载 SHA-256 曾验证与上传前一致。
- CDN WebM 可被浏览器 `<audio>` 直接播放。
- 专用 `Owlbear Audio` Collection 可避免污染 Default asset shelf。
- Chrome 真机实验已验证 Action 真实用户手势可解锁 Background 后续音频播放。
- GM/PLAYER 双端同步、Pause/Resume/STOP、late join、heartbeat drift correction 在此前 runtime probe 中已验证。

详细证据见：

- `docs/STORAGE-FORMAT.md`
- `docs/IMPORT-PIPELINE.md`
- `docs/PRODUCT-AUDIT.md`

## 当前发布

- Manifest 版本：`0.1.0`
- Canonical manifest：`public/manifest.json`
- 已删除测试用 `manifest-v2.json`。
- Cloudflare Pages 项目：`owlbear-audio`
- 生产安装地址：`https://owlbear-audio.pages.dev/manifest.json`
- 2026-09-01 最新 build：通过。
- lint：无 error，仅 shadcn 生成的 Button/Badge Fast Refresh warning。

## 已知限制 / 发布前待验证

1. 当前 CDP 测试 Chrome 的 Owlbear 登录态已退出，因此新 v0.1 UI 尚未重新在真实登录房间跑完整 `导入 → 保存 → 完成导入 → 播放 → PLAYER` E2E。
2. Owlbear SDK 不提供“上传后直接返回 asset URL”，因此 v0.1 导入暂时是两阶段宿主流程；这是公开 API 边界，不是 UI 任意增加的步骤。
3. 音乐库索引目前是本机 localStorage；媒体本体在 Owlbear。换浏览器/设备需要“添加已有音频”重新选择云端资产。
4. 手机响应式布局已按 Action 最大尺寸/窄容器设计；Safari/iOS autoplay/background 行为仍需真实设备验收。
5. 旧 Owlbear 账户里可能仍残留多条 `Owlbear Audio Lab` 测试安装记录；测试浏览器恢复登录后应清理，只保留 canonical 0.1.0。

## v0.1 明确未实现

- Tags / fuzzy search / CSV import-export。
- Scene / Layer。
- Cue Stack / GO / HOLD / PANIC 产品 UI。
- Devamp / Loop Region。
- Cue Cart / SFX Pads。
- GM private Audition。
- Waveform / Hot Cue。
- Deck A/B。
- EQ / Filter / FX / Automation。

这些属于 v0.2+，不得在当前完成度汇报中算作已实现。
