use anyhow::{Context, Result};
use serde::Serialize;
use std::fmt::Write;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::OnceLock;
use std::sync::{LazyLock, Mutex};
use tracing::{Subscriber, error, trace};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::RollingFileAppender;
use tracing_subscriber::{
    EnvFilter, Layer, filter::LevelFilter, layer::SubscriberExt, util::SubscriberInitExt,
};

#[derive(Serialize)]
struct LogEntry {
    level: String,
    message: String,
    target: String,
}

struct LoggingCallback {
    v8_context: cef_safe::CefV8Context,
    v8_function: cef_safe::CefV8Value,
}

// Safety: renderer_post_task_in_v8_ctx 确保了对这些对象的操作会在相同的线程上执行
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for LoggingCallback {}

static LOGGING_CALLBACK: LazyLock<Mutex<Option<LoggingCallback>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn register_callback(v8_func_ptr: *mut cef_safe::cef_sys::_cef_v8value_t) {
    clear_callback();

    let callback_result =
        unsafe { cef_safe::CefV8Value::from_raw(v8_func_ptr) }.and_then(|v8_function| {
            cef_safe::CefV8Context::current().map(|v8_context| LoggingCallback {
                v8_function: v8_function.clone(),
                v8_context,
            })
        });

    let mut guard = match LOGGING_CALLBACK.lock() {
        Ok(guard) => guard,
        Err(e) => {
            error!("LOGGING_CALLBACK 锁中毒: {e}");
            return;
        }
    };

    match callback_result {
        Ok(callback) => {
            *guard = Some(callback);
        }
        Err(e) => {
            eprintln!("JS 日志回调注册失败: {e}");
            *guard = None;
        }
    }
}

pub struct FrontendTracingLayer;

impl<S> Layer<S> for FrontendTracingLayer
where
    S: Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let maybe_context = match LOGGING_CALLBACK.lock() {
            Ok(guard) => guard.as_ref().map(|cb| cb.v8_context.clone()),
            Err(_) => return,
        };

        if let Some(context) = maybe_context {
            let metadata = event.metadata();
            let mut message_visitor = MessageVisitor::default();
            event.record(&mut message_visitor);

            let log_entry = LogEntry {
                level: metadata.level().to_string(),
                message: message_visitor.message,
                target: metadata.target().to_string(),
            };

            if let Ok(log_json) = serde_json::to_string(&log_entry) {
                let post_result = cef_safe::renderer_post_task_in_v8_ctx(context, move || {
                    let Ok(guard) = LOGGING_CALLBACK.lock() else {
                        return;
                    };

                    if let Some(callback) = guard.as_ref() {
                        match cef_safe::CefV8Value::try_from_str(&log_json) {
                            Ok(arg) => {
                                if let Err(e) =
                                    callback.v8_function.execute_function(None, vec![arg])
                                {
                                    eprintln!("[InfLink-rs] JS 日志回调执行失败: {e}");
                                }
                            }
                            Err(e) => {
                                eprintln!("[InfLink-rs] 创建 V8 字符串失败: {e}");
                            }
                        }
                    }
                });

                if let Err(e) = post_result {
                    eprintln!("[InfLink-rs] 提交日志任务到 CEF 失败: {e}");
                }
            }
        }
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            if !self.message.is_empty() {
                self.message.push(' ');
            }
            let _ = write!(&mut self.message, "{}={:?}", field.name(), value);
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            if !self.message.is_empty() {
                self.message.push(' ');
            }
            let _ = write!(&mut self.message, "{}={}", field.name(), value);
        }
    }
}

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();
static FRONTEND_FILTER_LEVEL: LazyLock<Mutex<LevelFilter>> =
    LazyLock::new(|| Mutex::new(LevelFilter::INFO));

struct FrontendFilter;

impl<S: Subscriber> tracing_subscriber::layer::Filter<S> for FrontendFilter {
    fn enabled(
        &self,
        meta: &tracing::Metadata<'_>,
        _ctx: &tracing_subscriber::layer::Context<'_, S>,
    ) -> bool {
        FRONTEND_FILTER_LEVEL
            .lock()
            .is_ok_and(|guard| meta.level() <= &*guard)
    }
}

pub fn set_frontend_log_level(level_str: &str) -> Result<(), String> {
    let level = LevelFilter::from_str(level_str)
        .map_err(|e| format!("无效的日志级别 '{level_str}': {e}"))?;

    {
        let mut guard = FRONTEND_FILTER_LEVEL
            .lock()
            .map_err(|e| format!("FRONTEND_FILTER_LEVEL 锁中毒: {e}"))?;
        *guard = level;
    }

    trace!("前端日志级别已设置为 {level_str}");
    Ok(())
}

fn cleanup_old_logs(log_dir: &PathBuf, max_files: usize) {
    if let Ok(entries) = fs::read_dir(log_dir) {
        let mut log_files: Vec<_> = entries
            .filter_map(Result::ok)
            .filter(|e| {
                e.path().is_file()
                    && e.file_name().to_string_lossy().starts_with("inflink-rs.")
                    && e.file_name().to_string_lossy().ends_with(".log")
            })
            .collect();

        if log_files.len() <= max_files {
            return;
        }

        log_files.sort_by_key(fs::DirEntry::file_name);

        let files_to_delete_count = log_files.len() - max_files;

        for entry in log_files.iter().take(files_to_delete_count) {
            let path = entry.path();
            if let Err(e) = fs::remove_file(&path) {
                error!("删除旧日志文件 {path:?} 失败: {e}");
            }
        }
    }
}

pub fn init() -> Result<()> {
    let directive = "smtc_handler=trace"
        .parse()
        .context("硬编码的日志指令无效，这不应该发生")?;
    let default_filter = EnvFilter::builder()
        .with_default_directive(tracing::level_filters::LevelFilter::WARN.into())
        .from_env_lossy()
        .add_directive(directive);

    let mut log_path: Option<PathBuf> = None;

    let file_layer = dirs::data_dir().and_then(|mut path| {
        path.push("InfLink-rs");
        log_path = Some(path.clone());

        fs::create_dir_all(&path).ok()?;

        let rotation = tracing_appender::rolling::Rotation::DAILY;

        let file_appender = RollingFileAppender::builder()
            .rotation(rotation)
            .filename_prefix("inflink-rs")
            .filename_suffix("log")
            .max_log_files(7)
            .build(&path)
            .ok()?;

        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

        if LOG_GUARD.set(guard).is_err() {
            error!("Logger Guard 已经被初始化，不应重复调用 init()");
        }

        Some(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_filter(EnvFilter::new("trace")),
        )
    });

    let frontend_layer = FrontendTracingLayer.with_filter(FrontendFilter);

    tracing_subscriber::registry()
        .with(default_filter)
        .with(file_layer)
        .with(frontend_layer)
        .try_init()
        .context("无法初始化 Tracing subscriber")?;

    trace!("Tracing subscriber 已初始化");

    if let Some(path) = log_path {
        cleanup_old_logs(&path, 7);
    }

    Ok(())
}

pub fn clear_callback() {
    if let Ok(mut guard) = LOGGING_CALLBACK.lock()
        && guard.is_some()
    {
        *guard = None;
    }
}
