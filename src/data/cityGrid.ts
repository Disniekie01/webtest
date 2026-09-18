/** Shared 5×5 Harbor District grid (SUMO / Isaac / twin). */
export const CITY_SPAN_M = 160;
export const HALF_SPAN_M = CITY_SPAN_M / 2;
export const STREET_W = 8;
export const JUNCTION_XS = [-80, -40, 0, 40, 80] as const;

/** SUMO junction ids A0–E4 → centered XZ. */
export type JunctionNode = {
  id: string;
  x: number;
  z: number;
};

const COL = ["A", "B", "C", "D", "E"] as const;

export function mainJunctions(): JunctionNode[] {
  const out: JunctionNode[] = [];
  COL.forEach((letter, i) => {
    JUNCTION_XS.forEach((_z, j) => {
      // SUMO: letter → x (0..160), digit → y (0..160)
      const sx = i * 40;
      const sy = j * 40;
      out.push({
        id: `${letter}${j}`,
        x: sx - HALF_SPAN_M,
        z: sy - HALF_SPAN_M,
      });
    });
  });
  return out;
}
