#!/bin/sh
# Build the IrisSpeak iOS app and install + launch it on the default iPad.
# Default: "iPad" (iPad A16), UDID 8F63DE05-E758-5950-B3F5-BFAE233197A8, paired over USB on 2026-09-09; it
# also works over Wi-Fi once the iPad is on the same network (CoreDevice keeps the pairing).
# Usage: scripts/deploy_ipad.sh            -> default iPad
#        scripts/deploy_ipad.sh <UDID>     -> another device (see `xcrun devicectl list devices`)
#        scripts/deploy_ipad.sh --no-launch
set -e
DEFAULT_UDID=8F63DE05-E758-5950-B3F5-BFAE233197A8
UDID=$DEFAULT_UDID; LAUNCH=1
for a in "$@"; do case "$a" in --no-launch) LAUNCH=0;; *) UDID=$a;; esac; done
HERE="$(cd "$(dirname "$0")/.." && pwd)"; PROJ="$HERE/irisspeak/irisspeak.xcodeproj"
LOG="${TMPDIR:-/tmp}/irisspeak_ios_build.log"
STATE=$(xcrun devicectl list devices --json-output "${TMPDIR:-/tmp}/irisspeak_devices.json" >/dev/null 2>&1; /usr/bin/python3 -c "import json,sys; d=json.load(open('${TMPDIR:-/tmp}/irisspeak_devices.json')); print(next((x['connectionProperties'].get('tunnelState','') + ' via ' + x['connectionProperties'].get('transportType','') for x in d['result']['devices'] if x['identifier']=='$UDID'), 'not listed'))")
echo "device $UDID: ${STATE:-not listed}"
case "$STATE" in connected*) ;; *) echo "The iPad is not reachable (USB or same Wi-Fi network needed). Devices:"; xcrun devicectl list devices; exit 1;; esac
echo "building…"
xcodebuild -project "$PROJ" -scheme irisspeak -configuration Debug -destination "id=$UDID" \
  -derivedDataPath "$HERE/irisspeak/build/DerivedDevice" -allowProvisioningUpdates build > "$LOG" 2>&1 || { grep -E "error:|BUILD FAILED" "$LOG" | head -20; exit 1; }
APP="$HERE/irisspeak/build/DerivedDevice/Build/Products/Debug-iphoneos/irisspeak.app"
echo "installing…"
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | grep -iE "installed|error" || true
if [ "$LAUNCH" = 1 ]; then xcrun devicectl device process launch --device "$UDID" lomaridge.irisspeak 2>&1 | tail -1; fi
