#[derive(Debug)]
pub struct CefV8Context(pub *mut sys::cef_v8context_t);

unsafe impl Send for CefV8Context {}

impl CefV8Context {
    pub fn is_in_context() -> bool {
        unsafe { sys::cef_v8context_in_context() != 0 }
    }

    pub fn current() -> Self {
        Self::get_current().unwrap()
    }

    pub fn get_current() -> Option<Self> {
        unsafe {
            let ctx = sys::cef_v8context_get_current_context();
            if ctx.is_null() { None } else { Some(Self(ctx)) }
        }
    }

    pub fn post_task<F: FnOnce() + Send + 'static>(&self, callback: F) {
        crate::task::renderer_post_task_in_v8_ctx(self.0, callback)
    }
}

use std::{
    error::Error,
    ops::{Deref, DerefMut},
    str::FromStr,
};

use crate::{CefString, sys};

#[derive(Debug, Clone)]
pub struct CefV8Value(pub *mut sys::cef_v8value_t);

unsafe impl Send for CefV8Value {}

/// 为了可以通过 [TryFrom::try_from] 特质实现类型检查而作，其余和 [CefV8Value] 并无差异
#[derive(Debug, Clone)]
pub struct CefV8Function(CefV8Value);

impl Deref for CefV8Function {
    type Target = CefV8Value;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for CefV8Function {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

/// 为了可以通过 [TryFrom::try_from] 特质实现类型检查而作，其余和 [CefV8Value] 并无差异
#[derive(Debug, Clone)]
pub struct CefV8ArrayBuffer(CefV8Value);

impl Deref for CefV8ArrayBuffer {
    type Target = CefV8Value;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for CefV8ArrayBuffer {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl TryInto<Vec<u8>> for CefV8ArrayBuffer {
    type Error = V8ValueError;
    fn try_into(self) -> Result<Vec<u8>, Self::Error> {
        let len = self.get_array_length();
        let mut array = Vec::with_capacity(len);

        for i in 0..len {
            array.push(self.get_value_byindex(i as _).try_into()?);
        }

        Ok(array)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Undefined;

#[derive(Debug, Clone, Copy)]
pub struct Null;

pub type CefV8HandlerCallback<E> =
    dyn Fn(&str, CefV8Value, Vec<CefV8Value>) -> ::core::result::Result<CefV8Value, E>;

impl CefV8Value {
    pub unsafe fn from_raw(raw: *mut sys::cef_v8value_t) -> Self {
        assert!(!raw.is_null(), "传入了值为 NULL 的 cef_v8value_t");
        Self(raw as _)
    }
    pub fn from_function<F: Fn() + 'static>(_func: F) -> Self {
        let func_name = std::any::type_name::<F>();
        let _func_name = CefString::from(func_name);
        unsafe {
            let _handler = Box::leak(Box::new(sys::cef_v8handler_t {
                base: sys::_cef_base_ref_counted_t {
                    size: ::core::mem::size_of::<sys::cef_v8handler_t>(),
                    ..::core::mem::zeroed()
                },
                execute: None,
            }));
            todo!()
            // Self::from_raw(sys::cef_v8value_create_function(func_name))
        }
    }
    pub fn new_object() -> Self {
        unsafe {
            Self::from_raw(sys::cef_v8value_create_object(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            ) as _)
        }
    }
    pub fn new_undefined() -> Self {
        unsafe { Self::from_raw(sys::cef_v8value_create_undefined() as _) }
    }
    pub fn new_null() -> Self {
        unsafe { Self::from_raw(sys::cef_v8value_create_null() as _) }
    }
    pub unsafe fn as_raw(&self) -> *mut sys::cef_v8value_t {
        self.0
    }
    pub unsafe fn to_raw(self) -> *mut sys::cef_v8value_t {
        self.0
    }
    pub fn is_valid(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_valid.unwrap())(self.0) != 0 }
    }
    pub fn is_undefined(&self) -> bool {
        if self.0.is_null() {
            return true;
        }
        unsafe { ((*self.0).is_undefined.unwrap())(self.0) != 0 }
    }
    pub fn is_null(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_null.unwrap())(self.0) != 0 }
    }
    pub fn is_bool(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_bool.unwrap())(self.0) != 0 }
    }
    pub fn is_int(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_int.unwrap())(self.0) != 0 }
    }
    pub fn is_uint(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_uint.unwrap())(self.0) != 0 }
    }
    pub fn is_double(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_double.unwrap())(self.0) != 0 }
    }
    pub fn is_date(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_date.unwrap())(self.0) != 0 }
    }
    pub fn is_string(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_string.unwrap())(self.0) != 0 }
    }
    pub fn is_object(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_object.unwrap())(self.0) != 0 }
    }
    pub fn is_array(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_array.unwrap())(self.0) != 0 }
    }
    pub fn is_array_buffer(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_array_buffer.unwrap())(self.0) != 0 }
    }
    pub fn is_function(&self) -> bool {
        if self.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_function.unwrap())(self.0) != 0 }
    }
    pub fn is_same(&self, other: &Self) -> bool {
        if self.0.is_null() || other.0.is_null() {
            return false;
        }
        unsafe { ((*self.0).is_same.unwrap())(self.0, other.0) != 0 }
    }
    pub fn get_js_type(&self) -> &'static str {
        if self.is_bool() {
            "boolean"
        } else if self.is_function() {
            "function"
        } else if self.is_undefined() {
            "undefined"
        } else if self.is_null() {
            "null"
        } else if self.is_string() {
            "string"
        } else if self.is_double() {
            "double"
        } else if self.is_int() {
            "int"
        } else if self.is_uint() {
            "uint"
        } else if self.is_date() {
            "date"
        } else if self.is_array_buffer() {
            "arraybuffer"
        } else if self.is_array() {
            "array"
        } else if self.is_object() {
            "object"
        } else {
            "unknown"
        }
    }
    pub fn get_bool_value(&self) -> bool {
        unsafe { ((*self.0).get_bool_value.unwrap())(self.0) != 0 }
    }
    pub fn get_int_value(&self) -> ::core::ffi::c_int {
        unsafe { ((*self.0).get_int_value.unwrap())(self.0) }
    }
    pub fn get_uint_value(&self) -> ::core::ffi::c_uint {
        unsafe { ((*self.0).get_uint_value.unwrap())(self.0) }
    }
    pub fn get_double_value(&self) -> ::core::ffi::c_double {
        unsafe { ((*self.0).get_double_value.unwrap())(self.0) }
    }
    pub fn get_date_value(&self) -> bool {
        todo!()
        // unsafe {((*self.0).get_date_value.unwrap())(self.0)}
    }
    pub fn get_string_value(&self) -> CefString {
        unsafe { CefString::from_raw(((*self.0).get_string_value.unwrap())(self.0) as _) }
    }
    pub fn is_user_created(&self) -> bool {
        unsafe { ((*self.0).is_user_created.unwrap())(self.0) != 0 }
    }
    pub fn has_exception(&self) -> bool {
        unsafe { ((*self.0).has_exception.unwrap())(self.0) != 0 }
    }
    pub fn get_exception(&self) -> *mut sys::cef_v8exception_t {
        unsafe { ((*self.0).get_exception.unwrap())(self.0) }
    }
    pub fn clear_exception(&self) -> bool {
        unsafe { ((*self.0).clear_exception.unwrap())(self.0) != 0 }
    }
    pub fn will_rethrow_exceptions(&self) -> bool {
        unsafe { ((*self.0).will_rethrow_exceptions.unwrap())(self.0) != 0 }
    }
    pub fn set_rethrow_exceptions(&mut self, rethrow: ::core::ffi::c_int) -> bool {
        unsafe { ((*self.0).set_rethrow_exceptions.unwrap())(self.0, rethrow) != 0 }
    }
    pub fn has_value_bykey(&self, key: &str) -> bool {
        unsafe {
            let key = CefString::from(key);
            ((*self.0).has_value_bykey.unwrap())(self.0, key.to_raw()) != 0
        }
    }
    pub fn has_value_byindex(&self, index: ::core::ffi::c_int) -> bool {
        unsafe { ((*self.0).has_value_byindex.unwrap())(self.0, index) != 0 }
    }
    pub fn delete_value_bykey(&self, key: &str) -> bool {
        unsafe {
            ((*self.0).delete_value_bykey.unwrap())(self.0, &CefString::from(key) as *const _ as _)
                != 0
        }
    }
    pub fn delete_value_byindex(&self, index: ::core::ffi::c_int) -> bool {
        unsafe { ((*self.0).delete_value_byindex.unwrap())(self.0, index) != 0 }
    }
    pub fn get_value_bykey(&self, key: &str) -> Self {
        unsafe {
            Self::from_raw(((*self.0).get_value_bykey.unwrap())(
                self.0,
                CefString::from(key).as_raw(),
            ) as _)
        }
    }
    pub fn get_value_byindex(&self, index: isize) -> Self {
        unsafe { Self::from_raw(((*self.0).get_value_byindex.unwrap())(self.0, index as _) as _) }
    }
    pub fn set_value_bykey(&mut self, key: &str, value: Self) -> bool {
        unsafe {
            let key = CefString::from(key);
            ((*self.0).set_value_bykey.unwrap())(self.0, key.to_raw(), value.as_raw(), 0) != 0
        }
    }
    pub fn set_value_byindex(&mut self, index: isize, value: Self) -> bool {
        unsafe { ((*self.0).set_value_byindex.unwrap())(self.0, index as _, value.to_raw()) != 0 }
    }
    // pub fn set_value_byaccessor(&self, index: isize, value: Self) -> bool {
    //     unsafe { ((*self.0).set_value_byaccessor.unwrap())(self.0, index as _, value.to_raw()) != 0 }
    // }
    pub fn get_keys(&self) -> Vec<String> {
        unsafe {
            let mut keys: usize = 0;
            ((*self.0).get_keys.unwrap())(self.0, &mut keys as *mut _ as _);

            if keys == 0 {
                vec![]
            } else {
                let keys: sys::cef_string_list_t = keys as _;
                let size = sys::cef_string_map_size(keys);
                let mut result = Vec::with_capacity(size);
                for i in 0..size {
                    let mut str: sys::cef_string_utf16_t = std::mem::zeroed();
                    sys::cef_string_list_value(keys, i, &mut str);
                    result.push(CefString::from_raw(&mut str).to_string());
                }
                result
            }
        }
    }
    pub unsafe fn set_user_data(&mut self, user_data: *mut sys::cef_base_ref_counted_t) -> bool {
        unsafe { ((*self.0).set_user_data.unwrap())(self.0, user_data) != 0 }
    }
    pub unsafe fn get_user_data(&self) -> *mut sys::cef_base_ref_counted_t {
        unsafe { ((*self.0).get_user_data.unwrap())(self.0) }
    }
    // pub fn get_externally_allocated_memory(&self) -> bool {
    //     unsafe { ((*self.0).get_externally_allocated_memory.unwrap())(self.0) }
    // }
    // pub fn adjust_externally_allocated_memory(&self) -> bool {
    //     unsafe { ((*self.0).adjust_externally_allocated_memory.unwrap())(self.0) }
    // }
    pub fn get_array_length(&self) -> usize {
        unsafe { ((*self.0).get_array_length.unwrap())(self.0) as _ }
    }
    // pub fn get_array_buffer_release_callback(&self) -> bool {
    //     unsafe { ((*self.0).get_array_buffer_release_callback.unwrap())(self.0) }
    // }
    // pub fn neuter_array_buffer(&self) -> bool {
    //     unsafe { ((*self.0).neuter_array_buffer.unwrap())(self.0) }
    // }
    // pub fn get_function_name(&self) -> bool {
    //     unsafe { ((*self.0).get_function_name.unwrap())(self.0) }
    // }
    // pub fn get_function_handler(&self) -> bool {
    //     unsafe { ((*self.0).get_function_handler.unwrap())(self.0) }
    // }
    pub fn execute_function(&self, this_obj: Option<Self>, arguments: &[Self]) -> Option<Self> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                // TODO: 发出警告
                None
            } else {
                let arguments = arguments.iter().map(|x| x.0).collect::<Vec<_>>();
                let ret = ((*self.0).execute_function.unwrap())(
                    self.0,
                    this_obj.map(|x| x.0).unwrap_or(std::ptr::null_mut()),
                    arguments.len(),
                    arguments.as_ptr(),
                );
                if ret.is_null() {
                    // Error
                    None
                } else {
                    Some(Self::from_raw(ret))
                }
            }
        }
    }
    // pub fn execute_function_with_context(&self) -> bool {
    //     unsafe { ((*self.0).execute_function_with_context.unwrap())(self.0) }
    // }
}

