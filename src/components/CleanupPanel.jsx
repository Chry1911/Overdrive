// src/components/CleanupPanel.jsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function CleanupPanel({
  title = "File temporanei",
  subtitle,
  onActivity,
}) {
  const [targets, setTargets] = useState([]);
  const [results, setResults] = useState({});
  const [busyId, setBusyId] = useState(null);

  const scan = () => invoke("scan_cleanup_targets").then(setTargets);

  useEffect(() => { scan(); }, []);

  const cleanOne = async (id) => {
    setBusyId(id);
    try {
      const res = await invoke("clean_target", { targetId: id });
      setResults((prev) => ({ ...prev, [id]: res }));
      onActivity?.({
        title: `Pulizia completata per ${id}`,
        detail: `Liberati ${res.freed_mb} MB`,
        section: "optimizations",
      });
      scan(); // riaggiorna le dimensioni dopo la pulizia
    } finally {
      setBusyId(null);
    }
  };

  const totalMb = targets.reduce((sum, t) => sum + t.size_mb, 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="count">{subtitle ?? `${totalMb} MB recuperabili`}</span>
      </div>
      <div className="opt-list">
        {targets.map((t) => (
          <div className="opt-item" key={t.id}>
            <div>
              <div className="t">{t.label}</div>
              <div className="d">
                {t.size_mb} MB · {t.file_count} file
                {results[t.id] && (
                  <> — liberati {results[t.id].freed_mb} MB
                    {results[t.id].errors.length > 0 &&
                      ` (${results[t.id].errors.length} file saltati, in uso)`}
                  </>
                )}
              </div>
            </div>
            <button
              className="action-btn"
              onClick={() => cleanOne(t.id)}
              disabled={busyId === t.id}
            >
              {busyId === t.id ? "Pulizia..." : "Svuota"}
            </button>
          </div>
        ))}
        {targets.length === 0 && <div className="empty-note">Nessun target di pulizia rilevato.</div>}
      </div>
    </div>
  );
}
