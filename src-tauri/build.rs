use std::{fs, path::Path};

fn emit_rerun_if_changed(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());

    if path.is_dir() {
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            emit_rerun_if_changed(&entry.path());
        }
    }
}

fn main() {
    emit_rerun_if_changed(Path::new("build.rs"));
    emit_rerun_if_changed(Path::new("tauri.conf.json"));
    emit_rerun_if_changed(Path::new("tauri.release.conf.json"));
    emit_rerun_if_changed(Path::new("icons"));

    tauri_build::build()
}
