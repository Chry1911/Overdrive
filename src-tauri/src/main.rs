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

use semver::Version;
use serde::Deserialize;
use serde::Serialize;
use sysinfo::{Components, Disks, Pid, System};
use std::collections::HashSet;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::ProcessStatus::K32EmptyWorkingSet;
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    OpenProcess, SetPriorityClass, PROCESS_ALL_ACCESS, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SET_QUOTA,
    ABOVE_NORMAL_PRIORITY_CLASS, BELOW_NORMAL_PRIORITY_CLASS,
    HIGH_PRIORITY_CLASS, IDLE_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
    REALTIME_PRIORITY_CLASS, PROCESS_CREATION_FLAGS,
};

/// Processi che il tool non deve mai poter terminare o ri-priorizzare.
const PROTECTED: &[&str] = &[
    "csrss.exe", "wininit.exe", "winlogon.exe", "smss.exe",
    "services.exe", "lsass.exe", "system", "explorer.exe",
];

const GAME_PROCESS_BLOCKLIST: &[&str] = &[
    "steam.exe",
    "epicgameslauncher.exe",
    "eadesktop.exe",
    "battle.net.exe",
    "upc.exe",
    "riotclientservices.exe",
    "gog galaxy.exe",
    "explorer.exe",
    "dwm.exe",
    "searchhost.exe",
    "svchost.exe",
];

const DEFAULT_LAUNCHER_WHITELIST: &[&str] = &[
    "steamapps",
    "epic games",
    "riot games",
    "battle.net",
    "ubisoft",
    "xboxgames",
    "gog galaxy",
];

const DEFAULT_TITLE_KEYWORDS: &[&str] = &[
    "valorant",
    "fortnite",
    "cs2",
    "counter",
    "elden",
    "league",
    "rocketleague",
    "minecraft",
    "gta",
    "forza",
    "warzone",
    "apex",
];

const DEFAULT_PATH_KEYWORDS: &[&str] = &[
    "steamapps",
    "epic games",
    "riot games",
    "battle.net",
    "ubisoft",
    "xboxgames",
    "gog galaxy",
    "\\games\\",
    "\\common\\",
    "\\binaries\\win",
];

const GITHUB_OWNER: &str = "Chry1911";
const GITHUB_REPO: &str = "Overdrive";

