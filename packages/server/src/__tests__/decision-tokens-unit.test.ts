import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetConfig, setConfig, parseConfig } from "../config.js";

// We need to mock the database and audit before importing the module
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  approvalRequests: { id: "id" },
  decisionTokens: { id: "id" },
}));

vi.mock("../lib/audit.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { generateDecisionTokens } from "../lib/decision-tokens.js";
import { db, approvalRequests, decisionTokens } from "../db/index.js";
import { logAuditEvent } from "../lib/audit.js";

describe("Decision Tokens Unit Tests", () => {
  beforeEach(() => {
    resetConfig();
    setConfig(parseConfig({
      port: 3000,
      decisionTokenExpiryHours: 24,
    }));
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  describe("generateDecisionTokens", () => {
    it("should return null if request does not exist", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const result = await generateDecisionTokens("nonexistent-request");

      expect(result).toBeNull();
    });

    it("should return null if request is not pending", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "approved" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const result = await generateDecisionTokens("req-123");

      expect(result).toBeNull();
    });

    it("should return null for denied requests", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "denied" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const result = await generateDecisionTokens("req-123");

      expect(result).toBeNull();
    });

    it("should return null for expired requests", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "expired" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const result = await generateDecisionTokens("req-123");

      expect(result).toBeNull();
    });

    it("should generate tokens for pending request", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      expect(result).not.toBeNull();
      expect(result?.approve.token).toBeDefined();
      expect(result?.approve.url).toBeDefined();
      expect(result?.deny.token).toBeDefined();
      expect(result?.deny.url).toBeDefined();
      expect(result?.expiresAt).toBeDefined();
      expect(result?.expiresInHours).toBe(24);
    });

    it("should generate unique tokens for approve and deny", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      expect(result?.approve.token).not.toBe(result?.deny.token);
    });

    it("should generate base64url encoded tokens", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      // Base64url should only contain alphanumeric, -, and _
      expect(result?.approve.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result?.deny.token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should build URLs with default base URL", async () => {
      setConfig(parseConfig({ port: 4000 }));

      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      expect(result?.approve.url).toMatch(/^http:\/\/localhost:4000\/api\/decide\//);
      expect(result?.deny.url).toMatch(/^http:\/\/localhost:4000\/api\/decide\//);
    });

    it("should use custom decision link base URL when configured", async () => {
      setConfig(parseConfig({
        decisionLinkBaseUrl: "https://gate.example.com",
        port: 3000,
      }));

      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      expect(result?.approve.url).toMatch(/^https:\/\/gate\.example\.com\/api\/decide\//);
      expect(result?.deny.url).toMatch(/^https:\/\/gate\.example\.com\/api\/decide\//);
    });

    it("should use correct token expiry hours from config", async () => {
      setConfig(parseConfig({
        decisionTokenExpiryHours: 48,
        port: 3000,
      }));

      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      expect(result?.expiresInHours).toBe(48);
    });

    it("should insert two tokens into database", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      let insertedValues: any[] = [];
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: any[]) => {
          insertedValues = vals;
          return Promise.resolve(undefined);
        }),
      });
      (db.insert as any).mockImplementation(mockInsert);

      await generateDecisionTokens("req-123");

      expect(insertedValues).toHaveLength(2);
      expect(insertedValues.find((v: any) => v.action === "approve")).toBeDefined();
      expect(insertedValues.find((v: any) => v.action === "deny")).toBeDefined();
    });

    it("should set correct requestId on inserted tokens", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-456", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      let insertedValues: any[] = [];
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: any[]) => {
          insertedValues = vals;
          return Promise.resolve(undefined);
        }),
      });
      (db.insert as any).mockImplementation(mockInsert);

      await generateDecisionTokens("req-456");

      expect(insertedValues.every((v: any) => v.requestId === "req-456")).toBe(true);
    });

    it("should set expiration timestamp on inserted tokens", async () => {
      setConfig(parseConfig({
        decisionTokenExpiryHours: 24,
        port: 3000,
      }));

      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      let insertedValues: any[] = [];
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: any[]) => {
          insertedValues = vals;
          return Promise.resolve(undefined);
        }),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const beforeTime = new Date();
      await generateDecisionTokens("req-123");
      const afterTime = new Date();

      const expectedExpiry = new Date(beforeTime.getTime() + 24 * 60 * 60 * 1000);
      const maxExpiry = new Date(afterTime.getTime() + 24 * 60 * 60 * 1000);

      for (const token of insertedValues) {
        expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry.getTime() - 1000);
        expect(token.expiresAt.getTime()).toBeLessThanOrEqual(maxExpiry.getTime() + 1000);
      }
    });

    it("should log audit event after token generation", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      await generateDecisionTokens("req-123");

      expect(logAuditEvent).toHaveBeenCalledWith(
        "req-123",
        "viewed",
        "system",
        expect.objectContaining({
          event: "tokens_generated_for_notification",
        })
      );
    });

    it("should include expiresAt in audit event details", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      await generateDecisionTokens("req-123");

      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          expiresAt: expect.any(String),
        })
      );
    });

    it("should return ISO string for expiresAt", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      // Should be a valid ISO string
      expect(result?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it("should embed token in URL path", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "req-123", status: "pending" },
            ]),
          }),
        }),
      });
      (db.select as any).mockImplementation(mockSelect);

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      (db.insert as any).mockImplementation(mockInsert);

      const result = await generateDecisionTokens("req-123");

      // URL should end with the token
      expect(result?.approve.url.endsWith(result.approve.token)).toBe(true);
      expect(result?.deny.url.endsWith(result.deny.token)).toBe(true);
    });
  });
});
