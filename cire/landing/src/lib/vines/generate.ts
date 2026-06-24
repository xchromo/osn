// Procedural vine generator. Pure + deterministic: given a seed and a canvas
// size it returns the SVG geometry for a field of botanical vines that emerge
// from the left/right edges, meander down and inward, throw off a few sparse
// branches, curl into tendrils at their tips, and carry phyllotactic leaves +
// the occasional flower. Same seed ⇒ same field (so roots can be prerendered and
// the client can regrow an identical or, with a fresh seed, a new plant).
//
// Technique notes (from research): stems are a turtle-walk with layered
// sine+brownian curvature, smoothed to a C1 cubic-Bézier via Catmull-Rom;
// tendrils are capped logarithmic spirals; organs are placed by the golden
// angle; branching is depth- and budget-limited so it never becomes a bush.
// Stems are STROKED (not filled ribbons) so the draw-on growth animation
// (stroke-dashoffset) works — see VineCanvas.

import { len as vlen, smoothPath, sub, vec, type Vec } from "./geometry";
import { makeRng, type Rng } from "./prng";

export interface Root {
  x: number;
  y: number;
  /** Heading in radians (PI/2 = straight down in SVG coords). */
  heading: number;
  /** -1 = left edge (drifts right), +1 = right edge (drifts left). */
  side: -1 | 1;
}

export interface Leaf {
  /** Filled almond path data. */
  d: string;
  /** Base attachment point — used as the scale-in transform origin. */
  ox: number;
  oy: number;
}

export interface Flower {
  petals: string[];
  cx: number;
  cy: number;
  cr: number;
}

export interface Vine {
  /** Stroked stem + branch + tendril paths, in draw order (base → tip). */
  strands: string[];
  leaves: Leaf[];
  flowers: Flower[];
  /** Vertical span in canvas px — drives the scroll-linked growth mapping. */
  top: number;
  bottom: number;
}

export interface VineField {
  width: number;
  height: number;
  seed: string;
  roots: Root[];
  vines: Vine[];
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Irwin–Hall gaussian-ish noise in roughly [-1, 1] for natural jitter. */
function gauss(r: Rng): number {
  return (r.next() + r.next() + r.next() + r.next() + r.next() + r.next() - 3) / 1.5;
}

interface StemOpts {
  start: Vec;
  heading: number;
  steps: number;
  stepLen: number;
  curl: number;
  wander: number;
  inwardBias: number;
  gravity: number;
  side: -1 | 1;
  maxY: number;
}

/** Turtle-walk a sinuous stem downward, returning its anchor polyline. */
function growStem(r: Rng, o: StemOpts): Vec[] {
  const pts: Vec[] = [{ ...o.start }];
  let x = o.start.x;
  let y = o.start.y;
  let h = o.heading;
  const phase = r.range(0, TAU);
  const freq = r.range(0.18, 0.3);

  for (let i = 1; i <= o.steps; i++) {
    h += Math.sin(phase + i * freq) * o.curl; // coherent S-curve spine
    h += gauss(r) * o.wander; // organic irregularity
    h += o.side * o.inwardBias; // bend toward page centre
    h += (Math.PI / 2 - h) * o.gravity; // ease toward straight-down
    const step = o.stepLen * r.range(0.85, 1.15);
    x += Math.cos(h) * step;
    y += Math.sin(h) * step;
    pts.push(vec(x, y));
    if (y > o.maxY) break; // never run far past the page bottom
  }
  return pts;
}

/** A capped logarithmic-spiral tendril leaving `origin` along `tangent`. */
function tendril(r: Rng, origin: Vec, tangent: number, dir: -1 | 1): Vec[] {
  const turns = r.range(0.7, 1.25);
  const startR = r.range(14, 26);
  const tightness = r.range(0.14, 0.22);
  const steps = Math.max(12, Math.round(turns * 16));
  const total = turns * TAU;
  const baseAng = tangent + (dir * Math.PI) / 2;
  const cx = origin.x + Math.cos(baseAng) * startR;
  const cy = origin.y + Math.sin(baseAng) * startR;

  const pts: Vec[] = [origin];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const rad = startR * Math.exp(-tightness * t); // shrink inward → tight tip
    const ang = baseAng + Math.PI + dir * t;
    pts.push(vec(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad));
  }
  return pts;
}

