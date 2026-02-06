#!/bin/bash
# AgentGate CLI Demo

clear
echo "🚀 AgentGate Demo - Approval Workflows for AI Agents"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 2

echo ""
echo "📋 Step 1: AI agent requests approval for a production deployment"
sleep 1
echo ""
echo '$ agentgate request "deploy:production" \'
echo '    --params '\''{"version":"2.1.0","service":"api-server"}'\'' \'
echo '    --urgency high --json'
sleep 2

# Actually run the command
export AGENTGATE_URL=http://localhost:3000
export AGENTGATE_API_KEY="agk_7xeX0DWKR3qqLylACoPheccLc2Yb1qgFZYOlOSSibPY"
cd /home/amit/projects/agentgate
REQUEST_OUTPUT=$(node packages/cli/dist/cli.js request "deploy:production" \
  --params '{"version":"2.1.0","service":"api-server"}' \
  --urgency high --json 2>&1)
echo "$REQUEST_OUTPUT" | jq '.' 2>/dev/null || echo "$REQUEST_OUTPUT"
REQUEST_ID=$(echo "$REQUEST_OUTPUT" | jq -r '.id' 2>/dev/null)
sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Step 2: Check pending requests"
sleep 1
echo ""
echo '$ agentgate list --status pending'
sleep 1
node packages/cli/dist/cli.js list --status pending 2>&1
sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Step 3: Human approves the request"
sleep 1
echo ""
echo "$ agentgate approve $REQUEST_ID --reason \"Approved for release\""
sleep 1
node packages/cli/dist/cli.js approve "$REQUEST_ID" --reason "Approved for release" 2>&1
sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Done! The AI agent can now proceed with deployment."
echo ""
sleep 2
