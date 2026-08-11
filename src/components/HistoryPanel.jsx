function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString("it-IT");
  } catch {
    return timestamp;
  }
}

export default function HistoryPanel({ items, onClear }) {
  return (
    <section className="section-stack">
      <div className="hero-panel">
        <div>
          <h2>Cronologia azioni</h2>
          <p>Storico locale delle operazioni eseguite dall'applicazione.</p>
        </div>
        <button type="button" className="action-btn" onClick={onClear} disabled={items.length === 0}>
          Svuota cronologia
        </button>
      </div>

      <div className="panel">
        <div className="opt-list history-list">
          {items.length === 0 && <div className="empty-note">Nessuna azione registrata.</div>}
          {items.map((item) => (
            <div className="history-item" key={item.id}>
              <div>
                <div className="t">{item.title}</div>
                <div className="d">{item.detail}</div>
              </div>
              <div className="history-meta">
                <span>{item.section}</span>
                <span>{formatTime(item.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}