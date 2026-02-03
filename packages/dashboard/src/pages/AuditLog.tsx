import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, type AuditEntryWithRequest } from '../api';
import { StatusBadge } from '../components/StatusBadge';

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

export default function AuditLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<AuditEntryWithRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter options from API
  const [actions, setActions] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);

  // Current filters from URL
  const action = searchParams.get('action') || '';
  const status = searchParams.get('status') || '';
  const eventType = searchParams.get('eventType') || '';
  const actor = searchParams.get('actor') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const offset = (page - 1) * PAGE_SIZE;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Fetch filter options on mount
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

  // Fetch audit entries
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

  // Update URL params
  const updateFilter = (key: string, value: string) => {
    if (value) {
      searchParams.set(key, value);
    } else {
      searchParams.delete(key);
    }
    // Reset to page 1 when filters change
    if (key !== 'page') {
      searchParams.delete('page');
    }
    setSearchParams(searchParams);
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const hasFilters = action || status || eventType || actor || from || to;

  const eventTypeColors: Record<string, string> = {
    created: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    denied: 'bg-red-100 text-red-800',
    expired: 'bg-gray-100 text-gray-800',
    viewed: 'bg-purple-100 text-purple-800',
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const formatDateShort = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString();
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Event Type Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Event Type
            </label>
            <select
              value={eventType}
              onChange={(e) => updateFilter('eventType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {EVENT_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Request Status
            </label>
            <select
              value={status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Action Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Action
            </label>
            <select
              value={action}
              onChange={(e) => updateFilter('action', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Actor Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Actor
            </label>
            <select
              value={actor}
              onChange={(e) => updateFilter('actor', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Actors</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => updateFilter('from', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => updateFilter('to', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={fetchEntries}
            className="mt-2 text-red-700 hover:text-red-800 text-sm font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No audit entries found</p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="mt-2 text-blue-600 hover:text-blue-800 text-sm"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500">
              <div className="col-span-2">Timestamp</div>
              <div className="col-span-2">Event</div>
              <div className="col-span-2">Actor</div>
              <div className="col-span-3">Action</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1">Request</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-gray-200">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="col-span-2 text-sm text-gray-600">
                    <div>{formatDateShort(entry.createdAt)}</div>
                    <div className="text-xs text-gray-400">{formatTime(entry.createdAt)}</div>
                  </div>
                  <div className="col-span-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${eventTypeColors[entry.eventType] || 'bg-gray-100 text-gray-800'}`}>
                      {entry.eventType.toUpperCase()}
                    </span>
                  </div>
                  <div className="col-span-2 text-sm text-gray-900 truncate">
                    {entry.actor}
                  </div>
                  <div className="col-span-3 text-sm font-medium text-gray-900 truncate">
                    {entry.request?.action || '-'}
                  </div>
                  <div className="col-span-2">
                    {entry.request?.status ? (
                      <StatusBadge status={entry.request.status as 'pending' | 'approved' | 'denied' | 'expired'} />
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </div>
                  <div className="col-span-1">
                    <button
                      onClick={() => navigate(`/requests/${entry.requestId}`)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tablet Table */}
          <div className="hidden sm:block lg:hidden bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-6 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500">
              <div className="col-span-1">Time</div>
              <div className="col-span-1">Event</div>
              <div className="col-span-2">Action</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1">Link</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-gray-200">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-6 gap-2 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="col-span-1 text-xs text-gray-600">
                    <div>{formatDateShort(entry.createdAt)}</div>
                    <div className="text-gray-400">{formatTime(entry.createdAt)}</div>
                  </div>
                  <div className="col-span-1">
                    <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${eventTypeColors[entry.eventType] || 'bg-gray-100 text-gray-800'}`}>
                      {entry.eventType.slice(0, 6).toUpperCase()}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {entry.request?.action || '-'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{entry.actor}</div>
                  </div>
                  <div className="col-span-1">
                    {entry.request?.status ? (
                      <StatusBadge status={entry.request.status as 'pending' | 'approved' | 'denied' | 'expired'} />
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </div>
                  <div className="col-span-1">
                    <button
                      onClick={() => navigate(`/requests/${entry.requestId}`)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="sm:hidden space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                onClick={() => navigate(`/requests/${entry.requestId}`)}
                className="bg-white rounded-lg border border-gray-200 p-4 active:bg-gray-50 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${eventTypeColors[entry.eventType] || 'bg-gray-100 text-gray-800'}`}>
                    {entry.eventType.toUpperCase()}
                  </span>
                  {entry.request?.status && (
                    <StatusBadge status={entry.request.status as 'pending' | 'approved' | 'denied' | 'expired'} />
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
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white rounded-lg border border-gray-200 px-4 py-3">
              <span className="text-sm text-gray-500">
                Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateFilter('page', String(page - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => updateFilter('page', String(page + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
