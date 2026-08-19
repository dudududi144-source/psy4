#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "next dev" > /dev/null 2>&1; then
    echo "[$(date)] next dev not running, starting..." >> /home/z/my-project/dev-restart.log
    NODE_OPTIONS="--max-old-space-size=3072" npx next dev -p 3000 > /home/z/my-project/dev.log 2>&1 &
    NEXT_PID=$!
    echo "[$(date)] Started next dev (PID $NEXT_PID)" >> /home/z/my-project/dev-restart.log
    wait $NEXT_PID
    echo "[$(date)] next dev exited (code $?), restarting in 3s..." >> /home/z/my-project/dev-restart.log
  else
    sleep 5
  fi
  sleep 3
done
