#!/usr/bin/env bash
# FR-3.2 end to end against the live stack (needs ffmpeg): signed stream key -> RTMP ingest into MediaMTX -> HLS
# playback -> /metrics -> revoke cuts the live publisher (< 2 s) -> the revoked key can no longer publish.
# Writes tests/reports/media-e2e.json.
set -euo pipefail
cd "$(dirname "$0")/.."
API="${API_BASE:-http://localhost:8080}"
HLS="${HLS_BASE:-http://localhost:8888}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill "${FF:-0}" 2>/dev/null || true' EXIT
mkdir -p tests/reports
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
key_req() { curl -s -X POST "$API/audit/v1/stream/key" -H 'Content-Type: application/json' -d "$1"; }

KEY_JSON="$(key_req '{"action":"generate","player_id":"player-alpha-1","label":"media-e2e"}')"
KEY="$(echo "$KEY_JSON" | json "d['stream_key']")"
RTMP="$(echo "$KEY_JSON" | json "d['ingest_endpoints']['rtmp']")"

( ffmpeg -hide_banner -loglevel error -re -f lavfi -i testsrc=size=640x360:rate=25 -f lavfi -i sine=frequency=440 \
    -c:v libx264 -preset ultrafast -tune zerolatency -g 25 -c:a aac -f flv "$RTMP" >"$TMP/ff.log" 2>&1 || true
  date +%s.%N >"$TMP/ff.exit" ) &
FF=$!

HLS_STATUS=000
for _ in $(seq 1 30); do
  HLS_STATUS="$(curl -s -o "$TMP/index.m3u8" -w '%{http_code}' "$HLS/live/$KEY/index.m3u8" || true)"
  [ "$HLS_STATUS" = 200 ] && grep -q '#EXTM3U' "$TMP/index.m3u8" && break
  sleep 0.5
done
sleep 2.5
METRICS="$(curl -s "$API/metrics")"
STREAMS="$(echo "$METRICS" | awk '/^nascon_active_streams_total/ {print $2}')"
KBPS="$(echo "$METRICS" | awk '/^nascon_stream_bitrate_kbps/ {print $2}')"

T0="$(date +%s.%N)"
REVOKE_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/audit/v1/stream/key" -H 'Content-Type: application/json' \
  -d "{\"action\":\"revoke\",\"player_id\":\"player-alpha-1\",\"stream_key_override\":\"$KEY\"}")"
for _ in $(seq 1 50); do [ -f "$TMP/ff.exit" ] && break; sleep 0.1; done
CUT="$(python3 -c "import os; p='$TMP/ff.exit'; print(round(float(open(p).read()) - $T0, 3) if os.path.exists(p) else None)")"

REPUBLISH_REFUSED=false
timeout 8 ffmpeg -hide_banner -loglevel error -re -f lavfi -i testsrc=size=320x240:rate=15 -t 4 -c:v libx264 \
  -preset ultrafast -f flv "$RTMP" >"$TMP/again.log" 2>&1 || REPUBLISH_REFUSED=true

python3 - "$HLS_STATUS" "$STREAMS" "$KBPS" "$REVOKE_STATUS" "$CUT" "$REPUBLISH_REFUSED" <<'EOF' | tee tests/reports/media-e2e.json
import json, sys
hls, streams, kbps, revoke, cut, refused = sys.argv[1:]
r = {"hls_manifest_status": int(hls), "active_streams_while_live": int(float(streams or 0)),
     "bitrate_kbps_while_live": float(kbps or 0), "revoke_status": int(revoke),
     "ingest_cut_seconds": None if cut == "None" else float(cut), "revoked_key_republish_refused": refused == "true"}
r["pass"] = (r["hls_manifest_status"] == 200 and r["active_streams_while_live"] >= 1 and r["revoke_status"] == 200
             and r["ingest_cut_seconds"] is not None and r["ingest_cut_seconds"] < 2.0 and r["revoked_key_republish_refused"])
print(json.dumps(r, indent=2))
sys.exit(0 if r["pass"] else 1)
EOF
