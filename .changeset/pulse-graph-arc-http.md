---
"@pulse/api": minor
"@osn/db": patch
---

Migrate pulse/api graph bridge from in-process @osn/db imports to ARC-token authenticated HTTP calls against @osn/api's /graph/internal/* endpoints. Add pulse-api service account to the @osn/db dev seed.
