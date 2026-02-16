// @agentgate/server — RBAC permission model for AgentGate
//
// Extends @agentkit/auth's generic RBAC with AgentGate-specific permissions.

import type { Role } from '@agentkit/auth';

/**
 * AgentGate-specific permissions
 */
export type AgentGatePermission =
  | 'approvals:read'
  | 'approvals:decide'
  | 'policies:read'
  | 'policies:write'
  | 'webhooks:manage'
  | 'keys:manage'
  | 'audit:read'
  | 'overrides:manage'
  | '*';

/**
 * Role → permission mapping for AgentGate
 */
export const AGENTGATE_ROLES: Record<Role, AgentGatePermission[]> = {
  viewer: ['approvals:read', 'policies:read', 'audit:read'],
  editor: ['approvals:read', 'approvals:decide', 'policies:read', 'audit:read'],
  admin: ['*'],
  owner: ['*'],
};

/**
 * Check if a set of permissions satisfies a required permission.
 * Wildcard '*' grants everything.
 */
export function hasAgentGatePermission(
  permissions: readonly AgentGatePermission[],
  required: AgentGatePermission,
): boolean {
  if (permissions.includes('*')) return true;
  return permissions.includes(required);
}

/**
 * Map old API key scopes to AgentGate permissions.
 * This preserves backward compatibility — existing API keys keep their access.
 * The mapping is a pure superset: no existing key loses access it previously had.
 */
export function mapScopesToPermissions(scopes: string[]): AgentGatePermission[] {
  // admin scope → full access
  if (scopes.includes('admin')) {
    return ['*'];
  }

  const permissions: Set<AgentGatePermission> = new Set();

  for (const scope of scopes) {
    switch (scope) {
      case 'request:create':
        permissions.add('approvals:read');
        permissions.add('approvals:decide');
        break;
      case 'request:read':
        permissions.add('approvals:read');
        permissions.add('audit:read');
        break;
      case 'request:decide':
        permissions.add('approvals:read');
        permissions.add('approvals:decide');
        break;
      case 'policy:read':
        permissions.add('policies:read');
        break;
      case 'policy:write':
        permissions.add('policies:read');
        permissions.add('policies:write');
        break;
      case 'webhook:manage':
        permissions.add('webhooks:manage');
        break;
      case 'key:manage':
        permissions.add('keys:manage');
        break;
      case 'audit:read':
        permissions.add('audit:read');
        break;
      case 'override:manage':
        permissions.add('overrides:manage');
        break;
      default:
        // Unknown scopes get mapped to read permissions as a safe default
        permissions.add('approvals:read');
        break;
    }
  }

  return Array.from(permissions);
}

/**
 * Map a role to its permissions for AgentGate
 */
export function roleToPermissions(role: Role): AgentGatePermission[] {
  return AGENTGATE_ROLES[role] ?? [];
}
