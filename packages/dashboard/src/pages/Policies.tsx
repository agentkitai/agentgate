import { useState, useEffect, useId } from 'react';
import { api, governanceApi, type PolicyTemplate, type ListPoliciesResponse, type Agent } from '../api';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { SkeletonBox } from '../components/Skeleton';

type PolicyItem = ListPoliciesResponse['policies'][number];

const SCOPE_COLORS: Record<string, string> = {
  global: 'bg-gray-100 text-gray-600',
  per_agent: 'bg-blue-100 text-blue-700',
  per_tool: 'bg-purple-100 text-purple-700',
};

function ScopeBadge({ scope }: { scope: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SCOPE_COLORS[scope] || SCOPE_COLORS.global}`}>
      {scope}
    </span>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  communication: 'bg-blue-100 text-blue-700',
  filesystem: 'bg-orange-100 text-orange-700',
  infrastructure: 'bg-purple-100 text-purple-700',
  integration: 'bg-green-100 text-green-700',
  data: 'bg-yellow-100 text-yellow-700',
};

function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors}`}>
      {category}
    </span>
  );
}

const Spinner = () => (
  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export default function Policies() {
  const toast = useToast();
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Clone-across-agents (#22)
  const [cloneSource, setCloneSource] = useState<PolicyItem | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneAgentIds, setCloneAgentIds] = useState<string[]>([]);
  const [isCloning, setIsCloning] = useState(false);

  const modalTitleId = useId();
  const cloneTitleId = useId();

  useEffect(() => {
    fetchPolicies();
    void fetchAgents();
  }, []);

  async function fetchPolicies() {
    try {
      setError(null);
      const data = await api.listPolicies({ limit: 100 });
      setPolicies(data.policies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAgents() {
    try {
      const data = await governanceApi.listAgents();
      setAgents(data.agents.filter((a) => a.status === 'active'));
    } catch {
      // Non-fatal: clone modal just shows no agent options.
    }
  }

  function openClone(p: PolicyItem) {
    setCloneSource(p);
    setCloneName(`Copy of ${p.name}`);
    setCloneAgentIds(p.scope === 'per_agent' && p.agentIds ? p.agentIds : []);
  }

  async function clonePolicy() {
    if (!cloneSource || isCloning || cloneAgentIds.length === 0) return;
    setIsCloning(true);
    try {
      await api.createPolicy({
        name: cloneName.trim() || `Copy of ${cloneSource.name}`,
        rules: cloneSource.rules,
        priority: cloneSource.priority,
        enabled: cloneSource.enabled,
        scope: 'per_agent',
        agentIds: cloneAgentIds,
      });
      toast.success('Policy cloned to selected agents');
      setCloneSource(null);
      await fetchPolicies();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clone policy');
    } finally {
      setIsCloning(false);
    }
  }

  async function openTemplateModal() {
    setShowTemplates(true);
    try {
      const data = await api.listPolicyTemplates();
      setTemplates(data.templates);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    }
  }

  async function createFromTemplate(template: PolicyTemplate) {
    if (creatingId) return;
    setCreatingId(template.id);
    try {
      const created = await api.createPolicyFromTemplate(template.id);
      toast.success(`Policy "${created.name}" created from template`);
      setShowTemplates(false);
      await fetchPolicies();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setCreatingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonBox className="h-8 w-40" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <SkeletonBox key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Policies</h1>
        <button
          onClick={openTemplateModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          Create from Template
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-4 text-sm">
          {error}
        </div>
      )}

      {/* Policies list */}
      {policies.length === 0 && !error ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">No policies yet. Create one from a template to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {policies.map((policy) => (
            <div key={policy.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{policy.name}</span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      policy.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {policy.enabled ? 'Active' : 'Disabled'}
                  </span>
                  <ScopeBadge scope={policy.scope} />
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {policy.rules.length} rule{policy.rules.length !== 1 ? 's' : ''} &middot; Priority {policy.priority}
                  {policy.scope === 'per_agent' && policy.agentIds?.length ? (
                    <> &middot; <span className="font-mono text-xs">{policy.agentIds.join(', ')}</span></>
                  ) : null}
                  {policy.scope === 'per_tool' && policy.toolIds?.length ? (
                    <> &middot; tools: <span className="font-mono text-xs">{policy.toolIds.join(', ')}</span></>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => openClone(policy)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  Clone to agents
                </button>
                <span className="text-xs text-gray-400">
                  {new Date(policy.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template modal */}
      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        titleId={modalTitleId}
        className="max-w-2xl"
      >
        <h2 id={modalTitleId} className="text-lg font-semibold text-gray-900 mb-4">
          Create Policy from Template
        </h2>
        {templates.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">Loading templates...</div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900">{tpl.name}</span>
                      <CategoryBadge category={tpl.category} />
                    </div>
                    <p className="text-sm text-gray-600">{tpl.description}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {tpl.rules.length} rule{tpl.rules.length !== 1 ? 's' : ''} &middot; Priority {tpl.priority}
                    </p>
                  </div>
                  <button
                    onClick={() => createFromTemplate(tpl)}
                    disabled={creatingId !== null}
                    className="shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
                  >
                    {creatingId === tpl.id ? <><Spinner /> Creating...</> : 'Use'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => setShowTemplates(false)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
        </div>
      </Modal>

      {/* Clone-to-agents modal (#22) */}
      {cloneSource && (
        <Modal open onClose={() => setCloneSource(null)} titleId={cloneTitleId} className="max-w-lg">
          <h2 id={cloneTitleId} className="text-lg font-semibold text-gray-900 mb-1">Clone policy to agents</h2>
          <p className="text-sm text-gray-500 mb-4">
            Creates a per-agent copy of <span className="font-medium">{cloneSource.name}</span> (same {cloneSource.rules.length} rule{cloneSource.rules.length !== 1 ? 's' : ''}, priority {cloneSource.priority}) scoped to the selected agents.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">New policy name</label>
              <input type="text" value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Apply to agents</label>
              {agents.length === 0 ? (
                <p className="text-sm text-gray-400">No active agents. Register agents first.</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {agents.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={cloneAgentIds.includes(a.id)}
                        onChange={(e) => {
                          setCloneAgentIds((prev) =>
                            e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                          );
                        }}
                        className="w-4 h-4 rounded"
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="text-xs text-gray-400 font-mono truncate">{a.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={() => setCloneSource(null)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={clonePolicy} disabled={isCloning || cloneAgentIds.length === 0 || !cloneName.trim()} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isCloning ? <><Spinner />Cloning…</> : 'Clone'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
