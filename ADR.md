# Architecture Decision Records

## ADR-1: Node.js + Express backend, one API container
**Context:** 8-hour build, strict JSON contract, 4 vCPU / 8 GB grader. **Decision:** Node 20 + Express, three runtime deps (express, pg, ioredis). **Consequences:** fast startup (<5 s to healthy), small image, quick builds; single process means in-process locks are valid (see ADR-4).

## ADR-2: PostgreSQL as the system of record, JSONB for flexible config
**Context:** sports, leagues and rosters are rule-driven and must accept a mystery sport with no code change. **Decision:** relational tables for identities and logs, JSONB columns for sport rules and league config. **Consequences:** new sports are rows, not code; no migrations needed during grading; easy `TRUNCATE … RESTART IDENTITY` reset.

## ADR-3: Event sourcing for match scores with compensating events
**Context:** corrections (disallowed goal) must never mutate history and every record must be signed. **Decision:** append-only `events` table (unique `event_id`, per-match `seq`); the score is a pure projection (`domain/scoring.js`) recomputed on each read; corrections append a signed `compensation` event. **Consequences:** full audit history, trivially reproducible standings; reads cost O(events) which is fine at league scale.

## ADR-4: Concurrency — conditional SQL updates + per-key serialisation
**Context:** 20 simultaneous buyers for 1 unit; concurrent events on one match. **Decision:** stock is reserved with `UPDATE variants SET stock = stock - q WHERE id = $1 AND stock >= q` in a transaction, backed by `CHECK (stock >= 0)`; match/roster/order writes are serialised per key with an in-process async mutex. **Consequences:** zero oversell guaranteed by the database itself; if the API is scaled horizontally the mutex must become `pg_advisory_xact_lock`.

## ADR-5: Hand-rolled HS256 JWT and policy-as-code RBAC
**Context:** must reject `alg:none`, tampered and expired tokens; five roles with tenant/ownership scopes. **Decision:** ~40-line JWT module that pins `alg = HS256` and uses `timingSafeEqual`; one declarative `POLICY` map (action → role → scope) evaluated by a single `authorize()` function. **Consequences:** no library alg-confusion risk; adding a role or route is a one-line policy change; negative matrix fully unit-tested.

## ADR-6: Redis Streams as the internal job queue + separate worker
**Context:** order status transitions must emit domain events to a queue. **Decision:** `XADD domain-events` from the API (fire-and-forget), consumed by the `worker` container. **Consequences:** queue outages never fail a checkout; events are durable and replayable; no extra broker image to pull.

## ADR-7: No MinIO; receipts stored in PostgreSQL
**Context:** the `minio/minio` image is no longer published on Docker Hub, so referencing it would break `docker compose up` on the grader (−10 penalty). **Decision:** generate the PDF server-side with a small dependency-free writer (`pdf.js`) and store it as `BYTEA` with the order. **Consequences:** reproducible build; receipts are transactional with the order; swapping to an S3-compatible store later is isolated to the store module.

## ADR-8: Offline-first mobile with SQLite cache and a 5.14-format action queue
**Context:** judges use airplane mode, force-close the app, then reconnect. **Decision:** Expo (React Native) app; every read is network-first with SQLite fallback; every score/roster write goes into a persistent SQLite queue in exactly the `/offline-sync` action format, synced automatically on reconnect through a production route that calls the same replay code. **Consequences:** identical behaviour online and offline, nothing lost on force-close; server is the source of truth (`server_wins`) and rejections are shown in plain language.