/** Cumulative-arc-length frame (position + unit tangent) at fraction `s`. */
function arcFrame(pts: Vec[], s: number): { pos: Vec; tan: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + vlen(sub(pts[i]!, pts[i - 1]!)));
  const total = cum[cum.length - 1]!;
  if (total === 0) return { pos: pts[0]!, tan: Math.PI / 2 };
  const target = s * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < target) i++;
  const seg = cum[i]! - cum[i - 1]! || 1;
  const t = (target - cum[i - 1]!) / seg;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  return {
    pos: vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
    tan: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Filled almond leaf at `at`, pointing along `ang`, length `len`. */
function leafPath(at: Vec, ang: number, len: number): string {
  const width = len * 0.42;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const T = (px: number, py: number): Vec => vec(at.x + px * c - py * s, at.y + px * s + py * c);
  const f = (p: Vec) => `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`;
  const base = T(0, 0);
  const tip = T(len, 0);
  return (
    `M ${f(base)} C ${f(T(len * 0.12, width * 0.5))} ${f(T(len * 0.78, width * 0.32))} ${f(tip)}` +
    ` C ${f(T(len * 0.78, -width * 0.32))} ${f(T(len * 0.12, -width * 0.5))} ${f(base)} Z`
  );
}

/** Golden-angle leaves (alternating sides) + an occasional tip flower. */
function placeOrgans(r: Rng, stem: Vec[], leaves: Leaf[], flowers: Flower[], wantFlower: boolean) {
  const n = r.int(4, 7);
  const s0 = r.range(0.14, 0.24);
  let phi = r.range(0, TAU);
  for (let k = 0; k < n; k++) {
    phi += GOLDEN_ANGLE;
    const s = clamp(s0 + (0.96 - s0) * (k / Math.max(1, n - 1)) + gauss(r) * 0.02, 0.05, 0.97);
    const f = arcFrame(stem, s);
    const side: -1 | 1 = Math.sin(phi) >= 0 ? 1 : -1;
    const pitch = r.range(0.35, 0.6);
    const ang = f.tan + side * (Math.PI / 2 - pitch); // outward, leaning to tip
    const leafLen = r.range(22, 40) * (1 - 0.3 * (k / n));
    leaves.push({ d: leafPath(f.pos, ang, leafLen), ox: f.pos.x, oy: f.pos.y });
  }
  if (wantFlower && r.chance(0.75)) {
    const f = arcFrame(stem, r.range(0.86, 0.97));
    const R = r.range(6, 10);
    const rot = r.range(0, TAU);
    const petals: string[] = [];
    for (let i = 0; i < 5; i++) {
      petals.push(leafPath(f.pos, rot + (i * TAU) / 5, R));
    }
    flowers.push({ petals, cx: f.pos.x, cy: f.pos.y, cr: R * 0.3 });
  }
}

interface Budget {
  n: number;
}

/** Recursively build a stem + its sparse branches, tendrils and organs. */
function buildBranch(r: Rng, o: StemOpts, depth: number, budget: Budget, out: Vine) {
  const stem = growStem(r, o);
  out.strands.push(smoothPath(stem));
  for (const p of stem) {
    if (p.y < out.top) out.top = p.y;
    if (p.y > out.bottom) out.bottom = p.y;
  }

  // Tendril curl at the tip (chirality alternates via a coin per call).
  if (stem.length >= 2 && r.chance(depth === 0 ? 0.85 : 0.5)) {
    const a = stem[stem.length - 2]!;
    const b = stem[stem.length - 1]!;
    const tan = Math.atan2(b.y - a.y, b.x - a.x);
    out.strands.push(smoothPath(tendril(r, b, tan, r.chance(0.5) ? 1 : -1)));
  }

  placeOrgans(r, stem, out.leaves, out.flowers, depth <= 1);

  if (depth >= 2) return;
  let side: -1 | 1 = r.chance(0.5) ? 1 : -1;
  let lastBranch = -3;
  for (let i = 2; i < stem.length - 1; i++) {
    if (budget.n <= 0) break;
    if (i - lastBranch < 3) continue;
    const along = i / stem.length;
    const p = 0.18 * (1 - 0.5 * along) * (1 - depth * 0.4);
    if (!r.chance(p)) continue;
    lastBranch = i;
    budget.n--;
    side = (side * -1) as -1 | 1;
    const a = stem[i - 1]!;
    const b = stem[i + 1]!;
    const tan = Math.atan2(b.y - a.y, b.x - a.x);
    buildBranch(
      r,
      {
        ...o,
        start: stem[i]!,
        heading: tan + side * r.range(0.45, 0.85),
        steps: Math.max(4, Math.round(o.steps * 0.6)),
        stepLen: o.stepLen * 0.62,
        curl: o.curl * 1.1,
      },
      depth + 1,
      budget,
      out,
    );
  }
}

/** Deterministic root anchors down both edges — the "where vines come from". */
export function computeRoots(width: number, height: number, r: Rng): Root[] {
  const count = clamp(Math.round(height / 620), 3, 7);
  const roots: Root[] = [];
  let side: -1 | 1 = r.chance(0.5) ? 1 : -1;
  for (let k = 0; k < count; k++) {
    const yFrac = (k + 0.5 + r.jitter(0.32)) / count;
    const y = clamp(height * (0.03 + 0.92 * yFrac), 0, height);
    const x = side < 0 ? r.range(-30, 28) : width - r.range(-30, 28);
    roots.push({ x, y, side, heading: Math.PI / 2 + side * r.range(0.22, 0.5) });
    side = (side * -1) as -1 | 1;
  }
  return roots;
}

/** Generate one vine from a root anchor. */
export function generateVine(r: Rng, root: Root, width: number, height: number): Vine {
  const out: Vine = { strands: [], leaves: [], flowers: [], top: Infinity, bottom: -Infinity };
  const stepLen = r.range(74, 104);
  const steps = clamp(Math.round((height - root.y) / stepLen) + r.int(2, 5), 7, 20);
  buildBranch(
    r,
    {
      start: vec(root.x, root.y),
      heading: root.heading,
      steps,
      stepLen,
      curl: r.range(0.1, 0.16),
      wander: r.range(0.045, 0.075),
      inwardBias: r.range(0.01, 0.022),
      gravity: r.range(0.02, 0.04),
      side: root.side,
      maxY: height + 120,
    },
    0,
    { n: r.int(3, 5) },
    out,
  );
  return out;
}

/**
 * Generate a full field. `width`/`height` are the canvas (document) size in px.
 * Each vine gets its own salted RNG stream so one can change without disturbing
 * the others, and so roots stay stable while growth varies.
 */
export function generateField(seed: string, width: number, height: number): VineField {
  const roots = computeRoots(width, height, makeRng(`${seed}::roots`));
  const vines = roots.map((root, i) =>
    generateVine(makeRng(`${seed}::vine:${i}`), root, width, height),
  );
  return { width, height, seed, roots, vines };
}
