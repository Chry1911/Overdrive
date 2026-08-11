// src-tauri/src/cleanup.rs
//
// Pulizia file temporanei limitata a cartelle note e "sicure da svuotare".
// Non tocchiamo mai C:\Windows di sistema in blocco: solo le sottocartelle
// temp standard, la cache di Windows Update e il cestino, tutte cose che
// Windows stesso rigenera quando servono.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct CleanupTarget {
    pub id: &'static str,
    pub label: String,
    pub path: PathBuf,
    pub size_mb: u64,
    pub file_count: usize,
}

#[derive(Serialize)]
pub struct CleanupResult {
    pub id: String,
    pub freed_mb: u64,
    pub errors: Vec<String>,
}

fn candidate_paths() -> Vec<(&'static str, &'static str, PathBuf)> {
    let mut list = Vec::new();

    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        list.push((
            "user_temp",
            "File temporanei utente (%TEMP%)",
            PathBuf::from(&local_appdata).join("Temp"),
        ));
    }
    if let Ok(windir) = std::env::var("WINDIR") {
        list.push((
            "windows_temp",
            "File temporanei di sistema (C:\\Windows\\Temp)",
            PathBuf::from(&windir).join("Temp"),
        ));
        list.push((
            "wu_cache",
            "Cache download Windows Update",
            PathBuf::from(&windir).join("SoftwareDistribution").join("Download"),
        ));
    }
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        list.push((
            "explorer_thumbcache",
            "Cache miniature Explorer",
            PathBuf::from(&local_appdata).join("Microsoft").join("Windows").join("Explorer"),
        ));
    }

    list
}

fn dir_stats(path: &PathBuf) -> (u64, usize) {
    let mut total_bytes = 0u64;
    let mut count = 0usize;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total_bytes += meta.len();
                    count += 1;
                }
            }
        }
    }
    (total_bytes / 1024 / 1024, count)
}

pub fn scan() -> Vec<CleanupTarget> {
    candidate_paths()
        .into_iter()
        .filter(|(_, _, p)| p.exists())
        .map(|(id, label, path)| {
            let (size_mb, file_count) = dir_stats(&path);
            CleanupTarget { id, label: label.to_string(), path, size_mb, file_count }
        })
        .collect()
}

/// Cancella solo i FILE di primo livello nella cartella target (non ricorsivo
/// nelle sottocartelle, per evitare di intaccare percorsi con permessi o
/// file ancora "in uso" gestiti da altri processi in modi imprevedibili).
pub fn clean(target_id: &str) -> Result<CleanupResult, String> {
    let target = candidate_paths()
        .into_iter()
        .find(|(id, _, _)| *id == target_id)
        .ok_or_else(|| format!("Target sconosciuto: {target_id}"))?;

    let (_, _, path) = target;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Ok(meta) = entry.metadata() {
                    match fs::remove_file(&p) {
                        Ok(_) => freed_bytes += meta.len(),
                        // molti file saranno "in uso": non è un errore fatale,
                        // semplicemente si saltano.
                        Err(e) => errors.push(format!("{}: {}", p.display(), e)),
                    }
                }
            }
        }
    }

    Ok(CleanupResult {
        id: target_id.to_string(),
        freed_mb: freed_bytes / 1024 / 1024,
        errors,
    })
}
