#!/bin/bash
cd /home/z/my-project
while true; do
  echo "[$(date)] Starting next dev..."
  NODE_OPTIONS="--max-old-space-size=512" npx next dev -p 3000 > dev.log 2>&1
  echo "[$(date)] Server exited (code $?), restarting in 3s..." >> dev.log
  sleep 3
done
