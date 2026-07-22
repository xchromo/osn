// The signature centrepiece: a real, three-dimensional wax seal that presents the
// page. It is deliberately AMBIENT — it never breaks. It rests, breathes with a
// slow tilt, catches a gold key light on its embossed monogram, and leans toward
// the pointer so it feels physical rather than printed. The "reveal" is a gentle
// settle on load (a small dolly-back + fade-up), not a shatter. The seal itself
// is STAMPED, not moulded: each mount pours a fresh random puddle and presses
// the same circular die into it, so every visitor's seal is unique.
//
// This module is lazy-loaded (`import()`) by WaxSeal3D so Three.js stays off the
// critical path — the hero's headline and CTAs are server-rendered and painted
// long before this ever runs. If WebGL is unavailable, or the visitor prefers
// reduced motion, WaxSeal3D never loads this file at all and the CSS seal it
// renders underneath stands in as a static poster.
//
// Core `three` only — no examples/addons — to keep the added weight to the seal,
// not a scene-graph toolkit.
import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

export interface WaxSealController {
  /** Tear down the renderer, listeners and GPU resources. Idempotent. */
  destroy(): void;
}

export interface WaxSealOptions {
  /** Fired once the first frame has painted, so the caller can cross-fade in. */
  onReady?: () => void;
}

// Brand gold (matches --color-gold, oklch(74.99% 0.0854 82.08)) as the wax body.
const WAX_GOLD = 0xc9a86a;
const KEY_WARM = 0xffe6b0; // upper-left key — the light that carves the emboss
const FILL_FOREST = 0x2f5a44; // cool forest fill from below-right (brand bg family)
const RIM_GLOW = 0xf6d79a; // faint back rim so the wax edge separates from the page

/**
 * Paint the monogram + border ring the seal-press leaves in the wax, as a height
 * field for the bump map: mid-grey is the wax surface, brighter is raised. A real
 * seal press leaves the design PROUD of a knocked-back field, so the ring and the
 * "C" are drawn lighter than their surround.
 */
