use std::env;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=wrapper.h");

    let cef_root_path = PathBuf::from("../../libcef");

    let bindings = bindgen::Builder::default()
        .header("wrapper.h")
        .clang_arg(format!("-I{}", cef_root_path.display()))
        .allowlist_type("_cef_base_ref_counted_t")
        .allowlist_type("_cef_v8value_t")
        .allowlist_type("_cef_v8context_t")
        .allowlist_type("_cef_task_t")
        .allowlist_type("_cef_task_runner_t")
        .allowlist_type("cef_string_t")
        .allowlist_type("cef_thread_id_t")
        .allowlist_var("cef_thread_id_t_TID_RENDERER")
        .allowlist_function("cef_v8value_create_string")
        .allowlist_function("cef_v8context_get_current_context")
        .allowlist_function("cef_task_runner_get_for_thread")
        .allowlist_function("cef_string_utf16_set")
        .allowlist_function("cef_string_userfree_utf16_free")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("生成绑定文件失败");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("无法写入绑定文件");
}
