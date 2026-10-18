"""Backend contract probes (Phase I baseline + Phase II /audit/v1/*), stdlib only. Exits non-zero on any failure."""
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("API_BASE", "http://localhost:8080")
SALT2 = os.environ.get("DAY2_SALT", "")
failures = []


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign2(entity_id, payload):
    return hmac.new(SALT2.encode(), (entity_id + "|" + canonical(payload)).encode(), hashlib.sha256).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def call(method, path, body=None, token=None, raw=False):
    headers = {"Content-Type": "application/json", "User-Agent": "contract-probe"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        res = opener.open(req, timeout=15)
        status, hdrs, data = res.status, res.headers, res.read()
    except urllib.error.HTTPError as e:
        status, hdrs, data = e.code, e.headers, e.read()
    if raw:
        return status, hdrs, data
    return status, json.loads(data) if data else None


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


s, r = call("POST", "/audit/v1/reset", {})
check("reset 200 + Day 1 baseline", s == 200 and r["status"] == "reset_complete" and r["tenants"] == ["tenant-alpha", "tenant-beta"])
check("health ok", call("GET", "/health") == (200, {"status": "ok"}))

s, sc = call("GET", "/audit/v1/score/match-m1")
check("match-m1 seeded in_progress 1 - 0", s == 200 and sc["status"] == "in_progress" and (sc["home"]["score"], sc["away"]["score"]) == (1, 0))

s, k = call("POST", "/audit/v1/stream/key", {"action": "rotate", "player_id": "player-alpha-1", "label": "OBS-Main-Desk",
                                              "stream_key_override": "sk_live_9f83a1b2c3d4e5f6"})
check("stream key rotate 200 + signature", s == 200 and k["stream_key"] == "sk_live_9f83a1b2c3d4e5f6" and k["signature"] == sign2(
    "sk_live_9f83a1b2c3d4e5f6", {"action": "rotate", "player_id": "player-alpha-1", "status": "active", "stream_key": "sk_live_9f83a1b2c3d4e5f6"}))
s, v = call("POST", "/audit/v1/stream/key", {"action": "revoke", "player_id": "player-alpha-1"})
check("stream key revoke nulls endpoints", s == 200 and v["status"] == "revoked" and v["ingest_endpoints"] is None and v["playback_url"] is None)

s, c = call("POST", "/audit/v1/costream/session", {"session_id": "cs-session-101", "host_player_id": "player-alpha-1",
             "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"], "layout": "grid_4", "simulate_host_drop": True})
check("costream host-drop handoff", s == 201 and c["active_host"] == "player-alpha-2" and c["participant_count"] == 3 and c["handoff_occurred"] is True
      and c["signature"] == sign2("cs-session-101", {"active_host": "player-alpha-2", "handoff_occurred": True, "layout": "grid_4",
                                                     "participant_count": 3, "session_id": "cs-session-101", "status": "active"}))

s, q = call("GET", "/audit/v1/qr/match-m1?inspect=true")
check("qr match-m1 live route + signature", s == 200 and q["target_route"] == "/web/matches/match-m1/live" and q["short_url"].endswith("/q/m1-live")
      and q["signature"] == sign2("match-m1", {"entity_id": "match-m1", "short_url": q["short_url"], "target_route": q["target_route"]}))
s, h, _ = call("GET", "/q/m1-live", raw=True)
check("short link 302 -> live route", s == 302 and h.get("Location") == "/web/matches/match-m1/live")
for fmt, ctype, magic in [("svg", "image/svg+xml", b"<svg"), ("png", "image/png", b"\x89PNG\r\n\x1a\n"), ("pdf", "application/pdf", b"%PDF-")]:
    s, h, body = call("GET", f"/audit/v1/qr/match-m1/export.{fmt}", raw=True)
    check(f"qr export {fmt}", s == 200 and h.get("Content-Type", "").startswith(ctype) and body.startswith(magic))

for path in ["/api/v1/chat", "/audit/v1/checkout", "/audit/v1/events"]:
    s, e = call("POST", path, {}, token="guest_anon_tok_7721")
    check(f"guest write blocked {path}", s == 403 and e["error"]["code"] == "GUEST_WRITE_FORBIDDEN")

s, m = call("POST", "/audit/v1/guest/cart-merge", {"guest_token": "guest_anon_tok_7721", "registered_user_id": "player-alpha-1",
             "guest_cart": [{"variant_id": "var-jersey-001-L", "quantity": 1}], "test_write_block": True})
check("cart merge spec example", s == 200 and m["write_rejection_code"] == 403 and m["active_cart"]["total_items"] == 1)
s, m2 = call("POST", "/audit/v1/guest/cart-merge", {"guest_token": "guest_anon_tok_7721", "registered_user_id": "player-alpha-1",
              "guest_cart": [{"variant_id": "var-jersey-001-L", "quantity": 1}], "test_write_block": True})
check("cart merge replay is idempotent", s == 200 and m2["active_cart"]["total_items"] == 1)

s, mod = call("POST", "/audit/v1/moderation/test", {"chat_room_id": "chat-cs-session-101", "check_dlq": True, "simulate_failed_notifications": 0,
              "incoming_messages": [{"message_id": "msg-1", "sender": "user-guest-1", "text": "Clean sports commentary"},
                                    {"message_id": "msg-2", "sender": "user-spammer", "text": "Watch this illegal stream b@d_w0rd now!"},
                                    {"message_id": "msg-3", "sender": "user-flooder", "text": "GOAL! AAAA!!!"}]})
check("moderation spec example", s == 200 and [x["text"] for x in mod["filtered_messages"]] == ["Clean sports commentary", "Watch this illegal stream *** now!"]
      and mod["kicked_users"] == ["user-spammer"] and mod["muted_users"] == ["user-flooder"] and mod["dlq_status"]["queue_depth"] == 0)

s, h, body = call("GET", "/metrics", raw=True)
text = body.decode()
check("metrics exposition", s == 200 and h.get("Content-Type", "").startswith("text/plain") and all(
    f"\n{n} " in "\n" + text for n in ["nascon_active_ws_connections", "nascon_active_streams_total", "nascon_stream_bitrate_kbps",
                                       "nascon_dlq_depth", "nascon_qr_scans_total"]))
check("privacy erasure", call("DELETE", "/audit/v1/privacy/user/player-alpha-1") ==
      (200, {"user_id": "player-alpha-1", "status": "anonymized", "pii_retained": False, "tokens_wiped": True}))

s, mtx = call("POST", "/audit/v1/rbac-matrix")
check("rbac matrix tokens", s == 200 and len(mtx["tokens"]) == 5)
s, _ = call("GET", "/audit/v1/rbac/platform/config", token=mtx["tokens"]["viewer"])
check("rbac viewer denied platform config", s == 403)
s, _ = call("POST", "/audit/v1/reset", {})
print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
