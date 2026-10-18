#!/usr/bin/env bash
# Runs the Selenium Grid suite (needs the stack up) and writes tests/reports/selenium-report.xml.
# Default: inside python:3.12-slim (league-ops-qa image) on the compose network.
# QA_PYTHON=/path/to/python runs it from the host instead (Grid on localhost:4444; the browsers still reach the
# app as http://backend:8080 through the compose network alias).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/reports
ARGS=(-n 3 tests/selenium/ -v -p no:cacheprovider --junitxml=tests/reports/selenium-report.xml)
if [ -n "${QA_PYTHON:-}" ]; then
  GRID_URL=http://localhost:4444 WEB_BASE=http://backend:8080 API_BASE=http://localhost:8080 \
    exec "$QA_PYTHON" -m pytest "${ARGS[@]}"
fi
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' nascon-selenium-hub)"
docker build -q -t league-ops-qa -f tests/Dockerfile.qa tests >/dev/null
docker run --rm --network "$NET" -v "$PWD":/work -w /work \
  -e GRID_URL=http://selenium-hub:4444 -e WEB_BASE=http://backend:8080 -e API_BASE=http://backend:8080 \
  league-ops-qa pytest "${ARGS[@]}"
