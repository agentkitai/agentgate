#!/bin/bash
# AgentGate Demo Recording Script
# Run: asciinema rec --command="bash demo/record-demo.sh" /tmp/agentgate-demo.cast

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

type_slow() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    echo -n "${text:$i:1}"
    sleep 0.03
  done
  echo
}

pause() { sleep "${1:-1.5}"; }

clear
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🛡️  AgentGate — Human-in-the-loop for AI Agents${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
pause 2

echo
echo -e "${GREEN}# 1. Install and start AgentGate${NC}"
pause
type_slow "npx @agentgate/cli init"
pause 2

echo
echo -e "${GREEN}# 2. An AI agent requests approval to send an email${NC}"
pause
type_slow 'curl -s -X POST http://localhost:3000/api/requests \'
type_slow '  -H "Authorization: Bearer agk_demo_key" \'
type_slow '  -H "Content-Type: application/json" \'
type_slow '  -d '\''{"action":"send_email","params":{"to":"customer@example.com","subject":"Invoice #1234"},"urgency":"high"}'\'''
pause
echo
echo -e "${YELLOW}{\"id\":\"req_abc123\",\"status\":\"pending\",\"action\":\"send_email\",\"urgency\":\"high\"}${NC}"
pause 2

echo
echo -e "${GREEN}# 3. Policy engine evaluates → routes to human${NC}"
echo -e "   📋 Policy: 'send_email' with urgency=high → require human approval"
echo -e "   📨 Notification sent to Slack #approvals channel"
pause 2

echo
echo -e "${GREEN}# 4. Human approves via dashboard/Slack/Discord${NC}"
pause
type_slow 'curl -s -X POST http://localhost:3000/api/requests/req_abc123/decide \'
type_slow '  -H "Authorization: Bearer agk_admin_key" \'
type_slow '  -d '\''{"decision":"approved","reason":"Looks good, send it"}'\'''
pause
echo
echo -e "${YELLOW}{\"id\":\"req_abc123\",\"status\":\"approved\",\"decidedBy\":\"admin\",\"reason\":\"Looks good, send it\"}${NC}"
pause 2

echo
echo -e "${GREEN}# 5. Agent gets the green light and executes${NC}"
echo -e "   ✅ Email sent to customer@example.com"
echo -e "   📝 Full audit trail logged"
pause 2

echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Agents request. Policies decide. Humans approve.${NC}"
echo -e "${BLUE}  → github.com/amitpaz1/agentgate${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
pause 3
