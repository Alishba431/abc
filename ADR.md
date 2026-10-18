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

# Phase II (Day 2)

## ADR-9: MinIO from `bitnamilegacy/minio:2024.9.22` (supersedes ADR-7 for Phase II)
**Context:** Phase II requires MinIO in the compose stack, but `minio/minio` is no longer published on Docker Hub, so referencing it would break `docker compose up` on the grader. **Decision:** run the Bitnami legacy build of the same MinIO server (S3 API on 9000, console on 9001, `recordings` bucket created at boot). **Consequences:** the stack starts from public images only; receipts stay in PostgreSQL (ADR-7).

## ADR-10: MediaMTX as the single media server, with an HTTP auth hook
**Context:** we need RTMP ingest (OBS / Larix / FFmpeg), WHIP, HLS and WebRTC playback, and revoking a key must cut a live publisher within 2 s. **Decision:** `bluenviron/mediamtx:1.9.1` with `authMethod: http` → `POST /internal/media/auth`, so every publish is checked against the stream-key table in PostgreSQL. Revoke and rotate also kick the live connection through the MediaMTX control API (`/v3/*/kick/{id}`). **Consequences:** one container covers every protocol and stream-key state has one source of truth. There is no SFU: the co-stream composite URL is the MediaMTX path `costream/{session_id}`, and a real 4-way FFmpeg mix is future work.

## ADR-11: Guest read-only boundary enforced in middleware, before body parsing
**Context:** FR-4.3 gives zero credit for client-side hiding; any guest write must get 403 `GUEST_WRITE_FORBIDDEN`. **Decision:** `guestWriteGuard` is the first middleware in `app.js`. It rejects every non-GET request that carries a `guest_anon_tok_*` bearer, and every unauthenticated write to a member route, before routing or validation runs. Only `/api/v1/guest/token` and `/api/v1/guest/cart` are writable by guests. **Consequences:** the boundary holds even for routes added later; the web player turns the 403 into the progressive auth modal.

## ADR-12: Atomic, idempotent guest-cart merge
**Context:** network retries and double taps must never double the quantity, and merged quantities are capped by stock. **Decision:** serialise per guest token and per user (`withLock`). The idempotency key is the canonical JSON of `{guest_cart, registered_user_id}`: an identical replay returns the stored response, and a different body for an already merged token gets `GUEST_TOKEN_ALREADY_MERGED`. **Consequences:** two simultaneous identical merges produce one merge (tested).

## ADR-13: In-process realtime: dependency-free WebSocket + SSE with filtered channels
**Context:** score pushes must reach 25 clients with p95 < 500 ms, and chat must sync across web and mobile. **Decision:** a small RFC 6455 server inside the API (`/ws`, `/ws/matches/{id}`, `/ws/chat/{room}`) plus SSE (`/api/v1/matches/{id}/stream`). Domain code publishes after each commit, and the socket layer filters by `match_id` or `chat_room_id`. **Consequences:** no extra container or dependency, with pushes in single-digit milliseconds locally. Scaling past one API instance would need Redis pub/sub between instances.

## ADR-14: In-memory read caches for the k6 profile
**Context:** 500 guest VUs poll QR metadata and match state while 50 VUs post chat. **Decision:** cache QR views and score projections in memory, invalidated through one bus (`cache.js`) on every match event and on `/audit/v1/reset`. **Consequences:** the exact k6 profile runs at 0 % failures and p95 22 ms locally (69,370 requests, 550 VUs); a stale read is impossible because every write path invalidates first.

## ADR-15: Chat moderation with in-memory room state and async persistence
**Context:** moderation is synchronous and pre-broadcast; kicks must stay de-duplicated under 10 parallel calls; `seq` must increase monotonically. **Decision:** each room keeps kicked and muted sets, the last 100 messages and `seq` in memory under a per-room lock, and persists to PostgreSQL asynchronously. Failed notifications retry 3 times with exponential backoff, then land in the persistent `dlq` table. **Consequences:** moderation adds no database round-trip to the hot path; history survives restarts through the persisted copy.

## ADR-16: Privacy by data minimisation
**Context:** NFR-9 forbids storing IPs, full User-Agents or fingerprints, and erasure must finish within 1 s. **Decision:** a QR scan stores only the entity, the device family (mobile / desktop) and an hourly UTC bucket. Erasure anonymises the user, player rows and linked guest tokens in place. **Consequences:** scan analytics and match history stay intact while no personal data remains.

## ADR-17: QA harness: pinned Grid images, compose network alias, host fallback
**Context:** the grader runs Selenium Grid 4 on 4444 with 3 nodes, Appium 2 on 4723 and k6; the campus network is slow. **Decision:** use the pre-pulled `4.24.0` Grid images (`shm_size: 1gb`, VNC off). Browsers reach the app as `http://backend:8080` through a compose network alias. The suite runs in a `python:3.12-slim` image, or from a host venv with `QA_PYTHON=…`. Appium uses UiAutomator2 and k6 runs as `grafana/k6:0.54.0`. CI (`autograde.yml`) generates fresh salts on every run. **Consequences:** no secret salt is ever committed, and the same suites run locally, in CI and at the desk.

## ADR-18: Native deep links without a login wall
**Context:** `adb shell am start -W -a android.intent.action.VIEW -d "nascon://entity/match-m1"` must open the right screen within 2 s, even when nobody is signed in. **Decision:** Expo `scheme: nascon` generates the browsable intent filter, and React Navigation linking uses a custom `getStateFromPath`. The deep-linkable screens (Match, CoStream, Web, Scan) are registered in both the guest and member stacks; guests read public endpoints, and writes route to sign-in. **Consequences:** QR codes, `nascon://` links and the in-app scanner all land on content first; EAS uploads use `EAS_NO_VCS=1` with a root `.easignore`, so the archive is about 150 KB.

## ADR-20: Broadcaster presence sockets for abrupt host disconnects
**Context:** edge case 1 and FR-3.3 also cover a host who vanishes mid-broadcast (app killed, network lost), and hosting must move within 1.5 s. **Decision:** broadcasters hold `/ws/costream/{id}?access_token=<JWT>`, and the token's `player_id` identifies them, so a disconnect can't be faked. The server pings every 300 ms; a broadcaster that is silent for 900 ms, or whose TCP connection drops, is passed to `presenceLost`. That applies the same rule as `simulate_host_drop`: the next participant in array order takes over, keeping the chat room and composite URL, or the session terminates and its composite path is closed. **Consequences:** handoff lands in about 1 s, viewers learn of it over the same socket bus, and nothing is left running for a dead session.

## ADR-19: Stream recording and VOD index without new containers or compose changes
**Context:** FR-3.2 wants every stream recorded to MinIO and indexed as a VOD as soon as it ends; the grader's compose file must keep starting cleanly. **Decision:** at startup the API switches MediaMTX recording (fmp4) and its playback server on through the control API, and only patches what is off, so live publishers are never reloaded. The 2 s metrics sampler notices when a `live/*` path stops. It then pulls that recording from the playback server (`:9996`), uploads it to MinIO with a small hand-written AWS SigV4 client (no SDK dependency) and inserts it into `vods`. VOD ids are content-addressed, so re-runs never duplicate. **Consequences:** a VOD appears on the athlete profile and the replay page about 3 s after a stream ends, and the bucket stays private because playback goes through `GET /api/v1/public/vods/{id}`. If MinIO is down, the failure is logged and retried on the next stream, never crashing the sampler.
