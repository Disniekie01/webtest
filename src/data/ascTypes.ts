export type DataLayer =
  | "traffic"
  | "pedestrians"
  | "robots"
  | "sensors"
  | "comfort"
  | "transit"
  | "activity";

export type AppMode = "hero" | "ops" | "citizen" | "comfort" | "chapter" | "cv";

/** Viewport behind ops chrome: low-fi twin, Isaac Kit stream, or static still. */
export type ViewportMode = "ops3d" | "kit" | "still";

export type RobotPolicy = "proceed" | "hold" | "reroute" | "stagger" | "slow";

export type CitizenProfile = {
  id: string;
  name: string;
  age: number;
  role: string;
  district: string;
  portrait: string;
  tagline: string;
  comfortScore: number;
  accessibility: string[];
  preferences: string[];
  triggers: string[];
  journey: { t: string; label: string; detail: string }[];
};

export type MapCell = { x: number; y: number; w: number; h: number; level?: number };

export type ReplanPath = {
  robotId: string;
  action: RobotPolicy | string;
  path: [number, number][];
};

export type Scenario = {
  id: string;
  citizenId: string | null;
  slot: "morning" | "midday" | "evening" | string;
  title: string;
  summary: string;
  layers: DataLayer[];
  impactCells: MapCell[];
  comfortCells: MapCell[];
  replans: ReplanPath[];
};

export type RobotTelemetry = {
  id: string;
  name: string;
  kind: string;
  battery: number;
  speedMps: number;
  task: string;
  policy: RobotPolicy | string;
  district: string;
  lastUpdate: string;
};

export type Chapter = {
  id: string;
  title: string;
  narration: string;
  layers: DataLayer[];
  scenarioId?: string;
  citizenId?: string;
  videoUrl: string | null;
};

/** Editable comfort profile for the comfort-mapping mock UI. */
export type ComfortDraft = {
  id: string;
  name: string;
  score: number;
  preferences: string[];
  triggers: string[];
};
