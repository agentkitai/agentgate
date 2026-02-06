#!/bin/bash
export AGENTGATE_URL=http://localhost:3000
export AGENTGATE_API_KEY="agk_7xeX0DWKR3qqLylACoPheccLc2Yb1qgFZYOlOSSibPY"
cd /home/amit/projects/agentgate

clear
echo "🚀 AgentGate - Approval Workflows for AI Agents"
echo ""
sleep 1

echo "Step 1: Agent requests deployment approval"
echo '─────────────────────────────────────────────'
node packages/cli/dist/cli.js request "deploy:production" \
  --params '{"version":"2.1.0"}' --urgency high --json 2>&1
echo ""
sleep 2

echo "Step 2: List pending requests"  
echo '─────────────────────────────────────────────'
node packages/cli/dist/cli.js list --status pending 2>&1
echo ""
sleep 2

echo "Step 3: Approve (using request ID from above)"
echo '─────────────────────────────────────────────'
REQ_ID=$(node packages/cli/dist/cli.js list --status pending --json 2>&1 | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$REQ_ID" ]; then
  node packages/cli/dist/cli.js approve "$REQ_ID" --reason "LGTM" 2>&1
fi
echo ""
sleep 1

echo "✅ Agent can now proceed!"
