use crate::{CefString, sys};

#[repr(C)]
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CefValueType {
    Invalid = 0,
    Null,
    Bool,
    Int,
    Double,
    String,
    Binary,
    Dictionary,
    List,
}

#[derive(Debug)]
pub struct CefValue(*mut sys::cef_value_t);

impl CefValue {
    pub unsafe fn from_raw(raw: *mut ::core::ffi::c_void) -> Self {
        Self(raw as _)
    }
    pub fn is_valid(&self) -> bool {
        unsafe { ((*self.0).is_valid.unwrap())(self.0) != 0 }
    }
    pub fn is_owned(&self) -> bool {
        unsafe { ((*self.0).is_owned.unwrap())(self.0) != 0 }
    }
    pub fn is_read_only(&self) -> bool {
        unsafe { ((*self.0).is_read_only.unwrap())(self.0) != 0 }
    }
    pub fn is_same(&self, that: &Self) -> bool {
        unsafe { ((*self.0).is_same.unwrap())(self.0, that.0) != 0 }
    }
    pub fn is_equal(&self, that: &Self) -> bool {
        unsafe { ((*self.0).is_equal.unwrap())(self.0, that.0) != 0 }
    }
    pub fn copy(&self) -> CefValue {
        unsafe { Self::from_raw(((*self.0).copy.unwrap())(self.0) as _) }
    }
    pub fn get_type(&self) -> CefValueType {
        unsafe {
            match ((*self.0).get_type.unwrap())(self.0) {
                sys::cef_value_type_t_VTYPE_INVALID => CefValueType::Invalid,
                sys::cef_value_type_t_VTYPE_NULL => CefValueType::Null,
                sys::cef_value_type_t_VTYPE_BOOL => CefValueType::Bool,
                sys::cef_value_type_t_VTYPE_INT => CefValueType::Int,
                sys::cef_value_type_t_VTYPE_DOUBLE => CefValueType::Double,
                sys::cef_value_type_t_VTYPE_STRING => CefValueType::String,
                sys::cef_value_type_t_VTYPE_BINARY => CefValueType::Binary,
                sys::cef_value_type_t_VTYPE_DICTIONARY => CefValueType::Dictionary,
                sys::cef_value_type_t_VTYPE_LIST => CefValueType::List,
                _ => unreachable!(),
            }
        }
    }
    pub fn get_bool(&self) -> bool {
        unsafe { ((*self.0).get_bool.unwrap())(self.0) != 0 }
    }
    pub fn get_int(&self) -> ::core::ffi::c_int {
        unsafe { ((*self.0).get_int.unwrap())(self.0) }
    }
    pub fn get_double(&self) -> ::core::ffi::c_double {
        unsafe { ((*self.0).get_double.unwrap())(self.0) }
    }
    pub fn get_string(&self) -> CefString {
        unsafe { CefString::from_raw(((*self.0).get_string.unwrap())(self.0) as _) }
    }
    pub fn get_binary(&self) -> *mut sys::cef_binary_value_t {
        unsafe { ((*self.0).get_binary.unwrap())(self.0) }
    }
    pub fn get_dictionary(&self) -> *mut sys::cef_dictionary_value_t {
        unsafe { ((*self.0).get_dictionary.unwrap())(self.0) }
    }
    pub fn get_list(&self) -> *mut sys::cef_list_value_t {
        unsafe { ((*self.0).get_list.unwrap())(self.0) }
    }
    pub fn set_null(&self) -> bool {
        unsafe { ((*self.0).set_null.unwrap())(self.0) != 0 }
    }
    pub fn set_bool(&self, value: bool) -> bool {
        unsafe { ((*self.0).set_bool.unwrap())(self.0, value as _) != 0 }
    }
    pub fn set_int(&self, value: ::core::ffi::c_int) -> bool {
        unsafe { ((*self.0).set_int.unwrap())(self.0, value) != 0 }
    }
    pub fn set_double(&self, value: ::core::ffi::c_double) -> bool {
        unsafe { ((*self.0).set_double.unwrap())(self.0, value) != 0 }
    }
    pub fn set_string(&self, value: CefString) -> bool {
        unsafe { ((*self.0).set_string.unwrap())(self.0, &value as *const _ as _) != 0 }
    }
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn set_binary(&self, value: *mut sys::cef_binary_value_t) -> bool {
        unsafe { ((*self.0).set_binary.unwrap())(self.0, value) != 0 }
    }
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn set_dictionary(&self, value: *mut sys::cef_dictionary_value_t) -> bool {
        unsafe { ((*self.0).set_dictionary.unwrap())(self.0, value) != 0 }
    }
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn set_list(&self, value: *mut sys::cef_list_value_t) -> bool {
        unsafe { ((*self.0).set_list.unwrap())(self.0, value) != 0 }
    }
}

impl From<CefValue> for u8 {
    fn from(value: CefValue) -> u8 {
        value.get_int() as _
    }
}

impl From<CefValue> for u16 {
    fn from(value: CefValue) -> u16 {
        value.get_int() as _
    }
}

impl From<CefValue> for u32 {
    fn from(value: CefValue) -> u32 {
        value.get_int() as _
    }
}

impl From<CefValue> for u64 {
    fn from(value: CefValue) -> u64 {
        value.get_int() as _
    }
}

impl From<CefValue> for u128 {
    fn from(value: CefValue) -> u128 {
        value.get_int() as _
    }
}

impl From<CefValue> for usize {
    fn from(value: CefValue) -> usize {
        value.get_int() as _
    }
}

impl From<CefValue> for i8 {
    fn from(value: CefValue) -> i8 {
        value.get_int() as _
    }
}

impl From<CefValue> for i16 {
    fn from(value: CefValue) -> i16 {
        value.get_int() as _
    }
}

impl From<CefValue> for i32 {
    fn from(value: CefValue) -> i32 {
        value.get_int() as _
    }
}

impl From<CefValue> for i64 {
    fn from(value: CefValue) -> i64 {
        value.get_int() as _
    }
}

impl From<CefValue> for i128 {
    fn from(value: CefValue) -> i128 {
        value.get_int() as _
    }
}

impl From<CefValue> for isize {
    fn from(value: CefValue) -> isize {
        value.get_int() as _
    }
}

impl From<CefValue> for CefString {
    fn from(value: CefValue) -> CefString {
        value.get_string()
    }
}

impl From<CefValue> for String {
    fn from(value: CefValue) -> String {
        value.get_string().into()
    }
}
