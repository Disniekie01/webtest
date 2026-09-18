/** Storytelling issue / trigger library — seeded from ops citizens + older people packs. */

export type IssueDef = {
  id: string;
  label: string;
  group: "infra" | "crowd" | "robot" | "care" | "ops";
};

export type TraitDef = {
  id: string;
  label: string;
};

export type GoalDef = {
  id: string;
  label: string;
};

export const ISSUE_LIBRARY: IssueDef[] = [
  { id: "blocked_curb_cut", label: "Blocked curb cut", group: "infra" },
  { id: "construction_sidewalk", label: "Construction on sidewalk", group: "infra" },
  { id: "inaccessible_dropoff", label: "Inaccessible dropoff", group: "infra" },
  { id: "forced_street_roll", label: "Forced into street", group: "infra" },
  { id: "no_signage_tourist", label: "No tourist-zone signage", group: "infra" },
  { id: "station_crowding", label: "Station crowding", group: "crowd" },
  { id: "dense_plaza_crowd", label: "Dense plaza crowds", group: "crowd" },
  { id: "stroller_path_blocked", label: "Stroller path blocked", group: "crowd" },
  { id: "child_reaches_robot", label: "Child reaches for robot", group: "crowd" },
  { id: "silent_approach", label: "Silent approach", group: "robot" },
  { id: "silent_approach_elder", label: "Silent approach behind elder", group: "robot" },
  { id: "robot_lingers_crosswalk", label: "Robot lingers at crosswalk", group: "robot" },
  { id: "sudden_robot_approach", label: "Sudden robot approach", group: "robot" },
  { id: "path_blocked_by_robot", label: "Path blocked by robot", group: "robot" },
  { id: "robot_blocks_ramp", label: "Robot blocks ramp", group: "robot" },
  { id: "delivery_cuts_assist_pair", label: "Delivery cuts assist pair", group: "robot" },
  { id: "delivery_clustering", label: "Delivery clustering", group: "robot" },
  { id: "sudden_stop", label: "Sudden stop", group: "robot" },
  { id: "failed_handoff", label: "Failed handoff — no message", group: "ops" },
  { id: "cascading_delays", label: "Cascading transit delays", group: "ops" },
  { id: "contested_curb", label: "Contested curb", group: "ops" },
  { id: "bot_blocks_ramp", label: "Bot blocks ramp", group: "care" },
  { id: "assist_battery_fail", label: "Assist bot battery fail in crowd", group: "care" },
  { id: "humans_shove_assist", label: "Humans shove assist cart", group: "care" },
];

export const TRAIT_LIBRARY: TraitDef[] = [
  { id: "independent", label: "Independent" },
  { id: "wary", label: "Wary of robots" },
  { id: "advocate", label: "Design advocate" },
  { id: "curious", label: "Curious observer" },
  { id: "time_pressed", label: "Time-pressed" },
  { id: "caregiver", label: "Caregiver" },
  { id: "accessibility_first", label: "Accessibility-first" },
  { id: "crowd_sensitive", label: "Crowd-sensitive" },
];

export const GOAL_LIBRARY: GoalDef[] = [
  { id: "reach_clinic", label: "Reach clinic independently" },
  { id: "catch_transfer", label: "Catch morning transfer" },
  { id: "lunch_with_child", label: "Lunch with child in plaza" },
  { id: "market_run", label: "Market run with assist cart" },
  { id: "observe_plaza", label: "Observe plaza HRI" },
  { id: "accessible_pickup", label: "Accessible AV pickup" },
  { id: "gig_drop_on_time", label: "Gig drop on time" },
  { id: "tourist_photos", label: "Tourist plaza photos" },
];

export const PREF_LIBRARY = [
  "step-free routes",
  "extended crossing time",
  "robot-free platforms",
  "limited robot interaction at lunch",
  "predictable yields",
  "staggered deliveries",
  "paired assist when available",
  "quiet sidewalks",
  "early disruption alerts",
  "clear interchange guidance",
  "shifted drone corridors",
];

export const CITY_EVENTS = [
  { id: "margaret_sidewalk", label: "Sidewalk closed" },
  { id: "amir_delay", label: "Transit line delay" },
  { id: "sofia_lunch", label: "Lunch surge" },
  { id: "clear_evening", label: "Clear evening" },
];

export const POLICY_PRESETS = ["proceed", "hold", "reroute", "stagger", "slow"] as const;

export const JUNCTION_PINS = [
  { id: "A2", label: "West Harbor", x: -80, z: 0 },
  { id: "B2", label: "Market Row", x: -40, z: 0 },
  { id: "C2", label: "Civic Core", x: 0, z: 0 },
  { id: "D2", label: "Civic Plaza", x: 40, z: 0 },
  { id: "E2", label: "East Gate", x: 80, z: 0 },
  { id: "C0", label: "North Ridge", x: 0, z: -80 },
  { id: "C1", label: "University", x: 0, z: -40 },
  { id: "C3", label: "South Quay", x: 0, z: 40 },
  { id: "C4", label: "Dock Terminal", x: 0, z: 80 },
  { id: "B4", label: "Harbor Dock", x: -40, z: 80 },
];
