#!/bin/bash
cd /home/amit/projects/agentgate

clear
echo "🚀 AgentGate - Human-in-the-Loop for AI Agents"
echo ""
sleep 1

echo "▶ Step 1: AI agent requests approval"
echo "────────────────────────────────────"
sleep 1
node packages/cli/dist/cli.js request "deploy:production" --params '{"version":"2.1.0"}' --urgency high
echo ""
sleep 2

echo "▶ Step 2: List pending requests"
echo "────────────────────────────────────"
sleep 1
node packages/cli/dist/cli.js list --status pending
echo ""
sleep 2

echo "▶ Step 3: Human approves"
echo "────────────────────────────────────"
sleep 1
REQ_ID=$(node packages/cli/dist/cli.js list --status pending --json 2>/dev/null | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
node packages/cli/dist/cli.js approve "$REQ_ID" --reason "Reviewed and approved"
echo ""
sleep 2

echo "✅ Agent can proceed with deployment!"
sleep 1
