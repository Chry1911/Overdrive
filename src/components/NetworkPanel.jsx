import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function NetworkPanel({ onActivity }) {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const value = await invoke("network_snapshot");
      setSnapshot(value);
      setError("");
    } catch (currentError) {
      setError(String(currentError));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const flushDns = async () => {
    setBusy(true);
    try {
      await invoke("flush_dns_cache");
      onActivity?.({
        title: "Cache DNS svuotata",
        detail: "Comando ipconfig /flushdns completato",
        section: "network",
      });
      await refresh();
    } catch (currentError) {
      setError(String(currentError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section-stack">
      <div className="hero-panel">
        <div>
          <h2>Rete</h2>
          <p>Diagnostica rapida per latenza e utility base per la sessione di gioco.</p>
        </div>
        <button type="button" className="action-btn" onClick={refresh}>
          Aggiorna test
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}

      <div className="network-grid">
        <div className="info-card">
          <span className="metric-name">Stato</span>
          <strong>{snapshot?.connected ? "Online" : "Offline / bloccato"}</strong>
          <p>Test TCP verso {snapshot?.sample_host ?? "1.1.1.1:443"}</p>
        </div>
        <div className="info-card">
          <span className="metric-name">Latenza</span>
          <strong>{snapshot?.latency_ms != null ? `${snapshot.latency_ms} ms` : "n/d"}</strong>
          <p>Misura rapida di raggiungibilita per il path di rete.</p>
        </div>
        <div className="info-card">
          <span className="metric-name">DNS</span>
          <strong>Manutenzione cache</strong>
          <button type="button" className="action-btn" disabled={busy} onClick={flushDns}>
            {busy ? "Eseguo..." : "Flush DNS"}
          </button>
        </div>
      </div>
    </section>
  );
}