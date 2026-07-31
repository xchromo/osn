const COMMANDS: &[&str] = &["set", "get", "delete"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
