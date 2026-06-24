import { useState, useEffect, useId } from 'react';
import {
  governanceApi,
  adminApi,
  type Agent,
  type Override,
  type OverrideAction,
} from '../api';
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { AgentsSkeleton } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';

const Spinner = () => (
  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

interface BoundKey { id: string; name: string; active: boolean; agentId: string | null }

/** Budget-vs-spend bar. spend === null means spend telemetry is unavailable. */
function BudgetBar({ budget, spend }: { budget: number | null; spend: number | null }) {
  if (budget == null) return <span className="text-sm text-gray-400">No budget</span>;
  const used = spend ?? 0;
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const over = used > budget;
  const color = over ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="w-full min-w-[7rem]">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span className={over ? 'text-red-600 font-medium' : ''}>
          {spend == null ? 'n/a' : `$${used.toFixed(2)}`}
        </span>
        <span>${budget.toFixed(2)}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Agents() {
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [keys, setKeys] = useState<BoundKey[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [spend, setSpend] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create agent
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{ name: string; budget: string }>({ name: '', budget: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<{ id: string; name: string; secret: string } | null>(null);

  // Manage (detail) + revoke
  const [manageId, setManageId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Agent | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const createTitleId = useId();
  const manageTitleId = useId();

  useEffect(() => { void fetchAll(); }, []);

  async function fetchAll() {
    try {
      setError(null);
      const [agentsRes, keysRes, overridesRes] = await Promise.all([
        governanceApi.listAgents(),
        adminApi.listApiKeys(),
        governanceApi.listOverrides(),
      ]);
      const list = agentsRes.agents || [];
      setAgents(list);
      setKeys((keysRes.keys || []).map((k) => ({ id: k.id, name: k.name, active: k.active, agentId: k.agentId })));
      setOverrides(overridesRes.overrides || []);

      // Spend is informational + may be unconfigured; fetch per active agent in
      // parallel and never let a 503/502 break the page.
      const active = list.filter((a) => a.status === 'active');
      const results = await Promise.allSettled(active.map((a) => governanceApi.getSpend(a.id)));
      const map: Record<string, number | null> = {};
      results.forEach((r, i) => {
        map[active[i]!.id] = r.status === 'fulfilled' ? r.value.periodSpendUsd : null;
      });
      setSpend(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }

  const keysFor = (id: string) => keys.filter((k) => k.agentId === id);
  const overridesFor = (id: string) => overrides.filter((o) => o.agentId === id);
  const manageAgent = manageId ? agents.find((a) => a.id === manageId) ?? null : null;

  async function createAgent() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const raw = createForm.budget.trim();
      let budget: number | null = null;
      if (raw) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) { toast.error('Budget must be a positive number'); return; }
        budget = n;
      }
      const res = await governanceApi.createAgent({ name: createForm.name.trim(), monthlyBudgetUsd: budget });
      setNewSecret({ id: res.id, name: res.name, secret: res.secret });
      setShowCreate(false);
      setCreateForm({ name: '', budget: '' });
      toast.success('Agent registered');
      void fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register agent');
    } finally {
      setIsCreating(false);
    }
  }

  async function revokeAgent(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    try {
      await governanceApi.revokeAgent(id);
      toast.success('Agent revoked');
      void fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke agent');
    } finally {
      setRevokingId(null);
    }
  }

  const columns: Column<Agent>[] = [
    {
      header: 'Agent',
      span: 3,
      mobileLabel: 'Agent',
      accessor: (a) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{a.name}</div>
          <div className="text-xs text-gray-400 font-mono truncate">{a.id}</div>
        </div>
      ),
    },
    {
      header: 'Status',
      span: 1,
      tabletSpan: 1,
      mobileLabel: 'Status',
      accessor: (a) => (
        <span className={`px-2 py-1 text-xs rounded ${a.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {a.status === 'active' ? 'Active' : 'Revoked'}
        </span>
      ),
    },
    {
      header: 'Budget / Spend',
      span: 3,
      hideOnTablet: true,
      mobileLabel: 'Budget / Spend',
      accessor: (a) => <BudgetBar budget={a.monthlyBudgetUsd} spend={spend[a.id] ?? null} />,
    },
    {
      header: 'Keys',
      span: 1,
      tabletSpan: 1,
      mobileLabel: 'Keys',
      accessor: (a) => <span className="text-sm text-gray-500">{keysFor(a.id).length}</span>,
    },
    {
      header: 'Overrides',
      span: 2,
      tabletSpan: 1,
      mobileLabel: 'Overrides',
      accessor: (a) => {
        const n = overridesFor(a.id).length;
        return <span className={`text-sm ${n > 0 ? 'text-yellow-700 font-medium' : 'text-gray-500'}`}>{n}</span>;
      },
    },
    {
      header: 'Actions',
      span: 2,
      tabletSpan: 1,
      mobileLabel: false,
      accessor: (a) => (
        <div className="flex gap-3">
          <button onClick={() => setManageId(a.id)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Manage</button>
          {a.status === 'active' && (
            <button onClick={() => setRevokeTarget(a)} disabled={revokingId === a.id} className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50">
              {revokingId === a.id ? <><Spinner />Revoking…</> : 'Revoke'}
            </button>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <AgentsSkeleton />;

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold mb-4">Agents</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4"><p className="text-red-600">{error}</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Agents</h1>
          <p className="text-sm text-gray-500 mt-1">Per-agent budgets, bound keys, and tool overrides.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium">
          Register Agent
        </button>
      </div>

      {newSecret && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-800 mb-2">Agent registered: {newSecret.name}</h3>
          <p className="text-sm text-green-700 mb-2">Save this secret now — it will not be shown again.</p>
          <div className="text-xs text-green-700 mb-1">Agent ID</div>
          <code className="bg-green-100 px-3 py-2 rounded block font-mono text-sm break-all mb-2">{newSecret.id}</code>
          <div className="text-xs text-green-700 mb-1">Secret</div>
          <code className="bg-green-100 px-3 py-2 rounded block font-mono text-sm break-all">{newSecret.secret}</code>
          <div className="flex gap-3 mt-3">
            <button onClick={() => navigator.clipboard.writeText(newSecret.secret)} className="text-sm text-green-600 hover:text-green-800 font-medium">Copy secret</button>
            <button onClick={() => setNewSecret(null)} className="text-sm text-gray-600 hover:text-gray-800">Dismiss</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => { setRevokeTarget(null); setRevokingId(null); }}
        onConfirm={() => { if (revokeTarget) revokeAgent(revokeTarget.id); }}
        title="Revoke agent"
        message={`Revoke "${revokeTarget?.name}"? Its tokens stop working immediately and bound keys are rejected. This cannot be undone.`}
        confirmLabel="Revoke"
        variant="danger"
      />

      {/* Create agent */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} titleId={createTitleId} className="max-w-md">
        <h2 id={createTitleId} className="text-xl font-bold mb-4">Register Agent</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="deploy-bot" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Monthly budget (USD)</label>
            <input type="number" value={createForm.budget} onChange={(e) => setCreateForm({ ...createForm, budget: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="No budget" min="0" step="0.01" />
            <p className="text-xs text-gray-500 mt-1">Leave empty for no budget cap.</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={createAgent} disabled={isCreating || !createForm.name.trim()} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isCreating ? <><Spinner />Registering…</> : 'Register'}</button>
        </div>
      </Modal>

      {/* Manage agent */}
      {manageAgent && (
        <AgentManageModal
          agent={manageAgent}
          titleId={manageTitleId}
          spend={spend[manageAgent.id] ?? null}
          boundKeys={keysFor(manageAgent.id)}
          overrides={overridesFor(manageAgent.id)}
          onClose={() => setManageId(null)}
          onChanged={fetchAll}
        />
      )}

      <ResponsiveTable
        columns={columns}
        rows={agents}
        keyExtractor={(a) => a.id}
        loading={loading}
        emptyMessage="No agents yet. Register one to start governing per-agent budgets and tools."
        renderMobileCard={(a) => (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{a.name}</h3>
                <div className="text-xs text-gray-400 font-mono truncate">{a.id}</div>
              </div>
              <span className={`shrink-0 px-2 py-1 text-xs rounded ${a.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {a.status === 'active' ? 'Active' : 'Revoked'}
              </span>
            </div>
            <div className="mb-3"><BudgetBar budget={a.monthlyBudgetUsd} spend={spend[a.id] ?? null} /></div>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-500 mb-3">
              <div><span className="text-gray-400">Keys:</span> {keysFor(a.id).length}</div>
              <div><span className="text-gray-400">Overrides:</span> {overridesFor(a.id).length}</div>
            </div>
            <div className="flex gap-3 pt-3 border-t border-gray-100">
              <button onClick={() => setManageId(a.id)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Manage</button>
              {a.status === 'active' && (
                <button onClick={() => setRevokeTarget(a)} className="text-red-600 hover:text-red-800 text-sm font-medium">Revoke</button>
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}

// ── Per-agent manage modal: budget, bound keys, tool overrides ──────

function AgentManageModal({
  agent, titleId, spend, boundKeys, overrides, onClose, onChanged,
}: {
  agent: Agent;
  titleId: string;
  spend: number | null;
  boundKeys: BoundKey[];
  overrides: Override[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [budgetInput, setBudgetInput] = useState(agent.monthlyBudgetUsd != null ? String(agent.monthlyBudgetUsd) : '');
  const [savingBudget, setSavingBudget] = useState(false);
  const [ov, setOv] = useState<{ toolPattern: string; action: OverrideAction; reason: string; ttlHours: string }>({
    toolPattern: '', action: 'require_approval', reason: '', ttlHours: '',
  });
  const [addingOverride, setAddingOverride] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function saveBudget(value: number | null) {
    if (savingBudget) return;
    setSavingBudget(true);
    try {
      await governanceApi.setBudget(agent.id, value);
      toast.success(value == null ? 'Budget cleared' : 'Budget updated');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update budget');
    } finally {
      setSavingBudget(false);
    }
  }

  // Parse + validate the budget input before saving (empty → clear; a
  // non-positive/NaN value must NOT be sent — it would otherwise serialize to
  // null and silently clear the budget).
  function submitBudget() {
    const raw = budgetInput.trim();
    if (!raw) { void saveBudget(null); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) { toast.error('Budget must be a positive number'); return; }
    void saveBudget(n);
  }

  async function addOverride() {
    if (addingOverride || !ov.toolPattern.trim()) return;
    let ttlSeconds: number | undefined;
    const ttlRaw = ov.ttlHours.trim();
    if (ttlRaw) {
      const h = Number(ttlRaw);
      if (!Number.isFinite(h) || h <= 0) { toast.error('TTL hours must be a positive number'); return; }
      ttlSeconds = Math.round(h * 3600);
    }
    setAddingOverride(true);
    try {
      await governanceApi.createOverride({
        agentId: agent.id,
        toolPattern: ov.toolPattern.trim(),
        action: ov.action,
        reason: ov.reason.trim() || undefined,
        ttlSeconds,
      });
      setOv({ toolPattern: '', action: 'require_approval', reason: '', ttlHours: '' });
      toast.success('Override added');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add override');
    } finally {
      setAddingOverride(false);
    }
  }

  async function removeOverride(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await governanceApi.deleteOverride(id);
      toast.success('Override removed');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove override');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal open onClose={onClose} titleId={titleId} className="max-w-lg">
      <h2 id={titleId} className="text-xl font-bold">{agent.name}</h2>
      <div className="text-xs text-gray-400 font-mono mb-4 break-all">{agent.id}</div>

      <div className="space-y-6">
        {/* Budget + spend */}
        <section>
          <h3 className="text-sm font-semibold mb-2">Monthly budget</h3>
          <div className="mb-2"><BudgetBar budget={agent.monthlyBudgetUsd} spend={spend} /></div>
          <div className="flex gap-2 items-center">
            <span className="text-gray-500">$</span>
            <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-3 py-2" placeholder="No budget" min="0" step="0.01" />
            <button onClick={submitBudget} disabled={savingBudget} className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">{savingBudget ? <Spinner /> : 'Save'}</button>
            {agent.monthlyBudgetUsd != null && (
              <button onClick={() => { setBudgetInput(''); void saveBudget(null); }} disabled={savingBudget} className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm">Clear</button>
            )}
          </div>
        </section>

        {/* Bound keys */}
        <section>
          <h3 className="text-sm font-semibold mb-2">Bound virtual keys ({boundKeys.length})</h3>
          {boundKeys.length === 0 ? (
            <p className="text-sm text-gray-400">No API keys are bound to this agent.</p>
          ) : (
            <ul className="space-y-1">
              {boundKeys.map((k) => (
                <li key={k.id} className="flex items-center justify-between text-sm border border-gray-100 rounded px-3 py-1.5">
                  <span className="truncate">{k.name}</span>
                  <span className={`shrink-0 ml-2 px-2 py-0.5 text-xs rounded ${k.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{k.active ? 'Active' : 'Revoked'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Overrides */}
        <section>
          <h3 className="text-sm font-semibold mb-2">Tool overrides ({overrides.length})</h3>
          {overrides.length > 0 && (
            <ul className="space-y-1 mb-3">
              {overrides.map((o) => (
                <li key={o.id} className="flex items-center justify-between text-sm border border-gray-100 rounded px-3 py-1.5">
                  <div className="min-w-0">
                    <span className="font-mono">{o.toolPattern}</span>
                    <span className={`ml-2 px-2 py-0.5 text-xs rounded ${o.action === 'deny' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{o.action}</span>
                    {o.expiresAt && <span className="ml-2 text-xs text-gray-400">expires {new Date(o.expiresAt).toLocaleString()}</span>}
                  </div>
                  <button onClick={() => removeOverride(o.id)} disabled={deletingId === o.id} className="shrink-0 ml-2 text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50">{deletingId === o.id ? '…' : 'Remove'}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={ov.toolPattern} disabled={addingOverride} onChange={(e) => setOv({ ...ov, toolPattern: e.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono disabled:opacity-50" placeholder="tool pattern (e.g. delete_*)" />
              <select value={ov.action} disabled={addingOverride} onChange={(e) => setOv({ ...ov, action: e.target.value as OverrideAction })} className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-50">
                <option value="require_approval">require_approval</option>
                <option value="deny">deny</option>
              </select>
              <input type="text" value={ov.reason} disabled={addingOverride} onChange={(e) => setOv({ ...ov, reason: e.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-50" placeholder="reason (optional)" />
              <input type="number" value={ov.ttlHours} disabled={addingOverride} onChange={(e) => setOv({ ...ov, ttlHours: e.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-50" placeholder="TTL hours (optional)" min="0" step="0.5" />
            </div>
            <button onClick={addOverride} disabled={addingOverride || !ov.toolPattern.trim()} className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">{addingOverride ? <><Spinner />Adding…</> : 'Add override'}</button>
          </div>
        </section>
      </div>

      <div className="flex justify-end mt-6">
        <button onClick={onClose} className="px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Close</button>
      </div>
    </Modal>
  );
}
