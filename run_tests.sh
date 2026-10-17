#!/usr/bin/env bash
# Runs the backend unit/integration tests inside Docker against throwaway databases,
# prints coverage per area and rewrites COVERAGE.json with the measured figures.
set -euo pipefail
cd "$(dirname "$0")"
export DAY1_SALT="${DAY1_SALT:-test-salt}"
docker compose up -d postgres >/dev/null
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q postgres)")"
for i in $(seq 1 30); do docker compose exec -T postgres pg_isready -U nascon >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network "$NET" -v "$PWD":/work -w /work/backend node:20-alpine sh -c '
  [ -d node_modules ] || npm ci --omit=dev --silent
  cd /work && NODE_PATH=/work/backend/node_modules node --test --experimental-test-coverage --test-reporter=spec --test-reporter-destination=stdout tests/ 2>&1 | tee /tmp/out.txt
  node tests/coverage.js /tmp/out.txt
'
