# Owlbear Audio — ExecPlan

## 2026-09-09 第一阶段重新收口（当前执行计划）

这轮不再继续扩展 Show Control，而是把用户真正能完成的一条链路做稳，并直接部署给真实房间测试。

### 产品边界

- **仍然只有一个 Action Popover 用户入口**；`background_url` 只做隐藏播放与同步 runtime。
- DM/GM 与 PLAYER 共用同一个 Action，根据角色展示不同能力，不再创建 Studio Modal / Tool / Context Menu。
- **2026-09-09 视觉方向修正：撤销 Web Awesome 作为产品 UI 的决定。** Web Awesome/Shadow DOM 本身不是视觉目标，当前默认蓝黑主题与产品气质不符。
- 产品 UI 改回 **shadcn/ui + Tailwind 语义 token + Lucide**，视觉目标对齐 Family AI / AI Elements：黑白灰、低饱和、较大留白、轻边框、圆角、图标优先、Tooltip 解释。
- 不手绘 SVG；播放器、列表、抽屉、对话框、Slider、Tooltip、Tabs 等优先使用成熟 shadcn 组件或兼容 registry block 组合。
- Shadow DOM 只是一种 Web Component 封装技术，不再作为选型硬约束；本项目的样式隔离主要依赖 Owlbear 本身把扩展运行在独立 iframe 中。

### 2026-09-09 新版 GM/DM UX

首次进入：

`欢迎/版本公告 → 说明 Owlbear Audio Collection 的一次性前置条件 → “我已知晓” → Library`

主界面顶部只有两个一级入口：

- **音乐库**：默认页。
- **设置**：本机音量、默认转码质量、默认循环模式、默认导入分类、欢迎页/存储引导重置、诊断信息等。

音乐库：

- 左上角菜单按钮打开 **Sheet 侧栏**；背景遮罩，选择分类后自动关闭。
- 分类第一阶段至少包含：全部 / 音乐 / 氛围 / 音效；底层保留 group/tags 以便未来用户自定义文件夹与标签。
- 空库时使用 shadcn `Empty`，主 CTA 为“上传你的第一个音频”。
- 曲目行使用 `Item`/列表范式：左侧封面/占位图标，中间标题 + 灰色次要信息，右侧 Hover 后出现“立即播放 / 下一首 / 加入队列 / 更多”。
- 右上角保留紧凑“添加音频”按钮；支持批量本地文件、质量选择、浏览器本地转码、上传。

底部播放器固定：

- 上方：当前曲目 + 进度 Slider + 当前时间 / 总时长。
- 中央主控：`后退 15 秒 / 上一首 / 大圆形播放暂停 / 下一首 / 前进 15 秒`。
- 左下：音量按钮 + 音量 Slider。
- 右下：播放队列按钮 + 播放模式按钮。
- 播放模式按点击循环：**顺序播放 → 单曲循环 → 列表循环 → 随机**；图标状态 + Tooltip，不直接堆文字。
- 播放队列使用 Sheet/Drawer，显示当前与后续项目，并支持删除/排序（排序可留后续小版本）。

### PLAYER UX

- PLAYER 端不展示 Library 管理功能，只展示当前播放、进度、本机音量以及“启用声音/重新尝试”状态。
- PLAYER 初始化/广播故障列为本轮 P0：必须在真实双端房间中验证 `STATE_REQUEST → STATE → autoplay fallback → 持续同步` 全链路，而不是只跑单元探针。

### GM 第一阶段完整流程

`打开 Action → Library → 选择转码质量 → 从电脑导入 → 浏览器本地转 Opus/WebM → Owlbear 原生保存到 Owlbear Audio Collection → 完成导入/添加已有音频 → 分类标签管理 → 选曲播放`

播放器固定在 Action 底部，提供：

- 上一首 / 播放暂停 / 下一首；
- 可拖动进度；
- 当前时间 / 总时长；
- 循环开关；
- 本机 Master 音量；
- 切歌使用短 equal-power crossfade。

Library 上部提供简单分类标签（第一阶段用本机索引保存分类），不引入复杂 Playlist / Scene / Cue 概念。

### PLAYER 第一阶段流程

`打开 Action → 查看当前曲目与进度 → 浏览器若需要则启用声音 → 自动跟随 GM → 调本机音量/静音`

PLAYER 不展示导入、删除、分类或切歌等 GM 管理操作。

### 本轮必须修复的可靠性问题

