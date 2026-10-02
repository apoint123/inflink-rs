//! 手写的 CEF 引用计数回调所需的 `extern` 适配层。
//!
//! CEF 的 `CEF_CALLBACK` 在 Windows x86 上是 `__stdcall`, 其它目标是 C 调用约定,
//! 于是同一个函数体必须按对应约定各导出一份 —— 每个回调都要有一对 `#[cfg]` 分叉的
//! 薄包装。它们只做转发, 却很容易漏改, 而且**别指望 CI 发现**: CI 只跑 `x86_64`
//! host, x86 那一支写错了根本不会被编译。用宏集中生成, 把这份风险收进一个地方。

/// 为一组手写的 CEF 引用计数回调生成 `extern` 适配函数
///
/// 生成固定名字的 `base_add_ref` / `base_release` / `base_has_one_ref` /
/// `base_has_at_least_one_ref`, 以及列表中给出的业务回调; 调用方在自己模块里
/// 引用它们 (通常是填进某个 `_cef_*_t` 的 vtable)。
///
/// `$impl_module` 是承载函数体的模块, 它需要提供同名的 `base_*` 函数, 以及列表中
/// 列出的业务回调 (即函数体不含任何 `#[cfg]`, 只有这一层适配函数分叉)。
///
/// # 注意
///
/// 包装函数不能用 `extern "system"` 一处顶两边 —— 在 i686 上 `extern "system"`
/// 与 `extern "stdcall"` 虽然生成相同代码, 但**不是同一个类型**, 直接赋给 bindgen
/// 生成的字段类型会编译失败。
///
/// 调用时业务回调的参数列表**必须放在括号里** (写成 `cb, (a: T, b: U) -> R`):
/// 若写成 `cb(a: T, b: U) -> R`, rustfmt 会把它当成函数指针类型重写, 抹掉参数名。
macro_rules! cef_ref_counted_vtable {
    (
        $impl_module:ident
        $(, $callback:ident, ($($arg:ident : $arg_ty:ty),* $(,)?) -> $ret:ty)*
        $(,)?
    ) => {
        #[cfg(not(all(target_arch = "x86", target_os = "windows")))]
        unsafe extern "C" fn base_add_ref(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) {
            unsafe { $impl_module::base_add_ref(base) }
        }
        #[cfg(all(target_arch = "x86", target_os = "windows"))]
        unsafe extern "stdcall" fn base_add_ref(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) {
            unsafe { $impl_module::base_add_ref(base) }
        }

        #[cfg(not(all(target_arch = "x86", target_os = "windows")))]
        unsafe extern "C" fn base_release(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) -> i32 {
            unsafe { $impl_module::base_release(base) }
        }
        #[cfg(all(target_arch = "x86", target_os = "windows"))]
        unsafe extern "stdcall" fn base_release(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) -> i32 {
            unsafe { $impl_module::base_release(base) }
        }

        #[cfg(not(all(target_arch = "x86", target_os = "windows")))]
        unsafe extern "C" fn base_has_one_ref(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) -> i32 {
            unsafe { $impl_module::base_has_one_ref(base) }
        }
        #[cfg(all(target_arch = "x86", target_os = "windows"))]
        unsafe extern "stdcall" fn base_has_one_ref(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) -> i32 {
            unsafe { $impl_module::base_has_one_ref(base) }
        }

        #[cfg(not(all(target_arch = "x86", target_os = "windows")))]
        unsafe extern "C" fn base_has_at_least_one_ref(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) -> i32 {
            unsafe { $impl_module::base_has_at_least_one_ref(base) }
        }
        #[cfg(all(target_arch = "x86", target_os = "windows"))]
        unsafe extern "stdcall" fn base_has_at_least_one_ref(base: *mut $crate::cef_sys::_cef_base_ref_counted_t) -> i32 {
            unsafe { $impl_module::base_has_at_least_one_ref(base) }
        }

        $(
            #[cfg(not(all(target_arch = "x86", target_os = "windows")))]
            unsafe extern "C" fn $callback($($arg: $arg_ty),*) -> $ret {
                unsafe { $impl_module::$callback($($arg),*) }
            }
            #[cfg(all(target_arch = "x86", target_os = "windows"))]
            unsafe extern "stdcall" fn $callback($($arg: $arg_ty),*) -> $ret {
                unsafe { $impl_module::$callback($($arg),*) }
            }
        )*
    };
}

pub(crate) use cef_ref_counted_vtable;
