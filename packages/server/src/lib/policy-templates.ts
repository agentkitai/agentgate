// @agentgate/server - Risk-Aware Policy Templates

import type { PolicyRule } from "@agentgate/core";

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  rules: PolicyRule[];
  decision: string;
  priority: number;
}

const templates: PolicyTemplate[] = [
  {
    id: "outbound-email",
    name: "Outbound Email",
    description:
      "Auto-approve emails to internal domains; route external recipients to a human reviewer.",
    category: "communication",
    decision: "route_to_human",
    priority: 50,
    rules: [
      {
        match: {
          action: "send_email",
          "params.to": { $regex: "^[^@]+@(company\\.com|internal\\.corp)$" },
        },
        decision: "auto_approve",
      },
      {
        match: {
          action: "send_email",
        },
        decision: "route_to_human",
        requireReason: true,
      },
    ],
  },
  {
    id: "file-mutation",
    name: "File Mutation",
    description:
      "Deny delete operations outright; route file writes to a human reviewer for approval.",
    category: "filesystem",
    decision: "auto_deny",
    priority: 30,
    rules: [
      {
        match: {
          action: "file_delete",
        },
        decision: "auto_deny",
      },
      {
        match: {
          action: { $in: ["file_write", "file_rename", "file_move"] },
        },
        decision: "route_to_human",
        requireReason: true,
      },
    ],
  },
  {
    id: "deployment",
    name: "Deployment",
    description:
      "Auto-approve staging deployments; require human approval for production deployments.",
    category: "infrastructure",
    decision: "route_to_human",
    priority: 20,
    rules: [
      {
        match: {
          action: "deploy",
          "params.environment": "staging",
        },
        decision: "auto_approve",
      },
      {
        match: {
          action: "deploy",
          "params.environment": "production",
        },
        decision: "route_to_human",
        requireReason: true,
      },
    ],
  },
  {
    id: "external-api-write",
    name: "External API Write",
    description:
      "Auto-approve external API read operations; route all write operations to a human reviewer.",
    category: "integration",
    decision: "route_to_human",
    priority: 40,
    rules: [
      {
        match: {
          action: "api_call",
          "params.method": { $in: ["GET", "HEAD", "OPTIONS"] },
        },
        decision: "auto_approve",
      },
      {
        match: {
          action: "api_call",
          "params.method": { $in: ["POST", "PUT", "PATCH", "DELETE"] },
        },
        decision: "route_to_human",
        requireReason: true,
      },
    ],
  },
  {
    id: "data-export",
    name: "Data Export",
    description:
      "Auto-approve small data queries; route bulk exports exceeding a row threshold to a human reviewer.",
    category: "data",
    decision: "route_to_human",
    priority: 60,
    rules: [
      {
        match: {
          action: "data_export",
          "params.rowCount": { $lte: 1000 },
        },
        decision: "auto_approve",
      },
      {
        match: {
          action: "data_export",
          "params.rowCount": { $gt: 1000 },
        },
        decision: "route_to_human",
        requireReason: true,
      },
    ],
  },
];

/**
 * Return all available policy templates.
 */
export function getTemplates(): PolicyTemplate[] {
  return templates;
}

/**
 * Return a single template by id, or undefined if not found.
 */
export function getTemplateById(id: string): PolicyTemplate | undefined {
  return templates.find((t) => t.id === id);
}
