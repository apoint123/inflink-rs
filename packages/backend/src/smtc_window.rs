//! 承载 SMTC 会话的隐藏窗口。
//!
//! 定义激活会话：点击媒体控件上的空白区域会让 Windows 把该应用置于前台。
//!
//! 系统媒体控件激活会话最终执行的是 `SwitchToThisWindow(会话里记录的 HWND)`,
//! 所以能不能把网易云拉到前台, 等价于"会话里记的是哪个窗口"。`MediaPlayer` 的自动
//! SMTC 会把媒体框架自造的隐形窗口写进会话, 激活会话时会把一个不可见窗口置前, 用户
//! 什么也看不到。
//!
//! 使用 `ISystemMediaTransportControlsInterop::GetForWindow` —— 它是唯一能把
//! "自己的窗口"写进会话的公开入口。窗口必须是顶层窗口且属于调用进程, 但不必可见;
//! 会话建立后 shell 会把它当成"应用窗口"来激活, 我们在它的窗口过程里再把网易云主窗口
//! 顶到前台。
//!
//! 窗口和消息泵必须待在同一个线程上: 没有消息泵时 `SwitchToThisWindow` 的
//! `WM_ACTIVATE` 不会投递, 置前会静默失败。

use std::{
    sync::mpsc::{
        self,
        SyncSender,
    },
    thread::{
        self,
        JoinHandle,
    },
};

use anyhow::{
    Context,
    Result,
    anyhow,
};
use tracing::{
    debug,
    warn,
};
use windows::{
    Media::SystemMediaTransportControls,
    Win32::{
        Foundation::{
            HINSTANCE,
            HWND,
            LPARAM,
            LRESULT,
            RPC_E_CHANGED_MODE,
            WPARAM,
        },
        System::{
            LibraryLoader::GetModuleHandleW,
            WinRT::{
                ISystemMediaTransportControlsInterop,
                RO_INIT_MULTITHREADED,
                RoInitialize,
            },
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW,
            DefWindowProcW,
            DestroyWindow,
            DispatchMessageW,
            FindWindowW,
            GetMessageW,
            IsIconic,
            MSG,
            PostMessageW,
            PostQuitMessage,
            RegisterClassW,
            SW_RESTORE,
            SetForegroundWindow,
            ShowWindow,
            TranslateMessage,
            WA_INACTIVE,
            WM_ACTIVATE,
            WM_CLOSE,
            WM_DESTROY,
            WNDCLASSW,
            WS_EX_TOOLWINDOW,
            WS_POPUP,
        },
    },
    core::{
        PCWSTR,
        w,
    },
};

/// 会话窗口的类名
///
/// 窗口类是按进程注册的, 所以这个名字要足够独特, 免得和宿主进程里的其它窗口类撞上。
const WINDOW_CLASS: PCWSTR = w!("InfLink-rs SMTC window");

/// 网易云主窗口的类名 (`BetterNCM` 也用它定位主窗口)
const NCM_MAIN_WINDOW_CLASS: PCWSTR = w!("OrpheusBrowserHost");

/// 会话窗口的句柄
///
/// `HWND` 没有实现 `Send`, 但 Win32 本来就允许从任意线程给窗口投递消息 (这正是消息机制
/// 存在的意义), 而我们只把它用来投递 `WM_CLOSE` 让消息泵退出, 因此跨线程传递是安全的。
#[derive(Debug, Clone, Copy)]
struct SmtcWindow(HWND);

// Safety: 见上, 这个句柄只用于 PostMessageW。
unsafe impl Send for SmtcWindow {}

/// 承载会话的隐藏窗口, 以及跑在它上面的消息泵
#[derive(Debug)]
pub struct SmtcWindowHost {
    window: SmtcWindow,
    pump: Option<JoinHandle<()>>,
}