- GM 第一次 GO 不能依赖 5 秒 heartbeat 才让 PLAYER 收到；role 初始化必须在第一次 authoritative publish 前完成。
- Action 打开后首次播放必须直接尝试播放，不再把 5 秒 heartbeat 当作启动路径。
- `downloadImages()` 失败时必须把 SDK 的结构化错误展开成人能读懂的错误信息，不能只显示 `[object Object]`。
- “添加已有音频”与“完成导入”都统一只接受 Owlbear Audio 生产 WebM，并保存 duration / preset / category 等索引信息。
- 任何播放器按钮都不能因为 Action 关闭而销毁播放；Background 始终是唯一 AudioEngine owner。

### 验收与发布

1. `npm run build`、`npm run lint` 通过。
2. 用本地浏览器/现有 Owlbear 房间验证 Action 角色分流和基础控制。
3. Cloudflare 部署成功。
4. 生产 manifest 可访问。
5. 绑定 `zjhstudio.com` 子域名后再进行真实 GM/PLAYER 双端测试。

---

## 2026-09-09 晚：跨设备音乐库与 PLAYER 测试环境

### 新暴露的问题

- 同一 GM 在电脑 Action 中已经有音乐库，但手机进入同一房间仍显示空库。
- 根因不是 Owlbear Asset 丢失：媒体文件已经在 Owlbear 云端；真正丢的是插件自己的
  `localStorage` 音乐库索引。`localStorage` 天然按浏览器/设备隔离，不能再作为房间
  音乐库的权威存储。
- 每次用无痕窗口测试 PLAYER 都要重新接受 Owlbear 条款/引导，测试成本太高。

### 本轮决策

1. **Room metadata 成为音乐库权威源。**
   - Owlbear 当前公开 `OBR.room.getMetadata / setMetadata / onMetadataChange` 支持房间共享数据；
   - 官方限制 room metadata 总量 `< 16 kB`，因此这里只保存紧凑索引，不保存音频 blob；
   - 音频本体继续使用 Owlbear CDN URL。
2. **localStorage 降级为缓存和 v0.1.2 以前的迁移源。**
   - 房间没有 library metadata + 当前本机旧库非空：GM 首次自动迁移到 room metadata；
   - 房间已经有 metadata：房间覆盖本机缓存，避免已删除曲目被旧缓存重新复活；
   - 监听 `room.onMetadataChange`，电脑/手机/第二个 GM 连接实时看到同一音乐库。
3. **写入前做 metadata 总体积检查。**
   - 计算“当前房间全部 metadata + 新 library payload”的 UTF-8 JSON 字节数；
   - 接近 16 kB 时拒绝写入并给出明确错误，不让 Owlbear SDK 以不透明错误失败；
   - 后续真正需要百首级大库时再迁 Worker/D1，不在第一阶段提前引入服务器状态。
4. **建立持久 PLAYER 测试浏览器 profile。**
   - 不再使用 Incognito；
   - 单独目录保存 Owlbear PLAYER 的 cookie / 条款确认 / 本地音量等；
   - 与主 Chrome GM profile 隔离，可长期作为双端 E2E 测试端。

### 验收

- 旧电脑 localStorage 库能自动迁移进当前房间 metadata；
- 清空另一浏览器本地缓存后，重新打开同一房间仍自动出现相同曲目；
- 在一个 GM 端添加/删除曲目，另一个连接实时更新；
- `npm run check` 全绿；
- 生产 Worker 重新发布后再测 GM → PLAYER 播放、late join、暂停、seek、下一首。

---

## 目标

开发一个 **零后端优先** 的 Owlbear Rodeo 2 音频扩展，让 GM/DM 可以把本地音乐、环境音和音效导入、转码后尽量存进 Owlbear 自己的资产空间，并在跑团过程中用低认知负担的方式控制复杂音频。

核心原则不是“删掉复杂能力”，而是 **渐进式暴露复杂度（progressive disclosure）**：

- 临场模式：DM 只需要操作少量高价值按钮，不必当专职 DJ。
- 编排模式：允许提前把复杂转场、循环、分层、队列和自动动作编好。
- 高级模式：完整暴露 Deck / Mixer / Cue / Loop / Bus / Automation 等控制，不限制高级用户。
- 三种模式必须共用同一套底层数据模型，不能做成互相割裂的两套播放器。

## v0.1 发布冻结范围（2026-09-01）

第一版不再尝试同时交付完整 Show Control。目标先对标 Tracks 的“轻量音乐库 + 同步播放”，但把外部公网 URL 托管改成 **本地导入后存进 Owlbear 自己的资产空间**。

