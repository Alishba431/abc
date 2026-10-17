# Traceability Matrix

Every requirement maps to the code that implements it and the automated tests that prove it.
Run all tests with `./run_tests.sh` (Docker only; writes `COVERAGE.json`). Backend source lives in `backend/src/`, mobile in `mobile/src/`.

| ID | Requirement | Implementation | Automated tests |
|---|---|---|---|
| FR-1.1 | Multi-sport taxonomy as data; mystery sport via JSON | `domain/sports.js` (validation, tie-break defaults, config-driven limits), `seed.js` (4 sports stored as data), `routes/audit.js` `POST /sports` | `tests/scoring.test.js` › mystery sport; innings model; round model |
| FR-1.1 | Event-sourced scoring, compensating events, signatures | `domain/events.js` (append-only log, idempotency, state machine), `domain/scoring.js` (projection rebuilt on read), `sign.js` (HMAC recipe 5.3) | `tests/scoring.test.js` › signature vector 1; event model lifecycle; compensation |
| FR-1.2 | League setup scoped to fixtures and points config | `domain/leagues.js` `createLeague` | `tests/standings.test.js` › league validation and conflicts |
| FR-1.3 | Round robin (circle method, byes, withdrawals) | `domain/fixtures.js` `roundRobin`, `homeOf` | `tests/fixtures.test.js` › round robin structure; withdrawals |
| FR-1.3 | Swiss (score groups, no rematches, byes, Buchholz, optimal pairing) | `domain/fixtures.js` `swiss`, `minCostPairing` (branch and bound) | `tests/fixtures.test.js` › swiss; NO_VALID_PAIRING |
| FR-1.3 | Single elimination (seeding, byes, third place) | `domain/fixtures.js` `singleElim`, `seedOrder`, `runBracket` | `tests/fixtures.test.js` › single elimination |
| FR-1.3 | Double elimination (losers bracket, grand final, reset) | `domain/fixtures.js` `doubleElim` | `tests/fixtures.test.js` › double elimination |
| FR-1.3 | Match status state machine, illegal transitions rejected | `domain/events.js` (`match_start` / `match_end` rules) | `tests/scoring.test.js` › event model lifecycle |
| FR-1.4 | Standings, recursive tie-breaks, 3-way H2H, NRR, clinched/eliminated | `domain/standings.js` `computeStandings`, `domain/leagues.js` `standings` | `tests/standings.test.js` (all) |
| FR-2.1 | Club profiles, white-label tenant, tenant isolation | `seed.js` (tenants with branding, clubs, staff, venue), `routes/api.js` `GET /clubs/:id`, `mobile/src/screens/ClubScreen.js` | `tests/rbac.test.js` › matrix (P6 foreign club = 403) |
| FR-2.2 | Roster: transfer, loan + auto-return, release, rule order, audit trail | `domain/roster.js` (`setup`, `transfer`, `history`, `materializeReturn`) | `tests/roster.test.js` › ordered rule checks; deferred transfer; loans |
| FR-2.3 | Store: variants, discounts, mock gateway, PDF receipt, queue event | `domain/store.js`, `pdf.js`, `queue.js` (Redis Streams), `worker.js` | `tests/store.test.js` (all) |
| FR-5.1 | Five-tier RBAC via policy matrix, negative tests | `domain/rbac.js` `POLICY` + `authorize`, `auth.js` (HS256 JWT) | `tests/rbac.test.js` › 5-role negative matrix; token attacks |
| NFR-3 | Concurrency: 20 buyers, 1 unit, zero oversell | `domain/store.js` conditional `UPDATE … WHERE stock >= $q` inside a transaction; `CHECK (stock >= 0)` in `db.js` | `tests/store.test.js` › 20 simultaneous buyers |
| NFR-4 | Offline cache + persistent queue + conflict sync | `domain/offline.js`; `mobile/src/db.js`, `mobile/src/SyncContext.js`, `mobile/src/useCached.js`, `mobile/src/screens/SyncScreen.js` | `tests/roster.test.js` › offline sync |
| NFR-5 | Security: JWT verify, rate limit, input validation, body limit, secure token storage | `auth.js`, `ratelimit.js`, `validate.js`, `app.js` (1 MB limit → 413), `mobile/src/session.js` (expo-secure-store / Keystore) | `tests/rbac.test.js` › token attacks; rate limit · `tests/store.test.js` › 413, malformed JSON · `tests/scoring.test.js` › injection |
| NFR-7 | One-command reproducible stack, seeded baseline | `docker-compose.yml`, `backend/Dockerfile`, `seed.js` `bootstrap` / `resetAll` | `tests/store.test.js` › reset is repeatable |
