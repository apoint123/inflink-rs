# AI 远程调试指南

适用于 Windows 上网易云音乐的启动排查、页面交互、前端日志和 InfLink-rs 插件接口验证。使用 Chromium DevTools Protocol（CDP）连接客户端自己的页面；先验证连接，再复现问题，最后记录结果并恢复测试状态。

## 1. 确认现场并启动

先读取根目录 `AGENTS.md`。调试已有功能时，优先使用 [InfLinkApi](./inflink-api.md)、项目已有适配器和可见页面控件。需要探索未确认的网易云内部模块或原生调用时，由 AI 自主分析项目代码、客户端已加载的脚本、类型定义与调用链，并通过 CDP 的断点、日志和最小化实验验证判断。区分已证实的行为与待验证的推断，不凭方法名猜测接口语义；只有缺少关键资料或访问条件、无法继续判断时才向用户询问。

在 PowerShell 中检查安装位置、版本、现有进程和端口：

```powershell
$ncmExe = 'C:\Program Files\NetEase\CloudMusic\cloudmusic.exe'
$debugPort = 9223
Get-Item -LiteralPath $ncmExe |
    Select-Object FullName, @{Name='版本'; Expression={$_.VersionInfo.FileVersion}}
Get-CimInstance Win32_Process -Filter "Name = 'cloudmusic.exe'" |
    Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine
Get-NetTCPConnection -State Listen -LocalPort $debugPort -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

- 安装位置未知时，从正在运行的进程或 Windows 卸载注册项定位，不遍历用户文件猜路径。
- 端口已有监听时，查明 `OwningProcess`。属于本次网易云调试会话则复用；属于其他程序则换空闲端口。
- 网易云已有实例但没有调试端口时，先说明需要重启，再完全退出客户端，包括托盘实例。新启动命令可能被旧实例接管，参数不会生效。
- 进程信息为空或退出操作报“拒绝访问”时，请用户手动完全退出；看到进程消失后再启动。不要把“启动命令返回成功”当成重启成功。

确认没有待复用或待退出的实例后启动：

```powershell
Start-Process -FilePath $ncmExe -ArgumentList @(
    "--remote-debugging-port=$debugPort",
    '--remote-debugging-address=127.0.0.1'
) -WindowStyle Hidden
```

`-WindowStyle Hidden` 是此次验证过的启动方式；客户端仍创建了可操作主窗口。需要桌面操作时，通过窗口工具选择并激活实际返回的网易云窗口。

**完成条件：** 新主进程的命令行包含调试参数，且下一节的接口能返回网易云信息。若触发客户端自动更新，等更新完成后重新检查版本、进程和端口，必要时再次带参数启动。

## 2. 发现并确认正确页面

```powershell
$debugBase = "http://127.0.0.1:$debugPort"
$version = Invoke-RestMethod "$debugBase/json/version" -TimeoutSec 5
$targets = Invoke-RestMethod "$debugBase/json/list" -TimeoutSec 5
$version | ConvertTo-Json
$targets | Select-Object id, type, title, url, webSocketDebuggerUrl
Get-NetTCPConnection -State Listen -LocalPort $debugPort |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

接口刚启动时可每秒重试一次，总等待不超过 15 秒；仍失败就检查进程、端口和更新状态。

按以下证据选择目标：

1. 监听地址为回环地址，监听进程为此次网易云主进程。只在本机连接，不将调试端口暴露到局域网。
2. `/json/version` 的 `User-Agent` 包含 `NeteaseMusicDesktop/`，记录客户端版本和 `Browser` 引擎版本。
3. 从 `/json/list` 选择 `type: "page"` 且标题、URL 对应网易云主界面的目标。本次为 `网易云音乐`、`orpheus://orpheus/pub/app.html`；多个候选时逐个读取标题和页面状态确认。
4. 使用该目标的 `webSocketDebuggerUrl`。`/json/version` 中的 `/devtools/browser/...` 是浏览器级连接，不能直接当作页面连接发送 `Runtime.evaluate`。

**完成条件：** 在选中的页面读到匹配的 `document.title`、`location.href` 和 `document.readyState`。目标 ID、WebSocket 地址、执行上下文 ID 都属于当前运行实例；重启或目标失效后重新发现。

## 3. AI 如何发送 CDP 命令

有支持连接现有 CDP 目标的工具时直接使用。不要用普通浏览器重新打开 `orpheus://` 来替代客户端页面。没有专用工具时，可使用本机 Node.js 24+ 自带的 `fetch` 和 `WebSocket`，无需安装依赖。

下面是可独立运行的只读探测程序。把 `targetId` 填为刚发现的主页面 ID；需要其他操作时在 `try` 内追加下节示例，所有操作共用当前连接。

