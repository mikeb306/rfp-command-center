#!/bin/bash
# SSH tunnel to localhost.run — auto-reconnects
# Logs tunnel URL to ~/rfp-tunnel-url.txt for reference

while true; do
  echo "[$(date)] Starting tunnel..." >> /tmp/rfp-tunnel.log
  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 80:localhost:4310 nokey@localhost.run 2>&1 | tee -a /tmp/rfp-tunnel.log | \
      grep --line-buffered "tunneled with tls" | while read -r line; do
        URL=$(echo "$line" | grep -oE 'https://[^ ]+')
        if [ -n "$URL" ]; then
          echo "$URL" > ~/rfp-tunnel-url.txt
          echo "[$(date)] Tunnel URL: $URL" >> /tmp/rfp-tunnel.log
        fi
      done
  echo "[$(date)] Tunnel disconnected, reconnecting in 5s..." >> /tmp/rfp-tunnel.log
  sleep 5
done
