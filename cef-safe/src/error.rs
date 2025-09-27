use thiserror::Error;

#[derive(Error, Debug)]
pub enum CefError {
    #[error("从 CEF 函数接收到空指针")]
    NullPtrReceived,

    #[error("无法获取当前的 V8 上下文")]
    NoCurrentV8Context,

    #[error("向 CEF 任务运行器提交任务失败")]
    TaskPostFailed,

    #[error("创建 V8 {0} 值失败")]
    V8ValueCreationFailed(&'static str),

    #[error("V8 函数执行失败, JS 端可能有异常抛出")]
    V8FunctionExecutionFailed,

    #[error("CEF 字符串转换失败")]
    StringConversionFailed,

    #[error("V8 JS 异常: {message} 在 {script}:{line}:{column}")]
    V8Exception {
        message: String,
        script: String,
        line: i32,
        column: i32,
    },
}

pub type CefResult<T> = Result<T, CefError>;
