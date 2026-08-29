# 项目状态快照

## 当前结论（必须最新）

- 现状：Phase 0 的核心存储假设已经被真实账户实验验证成立：**合法的超轻量视频 WebM 可以把 Opus 音频原样存入 Owlbear 自身资产空间，并由扩展直接回读、fetch 和播放。**
- 已完成：
  - 建立 React + TypeScript + Vite 项目与独立 Git 仓库。
  - 真实登录 Owlbear Rodeo 房间并检查当前账户储存：200 MB 上限，实验前已用约 58.2 MB。
  - 通过真实页面确认原生上传器只接受 JPEG/GIF/PNG/WebP/MP4/WebM；`.opus` 直接上传被拒绝。
  - 本地 `Owlbear Audio Lab v0.0.1` 已安装到真实账户和房间，SDK 握手成功。
  - 找到早期 `uploadImages()` 5 秒超时的真正原因：测试所在 Owlbear 标签页是 `document.visibilityState=hidden`；Chrome 会让 Owlbear 用于读取媒体 metadata 的隐藏 media element 长时间 stalled。换到真正 visible 的 Owlbear 房间后，同样预处理约 72 ms 完成，SDK 正常工作。
  - 原生 Asset Manager 已成功上传 `probe-av.webm`（16×16、1 fps、VP9 + Opus）；视频对象 POST 200、WebP 缩略图 POST 200、资产记录 POST 201。
  - SDK `OBR.assets.uploadImages()` 在 visible 房间中同样成功，并能打开 Owlbear 原生文件夹/标签选择流程；最终上传成功。
  - `OBR.assets.downloadImages()` 能取回该资产：MIME=`video/webm`、尺寸 16×16，并返回 `https://videos.owlbear.rodeo/...webm` CDN URL。
  - CDN URL 支持跨域读取（`Access-Control-Allow-Origin: *`）；扩展 `fetch()` 成功读回全部 48,390 bytes；`<audio>` 直接加载同一 WebM 成功，duration=6.008 s。
  - 从 Owlbear CDN 重新下载的文件经 `ffprobe` 仍含 VP9 + 48 kHz Opus；上传前后 SHA-256 完全一致，证明 Owlbear **不转码、不剥离音轨、不改原始 WebM 字节**，只另外生成缩略图。
  - 纯 audio-only WebM 已完成最终边界测试：SDK 能接收并进入媒体解析，但最终 `UPLOAD IMAGES` 报 `Unable to generate video thumbnail`，且不会进入对象存储 POST，因此不能作为可靠正式格式。
  - tiny-video 与 audio-only 的 6 秒测试文件仅相差 289 bytes；进一步实验已经把生产格式优化为 **仅 1 个 VP9 静态帧 + 完整 Opus**，无需让视频轨贯穿整首音乐。
  - 单帧 64×64 envelope 的 6 秒样本只比纯音频基准多约数百 bytes；10 分钟样本仍然只有 1 个视频 packet，证明视频成本不随时长线性增长。
  - 当前生产封面使用 64×64 深色底 + 5 根均衡器柱；真实 Owlbear 自动生成的 WebP 缩略图约 726 B，能明显区别于坏文件式黑块而几乎不影响容量。
  - 验证资产可见性：上传为 `ATTACHMENT` 的媒体会出现在当前 Collection 的 Attachments 资源栏，因此不能把 Default 当隐藏 bucket。
  - 已在真实 Owlbear 创建 `Owlbear Audio` Collection，并验证上传到该 Collection 的媒体不会出现在 Default；用户仍能主动进入 Collection 手工查看/删除，兼顾“默认不打扰”和“故障可恢复”。
  - CDN 对本次 `Range: bytes=0-1023` 请求返回 200 和完整文件，而非 206 部分内容；后续大文件 seek / Hot Cue 设计需要继续评估这一点。
  - 完成 `docs/PRODUCT-DESIGN.md`，正式固定 DJ / QLab / Ableton 三类范式与 Live / Director / Advanced 三层 UI 思路。
  - 完成 `docs/STORAGE-FORMAT.md`：固定单帧 VP9 + Opus、音频图标封面和 Collection 隔离策略。
  - 完成 `docs/SDK-UI-ARCHITECTURE.md`：确定 Action / Background / Modal / Tool Action / Popover / Context Menu / Tool Mode 的职责边界。
