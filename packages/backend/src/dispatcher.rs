use std::{
    sync::{
        Arc,
        LazyLock,
        Mutex,
        mpsc::{
            self,
            Receiver,
            Sender,
        },
    },
    thread,
};

use tracing::{
    error,
    warn,
};

use crate::{
    discord,
    model::{
        AppMessage,
        CommandResult,
        CommandStatus,
        SharedMetadata,
    },
    smtc_core::{
        self,
        SmtcContext,
    },
};

static GLOBAL_SENDER: LazyLock<Mutex<Option<Sender<AppMessage>>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn init() {
    let (tx, rx) = mpsc::channel();

    discord::init();

    thread::Builder::new()
        .name("dispatcher-thread".into())
        .spawn(move || {
            run_dispatcher_loop(&rx);
        })
        .expect("无法启动 Dispatcher 线程");

    if let Ok(mut guard) = GLOBAL_SENDER.lock() {
        *guard = Some(tx);
    }
}

pub fn shutdown() {
    if let Ok(guard) = GLOBAL_SENDER.lock() {
        if let Some(tx) = guard.as_ref() {
            if let Err(e) = tx.send(AppMessage::Shutdown) {
                error!("发送关闭信号失败: {e}");
            }
        } else {
            warn!("尝试关闭，但 Dispatcher 未初始化");
        }
    }
}

struct SmtcManager {
    ctx: Option<SmtcContext>,
}

impl SmtcManager {
    const fn new() -> Self {
        Self { ctx: None }
    }

    fn get_or_init(&mut self) -> Option<&mut SmtcContext> {
        if self.ctx.is_none() {
            match smtc_core::initialize() {
                Ok(ctx) => {
                    self.ctx = Some(ctx);
                }
                Err(e) => {
                    error!("SMTC 初始化失败: {e:?}");
                }
            }
        }
        self.ctx.as_mut()
    }

    fn shutdown(&mut self) {
        if let Some(mut ctx) = self.ctx.take() {
            let _ = smtc_core::set_enabled(&mut ctx, false);
        }
    }
}

fn run_dispatcher_loop(rx: &Receiver<AppMessage>) {
    let mut smtc_manager = SmtcManager::new();

    while let Ok(msg) = rx.recv() {
        match msg {
            AppMessage::UpdateMetadata(payload) => {
                let shared_meta = SharedMetadata(Arc::new(payload));

                discord::update_metadata(shared_meta.clone());

                if let Some(ctx) = smtc_manager.get_or_init()
                    && let Err(e) = smtc_core::update_metadata(ctx, &shared_meta)
                {
                    error!("更新 SMTC 元数据失败: {e:?}");
                }
            }
            AppMessage::UpdatePlayState(payload) => {
                discord::update_play_state(payload.clone());

                if let Some(ctx) = smtc_manager.get_or_init()
                    && let Err(e) = smtc_core::update_play_state(ctx, payload.status)
                {
                    error!("更新 SMTC 播放状态失败: {e:?}");
                }
            }
            AppMessage::UpdateTimeline(payload) => {
                discord::update_timeline(payload.clone());

                if let Some(ctx) = smtc_manager.get_or_init()
                    && let Err(e) =
                        smtc_core::update_timeline(ctx, payload.current_time, payload.total_time)
                {
                    error!("更新 SMTC 时间线失败: {e:?}");
                }
            }
            AppMessage::UpdatePlayMode(payload) => {
                if let Some(ctx) = smtc_manager.get_or_init()
                    && let Err(e) =
                        smtc_core::update_play_mode(ctx, payload.is_shuffling, &payload.repeat_mode)
                {
                    error!("更新 SMTC 播放模式失败: {e:?}");
                }
            }
            AppMessage::EnableSmtc => {
                if let Some(ctx) = smtc_manager.get_or_init()
                    && let Err(e) = smtc_core::set_enabled(ctx, true)
                {
                    error!("启用 SMTC 失败: {e:?}");
                }
            }
            AppMessage::DisableSmtc => {
                if let Some(ctx) = smtc_manager.get_or_init()
                    && let Err(e) = smtc_core::set_enabled(ctx, false)
                {
                    error!("禁用 SMTC 失败: {e:?}");
                }
            }
            AppMessage::EnableDiscord => discord::enable(),
            AppMessage::DisableDiscord => discord::disable(),
            AppMessage::DiscordConfig(cfg) => discord::update_config(cfg),
            AppMessage::Shutdown => {
                discord::disable();
                smtc_manager.shutdown();
                break;
            }
        }
    }
}

pub fn send_command(json: &str) -> String {
    let command: AppMessage = match serde_json::from_str(json) {
        Ok(cmd) => cmd,
        Err(e) => {
            return serde_json::to_string(&CommandResult {
                status: CommandStatus::Error,
                message: Some(format!("JSON 解析失败: {e}")),
            })
            .expect("序列化错误响应时出错");
        }
    };

    if let Ok(guard) = GLOBAL_SENDER.lock()
        && let Some(tx) = guard.as_ref()
    {
        if let Err(e) = tx.send(command) {
            return error_result(format!("发送消息到 Actor 失败: {e}"));
        }
        return serde_json::to_string(&CommandResult {
            status: CommandStatus::Success,
            message: None,
        })
        .expect("序列化成功响应时出错");
    }

    error_result("Dispatcher 未初始化".into())
}

fn error_result(msg: String) -> String {
    serde_json::to_string(&CommandResult {
        status: CommandStatus::Error,
        message: Some(msg),
    })
    .expect("序列化错误结果时出错")
}