### 唯一用户入口

- **Action Popover 是唯一可见入口**。
- `background_url` 只运行 AudioEngine / 房间同步，永远不作为用户页面。
- v0.1 不提供 Studio Modal、Tool、Context Menu 或额外网页入口。

### GM v0.1 用户路线

`打开 Action → 音乐库 → 从电脑导入 → 浏览器转 Opus/WebM → Owlbear 原生保存 → 完成导入 → 搜索 → 播放/暂停/停止/音量`

- 音乐默认循环，适合背景音乐与环境音。
- 切换音乐使用短 equal-power crossfade。
- 音乐库索引保存在本机；云端原文件保存在 Owlbear Audio Collection。换设备时可通过“添加已有音频”重新建立本机索引。

### PLAYER v0.1 用户路线

`打开 Action → 看当前音乐 → 若浏览器要求则点一次启用声音 → 自动跟随 GM → 调自己的音量/静音`

### v0.1 明确不做

- Cue Stack / GO / HOLD / PANIC 产品 UI。
- Scene / Layer。
- Devamp / Loop Region。
- Cue Cart / SFX Pads。
- Private Audition。
- Deck A/B、Waveform、Hot Cue、EQ/Filter/FX、Automation。

这些能力继续保留在长期产品方向，但必须在 v0.1 发布后逐项作为真实用户功能实现，不再用类型模型或占位 UI 计为“已完成”。

---

## 已验证事实

### Owlbear 扩展与资产能力

- 扩展由 `manifest.json` 加载，可提供左上角 Action popover、background 页面、工具栏 Tool、Context Menu、任意 Popover，以及 Modal。
- `OBR.modal.open({ fullScreen: true })` 可以提供真正的全屏自定义 UI，因此主交互可以设计成：
  - Action popover：临场迷你控制台。
  - Full-screen Modal：音频库、编排、混音、设置等完整工作台。
- `OBR.assets.uploadImages()` 的参数底层是 `ImageUpload[]`，其中 `file` 类型是 `File | Blob`。
- `OBR.assets.downloadImages()` 能让扩展从当前用户的 Owlbear 资产中挑选文件，并返回资产 URL / MIME 等内容。
- 当前真实账户页面的原生文件输入明确接受：
  - `image/jpeg`
  - `image/gif`
  - `image/png`
  - `image/webp`
  - `video/mp4`
  - `video/webm`
- 直接把 `.opus` 喂给真实 Owlbear 上传器已经被前端拒绝，错误信息明确要求扩展名必须属于上述图片/视频格式。
- 因此当前最有希望的储存通道是 **WebM / MP4 视频资产承载 Opus 音频**。

### 当前真实账户测试状态

- 免费 Nestling 空间：200 MB。
- 当前已使用约 58.2 MB。
- 已生成三种 6 秒探针：
  1. `probe-audio.opus`：纯 Opus；已证实原生上传器拒绝。
  2. `probe-audio-only.webm`：WebM 容器，仅 Opus 音轨；待用 SDK / 稳定上传路径验证。
  3. `probe-av.webm`：16×16、1fps、极低码率 VP9 视频轨 + 48 kbps Opus；待验证。
- 关键待证问题：
  1. audio-only WebM 是否被 Owlbear 接受。
  2. 如果必须有视频轨，极小视频 + Opus 是否被接受。
  3. 上传后服务端是否会转码，以及是否保留音轨。
  4. `downloadImages()` 拿到的 URL 能否被 `<audio>` / Web Audio 直接播放。
  5. 资产 URL 是否稳定；若不稳定，需要设计可重新解析资产引用的索引策略。

---

## 产品范式调研结论

本项目不照搬普通“歌单播放器”，而融合三类成熟工作流。

### 1. DJ 软件：Deck / Cue / Loop / Mixer

借鉴 Rekordbox / Traktor / VirtualDJ：

- 多 Deck：至少 A/B 两个主音乐 Deck；高级模式可扩展。
- Crossfader：手动切换和交叉淡化。
- Hot Cue：一键跳到曲目内关键位置。
- Hot Loop：保存常用循环段。
- Preview / Cue Bus：GM 自己试听而不广播给玩家。
- Sampler / One-shot Pads：门响、爆炸、法术、怪物咆哮等瞬时音效。
- Gain / EQ / Filter / FX：高级用户可用，但默认折叠。
- Waveform：用于高级编辑、切 Cue/Loop，不应成为临场模式的视觉中心。

