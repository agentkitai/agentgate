import { useState } from 'react';
import {
  simulationApi,
  api,
  type SimulateResponse,
  type DryRunResponse,
  type ListPoliciesResponse,
} from '../api';

type TimeRange = '24h' | '7d' | '30d' | 'custom';

function getDateRange(range: TimeRange, customFrom: string, customTo: string) {
  if (range === 'custom') {
    return { from: customFrom || undefined, to: customTo || undefined };
  }
  const now = new Date();
  const from = new Date(now);
  if (range === '24h') from.setHours(from.getHours() - 24);
  else if (range === '7d') from.setDate(from.getDate() - 7);
  else if (range === '30d') from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: now.toISOString() };
}

const DEFAULT_RULES = JSON.stringify(
  [
    {
      match: { action: 'send_email' },
      decision: 'auto_approve',
    },
  ],
  null,
  2
);

const decisionColors: Record<string, string> = {
  auto_approve: 'text-green-700 bg-green-50',
  auto_deny: 'text-red-700 bg-red-50',
  route_to_human: 'text-yellow-700 bg-yellow-50',
  route_to_agent: 'text-blue-700 bg-blue-50',
};

function DecisionBadge({ decision }: { decision: string }) {
  const color = decisionColors[decision] || 'text-gray-700 bg-gray-50';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
      {decision}
    </span>
  );
}

