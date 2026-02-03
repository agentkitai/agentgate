import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type ApprovalRequest, type AuditLogEntry } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { AuditLog } from '../components/AuditLog';

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  
  const [request, setRequest] = useState<ApprovalRequest | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!id) return;
      
      try {
        setError(null);
        const [requestData, auditData] = await Promise.all([
          api.getRequest(id),
          api.getAuditLog(id),
        ]);
        setRequest(requestData);
        setAuditLog(auditData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load request');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  const handleDecision = async (decision: 'approved' | 'denied') => {
    if (!id || !request) return;
    
    const reason = decision === 'denied' 
      ? prompt('Reason for denial (optional):')
      : prompt('Reason for approval (optional):');
    
    setDeciding(true);
    setDecisionError(null);
    
    try {
      const updated = await api.decide(id, decision, 'dashboard-user', reason || undefined);
      setRequest(updated);
      
      // Refresh audit log
      const auditData = await api.getAuditLog(id);
      setAuditLog(auditData);
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : 'Failed to submit decision');
    } finally {
      setDeciding(false);
    }
  };

  const urgencyColors = {
    low: 'bg-gray-100 text-gray-700',
    normal: 'bg-blue-100 text-blue-700',
    high: 'bg-orange-100 text-orange-700',
    critical: 'bg-red-100 text-red-700',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="space-y-4">
        <Link
          to="/requests"
          className="inline-flex items-center text-blue-600 hover:text-blue-800"
        >
          ← Back to requests
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium">Error loading request</h3>
          <p className="text-red-600 text-sm mt-1">{error || 'Request not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        to="/requests"
        className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm sm:text-base"
      >
        ← Back to requests
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{request.action}</h1>
              <StatusBadge status={request.status} />
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${urgencyColors[request.urgency]}`}>
                {request.urgency.toUpperCase()}
              </span>
            </div>
            <p className="text-gray-500 font-mono text-xs sm:text-sm mt-2 break-all">
              ID: {request.id}
            </p>
          </div>
          
          {/* Approval actions */}
          {request.status === 'pending' && (
            <div className="flex gap-3 pt-2 sm:pt-0">
              <button
                onClick={() => handleDecision('denied')}
                disabled={deciding}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 disabled:opacity-50 transition-colors"
              >
                Deny
              </button>
              <button
                onClick={() => handleDecision('approved')}
                disabled={deciding}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Approve
              </button>
            </div>
          )}
        </div>

        {decisionError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-600 text-sm">{decisionError}</p>
          </div>
        )}

        {request.decisionReason && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Decision reason:</p>
            <p className="text-gray-700">{request.decisionReason}</p>
          </div>
        )}
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Params */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Parameters</h2>
          {Object.keys(request.params).length === 0 ? (
            <p className="text-gray-500 text-sm">No parameters</p>
          ) : (
            <pre className="bg-gray-50 rounded-lg p-3 sm:p-4 text-xs sm:text-sm overflow-x-auto text-gray-700">
              {JSON.stringify(request.params, null, 2)}
            </pre>
          )}
        </div>

        {/* Context */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Context</h2>
          {Object.keys(request.context).length === 0 ? (
            <p className="text-gray-500 text-sm">No context</p>
          ) : (
            <pre className="bg-gray-50 rounded-lg p-3 sm:p-4 text-xs sm:text-sm overflow-x-auto text-gray-700">
              {JSON.stringify(request.context, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* Timestamps */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Timeline</h2>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Created</dt>
            <dd className="text-gray-900 text-sm sm:text-base">{new Date(request.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Updated</dt>
            <dd className="text-gray-900 text-sm sm:text-base">{new Date(request.updatedAt).toLocaleString()}</dd>
          </div>
          {request.decidedAt && (
            <div>
              <dt className="text-sm text-gray-500">Decided</dt>
              <dd className="text-gray-900 text-sm sm:text-base">{new Date(request.decidedAt).toLocaleString()}</dd>
            </div>
          )}
          {request.decidedBy && (
            <div>
              <dt className="text-sm text-gray-500">Decided by</dt>
              <dd className="text-gray-900 text-sm sm:text-base break-all">{request.decidedBy}</dd>
            </div>
          )}
          {request.expiresAt && (
            <div>
              <dt className="text-sm text-gray-500">Expires</dt>
              <dd className="text-gray-900 text-sm sm:text-base">{new Date(request.expiresAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Audit Trail */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Audit Trail</h2>
        <AuditLog entries={auditLog} />
      </div>
    </div>
  );
}
