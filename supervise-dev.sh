#!/bin/bash
# Robust dev server supervisor — restarts next dev if it dies
cd /home/z/my-project
trap '' SIGTERM SIGINT SIGHUP
while true; do
  echo "[$(date)] Starting next dev..." >> /home/z/my-project/dev-restart.log
  NODE_OPTIONS="--max-old-space-size=3072" npx next dev -p 3000 > /home/z/my-project/dev.log 2>&1
  EXIT=$?
  echo "[$(date)] next dev exited (code $EXIT), restarting in 3s..." >> /home/z/my-project/dev-restart.log
  sleep 3
done
