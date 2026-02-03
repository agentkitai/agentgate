import { useState, useEffect } from 'react';

interface WebhookDelivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  last_attempt_at: number | null;
  response_code: number | null;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  created_at: number;
  enabled: boolean;
  deliveries?: WebhookDelivery[];
}

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ 
    url: '', 
    events: ['request.approved', 'request.denied'] 
  });

  const eventOptions = ['request.approved', 'request.denied', 'request.expired', '*'];

  useEffect(() => {
    fetchWebhooks();
  }, []);

  async function fetchWebhooks() {
    try {
      const res = await fetch('/api/webhooks');
      const data = await res.json();
      setWebhooks(data.webhooks || []);
    } catch (err) {
      console.error('Failed to fetch webhooks:', err);
    } finally {
      setLoading(false);
    }
  }

  async function createWebhook() {
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      setNewSecret(data.secret);
      setShowCreate(false);
      setCreateForm({ url: '', events: ['request.approved', 'request.denied'] });
      fetchWebhooks();
    } catch (err) {
      console.error('Failed to create webhook:', err);
    }
  }

  async function toggleWebhook(id: string, enabled: boolean) {
    try {
      await fetch(`/api/webhooks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      fetchWebhooks();
    } catch (err) {
      console.error('Failed to update webhook:', err);
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm('Are you sure you want to delete this webhook?')) return;
    try {
      await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      fetchWebhooks();
      setSelectedWebhook(null);
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    }
  }

  async function testWebhook(id: string) {
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: 'POST' });
      const data = await res.json();
      alert(data.success ? 'Test sent successfully!' : `Test failed: ${data.message}`);
    } catch {
      alert('Failed to send test');
    }
  }

  async function viewWebhook(id: string) {
    try {
      const res = await fetch(`/api/webhooks/${id}`);
      const data = await res.json();
      setSelectedWebhook(data);
    } catch (err) {
      console.error('Failed to fetch webhook:', err);
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Webhooks</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Webhook
        </button>
      </div>

      {/* New Secret Display */}
      {newSecret && (
        <div className="bg-green-50 border border-green-200 rounded p-4 mb-6">
          <h3 className="font-semibold text-green-800 mb-2">Webhook Created!</h3>
          <p className="text-sm text-green-700 mb-2">Copy this secret now - it won't be shown again!</p>
          <code className="bg-green-100 px-3 py-2 rounded block font-mono text-sm break-all">
            {newSecret}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(newSecret); }}
            className="mt-2 text-sm text-green-600 hover:text-green-800"
          >
            Copy to clipboard
          </button>
          <button
            onClick={() => setNewSecret(null)}
            className="mt-2 ml-4 text-sm text-gray-600 hover:text-gray-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Webhook</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">URL</label>
              <input
                type="url"
                value={createForm.url}
                onChange={(e) => setCreateForm({ ...createForm, url: e.target.value })}
                className="w-full border rounded px-3 py-2"
                placeholder="https://example.com/webhook"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Events</label>
              <div className="space-y-2">
                {eventOptions.map((event) => (
                  <label key={event} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={createForm.events.includes(event)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCreateForm({ ...createForm, events: [...createForm.events, event] });
                        } else {
                          setCreateForm({ ...createForm, events: createForm.events.filter(ev => ev !== event) });
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm font-mono">{event}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded">Cancel</button>
              <button
                onClick={createWebhook}
                disabled={!createForm.url || createForm.events.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook Detail Modal */}
      {selectedWebhook && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">Webhook Details</h2>
              <button onClick={() => setSelectedWebhook(null)} className="text-gray-500">✕</button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-500">URL</p>
              <p className="font-mono">{selectedWebhook.url}</p>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-500">Events</p>
              <div className="flex gap-1 flex-wrap">
                {selectedWebhook.events.map(e => (
                  <span key={e} className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">{e}</span>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-2">Recent Deliveries</p>
              {selectedWebhook.deliveries?.length ? (
                <div className="space-y-2">
                  {selectedWebhook.deliveries.map(d => (
                    <div key={d.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <span className="font-mono text-sm">{d.event}</span>
                      <span className={`px-2 py-1 text-xs rounded ${d.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {d.status} {d.response_code && `(${d.response_code})`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No deliveries yet</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => testWebhook(selectedWebhook.id)} className="px-4 py-2 border rounded">
                Send Test
              </button>
              <button onClick={() => deleteWebhook(selectedWebhook.id)} className="px-4 py-2 bg-red-600 text-white rounded">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webhooks List */}
      {loading ? (
        <p>Loading...</p>
      ) : webhooks.length === 0 ? (
        <p className="text-gray-500">No webhooks yet. Add one to receive notifications.</p>
      ) : (
        <div className="space-y-4">
          {webhooks.map((wh) => (
            <div key={wh.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm truncate">{wh.url}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {wh.events.map(e => (
                      <span key={e} className="bg-gray-100 px-2 py-0.5 rounded text-xs">{e}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => toggleWebhook(wh.id, !wh.enabled)}
                    className={`px-2 py-1 text-xs rounded ${wh.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                  >
                    {wh.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button onClick={() => viewWebhook(wh.id)} className="text-blue-600 text-sm">
                    View
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
