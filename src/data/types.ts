export type Vec3 = { x: number; y: number; z: number };

export type CatalogPerson = {
  id: string;
  name: string;
  comfort_level: string;
  comfort_score: number;
  story?: string;
  journey?: string;
  status?: string;
  tags?: string[];
};

export type Catalog = {
  version: number;
  map_default: string;
  arcs?: { id: string; path: string; people: string[] }[];
  people: CatalogPerson[];
};

export type PersonProfile = {
  id: string;
  name: string;
  age?: number;
  role?: string;
  home_area?: string;
  comfort?: {
    level: string;
    score: number;
    notes?: string;
    triggers?: string[];
    preferences?: string[];
  };
  mobility?: Record<string, unknown>;
  tags?: string[];
};

export type StoryBeat = { id: string; text: string };

export type StoryDoc = {
  id: string;
  person_id: string;
  title: string;
  summary: string;
  beats: StoryBeat[];
  themes?: string[];
  sim?: Record<string, unknown>;
};

export type JourneyStop = {
  id: string;
  beat?: string;
  label?: string;
  comfort?: number;
  hold_s?: number;
  location: Vec3;
  yaw?: number;
  spawn_robot?: {
    id?: string;
    kind?: string;
    location: Vec3;
    yaw?: number;
  };
  move_robot_to?: {
    location: Vec3;
    yaw?: number;
  };
};

export type JourneyDoc = {
  id: string;
  person_id: string;
  story_id?: string;
  title: string;
  map?: string;
  status?: string;
  arc?: string;
  person?: {
    display_name?: string;
    role?: string;
    walk_speed_mps?: number;
    comfort_start?: number;
    mobility_aid?: string;
    blueprint?: string;
  };
  follow?: Record<string, number | boolean>;
  stops: JourneyStop[];
  notes?: string;
};

export type PersonPack = {
  id: string;
  catalog: CatalogPerson;
  person: PersonProfile | null;
  story: StoryDoc | null;
  journey: JourneyDoc | null;
};

export type ComfortOverride = {
  score: number;
  triggers: string[];
  preferences: string[];
};

/** Yardline-shaped track / pair-risk telemetry (mock). */
export type YardTrack = {
  id: string;
  cls: "person" | "robot" | "robotaxi" | "assistive";
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  history: [number, number][];
};

export type PairRisk = {
  track_a: string;
  track_b: string;
  class_a: string;
  class_b: string;
  distance_m: number;
  ttc_s: number | null;
  closing: boolean;
  level: 0 | 1 | 2 | 3;
};

export type ConflictSnapshot = {
  tracks: YardTrack[];
  pairs: PairRisk[];
  alarm: 0 | 1 | 2 | 3;
  alarm_name: string;
};
