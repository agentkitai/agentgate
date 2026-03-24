import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api';
import type {
  WebhookStatsResponse,
  WebhookDeliveryRecord,
  WebhookDeliveriesResponse,
} from '../api';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SkeletonBox } from '../components/Skeleton';

const AUTO_REFRESH_MS = 30_000;

const Spinner = () => (
  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`px-2 py-1 text-xs rounded font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
}

function HealthIndicator({ successRate }: { successRate: number }) {
  if (successRate >= 95) return <span className="inline-block w-3 h-3 rounded-full bg-green-500" title="Healthy" />;
  if (successRate >= 80) return <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" title="Degraded" />;
  return <span className="inline-block w-3 h-3 rounded-full bg-red-500" title="Unhealthy" />;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleString();
}

export default function WebhookObservability() {
  const toast = useToast();
  const [stats, setStats] = useState<WebhookStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded webhook delivery view
  const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveriesResponse | null>(null);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>('');
  const [deliveryPage, setDeliveryPage] = useState(0);
  const DELIVERY_PAGE_SIZE = 20;

  // Replay state
  const [replayTarget, setReplayTarget] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setError(null);
      const data = await adminApi.getWebhookStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch webhook stats');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDeliveries = useCallback(async (webhookId: string, offset = 0, status = '') => {
    setDeliveriesLoading(true);
    try {
      const params: { limit: number; offset: number; status?: string } = {
        limit: DELIVERY_PAGE_SIZE,
        offset,
      };
      if (status) params.status = status;
      const data = await adminApi.getWebhookDeliveries(webhookId, params);
      setDeliveries(data);
    } catch (err) {
      toast.error('Failed to fetch deliveries');
    } finally {
      setDeliveriesLoading(false);
    }
  }, [toast]);

  // Initial load + auto-refresh
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Load deliveries when expanding a webhook
  useEffect(() => {
    if (expandedWebhookId) {
      setDeliveryPage(0);
      setDeliveryStatusFilter('');
      fetchDeliveries(expandedWebhookId);
    } else {
      setDeliveries(null);
    }
  }, [expandedWebhookId, fetchDeliveries]);

  // Refetch deliveries on filter/page change
  useEffect(() => {
    if (expandedWebhookId) {
      fetchDeliveries(expandedWebhookId, deliveryPage * DELIVERY_PAGE_SIZE, deliveryStatusFilter);
    }
  }, [expandedWebhookId, deliveryPage, deliveryStatusFilter, fetchDeliveries]);

  async function handleReplay(deliveryId: string) {
    setReplayingId(deliveryId);
    try {
      const result = await adminApi.replayDelivery(deliveryId);
      if (result.success) {
        toast.success('Delivery replayed successfully');
      } else {
        toast.error('Replay attempt failed');
      }
      // Refresh deliveries and stats
      if (expandedWebhookId) {
        fetchDeliveries(expandedWebhookId, deliveryPage * DELIVERY_PAGE_SIZE, deliveryStatusFilter);
      }
      fetchStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to replay delivery');
    } finally {
      setReplayingId(null);
      setReplayTarget(null);
    }
  }

  const deliveryColumns: Column<WebhookDeliveryRecord>[] = [
    {
      header: 'Event',
      span: 3,
      tabletSpan: 2,
      mobileLabel: 'Event',
      accessor: (d) => <span className="font-mono text-sm">{d.event}</span>,
    },
    {
      header: 'Status',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Status',
      accessor: (d) => <StatusBadge status={d.status} />,
    },
    {
      header: 'Attempts',
      span: 1,
      tabletSpan: 1,
      mobileLabel: 'Attempts',
      accessor: (d) => <span className="text-sm">{d.attempts}</span>,
    },
    {
      header: 'Response',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Response',
      accessor: (d) => (
        <span className="text-sm font-mono">
          {d.responseCode ? d.responseCode : '-'}
        </span>
      ),
    },
    {
      header: 'Last Attempt',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Last Attempt',
      accessor: (d) => <span className="text-sm text-gray-600">{formatTimestamp(d.lastAttemptAt)}</span>,
    },
    {
      header: 'Actions',
      span: 2,
      tabletSpan: 1,
      mobileLabel: false,
      accessor: (d) =>
        d.status === 'failed' ? (
          <button
            onClick={() => setReplayTarget(d.id)}
            disabled={replayingId === d.id}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {replayingId === d.id ? <><Spinner />Replaying...</> : 'Replay'}
          </button>
        ) : null,
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonBox className="h-8 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonBox className="h-24" />
          <SkeletonBox className="h-24" />
          <SkeletonBox className="h-24" />
        </div>
        <div className="space-y-4">
          <SkeletonBox className="h-32" />
          <SkeletonBox className="h-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl sm:text-2xl font-bold">Webhook Observability</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">Webhook Observability</h1>
        <span className="text-sm text-gray-500">Auto-refreshes every 30s</span>
      </div>

      {/* Overall Health Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Success Rate</p>
          <p className="text-2xl font-bold">
            <span className={stats.successRate >= 95 ? 'text-green-600' : stats.successRate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
              {stats.successRate}%
            </span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {stats.successCount} / {stats.totalDeliveries} deliveries
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Pending Retries</p>
          <p className="text-2xl font-bold">
            <span className={stats.pendingRetryCount > 0 ? 'text-yellow-600' : 'text-gray-900'}>
              {stats.pendingRetryCount}
            </span>
          </p>
          <p className="text-xs text-gray-400 mt-1">Awaiting retry</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Failed Deliveries</p>
          <p className="text-2xl font-bold">
            <span className={stats.failureCount > 0 ? 'text-red-600' : 'text-gray-900'}>
              {stats.failureCount}
            </span>
          </p>
          <p className="text-xs text-gray-400 mt-1">Total failures</p>
        </div>
      </div>

      {/* Per-Webhook Cards */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Webhooks</h2>
        {stats.perWebhook.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No webhooks configured.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stats.perWebhook.map((wh) => (
              <div key={wh.webhookId}>
                <button
                  onClick={() =>
                    setExpandedWebhookId(expandedWebhookId === wh.webhookId ? null : wh.webhookId)
                  }
                  className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <HealthIndicator successRate={wh.successRate} />
                      <span className="font-mono text-sm truncate">{wh.url}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 shrink-0">
                      <span>
                        Success: <strong className={wh.successRate >= 95 ? 'text-green-600' : wh.successRate >= 80 ? 'text-yellow-600' : 'text-red-600'}>{wh.successRate}%</strong>
                      </span>
                      {wh.pendingRetries > 0 && (
                        <span className="text-yellow-600">
                          {wh.pendingRetries} pending
                        </span>
                      )}
                      <span className="text-gray-400">
                        Last: {formatTimestamp(wh.lastDeliveryAt)}
                      </span>
                      <svg
                        className={`w-5 h-5 text-gray-400 transition-transform ${expandedWebhookId === wh.webhookId ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded Delivery Log */}
                {expandedWebhookId === wh.webhookId && (
                  <div className="mt-2 ml-0 sm:ml-5 border-l-2 border-gray-200 pl-4 space-y-4">
                    {/* Status filter */}
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-500">Filter:</label>
                      <select
                        value={deliveryStatusFilter}
                        onChange={(e) => {
                          setDeliveryStatusFilter(e.target.value);
                          setDeliveryPage(0);
                        }}
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
                      >
                        <option value="">All</option>
                        <option value="success">Success</option>
                        <option value="failed">Failed</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>

                    {deliveriesLoading ? (
                      <div className="space-y-2">
                        <SkeletonBox className="h-10" />
                        <SkeletonBox className="h-10" />
                        <SkeletonBox className="h-10" />
                      </div>
                    ) : (
                      <>
                        <ResponsiveTable
                          columns={deliveryColumns}
                          rows={deliveries?.deliveries || []}
                          keyExtractor={(d) => d.id}
                          emptyMessage="No deliveries found."
                          pagination={
                            deliveries && deliveries.pagination.total > DELIVERY_PAGE_SIZE
                              ? {
                                  total: deliveries.pagination.total,
                                  pageSize: DELIVERY_PAGE_SIZE,
                                  page: deliveryPage + 1,
                                  totalPages: Math.ceil(deliveries.pagination.total / DELIVERY_PAGE_SIZE),
                                  onPageChange: (page: number) => setDeliveryPage(page - 1),
                                }
                              : undefined
                          }
                          renderMobileCard={(d) => (
                            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-sm">{d.event}</span>
                                <StatusBadge status={d.status} />
                              </div>
                              <div className="flex items-center justify-between text-sm text-gray-600">
                                <span>Attempts: {d.attempts}</span>
                                <span>{d.responseCode ? `HTTP ${d.responseCode}` : '-'}</span>
                              </div>
                              <div className="text-xs text-gray-400">
                                {formatTimestamp(d.lastAttemptAt)}
                              </div>
                              {d.status === 'failed' && (
                                <button
                                  onClick={() => setReplayTarget(d.id)}
                                  disabled={replayingId === d.id}
                                  className="mt-2 w-full px-3 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                                >
                                  {replayingId === d.id ? <><Spinner />Replaying...</> : 'Replay'}
                                </button>
                              )}
                            </div>
                          )}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Replay Confirm Dialog */}
      <ConfirmDialog
        open={replayTarget !== null}
        onClose={() => setReplayTarget(null)}
        onConfirm={() => {
          if (replayTarget) handleReplay(replayTarget);
        }}
        title="Replay Delivery"
        message="Re-send this failed webhook delivery? The original payload will be sent again to the webhook URL."
        confirmLabel="Replay"
        variant="default"
      />
    </div>
  );
}
