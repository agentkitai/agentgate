import { useState, useEffect, useId } from 'react';
import { adminApi } from '../api';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  rateLimit: number | null;
  active: boolean;
}

interface CreateForm {
  name: string;
  scopes: string[];
  rateLimit: number | null;
}

interface EditForm {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number | null;
}

const Spinner = () => (
  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export default function ApiKeys() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<EditForm | null>(null);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ 
    name: '', 
    scopes: ['request:create', 'request:read'], 
    rateLimit: null 
  });

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const createTitleId = useId();
  const editTitleId = useId();
  const scopeOptions = ['request:create', 'request:read', 'request:decide', 'admin'];

  useEffect(() => { fetchKeys(); }, []);

  async function fetchKeys() {
    try {
      setError(null);
      const data = await adminApi.listApiKeys();
      setKeys(data.keys || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch API keys');
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const data = await adminApi.createApiKey({
        name: createForm.name,
        scopes: createForm.scopes,
        rateLimit: createForm.rateLimit,
      });
      setNewKey({ key: data.key, name: data.name });
      setShowCreate(false);
      setCreateForm({ name: '', scopes: ['request:create', 'request:read'], rateLimit: null });
      toast.success('API key created successfully');
      fetchKeys();
    } catch (err) {
      toast.error('Failed to create key');
    } finally {
      setIsCreating(false);
    }
  }

  async function updateKey() {
    if (!showEdit || isSaving) return;
    setIsSaving(true);
    try {
      await adminApi.updateApiKey(showEdit.id, {
        name: showEdit.name,
        scopes: showEdit.scopes,
        rateLimit: showEdit.rateLimit,
      });
      setShowEdit(null);
      toast.success('API key updated successfully');
      fetchKeys();
    } catch (err) {
      toast.error('Failed to update key');
    } finally {
      setIsSaving(false);
    }
  }

  async function revokeKey(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    try {
      await adminApi.deleteApiKey(id);
      toast.success('API key revoked');
      fetchKeys();
    } catch (err) {
      toast.error('Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  }

  const columns: Column<ApiKey>[] = [
    {
      header: 'Name',
      span: 2,
      mobileLabel: 'Name',
      accessor: (k) => <span className="font-medium">{k.name}</span>,
    },
    {
      header: 'Scopes',
      span: 3,
      hideOnTablet: true,
      mobileLabel: 'Scopes',
      accessor: (k) => (
        <div className="flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <span key={s} className="bg-gray-100 text-xs px-2 py-1 rounded font-mono">{s}</span>
          ))}
        </div>
      ),
    },
    {
      header: 'Rate Limit',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Rate Limit',
      accessor: (k) => (
        <span className="text-sm text-gray-500">{k.rateLimit ? `${k.rateLimit}/min` : 'Unlimited'}</span>
      ),
    },
    {
      header: 'Created',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Created',
      accessor: (k) => (
        <span className="text-sm text-gray-500">{new Date(k.createdAt * 1000).toLocaleDateString()}</span>
      ),
    },
    {
      header: 'Last Used',
      span: 2,
      hideOnTablet: true,
      mobileLabel: 'Last Used',
      accessor: (k) => (
        <span className="text-sm text-gray-500">{k.lastUsedAt ? new Date(k.lastUsedAt * 1000).toLocaleDateString() : 'Never'}</span>
      ),
    },
    {
      header: 'Status',
      span: 1,
      tabletSpan: 1,
      mobileLabel: 'Status',
      accessor: (k) => (
        <span className={`px-2 py-1 text-xs rounded ${k.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {k.active ? 'Active' : 'Revoked'}
        </span>
      ),
    },
    {
      header: 'Actions',
      span: 2,
      tabletSpan: 1,
      mobileLabel: false,
      accessor: (k) =>
        k.active ? (
          <div className="flex gap-3">
            <button onClick={() => setShowEdit({ id: k.id, name: k.name, scopes: k.scopes, rateLimit: k.rateLimit })} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Edit</button>
            <button onClick={() => setRevokeTarget(k.id)} disabled={revokingId === k.id} className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{revokingId === k.id ? <><Spinner />Revoking...</> : 'Revoke'}</button>
          </div>
        ) : null,
    },
  ];

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold mb-4">API Keys</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">API Keys</h1>
        <button onClick={() => setShowCreate(true)} className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium">
          Create Key
        </button>
      </div>

      {/* New Key Display */}
      {newKey && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800 mb-2">New API Key Created: {newKey.name}</h3>
          <p className="text-sm text-green-700 mb-2">Copy this key now - it won't be shown again!</p>
          <code className="bg-green-100 px-3 py-2 rounded block font-mono text-sm break-all">{newKey.key}</code>
          <div className="flex gap-3 mt-3">
            <button onClick={() => navigator.clipboard.writeText(newKey.key)} className="text-sm text-green-600 hover:text-green-800 font-medium">Copy to clipboard</button>
            <button onClick={() => setNewKey(null)} className="text-sm text-gray-600 hover:text-gray-800">Dismiss</button>
          </div>
        </div>
      )}

      {/* Revoke Confirm Dialog */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => { setRevokeTarget(null); setRevokingId(null); }}
        onConfirm={() => { if (revokeTarget) revokeKey(revokeTarget); }}
        title="Revoke API Key"
        message="Are you sure you want to revoke this key? This action cannot be undone."
        confirmLabel="Revoke"
        variant="danger"
      />

      {/* Create Key Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} titleId={createTitleId} className="max-w-md">
            <h2 id={createTitleId} className="text-xl font-bold mb-4">Create API Key</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="My API Key" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Scopes</label>
                <div className="space-y-2">
                  {scopeOptions.map((scope) => (
                    <label key={scope} className="flex items-center gap-2">
                      <input type="checkbox" checked={createForm.scopes.includes(scope)} onChange={(e) => { if (e.target.checked) { setCreateForm({ ...createForm, scopes: [...createForm.scopes, scope] }); } else { setCreateForm({ ...createForm, scopes: createForm.scopes.filter(s => s !== scope) }); } }} className="w-4 h-4 rounded" />
                      <span className="text-sm font-mono">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Rate Limit (requests/min)</label>
                <input type="number" value={createForm.rateLimit ?? ''} onChange={(e) => setCreateForm({ ...createForm, rateLimit: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Unlimited" min="1" />
                <p className="text-xs text-gray-500 mt-1">Leave empty for unlimited requests</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={createKey} disabled={isCreating || !createForm.name || createForm.scopes.length === 0} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isCreating ? <><Spinner />Creating...</> : 'Create'}</button>
            </div>
      </Modal>

      {/* Edit Key Modal */}
      {showEdit && (
      <Modal open onClose={() => setShowEdit(null)} titleId={editTitleId} className="max-w-md">
            <h2 id={editTitleId} className="text-xl font-bold mb-4">Edit API Key</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input type="text" value={showEdit.name} onChange={(e) => setShowEdit({ ...showEdit, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Scopes</label>
                <div className="space-y-2">
                  {scopeOptions.map((scope) => (
                    <label key={scope} className="flex items-center gap-2">
                      <input type="checkbox" checked={showEdit.scopes.includes(scope)} onChange={(e) => { if (e.target.checked) { setShowEdit({ ...showEdit, scopes: [...showEdit.scopes, scope] }); } else { setShowEdit({ ...showEdit, scopes: showEdit.scopes.filter(s => s !== scope) }); } }} className="w-4 h-4 rounded" />
                      <span className="text-sm font-mono">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Rate Limit (requests/min)</label>
                <input type="number" value={showEdit.rateLimit ?? ''} onChange={(e) => setShowEdit({ ...showEdit, rateLimit: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Unlimited" min="1" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowEdit(null)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={updateKey} disabled={isSaving || !showEdit.name || showEdit.scopes.length === 0} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isSaving ? <><Spinner />Saving...</> : 'Save'}</button>
            </div>
      </Modal>
      )}

      {/* Table */}
      <ResponsiveTable
        columns={columns}
        rows={keys}
        keyExtractor={(k) => k.id}
        loading={loading}
        emptyMessage="No API keys yet. Create one to get started."
        renderMobileCard={(key) => (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{key.name}</h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  {key.scopes.map((s) => (
                    <span key={s} className="bg-gray-100 text-xs px-2 py-0.5 rounded font-mono">{s}</span>
                  ))}
                </div>
              </div>
              <span className={`shrink-0 px-2 py-1 text-xs rounded ${key.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {key.active ? 'Active' : 'Revoked'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-500 mb-3">
              <div><span className="text-gray-400">Rate Limit:</span> {key.rateLimit ? `${key.rateLimit}/min` : 'Unlimited'}</div>
              <div><span className="text-gray-400">Created:</span> {new Date(key.createdAt * 1000).toLocaleDateString()}</div>
              <div className="col-span-2"><span className="text-gray-400">Last Used:</span> {key.lastUsedAt ? new Date(key.lastUsedAt * 1000).toLocaleDateString() : 'Never'}</div>
            </div>
            {key.active && (
              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button onClick={() => setShowEdit({ id: key.id, name: key.name, scopes: key.scopes, rateLimit: key.rateLimit })} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Edit</button>
                <button onClick={() => setRevokeTarget(key.id)} disabled={revokingId === key.id} className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{revokingId === key.id ? <><Spinner />Revoking...</> : 'Revoke'}</button>
              </div>
            )}
          </div>
        )}
      />
    </div>
  );
}
