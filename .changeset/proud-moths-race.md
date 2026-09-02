---
"@shared/redis": patch
"@osn/api": patch
"@pulse/api": patch
---

Take ioredis 6.0.0 (from 5.11.1). This is not a dev-only bump: `osn/api/src/index.ts` and `pulse/api/src/index.ts` both statically import `./redis`, which statically imports `@shared/redis/ioredis`, so ioredis is compiled into both deployed Worker bundles and its module body runs at isolate startup. v6 drops the `redis-parser` package for an in-tree RESP decoder — confirmed, `redis-parser` is gone from the lockfile.

Verified by booting the real built bundle on workerd (`wrangler dev --local`), not by a dry run: `osn-api` starts clean and serves 200 on `/health`, `/.well-known/jwks.json` and `/`, with no errors in the log. The Worker bundle grows 4594.90 KiB to 4716.41 KiB.
