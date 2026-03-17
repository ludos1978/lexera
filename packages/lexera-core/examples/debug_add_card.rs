use lexera_core::storage::local::LocalStorage;
use lexera_core::storage::BoardStorage;
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let board_path = match args.next() {
        Some(value) => PathBuf::from(value),
        None => {
            eprintln!("usage: cargo run -p lexera-core --example debug_add_card -- <board-path> [column-index] [content]");
            std::process::exit(2);
        }
    };
    let col_index = args
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let content = args.next().unwrap_or_else(|| "debug add card".to_string());

    let storage = LocalStorage::new();
    let board_id = match storage.add_board(&board_path) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("add_board failed: {}", error);
            std::process::exit(1);
        }
    };

    println!("board_id={}", board_id);
    match storage.add_card(&board_id, col_index, &content) {
        Ok(()) => println!("add_card ok"),
        Err(error) => {
            eprintln!("add_card failed: {}", error);
            std::process::exit(1);
        }
    }
}
