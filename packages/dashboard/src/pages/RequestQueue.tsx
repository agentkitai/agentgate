import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ApprovalRequestWithSla, type QueueStatsResponse } from '../api';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

type SortOption = 'urgency' | 'created_at' | 'sla_remaining';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'urgency', label: 'Most Urgent' },
  { value: 'created_at', label: 'Oldest First' },
  { value: 'sla_remaining', label: 'Nearest SLA' },
];

const urgencyColors: Record<string, string> = {
  low: 'text-gray-500 bg-gray-100',
  normal: 'text-blue-600 bg-blue-100',
  high: 'text-orange-600 bg-orange-100',
  critical: 'text-red-600 bg-red-100',
};

function formatSlaTimer(slaRemainingMs: number | null): { text: string; color: string } {
  if (slaRemainingMs === null) {
    return { text: 'No SLA', color: 'text-gray-400' };
  }
  if (slaRemainingMs <= 0) {
    return { text: 'Expired', color: 'text-red-600 font-semibold' };
  }

  const totalSeconds = Math.floor(slaRemainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let text: string;
  if (hours > 0) {
    text = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    text = `${minutes}m ${seconds}s`;
  } else {
    text = `${seconds}s`;
  }

  let color: string;
  if (slaRemainingMs > 60 * 60 * 1000) {
    color = 'text-green-600';
  } else if (slaRemainingMs > 15 * 60 * 1000) {
    color = 'text-yellow-600';
  } else {
    color = 'text-red-600 font-semibold';
  }

  return { text, color };
}

export default function RequestQueue() {
  const navigate = useNavigate();
  const toast = useToast();

  const [requests, setRequests] = useState<ApprovalRequestWithSla[]>([]);
  const [stats, setStats] = useState<QueueStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('urgency');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<'approved' | 'denied' | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [reqResponse, statsResponse] = await Promise.all([
        api.listRequests({ status: 'pending', sort, limit: 100 }),
        api.getQueueStats(),
      ]);
      if (!mounted.current) return;
      setRequests(reqResponse.requests);
      setStats(statsResponse);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    fetchData();

    intervalRef.current = setInterval(() => {
      fetchData();
    }, 5000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else {
        fetchData();
        intervalRef.current = setInterval(() => {
          fetchData();
        }, 5000);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === requests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(requests.map((r) => r.id)));
    }
  };

  const handleBulkDecision = async () => {
    if (!confirmAction || selected.size === 0) return;
    setBulkProcessing(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of selected) {
      try {
        await api.decide(id, confirmAction, 'dashboard-user');
        successCount++;
      } catch {
        failCount++;
      }
    }

    setBulkProcessing(false);
    setConfirmAction(null);
    setSelected(new Set());

    if (failCount === 0) {
      toast.success(`${successCount} request${successCount !== 1 ? 's' : ''} ${confirmAction}`);
    } else {
      toast.error(`${successCount} succeeded, ${failCount} failed`);
    }

    fetchData();
  };

  const columns: Column<ApprovalRequestWithSla>[] = [
    {
      header: '',
      span: 1,
      tabletSpan: 0,
      mobileLabel: false,
      accessor: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={(e) => {
            e.stopPropagation();
            toggleSelect(r.id);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      ),
    },
    {
      header: 'Action',
      span: 3,
      tabletSpan: 2,
      mobileLabel: false,
      accessor: (r) => (
        <span className="font-medium text-gray-900 truncate">{r.action}</span>
      ),
    },
    {
      header: 'Urgency',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Urgency',
      accessor: (r) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${urgencyColors[r.urgency]}`}>
          {r.urgency.toUpperCase()}
        </span>
      ),
    },
    {
      header: 'SLA Timer',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'SLA',
      accessor: (r) => {
        const { text, color } = formatSlaTimer(r.slaRemainingMs);
        return <span className={`text-sm ${color}`}>{text}</span>;
      },
    },
    {
      header: 'Source / Context',
      span: 2,
      hideOnTablet: true,
      mobileLabel: 'Source',
      accessor: (r) => {
        const agentId = typeof r.context?.agentId === 'string' ? r.context.agentId : null;
        return (
          <span className="text-sm text-gray-600 truncate">
            {agentId || r.action.split('.')[0] || '-'}
          </span>
        );
      },
    },
    {
      header: 'Created',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Created',
      accessor: (r) => (
        <span className="text-sm text-gray-500">
          {new Date(r.createdAt).toLocaleDateString()}{' '}
          {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Triage Queue</h1>
        <div className="flex items-center gap-3">
          <label htmlFor="sort-select" className="text-sm text-gray-500">
            Sort:
          </label>
          <select
            id="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Queue stats bar */}
      {stats && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900 text-lg">{stats.total_pending}</span>{' '}
              pending
            </div>
            <div className="h-6 w-px bg-gray-200 hidden sm:block" />
            {(['critical', 'high', 'normal', 'low'] as const).map((level) => (
              <span
                key={level}
                className={`px-2 py-0.5 text-xs font-medium rounded ${urgencyColors[level]}`}
              >
                {level.toUpperCase()}: {stats.by_urgency[level]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-blue-800 font-medium">
            {selected.size} selected
          </span>
          <button
            onClick={() => setConfirmAction('approved')}
            disabled={bulkProcessing}
            className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            Approve Selected
          </button>
          <button
            onClick={() => setConfirmAction('denied')}
            disabled={bulkProcessing}
            className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            Deny Selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Select all checkbox row for desktop */}
      {!loading && requests.length > 0 && (
        <div className="hidden lg:flex items-center gap-2 px-4">
          <input
            type="checkbox"
            checked={selected.size === requests.length && requests.length > 0}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">Select all</span>
        </div>
      )}

      {!loading && requests.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No pending requests in the queue</p>
        </div>
      ) : (
        <ResponsiveTable
          columns={columns}
          rows={requests}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyMessage="No pending requests"
          onRowClick={(r) => navigate(`/requests/${r.id}`)}
          renderMobileCard={(request) => (
            <div
              onClick={() => navigate(`/requests/${request.id}`)}
              className="bg-white rounded-lg border border-gray-200 p-4 active:bg-gray-50 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(request.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelect(request.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <h3 className="font-medium text-gray-900">{request.action}</h3>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded ${urgencyColors[request.urgency]}`}
                >
                  {request.urgency.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                {(() => {
                  const { text, color } = formatSlaTimer(request.slaRemainingMs);
                  return <span className={color}>{text}</span>;
                })()}
                <span className="text-gray-500">
                  {new Date(request.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          )}
        />
      )}

      {/* Confirm dialog for bulk actions */}
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleBulkDecision}
        title={confirmAction === 'approved' ? 'Approve Selected' : 'Deny Selected'}
        message={`Are you sure you want to ${confirmAction === 'approved' ? 'approve' : 'deny'} ${selected.size} request${selected.size !== 1 ? 's' : ''}?`}
        confirmLabel={confirmAction === 'approved' ? 'Approve' : 'Deny'}
        variant={confirmAction === 'denied' ? 'danger' : 'default'}
      />
    </div>
  );
}
