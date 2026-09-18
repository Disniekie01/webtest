import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComfortOverride, ConflictSnapshot, PersonPack } from "../data/types";
import catalogJson from "../data/catalog.json";
import peopleIndexJson from "../data/people-index.json";
import arcsJson from "../data/arcs.json";

// Eager-load all people packs (synced JSON)
const packModules = import.meta.glob("../data/people/*.json", { eager: true }) as Record<
  string,
  { default: PersonPack }
>;

const packs: Record<string, PersonPack> = {};
for (const mod of Object.values(packModules)) {
  const pack = mod.default;
  packs[pack.id] = pack;
}

export type AppMode = "hero" | "lab";

type LabState = {
  mode: AppMode;
  selectedId: string | null;
  arcMode: boolean;
  arcQueue: string[];
  playing: boolean;
  timeS: number;
  durationS: number;
  showCv: boolean;
  showOptIn: boolean;
  comfortOverrides: Record<string, ComfortOverride>;
  conflict: ConflictSnapshot | null;
  personPos: [number, number, number];
  robotPos: [number, number, number] | null;
  robotKind: string | null;
  currentBeat: string | null;
  currentComfort: number;
  currentLabel: string | null;
  /** TraCI raw action: proceed | slow | hold */
  orchAction: string | null;
  /** Story chip: proceed | detour | yield */
  orchPolicy: string | null;
  orchLive: boolean;
  kitRobotLive: boolean;
  /** Kit delivery-robot id nearest the story persona (map ring). */
  kitHighlightRobotId: string | null;

  enterLab: (personId?: string) => void;
  backHero: () => void;
  selectPerson: (id: string) => void;
  playAssistiveArc: () => void;
  setPlaying: (v: boolean) => void;
  setTime: (t: number) => void;
  setDuration: (d: number) => void;
  tick: (dt: number) => void;
  toggleCv: () => void;
  openCv: () => void;
  closeCv: () => void;
  toggleOptIn: () => void;
  setComfortOverride: (id: string, o: ComfortOverride) => void;
  setOrchPolicy: (p: {
    action: string | null;
    label: string | null;
    live: boolean;
    kitRobotLive: boolean;
    kitHighlightRobotId?: string | null;
  }) => void;
  setPlaybackFrame: (frame: {
    personPos: [number, number, number];
    robotPos: [number, number, number] | null;
    robotKind: string | null;
    beat: string | null;
    comfort: number;
    label: string | null;
    conflict: ConflictSnapshot | null;
    kitHighlightRobotId?: string | null;
  }) => void;

  getPack: (id: string | null) => PersonPack | null;
  getEffectiveComfort: (id: string) => ComfortOverride | null;
};

const ASSISTIVE_ARC = ["noor_rahman", "mei_lin", "rosa_delgado"];

const defaultOverrideCache = new Map<string, ComfortOverride>();

export function defaultOverride(pack: PersonPack): ComfortOverride {
  const cached = defaultOverrideCache.get(pack.id);
  if (cached) return cached;
  const c = pack.person?.comfort;
  const o: ComfortOverride = {
    score: c?.score ?? pack.catalog.comfort_score ?? 0.5,
    triggers: [...(c?.triggers || [])],
    preferences: [...(c?.preferences || [])],
  };
  defaultOverrideCache.set(pack.id, o);
  return o;
}

export function resolveComfort(
  id: string | null,
  overrides: Record<string, ComfortOverride>,
): ComfortOverride | null {
  if (!id) return null;
  const pack = packs[id];
  if (!pack) return null;
  return overrides[id] || defaultOverride(pack);
}

