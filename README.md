# InfLink-rs

一个基于 InfinityLink 的二改版本，使用 TypeScript + Rust 编写。

仅支持网易云 v3 版本。网易云音乐 v2 版本使用原版 InfinityLink 即可。

目前仅在 `3.1.20 (build: 204558) Patch: f84632d` 版本上测试正常，其它版本不保证能用

> [WARNING!]
> 不要与原版 InfLink 混用，混用可能导致奇奇怪怪的问题

## 支持上传到 SMTC 的信息

* 播放状态 (暂停或播放)
* 曲目信息
  * 歌曲名
  * 艺术家名 (使用 ` / ` 连接多个艺术家)
  * 专辑名
  * 封面 (目前上传原图，可能比较巨大)
* 播放进度 (每秒更新一次，精确到 1 厘秒)
* 随机模式 (是或否)
* 循环模式 (单曲循环、列表循环、顺序播放)

## 支持的 SMTC 控制能力

* 上一首
* 下一首
* 播放
* 暂停
* 跳转
* 随机播放
* 循环播放

**注意**: 网易云音乐把随机和循环模式做到一个按钮里了，因此这两个按钮的工作方式比较特殊：

* 如果开启随机播放，就会固定开启列表循环。

* 如果已经开了随机播放，切换循环模式会退出随机播放并设置为顺序播放。

更多细节请自行点击这两个按钮来了解

## 使用方法

1. [安装 Betterncm 插件](https://github.com/std-microblock/BetterNCM-Installer/releases/latest)
2. 在 [Release 页面](https://github.com/apoint123/inflink-rs/releases/latest)下载最新版本
3. 将插件文件 (以 `.plugin` 结尾) 复制到 `C:\betterncm\plugins` 文件夹下 (或者你指定的自定义数据目录)
4. 重启网易云音乐