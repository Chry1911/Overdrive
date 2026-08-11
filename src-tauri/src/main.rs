// src-tauri/src/main.rs
//
// Backend Rust dell'app "Overdrive". Espone comandi Tauri che il frontend
// React invoca via `invoke("nome_comando", { ...args })`.
//
// NOTA IMPORTANTE: modificare priorità/terminare processi di sistema può
// destabilizzare Windows. Il backend qui sotto ha una blacklist minima di
// processi critici che rifiuta di toccare (csrss.exe, wininit.exe, ecc.).
// Da estendere ed affinare, non usarla così com'è in produzione senza test.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod registry;
mod cleanup;

use serde::Serialize;
use sysinfo::{Pid, System};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    OpenProcess, SetPriorityClass, PROCESS_ALL_ACCESS,
    ABOVE_NORMAL_PRIORITY_CLASS, BELOW_NORMAL_PRIORITY_CLASS,
    HIGH_PRIORITY_CLASS, IDLE_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
    REALTIME_PRIORITY_CLASS, PROCESS_CREATION_FLAGS,
};

/// Processi che il tool non deve mai poter terminare o ri-priorizzare.
const PROTECTED: &[&str] = &[
    "csrss.exe", "wininit.exe", "winlogon.exe", "smss.exe",
    "services.exe", "lsass.exe", "system", "explorer.exe",
];

struct AppState {
    sys: Mutex<System>,
}

#[derive(Serialize, Clone)]
struct ProcessInfo {
    pid: u32,
    name: String,
    cpu_usage: f32,
    memory_mb: u64,
    priority: String,
    protected: bool,
}

#[derive(Serialize, Clone)]
struct ActivePowerPlan {
    id: String,
    label: String,
}

#[derive(Serialize, Clone)]
struct NetworkSnapshot {
    connected: bool,
    latency_ms: Option<u128>,
    sample_host: String,
}

#[derive(Serialize, Clone)]
struct GameModeResult {
    enabled: bool,
    applied: Vec<String>,
    warnings: Vec<String>,
}

#[tauri::command]
fn list_processes(state: State<AppState>) -> Vec<ProcessInfo> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_all();

    let mut out: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .map(|(pid, proc_)| {
            let name = proc_.name().to_string_lossy().to_string();
            ProcessInfo {
                pid: pid.as_u32(),
                name: name.clone(),
                cpu_usage: proc_.cpu_usage(),
                memory_mb: proc_.memory() / 1024 / 1024,
                priority: "normale".into(), // la priorità reale si legge via winapi, vedi nota sotto
                protected: PROTECTED.contains(&name.to_lowercase().as_str()),
            }
        })
        .collect();

    out.sort_by(|a, b| b.cpu_usage.partial_cmp(&a.cpu_usage).unwrap());
    out
}

#[tauri::command]
fn kill_process(state: State<AppState>, pid: u32) -> Result<(), String> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_all();

    let spid = Pid::from_u32(pid);
    let Some(proc_) = sys.process(spid) else {
        return Err("Processo non trovato".into());
    };
    let name = proc_.name().to_string_lossy().to_lowercase();
    if PROTECTED.contains(&name.as_str()) {
        return Err(format!("{name} è un processo di sistema protetto"));
    }

    if proc_.kill() {
        Ok(())
    } else {
        Err("Impossibile terminare il processo (permessi?)".into())
    }
}

/// Livelli esposti al frontend: "idle" | "below" | "normal" | "above" | "high" | "realtime"
#[tauri::command]
#[cfg(target_os = "windows")]
fn set_process_priority(pid: u32, level: String) -> Result<(), String> {
    let class: PROCESS_CREATION_FLAGS = match level.as_str() {
        "idle" => IDLE_PRIORITY_CLASS,
        "below" => BELOW_NORMAL_PRIORITY_CLASS,
        "normal" => NORMAL_PRIORITY_CLASS,
        "above" => ABOVE_NORMAL_PRIORITY_CLASS,
        "high" => HIGH_PRIORITY_CLASS,
        "realtime" => REALTIME_PRIORITY_CLASS, // sconsigliato: può bloccare input/mouse
        _ => return Err("Livello di priorità non valido".into()),
    };

    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_ALL_ACCESS, false, pid)
            .map_err(|e| format!("OpenProcess fallita: {e}"))?;
        let res = SetPriorityClass(handle, class);
        let _ = CloseHandle(handle);
        res.map_err(|e| format!("SetPriorityClass fallita: {e}"))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_process_priority(_pid: u32, _level: String) -> Result<(), String> {
    Err("Disponibile solo su Windows".into())
}

