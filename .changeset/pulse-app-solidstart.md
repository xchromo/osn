---
"@pulse/app": minor
---

Move the Pulse web app from a plain Vite SPA to SolidStart. Routes are now
file-based under `src/routes/`, the app entry is `src/app.tsx` with
`src/entry-client.tsx` / `src/entry-server.tsx`, and the build emits a
deployable server bundle through nitro. Rendering stays client-side
(`ssr: false`) until the issuer session cookie is forwarded server-side.
