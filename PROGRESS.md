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
  - tiny-video 与 audio-only 的 6 秒测试文件仅相差 289 bytes，说明保留极小视频轨的额外空间成本几乎可以忽略。
  - CDN 对本次 `Range: bytes=0-1023` 请求返回 200 和完整文件，而非 206 部分内容；后续大文件 seek / Hot Cue 设计需要继续评估这一点。
  - 完成 `docs/PRODUCT-DESIGN.md`，正式固定 DJ / QLab / Ableton 三类范式与 Live / Director / Advanced 三层 UI 思路。
- 正在做：Phase 0 已从“能不能存”转向“把可用存储通道工程化”：确定正式封装规格、索引策略、批量导入体验与播放/同步核心。
- 下一步：
  1. 固定生产封装为 **极小视频轨 + Opus 的 WebM**，测试更长时长下视频轨实际开销，并找最稳妥的最小分辨率/帧率/编码参数。
  2. 研究 Owlbear 上传确认界面能否减少重复操作，以及 `typeHint` / 文件夹 / 标签的最佳组织方式。
  3. 验证 CDN URL 跨重新载入、跨玩家、跨会话的稳定性，并决定索引需要保存 URL 还是可重新解析的资产引用。
  4. 开始 Phase 1：Web Audio 播放核心、Bus / Clip / Cue / Scene 数据模型与 GM authoritative 同步。

## 关键决策与理由（防止“吃书”）

- 决策A：项目名暂定 `owlbear-audio`。（原因：清晰、与现有 OBR2 项目并列，后续可再定正式产品名。）
- 决策B：不以 Tracks 式“URL 歌单”作为产品中心，改用 Asset / Clip / Cue / Bus / Scene / Cue Stack 数据模型。（原因：更贴合跑团实时音响需求，也能同时容纳简易和高级工作流。）
- 决策C：重点借鉴 QLab 的 Cue Sequence / Cue Cart / Fade / Devamp，以及 DJ 软件的 Deck / Hot Cue / Loop / Mixer。（原因：剧场音响比普通音乐播放器更接近 DM 的实际工作。）
- 决策D：Action popover 只做临场控制；完整工作台使用 `OBR.modal.open({ fullScreen: true })`。（原因：Owlbear 官方 SDK 原生支持全屏 Modal，无需把复杂 UI 硬塞进左上角小窗。）
- 决策E：优先验证 WebM 承载 Opus 音频，而不是 PNG 藏数据。（原因：WebM 是 Owlbear 官方允许的资产类型，浏览器也原生支持，破坏性和维护成本远低于 polyglot/steganography。）
- 决策F：零后端优先，转码目标放在客户端；若使用 ffmpeg.wasm 必须按需懒加载。（原因：保持免费、易部署，同时避免临场控制台因大型 WASM 初始化变慢。）

## 常见坑 / 复现方法

- 坑1：`.opus` 即使通过 CDP 强行设置到文件输入，也会被 Owlbear 页面校验拒绝，并提示必须是 `.jpg/.gif/.png/.webp/.mp4/.webm`。
- 坑2：用 CDP 重复驱动原生文件输入时曾出现浏览器“file could not be read / permission”错误；因此后续存储验证改用扩展 SDK 直接传 `File | Blob`，减少文件选择器和 Chrome 文件句柄带来的干扰。
