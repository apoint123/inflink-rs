# InfLinkApi 使用文档

`window.InfLinkApi` 是 InfLink-rs 暴露给其他 BetterNCM 插件使用的全局接口，用于读取当前播放状态、控制播放，以及订阅播放相关事件。

## 可用性

- 只有在 InfLink-rs 已安装并成功初始化后，`window.InfLinkApi` 才会存在。
- 该接口由运行中的 InfLink-rs 动态挂载到 `window` 上，因此调用前必须先判空。
- `version` 和 `audioDataUpdate` 事件从插件版本 `3.2.11` 开始提供。

```ts
const api = window.InfLinkApi;

if (!api) {
	console.warn("InfLink-rs 未安装或尚未初始化完成");
} else {
	console.log("InfLink-rs version:", api.version);
}
```

## TypeScript 类型提示

项目内提供了类型定义文件：`packages/frontend/src/types/api.d.ts`

如果你在开发其他插件，可以直接复制这份文件到自己的项目中，随后即可获得 `window.InfLinkApi` 的完整类型提示。

## manifest.json 配置建议

如果你的插件依赖 `window.InfLinkApi`，建议在自己插件的 `manifest.json` 中同时添加 `loadAfter` 和 `requirements` 字段，并在这两个数组里都加入 `"InfLinkrs"`。

```json
{
	"loadAfter": ["InfLinkrs"],
	"requirements": ["InfLinkrs"]
}
```

即使已经配置了这两个字段，运行时仍然建议对 `window.InfLinkApi` 做判空处理，以免 InfLink-rs 初始化失败或出现其他问题。

## 快速示例

下面的示例展示了如何读取当前歌曲信息、控制播放，并正确订阅和移除事件监听器。

```ts
const api = window.InfLinkApi;

if (!api) {
	throw new Error("InfLink-rs 不可用");
}

const currentSong = api.getCurrentSong();
console.log("当前歌曲:", currentSong?.songName ?? "无");

if (api.getPlaybackStatus() === "Paused") {
	api.play();
}

const onTimelineUpdate = (event: CustomEvent<{ currentTime: number; totalTime: number }>) => {
	const { currentTime, totalTime } = event.detail;
	console.log(`播放进度 ${currentTime} / ${totalTime}`);
};

api.addEventListener("timelineUpdate", onTimelineUpdate);

// 在插件卸载或页面销毁时移除监听
api.removeEventListener("timelineUpdate", onTimelineUpdate);
```

## 读取状态

### `getPlaybackStatus(): "Playing" | "Paused"`

返回当前播放状态。

### `getCurrentSong(): SongInfo | null`

返回当前歌曲信息；如果当前没有可用歌曲信息，则返回 `null`。

`SongInfo` 字段如下：

| 字段         | 类型                  | 说明                                   |
| ------------ | --------------------- | -------------------------------------- |
| `songName`   | `string`              | 歌曲名                                 |
| `albumName`  | `string`              | 专辑名                                 |
| `authorName` | `string`              | 艺术家名，多位艺术家时使用 ` / ` 连接  |
| `cover`      | `CoverInfo \| null`   | 封面信息，可能同时包含 `blob` 和 `url` |
| `ncmId`      | `number`              | 网易云歌曲 ID                          |
| `duration`   | `number \| undefined` | 歌曲时长，单位毫秒                     |

### `getTimeline(): TimelineInfo | null`

返回当前播放进度，字段如下：

| 字段          | 类型     | 说明               |
| ------------- | -------- | ------------------ |
| `currentTime` | `number` | 当前进度，单位毫秒 |
| `totalTime`   | `number` | 总时长，单位毫秒   |

### `getPlayMode(): PlayMode`

返回当前播放模式：

| 字段          | 类型                                  | 说明             |
| ------------- | ------------------------------------- | ---------------- |
| `isShuffling` | `boolean`                             | 是否开启随机播放 |
| `repeatMode`  | `"None" \| "Track" \| "List" \| "AI"` | 当前循环模式     |

### `getVolume(): VolumeInfo`

返回当前音量和静音状态：

| 字段      | 类型      | 说明                      |
| --------- | --------- | ------------------------- |
| `volume`  | `number`  | 音量，范围 `0.0` 到 `1.0` |
| `isMuted` | `boolean` | 是否静音                  |

## 播放控制

以下方法都会直接向网易云音乐发送控制命令：

| 方法                  | 说明                                                         |
| --------------------- | ------------------------------------------------------------ |
| `play()`              | 播放                                                         |
| `pause()`             | 暂停                                                         |
| `stop()`              | 停止                                                         |
| `next()`              | 下一首                                                       |
| `previous()`          | 上一首                                                       |
| `seekTo(positionMs)`  | 跳转到指定位置，单位毫秒                                     |
| `toggleShuffle()`     | 切换随机播放                                                 |
| `toggleRepeat()`      | 按顺序播放 -> 列表循环 -> 单曲循环的顺序切换                 |
| `setRepeatMode(mode)` | 直接设置循环模式，支持 `"None"`、`"Track"`、`"List"`、`"AI"` |
| `setVolume(level)`    | 设置音量，范围 `0.0` 到 `1.0`                                |
| `toggleMute()`        | 切换静音                                                     |

## 事件订阅

通过 `addEventListener(type, listener)` 订阅事件，通过 `removeEventListener(type, listener)` 取消订阅。移除监听时必须传入同一个函数引用。

### 事件列表

| 事件名              | 负载类型                | 说明                            |
| ------------------- | ----------------------- | ------------------------------- |
| `songChange`        | `SongInfo`              | 当前歌曲发生变化                |
| `playStateChange`   | `"Playing" \| "Paused"` | 播放状态变化                    |
| `timelineUpdate`    | `TimelineInfo`          | 节流后的播放进度更新，每秒 1 次 |
| `rawTimelineUpdate` | `TimelineInfo`          | 原始播放进度更新，频率更高      |
| `playModeChange`    | `PlayMode`              | 随机播放或循环模式变化          |
| `volumeChange`      | `VolumeInfo`            | 音量或静音状态变化              |
| `audioDataUpdate`   | `AudioDataInfo`         | 后端抛出的 PCM 音频数据         |

### 事件示例

```ts
const api = window.InfLinkApi;

if (!api) {
	throw new Error("InfLink-rs 不可用");
}

const onSongChange = (event: CustomEvent<{ songName: string; authorName: string }>) => {
	console.log("切歌:", event.detail.songName, event.detail.authorName);
};

const onVolumeChange = (event: CustomEvent<{ volume: number; isMuted: boolean }>) => {
	console.log("音量变化:", event.detail.volume, event.detail.isMuted);
};

api.addEventListener("songChange", onSongChange);
api.addEventListener("volumeChange", onVolumeChange);

// 清理
api.removeEventListener("songChange", onSongChange);
api.removeEventListener("volumeChange", onVolumeChange);
```

## 音频数据事件

> [!IMPORTANT]
> 音频数据自插件版本 3.2.11 后可用

> [!NOTE]
> 订阅音频数据可能会影响客户端性能

`audioDataUpdate` 适合做频谱、波形或音频分析。事件数据结构如下：

| 字段   | 类型          | 说明                                             |
| ------ | ------------- | ------------------------------------------------ |
| `data` | `ArrayBuffer` | 原始 PCM 数据，格式为 `48000Hz`、`int16`、双声道 |
| `pts`  | `number`      | 该段音频对应的时间戳，单位毫秒                   |
