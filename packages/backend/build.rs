use std::env;
use std::path::Path;

fn main() {
    let dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let binding = Path::new(&dir).join("../../libs/libcef");
    let libcef_path = binding.to_string_lossy();

    println!("cargo:rustc-link-search={libcef_path}");

    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();

    if arch == "x86" {
        println!("cargo:rustc-link-lib=libcef");
    } else {
        println!("cargo:rustc-link-lib=libcef_x64");
    }
}
