# Owlbear Audio Import Pipeline

## 目标

把本地常见音频文件变成 Owlbear Audio 的生产媒体，并让它最终拥有可跨玩家访问的 Owlbear CDN URL，同时不让转码器污染 Live Console 的启动路径。

用户主流程：

`Import from computer → browser transcode → Local only → Save to Owlbear → Link imported → Cue → Arm → GO`

其中普通用户默认只需要看到 `Music · 96 kbps`；Speech / Ambience / Archive 是可选 preset，不要求第一次导入先理解 codec / container / bitrate。

## 浏览器端生产转码

当前主路径使用 `mediabunny`，按需动态 import，只在 Studio 点击 Import 后加载。

输出规格：

- WebM container
- Opus audio
- 48 kHz
- 单个 64×64 VP9 cover frame，时间戳 t=0
- 生产封面为深色底 + 极简均衡器图标
- 视频轨只写 1 个 packet，不随音乐时长线性增长

Preset：

- Speech: 48 kbps
- Ambience: 64 kbps
- Music: 96 kbps（默认）
- Archive: 128 kbps

实测 6 秒 192 kbps MP3（145,196 B）转换为 96 kbps production WebM 约 76,959 B；ffprobe 确认 48 kHz Opus + 64×64 VP9，并且视频只有 1 packet。

`mediabunny` 被 Vite 分到独立 lazy chunk；Live / Player / Background runtime 不加载转码器。

## 去重

转码完成后对完整 production WebM 做 SHA-256，存入 `StudioAsset.contentHash`。

当前 Chrome 151 + Mediabunny 1.55.4 回归结果：同一个 MP3、同一个 preset 连续转码两次，输出 size、SHA-256 和全部二进制字节完全一致，因此当前 production WebM hash 可作为稳定重复导入指纹。

长期回归：`scripts/run-transcode-determinism-probe.mjs`。

## Local-only staging

转码成功后立即把 WebM `File` 放入 IndexedDB：

- DB: `owlbear-audio-library`
- store: `asset-blobs`

Studio draft 只保存 metadata / blob key，不把大 Blob 塞进 localStorage。

Local-only 素材允许继续参与 Prepare / Build；但没有正式 Owlbear URL 的 Cue 不允许安全进入跨玩家 Live。用户即使暂时取消 Save/Link，已经完成的转码也不会丢。

## Save to Owlbear 的真实 SDK 语义

`OBR.assets.uploadImages()` 返回 `Promise<void>`，不返回新 asset id / CDN URL。

更重要的是：真机实验表明 Promise resolve 的时间点是“宿主 Save / Select Folder UI 已经打开”，**不是**“用户已完成最终上传”。因此代码不得写成：

`await uploadImages() → 立即 downloadImages()`

否则会出现宿主 modal 重叠 / 时序错误。

生产 Save 完成的硬网络特征已经验证：

1. WebM object POST → 200
2. WebP thumbnail POST → 200
3. `user_assets` record POST → 201

生产文件已通过 Owlbear 原生 thumbnail/upload 全流程。

## Owlbear Audio Collection

媒体使用 `ATTACHMENT` 类型，并建议保存到专用 `Owlbear Audio` Collection。

理由：

- 不污染 Default Attachments；
- 不混入 Maps / Scenes / Characters；
- 插件损坏时用户仍能从 Owlbear 原生 Asset Manager 手工删除；
- 不依赖未公开的 private/hidden asset API。

当前公开 SDK 没有“创建/强制指定 Collection 后静默保存”的正式接口，因此 Save 仍需要用户在 Owlbear 原生窗口确认 Collection。

## Link imported

上传后还必须通过 `OBR.assets.downloadImages()` 拿回正式 Owlbear CDN URL。

SDK 无法从 `uploadImages()` 直接取得上传结果，所以 Link 是正式、可解释的第二阶段，而不是临时 workaround。

批量 UX：

`N 个文件批量转码 → 一次 Save to Owlbear → 一次 Link imported 多选`

不是每首歌单独弹两次窗口。

单个待 Link 素材使用 single-select：点击目标资产后直接返回 Studio，不再要求第二次点 SELECT；多个待 Link 素材才使用 multi-select + SELECT。

## Asset Picker Broker

### 为什么不能在 Studio 直接 downloadImages()

Full-screen Studio 本身由 `OBR.modal.open({ fullScreen: true })` 占用 Owlbear modal slot。

真机验证：在 Studio Modal 内直接调用 `downloadImages()` 会与宿主 Asset Picker 发生 nested-modal 冲突并失败。

因此所有 Asset Picker 操作统一代理到持久 Action iframe：

1. Studio 保存 draft / 当前选中 Cue；
2. Studio 发送 LOCAL picker request；
3. Studio 主动关闭；
4. Action broker 等待 modal slot 释放；
5. Action 调用 `downloadImages()`；
6. 结果写入 localStorage；
7. 等 Owlbear picker 完成关闭；
8. Action 自动重开 Studio；
9. Studio consume picker result，恢复原工作位置。

这条路径同时服务：

- `+ Owlbear`
- `Link imported`
- 未来 Replace Asset / Find Cover 等所有 Owlbear asset selection。

### picker 关闭竞态

`downloadImages()` resolve 时，宿主 picker 可能仍处于关闭动画。

Broker 返回 Studio 前必须短暂等待，并做有限 `OBR.modal.open()` 重试；结果先落 localStorage，所以重试不会丢用户工作。

### 多 Owlbear 标签页隔离

重要：`destination: "LOCAL"` 不能假定等价于“当前浏览器 tab”。同一个房间打开多个标签时，多张 Action broker 可能都收到同一 request。

因此 request 增加 `targetBrokerId`：

- broker id 保存于 `sessionStorage`；
- sessionStorage 按顶层 browsing context 隔离；
- 同一 tab 内 Action / Studio 共享；
- 不同 Owlbear tab 不共享；
- 非目标 broker 收到 request 后直接忽略。

这避免多个 tab 互相写入 `Another asset picker is already open` 或竞争覆盖 picker result。

## 回归状态

已实证：

- MP3 → production WebM 浏览器转码
- 单帧 VP9 / 48 kHz Opus
- production WebM 真 Owlbear upload / thumbnail / asset record
- Asset Picker Broker（Studio → Action → Picker → Studio）
- 已知云资产 Link 后写回真实 CDN URL
- production WebM 转码 determinism

仍需登录态恢复后补跑一次完整真实 E2E：

`local MP3 → Save → Link → duplicate re-import → +Cue → Arm → GO`

测试脚本：`scripts/run-import-link-live-probe.mjs`。
