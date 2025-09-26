use std::path::Path;

fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let binding = Path::new(&dir).join("../libcef");
    let libcef_path = binding.to_string_lossy();

    println!("cargo:rustc-link-search={libcef_path}");
    println!("cargo:rustc-link-lib=libcef");
}
