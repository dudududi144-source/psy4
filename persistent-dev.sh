#!/bin/bash
cd /home/z/my-project
# Trap signals to prevent death
trap '' SIGTERM SIGINT SIGHUP
while true; do
  NODE_OPTIONS="--max-old-space-size=3072" npx next dev -p 3000 > /home/z/my-project/dev.log 2>&1
  echo "[$(date)] next dev exited, restarting in 2s..." >> /home/z/my-project/dev-restart.log
  sleep 2
done
