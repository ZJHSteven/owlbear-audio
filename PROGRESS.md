# Owlbear Audio — 当前状态

更新时间：2026-09-09

## 当前结论

- 现状：v0.1.2 候选版已完成本地重构与自动化回归，正在做真实 Owlbear GM/PLAYER E2E。
- 已完成：Web Awesome 已完全移除；UI 改为和 Family AI 同源风格的 shadcn `base-nova` + neutral + Geist + Lucide。
- 已完成：隐藏 Background 仍是唯一 AudioEngine owner；Action 只是遥控器，关闭 Action 不销毁播放。
- 已完成：PLAYER 首次角色读取失败后永久 `role=null` 的恢复缺陷已修复。
- 已完成：顺序 / 单曲循环 / 列表循环 / 随机四种模式已经是 Background 的真实状态机行为。
- 正在做：部署新 Worker 后，在真实房间验证 GM→PLAYER 广播、late join、autoplay 手势、导入与播放。
- 下一步：真实双端 E2E 通过后再决定是否进入 v0.2（编辑标签、跨设备索引、更多高级跑团音频能力）。

## 第一阶段产品路线

### GM / DM

`打开 Action → 首次欢迎公告 → 音乐库 → 添加本地音频 → 浏览器转码 → Owlbear 原生保存 → 选回刚上传资产 → 播放/队列/分类 → 底部播放器控制`

主界面：

- 顶部只有“音乐库 / 设置”两个主 Tab。
- 左上角 Sheet 负责全部 / 音乐 / 氛围 / 音效 / 文件夹筛选，选择后自动收起。
- 中部是 Spotify 范式紧凑曲目列表：封面占位、标题、灰色元数据；Hover 后出现立即播放 / 下一首 / 加队列。
- 右上角“添加音频”打开批量导入 Dialog，不再永久占主页面空间。
- 底部固定播放器：音量、后退 15s、上一首、大圆播放/暂停、下一首、前进 15s、队列、播放模式。
- 播放模式：顺序、单曲循环、列表循环、随机。

### PLAYER

`打开 Action → 自动读取房间当前曲目 → 浏览器若阻止 autoplay 则点一次“启用声音” → 自动跟随 DM → 调自己的本机音量`

- 不暴露音乐库、队列、切歌、导入、删除等 GM 权限。
- 显示当前曲目、进度、Background 连接状态与本机音量。

## 技术架构

### UI

- React 19。
- shadcn/ui：`base-nova`、neutral、Tailwind CSS v4。
- Geist Variable。
- Lucide 图标；不手绘播放器 SVG。
- Owlbear Light/Dark 只映射 `.dark`，不把宿主品牌色灌进播放器，保持黑白灰视觉。

### 播放

- `background_url` iframe 内的 `BackgroundCoordinator` 是唯一播放协调器。
- `AudioEngine` 使用原生 `HTMLAudioElement`，规避移动端隐藏 iframe 中 `AudioContext.resume()` 长期 suspended 的历史问题。
- GM Action 通过 LOCAL broadcast RPC 控制 Background。
- GM 当前公开播放状态通过 Owlbear REMOTE broadcast 发给 PLAYER。
- Room metadata 保存公开 NOW checkpoint，支持 late join。
- heartbeat 5 秒只做低频漂移纠偏，不承担首次播放启动。

### 导入

- 浏览器本地 Mediabunny + WebCodecs 转码。
- 生产格式：Opus/WebM；为 Owlbear thumbnail 兼容保留极小视频封面轨。
- `uploadImages()` 调 Owlbear 原生保存器。
- 公开 SDK 不会在上传成功后返回新 Asset URL，因此同一次导入流程仍需 `downloadImages()` 由用户选回刚上传资产。
- 推荐但不强制使用专用 `Owlbear Audio` Collection；公开 SDK 没有自动创建 Collection 的接口。

## 2026-09-09 已完成修复

### PLAYER 初始化

