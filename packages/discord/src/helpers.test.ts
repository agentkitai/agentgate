import { describe, it, expect } from "vitest";
import type { ApprovalRequest } from "@agentgate/core";
import {
  truncate,
  formatJson,
  getUrgencyEmoji,
  getUrgencyColor,
  buildApprovalEmbed,
  buildDecidedEmbed,
  buildActionRow,
  buildDisabledActionRow,
  EMBED_COLORS,
} from "./helpers.js";

describe("truncate", () => {
  it("returns string unchanged if shorter than maxLen", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns string unchanged if equal to maxLen", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and adds ellipsis if longer than maxLen", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("handles edge case of very short maxLen", () => {
    expect(truncate("hello", 4)).toBe("h...");
  });
});

describe("formatJson", () => {
  it("formats JSON with indentation", () => {
    const obj = { key: "value" };
    const result = formatJson(obj);
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
  });

  it("truncates long JSON output", () => {
    const obj = { longKey: "a".repeat(1100) };
    const result = formatJson(obj, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not truncate short JSON", () => {
    const obj = { a: 1 };
    const result = formatJson(obj, 1000);
    expect(result.endsWith("...")).toBe(false);
  });
});

describe("getUrgencyEmoji", () => {
  it("returns red circle for critical", () => {
    expect(getUrgencyEmoji("critical")).toBe("🔴");
  });

  it("returns orange circle for high", () => {
    expect(getUrgencyEmoji("high")).toBe("🟠");
  });

  it("returns yellow circle for normal", () => {
    expect(getUrgencyEmoji("normal")).toBe("🟡");
  });

  it("returns green circle for low", () => {
    expect(getUrgencyEmoji("low")).toBe("🟢");
  });

  it("returns white circle for unknown urgency", () => {
    expect(getUrgencyEmoji("unknown")).toBe("⚪");
    expect(getUrgencyEmoji("")).toBe("⚪");
  });
});

describe("getUrgencyColor", () => {
  it("returns correct colors for urgencies", () => {
    expect(getUrgencyColor("critical")).toBe(EMBED_COLORS.critical);
    expect(getUrgencyColor("high")).toBe(EMBED_COLORS.high);
    expect(getUrgencyColor("normal")).toBe(EMBED_COLORS.normal);
    expect(getUrgencyColor("low")).toBe(EMBED_COLORS.low);
  });

  it("returns default for unknown urgency", () => {
    expect(getUrgencyColor("unknown")).toBe(EMBED_COLORS.default);
  });
});

describe("buildApprovalEmbed", () => {
  const baseRequest: ApprovalRequest = {
    id: "req-123",
    action: "delete_file",
    params: { path: "/tmp/test.txt" },
    context: {},
    urgency: "high",
    status: "pending",
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
  };

  it("creates embed with correct title", () => {
    const embed = buildApprovalEmbed(baseRequest);
    expect(embed.title).toBe("🔔 Approval Request");
  });

  it("uses urgency color", () => {
    const embed = buildApprovalEmbed(baseRequest);
    expect(embed.color).toBe(EMBED_COLORS.high);
  });

  it("includes action field", () => {
    const embed = buildApprovalEmbed(baseRequest);
    const actionField = embed.fields?.find((f) => f.name === "Action");
    expect(actionField).toBeDefined();
    expect(actionField?.value).toBe("`delete_file`");
  });

  it("includes urgency field with emoji", () => {
    const embed = buildApprovalEmbed(baseRequest);
    const urgencyField = embed.fields?.find((f) => f.name === "Urgency");
    expect(urgencyField).toBeDefined();
    expect(urgencyField?.value).toContain("🟠");
    expect(urgencyField?.value).toContain("HIGH");
  });

  it("includes request ID field", () => {
    const embed = buildApprovalEmbed(baseRequest);
    const idField = embed.fields?.find((f) => f.name === "Request ID");
    expect(idField).toBeDefined();
    expect(idField?.value).toBe("`req-123`");
  });

  it("includes params field when params present", () => {
    const embed = buildApprovalEmbed(baseRequest);
    const paramsField = embed.fields?.find((f) => f.name === "Parameters");
    expect(paramsField).toBeDefined();
    expect(paramsField?.value).toContain("/tmp/test.txt");
  });

  it("skips params field when params empty", () => {
    const requestNoParams: ApprovalRequest = {
      ...baseRequest,
      params: {},
    };
    const embed = buildApprovalEmbed(requestNoParams);
    const paramsField = embed.fields?.find((f) => f.name === "Parameters");
    expect(paramsField).toBeUndefined();
  });

  it("includes context field when context present", () => {
    const requestWithContext: ApprovalRequest = {
      ...baseRequest,
      context: { user: "agent-1", reason: "cleanup" },
    };
    const embed = buildApprovalEmbed(requestWithContext);
    const contextField = embed.fields?.find((f) => f.name === "Context");
    expect(contextField).toBeDefined();
    expect(contextField?.value).toContain("agent-1");
  });

  it("includes decision links when provided", () => {
    const links = {
      approve: "https://example.com/approve/abc123",
      deny: "https://example.com/deny/def456",
    };
    const embed = buildApprovalEmbed(baseRequest, links);
    const linksField = embed.fields?.find((f) =>
      f.name.includes("One-Click")
    );
    expect(linksField).toBeDefined();
    expect(linksField?.value).toContain(links.approve);
    expect(linksField?.value).toContain(links.deny);
  });

  it("handles string createdAt", () => {
    const requestWithString: ApprovalRequest = {
      ...baseRequest,
      createdAt: "2024-01-15T10:00:00Z" as unknown as Date,
    };
    const embed = buildApprovalEmbed(requestWithString);
    expect(embed.timestamp).toBeDefined();
  });
});

describe("buildDecidedEmbed", () => {
  const baseRequest: ApprovalRequest = {
    id: "req-456",
    action: "send_email",
    params: { to: "test@example.com" },
    context: {},
    urgency: "normal",
    status: "approved",
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:05:00Z"),
    decidedAt: new Date("2024-01-15T10:05:00Z"),
  };

  it("creates approved embed with checkmark", () => {
    const embed = buildDecidedEmbed(baseRequest, "approved", "123456789");
    expect(embed.title).toBe("✅ Request Approved");
    expect(embed.color).toBe(EMBED_COLORS.approved);
  });

  it("creates denied embed with X", () => {
    const embed = buildDecidedEmbed(baseRequest, "denied", "123456789");
    expect(embed.title).toBe("❌ Request Denied");
    expect(embed.color).toBe(EMBED_COLORS.denied);
  });

  it("includes user mention for Discord user ID", () => {
    const embed = buildDecidedEmbed(baseRequest, "approved", "123456789012345678");
    const decidedField = embed.fields?.find((f) => f.name === "Decided By");
    expect(decidedField).toBeDefined();
    expect(decidedField?.value).toBe("<@123456789012345678>");
  });

  it("includes plain text for non-user decidedBy", () => {
    const embed = buildDecidedEmbed(baseRequest, "approved", "policy");
    const decidedField = embed.fields?.find((f) => f.name === "Decided By");
    expect(decidedField).toBeDefined();
    expect(decidedField?.value).toBe("policy");
  });

  it("includes reason when present", () => {
    const requestWithReason: ApprovalRequest = {
      ...baseRequest,
      decisionReason: "Approved by admin",
    };
    const embed = buildDecidedEmbed(requestWithReason, "approved", "123");
    const reasonField = embed.fields?.find((f) => f.name === "Reason");
    expect(reasonField).toBeDefined();
    expect(reasonField?.value).toBe("Approved by admin");
  });
});

describe("buildActionRow", () => {
  it("creates action row with approve and deny buttons", () => {
    const row = buildActionRow("req-789");
    expect(row.type).toBe(1); // ACTION_ROW
    expect(row.components).toHaveLength(2);
  });

  it("creates approve button with success style", () => {
    const row = buildActionRow("req-789");
    const approveBtn = row.components[0];
    expect(approveBtn.style).toBe(3); // SUCCESS
    expect(approveBtn.label).toBe("Approve");
    expect(approveBtn.custom_id).toBe("approve:req-789");
  });

  it("creates deny button with danger style", () => {
    const row = buildActionRow("req-789");
    const denyBtn = row.components[1];
    expect(denyBtn.style).toBe(4); // DANGER
    expect(denyBtn.label).toBe("Deny");
    expect(denyBtn.custom_id).toBe("deny:req-789");
  });
});

describe("buildDisabledActionRow", () => {
  it("creates disabled buttons when approved", () => {
    const row = buildDisabledActionRow("req-789", "approved");
    expect(row.components[0].disabled).toBe(true);
    expect(row.components[1].disabled).toBe(true);
    // Approve button should keep SUCCESS style
    expect(row.components[0].style).toBe(3);
    // Deny button should use SECONDARY style
    expect(row.components[1].style).toBe(2);
  });

  it("creates disabled buttons when denied", () => {
    const row = buildDisabledActionRow("req-789", "denied");
    expect(row.components[0].disabled).toBe(true);
    expect(row.components[1].disabled).toBe(true);
    // Approve button should use SECONDARY style
    expect(row.components[0].style).toBe(2);
    // Deny button should keep DANGER style
    expect(row.components[1].style).toBe(4);
  });
});
