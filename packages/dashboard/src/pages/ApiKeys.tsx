import { useState, useEffect } from 'react';

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

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<EditForm | null>(null);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ name: '', scopes: ['request:create', 'request:read'], rateLimit: null });

  useEffect(() => {
    fetchKeys();
  }, []);

  async function fetchKeys() {
    try {
      const res = await fetch('/api/api-keys');
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (err) {
      console.error('Failed to fetch keys:', err);
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          scopes: createForm.scopes,
          rateLimit: createForm.rateLimit,
        }),
      });
      const data = await res.json();
      setNewKey({ key: data.key, name: data.name });
      setShowCreate(false);
      setCreateForm({ name: '', scopes: ['request:create', 'request:read'], rateLimit: null });
      fetchKeys();
    } catch (err) {
      console.error('Failed to create key:', err);
    }
  }

  async function updateKey() {
    if (!showEdit) return;
    try {
      await fetch(`/api/api-keys/${showEdit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: showEdit.name,
          scopes: showEdit.scopes,
          rateLimit: showEdit.rateLimit,
        }),
      });
      setShowEdit(null);
      fetchKeys();
    } catch (err) {
      console.error('Failed to update key:', err);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Are you sure you want to revoke this key?')) return;
    try {
      await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      fetchKeys();
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  }

  const scopeOptions = ['request:create', 'request:read', 'request:decide', 'admin'];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Create Key
        </button>
      </div>

      {/* New Key Display (shown once after creation) */}
      {newKey && (
        <div className="bg-green-50 border border-green-200 rounded p-4 mb-6">
          <h3 className="font-semibold text-green-800 mb-2">New API Key Created: {newKey.name}</h3>
          <p className="text-sm text-green-700 mb-2">Copy this key now - it won't be shown again!</p>
          <code className="bg-green-100 px-3 py-2 rounded block font-mono text-sm break-all">
            {newKey.key}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(newKey.key); }}
            className="mt-2 text-sm text-green-600 hover:text-green-800"
          >
            Copy to clipboard
          </button>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 ml-4 text-sm text-gray-600 hover:text-gray-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create Key Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create API Key</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="w-full border rounded px-3 py-2"
                placeholder="My API Key"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Scopes</label>
              <div className="space-y-2">
                {scopeOptions.map((scope) => (
                  <label key={scope} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={createForm.scopes.includes(scope)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCreateForm({ ...createForm, scopes: [...createForm.scopes, scope] });
                        } else {
                          setCreateForm({ ...createForm, scopes: createForm.scopes.filter(s => s !== scope) });
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm">{scope}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Rate Limit (requests/min)</label>
              <input
                type="number"
                value={createForm.rateLimit ?? ''}
                onChange={(e) => setCreateForm({ 
                  ...createForm, 
                  rateLimit: e.target.value ? parseInt(e.target.value, 10) : null 
                })}
                className="w-full border rounded px-3 py-2"
                placeholder="Unlimited"
                min="1"
              />
              <p className="text-xs text-gray-500 mt-1">Leave empty for unlimited requests</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createKey}
                disabled={!createForm.name || createForm.scopes.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Key Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit API Key</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={showEdit.name}
                onChange={(e) => setShowEdit({ ...showEdit, name: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Scopes</label>
              <div className="space-y-2">
                {scopeOptions.map((scope) => (
                  <label key={scope} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={showEdit.scopes.includes(scope)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setShowEdit({ ...showEdit, scopes: [...showEdit.scopes, scope] });
                        } else {
                          setShowEdit({ ...showEdit, scopes: showEdit.scopes.filter(s => s !== scope) });
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm">{scope}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Rate Limit (requests/min)</label>
              <input
                type="number"
                value={showEdit.rateLimit ?? ''}
                onChange={(e) => setShowEdit({ 
                  ...showEdit, 
                  rateLimit: e.target.value ? parseInt(e.target.value, 10) : null 
                })}
                className="w-full border rounded px-3 py-2"
                placeholder="Unlimited"
                min="1"
              />
              <p className="text-xs text-gray-500 mt-1">Leave empty for unlimited requests</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEdit(null)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={updateKey}
                disabled={!showEdit.name || showEdit.scopes.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keys List */}
      {loading ? (
        <p>Loading...</p>
      ) : keys.length === 0 ? (
        <p className="text-gray-500">No API keys yet. Create one to get started.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scopes</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate Limit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Used</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {keys.map((key) => (
                <tr key={key.id}>
                  <td className="px-6 py-4 font-medium">{key.name}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((s) => (
                        <span key={s} className="bg-gray-100 text-xs px-2 py-1 rounded">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {key.rateLimit ? `${key.rateLimit}/min` : 'Unlimited'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(key.createdAt * 1000).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {key.lastUsedAt ? new Date(key.lastUsedAt * 1000).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${key.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {key.active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {key.active && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowEdit({ id: key.id, name: key.name, scopes: key.scopes, rateLimit: key.rateLimit })}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => revokeKey(key.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
