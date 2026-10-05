---
"frontend": patch
---

fix: 修复播放部分本地音频时无法正确获取播放进度的问题

- 引入内部音轨唯一标识 `trackId`，修复因将十六进制哈希误当十进制解析而错误拦截底层进度事件（`PlayProgress`/`Seek`）的问题。
- 新增 `isSameSong` 判定工具，并移除已废弃的 `isSameSongId`；修复连续播放无在线匹配的本地音频（`ncmId` 皆为 0）时切歌识别失效及总时长错误的问题。
- 同步重构完善 V2/V3 适配器及 `useBackendConnection` 的本地音频识别与补发逻辑。