pub enum V8ValueError {
    IncorrectType {
        required: &'static str,
        current: &'static str,
    },
    NotInV8Context,
    NotInRendererThread,
}

impl std::fmt::Debug for V8ValueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            V8ValueError::IncorrectType { required, current } => {
                f.write_str("CefV8Value 类型不正确，需要类型 ")?;
                f.write_str(required)?;
                f.write_str(" ，提供了 ")?;
                f.write_str(current)?;
            }
            V8ValueError::NotInV8Context => {
                f.write_str("试图在非 V8Context 上下文环境内创建 V8Value")?;
            }
            V8ValueError::NotInRendererThread => {
                f.write_str("试图在非渲染线程内创建 V8Value")?;
            }
        }
        Ok(())
    }
}

impl std::fmt::Display for V8ValueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            V8ValueError::IncorrectType { required, current } => {
                f.write_str("CefV8Value 类型不正确，需要类型 ")?;
                f.write_str(required)?;
                f.write_str(" ，提供了 ")?;
                f.write_str(current)?;
            }
            V8ValueError::NotInV8Context => {
                f.write_str("试图在非 V8Context 上下文环境内创建 V8Value")?;
            }
            V8ValueError::NotInRendererThread => {
                f.write_str("试图在非渲染线程内创建 V8Value")?;
            }
        }
        Ok(())
    }
}

