import { type ReactNode } from 'react';
import { Pagination, type PaginationProps } from './Pagination';

// --- Public interfaces ---

export interface Column<T> {
  /** Column header label */
  header: string;
  /** Key or accessor for the value */
  accessor: keyof T | ((row: T) => ReactNode);
  /** CSS grid col-span for desktop (out of 12). Default 1 */
  span?: number;
  /** CSS grid col-span for tablet (out of 6). 0 = hidden on tablet. */
  tabletSpan?: number;
  /** Hide column on tablet entirely */
  hideOnTablet?: boolean;
  /** Header for mobile card label. If false, omit from mobile card. */
  mobileLabel?: string | false;
  /** Extra className for cells */
  className?: string;
}

export interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  loading?: boolean;
  loadingRows?: number;
  emptyMessage?: string;
  /** Pagination (omit to disable) */
  pagination?: PaginationProps;
  /** Mobile card click handler */
  onRowClick?: (row: T) => void;
  /** Custom mobile card renderer (overrides default) */
  renderMobileCard?: (row: T) => ReactNode;
}

// --- Helpers ---

function getCellValue<T>(row: T, accessor: Column<T>['accessor']): ReactNode {
  if (typeof accessor === 'function') return accessor(row);
  return row[accessor] as ReactNode;
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <div className="px-4 py-3 flex gap-4 animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="flex-1 h-4 bg-gray-200 rounded" />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse space-y-3">
      <div className="h-4 bg-gray-200 rounded w-2/3" />
      <div className="h-3 bg-gray-200 rounded w-1/2" />
      <div className="h-3 bg-gray-200 rounded w-3/4" />
    </div>
  );
}

// --- Component ---

export function ResponsiveTable<T>({
  columns,
  rows,
  keyExtractor,
  loading = false,
  loadingRows = 5,
  emptyMessage = 'No data found',
  pagination,
  onRowClick,
  renderMobileCard,
}: ResponsiveTableProps<T>) {
  // Compute grid template strings
  const desktopCols = columns.map((c) => `${c.span ?? 1}fr`).join(' ');

  const tabletColumns = columns.filter((c) => !c.hideOnTablet && c.tabletSpan !== 0);
  const tabletCols = tabletColumns.map((c) => `${c.tabletSpan ?? c.span ?? 1}fr`).join(' ');

  const mobileColumns = columns.filter((c) => c.mobileLabel !== false);

  // --- Loading ---
  if (loading) {
    return (
      <div className="space-y-4">
        {/* Desktop skeleton */}
        <div className="hidden lg:block bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
            <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
          </div>
          <div className="divide-y divide-gray-200">
            {Array.from({ length: loadingRows }).map((_, i) => (
              <SkeletonRow key={i} cols={columns.length} />
            ))}
          </div>
        </div>
        {/* Mobile skeleton */}
        <div className="lg:hidden space-y-3">
          {Array.from({ length: loadingRows }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  // --- Empty ---
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden lg:block bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div
          className="gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500"
          style={{ display: 'grid', gridTemplateColumns: desktopCols }}
        >
          {columns.map((col, i) => (
            <div key={i}>{col.header}</div>
          ))}
        </div>
        {/* Body */}
        <div className="divide-y divide-gray-200">
          {rows.map((row) => (
            <div
              key={keyExtractor(row)}
              className="gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
              style={{ display: 'grid', gridTemplateColumns: desktopCols }}
            >
              {columns.map((col, i) => (
                <div key={i} className={col.className}>
                  {getCellValue(row, col.accessor)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Tablet Table */}
      <div className="hidden sm:block lg:hidden bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div
          className="gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500"
          style={{ display: 'grid', gridTemplateColumns: tabletCols }}
        >
          {tabletColumns.map((col, i) => (
            <div key={i}>{col.header}</div>
          ))}
        </div>
        {/* Body */}
        <div className="divide-y divide-gray-200">
          {rows.map((row) => (
            <div
              key={keyExtractor(row)}
              className="gap-2 px-4 py-3 hover:bg-gray-50 transition-colors"
              style={{ display: 'grid', gridTemplateColumns: tabletCols }}
            >
              {tabletColumns.map((col, i) => (
                <div key={i} className={col.className}>
                  {getCellValue(row, col.accessor)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3">
        {rows.map((row) => {
          if (renderMobileCard) {
            return <div key={keyExtractor(row)}>{renderMobileCard(row)}</div>;
          }
          return (
            <div
              key={keyExtractor(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`bg-white rounded-lg border border-gray-200 p-4 ${onRowClick ? 'active:bg-gray-50 cursor-pointer' : ''}`}
            >
              {mobileColumns.map((col, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  {col.mobileLabel && (
                    <span className="text-xs text-gray-500">{col.mobileLabel}</span>
                  )}
                  <div className={col.className}>{getCellValue(row, col.accessor)}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {pagination && <Pagination {...pagination} />}
    </>
  );
}