struct AppState {
    sys: Mutex<System>,
    known_game_pids: Mutex<HashSet<u32>>,
    game_history: Mutex<Vec<GameExecution>>,
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

#[derive(Serialize, Clone)]
struct HardwareDisk {
    name: String,
    mount_point: String,
    total_gb: f32,
    available_gb: f32,
}

#[derive(Serialize, Clone)]
struct HardwareSnapshot {
    hostname: String,
    os_name: String,
    kernel: String,
    cpu_brand: String,
    cpu_physical_cores: usize,
    cpu_logical_cores: usize,
    cpu_frequency_mhz: u64,
    cpu_usage_percent: f32,
    total_ram_gb: f32,
    used_ram_gb: f32,
    free_ram_gb: f32,
    uptime_seconds: u64,
    disks: Vec<HardwareDisk>,
}

#[derive(Serialize, Clone)]
struct TemperatureReading {
    label: String,
    temperature_c: f32,
    critical_c: Option<f32>,
}

#[derive(Serialize, Clone)]
struct TemperatureSnapshot {
    supported: bool,
    max_c: Option<f32>,
    avg_c: Option<f32>,
    sensors: Vec<TemperatureReading>,
}

#[derive(Serialize, Deserialize, Clone)]
struct GameExecution {
    id: String,
    process_name: String,
    pid: u32,
    started_unix: u64,
    executable: Option<String>,
}

#[derive(Serialize, Clone)]
struct RamClearResult {
    scanned: u32,
    trimmed: u32,
    failed: u32,
    used_before_mb: u64,
    used_after_mb: u64,
    freed_mb: u64,
}

#[derive(Serialize, Clone)]
struct UpdateStatus {
    current_version: String,
    latest_version: String,
    update_available: bool,
    release_url: String,
    published_at: Option<String>,
    release_title: Option<String>,
    release_notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameTrackingConfig {
    enabled: bool,
    aggressive: bool,
    launcher_whitelist: Vec<String>,
    title_keywords: Vec<String>,
    path_keywords: Vec<String>,
}

fn game_history_file() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Overdrive")
        .join("game-history.json")
}

fn load_game_history_from_disk() -> Vec<GameExecution> {
    let file = game_history_file();
    let Ok(raw) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn persist_game_history(history: &[GameExecution]) {
    let file = game_history_file();
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(history) {
        let _ = std::fs::write(file, raw);
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn default_game_tracking_config() -> GameTrackingConfig {
    GameTrackingConfig {
        enabled: true,
        aggressive: true,
        launcher_whitelist: DEFAULT_LAUNCHER_WHITELIST.iter().map(|v| v.to_string()).collect(),
        title_keywords: DEFAULT_TITLE_KEYWORDS.iter().map(|v| v.to_string()).collect(),
        path_keywords: DEFAULT_PATH_KEYWORDS.iter().map(|v| v.to_string()).collect(),
    }
}

fn normalize_terms(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn looks_like_game(name: &str, exe_path: Option<&Path>, config: &GameTrackingConfig) -> bool {
    let lower_name = name.to_lowercase();
    if !lower_name.ends_with(".exe") {
        return false;
    }
    if GAME_PROCESS_BLOCKLIST.contains(&lower_name.as_str()) {
        return false;
    }

    let exe_lower = exe_path
        .map(|path| path.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let launcher_whitelist = normalize_terms(&config.launcher_whitelist);
    let title_keywords = normalize_terms(&config.title_keywords);
    let path_keywords = normalize_terms(&config.path_keywords);

    if launcher_whitelist.iter().any(|keyword| {
        lower_name.contains(keyword) || exe_lower.contains(keyword)
    }) {
        return true;
    }

    if path_keywords.iter().any(|keyword| exe_lower.contains(keyword)) {
        return true;
    }

    if title_keywords
        .iter()
        .any(|keyword| lower_name.contains(keyword) || exe_lower.contains(keyword))
    {
        return true;
    }

    if config.aggressive {
        let aggressive_path_hints = ["\\game", "\\games", "\\steam", "\\riot", "\\epic", "\\xbox"];
        if aggressive_path_hints
            .iter()
            .any(|hint| exe_lower.contains(hint))
        {
            return true;
        }
    }

    false
}

fn normalize_version_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('v').to_string()
}

fn is_latest_newer(latest: &str, current: &str) -> bool {
    let latest_norm = normalize_version_tag(latest);
    let current_norm = normalize_version_tag(current);
    match (Version::parse(&latest_norm), Version::parse(&current_norm)) {
        (Ok(latest_v), Ok(current_v)) => latest_v > current_v,
        _ => latest_norm != current_norm,
    }
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

#[tauri::command]
fn get_hardware_snapshot(state: State<AppState>) -> HardwareSnapshot {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_all();

    let cpus = sys.cpus();
    let cpu_brand = cpus
        .first()
        .map(|cpu| cpu.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let cpu_frequency_mhz = cpus.first().map(|cpu| cpu.frequency()).unwrap_or(0);
    let cpu_usage_percent = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / cpus.len() as f32
    };

    let total_ram = sys.total_memory();
    let used_ram = sys.used_memory();
    let free_ram = total_ram.saturating_sub(used_ram);

    let disks = Disks::new_with_refreshed_list()
        .iter()
        .map(|disk| HardwareDisk {
            name: disk.name().to_string_lossy().to_string(),
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            total_gb: (disk.total_space() as f64 / 1024_f64.powi(3)) as f32,
            available_gb: (disk.available_space() as f64 / 1024_f64.powi(3)) as f32,
        })
        .collect();

    HardwareSnapshot {
        hostname: System::host_name().unwrap_or_else(|| "Unknown".to_string()),
        os_name: format!(
            "{} {}",
            System::name().unwrap_or_else(|| "Windows".to_string()),
            System::os_version().unwrap_or_default(),
        )
        .trim()
        .to_string(),
        kernel: System::kernel_version().unwrap_or_else(|| "Unknown".to_string()),
        cpu_brand,
        cpu_physical_cores: sys.physical_core_count().unwrap_or(cpus.len()),
        cpu_logical_cores: cpus.len(),
        cpu_frequency_mhz,
        cpu_usage_percent,
        total_ram_gb: total_ram as f32 / 1024_f32.powi(3),
        used_ram_gb: used_ram as f32 / 1024_f32.powi(3),
        free_ram_gb: free_ram as f32 / 1024_f32.powi(3),
        uptime_seconds: System::uptime(),
        disks,
    }
}

#[tauri::command]
fn list_temperatures() -> TemperatureSnapshot {
    let mut components = Components::new_with_refreshed_list();
    components.refresh();

    let sensors: Vec<TemperatureReading> = components
        .iter()
        .map(|component| TemperatureReading {
            label: component.label().to_string(),
            temperature_c: component.temperature(),
            critical_c: component.critical(),
        })
        .collect();

    let max_c = sensors
        .iter()
        .map(|sensor| sensor.temperature_c)
        .reduce(f32::max);
    let avg_c = if sensors.is_empty() {
        None
    } else {
        Some(sensors.iter().map(|sensor| sensor.temperature_c).sum::<f32>() / sensors.len() as f32)
    };

    TemperatureSnapshot {
        supported: !sensors.is_empty(),
        max_c,
        avg_c,
        sensors,
    }
}

#[tauri::command]
fn scan_game_sessions(state: State<AppState>) -> Vec<GameExecution> {
    let config = default_game_tracking_config();
    scan_game_sessions_with_config(state, Some(config))
}

#[tauri::command]
fn scan_game_sessions_with_config(
    state: State<AppState>,
    config: Option<GameTrackingConfig>,
) -> Vec<GameExecution> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_all();

    let mut known = state.known_game_pids.lock().unwrap();
    let mut history = state.game_history.lock().unwrap();
    let config = config.unwrap_or_else(default_game_tracking_config);

    if !config.enabled {
        return Vec::new();
    }

    let current_pids: HashSet<u32> = sys.processes().keys().map(|pid| pid.as_u32()).collect();
    let mut added = Vec::new();

    for (pid, process) in sys.processes() {
        let pid_u32 = pid.as_u32();
        if known.contains(&pid_u32) {
            continue;
        }

        let name = process.name().to_string_lossy().to_string();
        let exe = process.exe();
        if looks_like_game(&name, exe, &config) {
            let item = GameExecution {
                id: format!("{}-{}", now_unix(), pid_u32),
                process_name: name,
                pid: pid_u32,
                started_unix: now_unix(),
                executable: exe.map(|path| path.to_string_lossy().to_string()),
            };
            known.insert(pid_u32);
            history.insert(0, item.clone());
            added.push(item);
        }
    }

    known.retain(|pid| current_pids.contains(pid));
    history.truncate(500);

    if !added.is_empty() {
        persist_game_history(&history);
    }

    added
}

#[tauri::command]
fn list_game_history(state: State<AppState>) -> Vec<GameExecution> {
    state.game_history.lock().unwrap().clone()
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn clear_ram(state: State<AppState>) -> Result<RamClearResult, String> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_all();
    let used_before_mb = sys.used_memory() / 1024 / 1024;

    let mut scanned: u32 = 0;
    let mut trimmed: u32 = 0;
    let mut failed: u32 = 0;

    let targets: Vec<(u32, String)> = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            (
                pid.as_u32(),
                process.name().to_string_lossy().to_lowercase(),
            )
        })
        .collect();

    for (pid, lower_name) in targets {
        if PROTECTED.contains(&lower_name.as_str()) || pid == std::process::id() {
            continue;
        }

        scanned += 1;

        unsafe {
            match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, false, pid) {
                Ok(handle) => {
                    if K32EmptyWorkingSet(handle).as_bool() {
                        trimmed += 1;
                    } else {
                        failed += 1;
                    }
                    let _ = CloseHandle(handle);
                }
                Err(_) => {
                    failed += 1;
                }
            }
        }
    }

    sys.refresh_memory();
    let used_after_mb = sys.used_memory() / 1024 / 1024;
    let freed_mb = used_before_mb.saturating_sub(used_after_mb);

    Ok(RamClearResult {
        scanned,
        trimmed,
        failed,
        used_before_mb,
        used_after_mb,
        freed_mb,
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn clear_ram(_state: State<AppState>) -> Result<RamClearResult, String> {
    Err("Disponibile solo su Windows".into())
}

#[tauri::command]
fn check_github_update() -> Result<UpdateStatus, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );

    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("Client HTTP non disponibile: {e}"))?;

    let response = client
        .get(url)
        .header("User-Agent", "overdrive-updater")
        .send()
        .map_err(|e| format!("Errore richiesta release GitHub: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API ha restituito stato {}",
            response.status()
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .map_err(|e| format!("Risposta GitHub non valida: {e}"))?;

    let latest_version = payload
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    let release_url = payload
        .get("html_url")
        .and_then(|value| value.as_str())
        .unwrap_or("https://github.com")
        .to_string();

    Ok(UpdateStatus {
        current_version: current_version.clone(),
        latest_version: latest_version.clone(),
        update_available: is_latest_newer(&latest_version, &current_version),
        release_url,
        published_at: payload
            .get("published_at")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        release_title: payload
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        release_notes: payload
            .get("body")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    })
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn open_release_page(url: String) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .status()
        .map_err(|e| e.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("Impossibile aprire il browser di sistema".into())
            }
        })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_release_page(_url: String) -> Result<(), String> {
    Err("Disponibile solo su Windows".into())
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
    let initial_history = load_game_history_from_disk();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
            known_game_pids: Mutex::new(HashSet::new()),
            game_history: Mutex::new(initial_history),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Ok(())
        })
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
            clean_target,
            get_hardware_snapshot,
            list_temperatures,
            scan_game_sessions,
            scan_game_sessions_with_config,
            list_game_history,
            clear_ram,
            check_github_update,
            open_release_page
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Overdrive");
}
