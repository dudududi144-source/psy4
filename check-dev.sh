#!/bin/bash
if ! pgrep -f "next dev" > /dev/null 2>&1; then
  cd /home/z/my-project
  NODE_OPTIONS="--max-old-space-size=3072" nohup npx next dev -p 3000 > dev.log 2>&1 &
  echo "[$(date)] Started next dev" >> /home/z/my-project/dev-restart.log
fi