impl SmtcWindowHost {
    /// 起一条专用线程, 建出隐藏的顶层窗口并取回绑定在它上面的 SMTC
    ///
    /// 返回后那条线程会一直待在消息泵里, 直到 `Drop` 投递 `WM_CLOSE`。
    pub fn spawn() -> Result<(Self, SystemMediaTransportControls)> {
        let (sender, receiver) = mpsc::sync_channel(1);

        let pump = thread::Builder::new()
            .name("smtc-window".to_owned())
            .spawn(move || run_message_pump(&sender))
            .context("无法启动 SMTC 窗口线程")?;

        let (window, smtc) = match receiver.recv() {
            Ok(setup) => setup?,
            Err(_) => return Err(anyhow!("SMTC 窗口线程在报告结果前意外退出")),
        };

        debug!("SMTC 会话窗口已就绪");

        Ok((
            Self {
                window,
                pump: Some(pump),
            },
            smtc,
        ))
    }
}

impl Drop for SmtcWindowHost {
    fn drop(&mut self) {
        // 消息泵阻塞在 GetMessageW 上, 只能靠投递消息把它叫醒
        // Safety: 窗口句柄来自本结构体持有的会话窗口, 在 Drop 前一直有效
        if let Err(e) = unsafe { PostMessageW(Some(self.window.0), WM_CLOSE, WPARAM(0), LPARAM(0)) }
        {
            warn!("请求关闭 SMTC 会话窗口失败: {e:?}");
        }

        if let Some(pump) = self.pump.take()
            && let Err(e) = pump.join()
        {
            warn!("SMTC 窗口线程异常退出: {e:?}");
        }
    }
}

/// 窗口线程的主体: 建窗口、取 SMTC, 然后一直跑消息泵
fn run_message_pump(sender: &SyncSender<Result<(SmtcWindow, SystemMediaTransportControls)>>) {
    let (window, smtc) = match create_session_window() {
        Ok(setup) => setup,
        Err(e) => {
            // 接收端可能已经放弃等待了, 这时报错也无处可去
            let _ = sender.send(Err(e));
            return;
        }
    };

    if sender.send(Ok((window, smtc))).is_err() {
        // 主线程不再需要这个会话了, 拆掉窗口让消息泵自然结束
        // Safety: window 是刚创建、尚未销毁的顶层窗口
        let _ = unsafe { DestroyWindow(window.0) };
        return;
    }

    pump_messages();
}

/// 在当前线程上建出隐藏的会话窗口, 并取回绑定在它上面的 SMTC
fn create_session_window() -> Result<(SmtcWindow, SystemMediaTransportControls)> {
    initialize_apartment()?;

    let instance: HINSTANCE = unsafe { GetModuleHandleW(PCWSTR::null()) }
        .context("无法取得当前模块句柄")?
        .into();

    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: PCWSTR(WINDOW_CLASS.as_ptr()),
        ..Default::default()
    };

    // 窗口类是按进程注册的, 重复注册会以 ERROR_CLASS_ALREADY_EXISTS 失败;
    // 那说明这个进程里已经有会话窗口在用这个类了, 直接复用即可。
    // Safety: window_class 里的字符串活到本次调用结束, 且窗口过程是静态函数
    unsafe { RegisterClassW(&raw const window_class) };

    // 顶层窗口, 但从不 ShowWindow —— GetForWindow 只要求"顶层", 不要求可见
    // Safety: 类名已注册, 其余参数都是常量
    let window = unsafe {
        CreateWindowExW(
            WS_EX_TOOLWINDOW,
            PCWSTR(WINDOW_CLASS.as_ptr()),
            PCWSTR(WINDOW_CLASS.as_ptr()),
            WS_POPUP,
            0,
            0,
            10,
            10,
            None,
            None,
            Some(instance),
            None,
        )
    }
    .context("无法创建 SMTC 会话窗口")?;

    let smtc = get_smtc_for_window(window)?;

    Ok((SmtcWindow(window), smtc))
}