- 旧问题：Background 只在启动时 `getRole()` 一次；若当次宿主握手失败，`role` 永久保持 `null`。
- 旧问题：PLAYER 即使收到远端 STATE，后续点 UNLOCK 时也只有 `role === PLAYER` 才重放 pending state，因此表现为“永远无法初始化”。
- 修复：增加 `OBR.player.onChange()` 持续角色来源。
- 修复：角色变化副作用统一由 `applyRole()` 处理。
- 修复：`ensureRole()` 在关键广播/UNLOCK 路径补重试。
- 修复：PLAYER 恢复角色后立即 hydrate room checkpoint + STATE_REQUEST + pending state drain。
- 修复：GM 收到 STATE_REQUEST 时先确保角色已解析，不再在 `role=null` 时静默丢包。

### 首播 5 秒延迟

- 根因：GM 第一次 GO 发生在 `getRole()` 完成前，第一次 authoritative STATE 被跳过，PLAYER 只能等 5 秒 heartbeat。
- 修复：所有需要 publish 的 GM 命令先 await role 初始化；首次播放不再依赖 heartbeat。

### 播放队列

- Runtime plan 现在包含完整 LOCAL queue 和 `startIndex`。
- Action 关闭后队列仍由 Background 持有。
- 四种播放模式真实生效：
  - SEQUENTIAL：自然结束进入下一首，队尾 STOP。
  - REPEAT_ONE：下沉为 `HTMLAudioElement.loop=true`。
  - REPEAT_ALL：队尾自然回到第一首。
  - SHUFFLE：Background 随机挑下一首，并避免立即重复当前项。

## 自动化验证

`npm run check` 当前通过：

- `npm run build`：通过。
- `npm run lint`：0 warning / 0 error。
- `run-audio-engine-state-probe.mjs`：
  - unlock 非阻塞；
  - 首播成功；
  - NotAllowedError 正确进入 blocked；
  - 用户手势后恢复。
- `run-player-late-join-state-probe.mjs`：
  - PLAYER 晚加入能追到 authoritative clock；
  - Pause 跟随；
  - Stop 清理；
  - autoplay blocked → gesture retry 恢复。
- `run-playback-mode-probe.mjs`：
  - sequential A→B→STOP；
  - repeat-one 不推进；
  - repeat-all C→A；
  - shuffle A→非 A。

## 本地视觉验证

- 加入仅 DEV 生效的 `?view=preview-gm` / `?view=preview-player`，不进入真实生产用户流程。
- 420×640 GM Action：主库无横向溢出。
- 首次欢迎 Dialog：通过。
- 左侧分类 Sheet：视觉通过；自动收起 bug 已在真实点击测试中发现并修复。
- 添加音频 Dialog：420×640 无横/纵溢出。
- 设置页：可滚动，底部 transport 固定。
- PLAYER 420×520：无溢出，连接状态/当前曲目/音量层级清晰。

## 当前部署

- Worker：`owlbear-audio`。
- Custom Domain：`https://owlbear-audio.zjhstudio.com/`。
- Manifest：`https://owlbear-audio.zjhstudio.com/manifest.json`。
- 当前线上仍是上一版 0.1.1；下一步将发布 0.1.2 候选版并做真实 Owlbear E2E。

## 已知平台限制

- Owlbear Asset `uploadImages()` 不返回新上传资产的 URL；当前无法彻底消除保存后的“选回刚上传资产”原生确认。
- Owlbear 公开 SDK 当前没有自动创建 / 切换 Collection 的 API。
- 音乐库索引仍保存在本机 localStorage；媒体本体在 Owlbear。跨设备完整索引同步尚未实现。
- Safari / iOS 的 autoplay 与后台媒体行为仍需真实设备验收。

## 暂不进入 v0.1 的高级功能

- Scene / Layer。
- Cue Stack / GO / HOLD / PANIC 产品 UI。
- Devamp / Loop Region。
- Cue Cart / SFX Pads。
- GM private Audition。
- Waveform / Hot Cue。
- Deck A/B、EQ、Filter、FX、Automation。



## Asset picker research (2026-09-09)
- Added docs/asset-storage-research.md covering raw upload RPC response, dedicated Audio Folder bulk re-index, and Scene Item/context-menu URL bridge.
- Public-API Scene Item route is the current first experiment; raw RPC remains an isolated research branch.
