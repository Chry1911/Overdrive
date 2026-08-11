// src-tauri/src/registry.rs
//
// Modifica SOLO chiavi di registro presenti nella whitelist TWEAKS qui sotto.
// Non esponiamo mai scrittura arbitraria del registro al frontend: è la
// differenza tra "tool di ottimizzazione" e "arma a doppio taglio". Prima di
// ogni modifica viene esportato un backup .reg della chiave interessata.

use serde::Serialize;
use std::process::Command;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Serialize, Clone)]
pub struct Tweak {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub hive: &'static str,   // "HKLM" | "HKCU"
    pub path: &'static str,
    pub value_name: &'static str,
    pub on_value: u32,
    pub off_value: u32,
}

/// Whitelist di tweak noti e documentati per il gaming. Ogni voce agisce su
/// UN solo valore DWORD, mai su una chiave intera.
pub const TWEAKS: &[Tweak] = &[
    Tweak {
        id: "win32_priority_separation",
        label: "Priorità ai processi in primo piano",
        description: "Win32PrioritySeparation: dà più quanti di CPU al processo attivo (il gioco) rispetto ai servizi in background.",
        hive: "HKLM",
        path: r"SYSTEM\CurrentControlSet\Control\PriorityControl",
        value_name: "Win32PrioritySeparation",
        on_value: 0x26, // 38 decimale: schema "short, fixed, foreground boost" tipico dei tweak gaming
        off_value: 0x02, // default Windows
    },
    Tweak {
        id: "disable_nagle",
        label: "Disabilita algoritmo di Nagle",
        description: "Riduce la latenza di rete disattivando il buffering dei piccoli pacchetti TCP (utile per giochi online).",
        hive: "HKLM",
        path: r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters",
        value_name: "TcpAckFrequency",
        on_value: 1,
        off_value: 0, // 0 = non impostato / comportamento default
    },
    Tweak {
        id: "gpu_mmcss_priority",
        label: "Priorità MMCSS per i giochi",
        description: "Alza la priorità di scheduling GPU/CPU riservata ai processi in categoria 'Games' nel task scheduler multimediale.",
        hive: "HKLM",
        path: r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games",
        value_name: "GPU Priority",
        on_value: 8,
        off_value: 2,
    },
    Tweak {
        id: "disable_fullscreen_optimizations_hint",
        label: "Notifiche Game Bar disattivate",
        description: "Impedisce a Xbox Game Bar di intercettare l'apertura dei giochi (meno overhead, niente popup).",
        hive: "HKCU",
        path: r"SOFTWARE\Microsoft\GameBar",
        value_name: "AutoGameModeEnabled",
        on_value: 0, // qui "on" per il gaming = disattivare la Game Bar
        off_value: 1,
    },
];

fn open_hive(hive: &str) -> RegKey {
    match hive {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        _ => panic!("hive non supportato: {hive}"),
    }
}

/// Esporta la chiave in un file .reg prima di toccarla, così l'utente può
/// sempre fare doppio click e ripristinare lo stato originale.
fn backup_key(hive: &str, path: &str, backup_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
    let full_key = format!("{hive}\\{path}");
    let file_name = format!(
        "{}.reg",
        path.replace('\\', "_").replace(' ', "_")
    );
    let out_path = backup_dir.join(file_name);

    let status = Command::new("reg")
        .args(["export", &full_key, out_path.to_str().unwrap(), "/y"])
        .status()
        .map_err(|e| e.to_string())?;

    // reg export fallisce se la chiave non esiste ancora: non è un errore
    // bloccante, la creeremo noi al primo write.
    let _ = status;
    Ok(())
}

pub fn apply_tweak(tweak_id: &str, enable: bool, backup_dir: &std::path::Path) -> Result<(), String> {
    let tweak = TWEAKS
        .iter()
        .find(|t| t.id == tweak_id)
        .ok_or_else(|| format!("Tweak sconosciuto: {tweak_id}"))?;

    backup_key(tweak.hive, tweak.path, backup_dir)?;

    let hive = open_hive(tweak.hive);
    let (key, _disposition) = hive
        .create_subkey(tweak.path)
        .map_err(|e| format!("Impossibile aprire/creare la chiave: {e}"))?;

    let value = if enable { tweak.on_value } else { tweak.off_value };
    key.set_value(tweak.value_name, &value)
        .map_err(|e| format!("Scrittura fallita: {e}"))
}

pub fn list_tweaks() -> Vec<Tweak> {
    TWEAKS.to_vec()
}
