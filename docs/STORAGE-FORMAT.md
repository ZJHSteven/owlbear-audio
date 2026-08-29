# Owlbear Audio — 媒体存储与资产隔离规格

## 1. 结论

Owlbear Audio 的生产媒体封装确定为：

- 容器：WebM
- 音频：Opus，48 kHz
- 视频：VP9，**仅 1 个静态关键帧**
- 封面尺寸：64 × 64
- MIME：`video/webm`
- Owlbear 资产类型提示：`ATTACHMENT`
- 资产 Collection：专用 `Owlbear Audio`

视频帧的目的不是播放画面，而是满足 Owlbear 视频资产导入器生成缩略图的要求。因此视频轨不能完全省略，但也完全没有必要贯穿整首音频。

---

## 2. 为什么不能直接存 `.opus`

真实 Owlbear 文件输入只接受 JPEG/GIF/PNG/WebP/MP4/WebM。实测强制选择 `.opus` 后，前端会立即以扩展名非法拒绝。

因此 `.opus` 不是可用的官方资产通道。

---

## 3. 为什么 audio-only WebM 也不能用

纯 Opus WebM 比裸 `.opus` 更进一步：

- `OBR.assets.uploadImages()` 能接收它；
- Owlbear 宿主能收到完整 File；
- Chromium 媒体解析器也能读到 Blob。

但在最终确认上传时，Owlbear 必须为视频资产生成缩略图。没有视频帧时真实页面明确报：

`Unable to generate video thumbnail`

随后不会产生对象存储 POST。

因此 **audio-only WebM 不是可靠生产格式**。

---

## 4. 单帧视频 Envelope

正确做法不是“每秒放一个黑帧”，而是：

1. 完整音频编码成 Opus；
2. 单独生成一个只有 1 帧的 VP9 WebM 封面；
3. 将 1 个视频 packet 和完整 Opus 音频无损 remux 到同一个 WebM；
4. 不使用 `-shortest`，让容器总时长由音频决定。

重要：不要直接在“同时编码音频+视频”的命令里用 `-frames:v 1`，实测这种写法会让 FFmpeg 提前结束整个输出，导致音频也被截短。生产实现必须保证视频编码与音频编码解耦，最后再 mux。

### 已验证数字

6 秒合成样本：

- audio-only WebM：约 50.9 KB
- 单帧 64×64 VP9 + 同一 Opus：约 51.1 KB
- 单帧封装增量：约数百 bytes
- 视频 packet：1
- 音频 packet：301

10 分钟合成样本：

- 视频 packet：仍然只有 1
- 音频 packet：30,001
- 总大小与 audio-only 基准基本相同；由于 WebM 重分簇，实际比较甚至可能略小

因此视频轨的时长相关成本可以视为 **O(1)**，不会随着 3 分钟、30 分钟、3 小时的音乐线性增长。

---

## 5. 封面规格

当前生产候选封面：

- 64 × 64
- 深色纯色背景
- 5 根简单均衡器柱
- 不使用字体
- VP9 lossless 单帧

原因：

- 全黑缩略图虽然体积最小，但在 Owlbear Attachments 中看起来像坏文件；
- 复杂封面和文字对 64×64 缩略图价值不大；
- 曲名已经由 Owlbear asset name 显示，无需把文字再烤进图片；
- 简单几何图标既能让用户一眼识别“这是音频资产”，又只增加极小字节数。

真实上传后 Owlbear 自动生成的 WebP thumbnail：

- 黑色单帧样本：约 558 B
- 当前均衡器图标样本：约 726 B

这个成本相对于数 MB 的音乐可以忽略。

未来可以允许：

- 默认统一音频图标；
- 可选从原媒体封面提取/降采样为第一帧；
- 不应为了视觉效果生成高分辨率视频帧。

---

## 6. Owlbear 服务端行为

已在真实账户完成上传→回读→重新下载验证：

- 原始 WebM 存入 Owlbear 的视频 CDN；
- Owlbear 另生成一份 WebP thumbnail；
- 重新下载原始 WebM 后字节大小一致；
- 上传前后 SHA-256 完全一致；
- VP9 视频轨和 Opus 音轨均保留；
- 服务端未重新编码、未剥离音频、未修改原文件；
- CDN `Content-Type` 为 `video/webm`；
- CDN允许跨域读取，扩展 iframe 的 `fetch()` 成功；
- `<audio src="...webm">` 可直接读取并播放其中 Opus 音轨。