export default function PolicySimulator() {
  // Batch simulation state
  const [rulesJson, setRulesJson] = useState(DEFAULT_RULES);
  const [priority, setPriority] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [simLimit, setSimLimit] = useState(100);
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // Dry-run state
  const [dryRunPolicyId, setDryRunPolicyId] = useState('');
  const [dryRunAction, setDryRunAction] = useState('');
  const [dryRunParams, setDryRunParams] = useState('{}');
  const [dryRunUrgency, setDryRunUrgency] = useState('normal');
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  // Policies list for dry-run dropdown
  const [policiesList, setPoliciesList] = useState<ListPoliciesResponse['policies']>([]);
  const [policiesLoaded, setPoliciesLoaded] = useState(false);

  async function loadPolicies() {
    if (policiesLoaded) return;
    try {
      const res = await api.listPolicies({ limit: 100 });
      setPoliciesList(res.policies);
      if (res.policies.length > 0 && !dryRunPolicyId) {
        setDryRunPolicyId(res.policies[0].id);
      }
    } catch {
      // Non-fatal
    }
    setPoliciesLoaded(true);
  }

  async function runSimulation() {
    setSimError(null);
    setSimResult(null);
    setSimLoading(true);

    try {
      const rules = JSON.parse(rulesJson);
      if (!Array.isArray(rules)) throw new Error('Rules must be a JSON array');

      const { from, to } = getDateRange(timeRange, customFrom, customTo);
      const result = await simulationApi.simulate({
        rules,
        priority,
        from,
        to,
        limit: simLimit,
      });
      setSimResult(result);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  }

  async function runDryRun() {
    setDryRunError(null);
    setDryRunResult(null);
    setDryRunLoading(true);

    try {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(dryRunParams);
      } catch {
        throw new Error('Invalid JSON in params field');
      }

      const result = await simulationApi.dryRun(dryRunPolicyId, {
        action: dryRunAction,
        params,
        urgency: dryRunUrgency,
      });
      setDryRunResult(result);
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : 'Dry-run failed');
    } finally {
      setDryRunLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Policy Simulator</h1>
        <p className="text-gray-500 mt-1">
          Test policy rules against historical requests or run single-request dry-runs.
        </p>
      </div>

      {/* Batch Simulation Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900">Batch Simulation</h2>
        <p className="text-sm text-gray-500">
          Evaluate a set of candidate policy rules against historical approval requests.
        </p>

        {/* Rules JSON Editor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Policy Rules (JSON)
          </label>
          <textarea
            className="w-full h-48 font-mono text-sm border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={rulesJson}
            onChange={(e) => setRulesJson(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Priority */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <input
              type="number"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>

          {/* Time Range Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time Range</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            >
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          {/* Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Requests</label>
            <input
              type="number"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={simLimit}
              min={1}
              max={500}
              onChange={(e) => setSimLimit(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Custom date fields */}
        {timeRange === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <input
                type="datetime-local"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="datetime-local"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Run button */}
        <button
          onClick={runSimulation}
          disabled={simLoading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {simLoading ? 'Running Simulation...' : 'Run Simulation'}
        </button>

        {/* Error */}
        {simError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {simError}
          </div>
        )}

        {/* Results */}
        {simResult && (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 font-medium">Total</p>
                <p className="text-xl font-bold text-gray-900">{simResult.total}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 font-medium">Auto-Approved</p>
                <p className="text-xl font-bold text-green-700">{simResult.results.autoApproved}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-xs text-red-600 font-medium">Auto-Denied</p>
                <p className="text-xl font-bold text-red-700">{simResult.results.autoDenied}</p>
              </div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center">
                <p className="text-xs text-yellow-600 font-medium">Routed to Human</p>
                <p className="text-xl font-bold text-yellow-700">{simResult.results.routedToHuman}</p>
              </div>
            </div>

            {/* Changed count */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <strong>{simResult.changed}</strong> of {simResult.total} requests would have a{' '}
              <strong>different</strong> decision compared to current policies.
            </div>

            {/* Details Table */}
            {simResult.details.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-medium text-gray-600">Request ID</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-600">Action</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-600">Current</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-600">Candidate</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-600">Changed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simResult.details.map((d) => (
                      <tr
                        key={d.requestId}
                        className={`border-b border-gray-100 ${d.changed ? 'bg-amber-50' : ''}`}
                      >
                        <td className="py-2 px-3 font-mono text-xs text-gray-700">
                          {d.requestId.slice(0, 12)}...
                        </td>
                        <td className="py-2 px-3 text-gray-800">{d.action}</td>
                        <td className="py-2 px-3">
                          <DecisionBadge decision={d.currentDecision} />
                        </td>
                        <td className="py-2 px-3">
                          <DecisionBadge decision={d.candidateDecision} />
                        </td>
                        <td className="py-2 px-3">
                          {d.changed ? (
                            <span className="text-amber-600 font-medium">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Single Request Dry-Run Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900">Single Request Dry-Run</h2>
        <p className="text-sm text-gray-500">
          Test how a specific policy would handle a single synthetic request.
        </p>

        {/* Policy selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Policy</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={dryRunPolicyId}
            onFocus={loadPolicies}
            onChange={(e) => setDryRunPolicyId(e.target.value)}
          >
            {!policiesLoaded && <option value="">Loading policies...</option>}
            {policiesLoaded && policiesList.length === 0 && (
              <option value="">No policies found</option>
            )}
            {policiesList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (priority: {p.priority})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Action */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. send_email"
              value={dryRunAction}
              onChange={(e) => setDryRunAction(e.target.value)}
            />
          </div>

          {/* Urgency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Urgency</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={dryRunUrgency}
              onChange={(e) => setDryRunUrgency(e.target.value)}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        {/* Params JSON */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Params (JSON)</label>
          <textarea
            className="w-full h-24 font-mono text-sm border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={dryRunParams}
            onChange={(e) => setDryRunParams(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Run button */}
        <button
          onClick={runDryRun}
          disabled={dryRunLoading || !dryRunPolicyId || !dryRunAction}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {dryRunLoading ? 'Running...' : 'Run Dry-Run'}
        </button>

        {/* Error */}
        {dryRunError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {dryRunError}
          </div>
        )}

        {/* Result */}
        {dryRunResult && (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-600">Decision:</span>
              <DecisionBadge decision={dryRunResult.decision} />
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">Reason:</span>
              <p className="text-sm text-gray-800 mt-1">{dryRunResult.reason}</p>
            </div>
            {dryRunResult.matchedRule && (
              <div>
                <span className="text-sm font-medium text-gray-600">Matched Rule:</span>
                <pre className="mt-1 bg-white border border-gray-200 rounded p-2 text-xs font-mono overflow-x-auto">
                  {JSON.stringify(dryRunResult.matchedRule, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
