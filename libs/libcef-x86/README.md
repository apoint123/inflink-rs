# libcef-x86

网易云音乐 v2（32 位）用的 libcef 导入库，直接从客户端自带的 `libcef.dll` 生成。

上游 `BetterNCM/libcef` 子模块里的 `libcef.lib` 是某个历史遗留的极老版本 CEF 的导入库。
它缺失了 CEF 在后续版本中引入的大量现代 C-API，遗留了大量早已被 Chromium / CEF 
废弃并删除的历史陈旧符号，又混进了 `chrome_elf`、`libcef_dll_wrapper` 等其它模块的符号。
直接用它会出现「链接期找不到符号」或者「链接通过但运行时找不到入口点」两种情况，
因此 x86 目标改用这里的副本（见 `packages/backend/build.rs`）。

x64 目标仍然使用子模块里的 `libcef_x64.lib`，它的导出集合是完整的。

## 来源

`redist_packages/libcef.dll`，取自网易云音乐 `2.10.13.202675` 的 32 位安装包
（PE 机器类型 x86，导出 199 个命名符号，其中 `cef_*` 196 个）。

## 重新生成

```bat
dumpbin /exports libcef.dll > exports.txt
:: 保留 "ordinal hint RVA name" 表格里的 name 一列，生成：
::   LIBRARY libcef.dll
::   EXPORTS
::       <name>
lib /def:libcef.def /machine:x86 /out:libcef.lib
```

`libcef.def` 是这份导入库的源文件，也是唯一需要随网易云版本更新的东西：
换版本时重新导出 DLL 的导出表，覆盖 `libcef.def` 并重新执行上面第二条命令即可。
