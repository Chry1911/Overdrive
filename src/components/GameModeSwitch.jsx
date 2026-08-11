// src/components/GameModeSwitch.jsx
export default function GameModeSwitch({ active = false, busy = false, onToggle }) {

  return (
    <button type="button" className="gamemode-switch" onClick={onToggle} disabled={busy}>
      <span className="label">GAME MODE</span>
      <div className={`toggle ${active ? "on" : ""}`} />
    </button>
  );
}
