import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ProcessTable from "./components/ProcessTable";
import GameModeSwitch from "./components/GameModeSwitch";
import RegistryTweaks from "./components/RegistryTweaks";
import CleanupPanel from "./components/CleanupPanel";
import PowerPlanPanel from "./components/PowerPlanPanel";
import NetworkPanel from "./components/NetworkPanel";
import HistoryPanel from "./components/HistoryPanel";
import SettingsPanel from "./components/SettingsPanel";
import appIcon from "./assets/overdrive_icon.svg";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "processes", label: "Processi" },
  { id: "optimizations", label: "Ottimizzazioni" },
  { id: "power", label: "Power Plan" },
  { id: "network", label: "Rete" },
  { id: "history", label: "Cronologia" },
  { id: "settings", label: "Impostazioni" },
];

const DEFAULT_SETTINGS = {
  autoRefresh: true,
  pollMs: 2000,
  confirmBeforeKill: true,
  gameTracking: {
    enabled: true,
    aggressive: true,
    launcherWhitelist: "steamapps, epic games, riot games, battle.net, ubisoft, xboxgames, gog galaxy",
    titleKeywords: "valorant, fortnite, cs2, counter, elden, league, rocketleague, minecraft, gta, forza, warzone, apex",
    pathKeywords: "steamapps, epic games, riot games, battle.net, ubisoft, xboxgames, gog galaxy, \\games\\, \\common\\, \\binaries\\win",
  },
};

function csvToList(raw) {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadStoredJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : fallback;
    }

    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function formatUptime(seconds) {
  if (!seconds) {
    return "n/d";
  }

  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  const displayHours = hours % 24;

  if (days > 0) {
    return `${days}g ${displayHours}h`;
  }

  return `${hours}h`;
}

function formatGameTime(unixSeconds) {
  if (!unixSeconds) {
    return "n/d";
  }

  return new Date(unixSeconds * 1000).toLocaleString();
}