### 2. 剧场 Cue 软件：QLab 思路

这是最贴合跑团的一类范式：

- Cue List：按剧情顺序排列“下一步发生什么”。
- Cue Cart：没有固定顺序的按钮墙，适合任意触发音效或常用场景。
- Group Cue：一次触发一组动作。
- Fade Cue：把“音量改变”本身作为可编排动作，而不是手拧滑杆。
- Auto-continue：启动当前 Cue 后，按预设延时启动下一 Cue。
- Auto-follow：当前 Cue 自然结束后自动进入下一 Cue。
- Wait Cue：显式等待。
- Devamp：音乐某段无限循环；DM 发出“继续”指令后，不是立刻硬切，而是在当前循环自然结束点退出并进入后续段。
- Audition：GM 私下试听 Cue，不影响正式播放。
- Preload：提前解码 / 缓冲下一批 Cue，避免临场触发延迟。

**Devamp 是本项目的重点功能之一。** 它非常适合“战斗还没打完就继续循环；一旦 Boss 倒下，DM 只按一次按钮，音乐在正确的乐句边界自然进入胜利尾声”。

### 3. Ableton Live Session View：Scene / Clip / Follow Action

借鉴：

- 每一列代表一类 Layer / Bus。
- 每一行是一个 Scene，例如：酒馆、潜行、探索、战斗、Boss、胜利。
- 一次触发 Scene，可以同时改变多条 Layer。
- Follow Action 可以顺序、随机或按概率挑选下一段，减少循环感。

这一范式适合“环境声分层”：

- Music
- Ambience
- Weather
- Crowd
- Texture
- SFX

DM 切换“雨夜酒馆”时，不一定换一首完整音轨，而可以组合酒馆底噪 + 雨 + 炉火 + 低声人群 + 背景音乐。

---

## 统一底层模型

### Asset

原始媒体与 Owlbear 资产引用。

关键字段：

- id
- displayName
- sourceType (`local-import`, `owlbear-asset`, future external URL)
- container / codec / bitrate
- duration
- asset URL / 可重新解析的 Owlbear 引用信息
- tags
- loudness metadata
- waveform peaks（可选缓存）

### Clip

Asset 的可播放切片，而不是简单等同于整首文件。

字段：

- assetId
- in / out
- gain
- fadeIn / fadeOut
- loop region
- cue points
- optional BPM / beat grid
- optional semantic markers（intro / loop / climax / outro）

### Cue

一次“操作”。

类型预计包括：

- PLAY
- STOP
- PAUSE
- RESUME
- FADE
- WAIT
- LOAD
- DEVAMP
- SET_PARAM
- START_SCENE
- RANDOM_CHOICE
- GROUP

### Bus

音频总线：

- Music
- Ambience
- SFX
- Voice / Narration（如果未来需要）
- Master

Bus 可以统一控制 gain / mute / solo / ducking / effects。

### Scene

一组目标状态，而不是单首歌曲。

例如“Combat: Desperate”可以描述：

- Music -> battle_03，-12 dB
- Ambience -> dungeon_rumble，-24 dB
- Weather -> none
- SFX bus -> 保持
- transition -> 2.5 s equal-power crossfade

### Cue Stack / Show

按剧情编排的顺序 Cue。

### Cart / Pad Bank

无顺序快速触发集合。

---

## UI 分层

### A. Compact / Live Mode（Action Popover）

跑团时默认只看到：

- 当前 Scene / 当前主音乐
- 大号 Play/Pause
- `GO / NEXT`：执行已经准备好的下一 Cue
- `DEVAMP / EXIT LOOP`：在自然边界退出循环
- `PANIC / STOP ALL`
- Master / Music / Ambience 三个最关键音量
- 4~8 个收藏 Pad
- 当前和下一 Cue 的明显状态
- 一个按钮进入 Full Studio

目标：**DM 看一眼、按一下就回剧情。**

### B. Director Mode（全屏 Modal）

主要工作区：

- 左：Library / 搜索 / Tag / Playlist / SoundSet
- 中：Cue List / Scene Grid / Cart，可切不同视图
- 下：当前播放和即将播放队列
- 右：Inspector，编辑选中的 Cue / Clip / Scene
- 顶：Master 状态、同步状态、玩家连接状态

这是默认的“准备阶段”界面。

### C. Advanced / DJ Mode

在 Director Mode 中展开高级区域：

- Deck A / Deck B
- 双波形
- Cue / Hot Cue / Loop
- Crossfader
- Gain / EQ / Filter
- BPM / sync / quantize（若以后做 beat-aware 转场）
- Sampler banks
- Bus mixer
- automation lanes / fade curves

