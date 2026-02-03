/**
 * Email adapter tests with mocked SMTP
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventNames, type RequestCreatedEvent, type RequestDecidedEvent } from "@agentgate/core";
import { setConfig, resetConfig, type Config } from "../config.js";

// Mock nodemailer before importing the adapter
vi.mock("nodemailer", () => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: "mock-message-id" });
  const mockTransporter = { sendMail: mockSendMail };
  return {
    createTransport: vi.fn().mockReturnValue(mockTransporter),
    default: {
      createTransport: vi.fn().mockReturnValue(mockTransporter),
    },
  };
});

// Mock the decision tokens module
vi.mock("../lib/decision-tokens.js", () => ({
  generateDecisionTokens: vi.fn().mockResolvedValue({
    approve: {
      token: "mock-approve-token",
      url: "https://gate.example.com/api/decide/mock-approve-token",
    },
    deny: {
      token: "mock-deny-token",
      url: "https://gate.example.com/api/decide/mock-deny-token",
    },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    expiresInHours: 24,
  }),
}));

// Mock config for tests
const baseConfig: Config = {
  port: 3000,
  host: "0.0.0.0",
  nodeEnv: "test",
  dbDialect: "sqlite",
  databaseUrl: ":memory:",
  corsOrigins: "*",
  rateLimitRpm: 60,
  rateLimitEnabled: false,
  rateLimitBackend: "memory",
  decisionTokenExpiryHours: 24,
  requestTimeoutSec: 3600,
  webhookTimeoutMs: 5000,
  webhookMaxRetries: 3,
  channelRoutes: [],
  logLevel: "error",
  logFormat: "json",
};

const smtpConfig: Config = {
  ...baseConfig,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "user@example.com",
  smtpPass: "password",
  smtpFrom: "agentgate@example.com",
  decisionLinkBaseUrl: "https://gate.example.com",
  dashboardUrl: "https://dashboard.example.com",
};

describe("EmailAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetConfig();
  });

  describe("isConfigured", () => {
    it("should return false when SMTP is not configured", async () => {
      setConfig({ ...baseConfig });
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();
      expect(adapter.isConfigured()).toBe(false);
    });

    it("should return false when only SMTP_HOST is set", async () => {
      setConfig({ ...baseConfig, smtpHost: "smtp.example.com" });
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();
      expect(adapter.isConfigured()).toBe(false);
    });

    it("should return false when only SMTP_FROM is set", async () => {
      setConfig({ ...baseConfig, smtpFrom: "test@example.com" });
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();
      expect(adapter.isConfigured()).toBe(false);
    });

    it("should return true when SMTP_HOST and SMTP_FROM are set", async () => {
      setConfig({ ...smtpConfig });
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();
      expect(adapter.isConfigured()).toBe(true);
    });
  });

  describe("send", () => {
    it("should return error when SMTP is not configured", async () => {
      setConfig({ ...baseConfig });
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const result = await adapter.send("recipient@example.com", event);
      expect(result.success).toBe(false);
      expect(result.error).toContain("SMTP not configured");
    });

    it("should send email via nodemailer when configured", async () => {
      setConfig({ ...smtpConfig });
      const nodemailer = await import("nodemailer");
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: { to: "someone@example.com" },
          context: {},
          urgency: "high",
        },
      };

      const result = await adapter.send("recipient@example.com", event);

      expect(result.success).toBe(true);
      expect(result.channel).toBe("email");
      expect(result.target).toBe("recipient@example.com");
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: {
          user: "user@example.com",
          pass: "password",
        },
      });
    });

    it("should include decision links in response for request.created events", async () => {
      setConfig({ ...smtpConfig });
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const result = await adapter.send("recipient@example.com", event);

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      const response = result.response as { messageId: string; decisionLinks?: object };
      expect(response.decisionLinks).toBeDefined();
    });

    it("should call generateDecisionTokens for request.created events", async () => {
      setConfig({ ...smtpConfig });
      const { generateDecisionTokens } = await import("../lib/decision-tokens.js");
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_123",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      await adapter.send("recipient@example.com", event);

      expect(generateDecisionTokens).toHaveBeenCalledWith("req_123");
    });

    it("should not call generateDecisionTokens for request.decided events", async () => {
      setConfig({ ...smtpConfig });
      const { generateDecisionTokens } = await import("../lib/decision-tokens.js");
      vi.mocked(generateDecisionTokens).mockClear();
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();

      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          status: "approved",
          decidedBy: "admin",
          decidedByType: "human",
          decisionTimeMs: 5000,
        },
      };

      await adapter.send("recipient@example.com", event);

      expect(generateDecisionTokens).not.toHaveBeenCalled();
    });
  });
});

describe("Email formatting functions", () => {
  beforeEach(() => {
    setConfig({ ...smtpConfig });
  });

  afterEach(() => {
    resetConfig();
  });

  describe("formatEmailSubject", () => {
    it("should format request.created subject correctly", async () => {
      const { formatEmailSubject } = await import("../lib/notification/adapters/email.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "transfer_funds",
          params: {},
          context: {},
          urgency: "critical",
        },
      };

      const subject = formatEmailSubject(event);
      expect(subject).toContain("[AgentGate]");
      expect(subject).toContain("Approval required");
      expect(subject).toContain("transfer_funds");
    });

    it("should format request.decided subject with approved status", async () => {
      const { formatEmailSubject } = await import("../lib/notification/adapters/email.js");

      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          status: "approved",
          decidedBy: "user_1",
          decidedByType: "human",
          decisionTimeMs: 5000,
        },
      };

      const subject = formatEmailSubject(event);
      expect(subject).toContain("[AgentGate]");
      expect(subject).toContain("✅");
      expect(subject).toContain("approved");
    });

    it("should format request.decided subject with denied status", async () => {
      const { formatEmailSubject } = await import("../lib/notification/adapters/email.js");

      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "delete_account",
          status: "denied",
          decidedBy: "admin",
          decidedByType: "human",
          decisionTimeMs: 1000,
        },
      };

      const subject = formatEmailSubject(event);
      expect(subject).toContain("[AgentGate]");
      expect(subject).toContain("❌");
      expect(subject).toContain("denied");
    });
  });

  describe("formatEmailBody", () => {
    it("should include event details in plain text", async () => {
      const { formatEmailBody } = await import("../lib/notification/adapters/email.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test-agent",
        payload: {
          requestId: "req_123",
          action: "send_invoice",
          params: { amount: 100 },
          context: { customer: "acme" },
          urgency: "high",
        },
      };

      const body = formatEmailBody(event);
      expect(body).toContain("request.created");
      expect(body).toContain("test-agent");
      expect(body).toContain("send_invoice");
      expect(body).toContain("req_123");
    });

    it("should include decision links when provided", async () => {
      const { formatEmailBody } = await import("../lib/notification/adapters/email.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "test",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const links = {
        approveUrl: "https://example.com/approve/token123",
        denyUrl: "https://example.com/deny/token456",
        viewUrl: "https://dashboard.example.com/requests/req_1",
      };

      const body = formatEmailBody(event, links);
      expect(body).toContain("Quick Actions:");
      expect(body).toContain("https://example.com/approve/token123");
      expect(body).toContain("https://example.com/deny/token456");
      expect(body).toContain("View in Dashboard:");
      expect(body).toContain("https://dashboard.example.com/requests/req_1");
    });
  });

  describe("formatEmailHtml", () => {
    it("should build HTML with action buttons for request.created", async () => {
      const { formatEmailHtml } = await import("../lib/notification/adapters/email.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "delete_user",
          params: { userId: "user_123" },
          context: {},
          urgency: "critical",
        },
      };

      const links = {
        approveUrl: "https://example.com/approve/abc",
        denyUrl: "https://example.com/deny/xyz",
        viewUrl: "https://dashboard.example.com/requests/req_1",
      };

      const html = formatEmailHtml(event, links);

      // Check for critical elements
      expect(html).toContain("Approval Required");
      expect(html).toContain("delete_user");
      expect(html).toContain("critical");
      expect(html).toContain('href="https://example.com/approve/abc"');
      expect(html).toContain('href="https://example.com/deny/xyz"');
      expect(html).toContain("Approve");
      expect(html).toContain("Deny");
      expect(html).toContain("View in Dashboard");
      expect(html).toContain("userId");
    });

    it("should build HTML for request.decided approved", async () => {
      const { formatEmailHtml } = await import("../lib/notification/adapters/email.js");

      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          status: "approved",
          decidedBy: "alice",
          decidedByType: "human",
          decisionTimeMs: 2500,
        },
      };

      const html = formatEmailHtml(event);

      expect(html).toContain("Approved");
      expect(html).toContain("send_email");
      expect(html).toContain("alice");
      expect(html).toContain("human");
      expect(html).toContain("#22c55e"); // green color for approved
    });

    it("should build HTML for request.decided denied with reason", async () => {
      const { formatEmailHtml } = await import("../lib/notification/adapters/email.js");

      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "transfer_funds",
          status: "denied",
          decidedBy: "security_bot",
          decidedByType: "agent",
          decisionTimeMs: 100,
          reason: "Suspicious activity detected",
        },
      };

      const html = formatEmailHtml(event);

      expect(html).toContain("Denied");
      expect(html).toContain("transfer_funds");
      expect(html).toContain("security_bot");
      expect(html).toContain("agent");
      expect(html).toContain("Suspicious activity detected");
      expect(html).toContain("#ef4444"); // red color for denied
    });

    it("should include all urgency levels with correct colors", async () => {
      const { buildRequestCreatedHtml } = await import("../lib/notification/adapters/email.js");

      const urgencies = ["low", "normal", "high", "critical"] as const;
      const expectedColors = {
        low: "#16a34a",
        normal: "#ca8a04",
        high: "#ea580c",
        critical: "#dc2626",
      };

      for (const urgency of urgencies) {
        const event: RequestCreatedEvent = {
          type: EventNames.REQUEST_CREATED,
          timestamp: Date.now(),
          eventId: "evt_1",
          source: "test",
          payload: {
            requestId: "req_1",
            action: "test",
            params: {},
            context: {},
            urgency,
          },
        };

        const links = {
          approveUrl: "https://example.com/approve",
          denyUrl: "https://example.com/deny",
        };

        const html = buildRequestCreatedHtml(event, links);
        expect(html).toContain(urgency);
        expect(html).toContain(expectedColors[urgency]);
      }
    });

    it("should handle events with policy decision info", async () => {
      const { buildRequestCreatedHtml } = await import("../lib/notification/adapters/email.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "deploy_production",
          params: {},
          context: {},
          urgency: "high",
          policyDecision: {
            decision: "needs_approval",
            policyId: "policy_123",
            ruleName: "production_deploy_rule",
          },
        },
      };

      const links = {
        approveUrl: "https://example.com/approve",
        denyUrl: "https://example.com/deny",
      };

      const html = buildRequestCreatedHtml(event, links);
      expect(html).toContain("Policy Decision");
      expect(html).toContain("needs_approval");
      expect(html).toContain("policy_123");
    });
  });

  describe("generateDecisionLinks", () => {
    it("should generate approve and deny URLs from shared token generator", async () => {
      setConfig({ ...smtpConfig });
      const { generateDecisionLinks } = await import("../lib/notification/adapters/email.js");

      const links = await generateDecisionLinks("req_test_123");

      expect(links).not.toBeNull();
      expect(links!.approveUrl).toContain("/api/decide/");
      expect(links!.denyUrl).toContain("/api/decide/");
      expect(links!.approveUrl).not.toBe(links!.denyUrl);
    });

    it("should generate view URL when dashboard URL is configured", async () => {
      setConfig({ ...smtpConfig });
      const { generateDecisionLinks } = await import("../lib/notification/adapters/email.js");

      const links = await generateDecisionLinks("req_test_456");

      expect(links).not.toBeNull();
      expect(links!.viewUrl).toBe("https://dashboard.example.com/requests/req_test_456");
    });

    it("should not include view URL when dashboard URL is not configured", async () => {
      setConfig({ ...smtpConfig, dashboardUrl: undefined });
      const { generateDecisionLinks } = await import("../lib/notification/adapters/email.js");

      const links = await generateDecisionLinks("req_test_789");

      expect(links).not.toBeNull();
      expect(links!.viewUrl).toBeUndefined();
    });

    it("should return null when token generation fails", async () => {
      setConfig({ ...smtpConfig });
      const { generateDecisionTokens } = await import("../lib/decision-tokens.js");
      vi.mocked(generateDecisionTokens).mockResolvedValueOnce(null);
      
      const { generateDecisionLinks } = await import("../lib/notification/adapters/email.js");
      const links = await generateDecisionLinks("req_invalid");

      expect(links).toBeNull();
    });
  });
});

describe("SMTP transport configuration", () => {
  afterEach(() => {
    resetConfig();
    vi.clearAllMocks();
  });

  it("should configure secure transport for port 465", async () => {
    setConfig({
      ...smtpConfig,
      smtpPort: 465,
    });

    const nodemailer = await import("nodemailer");
    const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
    const adapter = new EmailAdapter();

    const event: RequestDecidedEvent = {
      type: EventNames.REQUEST_DECIDED,
      timestamp: Date.now(),
      eventId: "evt_1",
      source: "test",
      payload: {
        requestId: "req_1",
        action: "test",
        status: "approved",
        decidedBy: "test",
        decidedByType: "human",
        decisionTimeMs: 100,
      },
    };

    await adapter.send("test@example.com", event);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
        secure: true,
      })
    );
  });

  it("should configure non-secure transport for port 587", async () => {
    setConfig({
      ...smtpConfig,
      smtpPort: 587,
    });

    const nodemailer = await import("nodemailer");
    const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
    const adapter = new EmailAdapter();

    const event: RequestDecidedEvent = {
      type: EventNames.REQUEST_DECIDED,
      timestamp: Date.now(),
      eventId: "evt_1",
      source: "test",
      payload: {
        requestId: "req_1",
        action: "test",
        status: "denied",
        decidedBy: "test",
        decidedByType: "policy",
        decisionTimeMs: 50,
      },
    };

    await adapter.send("test@example.com", event);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 587,
        secure: false,
      })
    );
  });

  it("should not include auth when SMTP_USER is not set", async () => {
    setConfig({
      ...smtpConfig,
      smtpUser: undefined,
      smtpPass: undefined,
    });

    const nodemailer = await import("nodemailer");
    const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
    const adapter = new EmailAdapter();

    const event: RequestDecidedEvent = {
      type: EventNames.REQUEST_DECIDED,
      timestamp: Date.now(),
      eventId: "evt_1",
      source: "test",
      payload: {
        requestId: "req_1",
        action: "test",
        status: "approved",
        decidedBy: "test",
        decidedByType: "human",
        decisionTimeMs: 100,
      },
    };

    await adapter.send("test@example.com", event);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: undefined,
      })
    );
  });

  it("should handle SMTP send errors gracefully", async () => {
    setConfig({ ...smtpConfig });

    const nodemailer = await import("nodemailer");
    const mockTransport = nodemailer.createTransport();
    (mockTransport.sendMail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection refused")
    );

    const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
    const adapter = new EmailAdapter();

    const event: RequestDecidedEvent = {
      type: EventNames.REQUEST_DECIDED,
      timestamp: Date.now(),
      eventId: "evt_1",
      source: "test",
      payload: {
        requestId: "req_1",
        action: "test",
        status: "approved",
        decidedBy: "test",
        decidedByType: "human",
        decisionTimeMs: 100,
      },
    };

    const result = await adapter.send("test@example.com", event);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });
});
