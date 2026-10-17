# League Ops Platform — Multi-Sport League & Club Operations

## Run the backend
```bash
cp .env.example .env              # put your DAY1_SALT in .env (never commit it)
DAY1_SALT=<your-salt> docker compose up -d --build
curl http://localhost:8080/health  # {"status":"ok"}
```
Services: `api` (Node 20 + Express, port 8080), `worker` (Redis Streams consumer), `postgres` 16, `redis` 7.

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
./run_tests.sh
```

## Mobile
Expo / React Native app in `mobile/`; release build at `mobile/release/app-release.apk`.
Set the server address in the app's Settings screen (phone: `http://<laptop-LAN-IP>:8080`).
