# InfLink-rs

为网易云音乐提供 SMTC 和 Discord RPC 支持。

## 使用方法

### 通过插件商店安装

1. [安装 Betterncm 插件](https://github.com/std-microblock/BetterNCM-Installer/releases/latest)
2. 在插件商店中找到并安装 InfLink-rs
3. 根据提示重启网易云音乐

### 手动安装
1. [安装 Betterncm 插件](https://github.com/std-microblock/BetterNCM-Installer/releases/latest)
2. 在 [Release 页面](https://github.com/apoint123/inflink-rs/releases/latest)下载最新版本
3. 将插件文件 (以 `.plugin` 结尾) 复制到 `C:\betterncm\plugins` 文件夹下 (或者你指定的自定义数据目录)
4. 重启网易云音乐

## 已测试的网易云音乐版本

仅在这些版本上进行了测试，其它版本不保证可以工作!

### V3 版本：

`3.1.20` ~ `3.1.23`

### V2 版本:

> [!CAUTION]
> 理论上只适配这一个最新的 V2 版本，其它版本大概率无法工作

`2.12.13 (build: 202675) Patch: 1:12f60b8`

## 支持上传到 SMTC 的信息

* 播放状态 (暂停或播放)
* 曲目信息
  * 歌曲名
  * 艺术家名 (使用 ` / ` 连接多个艺术家)
  * 专辑名
  * 封面 (分辨率可自选)
  * 歌曲 ID (包含在 “流派” 信息中，可用于精确匹配歌曲。格式为 `NCM-{ID}`)
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

## 更新日志

[**CHANGELOG.md**](./InfinityLink/CHANGELOG.md)

## 构建

先决条件：

* Node.js (v18+)
* pnpm
* Rust 工具链

1. 克隆仓库

```bash
git clone --recurse-submodules https://github.com/apoint123/inflink-rs.git
```

2. 安装构建目标

`i686-pc-windows-msvc` 目标用于构建适用于网易云音乐 v2 的原生插件

```bash
rustup target add x86_64-pc-windows-msvc
rustup target add i686-pc-windows-msvc
```

3. 安装依赖

```bash
pnpm install
```

4. 构建

```bash
pnpm build
```

这个命令会自动完成整个扩展 (包括前端和后端) 的构建，你可以在 `InfinityLink\dist` 找到构建产物