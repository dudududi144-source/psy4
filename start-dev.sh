#!/bin/bash
cd /home/z/my-project
while true; do
  NODE_OPTIONS="--max-old-space-size=512" npx next dev -p 3000 > /home/z/my-project/dev.log 2>&1
  EXIT=$?
  echo "[$(date)] next dev exited ($EXIT), restarting in 2s" >> /home/z/my-project/dev-restart.log
  sleep 2
done