export const useLabStore = create<LabState>()(
  persist(
    (set, get) => ({
      mode: "hero",
      selectedId: null,
      arcMode: false,
      arcQueue: [],
      playing: false,
      timeS: 0,
      durationS: 1,
      showCv: false,
      showOptIn: false,
      comfortOverrides: {},
      conflict: null,
      personPos: [0, 0.05, 0],
      robotPos: null,
      robotKind: null,
      currentBeat: null,
      currentComfort: 0.5,
      currentLabel: null,
      orchAction: null,
      orchPolicy: null,
      orchLive: false,
      kitRobotLive: false,
      kitHighlightRobotId: null,

      enterLab: (personId) => {
        const id = personId || peopleIndexJson[0]?.id || null;
        // Auto-play on first lab enter so beats advance without hunting Transport.
        set({ mode: "lab", selectedId: id, timeS: 0, playing: true, arcMode: false });
      },
      backHero: () => set({ mode: "hero", playing: false }),
      selectPerson: (id) =>
        set({
          selectedId: id,
          timeS: 0,
          playing: true,
          arcMode: false,
          currentBeat: null,
          currentLabel: null,
        }),
      playAssistiveArc: () =>
        set({
          mode: "lab",
          arcMode: true,
          arcQueue: [...ASSISTIVE_ARC],
          selectedId: ASSISTIVE_ARC[0],
          timeS: 0,
          playing: true,
          showOptIn: false,
        }),
      setPlaying: (v) => set({ playing: v }),
      setTime: (t) => set({ timeS: Math.max(0, t) }),
      setDuration: (d) => set({ durationS: Math.max(0.1, d) }),
      tick: (dt) => {
        const s = get();
        if (!s.playing) return;
        let next = s.timeS + dt;
        if (next >= s.durationS) {
          if (s.arcMode && s.arcQueue.length > 1) {
            const rest = s.arcQueue.slice(1);
            set({
              arcQueue: rest,
              selectedId: rest[0],
              timeS: 0,
              playing: true,
            });
            return;
          }
          set({ timeS: s.durationS, playing: false });
          return;
        }
        set({ timeS: next });
      },
      toggleCv: () => set((s) => ({ showCv: !s.showCv })),
      openCv: () => set({ showCv: true }),
      closeCv: () => set({ showCv: false }),
      toggleOptIn: () => set((s) => ({ showOptIn: !s.showOptIn })),
      setComfortOverride: (id, o) => {
        // Keep a stable object identity only when content changes for subscribers.
        defaultOverrideCache.delete(id);
        set((s) => ({
          comfortOverrides: { ...s.comfortOverrides, [id]: o },
        }));
      },
      setOrchPolicy: (p) => {
        const cur = get();
        const highlight =
          p.kitHighlightRobotId !== undefined
            ? p.kitHighlightRobotId
            : cur.kitHighlightRobotId;
        if (
          cur.orchAction === p.action &&
          cur.orchPolicy === p.label &&
          cur.orchLive === p.live &&
          cur.kitRobotLive === p.kitRobotLive &&
          cur.kitHighlightRobotId === highlight
        ) {
          return;
        }
        set({
          orchAction: p.action,
          orchPolicy: p.label,
          orchLive: p.live,
          kitRobotLive: p.kitRobotLive,
          kitHighlightRobotId: highlight,
        });
      },
      setPlaybackFrame: (frame) => {
        const cur = get();
        const highlight =
          frame.kitHighlightRobotId !== undefined
            ? frame.kitHighlightRobotId
            : cur.kitHighlightRobotId;
        const samePos =
          cur.personPos[0] === frame.personPos[0] &&
          cur.personPos[1] === frame.personPos[1] &&
          cur.personPos[2] === frame.personPos[2] &&
          ((cur.robotPos == null && frame.robotPos == null) ||
            (cur.robotPos != null &&
              frame.robotPos != null &&
              cur.robotPos[0] === frame.robotPos[0] &&
              cur.robotPos[1] === frame.robotPos[1] &&
              cur.robotPos[2] === frame.robotPos[2]));
        if (
          samePos &&
          cur.robotKind === frame.robotKind &&
          cur.currentBeat === frame.beat &&
          cur.currentComfort === frame.comfort &&
          cur.currentLabel === frame.label &&
          cur.kitHighlightRobotId === highlight &&
          cur.conflict?.alarm === frame.conflict?.alarm &&
          cur.conflict?.pairs[0]?.distance_m === frame.conflict?.pairs[0]?.distance_m &&
          cur.conflict?.pairs[0]?.ttc_s === frame.conflict?.pairs[0]?.ttc_s
        ) {
          return;
        }
        set({
          personPos: frame.personPos,
          robotPos: frame.robotPos,
          robotKind: frame.robotKind,
          currentBeat: frame.beat,
          currentComfort: frame.comfort,
          currentLabel: frame.label,
          conflict: frame.conflict,
          kitHighlightRobotId: highlight,
        });
      },

      getPack: (id) => (id ? packs[id] || null : null),
      getEffectiveComfort: (id) => resolveComfort(id, get().comfortOverrides),
    }),
    {
      name: "city-lab-comfort",
      partialize: (s) => ({
        comfortOverrides: s.comfortOverrides,
      }),
    },
  ),
);

export const catalog = catalogJson;
export const peopleIndex = peopleIndexJson as {
  id: string;
  name: string;
  comfort_score: number;
  comfort_level: string;
  tags: string[];
  status: string;
  has_journey: boolean;
}[];
export const arcs = arcsJson;
export { packs };
