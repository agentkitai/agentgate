import { useState, useEffect } from 'react';
import { authApi, type AuthProvidersResponse, type AuthSessionResponse } from '../api';

export default function Settings() {
  const [providers, setProviders] = useState<AuthProvidersResponse | null>(null);
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [prov, sess] = await Promise.all([
          authApi.getProviders(),
          authApi.getSession(),
        ]);
        setProviders(prov);
        setSession(sess);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
          <div className="h-4 w-56 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* SSO Status Panel */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">SSO Status</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">Auth Mode</dt>
            <dd className="mt-1 text-sm text-gray-900">{providers?.authMode ?? 'unknown'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">SSO Enforced</dt>
            <dd className="mt-1">
              {providers?.ssoEnforced ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Yes
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  No
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">OIDC Configured</dt>
            <dd className="mt-1">
              {providers?.oidcConfigured ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Yes
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Not configured
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">OIDC Provider</dt>
            <dd className="mt-1 text-sm text-gray-900">{providers?.oidcIssuer ?? 'None'}</dd>
          </div>
        </dl>
      </div>

      {/* Group-to-Role Mapping */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Group-to-Role Mapping</h2>
        <p className="text-sm text-gray-500 mb-3">
          OIDC groups are mapped to AgentGate roles via the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">OIDC_GROUP_MAPPING</code> environment variable.
        </p>
        {session && providers?.oidcConfigured ? (
          <div className="text-sm text-gray-600">
            Group mapping is configured server-side. Contact your administrator to modify mappings.
          </div>
        ) : (
          <div className="text-sm text-gray-400 italic">
            OIDC is not configured. Group mapping is not active.
          </div>
        )}
      </div>

      {/* Session Info */}
      {session && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Session</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Identity</dt>
              <dd className="mt-1 text-sm text-gray-900">{session.identity.displayName}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Auth Type</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {session.identity.type === 'user' ? 'SSO / JWT' : 'API Key'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Role</dt>
              <dd className="mt-1">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {session.identity.role}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Tenant</dt>
              <dd className="mt-1 text-sm text-gray-900">{session.tenantId}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Max Session Duration</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {Math.floor(session.maxSessionDurationSec / 3600)}h
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Permissions</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {session.permissions.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                  >
                    {p}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
