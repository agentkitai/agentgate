# Email Integration

Send approval request notifications via email using SMTP.

## Features

- 📧 HTML-formatted approval emails
- 🔗 Direct links to approve/deny in dashboard
- 📬 Configurable SMTP settings
- 🎯 Route by urgency or action type

## Configuration

Configure SMTP settings via environment variables:

```bash
# SMTP Server
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASS=your-password

# Sender
SMTP_FROM=agentgate@yourcompany.com
```

### Common SMTP Providers

::: code-group
```bash [Gmail]
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Use app password, not regular password
```

```bash [SendGrid]
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

```bash [AWS SES]
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-ses-smtp-user
SMTP_PASS=your-ses-smtp-password
```

```bash [Mailgun]
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@your-domain.mailgun.org
SMTP_PASS=your-mailgun-password
```
:::

## Channel Routing

Route requests to email addresses:

```bash
export CHANNEL_ROUTES='[
  {
    "channel": "email",
    "target": "approvals@company.com",
    "enabled": true
  },
  {
    "channel": "email",
    "target": "security@company.com",
    "actions": ["delete_account", "transfer_funds"],
    "urgencies": ["high", "critical"],
    "enabled": true
  },
  {
    "channel": "email",
    "target": "cto@company.com",
    "urgencies": ["critical"],
    "enabled": true
  }
]'
```

## Email Format

Emails are sent with HTML formatting:

```
Subject: [AgentGate] Approval Required: send_email (High Priority)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 Approval Request

Action: send_email
Urgency: 🟠 High
Request ID: req_abc123
Created: January 15, 2024 at 10:30 AM

Parameters:
┌────────────────────────────────────────────┐
│ {                                          │
│   "to": "customer@example.com",            │
│   "subject": "Important Update"            │
│ }                                          │
└────────────────────────────────────────────┘

Context:
Agent: email-automation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[View in Dashboard] [Approve] [Deny]
```

## Direct Action Links

Emails include tokenized links for one-click actions:

- **Approve**: `https://your-server/api/requests/{id}/decide?token=...&decision=approved`
- **Deny**: `https://your-server/api/requests/{id}/decide?token=...&decision=denied`

These tokens are single-use and expire with the request.

::: warning Security Note
Email action links should only be used over HTTPS in production. The tokens prevent unauthorized access but are transmitted in the email.
:::

## Testing

Test your SMTP configuration:

```bash
# Using the CLI
agentgate test-email \
  --to test@example.com \
  --subject "Test Email"

# Or send a test request and check email
agentgate request test_action --urgency high
```

## Troubleshooting

### Emails not sending

1. Verify SMTP credentials are correct
2. Check if your SMTP provider requires app-specific passwords
3. Ensure outbound port (usually 587) is not blocked
4. Check server logs for SMTP errors

### Emails going to spam

1. Set up SPF/DKIM records for your domain
2. Use a reputable SMTP provider
3. Ensure `SMTP_FROM` matches your domain

### Gmail-specific issues

- Enable "Less secure app access" or use App Passwords
- Use `smtp.gmail.com` port `587` with TLS
