/**
 * Sidewalk routes on The City Generator district (~36m footprint, corners).
 */

export type XZ = [number, number];

export const SIDEWALK_Y = 0.12;
const S = 1.9;

export const STREET_ROUTES: Record<string, XZ[]> = {
  elena_voss: [
    [-15, -S],
    [-5, -S],
    [-5, 5 + S],
    [5, 5 + S],
    [5, -S],
    [10, -S],
    [15, -S],
    [15, S],
  ],
  jamal_okonkwo: [
    [15, S],
    [5, S],
    [5, -5 - S],
    [-5, -5 - S],
    [-5, -S],
    [-15, -S],
  ],
  sofia_reyes: [
    [-10, 5 + S],
    [-S, 5 + S],
    [-S, S],
    [5 + S, S],
    [5 + S, -5 - S],
    [-10, -5 - S],
  ],
  marta_silva: [
    [10, 10 + S],
    [S, 10 + S],
    [S, S],
    [-5 - S, S],
    [-5 - S, -10],
  ],
  rosa_delgado: [
    [-15, 5 + S],
    [-5, 5 + S],
    [-5, S],
    [S, S],
    [S, -5 - S],
    [10, -5 - S],
  ],
  kenji_mori: [
    [15, -5 - S],
    [5, -5 - S],
    [5, -S],
    [-S, -S],
    [-S, 5 + S],
    [-10, 5 + S],
  ],
  noor_rahman: [
    [-10, -S],
    [-3, -S],
    [-3, -5 - S],
    [3, -5 - S],
    [7, -5 - S],
    [7, -S],
  ],
  mei_lin: [
    [-15, S],
    [-5, S],
    [-5, 5 + S],
    [5, 5 + S],
    [5, S],
    [15, S],
  ],
  aisha_brandt: [
    [0, 10 + S],
    [0, 5 + S],
    [-S, 5 + S],
    [-S, -S],
    [5, -S],
    [10, -S],
  ],
};

const DEFAULT_ROUTE: XZ[] = [
  [-14, -S],
  [-4, -S],
  [-4, 4],
  [4, 4],
  [4, -S],
  [14, -S],
];

export function getStreetRoute(personId: string | null | undefined): XZ[] {
  if (!personId) return DEFAULT_ROUTE;
  return STREET_ROUTES[personId] || DEFAULT_ROUTE;
}

/** Evenly sample `count` points along a polyline (including ends). */
export function sampleRoute(route: XZ[], count: number): XZ[] {
  if (count <= 1) return [route[0]];
  if (route.length === 1) return Array(count).fill(route[0]);
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const d = Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
    segLens.push(d);
    total += d;
  }
  const out: XZ[] = [];
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total;
    let acc = 0;
    let placed = false;
    for (let i = 0; i < segLens.length; i++) {
      if (acc + segLens[i] >= target - 1e-6) {
        const u = segLens[i] < 1e-6 ? 0 : (target - acc) / segLens[i];
        out.push([
          route[i][0] + (route[i + 1][0] - route[i][0]) * u,
          route[i][1] + (route[i + 1][1] - route[i][1]) * u,
        ]);
        placed = true;
        break;
      }
      acc += segLens[i];
    }
    if (!placed) out.push(route[route.length - 1]);
  }
  return out;
}

export function xzToPos(xz: XZ, y = SIDEWALK_Y): [number, number, number] {
  return [xz[0], y, xz[1]];
}

export function offsetRoute(route: XZ[], towardRoad = 1.6): XZ[] {
  return route.map(([x, z]) => {
    if (Math.abs(z) > Math.abs(x) * 0.4) {
      return [x, z - Math.sign(z || 1) * towardRoad];
    }
    return [x - Math.sign(x || 1) * towardRoad, z];
  });
}
