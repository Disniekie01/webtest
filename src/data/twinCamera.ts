/** Shared camera pose (USD / R3F Y-up meters, city-centered). */
export type TwinCameraPose = {
  eye: [number, number, number];
  target: [number, number, number];
  fov: number;
};

export const DEFAULT_TWIN_CAMERA: TwinCameraPose = {
  eye: [90, 120, 160],
  target: [0, 0, 0],
  fov: 40,
};

export const CITY_SPAN_M = 160;
