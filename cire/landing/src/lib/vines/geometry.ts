// Geometry helpers for the vine generator: a tiny 2D vector type, and a
// Catmull-Rom → cubic-Bézier smoother that turns a list of stem sample points
// into a single smooth SVG path with C1 continuity (so the vine reads as one
// flowing line, not a polyline).

export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);

/** Unit vector along an angle (radians). 0 = +x (right), PI/2 = +y (down in SVG). */
export const fromAngle = (a: number): Vec => ({ x: Math.cos(a), y: Math.sin(a) });

/** Left-hand normal of a heading angle (perpendicular, pointing to the stem's left). */
export const normalOf = (a: number): Vec => ({
  x: Math.cos(a + Math.PI / 2),
  y: Math.sin(a + Math.PI / 2),
});

const n = (v: number): string => {
  // Compact, locale-independent number formatting for path data (≤2 dp).
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * Convert a polyline of sample points into a smooth cubic-Bézier SVG path using
 * the uniform Catmull-Rom → Bézier construction. `tension` 1 = standard
 * Catmull-Rom; lower = looser, higher = tighter curves. Endpoints are duplicated
 * so the spline passes through the first and last points.
 */
export function smoothPath(points: readonly Vec[], tension = 1): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${n(points[0]!.x)} ${n(points[0]!.y)}`;

  const k = tension / 6;
  let d = `M ${n(points[0]!.x)} ${n(points[0]!.y)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;

    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };

    d += ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return d;
}

/** Rough arc length of a polyline — used to budget leaves/branches by distance. */
export function polylineLength(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += len(sub(points[i]!, points[i - 1]!));
  return total;
}
