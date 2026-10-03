---
"frontend": minor
---

feat: 支持点击系统媒体卡片的空白处把网易云音乐拉到前台

原先通过 `MediaPlayer` 的自动 SMTC 与会话交互，而媒体框架会把自造的隐形窗口写进会话，激活会话会把一个不可见窗口置前，看不到任何变化。现改用`ISystemMediaTransportControlsInterop::GetForWindow`，把插件自己建的隐藏顶层窗口写进会话，并在该窗口的窗口过程里把网易云主窗口置于前台。
