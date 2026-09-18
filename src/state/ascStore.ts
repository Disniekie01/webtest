import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppMode,
  Chapter,
  CitizenProfile,
  ComfortDraft,
  DataLayer,
  Scenario,
  ViewportMode,
} from "../data/ascTypes";
import { DEFAULT_TWIN_CAMERA, type TwinCameraPose } from "../data/twinCamera";
import citizensJson from "../data/citizens.json";
import scenariosJson from "../data/scenarios.json";
import telemetryJson from "../data/telemetry.json";
import chaptersJson from "../data/chapters.json";
import type { RobotTelemetry } from "../data/ascTypes";

export const citizens = citizensJson as CitizenProfile[];
export const scenarios = scenariosJson as Scenario[];
export const telemetry = telemetryJson as RobotTelemetry[];
export const chapters = chaptersJson as Chapter[];

const DEFAULT_LAYERS: DataLayer[] = ["traffic", "pedestrians", "robots", "sensors"];

type AscState = {
  mode: AppMode;
  viewportMode: ViewportMode;
  viewportTransitioning: boolean;
  cameraPose: TwinCameraPose;
  activeLayers: DataLayer[];
  selectedCitizenId: string | null;
  activeScenarioId: string | null;
  activeChapterId: string | null;
  telemetryOpen: boolean;
  comfortDrafts: ComfortDraft[];

  enterOps: () => void;
  backHero: () => void;
  setMode: (m: AppMode) => void;
  setViewportMode: (m: ViewportMode) => void;
  setViewportTransitioning: (v: boolean) => void;
  setCameraPose: (pose: TwinCameraPose) => void;
  switchViewport: (m: ViewportMode) => Promise<void>;
  toggleLayer: (layer: DataLayer) => void;
  setLayers: (layers: DataLayer[]) => void;
  openCitizen: (id: string) => void;
  openComfort: () => void;
  openChapter: (id: string) => void;
  openCv: () => void;
  closeCv: () => void;
  setScenario: (id: string | null) => void;
  setTelemetryOpen: (v: boolean) => void;
  toggleTelemetry: () => void;
  upsertComfortDraft: (d: ComfortDraft) => void;
  removeComfortDraft: (id: string) => void;
};

function draftsFromCitizens(): ComfortDraft[] {
  return citizens.map((c) => ({
    id: c.id,
    name: c.name,
    score: c.comfortScore,
    preferences: [...c.preferences],
    triggers: [...c.triggers],
  }));
}