impl Error for V8ValueError {}

macro_rules! impl_try_from_for_number {
    ($for_type:tt, $required_type:ident, $checker:ident, $getter:ident) => {
        impl TryFrom<CefV8Value> for $for_type {
            type Error = V8ValueError;
            fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
                if value.$checker() {
                    Ok(value.$getter() as _)
                } else {
                    Err(V8ValueError::IncorrectType {
                        required: std::stringify!($required_type),
                        current: value.get_js_type(),
                    })
                }
            }
        }

        impl TryFrom<CefV8Value> for Option<$for_type> {
            type Error = V8ValueError;
            fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
                if value.$checker() {
                    Ok(Some(value.$getter() as _))
                } else if value.is_null() || value.is_undefined() {
                    Ok(None)
                } else {
                    Err(V8ValueError::IncorrectType {
                        required: std::stringify!($required_type),
                        current: value.get_js_type(),
                    })
                }
            }
        }
    };
}

macro_rules! impl_into_for_number {
    ($for_type:tt, $creator:ident) => {
        impl TryFrom<$for_type> for CefV8Value {
            type Error = V8ValueError;
            fn try_from(value: $for_type) -> Result<Self, Self::Error> {
                unsafe {
                    if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                        Err(V8ValueError::NotInRendererThread)
                    } else if sys::cef_v8context_in_context() == 0 {
                        Err(V8ValueError::NotInV8Context)
                    } else {
                        Ok(Self::from_raw(sys::$creator(value as _) as _))
                    }
                }
            }
        }
    };
}

