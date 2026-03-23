import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, type ApprovalRequest, type ApprovalStatus } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';

type StatusFilter = 'all' | ApprovalStatus;

export default function RequestList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const statusFilter = (searchParams.get('status') || 'all') as StatusFilter;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const fetchRequests = useCallback(async () => {
    try {
      setError(null);
      const params: { status?: string; limit: number } = { limit: 50 };
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      const response = await api.listRequests(params);
      if (!mounted.current) return;
      setRequests(response.requests);
      setTotal(response.pagination.total);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    mounted.current = true;
    fetchRequests();
    
    // Auto-refresh pending requests every 5 seconds, visibility-aware
    intervalRef.current = setInterval(() => {
      if (statusFilter === 'pending' || statusFilter === 'all') {
        fetchRequests();
      }
    }, 5000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else {
        fetchRequests();
        intervalRef.current = setInterval(() => {
          if (statusFilter === 'pending' || statusFilter === 'all') {
            fetchRequests();
          }
        }, 5000);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchRequests, statusFilter]);

  const handleStatusChange = (status: StatusFilter) => {
    if (status === 'all') {
      searchParams.delete('status');
    } else {
      searchParams.set('status', status);
    }
    setSearchParams(searchParams);
    setLoading(true);
  };

  const urgencyColors: Record<string, string> = {
    low: 'text-gray-500 bg-gray-100',
    normal: 'text-blue-600 bg-blue-100',
    high: 'text-orange-600 bg-orange-100',
    critical: 'text-red-600 bg-red-100',
  };

  const tabs: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'denied', label: 'Denied' },
    { value: 'expired', label: 'Expired' },
  ];

  const columns: Column<ApprovalRequest>[] = [
    {
      header: 'ID',
      span: 3,
      tabletSpan: 2,
      mobileLabel: 'ID',
      accessor: (r) => (
        <span className="font-mono text-sm text-gray-600 truncate">{r.id}</span>
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
      header: 'Status',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Status',
      accessor: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: 'Urgency',
      span: 2,
      hideOnTablet: true,
      mobileLabel: 'Urgency',
      accessor: (r) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${urgencyColors[r.urgency]}`}>
          {r.urgency.toUpperCase()}
        </span>
      ),
    },
    {
      header: 'Created',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Created',
      accessor: (r) => (
        <span className="text-sm text-gray-500">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Approval Requests</h1>
        <span className="text-sm text-gray-500">
          {total} {total === 1 ? 'request' : 'requests'}
        </span>
      </div>

      {/* Status filter tabs - horizontal scroll on mobile */}
      <div className="border-b border-gray-200 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
        <nav className="flex gap-1 sm:gap-4 min-w-max -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleStatusChange(tab.value)}
              className={`py-3 px-3 sm:px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                statusFilter === tab.value
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* When not loading and empty, show custom empty state to preserve "Show all" button */}
      {!loading && requests.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No requests found</p>
          {statusFilter !== 'all' && (
            <button
              onClick={() => handleStatusChange('all')}
              className="mt-2 text-blue-600 hover:text-blue-800 text-sm"
            >
              Show all requests
            </button>
          )}
        </div>
      ) : (
        <ResponsiveTable
          columns={columns}
          rows={requests}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyMessage="No requests found"
          onRowClick={(r) => navigate(`/requests/${r.id}`)}
          renderMobileCard={(request) => (
            <div
              onClick={() => navigate(`/requests/${request.id}`)}
              className="bg-white rounded-lg border border-gray-200 p-4 active:bg-gray-50 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-medium text-gray-900">{request.action}</h3>
                <StatusBadge status={request.status} />
              </div>
              <p className="font-mono text-xs text-gray-500 truncate mb-3">
                {request.id}
              </p>
              <div className="flex items-center justify-between text-sm">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${urgencyColors[request.urgency]}`}>
                  {request.urgency.toUpperCase()}
                </span>
                <span className="text-gray-500">
                  {new Date(request.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
