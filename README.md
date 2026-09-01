# Owlbear Audio

Owlbear Audio 是一个零后端优先的 Owlbear Rodeo 音频扩展。

v0.1 的目标很简单：让 GM 直接从电脑导入 MP3/WAV/M4A 等音频，浏览器本地转换后存进 Owlbear 自己的资产空间，再从同一个 Action 音乐库搜索和同步播放，不需要先找公网音频 URL。

## 安装

在 Owlbear Rodeo 的自定义扩展中添加：

`https://owlbear-audio.pages.dev/manifest.json`

## GM 使用流程

1. 打开左上角 **Owlbear Audio** Action。
2. 点 **从电脑导入**，选择音频。
3. 浏览器自动转为适合 Owlbear 存储的 Opus/WebM。
4. 在 Owlbear 原生保存窗口中选择专用的 **Owlbear Audio** 保存位置并上传。
5. 回到 Action，点 **完成导入**，选回刚上传的音频。
6. 之后可以搜索音乐并直接播放、暂停、停止和调节音量。

音乐默认循环；切换音乐使用短 equal-power crossfade。

如果媒体已经存在于 Owlbear，可直接点 **添加已有音频**，无需重新转码上传。

## PLAYER

玩家不管理音乐库，只看到 GM 当前播放的内容和自己的音量。

浏览器首次阻止自动播放时，玩家点一次 **启用声音**；之后会自动跟随 GM 当前播放位置。

## 为什么 manifest 里还有 Background？

Action 是唯一可见的产品入口。

`background_url` 只是在 Owlbear 内部运行的隐藏 AudioEngine / 同步 runtime。它的作用是：

- GM 关闭 Action 小窗后音乐仍然继续；
- Action 再打开时读取当前播放状态，而不是重新开始；
- GM 与 PLAYER 的播放状态可以持续同步。

用户不需要、也不应该直接打开 Background 页面。

## 存储格式

Owlbear 不能直接保存 `.opus`，纯 audio-only WebM 也无法生成缩略图。因此当前 production envelope 是：

- WebM container
- 48 kHz Opus audio
- exactly one 64×64 VP9 cover frame

这个单帧只用于让 Owlbear 正常生成 thumbnail，不会随着歌曲时长持续增加视频开销。

详细实验记录见：

- `docs/STORAGE-FORMAT.md`
- `docs/IMPORT-PIPELINE.md`
- `docs/PRODUCT-AUDIT.md`

## v0.1 暂不包含

- Scene / Layer
- Cue Stack / GO
- Devamp / Loop Region
- Cue Cart / Sound Pads
- GM private audition
- Waveform / Hot Cue
- Deck A/B
- EQ / Filter / FX / Automation

这些属于后续版本；在真正做成用户功能前不会计入完成度。

## 开发

```bash
npm install
npm run dev -- --host localhost --port 5199 --strictPort
npm run build
npm run lint
```

Cloudflare Pages 的生产项目为 `owlbear-audio`。
