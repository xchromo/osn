---
"@pulse/api": patch
---

Fix `pulse-api` crashing at boot when `osn/api` is not yet reachable. `startKeyRotation()` now distinguishes network failures (`ConnectionRefused`, DNS, etc) from configuration errors: in local dev it logs a warning and schedules a background retry (~5 s) instead of exiting, so `bun run dev:pulse` tolerates either service starting first. Non-local envs and HTTP 4xx/5xx responses still fail fast so misconfiguration is surfaced immediately.
