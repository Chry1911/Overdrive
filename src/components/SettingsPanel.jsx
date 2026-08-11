export default function SettingsPanel({ settings, onChange, onReset }) {
  const updateSetting = (key, value) => {
    onChange((previous) => ({ ...previous, [key]: value }));
  };

  const updateTracking = (key, value) => {
    onChange((previous) => ({
      ...previous,
      gameTracking: {
        ...(previous.gameTracking ?? {}),
        [key]: value,
      },
    }));
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

          <label className="setting-row">
            <div>
              <div className="t">Tracking giochi abilitato</div>
              <div className="d">Attiva il rilevamento dei giochi in esecuzione.</div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(settings.gameTracking?.enabled)}
              onChange={(event) => updateTracking("enabled", event.target.checked)}
            />
          </label>

          <label className="setting-row">
            <div>
              <div className="t">Modalita aggressiva</div>
              <div className="d">Usa euristiche piu estese su path e nomi processo per trovare piu giochi.</div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(settings.gameTracking?.aggressive)}
              onChange={(event) => updateTracking("aggressive", event.target.checked)}
            />
          </label>

          <label className="setting-row setting-row-textarea">
            <div>
              <div className="t">Whitelist launcher (CSV)</div>
              <div className="d">Esempio: steamapps, epic games, riot games, battle.net</div>
            </div>
            <textarea
              className="settings-textarea"
              rows={3}
              value={settings.gameTracking?.launcherWhitelist ?? ""}
              onChange={(event) => updateTracking("launcherWhitelist", event.target.value)}
            />
          </label>

          <label className="setting-row setting-row-textarea">
            <div>
              <div className="t">Keyword titoli gioco (CSV)</div>
              <div className="d">Esempio: valorant, fortnite, elden, apex</div>
            </div>
            <textarea
              className="settings-textarea"
              rows={3}
              value={settings.gameTracking?.titleKeywords ?? ""}
              onChange={(event) => updateTracking("titleKeywords", event.target.value)}
            />
          </label>

          <label className="setting-row setting-row-textarea">
            <div>
              <div className="t">Keyword path (CSV)</div>
              <div className="d">Esempio: \\games\\, \\common\\, \\binaries\\win</div>
            </div>
            <textarea
              className="settings-textarea"
              rows={3}
              value={settings.gameTracking?.pathKeywords ?? ""}
              onChange={(event) => updateTracking("pathKeywords", event.target.value)}
            />
          </label>
        </div>
      </div>
    </section>
  );
}