impl_try_from_for_number!(u8, uint, is_uint, get_uint_value);
impl_try_from_for_number!(u16, uint, is_uint, get_uint_value);
impl_try_from_for_number!(u32, uint, is_uint, get_uint_value);
impl_try_from_for_number!(u64, uint, is_uint, get_uint_value);
impl_try_from_for_number!(u128, uint, is_uint, get_uint_value);
impl_try_from_for_number!(usize, uint, is_uint, get_uint_value);

impl_try_from_for_number!(i8, int, is_int, get_int_value);
impl_try_from_for_number!(i16, int, is_int, get_int_value);
impl_try_from_for_number!(i32, int, is_int, get_int_value);
impl_try_from_for_number!(i64, int, is_int, get_int_value);
impl_try_from_for_number!(i128, int, is_int, get_int_value);
impl_try_from_for_number!(isize, int, is_int, get_int_value);

impl_try_from_for_number!(f32, double, is_double, get_double_value);
impl_try_from_for_number!(f64, double, is_double, get_double_value);

impl_into_for_number!(u8, cef_v8value_create_uint);
impl_into_for_number!(u16, cef_v8value_create_uint);
impl_into_for_number!(u32, cef_v8value_create_uint);
impl_into_for_number!(u64, cef_v8value_create_uint);
impl_into_for_number!(u128, cef_v8value_create_uint);
impl_into_for_number!(usize, cef_v8value_create_uint);

impl_into_for_number!(i8, cef_v8value_create_int);
impl_into_for_number!(i16, cef_v8value_create_int);
impl_into_for_number!(i32, cef_v8value_create_int);
impl_into_for_number!(i64, cef_v8value_create_int);
impl_into_for_number!(i128, cef_v8value_create_int);
impl_into_for_number!(isize, cef_v8value_create_int);

impl_into_for_number!(f32, cef_v8value_create_double);
impl_into_for_number!(f64, cef_v8value_create_double);

impl TryFrom<CefV8Value> for bool {
    type Error = V8ValueError;
    fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
        if value.is_bool() {
            Ok(value.get_bool_value())
        } else {
            Err(V8ValueError::IncorrectType {
                required: "boolean",
                current: value.get_js_type(),
            })
        }
    }
}

impl TryFrom<CefV8Value> for String {
    type Error = V8ValueError;
    fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
        if value.is_string() {
            Ok(value.get_string_value().to_string())
        } else {
            Err(V8ValueError::IncorrectType {
                required: "string",
                current: value.get_js_type(),
            })
        }
    }
}

