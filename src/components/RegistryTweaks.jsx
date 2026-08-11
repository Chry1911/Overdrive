// src/components/RegistryTweaks.jsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function RegistryTweaks({
  filterIds,
  title = "Tweak del registro",
  subtitle = "Backup .reg automatico prima di ogni modifica",
  onActivity,
}) {
  const [tweaks, setTweaks] = useState([]);
  const [active, setActive] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke("list_registry_tweaks").then(setTweaks).catch((e) => setError(String(e)));
  }, []);

  const toggle = async (id) => {
    setBusyId(id);
    setError(null);
    const willEnable = !active[id];
    try {
      await invoke("apply_registry_tweak", { tweakId: id, enable: willEnable });
      setActive((prev) => ({ ...prev, [id]: willEnable }));
      const tweak = tweaks.find((item) => item.id === id);
      onActivity?.({
        title: `${willEnable ? "Attivato" : "Disattivato"} ${tweak?.label ?? id}`,
        detail: "Modifica registro con backup automatico",
        section: "optimizations",
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const visibleTweaks = filterIds
    ? tweaks.filter((tweak) => filterIds.includes(tweak.id))
    : tweaks;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="count">{subtitle}</span>
      </div>
      {error && <p className="error-note">{error}</p>}
      <div className="opt-list">
        {visibleTweaks.map((t) => (
          <div className="opt-item" key={t.id}>
            <div>
              <div className="t">{t.label}</div>
              <div className="d">{t.description}</div>
            </div>
            <button
              className={`mini-toggle ${active[t.id] ? "on" : ""}`}
              onClick={() => toggle(t.id)}
              disabled={busyId === t.id}
              aria-label={`Attiva/disattiva ${t.label}`}
            />
          </div>
        ))}
        {visibleTweaks.length === 0 && <div className="empty-note">Nessun tweak disponibile in questa sezione.</div>}
      </div>
    </div>
  );
}