/// 让窗口线程进入 MTA
///
/// `windows` crate 在工厂调用遇到 `CO_E_NOTINITIALIZED` 时会自己补一次
/// `CoIncrementMTAUsage`, 但显式初始化更直白。线程已经在别的套间里时会返回
/// `RPC_E_CHANGED_MODE`, 那对本模块要用的 agile 对象没有影响。
fn initialize_apartment() -> Result<()> {
    match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        Ok(()) => Ok(()),
        Err(e) if e.code() == RPC_E_CHANGED_MODE => Ok(()),
        Err(e) => Err(anyhow!("RoInitialize 失败: {e:?}")),
    }
}

/// 取一个绑定在 `window` 上的 SMTC
///
/// `GetForWindow` 要求窗口是顶层窗口且属于调用进程, 满足之后会话里记的就是这个窗口,
/// 激活会话会把它置前。
fn get_smtc_for_window(window: HWND) -> Result<SystemMediaTransportControls> {
    let interop: ISystemMediaTransportControlsInterop = windows::core::factory::<
        SystemMediaTransportControls,
        ISystemMediaTransportControlsInterop,
    >()
    .context("无法取得 ISystemMediaTransportControlsInterop")?;

    // Safety: window 是本线程刚创建、尚未销毁的顶层窗口
    unsafe { interop.GetForWindow(window) }.context("GetForWindow 失败")
}

/// 会话窗口的窗口过程
///
/// 系统激活会话时执行的是 `SwitchToThisWindow(会话窗口)`, 所以真正"被置前"的是这个隐形
/// 窗口; 我们在收到激活通知时把网易云主窗口顶上来, 用户才会看到效果。
unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_ACTIVATE => {
            // 低 16 位是激活状态, 可能是 WA_ACTIVE 或 WA_CLICKACTIVE, 只有 WA_INACTIVE 表示失活
            if u32::from(wparam.0 as u16) != WA_INACTIVE {
                activate_ncm_window();
            }
        }
        WM_CLOSE => {
            // Safety: 消息来自本窗口, 句柄有效
            let _ = unsafe { DestroyWindow(window) };
            return LRESULT(0);
        }
        WM_DESTROY => {
            // Safety: 只是往本线程的消息队列里投一条 WM_QUIT
            unsafe { PostQuitMessage(0) };
            return LRESULT(0);
        }
        _ => {}
    }

    // Safety: 其余消息交回系统默认处理
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

/// 把网易云主窗口拉到前台
///
/// 此时我们刚被 shell 激活、持有前台权限, 所以 `SetForegroundWindow` 不会被前台锁挡住。
fn activate_ncm_window() {
    // Safety: 只是按类名查窗口, 类名是静态字符串
    let Ok(ncm) = (unsafe { FindWindowW(PCWSTR(NCM_MAIN_WINDOW_CLASS.as_ptr()), PCWSTR::null()) })
    else {
        warn!("响应激活会话命令时找不到网易云主窗口, 无法置前");
        return;
    };

    // Safety: ncm 是刚查到的有效窗口句柄
    let brought_to_front = unsafe {
        if IsIconic(ncm).as_bool() {
            let _ = ShowWindow(ncm, SW_RESTORE);
        }
        SetForegroundWindow(ncm)
    };

    debug!(
        ?brought_to_front,
        "响应激活会话命令, 请求将网易云主窗口置于前台"
    );
}

/// 消息泵
///
/// 没有它 `SwitchToThisWindow` 的 `WM_ACTIVATE` 不会投递到窗口过程, 置前会静默失败,
/// 因此这条线程必须一直转在这里。
fn pump_messages() {
    let mut message = MSG::default();

    // Safety: 标准消息循环
    while unsafe { GetMessageW(&raw mut message, None, 0, 0) }.as_bool() {
        unsafe {
            let _ = TranslateMessage(&raw const message);
            DispatchMessageW(&raw const message);
        }
    }

    debug!("SMTC 会话窗口的消息泵已退出");
}
