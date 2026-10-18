# League Ops — Part II (Day 2) Build Plan

Hard rules: build on `DAY1_BASE_SHA = 3eeb512` (no rebase/force-push) · one pushed commit in **each** window:
W1 10:15–11:30 · W2 11:30–12:45 · W3 12:45–13:45 · W4 13:45–14:00 (grace **14:05:00**) · nothing after 14:05.
Marks: **80% backend + QA infrastructure**, 20% frontend (guest web + mobile). Backend contract first.

Implement the visible contract literally: signature separator `|`, Selenium hub on **4444**, all 9 `data-testid`s,
HTTP 201/200 as specified, honour `stream_key_override`, `DAY2_SALT` read from env only.

## Window 1 — until 11:30 (push by 11:20)
Infra (docker-compose.yml)
- [x] `minio` → `bitnamilegacy/minio:2024.9.22` (`minio/minio` no longer exists on Docker Hub)
- [x] `mediamtx` → `bluenviron/mediamtx:1.9.1` on 1935 (RTMP) / 8888 (HLS) / 8889 (WebRTC), API enabled internally
- [x] Selenium Grid 4: hub (4444/4442/4443) + node-chrome ×2 + node-firefox, `shm_size: "1gb"`, `SE_START_VNC=false`
      (use pre-pulled 4.24.0), api reachable as `http://backend:8080` (network alias)
- [x] forward `DAY1_SALT` and `DAY2_SALT`; `/health` checks DB + Redis + media server + seed
Backend
- [x] DAY2 signer (same canonical JSON, key = `DAY2_SALT`) + Appendix A vector test
- [x] `/reset` Day 2 seed: `player-beta-2`, `match-m1` (in_progress 1-0), QR maps (`m1-live`, `p-alpha-1`, `c-alpha-1`),
      `guest_anon_tok_7721`, empty cart for `player-alpha-1`
- [x] `POST /audit/v1/stream/key` (generate / rotate / revoke, override, 404 STREAM_NOT_FOUND, KEY_REVOKED)
- [x] `POST /audit/v1/costream/session` (exact validation order, host-drop handoff, idempotent replay)
- [x] `GET /metrics` (5 Prometheus metrics, `text/plain; version=0.0.4`)

## Window 2 — 11:30–12:45 (push ~12:05 and ~12:40)
- [x] QR engine: `GET /audit/v1/qr/{id}` (+`?inspect=true`), state-driven `target_route`, DAY2 signature, scan telemetry
      (count, mobile/desktop, UTC bucket, **no IP / UA stored**), `GET /q/{code}` → 302, exports `.svg` / `.png` / `.pdf`
- [x] Match states postponed / cancelled / abandoned (needed for QR notice routes)
- [x] Guest boundary: issue `guest_anon_tok_*`; any write with a guest token → **403 GUEST_WRITE_FORBIDDEN**
      (`/api/v1/chat`, `/audit/v1/checkout`, `/audit/v1/events`, roster, follow); guest cart staging allowed
- [x] `POST /audit/v1/guest/cart-merge` (validation order, stock 409, idempotent replay, GUEST_TOKEN_ALREADY_MERGED)
- [x] Moderation: leetspeak normalisation + dictionary masking `***`, flood drop → muted, kick dedupe under 10 parallel
      calls, DLQ with 3 bounded retries; `POST /audit/v1/moderation/test`; member chat `POST /api/v1/chat`
- [x] Realtime: `ws://…/ws/matches/{id}` per-match push with score (p95 < 500 ms) + SSE `/api/v1/matches/{id}/stream`
- [x] `DELETE /audit/v1/privacy/user/{id}`
- [x] Unit tests per Phase II module → `COVERAGE_DAY2.json` (streaming, costream, qr_guest, moderation_dlq, observability ≥ 85%)

## Window 3 — 12:45–13:45 (push ~13:30)
- [x] Guest Web Player `/web/*` (live / preview / vod / notice / players / clubs / costream) with all 9 `data-testid`s,
      live score via WebSocket, guest cart, blocked chat → progressive auth modal → login → cart merge → back to timestamp,
      WCAG 2.1 AA (contrast, keyboard, ARIA, 48 px targets)
- [x] `tests/selenium/test_guest_grid.py` (3 spec tests + WCAG DOM test, `pytest -n 3`, JUnit → `tests/reports/selenium-report.xml`)
- [x] `tests/k6_load.js` (exact profile) → `tests/reports/k6-summary.json`; QR state cached in memory for 550 VUs (local: 0% errors over 69,370 requests, p95 22.2 ms)
- [x] `.github/workflows/autograde.yml` (compose up, contract probes, grid ≥ 3 nodes, Selenium, k6, unit tests)
- [x] Mobile: `nascon://` scheme + deep links (entity/match, stream/cs-session) opening screens **without login wall**,
      QR scanner, co-stream view + chat, Go-Live screen (stream key / RTMP for OBS·Larix), live notifications
- [x] `tests/appium/test_mobile_deeplink.py` (written) → `tests/reports/appium-report.xml` (needs the phone on adb); EAS builds started 12:31 / 12:39
- [x] FR-3.3 host controls: signed invites, join, mute, spotlight, kick (`/api/v1/costream/{id}/control|join`) + app UI
- [x] `tests/media_e2e.sh`: RTMP ingest → HLS 200 → metrics → revoke cuts ingest in 0.15 s → `tests/reports/media-e2e.json`

## Window 4 — 13:45–14:00 (final push by 13:58)
- [ ] All reports committed, TRACEABILITY.md Phase II rows, ADR additions, APK attached via Actions, final push

## Stretch (only if ahead)
~~MediaMTX auth hook so revoking a key cuts live ingest < 2 s~~ (done) · recording → MinIO + VOD index · ~~follow/unfollow +
athlete profile~~ (done) · real 4-way composite via FFmpeg

## Questions for organizers (in writing, early)
1. Which event moves a match to postponed / cancelled / abandoned?
2. Moderation `flagged_count`: profanity-flagged only, or also flood-dropped messages?
3. What exactly should return `409 KEY_REVOKED` through the API?
4. `minio/minio` is gone from Docker Hub — is `bitnamilegacy/minio` acceptable? Selenium 4.24.0 vs 4.25.0 OK?
