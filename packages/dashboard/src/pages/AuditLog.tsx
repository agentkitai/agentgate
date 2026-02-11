import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, type AuditEntryWithRequest, type ApprovalStatus } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';

const EVENT_TYPES = [
  { value: '', label: 'All Events' },
  { value: 'created', label: 'Created' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'expired', label: 'Expired' },
  { value: 'viewed', label: 'Viewed' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'expired', label: 'Expired' },
];

const PAGE_SIZE = 25;

const eventTypeColors: Record<string, string> = {
  created: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
  viewed: 'bg-purple-100 text-purple-800',
};

const formatDateShort = (iso: string) => new Date(iso).toLocaleDateString();
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (iso: string) => new Date(iso).toLocaleString();

export default function AuditLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<AuditEntryWithRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);

  const action = searchParams.get('action') || '';
  const status = searchParams.get('status') || '';
  const eventType = searchParams.get('eventType') || '';
  const actor = searchParams.get('actor') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * PAGE_SIZE;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const [actionsRes, actorsRes] = await Promise.all([
          api.getAuditActions(),
          api.getAuditActors(),
        ]);
        setActions(actionsRes.actions);
        setActors(actorsRes.actors);
      } catch {
        // Silently fail - filters will just be empty
      }
    };
    fetchFilterOptions();
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listAuditEntries({
        action: action || undefined,
        status: status || undefined,
        eventType: eventType || undefined,
        actor: actor || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setEntries(response.entries);
      setTotal(response.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [action, status, eventType, actor, from, to, offset]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const updateFilter = (key: string, value: string) => {
    if (value) {
      searchParams.set(key, value);
    } else {
      searchParams.delete(key);
    }
    if (key !== 'page') searchParams.delete('page');
    setSearchParams(searchParams);
  };

  const clearFilters = () => setSearchParams(new URLSearchParams());
  const hasFilters = action || status || eventType || actor || from || to;

  const columns: Column<AuditEntryWithRequest>[] = [
    {
      header: 'Timestamp',
      span: 2,
      tabletSpan: 1,
      mobileLabel: false,
      accessor: (e) => (
        <div className="text-sm text-gray-600">
          <div>{formatDateShort(e.createdAt)}</div>
          <div className="text-xs text-gray-400">{formatTime(e.createdAt)}</div>
        </div>
      ),
    },
    {
      header: 'Event',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Event',
      accessor: (e) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${eventTypeColors[e.eventType] || 'bg-gray-100 text-gray-800'}`}>
          {e.eventType.toUpperCase()}
        </span>
      ),
    },
    {
      header: 'Actor',
      span: 2,
      hideOnTablet: true,
      mobileLabel: 'Actor',
      accessor: (e) => <span className="text-sm text-gray-900 truncate">{e.actor}</span>,
    },
    {
      header: 'Action',
      span: 3,
      tabletSpan: 2,
      mobileLabel: 'Action',
      accessor: (e) => (
        <div>
          <div className="text-sm font-medium text-gray-900 truncate">{e.request?.action || '-'}</div>
          {/* Show actor on tablet since it's hidden as its own column */}
          <div className="hidden sm:block lg:hidden text-xs text-gray-500 truncate">{e.actor}</div>
        </div>
      ),
    },
    {
      header: 'Status',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Status',
      accessor: (e) =>
        e.request?.status ? (
          <StatusBadge status={e.request.status as ApprovalStatus} />
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      header: 'Request',
      span: 1,
      tabletSpan: 1,
      mobileLabel: false,
      accessor: (e) => (
        <button
          onClick={() => navigate(`/requests/${e.requestId}`)}
          className="text-blue-600 hover:text-blue-800 text-sm"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Audit Log</h1>
        <span className="text-sm text-gray-500">
          {total} {total === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-700">Filters</h2>
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm text-blue-600 hover:text-blue-800">
              Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Event Type</label>
            <select value={eventType} onChange={(e) => updateFilter('eventType', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              {EVENT_TYPES.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Request Status</label>
            <select value={status} onChange={(e) => updateFilter('status', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              {STATUS_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <select value={action} onChange={(e) => updateFilter('action', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">All Actions</option>
              {actions.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Actor</label>
            <select value={actor} onChange={(e) => updateFilter('actor', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">All Actors</option>
              {actors.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input type="date" value={from} onChange={(e) => updateFilter('from', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input type="date" value={to} onChange={(e) => updateFilter('to', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={fetchEntries} className="mt-2 text-red-700 hover:text-red-800 text-sm font-medium">
            Try again
          </button>
        </div>
      )}

      {/* Table */}
      <ResponsiveTable
        columns={columns}
        rows={entries}
        keyExtractor={(e) => e.id}
        loading={loading}
        emptyMessage={hasFilters ? 'No audit entries found' : 'No audit entries found'}
        onRowClick={(e) => navigate(`/requests/${e.requestId}`)}
        renderMobileCard={(entry) => (
          <div
            onClick={() => navigate(`/requests/${entry.requestId}`)}
            className="bg-white rounded-lg border border-gray-200 p-4 active:bg-gray-50 cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${eventTypeColors[entry.eventType] || 'bg-gray-100 text-gray-800'}`}>
                {entry.eventType.toUpperCase()}
              </span>
              {entry.request?.status && (
                <StatusBadge status={entry.request.status as ApprovalStatus} />
              )}
            </div>
            <h3 className="font-medium text-gray-900 mb-1">
              {entry.request?.action || 'Unknown Action'}
            </h3>
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{entry.actor}</span>
              <span>{formatDate(entry.createdAt)}</span>
            </div>
          </div>
        )}
        pagination={{
          page,
          totalPages,
          total,
          pageSize: PAGE_SIZE,
          onPageChange: (p) => updateFilter('page', String(p)),
        }}
      />
    </div>
  );
}
