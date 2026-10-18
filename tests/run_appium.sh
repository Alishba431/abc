#!/usr/bin/env bash
# Runs the Appium 2 deep-link suite against a phone on USB and writes tests/reports/appium-report.xml.
# Needs: the stack up, the League Ops APK installed, USB debugging on, Appium 2 + uiautomator2 installed.
# Over USB the app reaches this laptop through `adb reverse`, so set its Server to http://localhost:8080.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${QA_PYTHON:-python3}"
adb get-state >/dev/null 2>&1 || { echo "No Android device: plug the phone in and accept USB debugging."; exit 1; }
for port in 8080 8888 8889; do adb reverse "tcp:$port" "tcp:$port" >/dev/null; done
if ! curl -fs http://localhost:4723/status >/dev/null; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}" ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
  mkdir -p "$ANDROID_HOME/platform-tools"
  [ -e "$ANDROID_HOME/platform-tools/adb" ] || ln -s "$(command -v adb)" "$ANDROID_HOME/platform-tools/adb"
  nohup appium --port 4723 >/tmp/appium.log 2>&1 &
  for _ in $(seq 1 30); do curl -fs http://localhost:4723/status >/dev/null && break; sleep 1; done
fi
mkdir -p tests/reports
"$PY" -m pytest tests/appium -v -p no:cacheprovider --junitxml=tests/reports/appium-report.xml
