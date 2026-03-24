import { useState, useEffect, useId } from 'react';
import { api, type PolicyTemplate, type ListPoliciesResponse } from '../api';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { SkeletonBox } from '../components/Skeleton';

type PolicyItem = ListPoliciesResponse['policies'][number];

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

  const modalTitleId = useId();

  useEffect(() => {
    fetchPolicies();
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
            <div key={policy.id} className="p-4 flex items-center justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
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
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {policy.rules.length} rule{policy.rules.length !== 1 ? 's' : ''} &middot; Priority {policy.priority}
                </p>
              </div>
              <span className="text-xs text-gray-400 shrink-0 ml-4">
                {new Date(policy.createdAt).toLocaleDateString()}
              </span>
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
    </div>
  );
}
