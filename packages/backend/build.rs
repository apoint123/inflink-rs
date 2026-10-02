use std::{
    env,
    path::Path,
};

fn main() {
    let dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let libs = Path::new(&dir).join("../../libs");
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();

    // 上游 BetterNCM/libcef 子模块里的 x86 导入库遗留了大量早已被 Chromium / CEF
    // 废弃并删除的历史陈旧符号，缺少 cef_v8value_create_array_buffer 等真实存在于网易云
    // libcef.dll 的导出，因此 x86 改用本仓库自带的导入库，它直接从网易云 v2 自带的 libcef.dll
    // 生成，导出集合与运行时 DLL 严格一致。来源与重新生成方式见 libs/libcef-x86/README.md。
    let (search_dir, link_name) = match arch.as_str() {
        "x86" => (libs.join("libcef-x86"), "libcef"),
        _ => (libs.join("libcef"), "libcef_x64"),
    };

    let lib_path = search_dir.join(format!("{link_name}.lib"));
    let search_dir = search_dir.to_string_lossy();

    println!("cargo:rustc-link-search={search_dir}");
    println!("cargo:rustc-link-lib={link_name}");
    println!("cargo:rerun-if-changed={}", lib_path.display());
}