- 正在做：**Phase 1 Playback Core 已开始。** 当前首先搭建统一数据模型和本地播放 runtime，并用真实 Owlbear 验证 Action iframe、background page 与浏览器 autoplay/user-activation 的生命周期边界。
- 下一步：
  1. 建立 Asset / Clip / Cue / Bus / Scene 类型与 transport state。
  2. 建立 Music / Ambience / SFX / Master Web Audio graph 和 preload/play/pause/stop/seek/loop/crossfade 基础能力。
  3. 实测 Action popover 收起后 Action iframe 是否持续播放，以及 reload/hidden 后恢复行为。
  4. 增加 `background_url` coordinator probe，验证 user gesture 能否解锁 background audio；据此确定唯一 playback owner。
  5. 再进入 Broadcast GM-authoritative transport、玩家同步和 CDN 长媒体 seek 测试。

## 关键决策与理由（防止“吃书”）

- 决策A：项目名暂定 `owlbear-audio`。（原因：清晰、与现有 OBR2 项目并列，后续可再定正式产品名。）
- 决策B：不以 Tracks 式“URL 歌单”作为产品中心，改用 Asset / Clip / Cue / Bus / Scene / Cue Stack 数据模型。（原因：更贴合跑团实时音响需求，也能同时容纳简易和高级工作流。）
- 决策C：重点借鉴 QLab 的 Cue Sequence / Cue Cart / Fade / Devamp，以及 DJ 软件的 Deck / Hot Cue / Loop / Mixer。（原因：剧场音响比普通音乐播放器更接近 DM 的实际工作。）
- 决策D：Action popover 只做临场控制；完整工作台使用 `OBR.modal.open({ fullScreen: true })`。（原因：Owlbear 官方 SDK 原生支持全屏 Modal，无需把复杂 UI 硬塞进左上角小窗。）
- 决策E：优先验证 WebM 承载 Opus 音频，而不是 PNG 藏数据。（原因：WebM 是 Owlbear 官方允许的资产类型，浏览器也原生支持，破坏性和维护成本远低于 polyglot/steganography。）
- 决策F：零后端优先，转码目标放在客户端；若使用 ffmpeg.wasm 必须按需懒加载。（原因：保持免费、易部署，同时避免临场控制台因大型 WASM 初始化变慢。）
- 决策G：生产媒体使用 **1 个 64×64 VP9 封面帧 + 完整 Opus 的 WebM**，不再使用整首 1 fps 视频。（原因：Owlbear 只需要一帧生成 thumbnail，单帧成本 O(1)，且已经通过真实上传验证。）
- 决策H：媒体资产默认放入专用 `Owlbear Audio` Collection，而不是追求无法人工恢复的“完全隐藏”。（原因：Default 保持干净；插件损坏时用户仍能从 Owlbear 原生 Asset Manager 清理数据。）
- 决策I：UI 采用多 surface 组合：Action=Live Console，Full-screen Modal=Director/Studio，Tool Action=Scene 内极速 GO，Popover=Cue Cart；Background 先作为 coordinator，真实音频 owner 要等 autoplay 实验后决定。（原因：让每个 Owlbear 注入面做最擅长的事，同时保证只有一个播放 owner。）

## 常见坑 / 复现方法

- 坑1：`.opus` 即使通过 CDP 强行设置到文件输入，也会被 Owlbear 页面校验拒绝，并提示必须是 `.jpg/.gif/.png/.webp/.mp4/.webm`。
- 坑2：用 CDP 重复驱动原生文件输入时曾出现浏览器“file could not be read / permission”错误；因此后续存储验证改用扩展 SDK 直接传 `File | Blob`，减少文件选择器和 Chrome 文件句柄带来的干扰。