function makeEmbossTexture(): CanvasTexture {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const c = S / 2;

  // Flat wax field. The macro doming + raised rim now come from the geometry, so
  // the bump map only carries the fine press detail (border ring + monogram) on
  // top of an even surface.
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, S, S);

  // The knocked-back inner well the stamp presses (design sits proud of this).
  ctx.beginPath();
  ctx.arc(c, c, S * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "#666666";
  ctx.fill();

  // Hand-poured micro-texture: a fine speckle over the whole face so the body
  // reads as cooled wax rather than moulded plastic, plus a few faint circular
  // striations in the well — the drag marks a die leaves as it twists free.
  for (let i = 0; i < 1600; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * S * 0.5;
    const g = 100 + Math.floor(Math.random() * 24) - 12;
    ctx.fillStyle = `rgb(${g} ${g} ${g})`;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 7; i += 1) {
    const rr = S * (0.1 + Math.random() * 0.26);
    const start = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c, c, rr, start, start + 0.9 + Math.random() * 1.6);
    ctx.lineWidth = 1 + Math.random() * 1.4;
    ctx.strokeStyle = Math.random() < 0.5 ? "#5e5e5e" : "#707070";
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Raised decorative border ring near the rim.
  ctx.lineWidth = S * 0.03;
  ctx.strokeStyle = "#d8d8d8";
  ctx.beginPath();
  ctx.arc(c, c, S * 0.41, 0, Math.PI * 2);
  ctx.stroke();
  // A finer companion ring inside it — the double-rule a die usually carries.
  ctx.lineWidth = S * 0.008;
  ctx.strokeStyle = "#c4c4c4";
  ctx.beginPath();
  ctx.arc(c, c, S * 0.35, 0, Math.PI * 2);
  ctx.stroke();

  // The monogram, raised and centred. Serif to echo the Cormorant display face.
  ctx.fillStyle = "#efefef";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${S * 0.5}px Georgia, "Cormorant Garamond", serif`;
  // Optical centring — a cap "C" sits a touch high on the maths midline.
  ctx.fillText("C", c, c + S * 0.03);

  const tex = new CanvasTexture(canvas);
  // A bump map is height data, not colour — leave it in the default linear space
  // (tagging it sRGB would wrongly gamma-decode the heights).
  tex.anisotropy = 4;
  return tex;
}

/**
 * One pour of wax. Each mount rolls a fresh puddle — the shape the molten wax
 * spread into, and where it squeezed out from under the die. The die itself is
 * the same perfect circle every time; uniqueness comes from the wax, exactly
 * as it does on a real letter. So every visitor's seal is their own.
 */
interface WaxPour {
  /** Silhouette radius multiplier around the puddle boundary (~0.85–1.3). */
  spread(ang: number): number;
  /** Squeeze-out ridge amplitude factor around the die edge (~0.5–1.8). */
  squeeze(ang: number): number;
}

/** Shortest signed angular distance, so tongue falloffs wrap around ±π. */
function angDist(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function pourWax(): WaxPour {
  // Low-frequency harmonics — a hand-poured puddle is never a circle.
  const harmonics = Array.from({ length: 4 }, (_, i) => ({
    k: 2 + i * 2 + (Math.random() < 0.5 ? 1 : 0),
    amp: (0.05 / (i + 1)) * (0.6 + Math.random() * 0.9),
    phase: Math.random() * Math.PI * 2,
  }));
  // A few tongues where wax escaped the press and ran further out.
  const tongues = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => ({
    at: Math.random() * Math.PI * 2,
    width: 0.3 + Math.random() * 0.35, // radians
    run: 0.07 + Math.random() * 0.12,
  }));
  // Fine ripple on the squeeze-out ridge — the marks the die's edge drags.
  const ripple = [
    { k: 15 + Math.floor(Math.random() * 5), amp: 0.14, phase: Math.random() * Math.PI * 2 },
    { k: 27 + Math.floor(Math.random() * 6), amp: 0.08, phase: Math.random() * Math.PI * 2 },
  ];

  const tongueAt = (ang: number) =>
    tongues.reduce((sum, t) => sum + t.run * Math.exp(-((angDist(ang, t.at) / t.width) ** 2)), 0);

  return {
    spread(ang) {
      let s = 1 + tongueAt(ang);
      for (const h of harmonics) s += h.amp * Math.sin(h.k * ang + h.phase);
      return s;
    },
    squeeze(ang) {
      // More wax escapes where the puddle ran further — the ridge lumps and
      // the silhouette tongues line up, as conservation of wax demands.
      let q = 0.85 + tongueAt(ang) * 4;
      for (const r of ripple) q += r.amp * Math.sin(r.k * ang + r.phase);
      return q;
    },
  };
}

/**
 * Build the seal the way a real one is made: pour an irregular puddle of wax,
 * then press a perfectly circular die into it. The stamped field stays round
 * because the die held it; everything outside — the squeeze-out ridge, the
 * flared silhouette, the thin run-out tongues — is the wax reacting to the
 * press, freshly randomised per pour. That contrast (round die, irregular wax)
 * is what makes it read as STAMPED rather than a moulded button. The embossed
 * monogram rides the pressed face via a planar UV projection.
 */
function makeSealMesh(emboss: CanvasTexture): Mesh {
  const R = 1;
  const pour = pourWax();
  const geo = new SphereGeometry(R, 160, 120);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new Vector3();

  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.y, v.x);
    // Radial position in DIE space — measured before any spreading, because
    // the die's press is a perfect circle regardless of where the wax went.
    const rr = Math.min(1, Math.hypot(v.x, v.y) / R);

    // Stamp, part 1 — the puddle: blend the poured silhouette in beyond the
    // die edge, so the stamped field stays circular while the surrounding wax
    // flares into its own one-off shape.
    const flare = MathUtils.smoothstep(rr, 0.72, 1);
    const spread = 1 + flare * (pour.spread(ang) - 1);
    v.x *= spread;
    v.y *= spread;

    // Squash the sphere along the view axis into a thick wax slab.
    v.z *= 0.42;

    if (v.z > 0) {
      // Stamp, part 2 — the press: dish the centre DOWN so the field sits
      // below the rim (a squashed sphere alone leaves the centre as the high
      // point, which is why the old seal read like a boiled sweet)...
      v.z -= Math.exp(-((rr / 0.5) ** 2)) * 0.1;
      // ...and pile the displaced wax up as an uneven squeeze-out ridge at
      // the die edge — tallest exactly where the silhouette grew tongues.
      v.z += Math.exp(-(((rr - 0.78) / 0.17) ** 2)) * 0.15 * pour.squeeze(ang);
      // Stamp, part 3 — wax that ran further ran thinner.
      const thin = Math.min(0.5, Math.max(0, (pour.spread(ang) - 1) * 1.8));
      v.z *= 1 - MathUtils.smoothstep(rr, 0.82, 1) * thin;
    }

    pos.setXYZ(i, v.x, v.y, v.z);
    // Planar UV down the view axis so the monogram lands centred on the face
    // (a sphere's own UVs would pinch it into the pole).
    uv.setXY(i, v.x / (2 * R) + 0.5, v.y / (2 * R) + 0.5);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();

  // Sealing-wax finish: a slightly matte body under a clearcoat, so the field
  // stays soft while the emboss ridges catch the key light's specular streaks.
  const material = new MeshPhysicalMaterial({
    color: WAX_GOLD,
    metalness: 0.15,
    roughness: 0.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
    reflectivity: 0.45,
    bumpMap: emboss,
    bumpScale: 0.75,
  });

  return new Mesh(geo, material);
}

export function mountWaxSeal(
  canvas: HTMLCanvasElement,
  options: WaxSealOptions = {},
): WaxSealController {
  const parent = canvas.parentElement ?? canvas;
  const size = () => ({
    w: parent.clientWidth || 320,
    h: parent.clientHeight || 320,
  });

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  {
    const { w, h } = size();
    renderer.setSize(w, h, false);
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 100);
  const setCamera = () => {
    const { w, h } = size();
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  camera.position.set(0, 0, 6);
  setCamera();

  // Lighting: a warm gold key carves the emboss from the upper-left; a cool
  // forest fill keeps the shadow side in brand; a faint back rim frees the edge.
  const key = new DirectionalLight(KEY_WARM, 2.5);
  key.position.set(-3, 3.4, 4);
  const fill = new DirectionalLight(FILL_FOREST, 0.7);
  fill.position.set(3, -2, 2);
  const rim = new PointLight(RIM_GLOW, 12, 20, 2);
  rim.position.set(0, 0.6, -3);
  const ambient = new AmbientLight(0x3a3320, 0.5);
  scene.add(key, fill, rim, ambient);

  const emboss = makeEmbossTexture();
  const seal = makeSealMesh(emboss);
  const group = new Group();
  group.add(seal);
  scene.add(group);

  // Pointer parallax target (-1..1 within the viewport). Stored here, applied
  // (lerped) in the loop so pointermove never triggers a render itself.
  let pointerX = 0;
  let pointerY = 0;
  let hasPointer = false;
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return; // touch has no hover; leave it to idle
    hasPointer = true;
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  const onResize = () => {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    setCamera();
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(parent);

  // Only run the loop while the seal is on screen and the tab is visible.
  let onScreen = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
    },
    { threshold: 0.01 },
  );
  io.observe(canvas);

  const t0 = performance.now();
  let raf = 0;
  let ready = false;

  const frame = () => {
    if (!onScreen || document.hidden) {
      raf = 0;
      return;
    }
    const t = (performance.now() - t0) / 1000;

    // Idle breath — a slow tilt that always keeps the face to camera.
    const idleYaw = Math.sin(t * 0.45) * 0.26;
    const idlePitch = Math.sin(t * 0.32) * 0.06;
    // Pointer lean, damped toward the stored target.
    const targetYaw = idleYaw + (hasPointer ? pointerX * 0.35 : 0);
    const targetPitch = idlePitch + (hasPointer ? pointerY * 0.22 : 0);
    group.rotation.y += (targetYaw - group.rotation.y) * 0.06;
    group.rotation.x += (targetPitch - group.rotation.x) * 0.06;

    // Gentle load-in settle: a small dolly-back + scale ease over ~1.3s.
    const rin = MathUtils.clamp(t / 1.3, 0, 1);
    const eased = 1 - Math.pow(1 - rin, 3);
    camera.position.z = MathUtils.lerp(5.35, 6, eased);
    const s = MathUtils.lerp(1.08, 1, eased);
    group.scale.setScalar(s);

    renderer.render(scene, camera);

    if (!ready) {
      ready = true;
      options.onReady?.();
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf === 0) raf = requestAnimationFrame(frame);
  };
  const onVisibility = () => {
    if (!document.hidden) start();
  };
  document.addEventListener("visibilitychange", onVisibility);
  start();

  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      io.disconnect();
      seal.geometry.dispose();
      (seal.material as MeshPhysicalMaterial).dispose();
      emboss.dispose();
      renderer.dispose();
    },
  };
}