/// Applica un "power plan" tramite powercfg (invocato come processo esterno,
/// più robusto delle API dirette per questo caso d'uso).
#[tauri::command]
fn apply_power_plan(plan: String) -> Result<(), String> {
    let guid = match plan.as_str() {
        "ultimate" => "e9a42b02-d5df-448d-aa00-03f14749eb61", // Ultimate Performance
        "high" => "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",     // High performance
        "balanced" => "381b4222-f694-41f0-9685-ff5bb260df2e",
        _ => return Err("Piano non riconosciuto".into()),
    };

    std::process::Command::new("powercfg")
        .args(["/s", guid])
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err("powercfg ha restituito un errore".into()) })
}

#[tauri::command]
fn get_game_mode_status() -> bool {
    get_active_power_plan()
        .map(|plan| plan.id == "ultimate")
        .unwrap_or(false)
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn set_game_mode(enable: bool) -> Result<GameModeResult, String> {
    let mut applied = Vec::new();
    let mut warnings = Vec::new();

    let target_plan = if enable { "ultimate" } else { "balanced" };
    match apply_power_plan(target_plan.to_string()) {
        Ok(_) => applied.push(format!("Power plan: {target_plan}")),
        Err(error) => warnings.push(format!("Power plan non applicato: {error}")),
    }

    let tweaks = [
        "win32_priority_separation",
        "gpu_mmcss_priority",
        "disable_nagle",
        "disable_fullscreen_optimizations_hint",
    ];

    for tweak_id in tweaks {
        match registry::apply_tweak(tweak_id, enable, &backup_dir()) {
            Ok(_) => applied.push(format!("Tweak applicato: {tweak_id}")),
            Err(error) => warnings.push(format!("{tweak_id}: {error}")),
        }
    }

    if applied.is_empty() {
        return Err(format!(
            "Gaming mode non applicabile: {}",
            warnings.join(" | ")
        ));
    }

    Ok(GameModeResult {
        enabled: enable,
        applied,
        warnings,
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_game_mode(_enable: bool) -> Result<GameModeResult, String> {
    Err("Disponibile solo su Windows".into())
}

#[tauri::command]
fn get_active_power_plan() -> Result<ActivePowerPlan, String> {
    let output = std::process::Command::new("powercfg")
        .arg("/getactivescheme")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("powercfg /getactivescheme ha restituito un errore".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let (id, label) = if stdout.contains("e9a42b02-d5df-448d-aa00-03f14749eb61") {
        ("ultimate", "Ultimate Performance")
    } else if stdout.contains("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c") {
        ("high", "High Performance")
    } else if stdout.contains("381b4222-f694-41f0-9685-ff5bb260df2e") {
        ("balanced", "Bilanciato")
    } else {
        ("unknown", "Schema personalizzato")
    };

    Ok(ActivePowerPlan {
        id: id.to_string(),
        label: label.to_string(),
    })
}

#[tauri::command]
fn network_snapshot() -> NetworkSnapshot {
    let sample_host = "1.1.1.1:443".to_string();
    let socket_addr: SocketAddr = sample_host
        .parse()
        .expect("indirizzo di test rete non valido");
    let start = Instant::now();

    match TcpStream::connect_timeout(&socket_addr, Duration::from_millis(1200)) {
        Ok(stream) => {
            let _ = stream.shutdown(std::net::Shutdown::Both);
            NetworkSnapshot {
                connected: true,
                latency_ms: Some(start.elapsed().as_millis()),
                sample_host,
            }
        }
        Err(_) => NetworkSnapshot {
            connected: false,
            latency_ms: None,
            sample_host,
        },
    }
}

#[tauri::command]
fn flush_dns_cache() -> Result<(), String> {
    std::process::Command::new("ipconfig")
        .arg("/flushdns")
        .status()
        .map_err(|e| e.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("ipconfig /flushdns ha restituito un errore".into())
            }
        })
}

// ---------- Registro di sistema ----------

fn backup_dir() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Overdrive")
        .join("registry-backups")
}

#[tauri::command]
fn list_registry_tweaks() -> Vec<registry::Tweak> {
    registry::list_tweaks()
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn apply_registry_tweak(tweak_id: String, enable: bool) -> Result<(), String> {
    registry::apply_tweak(&tweak_id, enable, &backup_dir())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn apply_registry_tweak(_tweak_id: String, _enable: bool) -> Result<(), String> {
    Err("Disponibile solo su Windows".into())
}

// ---------- Pulizia file temporanei ----------

#[tauri::command]
fn scan_cleanup_targets() -> Vec<cleanup::CleanupTarget> {
    cleanup::scan()
}

#[tauri::command]
fn clean_target(target_id: String) -> Result<cleanup::CleanupResult, String> {
    cleanup::clean(&target_id)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState { sys: Mutex::new(System::new_all()) })
        .invoke_handler(tauri::generate_handler![
            list_processes,
            kill_process,
            set_process_priority,
            apply_power_plan,
            get_game_mode_status,
            set_game_mode,
            get_active_power_plan,
            network_snapshot,
            flush_dns_cache,
            list_registry_tweaks,
            apply_registry_tweak,
            scan_cleanup_targets,
            clean_target
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Overdrive");
}