不强迫普通 DM 使用，但高级用户不会被阉割。

---

## “DM 不是 DJ”的自动化策略

### 默认无脑好用

- 导入时做响度分析并自动归一化，避免每首歌忽大忽小。
- 默认 equal-power crossfade，避免线性交叉淡化中间听感下陷。
- 下一 Cue 自动预加载。
- 环境音默认无缝循环。
- Scene 切换时只改变必要 Layer，不把所有声音全停重启。
- SFX one-shot 不抢占 Music / Ambience。
- Panic 永远一键停止所有音频。

### 可提前编排

- Cue sequence
- scene transition
- wait / follow / continue
- devamp
- random variants
- probability follow actions
- gain automation
- layer enable / disable

### 临场可人工接管

所有自动动作都必须允许：

- Skip
- Hold
- Fire Now
- Cancel
- Override
- Return to programmed state

自动化不能把 DM 锁死。

---

## 零后端架构目标

### 扩展静态前端

React + TypeScript + Vite。

### 转码

优先评估浏览器内 WASM / WebCodecs：

- 第一阶段先使用桌面 ffmpeg 生成探针，仅用于验证 Owlbear 存储通道。
- 产品版本目标是在浏览器本地完成：
  - decode
  - resample
  - loudness scan
  - Opus encode
  - WebM mux
- 如果必须使用 ffmpeg.wasm，则采用 lazy-load，避免每次打开临场控制台都加载几十 MB WASM。

### 索引与状态

分两类：

1. 用户个人媒体库索引：IndexedDB 为主。
2. 房间共享播放状态 / Cue 执行状态：Owlbear room/scene metadata + broadcast。

播放器同步需要 GM authoritative state，玩家端只执行接收到的播放命令并做漂移修正。

---

## 实施阶段

### Phase 0 — Storage Spike（当前）

- [x] 创建项目仓库。
- [x] 真实登录 Owlbear 环境确认账户与储存额度。
- [x] 确认原生上传 accept MIME。
- [x] 证明 `.opus` 直接上传被拒绝。
- [x] 搭一个最小 Owlbear SDK probe extension，并安装到真实房间；SDK 握手成功。
- [x] 验证 audio-only WebM：SDK 可以接收 48,101-byte `video/webm` 并进入媒体解析，但最终提交时 Owlbear 报 `Unable to generate video thumbnail`，不会发出对象存储 POST；**正式方案不采用 audio-only WebM**。
- [x] 验证 tiny-video WebM + Opus：48,390-byte、16×16 / 1 fps VP9 + Opus 的合法 `video/webm` 可以完整上传。
- [x] 用 Owlbear 原生 Asset Manager 上传同一份 tiny-video WebM 做基线对照；本地预处理约 72 ms，视频对象 POST 200、缩略图 POST 200、资产记录 POST 201。
- [x] 定位早期 SDK timeout：不是 Mihomo / Fake-IP / CORS / WebM 格式，而是测试所在 Owlbear 标签处于 `visibilityState=hidden`，使宿主用于读取媒体 metadata 的 media element stalled；换到真正 visible 的 Owlbear 标签后 SDK 正常返回并进入上传 UI。
- [x] 上传后通过 `downloadImages()` / fetch 拉回：返回 `video/webm`、16×16 和 `videos.owlbear.rodeo` CDN URL，跨域 fetch 成功。
- [x] 检查 Content-Type / Content-Length / CORS：`video/webm`、48,390 bytes、`Access-Control-Allow-Origin: *`。
- [~] 检查 Range：测试 `Range: bytes=0-1023` 时 CDN 返回 200 + 完整文件，而非 206；需要针对长音轨/浏览器 seek 再评估。
- [x] 检查音轨是否仍存在：CDN 回下载经 ffprobe 仍为 VP9 + 48 kHz Opus，且 SHA-256 与上传前完全一致。
- [x] 浏览器实际播放：扩展 iframe 中 `<audio src=videos.owlbear.rodeo/...webm>` 可直接 `loadedmetadata`，duration=6.008 s。
- [x] 将生产封装进一步压缩为 **单帧 VP9 + 完整 Opus**：视频轨只含 1 个 packet，Owlbear 仍能生成缩略图并上传；视频开销不随音轨时长增长。
- [x] 生产封面改为 64×64 极简均衡器图标；真实 Owlbear 自动生成 WebP thumbnail 约 726 B，避免 Attachments 中出现难以辨认的全黑块。
- [x] 验证 Collection 隔离：创建 `Owlbear Audio` Collection 并上传探针后，该资产只在该 Collection 出现，切回 Default 不会污染普通 Attachments；同时保留用户手工查看/删除的恢复通道。
- [x] 生产存储规格落盘至 `docs/STORAGE-FORMAT.md`。
- [x] SDK UI surface 职责落盘至 `docs/SDK-UI-ARCHITECTURE.md`。