```js
const base = "http://127.0.0.1:9223";
const targetId = "替换为刚发现的主页面 ID";
const response = await fetch(`${base}/json/list`, {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error(`发现目标失败：HTTP ${response.status}`);
const targets = await response.json();
const matches = targets.filter(t => t.type === "page" && t.id === targetId);
if (matches.length !== 1) throw new Error("目标不唯一或已失效，请重新发现");

const socket = new WebSocket(matches[0].webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let nextId = 0;
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id == null) {
    events.push(message);
    if (events.length > 100) events.shift();
    return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
socket.addEventListener("close", () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("CDP 连接已关闭"));
  }
  pending.clear();
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("CDP 连接超时"));
  }, 5000);
  socket.addEventListener("open", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    reject(new Error("CDP 连接失败"));
  }, { once: true });
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error("CDP 连接不可用"));
      return;
    }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}
try {
  await send("Runtime.enable");
  await send("Log.enable");
  console.log(await evaluate(`({
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    infLinkVersion: window.InfLinkApi?.version ?? null
  })`));
  // 在这里追加经过确认的操作与断言。
} finally {
  socket.close();
}
```

CDP 的响应通过 `id` 与请求对应；没有 `id` 的消息是事件，不能拿“下一条消息”直接作为命令结果。JavaScript 执行异常在 `exceptionDetails` 中，即使协议请求成功也必须判为失败。`returnByValue` 适合可序列化的小对象；返回 DOM 节点应改为提取文本、属性或尺寸。

## 4. 观察、操作、核验

每次先读当前 DOM 或截图，确认唯一目标，再执行一个有界操作，随后读取状态证明结果。选择器、焦点和坐标在页面变化后重新确认。下面的选择器来自本次实测，其他版本需重新检查。

### 页面和输入

在上节程序的 `try` 内使用 `evaluate` / `send`：

```js
// 先运行并检查结果，再决定是否执行后续操作。
console.log(await evaluate(`({
  choice: document.querySelector('#left_nav_choice')?.textContent.trim() ?? null,
  recommend: document.querySelector('#left_nav_recommend')?.textContent.trim() ?? null,
  inputs: Array.from(document.querySelectorAll('input[type=search]')).map(e => ({
    value: e.value,
    focused: document.activeElement === e
  }))
})`));
```

确认“精选”入口后，点击并等待可检查的页面状态：

