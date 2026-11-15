#!/usr/bin/env bash
# Installs (or, with --remove, removes) the LaunchAgent that runs automerge.sh every two minutes.
set -euo pipefail

LABEL="com.540.lunar.automerge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/lunar-automerge.log"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/automerge.sh"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = --remove ]; then
  rm -f "$PLIST"
  echo "Fusión automática desinstalada."
  exit 0
fi

GH="$(command -v gh)" || { echo "Falta gh: brew install gh" >&2; exit 1; }
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$GH"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Fusión automática instalada: cada 2 minutos. Registro: $LOG"
