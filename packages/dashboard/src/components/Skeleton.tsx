import { type ReactNode } from 'react';

/* ── Primitives ── */

interface SkeletonBoxProps {
  className?: string;
  children?: ReactNode;
}

/** Rectangular shimmer block. Use className to set w/h. */
export function SkeletonBox({ className = '', children }: SkeletonBoxProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** One or more text-line shimmers. */
export function SkeletonText({ lines = 1, className = '' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-gray-200 rounded h-4 ${
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'
          }`}
        />
      ))}
    </div>
  );
}

/* ── Skeleton row helper for tables ── */

export function SkeletonTableRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid grid-cols-12 gap-4 px-4 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`col-span-${Math.floor(12 / cols)}`}>
              <SkeletonBox className="h-4 w-full" />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* ── Page-level skeletons ── */

/** Home page skeleton: stat cards + recent activity list */
export function HomeSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <SkeletonBox className="h-4 w-32" />
                <SkeletonBox className="h-8 w-16" />
              </div>
              <SkeletonBox className="w-10 h-10 sm:w-12 sm:h-12 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Recent activity header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <SkeletonBox className="h-6 w-36" />
          <SkeletonBox className="h-4 w-20" />
        </div>
        {/* Request cards */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <SkeletonBox className="h-5 w-48" />
                <SkeletonBox className="h-5 w-20 rounded-full" />
              </div>
              <SkeletonBox className="h-3 w-64 mt-2" />
              <div className="flex items-center justify-between mt-3">
                <SkeletonBox className="h-4 w-16" />
                <SkeletonBox className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** RequestList page skeleton: header + filter tabs + table rows */
export function RequestListSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <SkeletonBox className="h-7 w-48" />
        <SkeletonBox className="h-4 w-24" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBox key={i} className="h-9 w-20 rounded-lg shrink-0" />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200">
          {[3, 3, 2, 2, 2].map((span, i) => (
            <div key={i} className={`col-span-${span}`}>
              <SkeletonBox className="h-4 w-full" />
            </div>
          ))}
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 8 }).map((_, r) => (
            <div key={r} className="grid grid-cols-12 gap-4 px-4 py-4">
              <div className="col-span-3"><SkeletonBox className="h-4 w-full" /></div>
              <div className="col-span-3"><SkeletonBox className="h-4 w-3/4" /></div>
              <div className="col-span-2"><SkeletonBox className="h-5 w-20 rounded-full" /></div>
              <div className="col-span-2"><SkeletonBox className="h-5 w-16 rounded" /></div>
              <div className="col-span-2"><SkeletonBox className="h-4 w-20" /></div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <SkeletonBox className="h-5 w-40" />
              <SkeletonBox className="h-5 w-20 rounded-full" />
            </div>
            <SkeletonBox className="h-3 w-48 mb-3" />
            <div className="flex items-center justify-between">
              <SkeletonBox className="h-5 w-16 rounded" />
              <SkeletonBox className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** AuditLog page skeleton: filters + table */
export function AuditLogSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonBox className="h-7 w-32" />
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="h-10 w-36 rounded-lg" />
        ))}
      </div>
      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <SkeletonBox className="h-4 w-full" />
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-4">
              <SkeletonBox className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** ApiKeys page skeleton: header + button + table */
export function ApiKeysSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonBox className="h-7 w-28" />
        <SkeletonBox className="h-10 w-32 rounded-lg" />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <SkeletonBox className="h-4 w-full" />
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-4">
              <SkeletonBox className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Webhooks page skeleton: header + button + table */
export function WebhooksSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonBox className="h-7 w-28" />
        <SkeletonBox className="h-10 w-36 rounded-lg" />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <SkeletonBox className="h-4 w-full" />
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-4">
              <SkeletonBox className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
