import { describe, it, expect } from "vitest";
import {
  hasAgentGatePermission,
  mapScopesToPermissions,
  roleToPermissions,
  AGENTGATE_ROLES,
  type AgentGatePermission,
} from "../lib/rbac.js";

describe("RBAC", () => {
  describe("AGENTGATE_ROLES", () => {
    it("should define viewer role with read-only permissions", () => {
      const perms = AGENTGATE_ROLES.viewer;
      expect(perms).toContain("approvals:read");
      expect(perms).toContain("policies:read");
      expect(perms).toContain("audit:read");
      expect(perms).not.toContain("approvals:decide");
      expect(perms).not.toContain("policies:write");
      expect(perms).not.toContain("*");
    });

    it("should define editor role with read + decide", () => {
      const perms = AGENTGATE_ROLES.editor;
      expect(perms).toContain("approvals:read");
      expect(perms).toContain("approvals:decide");
      expect(perms).not.toContain("policies:write");
      expect(perms).not.toContain("keys:manage");
    });

    it("should define admin role with wildcard", () => {
      expect(AGENTGATE_ROLES.admin).toContain("*");
    });

    it("should define owner role with wildcard", () => {
      expect(AGENTGATE_ROLES.owner).toContain("*");
    });
  });

  describe("hasAgentGatePermission", () => {
    it("should return true for matching permission", () => {
      expect(hasAgentGatePermission(["approvals:read"], "approvals:read")).toBe(true);
    });

    it("should return false for non-matching permission", () => {
      expect(hasAgentGatePermission(["approvals:read"], "approvals:decide")).toBe(false);
    });

    it("should return true for wildcard permission", () => {
      expect(hasAgentGatePermission(["*"], "keys:manage")).toBe(true);
    });
  });

  describe("mapScopesToPermissions", () => {
    it("should map admin scope to wildcard", () => {
      expect(mapScopesToPermissions(["admin"])).toEqual(["*"]);
    });

    it("should map request:read to approvals:read + audit:read", () => {
      const perms = mapScopesToPermissions(["request:read"]);
      expect(perms).toContain("approvals:read");
      expect(perms).toContain("audit:read");
    });

    it("should map request:create to approvals:read + approvals:decide", () => {
      const perms = mapScopesToPermissions(["request:create"]);
      expect(perms).toContain("approvals:read");
      expect(perms).toContain("approvals:decide");
    });

    it("should handle unknown scopes gracefully (defaults to approvals:read)", () => {
      const perms = mapScopesToPermissions(["some:unknown:scope"]);
      expect(perms).toContain("approvals:read");
    });

    it("should deduplicate permissions from multiple scopes", () => {
      const perms = mapScopesToPermissions(["request:read", "request:create"]);
      const readCount = perms.filter(p => p === "approvals:read").length;
      expect(readCount).toBe(1);
    });

    it("should preserve backward compatibility — admin key gets full access", () => {
      const perms = mapScopesToPermissions(["admin"]);
      expect(hasAgentGatePermission(perms, "approvals:read")).toBe(true);
      expect(hasAgentGatePermission(perms, "approvals:decide")).toBe(true);
      expect(hasAgentGatePermission(perms, "keys:manage")).toBe(true);
      expect(hasAgentGatePermission(perms, "policies:write")).toBe(true);
    });
  });

  describe("roleToPermissions", () => {
    it("should return correct permissions for viewer", () => {
      const perms = roleToPermissions("viewer");
      expect(perms).toEqual(AGENTGATE_ROLES.viewer);
    });

    it("should return correct permissions for admin", () => {
      const perms = roleToPermissions("admin");
      expect(perms).toContain("*");
    });
  });
});
