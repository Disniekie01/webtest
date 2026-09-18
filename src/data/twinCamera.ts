/** Shared camera pose (USD / R3F Y-up meters, city-centered). */
export type TwinCameraPose = {
  eye: [number, number, number];
  target: [number, number, number];
  fov: number;
};

/** Wide establishing shot for the start screen. */
export const HERO_TWIN_CAMERA: TwinCameraPose = {
  eye: [155, 185, 195],
  target: [0, 4, 0],
  fov: 38,
};

/** Default / cold-start pose — begin zoomed out on the district. */
export const DEFAULT_TWIN_CAMERA: TwinCameraPose = { ...HERO_TWIN_CAMERA };

/** Slightly closer working view after Enter (optional settle). */
export const OPS_TWIN_CAMERA: TwinCameraPose = {
  eye: [95, 110, 130],
  target: [0, 2, 0],
  fov: 40,
};

export const CITY_SPAN_M = 160;
