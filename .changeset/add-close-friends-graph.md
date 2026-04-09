---
"@osn/core": minor
"@shared/observability": patch
"@pulse/api": patch
---

Add close friends to the OSN graph properly

- Add `isCloseFriendOf` and `getCloseFriendsOfBatch` helpers to the graph service
- Add `GET /graph/close-friends/:handle` status check endpoint
- Instrument close friend operations with metrics (`osn.graph.close_friend.operations`) and tracing spans
- Fix `removeConnection` to clean up close-friend entries in both directions (consistency bug)
- Migrate Pulse graph bridge from raw SQL to service-level `getCloseFriendsOfBatch`
- Add `GraphCloseFriendAction` attribute type to shared observability
