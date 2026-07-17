import type { CSSProperties } from "react";
import {
  ACCENT_THEMES,
  useSettingsStore,
  type AppearanceMode,
  type AccentTheme,
} from "../stores/settingsStore";

export function SettingsPanel() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const appearance = useSettingsStore((s) => s.appearance);
  const accent = useSettingsStore((s) => s.accent);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);

  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3>Appearance</h3>
          <p className="settings-help">Choose light or dark interface chrome.</p>
          <div className="settings-segment">
            {(["dark", "light"] as AppearanceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={appearance === mode ? "active" : ""}
                onClick={() => setAppearance(mode)}
              >
                {mode === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Theme accent</h3>
          <p className="settings-help">Primary accent used for buttons, bars, and focus.</p>
          <div className="theme-swatches">
            {ACCENT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-swatch ${accent === t.id ? "active" : ""}`}
                style={{ "--swatch": t.swatch } as CSSProperties}
                onClick={() => setAccent(t.id as AccentTheme)}
                title={t.label}
              >
                <span className="swatch-dot" />
                {t.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
