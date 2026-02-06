#!/bin/bash
set -e
cd /home/amit/projects/agentgate

# Start server
echo "Starting server..."
ADMIN_API_KEY=demo-key-12345678 corepack pnpm --filter @agentgate/server dev &
SERVER_PID=$!

# Start dashboard
echo "Starting dashboard..."
VITE_API_URL=http://localhost:3000 corepack pnpm --filter @agentgate/dashboard dev --port 5173 &
DASH_PID=$!

# Wait for services
echo "Waiting for services..."
for i in {1..30}; do
  if curl -s http://localhost:3000/health > /dev/null 2>&1 && \
     curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "Services ready!"
    break
  fi
  sleep 1
done

# Run capture
echo "Running capture..."
cd /home/amit/projects/agentgate/demo/video
node capture-demo.mjs

# Cleanup
echo "Cleaning up..."
kill $SERVER_PID $DASH_PID 2>/dev/null || true
wait

echo "Done!"
