import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const PLANS = [
  {
    id: "balanced",
    label: "Bilanciato",
    description: "Profilo sicuro per uso quotidiano e temperature contenute.",
  },
  {
    id: "high",
    label: "High Performance",
    description: "Riduce il power saving aggressivo per sessioni di gioco lunghe.",
  },
  {
    id: "ultimate",
    label: "Ultimate Performance",
    description: "Massima reattivita, meno throttling, piu consumi.",
  },
];

export default function PowerPlanPanel({ onActivity }) {
  const [activePlan, setActivePlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const plan = await invoke("get_active_power_plan");
      setActivePlan(plan);
      setError("");
    } catch (currentError) {
      setError(String(currentError));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const applyPlan = async (planId) => {
    setBusy(true);
    try {
      await invoke("apply_power_plan", { plan: planId });
      await refresh();
      onActivity?.({
        title: `Power plan ${planId} applicato`,
        detail: "Cambio schema energetico da pannello dedicato",
        section: "power",
      });
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
          <h2>Power Plan</h2>
          <p>Seleziona il profilo energetico reale di Windows tramite powercfg.</p>
        </div>
        <div className="status-pill">
          Attivo: {activePlan?.label ?? "rilevazione..."}
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}

      <div className="power-grid">
        {PLANS.map((plan) => (
          <div key={plan.id} className={`power-card ${activePlan?.id === plan.id ? "active" : ""}`}>
            <div>
              <h3>{plan.label}</h3>
              <p>{plan.description}</p>
            </div>
            <button
              type="button"
              className="action-btn"
              disabled={busy || activePlan?.id === plan.id}
              onClick={() => applyPlan(plan.id)}
            >
              {activePlan?.id === plan.id ? "Attivo" : "Applica"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}