export default function App() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [processes, setProcesses] = useState([]);
  const [processError, setProcessError] = useState("");
  const [gameModeActive, setGameModeActive] = useState(false);
  const [gameModeBusy, setGameModeBusy] = useState(false);
  const [gameModeError, setGameModeError] = useState("");
  const [settings, setSettings] = useState(() => loadStoredJson("overdrive-settings", DEFAULT_SETTINGS));
  const [activityLog, setActivityLog] = useState(() => loadStoredJson("overdrive-history", []));
  const [hardware, setHardware] = useState(null);
  const [temperatures, setTemperatures] = useState({ supported: false, sensors: [] });
  const [gameRuns, setGameRuns] = useState([]);
  const [telemetryError, setTelemetryError] = useState("");
  const [ramBusy, setRamBusy] = useState(false);
  const [ramResult, setRamResult] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateError, setUpdateError] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const trackingConfig = useMemo(() => {
    const config = settings.gameTracking ?? DEFAULT_SETTINGS.gameTracking;
    return {
      enabled: Boolean(config.enabled),
      aggressive: Boolean(config.aggressive),
      launcherWhitelist: csvToList(config.launcherWhitelist),
      titleKeywords: csvToList(config.titleKeywords),
      pathKeywords: csvToList(config.pathKeywords),
    };
  }, [settings.gameTracking]);

  const addActivity = useCallback((entry) => {
    setActivityLog((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...entry,
      },
      ...previous,
    ].slice(0, 100));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("overdrive-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem("overdrive-history", JSON.stringify(activityLog));
  }, [activityLog]);

  const syncGameModeStatus = useCallback(async () => {
    try {
      const active = await invoke("get_game_mode_status");
      setGameModeActive(Boolean(active));
      setGameModeError("");
    } catch (error) {
      setGameModeError(String(error));
    }
  }, []);

  useEffect(() => {
    syncGameModeStatus();
  }, [syncGameModeStatus]);

  const checkForUpdates = useCallback(async (silent = false) => {
    if (!silent) {
      setCheckingUpdates(true);
    }

    try {
      const nextStatus = await invoke("check_github_update");
      setUpdateStatus(nextStatus);
      setUpdateError("");

      if (nextStatus.update_available) {
        addActivity({
          title: `Nuovo update disponibile ${nextStatus.latest_version}`,
          detail: "Apri il pannello Dashboard per aggiornare",
          section: "dashboard",
        });
      }
    } catch (error) {
      setUpdateError(String(error));
    } finally {
      if (!silent) {
        setCheckingUpdates(false);
      }
    }
  }, [addActivity]);

  const refreshSystemMirror = useCallback(async () => {
    try {
      const newGames = await invoke("scan_game_sessions_with_config", { config: trackingConfig });
      const [hardwareSnapshot, temperatureSnapshot, historySnapshot] = await Promise.all([
        invoke("get_hardware_snapshot"),
        invoke("list_temperatures"),
        invoke("list_game_history"),
      ]);

      setHardware(hardwareSnapshot);
      setTemperatures(temperatureSnapshot);
      setGameRuns(Array.isArray(historySnapshot) ? historySnapshot : []);
      setTelemetryError("");

      if (Array.isArray(newGames) && newGames.length > 0) {
        newGames.forEach((game) => {
          addActivity({
            title: `Gioco rilevato: ${game.process_name}`,
            detail: `PID ${game.pid}`,
            section: "dashboard",
          });
        });
      }
    } catch (error) {
      setTelemetryError(String(error));
    }
  }, [addActivity, trackingConfig]);

  useEffect(() => {
    refreshSystemMirror();
    checkForUpdates(true);

    const telemetryId = setInterval(refreshSystemMirror, 10000);
    const updateId = setInterval(() => checkForUpdates(true), 1000 * 60 * 20);

    return () => {
      clearInterval(telemetryId);
      clearInterval(updateId);
    };
  }, [checkForUpdates, refreshSystemMirror]);

  const handleGameModeToggle = useCallback(async () => {
    const nextState = !gameModeActive;
    setGameModeBusy(true);
    try {
      const result = await invoke("set_game_mode", { enable: nextState });
      setGameModeActive(Boolean(result.enabled));
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        setGameModeError(result.warnings.join(" | "));
      } else {
        setGameModeError("");
      }

      addActivity({
        title: `Gaming Mode ${result.enabled ? "attivata" : "disattivata"}`,
        detail: `Operazioni applicate: ${result.applied.length}`,
        section: "power",
      });
    } catch (error) {
      setGameModeError(String(error));
    } finally {
      setGameModeBusy(false);
    }
  }, [addActivity, gameModeActive]);

  const handleClearRam = useCallback(async () => {
    setRamBusy(true);
    try {
      const result = await invoke("clear_ram");
      setRamResult(result);
      addActivity({
        title: `Clear RAM completato: ${result.freed_mb} MB liberati`,
        detail: `${result.trimmed}/${result.scanned} processi ottimizzati`,
        section: "optimizations",
      });
      refreshSystemMirror();
    } catch (error) {
      setGameModeError(String(error));
    } finally {
      setRamBusy(false);
    }
  }, [addActivity, refreshSystemMirror]);

  const openReleasePage = useCallback(async () => {
    if (!updateStatus?.release_url) {
      return;
    }

    try {
      await invoke("open_release_page", { url: updateStatus.release_url });
    } catch (error) {
      setUpdateError(String(error));
    }
  }, [updateStatus]);

  const refreshProcesses = useCallback(async () => {
    try {
      const list = await invoke("list_processes");
      setProcesses(list);
      setProcessError("");
    } catch (error) {
      setProcessError(String(error));
    }
  }, []);

  useEffect(() => {
    refreshProcesses();
    if (!settings.autoRefresh) {
      return undefined;
    }

    const id = setInterval(refreshProcesses, settings.pollMs);
    return () => clearInterval(id);
  }, [refreshProcesses, settings.autoRefresh, settings.pollMs]);

  const stats = useMemo(() => {
    const total = processes.length;
    const protectedCount = processes.filter((p) => p.protected).length;
    const killable = Math.max(0, total - protectedCount);
    const topCpu = processes[0]?.cpu_usage ?? 0;
    const avgCpu = total > 0 ? Math.min(100, processes.reduce((sum, p) => sum + p.cpu_usage, 0) / total) : 0;
    const totalMemMb = processes.reduce((sum, p) => sum + p.memory_mb, 0);
    const topMemMb = processes[0]?.memory_mb ?? 0;

    return {
      total,
      killable,
      protectedCount,
      topCpu,
      avgCpu,
      totalMemGb: (totalMemMb / 1024).toFixed(1),
      topMemMb,
    };
  }, [processes]);

  const gauges = useMemo(() => [
    {
      name: "CPU media processi",
      value: `${Math.round(stats.avgCpu)}%`,
      sub: `Picco ${Math.round(stats.topCpu)}%`,
      color: "#37e0d6",
      offset: 314 - (Math.max(0, Math.min(100, stats.avgCpu)) / 100) * 314,
    },
    {
      name: "PROCESSI ATTIVI",
      value: String(stats.total),
      sub: `${stats.killable} gestibili`,
      color: "#ffb020",
      offset: 314 - (Math.max(0, Math.min(100, stats.total / 2)) / 100) * 314,
    },
    {
      name: "RAM processi",
      value: `${stats.totalMemGb} GB`,
      sub: `Top ${stats.topMemMb} MB`,
      color: "#37e0d6",
      offset: 314 - (Math.max(0, Math.min(100, Number(stats.totalMemGb) * 5)) / 100) * 314,
    },
    {
      name: "PROTETTI",
      value: String(stats.protectedCount),
      sub: "Non terminabili",
      color: "#37e0d6",
      offset: 314 - (Math.max(0, Math.min(100, stats.protectedCount * 2)) / 100) * 314,
    },
  ], [stats]);

  const sectionTitle = NAV_ITEMS.find((item) => item.id === activeSection)?.label ?? "Dashboard";

  const renderDashboard = () => (
    <>
      <section className="gauges">
        {gauges.map((gauge) => (
          <div key={gauge.name} className="gauge-card">
            <div className="metric-name">{gauge.name}</div>
            <svg className="ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#1e242b" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke={gauge.color}
                strokeWidth="10"
                strokeDasharray="314"
                strokeDashoffset={gauge.offset}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
              <text x="60" y="66" textAnchor="middle" fill="#e8ecef" className="ring-value">
                {gauge.value}
              </text>
            </svg>
            <div className="ring-sub">{gauge.sub}</div>
          </div>
        ))}
      </section>

      <section className="system-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Hardware mirror</h2>
          </div>
          <div className="opt-list">
            <div className="info-card">
              <strong>{hardware?.cpu_brand ?? "Rilevazione in corso..."}</strong>
              <p>
                {hardware ? `${hardware.cpu_logical_cores} thread | ${hardware.cpu_frequency_mhz} MHz | ${Math.round(hardware.cpu_usage_percent)}%` : "CPU"}
              </p>
            </div>
            <div className="info-card">
              <strong>{hardware ? `${hardware.used_ram_gb.toFixed(1)} / ${hardware.total_ram_gb.toFixed(1)} GB RAM` : "RAM"}</strong>
              <p>Libera: {hardware ? `${hardware.free_ram_gb.toFixed(1)} GB` : "n/d"}</p>
            </div>
            <div className="info-card">
              <strong>{hardware?.os_name ?? "Sistema operativo"}</strong>
              <p>Host: {hardware?.hostname ?? "n/d"} | Uptime: {formatUptime(hardware?.uptime_seconds)}</p>
            </div>
            {(hardware?.disks ?? []).slice(0, 2).map((disk) => (
              <div key={`${disk.name}-${disk.mount_point}`} className="info-card">
                <strong>{disk.name} ({disk.mount_point})</strong>
                <p>{disk.available_gb.toFixed(0)} GB liberi su {disk.total_gb.toFixed(0)} GB</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Temperature PC</h2>
          </div>
          <div className="opt-list">
            {temperatures.supported ? (
              <>
                <div className="info-card">
                  <strong>Max {Math.round(temperatures.max_c ?? 0)} C</strong>
                  <p>Media {Math.round(temperatures.avg_c ?? 0)} C</p>
                </div>
                {temperatures.sensors.slice(0, 4).map((sensor) => (
                  <div key={sensor.label} className="info-card">
                    <strong>{sensor.label}</strong>
                    <p>{Math.round(sensor.temperature_c)} C{sensor.critical_c ? ` | critical ${Math.round(sensor.critical_c)} C` : ""}</p>
                  </div>
                ))}
              </>
            ) : (
              <p className="empty-note">Sensori termici non disponibili da OS/driver. Prova a eseguire Overdrive come amministratore.</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Giochi eseguiti</h2>
          </div>
          <div className="opt-list history-list">
            <p className="empty-note">
              Rilevazione {trackingConfig.aggressive ? "aggressiva" : "standard"} con whitelist configurabile.
            </p>
            {gameRuns.length > 0 ? gameRuns.slice(0, 8).map((item) => (
              <div key={item.id} className="history-item">
                <div>
                  <div className="t">{item.process_name}</div>
                  <div className="d">PID {item.pid}</div>
                </div>
                <div className="history-meta">
                  <span>{formatGameTime(item.started_unix)}</span>
                </div>
              </div>
            )) : <p className="empty-note">Nessun gioco rilevato finora.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Update e memoria</h2>
          </div>
          <div className="opt-list">
            <div className="info-card">
              <strong>
                {updateStatus ? `Versione ${updateStatus.current_version}` : "Update non verificato"}
              </strong>
              <p>
                {updateStatus
                  ? updateStatus.update_available
                    ? `Nuova versione: ${updateStatus.latest_version}`
                    : "Sei gia aggiornato"
                  : "Premi verifica update"}
              </p>
            </div>

            {ramResult ? (
              <div className="info-card">
                <strong>Clear RAM: {ramResult.freed_mb} MB liberati</strong>
                <p>Processi ottimizzati: {ramResult.trimmed}/{ramResult.scanned}</p>
              </div>
            ) : null}

            <div className="button-row">
              <button type="button" className="action-btn" disabled={checkingUpdates} onClick={() => checkForUpdates(false)}>
                {checkingUpdates ? "Verifica..." : "Verifica update"}
              </button>
              <button
                type="button"
                className="action-btn"
                disabled={!updateStatus?.update_available}
                onClick={openReleasePage}
              >
                Apri release
              </button>
              <button type="button" className="action-btn" disabled={ramBusy} onClick={handleClearRam}>
                {ramBusy ? "Clear RAM..." : "Clear RAM"}
              </button>
            </div>
            {updateError ? <p className="error-note">Update: {updateError}</p> : null}
          </div>
        </div>
      </section>

      <section className="panels">
        <ProcessTable
          pollMs={settings.pollMs}
          autoRefresh={settings.autoRefresh}
          confirmBeforeKill={settings.confirmBeforeKill}
          onActivity={addActivity}
        />

        <div className="right-stack">
          <RegistryTweaks onActivity={addActivity} />
          <CleanupPanel onActivity={addActivity} />
        </div>
      </section>
    </>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard":
        return renderDashboard();
      case "processes":
        return (
          <section className="section-stack">
            <div className="hero-panel">
              <div>
                <h2>Gestione processi</h2>
                <p>Elenco reale, terminazione controllata e priorita modificabile.</p>
              </div>
              <div className="status-pill">{stats.killable} processi gestibili</div>
            </div>
            <ProcessTable
              pollMs={settings.pollMs}
              autoRefresh={settings.autoRefresh}
              confirmBeforeKill={settings.confirmBeforeKill}
              limit={100}
              onActivity={addActivity}
            />
          </section>
        );
      case "optimizations":
        return (
          <section className="section-stack">
            <div className="hero-panel">
              <div>
                <h2>Ottimizzazioni di sistema</h2>
                <p>Tweak di registro, pulizia file temporanei, clear RAM e Gaming Mode.</p>
              </div>
              <GameModeSwitch
                active={gameModeActive}
                busy={gameModeBusy}
                onToggle={handleGameModeToggle}
              />
            </div>
            <div className="hero-panel">
              <div>
                <h2>Clear RAM</h2>
                <p>Riduce il working set dei processi utente per recuperare memoria.</p>
              </div>
              <button type="button" className="action-btn" disabled={ramBusy} onClick={handleClearRam}>
                {ramBusy ? "Clear RAM..." : "Esegui ora"}
              </button>
            </div>
            <div className="right-stack right-stack-grid">
              <RegistryTweaks onActivity={addActivity} />
              <CleanupPanel onActivity={addActivity} />
            </div>
          </section>
        );
      case "power":
        return <PowerPlanPanel onActivity={addActivity} />;
      case "network":
        return (
          <section className="section-stack">
            <NetworkPanel onActivity={addActivity} />
            <RegistryTweaks
              filterIds={["disable_nagle"]}
              title="Tweak rete"
              subtitle="Ottimizzazioni dedicate alla latenza"
              onActivity={addActivity}
            />
          </section>
        );
      case "history":
        return <HistoryPanel items={activityLog} onClear={() => setActivityLog([])} />;
      case "settings":
        return <SettingsPanel settings={settings} onChange={setSettings} onReset={() => setSettings(DEFAULT_SETTINGS)} />;
      default:
        return renderDashboard();
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={appIcon} alt="Overdrive icon" className="brand-mark-image" />
          </div>
          <div>
            <div className="brand-name">Overdrive</div>
            <div className="brand-sub">SYSTEM TELEMETRY</div>
          </div>
        </div>

        <ul className="nav">
          {NAV_ITEMS.map((item) => (
            <li
              key={item.id}
              className={activeSection === item.id ? "active" : ""}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="dot" />
              {item.label}
            </li>
          ))}
        </ul>

        <div className="sidebar-foot">
          {hardware?.os_name ?? "WINDOWS"}
          <br />
          OVERDRIVE ENGINE v0.4.0
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{sectionTitle}</h1>
            <p>
              Stato reale in tempo reale - {stats.total} processi attivi
              {processError ? " (errore lettura processi)" : ""}
            </p>
            {gameModeError ? <p className="error-note game-mode-error">Gaming Mode: {gameModeError}</p> : null}
            {telemetryError ? <p className="error-note game-mode-error">Telemetry: {telemetryError}</p> : null}
          </div>
          <GameModeSwitch
            active={gameModeActive}
            busy={gameModeBusy}
            onToggle={handleGameModeToggle}
          />
        </div>

        {renderSection()}

        <div className="footer-note">
          <span className="pulse" />
          Motore di ottimizzazione attivo - polling processi ogni {settings.pollMs / 1000}s
        </div>
      </main>
    </div>
  );
}
