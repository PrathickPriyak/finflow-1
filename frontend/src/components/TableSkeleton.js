import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Shared table loading skeleton used across all pages.
 * Replaces the identical inline definitions previously copy-pasted in 4+ files.
 */
const TableSkeleton = ({ rows = 5, cols = 6 }) => (
  <Table>
    <TableHeader>
      <TableRow>
        {Array(cols).fill(0).map((_, i) => (
          <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {Array(rows).fill(0).map((_, rowIdx) => (
        <TableRow key={rowIdx}>
          {Array(cols).fill(0).map((_, colIdx) => (
            <TableCell key={colIdx}><Skeleton className="h-4 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export default TableSkeleton;
