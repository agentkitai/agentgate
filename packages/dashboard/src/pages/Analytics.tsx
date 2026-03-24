import { useEffect, useState, useRef, useCallback } from 'react';
import {
  analyticsApi,
  type AnalyticsOverview,
  type TrendBucket,
  type PolicyStat,
} from '../api';

type TimeRange = '24h' | '7d' | '30d';

function getDateRange(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (range === '24h') {
    from.setHours(from.getHours() - 24);
  } else if (range === '7d') {
    from.setDate(from.getDate() - 7);
  } else {
    from.setDate(from.getDate() - 30);
  }
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ---- KPI Card ----
function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// ---- SVG Bar Chart ----
function TrendChart({ trends }: { trends: TrendBucket[] }) {
  if (trends.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
        No data for the selected time range
      </div>
    );
  }

  const maxRequests = Math.max(...trends.map((t) => t.requests), 1);
  const chartHeight = 200;
  const barGap = 4;
  const chartPaddingBottom = 40;
  const chartPaddingTop = 10;
  const chartPaddingLeft = 40;
  const usableHeight = chartHeight - chartPaddingBottom - chartPaddingTop;

  // Calculate bar width based on available space
  const totalWidth = 600;
  const usableWidth = totalWidth - chartPaddingLeft;
  const barWidth = Math.max(
    8,
    Math.min(40, (usableWidth - barGap * trends.length) / trends.length)
  );
  const svgWidth = chartPaddingLeft + trends.length * (barWidth + barGap);

  // Y-axis ticks
  const yTicks = [0, Math.round(maxRequests / 2), maxRequests];

  return (
    <div className="overflow-x-auto">
      <svg
        width={Math.max(svgWidth, totalWidth)}
        height={chartHeight}
        className="block"
        role="img"
        aria-label="Request trends bar chart"
      >
        {/* Y-axis ticks and grid lines */}
        {yTicks.map((tick) => {
          const y =
            chartPaddingTop +
            usableHeight -
            (tick / maxRequests) * usableHeight;
          return (
            <g key={tick}>
              <line
                x1={chartPaddingLeft}
                x2={Math.max(svgWidth, totalWidth)}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="4 2"
              />
              <text
                x={chartPaddingLeft - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="#9ca3af"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {trends.map((t, i) => {
          const x = chartPaddingLeft + i * (barWidth + barGap);
          const approvedH = (t.approved / maxRequests) * usableHeight;
          const deniedH = (t.denied / maxRequests) * usableHeight;
          const expiredH = (t.expired / maxRequests) * usableHeight;

          const baseY = chartPaddingTop + usableHeight;

          // Stacked: approved at bottom, then denied, then expired
          const approvedY = baseY - approvedH;
          const deniedY = approvedY - deniedH;
          const expiredY = deniedY - expiredH;

          // Label: shortened bucket
          const label =
            t.bucket.length > 10 ? t.bucket.slice(5, 10) : t.bucket.slice(5);

          return (
            <g key={t.bucket}>
              {/* Approved (green) */}
              {approvedH > 0 && (
                <rect
                  x={x}
                  y={approvedY}
                  width={barWidth}
                  height={approvedH}
                  fill="#22c55e"
                  rx={2}
                />
              )}
              {/* Denied (red) */}
              {deniedH > 0 && (
                <rect
                  x={x}
                  y={deniedY}
                  width={barWidth}
                  height={deniedH}
                  fill="#ef4444"
                  rx={2}
                />
              )}
              {/* Expired (gray) */}
              {expiredH > 0 && (
                <rect
                  x={x}
                  y={expiredY}
                  width={barWidth}
                  height={expiredH}
                  fill="#9ca3af"
                  rx={2}
                />
              )}
              {/* X-axis label */}
              <text
                x={x + barWidth / 2}
                y={baseY + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#6b7280"
                transform={`rotate(-30 ${x + barWidth / 2} ${baseY + 14})`}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- Export CSV ----
function exportCsv(trends: TrendBucket[]) {
  const header = 'bucket,requests,approved,denied,expired,avgDecisionTimeMs';
  const rows = trends.map(
    (t) =>
      `${t.bucket},${t.requests},${t.approved},${t.denied},${t.expired},${t.avgDecisionTimeMs}`
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agentgate-trends-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Main Page ----
export default function Analytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [trends, setTrends] = useState<TrendBucket[]>([]);
  const [policyStats, setPolicyStats] = useState<PolicyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchData = useCallback(async (range: TimeRange) => {
    try {
      setError(null);
      setLoading(true);
      const { from, to } = getDateRange(range);
      const bucket = range === '24h' ? 'hour' : 'day';

      const [overviewData, trendsData, policiesData] = await Promise.all([
        analyticsApi.getOverview({ from, to }),
        analyticsApi.getTrends({ from, to, bucket }),
        analyticsApi.getPolicies(),
      ]);

      if (!mounted.current) return;
      setOverview(overviewData);
      setTrends(trendsData.trends);
      setPolicyStats(policiesData.policies);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchData(timeRange);
    return () => {
      mounted.current = false;
    };
  }, [timeRange, fetchData]);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Analytics & Governance KPIs
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Approval workflow metrics and policy performance
          </p>
        </div>

        {/* Time range selector */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['24h', '7d', '30d'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                timeRange === range
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium">Error loading analytics</h3>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {loading && !overview ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 animate-pulse"
            >
              <div className="h-4 w-20 bg-gray-200 rounded mb-3" />
              <div className="h-8 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : overview ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="Total Requests"
              value={overview.totalRequests.toLocaleString()}
              color="text-gray-900"
            />
            <KpiCard
              label="Approval Rate"
              value={formatPercent(overview.approvalRate)}
              color="text-green-600"
            />
            <KpiCard
              label="Avg Decision Time"
              value={formatMs(overview.avgDecisionTimeMs)}
              color="text-blue-600"
            />
            <KpiCard
              label="Auto-Approve Rate"
              value={formatPercent(overview.autoApproveRate)}
              color="text-purple-600"
            />
          </div>

          {/* Status breakdown row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <div>
                <p className="text-xs text-gray-500">Approved</p>
                <p className="font-semibold text-gray-900">{overview.approved}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div>
                <p className="text-xs text-gray-500">Denied</p>
                <p className="font-semibold text-gray-900">{overview.denied}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div>
                <p className="text-xs text-gray-500">Pending</p>
                <p className="font-semibold text-gray-900">{overview.pending}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Expired</p>
                <p className="font-semibold text-gray-900">{overview.expired}</p>
              </div>
            </div>
          </div>

          {/* Trends Chart */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Request Trends
              </h2>
              <div className="flex items-center gap-4">
                {/* Legend */}
                <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-green-500 inline-block" />
                    Approved
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-red-500 inline-block" />
                    Denied
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-gray-400 inline-block" />
                    Expired
                  </span>
                </div>
                <button
                  onClick={() => exportCsv(trends)}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Export CSV
                </button>
              </div>
            </div>
            <TrendChart trends={trends} />
          </div>

          {/* Policy Breakdown */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Policy Breakdown
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-4 sm:px-6 py-3 font-medium text-gray-500">
                      Policy
                    </th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-gray-500 text-right">
                      Hit Count
                    </th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-gray-500 text-right">
                      Auto-Approve
                    </th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-gray-500 text-right">
                      Auto-Deny
                    </th>
                    <th className="px-4 sm:px-6 py-3 font-medium text-gray-500 text-right">
                      Route to Human
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {policyStats.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 sm:px-6 py-6 text-center text-gray-500"
                      >
                        No policy data available
                      </td>
                    </tr>
                  ) : (
                    policyStats.map((p) => (
                      <tr
                        key={p.policyId}
                        className={`border-b border-gray-50 ${
                          p.policyId === '_aggregate'
                            ? 'bg-gray-50 font-medium'
                            : ''
                        }`}
                      >
                        <td className="px-4 sm:px-6 py-3 text-gray-900">
                          {p.policyName}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-gray-700 text-right">
                          {p.hitCount}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-green-600 text-right">
                          {p.autoApproveCount}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-red-600 text-right">
                          {p.autoDenyCount}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-blue-600 text-right">
                          {p.routeToHumanCount}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