```js
console.log(await evaluate(`(async () => {
  const entry = document.querySelector('#left_nav_choice');
  if (!entry) throw new Error('精选入口不存在');
  entry.click();
  for (let i = 0; i < 50; i++) {
    if (document.querySelector('#left_nav_choice')?.classList.contains('selected')
        && document.body.innerText.includes('排行榜')) return { selected: '精选' };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('精选页面未在 5 秒内就绪');
})()`));
```

本次切换页面后 URL 仍为 `orpheus://orpheus/pub/app.html`；成功标准是导航选中和内容变化。图片可能稍后加载，不能仅凭上述文字出现就宣称图片加载完成。

输入测试步骤：记录原值 → 确认唯一搜索框并聚焦 → 读取 `document.activeElement` 验证焦点 → `send("Input.insertText", { text: "远程调试验证" })` → 断言输入值相等。本次未按回车提交搜索。结束时选中本次插入的文本，通过 `Input.dispatchKeyEvent` 发送 `Backspace` 的 `rawKeyDown` / `keyUp`（`windowsVirtualKeyCode: 8`），并断言原值已恢复。若用户中途改了输入，先重新观察再决定清理方式。

需要真实鼠标输入时，从当前 `getBoundingClientRect()` 取中心点，依次发送 `Input.dispatchMouseEvent` 的 `mousePressed` 和 `mouseReleased`，指定 `button: "left"`、`clickCount: 1`。坐标使用页面视口的 CSS 像素；截图可能有设备像素缩放，本次 `devicePixelRatio` 为 2。

### 截图与日志

```js
const { writeFile } = await import("node:fs/promises");
const { join } = await import("node:path");
const { tmpdir } = await import("node:os");
const shot = await send("Page.captureScreenshot", { format: "png" });
const output = join(tmpdir(), `inflink-cdp-${Date.now()}.png`);
await writeFile(output, Buffer.from(shot.data, "base64"));
console.log(output);

// 单独验证控制台事件通道；真实问题应在启用监听后重现。
events.length = 0;
await evaluate("console.info('InfLink CDP 验证：日志通道正常')");
const received = events.some(e => e.method === "Runtime.consoleAPICalled"
  && e.params.args.some(arg => arg.value === "InfLink CDP 验证：日志通道正常"));
if (!received) throw new Error("没有收到验证日志事件");
console.log({ received });
```

使用图片查看工具检查保存结果；CDP 截图只覆盖该渲染目标，不包含所有原生弹窗或 Windows SMTC 界面。遇到原生窗口时改用桌面窗口工具观察。

排查前端时收集 `Runtime.consoleAPICalled`、`Runtime.exceptionThrown` 和 `Log.entryAdded`。`Runtime.enable` 可能重放旧控制台消息，复现前清空本地事件缓冲并记录起点。仅保留相关时段和字段，避免整页内容、账号数据或令牌进入仓库。只有排查网络问题时才启用 `Network`，按目标请求记录必要信息。

InfLink 前端日志标记为 `InfLink FE`，后端转发日志标记为 `InfLink BE`。日志级别设置见插件设置页；原生日志位置由 `packages/backend/src/logger.rs` 决定。CDP 能观察前端和已转发日志，Rust 原生崩溃、SMTC 和 Discord 的外部显示仍需对应日志或实机界面验证。

## 5. 验证本项目插件

先检查运行中的插件，再决定是否构建：

```js
console.log(await evaluate(`(() => {
  const api = window.InfLinkApi;
  if (!api) return { available: false, loadedPlugins: Object.keys(window.loadedPlugins ?? {}) };
  return {
    available: true,
    version: api.version ?? null,
    status: api.getPlaybackStatus?.() ?? null,
    timeline: api.getTimeline?.() ?? null,
    volume: api.getVolume?.() ?? null
  };
})()`));
```

接口缺失时检查所选页面、初始化日志和 BetterNCM 插件加载情况。端口连通或 `window.betterncm` 存在，均不能证明 InfLink-rs 已加载。

需要验证工作区改动时，查看 `package.json` 和 `packages/frontend/vite.config.ts` 的当前配置，再执行项目要求的构建与开发流程：

- `pnpm dev` 是 Vite 的监听构建，默认将产物同步到 `C:/betterncm/plugins_dev/InfLink-rs`，可由 `BETTERNCM_PLUGIN_PATH` 覆盖；它不提供一个用于调试的网页服务器。确认此位置对应本机 BetterNCM 数据目录。
- 读取完整构建输出，分别确认前端、目标架构 DLL 和同步成功；仅有 `dist` 文件或一次成功输出不足以排除后续复制失败。
- 文件同步不等于运行中的插件已更新。前端重载后重新验证 API 和行为；修改原生 DLL 时完全退出并重新带参数启动客户端。不要用 `Page.navigate` 把宿主页面导航走来尝试加载插件。
- `build:frontend` 或 `SKIP_RUST` 跳过 Rust 构建时，只能据实际产物声明前端验证，不能据此声称原生改动生效。插件版本也不一定随每次本地编辑变化，应结合构建产物和实际行为判断。

播放操作使用 [InfLinkApi 文档](./inflink-api.md) 中已有的方法，不直接猜测 `window.channel` 或 v3 bridge 调用。用户任务需要播放控制时，先记录歌曲、播放状态、进度和音量；订阅相关事件后操作，再通过事件和 getter 核验，不能把返回 `void` 当作成功。等待应有超时，监听器在 `finally` 中用原函数引用移除；结束时恢复本次改变的状态。`audioDataUpdate` 有性能成本，只在需要验证音频数据时订阅。

**完成条件：** 运行中的目标插件和本次构建对应；问题复现步骤有操作前后证据；需要的原生或外部表现已验证，或明确标记为待人工验证。

## 6. 收尾和报告

清理测试文本、临时 DOM 与事件监听，恢复本次改变的页面或播放状态，关闭自己的 WebSocket。关闭 WebSocket 不会关闭客户端调试端口；仅为排障临时开启端口的会话，结束后完全退出并普通启动客户端，再核验端口已关闭。用户仍要继续调试时，可以保留客户端并说明地址。

报告至少包含：客户端和引擎版本、所用端口和页面、每项操作的可观察结果、状态恢复情况、未验证项。截图与原始日志默认放系统临时目录，仓库只保存必要的脱敏结论。

## 实机记录：2026-10-02

| 检查项 | 结果                                                                |
| ------ | ------------------------------------------------------------------- |
| 客户端 | `3.1.41.205529`                                                     |
| 引擎   | `/json/version` 返回 `Chrome/91.0.4472.169`，协议 `1.3`             |
| 启动   | `--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1` |
| 监听   | `127.0.0.1:9223`，属于网易云主进程                                  |
| 页面   | `网易云音乐`，`orpheus://orpheus/pub/app.html`，就绪状态 `complete` |
| 截图   | `Page.captureScreenshot` 成功生成并检查 PNG，原图为 `2510 × 1670`   |
| 日志   | 收到本次主动输出的 `Runtime.consoleAPICalled` 验证消息              |
