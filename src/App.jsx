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
};

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

export default function App() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [processes, setProcesses] = useState([]);
  const [processError, setProcessError] = useState("");
  const [gameModeActive, setGameModeActive] = useState(false);
  const [gameModeBusy, setGameModeBusy] = useState(false);
  const [gameModeError, setGameModeError] = useState("");
  const [settings, setSettings] = useState(() => loadStoredJson("overdrive-settings", DEFAULT_SETTINGS));
  const [activityLog, setActivityLog] = useState(() => loadStoredJson("overdrive-history", []));

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
    const avgCpu =
      total > 0 ? Math.min(100, processes.reduce((sum, p) => sum + p.cpu_usage, 0) / total) : 0;
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

  const gauges = useMemo(
    () => [
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
    ],
    [stats],
  );

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
                <p>Tweak di registro, pulizia file temporanei e scorciatoie di tuning.</p>
              </div>
              <GameModeSwitch
                active={gameModeActive}
                busy={gameModeBusy}
                onToggle={handleGameModeToggle}
              />
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
          <div className="brand-mark" />
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
          WIN 11 PRO - BUILD 26100
          <br />
          OVERDRIVE ENGINE v0.3.1
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