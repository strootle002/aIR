import { create } from "zustand";

export type AppearanceMode = "dark" | "light";
export type AccentTheme = "forest" | "slate" | "amber" | "ocean" | "rose";

export const ACCENT_THEMES: {
  id: AccentTheme;
  label: string;
  swatch: string;
}[] = [
  { id: "forest", label: "Forest", swatch: "#3d8f6e" },
  { id: "slate", label: "Slate", swatch: "#6b7c93" },
  { id: "amber", label: "Amber", swatch: "#c4893a" },
  { id: "ocean", label: "Ocean", swatch: "#3a7eb5" },
  { id: "rose", label: "Rose", swatch: "#b85a6a" },
];

const STORAGE_KEY = "artifactgrid.settings";

interface PersistedSettings {
  appearance: AppearanceMode;
  accent: AccentTheme;
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { appearance: "dark", accent: "forest" };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      appearance: parsed.appearance === "light" ? "light" : "dark",
      accent: ACCENT_THEMES.some((t) => t.id === parsed.accent)
        ? (parsed.accent as AccentTheme)
        : "forest",
    };
  } catch {
    return { appearance: "dark", accent: "forest" };
  }
}

function persist(s: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function applyDocumentTheme(appearance: AppearanceMode, accent: AccentTheme) {
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.dataset.accent = accent;
}

interface SettingsState {
  appearance: AppearanceMode;
  accent: AccentTheme;
  settingsOpen: boolean;
  setAppearance: (mode: AppearanceMode) => void;
  setAccent: (accent: AccentTheme) => void;
  setSettingsOpen: (open: boolean) => void;
}

const initial = loadSettings();
applyDocumentTheme(initial.appearance, initial.accent);

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appearance: initial.appearance,
  accent: initial.accent,
  settingsOpen: false,

  setAppearance: (appearance) => {
    persist({ appearance, accent: get().accent });
    applyDocumentTheme(appearance, get().accent);
    set({ appearance });
  },

  setAccent: (accent) => {
    persist({ appearance: get().appearance, accent });
    applyDocumentTheme(get().appearance, accent);
    set({ accent });
  },

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
