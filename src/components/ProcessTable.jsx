// src/components/ProcessTable.jsx
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function ProcessTable({
  pollMs = 2000,
  autoRefresh = true,
  confirmBeforeKill = true,
  limit = 30,
  onActivity,
}) {
  const [processes, setProcesses] = useState([]);
  const [error, setError] = useState(null);
  const [busyPid, setBusyPid] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke("list_processes");
      setProcesses(list);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!autoRefresh) {
      return undefined;
    }

    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [autoRefresh, pollMs, refresh]);

  const handleKill = async (pid) => {
    if (confirmBeforeKill && !window.confirm(`Terminare il processo PID ${pid}?`)) {
      return;
    }

    try {
      await invoke("kill_process", { pid });
      onActivity?.({
        title: `Processo terminato PID ${pid}`,
        detail: "Azione dalla sezione Processi",
        section: "processes",
      });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handlePriority = async (pid, level) => {
    try {
      await invoke("set_process_priority", { pid, level });
      onActivity?.({
        title: `Priorita ${level} impostata per PID ${pid}`,
        detail: "Cambio priorita processo",
        section: "processes",
      });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Processi attivi</h2>
        <span className="count">{processes.length} in esecuzione</span>
      </div>

      {error && <p className="error-note">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Processo</th><th>CPU</th><th>RAM</th><th>Priorita</th><th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {processes.slice(0, limit).map((p) => (
              <tr key={p.pid}>
                <td>
                  <div className="proc-name">
                    <span className="proc-icon" style={{ background: p.protected ? "#ff5470" : "#37e0d6" }} />
                    {p.name}
                  </div>
                </td>
                <td>{p.cpu_usage.toFixed(0)}%</td>
                <td>{p.memory_mb} MB</td>
                <td>
                  <select
                    className="priority-select"
                    defaultValue="normal"
                    disabled={p.protected || busyPid === p.pid}
                    onChange={(e) => handlePriority(p.pid, e.target.value)}
                  >
                    <option value="idle">Idle</option>
                    <option value="below">Bassa</option>
                    <option value="normal">Normale</option>
                    <option value="above">Sopra normale</option>
                    <option value="high">Alta</option>
                    <option value="realtime">Realtime</option>
                  </select>
                </td>
                <td>
                  <button
                    className="action-btn"
                    disabled={p.protected || busyPid === p.pid}
                    onClick={async () => {
                      setBusyPid(p.pid);
                      try {
                        await handleKill(p.pid);
                      } finally {
                        setBusyPid(null);
                      }
                    }}
                  >
                    {p.protected ? "Protetto" : busyPid === p.pid ? "..." : "Termina"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-foot">
        <button type="button" className="action-btn" onClick={refresh}>Aggiorna ora</button>
      </div>
    </div>
  );
}
