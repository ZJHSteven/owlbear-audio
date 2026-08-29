# 项目状态快照

## 当前结论（必须最新）

- 现状：项目已初始化，正在进行 Phase 0 的 Owlbear 资产存储可行性验证。
- 已完成：
  - 建立 React + TypeScript + Vite 项目与独立 Git 仓库。
  - 真实登录 Owlbear Rodeo 房间并检查当前账户储存：200 MB 上限，已用约 58.2 MB。
  - 通过真实页面确认原生上传器只接受 JPEG/GIF/PNG/WebP/MP4/WebM。
  - 生成 6 秒 Opus / audio-only WebM / tiny-video WebM+Opus 三种探针。
  - 实测 `.opus` 直接上传被 Owlbear 前端拒绝。
  - 完成首版产品与架构 ExecPlan，确定“临场简单、编排完整、高级不阉割”的渐进式设计。
- 正在做：搭建最小 Owlbear SDK probe extension，绕过文件选择器不稳定因素，直接验证 WebM 资产上传、回读和音轨保留。
- 下一步：
  1. 安装 `@owlbear-rodeo/sdk`。
  2. 建立本地 manifest + CORS 配置。
  3. 在浏览器内生成/获取探针 Blob 并调用 `OBR.assets.uploadImages()`。
  4. 从 Owlbear 资产选择器重新取回并用 fetch / `<audio>` 验证。

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
