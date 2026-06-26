import type { ApprovalStatus } from '@agentkitai/agentgate-core';

interface StatusBadgeProps {
  status: ApprovalStatus;
}

const statusStyles = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  denied: 'bg-red-100 text-red-800 border-red-200',
  expired: 'bg-gray-100 text-gray-800 border-gray-200',
};

const statusLabels = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  expired: 'Expired',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
