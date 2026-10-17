# League Ops Platform — Part I Build Plan (Node.js backend + React Native/Expo app)

Hard deadlines (PKT): **every window needs ≥1 pushed commit** (−2 each missed) · questions to organizers **in writing before 13:00** · final push **before 15:05:00** (aim 14:50) · judging from 15:15.

Stack: Node 20 + Express, PostgreSQL 16, Redis 7 (Streams = internal queue), worker container, hand-rolled HS256 JWT, built-in PDF writer. Mobile: Expo (React Native) + expo-sqlite + expo-secure-store, APK via EAS cloud build.

> MinIO: `minio/minio` no longer exists on Docker Hub, so referencing it in compose would make the grader's `docker compose up` fail (−10). Receipts are stored in Postgres; ask organizers in writing.

## Window 1 — 10:45–11:45  → push by 11:40
Backend
- [x] Repo layout, `docker-compose.yml` (api, worker, postgres, redis), Dockerfile, `.env.example`
- [x] `GET /health`, Postgres schema bootstrap, `POST /audit/v1/reset` + full baseline seed (tenants, store, RBAC scenario, 5 demo users, 4 sports as data)
- [x] Canonical JSON + HMAC signer, verified against Appendix A test vector 1
- [x] Standard error body, 413 for >1 MB, 400 for bad JSON
Mobile
- [x] `npx create-expo-app mobile`, navigation shell (tabs: Fixtures, Standings, Store, Club, Sync), Settings screen with server URL
- [x] Login screen → `POST /api/v1/auth/login`, token in expo-secure-store

## Window 2 — 11:45–12:45  → push by 12:40
Backend
- [x] `POST /audit/v1/sports` (mystery sport validation)
- [x] `POST /audit/v1/events` + `GET /audit/v1/score/{id}` (event-sourced, compensation, idempotency, innings/round limits)
- [x] `POST /audit/v1/leagues` + `GET /audit/v1/standings/{id}` (recursive tie-break, H2H, NRR, clinched/eliminated)
- [x] `POST /audit/v1/fixtures`: round robin, swiss, single elim, double elim
Mobile
- [x] Fixtures list, Match detail (score + timeline, polling/SSE), Standings table
- [x] SQLite cache for fixtures / standings / club profile

## Window 3 — 12:45–13:45  → push by 13:40
Backend
- [x] Checkout + inventory (atomic reserve, mock gateway, signed receipt, PDF, Redis Stream event)
- [x] RBAC: `/rbac-matrix`, 7 probe routes, policy matrix, JWT verify (alg none / tamper / expiry → 401)
- [x] `/api/v1/ping` rate limiter (100 / rolling 10 s / IP, `Retry-After`)
- [x] Roster setup / transfer / history (8 ordered checks, loans, deferred, audit trail)
- [ ] **Before 13:00:** written questions to organizers (MinIO, EAS build)
Mobile
- [x] Store (catalogue, variant picker, cart, checkout, receipt), Roster management, Scoring entry
- [x] Offline queue (SQLite, 5.14 action format) + online/offline/syncing banner
- [ ] **First EAS APK build ~13:15** to prove the pipeline

## Window 4 — 13:45–14:45  → push by 14:40
Backend
- [x] `POST /audit/v1/offline-sync` (ordering, duplicates, rebased_append, server_wins)
- [ ] Unit tests per area, `run_tests.sh`, real `COVERAGE.json`
- [ ] README (run + demo accounts), TRACEABILITY.md, ADR.md (8 ADRs, needed for Day-2 viva)
- [ ] Clean-machine check: `docker compose down -v && DAY1_SALT=x docker compose up -d --build`, /health < 120 s, 20-buyer burst test
Mobile
- [ ] Final APK by **14:15** → `mobile/release/app-release.apk`; HCI polish (48 dp targets, empty states, plain-language errors)

## 14:45–15:05 — freeze
- [ ] Final push ≤ 14:55. Nothing after 15:05. Backend running + app installed on phone for 15:15 judging.
