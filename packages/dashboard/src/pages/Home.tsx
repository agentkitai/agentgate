import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApprovalRequest } from '../api';
import { RequestCard } from '../components/RequestCard';

export default function Home() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [recentRequests, setRecentRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setError(null);
        
        // Fetch pending count
        const pendingResponse = await api.listRequests({ status: 'pending', limit: 1 });
        setPendingCount(pendingResponse.pagination.total);
        
        // Fetch recent requests
        const recentResponse = await api.listRequests({ limit: 5 });
        setRecentRequests(recentResponse.requests);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error loading dashboard</h3>
        <p className="text-red-600 text-sm mt-1">{error}</p>
        <p className="text-red-600 text-sm mt-2">
          Make sure you're authenticated and the AgentGate server is running.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/requests?status=pending"
          className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-shadow active:bg-gray-50"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Pending Requests</p>
              <p className="text-2xl sm:text-3xl font-bold text-yellow-600 mt-1">
                {pendingCount ?? '—'}
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-yellow-100 rounded-full flex items-center justify-center">
              <span className="text-xl sm:text-2xl">⏳</span>
            </div>
          </div>
        </Link>
        
        <Link
          to="/requests"
          className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-shadow active:bg-gray-50"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">View All Requests</p>
              <p className="text-base sm:text-lg font-medium text-gray-700 mt-1">
                Browse & filter
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-xl sm:text-2xl">📋</span>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Activity */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          <Link
            to="/requests"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            View all →
          </Link>
        </div>
        
        {recentRequests.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 sm:p-8 text-center">
            <p className="text-gray-500">No requests yet</p>
            <p className="text-gray-400 text-sm mt-1">
              Requests will appear here when agents start using AgentGate
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentRequests.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
