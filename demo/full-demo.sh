#!/bin/bash
cd /home/amit/projects/agentgate

# Start server in background
ADMIN_API_KEY=demo-key-12345678 corepack pnpm --filter @agentgate/server dev > /tmp/ag-server.log 2>&1 &
SERVER_PID=$!

# Wait for server
for i in {1..20}; do
  curl -s http://localhost:3000/health > /dev/null 2>&1 && break
  sleep 0.5
done

clear
echo "🚀 AgentGate - Human-in-the-Loop for AI Agents"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
sleep 1

echo "▶ Step 1: AI agent requests deployment approval"
echo ""
sleep 1
node packages/cli/dist/cli.js request "deploy:production" \
  --params '{"version":"2.1.0","service":"api"}' \
  --urgency high
echo ""
sleep 2

echo "▶ Step 2: View pending approvals"
echo ""
sleep 1
node packages/cli/dist/cli.js list --status pending
echo ""
sleep 2

echo "▶ Step 3: Human reviews and approves"
echo ""
sleep 1
REQ_ID=$(node packages/cli/dist/cli.js list --status pending --json 2>/dev/null | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$REQ_ID" ]; then
  node packages/cli/dist/cli.js approve "$REQ_ID" --reason "LGTM - approved for production"
fi
echo ""
sleep 2

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Agent can now proceed with deployment!"
echo ""
sleep 1

# Cleanup
kill $SERVER_PID 2>/dev/null