### Phase 1 — Playback Foundation（底层已较完整，产品功能仍不完整）

- [x] Asset / Clip / Cue / Bus / Scene **类型模型**。注意：类型存在不代表对应用户功能已实现。
- [x] 单例 Web Audio / HTMLMediaElement playback runtime。
- [x] Music / Ambience / SFX / Voice / Master Bus graph。
- [~] 基础 play / pause / stop / seek / 整轨 loop；任意 Loop Region 未实现。
- [x] equal-power crossfade / gain ramp primitive。
- [x] Background 为唯一 AudioEngine owner；Action gesture 解锁与 lifecycle 已验证。
- [x] LOCAL runtime RPC + GM→PLAYER NOW 同步 / late join / heartbeat / Room metadata checkpoint。
- [~] Live Console：NOW / NEXT / GO / HOLD / PANIC 只能驱动 **PLAY-only Cue Stack**，不能等同完整 Show Control。
- [~] Studio：当前只有最小 Library + PLAY Cue Stack + 简单 Inspector，不是完整 Director。
- [x] Player Console：Enable Audio / NOW / 本机音量 / Mute / sync state。
- [ ] Scene + Layer runtime / UI。
- [ ] DEVAMP / Exit Loop。
- [ ] Cue Cart / Pads。
- [ ] GM private Audition / Cue Bus。
- [ ] Wait / Group / Random / Follow Action runtime。
- [ ] Tool Action GO。

### Phase 2 — Library & Import（基础设施进行中，产品 UX 需重做）

- [~] 本地导入：文件选择/拖放已接到底层管线；完整正常用户流程尚未验收。
- [x] Mediabunny + WebCodecs → 48 kHz Opus + 单个 64×64 VP9 cover frame；lazy-load。
- [x] Speech 48 / Ambience 64 / Music 96 / Archive 128 kbps presets。
- [x] production WebM SHA-256 去重；当前 Chrome/Mediabunny 下 deterministic。
- [x] IndexedDB Local-only staging / recovery。
- [x] Owlbear production envelope 上传的 WebM POST 200 + thumbnail POST 200 + `user_assets` POST 201 已独立验证。
- [~] Asset Picker / Link 技术桥已验证；最终导入旅程仍需重新设计与完整登录态 E2E。
- [x] 多标签页 picker broker 隔离基础设施。
- [~] Loudness analyzer 基础设施已写；尚未达到用户功能验收标准。
- [~] 搜索只有名称 substring；无 tags / category / library management。
- [ ] 素材试听 / private preview。
- [ ] 导入 UX 隐藏 Local-only / Link / WebM 等内部概念。
- [x] 导入链路技术规格落盘至 `docs/IMPORT-PIPELINE.md`。

### Phase 3 — DM Workflow

- Compact Live Mode。
- Cue List。
- Cue Cart。
- Scene Grid。
- Devamp。
- Auto-follow / auto-continue / wait。

### Phase 4 — Advanced Studio

- Waveform editor。
- Hot Cue / Loop editor。
- Advanced mixer。
- FX / automation。
- beat-aware / quantized transition（如果实际跑团收益足够）。

### Phase 5 — Polish & Distribution

- 房间权限 / GM-only 控制。
- 崩溃恢复。
- 玩家断线重连同步。
- 浏览器兼容性。
- 静态部署。
- Owlbear extension 发布准备。

---

## 暂不做的事情

- 不先造后端对象存储；先验证 Owlbear 自身资产能否承担媒体储存。
- 不一开始做完整 DAW。
- 不一开始追求 beatmatching / key matching；跑团的价值优先级低于 Cue、Scene、Devamp、预加载和可靠同步。
- 不把 UI 固定成若干死预设；预设只是高层入口，底层高级能力始终保留。


## Asset import UX research (2026-09-09)
- See docs/asset-storage-research.md. Priority: Scene Item URL bridge -> Audio Folder bulk re-index -> raw upload RPC response.
- Do not merge undocumented RPC/private APIs into production before compatibility is proven.
