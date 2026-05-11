import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Client-side table pagination component.
 * Use for admin/setup pages with smaller datasets.
 * 
 * Usage:
 *   const { paginatedData, ...paginationProps } = useClientPagination(data, 10);
 *   <Table>...</Table>
 *   <TablePagination {...paginationProps} />
 */
export function useClientPagination(data, initialPageSize = 10) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  
  const total = data.length;
  const pages = Math.ceil(total / pageSize) || 1;
  const safeCurrentPage = Math.min(page, pages);
  const start = (safeCurrentPage - 1) * pageSize;
  const paginatedData = data.slice(start, start + pageSize);

  // Reset to page 1 when data changes significantly
  React.useEffect(() => {
    if (page > pages) setPage(1);
  }, [total, pages]);

  return {
    paginatedData,
    page: safeCurrentPage,
    pages,
    total,
    pageSize,
    onPageChange: setPage,
    onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
  };
}

export default function TablePagination({ page, pages, total, pageSize, onPageChange, onPageSizeChange }) {
  if (total <= 10) return null; // Don't show for tiny datasets

  return (
    <div className="flex items-center justify-between px-2 py-3" data-testid="table-pagination">
      <div className="text-sm text-muted-foreground">
        {total} record{total !== 1 ? 's' : ''}
      </div>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {page} / {pages}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(1)}>
            <ChevronsLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPageChange(pages)}>
            <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