### Range 注意事项

当前小样本对 `Range: bytes=...` 的测试返回完整 HTTP 200，而不是期望的 206 范围响应。

因此播放核心不能默认假设 CDN 支持高效字节 Range。后续需要用真实较大媒体验证浏览器 seek 行为。若大文件随机跳转会导致重复整文件下载，则 Hot Cue / seek 应优先依赖：

- 浏览器已经缓存的媒体；或
- IndexedDB / Cache Storage 中的本地副本；或
- 预加载后的 Blob URL。

---

## 7. Collection 隔离策略

### 已验证事实

`ATTACHMENT` 资产在 Owlbear 的普通 Attachments 快捷资源栏中是可见的；如果全部上传到 Default，音乐多起来会污染正常资源浏览。

Owlbear SDK 当前没有：

- 自定义隐藏 Asset Type；
- 私有 extension-only asset bucket；
- 通过 `OBR.assets` 直接创建 Collection；
- 通过 `OBR.assets` 任意枚举/删除用户资产。

因此不能依赖“插件内部完全不可见”的存储空间。

### 生产策略

使用 Owlbear 自己的 Collection：

`Owlbear Audio`

真实测试确认：

- 上传时可在 Owlbear 的 folder/collection picker 中选择 `Owlbear Audio`；
- 上传到该 Collection 的资产只在该 Collection 中显示；
- 切回 Default 后不会混入 Default Attachments；
- 用户若需要故障排查或插件已经无法工作，仍可主动进入 `Owlbear Audio` Collection 手工查看/删除媒体。

这是比“完全隐藏”更安全的设计：

> **默认不打扰，但永远可恢复、可人工清理。**

### 首次使用流程

因为 SDK 没有创建 Collection 的公开 API，正式产品应：

1. 首次导入时检测/提示存储位置；
2. 引导用户在 Owlbear picker 中创建或选择 `Owlbear Audio`；
3. 在本地设置中记录“已完成存储设置”；
4. 后续批量导入尽可能减少重复选择步骤；
5. 如果 Owlbear 不记住上次 Collection，则 UI 要明确提示用户继续选择 `Owlbear Audio`，不能假装已自动隔离。

后续要研究能否通过官方支持的工作流减少每次导入的 picker 摩擦，但不应调用未公开的 Supabase/内部 API 作为产品依赖。

---

## 8. Asset 命名与可清理性

建议 Owlbear asset name 使用明确前缀，例如：

`♫ <Track Name>`

或内部稳定前缀：

`[Owlbear Audio] <Track Name>`

内部索引同时保存：

- Owlbear 返回的媒体 URL / 可恢复信息
- 文件 hash
- 原始文件名
- 显示名
- duration
- bitrate
- loudness
- waveform cache key
- import time

如果插件索引损坏，用户仍可以凭 Collection + 名称辨识并清理这些资产。

---

## 9. Opus 码率初始预设

正式值需要用真实跑团素材做 ABX/主观验证，但第一版可以采用：

- Speech / Narration：32–48 kbps
- Ambience / texture：48–64 kbps
- General Music：80–96 kbps
- High Quality Music：128 kbps

建议默认 Music 96 kbps，Ambience 64 kbps。

单帧视频和缩略图的额外占用都远小于音频码率本身，因此优化重点应放在 Opus bitrate，而不是继续压几十到几百 bytes 的封面。

---

## 10. 生产验收条件

正式导入器必须满足：

- [x] WebM 被 Owlbear 接受；
- [x] 只有 1 个 VP9 frame 也能生成 thumbnail；
- [x] 音频可以持续到视频帧之后；
- [x] 服务端原样保存 WebM；
- [x] CDN URL 可以被扩展跨域 fetch；
- [x] 浏览器 `<audio>` 能读取 Opus；
- [x] 专用 Collection 能隔离 Default 资源库；
- [ ] 用真实音乐文件跑完整客户端转码；
- [ ] 验证长文件 seek / CDN Range / 浏览器缓存行为；
- [ ] 验证 Chrome / Firefox / Safari；
- [ ] 验证移动端；
- [ ] 确定客户端 Opus 编码和 WebM mux 的最终实现（WebCodecs 或 WASM）。
