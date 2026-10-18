# League Ops Platform — Multi-Sport League & Club Operations

## Run the backend
```bash
cp .env.example .env              # put DAY1_SALT and DAY2_SALT in .env (gitignored, never commit it)
DAY1_SALT=<s1> DAY2_SALT=<s2> docker compose up -d --build
curl http://localhost:8080/health  # {"status":"ok"}  (DB + Redis + media server + seed)
```
Services: `api` (Node 20 + Express, port 8080, also `http://backend:8080` on the compose network), `worker`
(Redis Streams consumer), `postgres` 16, `redis` 7, `minio` (9000/9001), `mediamtx` (RTMP 1935, HLS 8888,
WebRTC/WHIP 8889), Selenium Grid 4 hub (4444) with 2 Chrome + 1 Firefox nodes.
For phones on the LAN set `MEDIA_PUBLIC_HOST=<laptop-LAN-IP>` (stream URLs) and `MEDIA_LAN_IP=<laptop-LAN-IP>` (WebRTC).

## Phase II (Day 2) quick tour
| What | Where |
|---|---|
| Guest Web Player (no login) | http://localhost:8080/web/matches/match-m1/live · co-stream: `/web/costream/cs-session-101` |
| Dynamic QR short link | http://localhost:8080/q/m1-live → 302 to the state route · exports `/audit/v1/qr/match-m1/export.{svg,png,pdf}` |
| Go live from OBS / Larix | app → Me → Go live (or `POST /audit/v1/stream/key`), then `rtmp://<host>:1935/live/<stream_key>`; watch `http://<host>:8888/live/<stream_key>/index.m3u8` |
| Replays (VOD) | every ended stream is recorded to MinIO and listed on the athlete profile; replay page `/web/matches/{id}/vod` |
| Metrics | http://localhost:8080/metrics (Prometheus text) |
| Media end to end | `./tests/media_e2e.sh` (needs ffmpeg) → `tests/reports/media-e2e.json` |
| Native deep links | `adb shell am start -W -a android.intent.action.VIEW -d "nascon://entity/match-m1"` · `nascon://stream/cs-session-101` |

## Demo accounts (password `Nascon@26` for all)
| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (league-alpha-1) | organizer@nascon.test |
| Club Manager (club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Tests
```bash
./run_tests.sh                      # unit tests in Docker; rewrites COVERAGE.json and COVERAGE_DAY2.json
python3 tests/contract_probes.py    # live /audit/v1 contract probes (stack up, same DAY2_SALT in the env)
./tests/run_selenium.sh             # Grid suite, pytest -n 3 → tests/reports/selenium-report.xml
QA_PYTHON=~/venv/bin/python ./tests/run_selenium.sh   # same, from a host venv instead of the QA image
docker run --rm --user "$(id -u):$(id -g)" --network host -v "$PWD/tests":/tests grafana/k6:0.54.0 run \
  --summary-export=/tests/reports/k6-summary.json /tests/k6_load.js
```
Appium (phone on USB with debugging on, League Ops APK installed, app Server set to `http://localhost:8080`):
```bash
./tests/run_appium.sh    # adb reverse 8080/8888/8889, starts Appium on 4723 if needed → tests/reports/appium-report.xml
```
CI: `.github/workflows/autograde.yml` runs compose, the contract probes, the Grid check, Selenium, k6 and the unit
tests on every push to `main`, with fresh salts per run.

## Phase II verification (local runs, Oct 18)
| Check | Result |
|---|---|
| Cold `docker compose up -d --build` | `/health` 200 in 6 s; Grid ready with 3 nodes in 8 s |
| `tests/contract_probes.py` (all `/audit/v1` contracts + DAY2 signatures) | 0 failures |
| Unit tests `./run_tests.sh` | 64 / 64 pass · `COVERAGE_DAY2.json` all ≥ 97 % |
| Selenium Grid (`pytest -n 3`, Chrome + Firefox) | 8 / 8 pass → `tests/reports/selenium-report.xml` |
| k6 exact profile (500 + 50 VUs, 15 s) | 0 % failures over 69,370 requests, p95 22 ms → `tests/reports/k6-summary.json` |
| Media e2e (`tests/media_e2e.sh`) | HLS 200 · revoke cuts ingest in 0.15 s · VOD indexed 2.8 s after the stream ends → `tests/reports/media-e2e.json` |
| Co-stream host drop over WebSocket | next participant hosts; guest page shows the new host 0.86 s after the drop |

## Architecture
- `backend/src/domain/` — fixtures, scoring (event sourcing), standings, roster, store, RBAC, offline sync
- `backend/src/routes/audit.js` — autograder contract `/audit/v1/*`; `routes/api.js` — app routes `/api/v1/*` (JWT, rate limited)
- Decisions: [ADR.md](ADR.md) · Requirement mapping: [TRACEABILITY.md](TRACEABILITY.md)
- `backend/src/web.js` + `backend/src/web/` — server-rendered Guest Web Player; `realtime.js` — WebSocket + SSE bus
- MinIO runs from `bitnamilegacy/minio` because `minio/minio` is no longer on Docker Hub (ADR-9); receipts stay in Postgres.

## Mobile
Expo / React Native app in `mobile/`. Latest APK: GitHub Releases (published by `.github/workflows/attach-apk.yml`
from the EAS URL in `mobile/release/apk-url.txt`); the Day 1 build is still at `mobile/release/app-release.apk`.
Set the server address in the app's Settings screen (phone: `http://<laptop-LAN-IP>:8080`).
Guests can watch live matches, scan QR codes and open `nascon://` links without signing in; chat, follow and
checkout ask for sign-in. Athletes get a Go Live screen (key for OBS / Larix, or "Broadcast from this phone" over WHIP —
the camera needs a secure origin, so use USB + `adb reverse` or HTTPS), replays of their recorded streams, and
co-stream host controls (invite, mute, spotlight, remove). Build: `cd mobile && EAS_NO_VCS=1 eas build -p android --profile preview` (the root
`.easignore` keeps the upload to the app only).
