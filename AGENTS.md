# AI 开发助手行为准则

本文件是 InfLink-rs 项目的架构说明与开发规范，供 AI 开发助手作为上下文参考。

## 一、项目概述

**项目名称**：InfLink-rs

**项目简介**：
InfLink-rs 是一个为**网易云音乐**桌面客户端（基于 BetterNCM 插件框架）设计的插件，核心目标是打通网页版网易云客户端与 Windows 原生系统之间的桥梁。

项目采用 **TypeScript**（运行在客户端的 Chromium 环境中）与 **Rust**（运行于原生后端）的混合架构，从而实现原生的**系统媒体传输控件（SMTC）**集成：用户可以使用硬件媒体键控制播放、在 Windows 音量/媒体浮层中查看曲目信息，并可将播放状态同步到 **Discord Rich Presence（RPC）**。

### 主要功能

- **系统媒体传输控件（SMTC）集成**
  - **媒体键支持**：使用硬件上的播放、暂停、停止、上一首、下一首按键控制网易云客户端。
  - **原生 Windows 浮层**：在 Windows 音量/媒体浮层中显示当前歌曲标题、艺术家、专辑及高分辨率封面。
  - **时间轴同步**：与 Windows 界面同步播放进度条与时长，并支持从系统 UI 直接跳转进度。
  - **播放模式控制**：可直接从系统控件切换随机播放与循环模式。
- **Discord Rich Presence**
  - 自动更新 Discord 状态，展示当前播放的歌曲、艺术家与专辑。
  - 在 Discord 个人资料活动中显示专辑封面与进度条。
  - 提供「Listen」按钮，跳转到歌曲链接。
- **版本兼容（适配器）**
  - 内置 `v2adapter` 与 `v3adapter`，兼容不同版本/渲染引擎的网易云客户端（Legacy V2 与基于 React 的 V3）。
- **可配置 UI**
  - 在 BetterNCM 中提供设置面板。
  - 可开关 SMTC 与 Discord 功能、调整封面分辨率、管理日志级别。

## 二、工作原理

项目采用网易云前端（Chromium/V8）与原生后端（Rust）之间的双向通信架构。

### A. 前端层（TypeScript/React）

1. **状态提取（适配器）**：核心逻辑依赖 `v2/adapter.ts` 与 `v3/adapter.ts`，这些模块会把自己注入到网易云客户端内部。
   - **V3 适配器**：遍历 React Fiber 树，或使用内部 `dva` 工具定位 Redux store。通过订阅状态变更来检测切歌、音量变化与播放状态。
   - **V2 适配器**：与更老的混淆 API 端点（`playerInstance.KJ`）及不同的 Redux store 交互。
2. **事件监听**：适配器监听网易云内部的特定事件（进度更新、跳转操作），并归一化为标准的 `SongInfo` / `TimelineInfo` 格式。

### B. 原生桥梁（FFI 与 CEF）

1. **通信**：前端通过 `NativeBackend.ts` 调用 `ffi.rs` 暴露的原生函数与后端通信。
2. **线程安全**：`task.rs` 实现了在特定 CEF（Chromium Embedded Framework）线程（具体为 Renderer 线程）上执行 Rust 闭包的机制，确保 V8 上下文操作是线程安全的。
3. **V8 互操作**：`v8.rs` 负责 Rust 与 JavaScript 字符串/对象之间的数据类型转换。

### C. 后端层（Rust）

1. **SMTC 核心**：`smtc_core.rs` 驱动 Windows 系统媒体传输控件，其
   `SystemMediaTransportControls` 实例通过
   `ISystemMediaTransportControlsInterop::GetForWindow` 获取，并绑定到一个隐藏的顶层窗口上；
   该窗口由 `smtc_window.rs` 在自己的线程中创建（同时创建该窗口所需的消息泵）。
   - 接收来自前端的元数据更新并推送到 Windows 系统媒体传输控件。
   - 为 Windows 媒体按键设置事件处理器：按键被按下时触发回调，向前端发送消息以执行命令（如 `adapter.play()`）。
   - 将媒体会话绑定到插件自己的窗口，正是「点击媒体卡片空白区域可将网易云音乐带到前台」的原因：系统会激活会话中记录的窗口，而该窗口过程会把激活转发给应用主窗口。
2. **Discord RPC**：`discord.rs` 运行后台线程连接 Discord IPC，接收元数据/时间轴负载并更新用户活动状态，包含连接重试与防抖处理以避免触发速率限制。

## 三、技术栈

**前端：**

- **语言**：TypeScript
- **框架**：React
- **构建工具**：Vite
- **目标环境**：Chromium（CEF）/ BetterNCM

**原生后端：**

- **语言**：Rust
- **Windows API**：`windows` crate（媒体控件使用 WinRT/UWP 集成）
- **浏览器集成**：`cef-sys`（CEF 的原始绑定）、`cef-safe`（自定义 V8 封装）
- **Discord 集成**：`discord-rich-presence` crate
- **工具库**：`serde`（序列化）、`tracing`（日志）、`anyhow`（错误处理）

## 四、项目技术栈与环境

- **核心框架**：React + Chromium Embedded Framework
- **包管理器**：pnpm（不要使用 npm 或其他包管理器）
- **构建命令**：`pnpm build`
- **远程调试**：排查客户端启动、复现页面交互、读取运行时日志或验证插件 API 时，先读 [AI 远程调试指南](docs/remote-debugging.md)，按实机结果区分已验证项与仍需人工验证项。

## 五、代码风格与规范

### 1. Chromium Embedded Framework 框架特性规范

- **固定的环境**：此插件固定运行在 Chromium 91.2.2.0 上，必须使用支持的最新的 JS 语法、方法等，尽可能遵循支持范围内的最佳实践，无需考虑其他浏览器的兼容性。避免使用较新的、不支持的方法或 CSS 样式等。
- **原生桥梁**：全局环境中存在 `window.channel`，网易云音乐客户端使用它来进行前后端通信，`legacyNativeCmder` 或 v3 特有的 bridge 模块是对其的高层封装。更多注意事项参考 `global.d.ts`。

### 2. BetterNCM 环境相关

- **顶层 await**：BetterNCM 会将编译后的 JS 代码放在异步函数中，于网易云音乐的主页面（网易云音乐是一个单页应用）执行，因此你可以使用顶层 await 或者其他可以在异步函数体内使用的语法。
- **文件系统 API**：BetterNCM 向全局的 `betterncm.fs` 下注入了文件系统相关的 API，因此你可以在浏览器环境中直接操作用户电脑上的文件，详情参考 `betterncm.d.ts`。
- **全局 React 实例**：网易云使用的 React 版本 16.14 较旧，一般建议手动打包一个 React 进去以便和新的 UI 库兼容。除非不需要任何较新的 UI 库，此时才应该使用全局的 React 实例。

### 3. 逆向相关

由于此项目是一个注入到网易云音乐内的插件，因此不可避免地要进行逆向工程。需要理解网易云内部模块或原生调用时，由 AI 自主分析项目现有适配器、类型定义、客户端已加载的脚本及其调用链，并通过断点、日志和最小化实验验证。明确区分已证实的行为与待验证的推断，禁止随意猜测逆向细节。只有缺少关键资料或访问条件、无法继续判断时，才向用户提出具体问题。

访问网易云内部的对象或方法时，必须判空、使用可选链或空值合并操作符。定义 TS 类型时，尽量声明为可空的，除非它确实不可能不存在。