impl TryFrom<CefV8Value> for CefV8Function {
    type Error = V8ValueError;
    fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
        if value.is_function() {
            Ok(CefV8Function(value))
        } else {
            Err(V8ValueError::IncorrectType {
                required: "function",
                current: value.get_js_type(),
            })
        }
    }
}

impl TryFrom<CefV8Value> for Option<CefV8Function> {
    type Error = V8ValueError;
    fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
        if value.is_function() {
            Ok(Some(CefV8Function(value)))
        } else {
            Ok(None)
        }
    }
}

impl TryFrom<()> for CefV8Value {
    type Error = V8ValueError;
    fn try_from(_: ()) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else {
                Ok(Self::from_raw(sys::cef_v8value_create_undefined()))
            }
        }
    }
}

impl TryInto<Vec<CefV8Value>> for CefV8Value {
    type Error = V8ValueError;
    fn try_into(self) -> Result<Vec<CefV8Value>, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else if !self.is_array() {
                Err(V8ValueError::IncorrectType {
                    required: "array",
                    current: self.get_js_type(),
                })
            } else {
                let len = self.get_array_length();
                let mut array = Vec::with_capacity(len);

                for i in 0..len {
                    array.push(self.get_value_byindex(i as _));
                }

                Ok(array)
            }
        }
    }
}

impl<T> TryFrom<CefV8Value> for Vec<T>
where
    T: TryFrom<CefV8Value>,
    V8ValueError: From<T::Error>,
{
    type Error = V8ValueError;
    fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else if !value.is_array() {
                Err(V8ValueError::IncorrectType {
                    required: "array",
                    current: value.get_js_type(),
                })
            } else {
                let len = value.get_array_length();
                let mut array = Vec::with_capacity(len);

                for i in 0..len {
                    array.push(value.get_value_byindex(i as _).try_into()?);
                }

                Ok(array)
            }
        }
    }
}

impl TryFrom<CefV8Value> for CefV8ArrayBuffer {
    type Error = V8ValueError;
    fn try_from(value: CefV8Value) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else if !value.is_array_buffer() {
                Err(V8ValueError::IncorrectType {
                    required: "array",
                    current: value.get_js_type(),
                })
            } else {
                Ok(CefV8ArrayBuffer(value))
            }
        }
    }
}

impl<T> TryFrom<Option<T>> for CefV8Value
where
    T: TryInto<CefV8Value>,
    V8ValueError: From<T::Error>,
{
    type Error = V8ValueError;
    fn try_from(v: Option<T>) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else if let Some(v) = v {
                Ok(v.try_into()?)
            } else {
                Ok(CefV8Value::from_raw(sys::cef_v8value_create_null() as _))
            }
        }
    }
}

impl TryFrom<bool> for CefV8Value {
    type Error = V8ValueError;
    fn try_from(value: bool) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else {
                Ok(CefV8Value::from_raw(
                    sys::cef_v8value_create_bool(if value { 1 } else { 0 }) as _,
                ))
            }
        }
    }
}

impl TryFrom<CefString> for CefV8Value {
    type Error = V8ValueError;
    fn try_from(value: CefString) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else {
                Ok(CefV8Value::from_raw(sys::cef_v8value_create_string(
                    value.to_raw(),
                )))
            }
        }
    }
}

impl<T> TryFrom<Vec<T>> for CefV8Value
where
    T: TryInto<CefV8Value>,
    V8ValueError: From<T::Error>,
{
    type Error = V8ValueError;
    fn try_from(value: Vec<T>) -> Result<Self, Self::Error> {
        unsafe {
            if sys::cef_currently_on(sys::cef_thread_id_t_TID_RENDERER) == 0 {
                Err(V8ValueError::NotInRendererThread)
            } else if sys::cef_v8context_in_context() == 0 {
                Err(V8ValueError::NotInV8Context)
            } else {
                let mut array =
                    CefV8Value::from_raw(sys::cef_v8value_create_array(value.len() as _));

                for (i, v) in value.into_iter().enumerate() {
                    array.set_value_byindex(i as _, v.try_into()?);
                }

                Ok(array)
            }
        }
    }
}

impl TryFrom<&str> for CefV8Value {
    type Error = V8ValueError;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        CefString::from(s).try_into()
    }
}

impl TryFrom<String> for CefV8Value {
    type Error = V8ValueError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.as_str().try_into()
    }
}

impl FromStr for CefV8Value {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(unsafe {
            CefV8Value::from_raw(sys::cef_v8value_create_string(CefString::from(s).to_raw()))
        })
    }
}
