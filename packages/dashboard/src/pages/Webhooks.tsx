import { useState, useEffect, useId } from 'react';
import { adminApi } from '../api';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

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

const Spinner = () => (
  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export default function Webhooks() {
  const toast = useToast();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isDeletingWebhook, setIsDeletingWebhook] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ 
    url: '', 
    events: ['request.approved', 'request.denied'] 
  });
  const createTitleId = useId();
  const detailTitleId = useId();

  const eventOptions = ['request.approved', 'request.denied', 'request.expired', '*'];

  useEffect(() => { fetchWebhooks(); }, []);

  async function fetchWebhooks() {
    try {
      setError(null);
      const data = await adminApi.listWebhooks();
      setWebhooks(data.webhooks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch webhooks');
    } finally {
      setLoading(false);
    }
  }

  async function createWebhook() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const data = await adminApi.createWebhook(createForm);
      setNewSecret(data.secret);
      setShowCreate(false);
      setCreateForm({ url: '', events: ['request.approved', 'request.denied'] });
      toast.success('Webhook created successfully');
      fetchWebhooks();
    } catch (err) {
      toast.error('Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  }

  async function toggleWebhook(id: string, enabled: boolean) {
    if (togglingId) return;
    setTogglingId(id);
    try {
      await adminApi.updateWebhook(id, { enabled });
      toast.success(`Webhook ${enabled ? 'enabled' : 'disabled'}`);
      fetchWebhooks();
    } catch (err) {
      toast.error('Failed to update webhook');
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteWebhook(id: string) {
    if (isDeletingWebhook) return;
    setIsDeletingWebhook(true);
    try {
      await adminApi.deleteWebhook(id);
      toast.success('Webhook deleted');
      fetchWebhooks();
      setSelectedWebhook(null);
    } catch (err) {
      toast.error('Failed to delete webhook');
    } finally {
      setIsDeletingWebhook(false);
    }
  }

  async function testWebhook(id: string) {
    if (isTestingWebhook) return;
    setIsTestingWebhook(true);
    try {
      const data = await adminApi.testWebhook(id);
      if (data.success) {
        toast.success('Test sent successfully!');
      } else {
        toast.error(`Test failed: ${data.message}`);
      }
    } catch {
      toast.error('Failed to send test');
    } finally {
      setIsTestingWebhook(false);
    }
  }

  async function viewWebhook(id: string) {
    try {
      const data = await adminApi.getWebhook(id);
      setSelectedWebhook(data);
    } catch (err) {
      toast.error('Failed to fetch webhook details');
    }
  }

  const columns: Column<Webhook>[] = [
    {
      header: 'URL',
      span: 5,
      tabletSpan: 3,
      mobileLabel: 'URL',
      accessor: (wh) => <span className="font-mono text-sm truncate block">{wh.url}</span>,
    },
    {
      header: 'Events',
      span: 3,
      tabletSpan: 2,
      mobileLabel: 'Events',
      accessor: (wh) => (
        <div className="flex gap-1 flex-wrap">
          {wh.events.map(e => (
            <span key={e} className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{e}</span>
          ))}
        </div>
      ),
    },
    {
      header: 'Status',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Status',
      accessor: (wh) => (
        <button
          onClick={() => toggleWebhook(wh.id, !wh.enabled)}
          disabled={togglingId === wh.id}
          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            wh.enabled 
              ? 'bg-green-100 text-green-800 hover:bg-green-200' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {togglingId === wh.id ? <><Spinner />Toggling...</> : wh.enabled ? 'Enabled' : 'Disabled'}
        </button>
      ),
    },
    {
      header: 'Actions',
      span: 2,
      tabletSpan: 1,
      mobileLabel: false,
      accessor: (wh) => (
        <button 
          onClick={() => viewWebhook(wh.id)} 
          className="px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition-colors"
        >
          View
        </button>
      ),
    },
  ];

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl sm:text-2xl font-bold">Webhooks</h1>
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
        <h1 className="text-xl sm:text-2xl font-bold">Webhooks</h1>
        <button onClick={() => setShowCreate(true)} className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium">
          Add Webhook
        </button>
      </div>

      {/* New Secret Display */}
      {newSecret && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800 mb-2">Webhook Created!</h3>
          <p className="text-sm text-green-700 mb-2">Copy this secret now - it won't be shown again!</p>
          <code className="bg-green-100 px-3 py-2 rounded block font-mono text-sm break-all">{newSecret}</code>
          <div className="flex gap-3 mt-3">
            <button onClick={() => navigator.clipboard.writeText(newSecret)} className="text-sm text-green-600 hover:text-green-800 font-medium">Copy to clipboard</button>
            <button onClick={() => setNewSecret(null)} className="text-sm text-gray-600 hover:text-gray-800">Dismiss</button>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteWebhook(deleteTarget); }}
        title="Delete Webhook"
        message="Are you sure you want to delete this webhook? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} titleId={createTitleId} className="max-w-md">
            <h2 id={createTitleId} className="text-xl font-bold mb-4">Add Webhook</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">URL</label>
                <input type="url" value={createForm.url} onChange={(e) => setCreateForm({ ...createForm, url: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="https://example.com/webhook" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Events</label>
                <div className="space-y-2">
                  {eventOptions.map((event) => (
                    <label key={event} className="flex items-center gap-2">
                      <input type="checkbox" checked={createForm.events.includes(event)} onChange={(e) => { if (e.target.checked) { setCreateForm({ ...createForm, events: [...createForm.events, event] }); } else { setCreateForm({ ...createForm, events: createForm.events.filter(ev => ev !== event) }); } }} className="w-4 h-4 rounded" />
                      <span className="text-sm font-mono">{event}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={createWebhook} disabled={isCreating || !createForm.url || createForm.events.length === 0} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isCreating ? <><Spinner />Creating...</> : 'Create'}</button>
            </div>
      </Modal>

      {/* Webhook Detail Modal */}
      {selectedWebhook && (
        <Modal open onClose={() => setSelectedWebhook(null)} titleId={detailTitleId} className="max-w-2xl">
            <div className="flex justify-between items-start mb-4">
              <h2 id={detailTitleId} className="text-xl font-bold">Webhook Details</h2>
              <button onClick={() => setSelectedWebhook(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">URL</p>
                <p className="font-mono text-sm break-all">{selectedWebhook.url}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Events</p>
                <div className="flex gap-1 flex-wrap">
                  {selectedWebhook.events.map(e => (
                    <span key={e} className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">{e}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-2">Recent Deliveries</p>
                {selectedWebhook.deliveries?.length ? (
                  <div className="space-y-2">
                    {selectedWebhook.deliveries.map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
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
            </div>
            <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-4 border-t">
              <button onClick={() => testWebhook(selectedWebhook.id)} disabled={isTestingWebhook} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isTestingWebhook ? <><Spinner />Testing...</> : 'Send Test'}</button>
              <button onClick={() => setDeleteTarget(selectedWebhook.id)} disabled={isDeletingWebhook} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isDeletingWebhook ? <><Spinner />Deleting...</> : 'Delete'}</button>
            </div>
        </Modal>
      )}

      {/* Table */}
      <ResponsiveTable
        columns={columns}
        rows={webhooks}
        keyExtractor={(wh) => wh.id}
        loading={loading}
        emptyMessage="No webhooks yet. Add one to receive notifications."
        renderMobileCard={(wh) => (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm truncate">{wh.url}</p>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {wh.events.map(e => (
                    <span key={e} className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{e}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleWebhook(wh.id, !wh.enabled)}
                  disabled={togglingId === wh.id}
                  className={`px-3 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${wh.enabled ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {togglingId === wh.id ? <><Spinner />Toggling...</> : wh.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button onClick={() => viewWebhook(wh.id)} className="px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition-colors">View</button>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
