# Changelog

## 3.2.6

### Patch Changes

- a4bab7c: refactor: 略微解耦 SMTC 功能和 Discord RPC 功能以允许只开启 Discord RPC 而关闭 SMTC
- db8e97b: feat: 添加暂停时继续显示 Discord 活动的选项
- 4169d62: fix: 适配 v2 客户端的主题变化

## 3.2.5

### Patch Changes

- b2385ed: fix: 修复一个死锁问题

## 3.2.4

### Patch Changes

- f9f854f: feat(discord): 添加 Discord RPC 支持

## 3.2.3

### Patch Changes

- 09551d7: fix: 优化劫持内置 SMTC 函数的方法，同时适配 3.1.22

## 3.2.2

### Patch Changes

- 52ec511: feat: 添加内部日志功能，优化设置界面
- 2621ade: refactor: 简化对内置 SMTC 的处理

## 3.2.1

### Patch Changes

- d1fdbff: feat: 适配网易云音乐 v3.1.21

## 3.2.0

### Minor Changes

- e1de576: refactor(v3): 使用另一个模块来订阅进度更新以避免和其它插件冲突
- fd16ef6: feat: 添加设置音量的功能
- d9eaff5: feat: 暴露一些公共接口

### Patch Changes

- 3aa8fbb: feat: 停止播放功能
- 6de55fc: feat: 新增调整封面分辨率功能
- 3a9a849: feat(v3): 启动应用时自动恢复上次的播放进度
- 8c7f675: feat: 使用客户端缓存来加速封面获取
- b250440: refactor: 改进播客的数据获取
- 3e82695: refactor: 优化日志显示

## 3.1.2

### Patch Changes

- 78a0838: fix(app): 修正更新提示

## 3.1.1

### Patch Changes

- 5570eba: fix(meta): 添加缺失的扩展元数据

## 3.1.0

### Minor Changes

- a7d4e3f: build: 修改构建脚本以便兼容两个网易云版本

### Patch Changes

- 80b0ecb: feat: 为发布到插件商店做准备

## 3.0.0

### Major Changes

- 9cbc9be: feat: 添加对网易云音乐 v2 的支持

  基本实现了针对网易云音乐 v2 的支持

### Minor Changes

- 9cbc9be: feat: 在 SMTC 中添加歌曲 ID

  在 SMTC 的“流派”字段添加了当前播放歌曲的 ID，格式为 `NCM-{ID}`，可用于精确匹配歌曲

### Patch Changes

- 9cbc9be: fix: 修复了一个后端的内存泄漏问题

  实际上是由 betterncm 导致的

- 9cbc9be: docs: 添加 GEMINI.md 以指导 AI

## [2.2.0](https://github.com/apoint123/inflink-rs/compare/v2.1.0...v2.2.0) (2025-10-01)

### ✨ Features

