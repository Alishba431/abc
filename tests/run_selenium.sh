#!/usr/bin/env bash
# Runs the Selenium Grid suite inside python:3.12-slim on the compose network (needs the stack up).
# Writes tests/reports/selenium-report.xml.
set -euo pipefail
cd "$(dirname "$0")/.."
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' nascon-selenium-hub)"
mkdir -p tests/reports
docker build -q -t league-ops-qa -f tests/Dockerfile.qa tests >/dev/null
docker run --rm --network "$NET" -v "$PWD":/work -w /work \
  -e GRID_URL=http://selenium-hub:4444 -e WEB_BASE=http://backend:8080 -e API_BASE=http://backend:8080 \
  league-ops-qa pytest -n 3 tests/selenium/ -v -p no:cacheprovider --junitxml=tests/reports/selenium-report.xml
