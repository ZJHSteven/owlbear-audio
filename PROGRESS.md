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
- 已完成 Phase 1 的关键运行时验证：**Background 已正式确定为唯一 Audio Host + local coordinator。** 全新 Room tab 初始 Background `userActivation=false/false`；Action 真实点击后经 LOCAL Broadcast，Background handler 内 `AudioEngine.unlock()` 成功令 `AudioContext=running`，随后 MUSIC channel 正常播放并 loop。
- 已建立正式 runtime RPC 骨架：`BackgroundCoordinator` / `BackgroundClient` / `runtime/protocol.ts`，支持 UNLOCK、PLAY、PAUSE、STOP、STOP_ALL、SEEK、SET_BUS_GAIN 以及 ACK/snapshot。
- 已建立可重复 clean-room CDP 回归脚本：每次新建独立 Owlbear Room tab，避免普通 reload 保留 sticky `hasBeenActive` 造成 autoplay 假阳性；测试完成自动关闭临时 tab。
- Action 已按 **Live UX** 重构为 NOW / NEXT / GO / HOLD / PANIC：首次没有节目时只给 `Try Demo` / `Open Studio` 两条明确路径；播放器式 Pause 与 Levels 退居第二层。Action iframe reload 后仍从 Background 自动恢复 NOW、NEXT、Pause 和 Bus gain。
- 新增 `docs/UX-FLOWS.md`，把 First Run / Prepare / Live 的用户旅程和验收标准固定下来；明确 UI 必须服务于任务流，而不是把内部 Asset/Clip/Deck 参数平铺给用户。
- Full-screen Studio 已从占位框升级为第一版真实 Director workflow：`1·FIND Library → 2·BUILD Cue Stack → 3·TUNE Inspector`。可从 Owlbear Asset Picker 选择多个 WebM 音频、加入本地 Library、`+ Cue`、排序/删除、编辑 Bus/Fade/Gain/Loop，再 `Arm for Live`。
- Runtime protocol 已加入 `RuntimePlan / LOAD_PLAN / GO / SET_HOLD`；Transport snapshot 现在包含 revision、plan、NOW、NEXT、cursor。真实 UX 回归已验证 `Studio → Arm → Enter Live → Action NEXT → GO` 全链路。
- 修正一个关键现场语义：Arm 新节目不会把正在播放的 NOW 从状态模型里抹掉；NOW 独立于新 Plan，第一条新 Cue 只成为 NEXT，GO 时才从现场 NOW 转入新节目。
- GM→PLAYER 同步已经落地：REMOTE 只广播当前公开的 NOW/phase/position/revision，不包含 NEXT/Cue Stack；PLAYER 首次 Enable Audio 后自动 seek 到 authoritative clock，不需要手工 Sync。
- PLAYER 极简 Console 已接入：只显示 NOW、同步/阻塞状态、本机音量和 Mute，不暴露 GM 的 GO/NEXT/Studio/私密编排。
- 双 tab 真机回归已覆盖 heartbeat、Pause、Resume、PANIC 与 A/B crossfade；REMOTE channel 按 Cue id 唯一，latest-wins 队列阻止陈旧 async state 反向覆盖，网络迟到时 position 与剩余 fade 时长都按 elapsed 补偿。
- Late join 已加入 Room metadata 公开 checkpoint：玩家初始化先读持久 NOW，再用 Broadcast/heartbeat 追实时状态。GM 已播放两个完整 loop 后新玩家加入，未解锁前即可看到 NOW；解锁后与 GM 实测漂移约 80 ms。185 秒 synthetic loop 时间解析数学回归误差为 0。
- 下一步：
  1. 客户端转码导入 + IndexedDB Library：本地音频 → Opus + 单帧 VP9 WebM envelope → Owlbear Audio Collection。
  2. 验证真实 Owlbear Asset Picker → Studio Library 的完整 UI 路径和 CDN URL 跨玩家/跨会话稳定性。
  3. Scene / Layer 与 Devamp / Loop Region，继续保持 Live UX 的 GO/EXIT LOOP 一击操作。
  4. Firefox/Safari/mobile 的 autoplay、background iframe 与媒体生命周期兼容测试。
  5. 再补 Cue Cart、Tool Action GO 与高级 Deck/Inspector。

## 关键决策与理由（防止“吃书”）

- 决策A：项目名暂定 `owlbear-audio`。（原因：清晰、与现有 OBR2 项目并列，后续可再定正式产品名。）
- 决策B：不以 Tracks 式“URL 歌单”作为产品中心，改用 Asset / Clip / Cue / Bus / Scene / Cue Stack 数据模型。（原因：更贴合跑团实时音响需求，也能同时容纳简易和高级工作流。）
- 决策C：重点借鉴 QLab 的 Cue Sequence / Cue Cart / Fade / Devamp，以及 DJ 软件的 Deck / Hot Cue / Loop / Mixer。（原因：剧场音响比普通音乐播放器更接近 DM 的实际工作。）
- 决策D：Action popover 只做临场控制；完整工作台使用 `OBR.modal.open({ fullScreen: true })`。（原因：Owlbear 官方 SDK 原生支持全屏 Modal，无需把复杂 UI 硬塞进左上角小窗。）
- 决策E：优先验证 WebM 承载 Opus 音频，而不是 PNG 藏数据。（原因：WebM 是 Owlbear 官方允许的资产类型，浏览器也原生支持，破坏性和维护成本远低于 polyglot/steganography。）
- 决策F：零后端优先，转码目标放在客户端；若使用 ffmpeg.wasm 必须按需懒加载。（原因：保持免费、易部署，同时避免临场控制台因大型 WASM 初始化变慢。）
- 决策G：生产媒体使用 **1 个 64×64 VP9 封面帧 + 完整 Opus 的 WebM**，不再使用整首 1 fps 视频。（原因：Owlbear 只需要一帧生成 thumbnail，单帧成本 O(1)，且已经通过真实上传验证。）
- 决策H：媒体资产默认放入专用 `Owlbear Audio` Collection，而不是追求无法人工恢复的“完全隐藏”。（原因：Default 保持干净；插件损坏时用户仍能从 Owlbear 原生 Asset Manager 清理数据。）
- 决策I：UI 采用多 surface 组合：Action=Live Console / 首次 Enable Audio，Full-screen Modal=Director/Studio，Tool Action=Scene 内极速 GO，Popover=Cue Cart；**Background=唯一 AudioEngine owner + local coordinator**。（原因：clean-room 真机实验已经证明 Action 的真实 gesture 可以通过 LOCAL Broadcast 解锁 Background 的 Web Audio；因此 UI 生命周期与 transport 生命周期可以彻底解耦。）

## 常见坑 / 复现方法

- 坑1：`.opus` 即使通过 CDP 强行设置到文件输入，也会被 Owlbear 页面校验拒绝，并提示必须是 `.jpg/.gif/.png/.webp/.mp4/.webm`。
- 坑2：用 CDP 重复驱动原生文件输入时曾出现浏览器“file could not be read / permission”错误；因此后续存储验证改用扩展 SDK 直接传 `File | Blob`，减少文件选择器和 Chrome 文件句柄带来的干扰。