- 添加一些网易云音乐的内部工具 ([ac50564](https://github.com/apoint123/inflink-rs/commit/ac50564ae30723f0642a101419aa38eca01220d2))
- 增强日志 ([f7655f6](https://github.com/apoint123/inflink-rs/commit/f7655f6481e7890cbd16326bce2e3de028894b60))

### 🚚 Chores

- 不让 biome 扫描 target 目录 ([98d3c45](https://github.com/apoint123/inflink-rs/commit/98d3c45b628d128c9d2e4db73226e950763608e9))
- 移除弃用的类型包 ([880d5aa](https://github.com/apoint123/inflink-rs/commit/880d5aaec1b6ae25b91c795783a224e854ab6f0f))
- **deps:** 更新依赖 ([2dfd5f6](https://github.com/apoint123/inflink-rs/commit/2dfd5f661984183fc9fdb22ded73c1e095db3b42))

### 📚 Documentation

- 更新 README 文档 ([25580d1](https://github.com/apoint123/inflink-rs/commit/25580d14905af3668c73ff89ddb01cd40a718a87))
- 添加 playing/setPlayingPosition 中 duration 负载的说明 ([c424daf](https://github.com/apoint123/inflink-rs/commit/c424daf24c17559a929b61a4648a9ee291fbe132))

### ♻️ Code Refactoring

- 简化跳转操作 ([c8dfabc](https://github.com/apoint123/inflink-rs/commit/c8dfabcc8aa2c6f28c89e3aaa027483bbe4b2128))
- 提高获取 store 的稳定性 ([e245354](https://github.com/apoint123/inflink-rs/commit/e2453541e898db1de60a3f9b4c73e1c391016633))
- 提高切换播放模式的响应速度 ([50dfa88](https://github.com/apoint123/inflink-rs/commit/50dfa8855d0d03572817f3cd2c88bcb1f9d62fb0))
- 统一存放各个 action ([a410d27](https://github.com/apoint123/inflink-rs/commit/a410d273ea0a5ef0c6685977812c1278edf8ca08))
- 移除重复代码 ([a13421e](https://github.com/apoint123/inflink-rs/commit/a13421ebed602f1e5e1afff1f761a3137fae71a7))
- 优化 waitForReduxStore 的可读性 ([7a082ea](https://github.com/apoint123/inflink-rs/commit/7a082ea5e8ad54189ab2ff38522141ae59b763ae))
- 优化事件监听 ([0844908](https://github.com/apoint123/inflink-rs/commit/0844908fef44b2b66234b941ed2595436b8ad651))
- 优化 cef-safe crate ([045d210](https://github.com/apoint123/inflink-rs/commit/045d21087cce864c32358ca8c6c4f61287cc41fe))
- 优化 SMTC 初始化时的可靠性 ([1c23ab6](https://github.com/apoint123/inflink-rs/commit/1c23ab663a5a214685a66f99db844d294a6f544e))
- **provider:** 使用 Redux dispatch 替换 dom 操作 ([44876dc](https://github.com/apoint123/inflink-rs/commit/44876dcb9c51742a543e96547f833ecc72bf316c))

### 🐛 Bug Fixes

- 播放完毕后不要暂停歌曲 ([c0983e9](https://github.com/apoint123/inflink-rs/commit/c0983e92baa05a9d396dc3312c7029304645f0cf))
- 从事件获取播放模式而不是 dom ([b6e5e3e](https://github.com/apoint123/inflink-rs/commit/b6e5e3ea8be6c2a002487dbfd4132f395814c6f0))
- 等待 store 变得可用而不是播放栏 ([c0510bf](https://github.com/apoint123/inflink-rs/commit/c0510bf83da2ebfebd1182a2b9efbe4db36833ff))
- 将默认日志级别修改为 warn ([2972a5a](https://github.com/apoint123/inflink-rs/commit/2972a5afeb62b57483b5803abbfab38cb8f9e56b))
- 向后端传递 URL 而不是 base64 字符串以提高性能 ([e3a50c6](https://github.com/apoint123/inflink-rs/commit/e3a50c635948efbdb3e5088ebbe7004ad3c5a323))
- 修复刚启动时点击播放按钮的 undefined 错误 ([2ea9458](https://github.com/apoint123/inflink-rs/commit/2ea94585eef70f61b12ae3868d8f9d5fda190b68))
- 修复关闭时未清理监听器的问题 ([ceb8e60](https://github.com/apoint123/inflink-rs/commit/ceb8e607559c7e63bc4b08703cecf5762662755a))
- 修复跳转问题 ([3bcf25f](https://github.com/apoint123/inflink-rs/commit/3bcf25f0c6ffd492f0dcaeac68a885fe0a5fdc24))
- 修正错误的上一首和下一首负载 ([4fc085d](https://github.com/apoint123/inflink-rs/commit/4fc085d5e2066dda248ab49dae8b69a8907b1dd9))
- 异步获取封面以避免阻塞 ([c724ca7](https://github.com/apoint123/inflink-rs/commit/c724ca764efc41ae168bf219079bf1cd7ceaee52))
- 暂停后立刻更新 ([c361337](https://github.com/apoint123/inflink-rs/commit/c3613376db22e8faaed73b0b076d4dbc7d713f8a))
- dispatch 切换模式的 action 时附带 triggerScene 以免造成错误 ([a2c7dbb](https://github.com/apoint123/inflink-rs/commit/a2c7dbb5d53501dcf8340cf08c04347afa3aef93))
- typo ([1f34540](https://github.com/apoint123/inflink-rs/commit/1f345400463f398151ec41ebac3fc3d938e3a0dc))

## [2.1.0](https://github.com/apoint123/inflink-rs/compare/v2.0.1...v2.1.0) (2025-09-28)

### 🚚 Chores

- 统一版本 ([0fc3ad4](https://github.com/apoint123/inflink-rs/commit/0fc3ad448309b0b3aec60ae54b42665815984272))
- 修复行尾问题 ([9e9811e](https://github.com/apoint123/inflink-rs/commit/9e9811e543c13a8239fa5a4ba68b8e0416c54b97))

### ✨ Features

- 检查更新功能 ([b438758](https://github.com/apoint123/inflink-rs/commit/b4387584bf5476216bdb515269f4fc90e3bac5e4))
- 使用按钮代替超链接 ([d60d9b8](https://github.com/apoint123/inflink-rs/commit/d60d9b81a30e7495314108d49feddf00bd2ed634))
- 使用更好的字体 ([5781997](https://github.com/apoint123/inflink-rs/commit/57819979d8fae793e9d4245ac2453795ba88c307))

### ♻️ Code Refactoring

- 改进 API 注册 ([faecffc](https://github.com/apoint123/inflink-rs/commit/faecffc6e43f68626e7747b4e5b5772c896150d8))
- 优化前后端的数据结构 ([704a839](https://github.com/apoint123/inflink-rs/commit/704a83996088fee05d6b37ab2a56d2bc8abdf0cc))
- 优化日志记录 ([88f9abd](https://github.com/apoint123/inflink-rs/commit/88f9abd28a88d52fde8e6551661d78a856c58803))

### 2.0.1 (2025-09-27)

### ♻️ Code Refactoring

- 精简入口文件 ([8779678](https://github.com/apoint123/inflink-rs/commit/8779678fca47f9bc47d5d9c1de401b180ea48de5))
- 清理无用的代码 ([5b98037](https://github.com/apoint123/inflink-rs/commit/5b980378efec4595d8ae92ac8daff0260827b27b))
- 去掉复杂的声明合并 ([6b1bcb7](https://github.com/apoint123/inflink-rs/commit/6b1bcb787f0b4de5c8396cdffccdce4139bcc4d4))
- 实现回调式更新 ([a0624a3](https://github.com/apoint123/inflink-rs/commit/a0624a326cc083ec48e3c8faf5fb13081fa34ecd))
- 实现原生后端 ([6b81822](https://github.com/apoint123/inflink-rs/commit/6b81822fee247223e1910ba33a543d2d438fd561))
- 移除本就没有的网易云音乐 v2 支持，并优化随机和循环播放模式的设置 ([a5b115a](https://github.com/apoint123/inflink-rs/commit/a5b115a00e08efb66866471e12cf12c61b841a59))
- 优化前后端的事件传递和日志记录 ([9617e47](https://github.com/apoint123/inflink-rs/commit/9617e47ef871e3312b6cc8c004f2e4f0403b6db7))
- 整理代码 ([8ee9828](https://github.com/apoint123/inflink-rs/commit/8ee9828448df27fd0a2c2c6ed87e7a08985cd470))
- 整理代码，删除无用代码，更新依赖 ([c8026ca](https://github.com/apoint123/inflink-rs/commit/c8026ca0362a41181624a5d4b292ae12def28dc5))
- 整理类型定义文件 ([0d90ba1](https://github.com/apoint123/inflink-rs/commit/0d90ba18c0fd25cc8084df7505f70433ccf488b5))
- 重构和 cef 回调交互的部分 ([c7d8602](https://github.com/apoint123/inflink-rs/commit/c7d860265d68d8f3b41c910fae2868abead8ebf6))
- **backend:** 优化安全性 ([79fe394](https://github.com/apoint123/inflink-rs/commit/79fe3947ef733268632af67dde2444dad77c4d5e))

### 🚚 Chores

- 创建工作区 ([e7a9379](https://github.com/apoint123/inflink-rs/commit/e7a9379b6ca0bb79d954b318c88e310c91994674))
- 更新依赖 ([3736b6a](https://github.com/apoint123/inflink-rs/commit/3736b6a0079d05f41d1de71b47c2bf41b1830966))
- 加入约定式提交 ([b7f8e69](https://github.com/apoint123/inflink-rs/commit/b7f8e6928251657ff418ffa7af034ee06e35d921))
- 添加更新日志 ([7eb7362](https://github.com/apoint123/inflink-rs/commit/7eb73629c300246a5ed242ca36188d45794e09e5))
- 添加提交类别 ([f7e028a](https://github.com/apoint123/inflink-rs/commit/f7e028a28c883a5a35e3db4ece16b773a1cf0535))
- 修改协议类型 ([fd67d20](https://github.com/apoint123/inflink-rs/commit/fd67d20fc6b1bd370ef9a96c3ff7eb1401967e19))
- 修正 biome 配置 ([afe8a1f](https://github.com/apoint123/inflink-rs/commit/afe8a1f43c3b9d39d6177ddd9767a2fafecf71a5))

## 1.0.0 (2025-07-22)

发布第一个版本
