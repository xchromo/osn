---
"@cire/landing": patch
---

Rebuild the hero's 3D wax seal look and fix the invisible-seal failure mode.

Robustness: the poster fallback previously hid the moment the island committed
to loading Three.js — if the deferred import, WebGL context, or first frame
then failed, the hero showed nothing. The poster now stays visible until the
3D scene's first frame has actually painted, and any load failure keeps it.

Look: the seal is rebuilt as a stamping — a flat pressed field, a shoulder
groove, one smooth proud rim, and a near-circular silhouette with restrained
per-mount randomness (harmonics, one or two run-out tongues), so every visitor
gets a subtly unique seal. The die's design (double ring + monogram) is scaled
to sit inside the stamped field (it previously landed on the rim), and a new
roughness map makes the pressed design read as burnished-glossy against the
matte cooled-wax field. Verified visually via headless-Chrome screenshots at
desktop and mobile sizes.