export const useAscStore = create<AscState>()(
  persist(
    (set, get) => ({
      mode: "hero",
      viewportMode: "ops3d",
      viewportTransitioning: false,
      cameraPose: { ...DEFAULT_TWIN_CAMERA },
      activeLayers: [...DEFAULT_LAYERS],
      selectedCitizenId: null,
      activeScenarioId: null,
      activeChapterId: chapters[0]?.id ?? null,
      telemetryOpen: false,
      comfortDrafts: draftsFromCitizens(),

      enterOps: () =>
        set({
          mode: "ops",
          viewportMode: "ops3d",
          activeLayers: [...DEFAULT_LAYERS],
          selectedCitizenId: null,
          telemetryOpen: false,
        }),
      backHero: () => set({ mode: "hero", telemetryOpen: false }),
      setMode: (m) => set({ mode: m }),
      setViewportMode: (m) => set({ viewportMode: m }),
      setViewportTransitioning: (v) => set({ viewportTransitioning: v }),
      setCameraPose: (pose) => set({ cameraPose: pose }),
      switchViewport: async (m) => {
        const cur = get().viewportMode;
        if (m === cur || get().viewportTransitioning) return;
        set({ viewportTransitioning: true });
        const pose = get().cameraPose;
        try {
          if (m === "kit") {
            await fetch("/viewport/api/camera", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(pose),
            }).catch(() => undefined);
            await new Promise((r) => window.setTimeout(r, 420));
            set({ viewportMode: "kit" });
          } else if (m === "ops3d") {
            try {
              const res = await fetch("/viewport/api/camera", { cache: "no-store" });
              if (res.ok) {
                const data = (await res.json()) as Partial<TwinCameraPose>;
                if (data.eye && data.target) {
                  set({
                    cameraPose: {
                      eye: data.eye as TwinCameraPose["eye"],
                      target: data.target as TwinCameraPose["target"],
                      fov: typeof data.fov === "number" ? data.fov : pose.fov,
                    },
                  });
                }
              }
            } catch {
              /* keep local pose */
            }
            await new Promise((r) => window.setTimeout(r, 320));
            set({ viewportMode: "ops3d" });
          } else {
            set({ viewportMode: m });
          }
        } finally {
          window.setTimeout(() => set({ viewportTransitioning: false }), 480);
        }
      },
      toggleLayer: (layer) => {
        const cur = get().activeLayers;
        const next = cur.includes(layer)
          ? cur.filter((l) => l !== layer)
          : [...cur, layer];
        set({ activeLayers: next.length ? next : [layer] });
      },
      setLayers: (layers) => set({ activeLayers: layers.length ? layers : [...DEFAULT_LAYERS] }),
      openCitizen: (id) => {
        const scenario = scenarios.find((s) => s.citizenId === id);
        set({
          mode: "citizen",
          selectedCitizenId: id,
          activeScenarioId: scenario?.id ?? get().activeScenarioId,
          activeLayers: scenario?.layers ?? get().activeLayers,
        });
      },
      openComfort: () => set({ mode: "comfort", telemetryOpen: false }),
      openCv: () => set({ mode: "cv", telemetryOpen: false }),
      closeCv: () => set({ mode: "ops" }),
      openChapter: (id) => {
        const ch = chapters.find((c) => c.id === id);
        if (!ch) return;
        set({
          mode: "chapter",
          activeChapterId: id,
          activeLayers: ch.layers?.length ? ch.layers : get().activeLayers,
          selectedCitizenId: ch.citizenId ?? get().selectedCitizenId,
          activeScenarioId: ch.scenarioId ?? get().activeScenarioId,
        });
      },
      setScenario: (id) => {
        const sc = id ? scenarios.find((s) => s.id === id) : null;
        set({
          activeScenarioId: id,
          activeLayers: sc?.layers?.length ? sc.layers : get().activeLayers,
          selectedCitizenId: sc?.citizenId ?? get().selectedCitizenId,
        });
      },
      setTelemetryOpen: (v) => set({ telemetryOpen: v }),
      toggleTelemetry: () => set((s) => ({ telemetryOpen: !s.telemetryOpen })),
      upsertComfortDraft: (d) =>
        set((s) => {
          const rest = s.comfortDrafts.filter((x) => x.id !== d.id);
          return { comfortDrafts: [...rest, d] };
        }),
      removeComfortDraft: (id) =>
        set((s) => ({
          comfortDrafts: s.comfortDrafts.filter((x) => x.id !== id),
        })),
    }),
    {
      name: "asc-demo-v1",
      partialize: (s) => ({
        comfortDrafts: s.comfortDrafts,
      }),
    },
  ),
);

export function getCitizen(id: string | null) {
  return id ? citizens.find((c) => c.id === id) ?? null : null;
}

export function getScenario(id: string | null) {
  return id ? scenarios.find((s) => s.id === id) ?? null : null;
}

export function getChapter(id: string | null) {
  return id ? chapters.find((c) => c.id === id) ?? null : null;
}

export const LAYER_LABELS: Record<DataLayer, string> = {
  traffic: "Traffic",
  pedestrians: "Pedestrians",
  robots: "Robots",
  sensors: "Sensors / CCTV",
  comfort: "Comfort",
  transit: "Transit",
  activity: "Activity",
};
