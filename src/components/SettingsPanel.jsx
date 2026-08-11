export default function SettingsPanel({ settings, onChange, onReset }) {
  const updateSetting = (key, value) => {
    onChange((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <section className="section-stack">
      <div className="hero-panel">
        <div>
          <h2>Impostazioni</h2>
          <p>Preferenze locali che influenzano il comportamento reale della dashboard.</p>
        </div>
        <button type="button" className="action-btn" onClick={onReset}>
          Ripristina default
        </button>
      </div>

      <div className="panel">
        <div className="opt-list settings-list">
          <label className="setting-row">
            <div>
              <div className="t">Aggiornamento automatico</div>
              <div className="d">Controlla se processi e telemetria vengono ricaricati da soli.</div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoRefresh}
              onChange={(event) => updateSetting("autoRefresh", event.target.checked)}
            />
          </label>

          <label className="setting-row">
            <div>
              <div className="t">Intervallo polling</div>
              <div className="d">Valore in millisecondi per refresh processi e dashboard.</div>
            </div>
            <input
              className="settings-input"
              type="number"
              min="1000"
              step="500"
              value={settings.pollMs}
              onChange={(event) => updateSetting("pollMs", Number(event.target.value) || 2000)}
            />
          </label>

          <label className="setting-row">
            <div>
              <div className="t">Conferma prima di terminare un processo</div>
              <div className="d">Evita chiusure accidentali dei processi non protetti.</div>
            </div>
            <input
              type="checkbox"
              checked={settings.confirmBeforeKill}
              onChange={(event) => updateSetting("confirmBeforeKill", event.target.checked)}
            />
          </label>
        </div>
      </div>
    </section>
  );
}