import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ArrowLeftRight, Eye, Loader2, Banknote, ArrowDownLeft, User } from 'lucide-react';
import { formatCurrency, formatDate, getApiError } from '@/lib/formatters';

export default function AdjustmentsPage() {
  const { api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [adjustments, setAdjustments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [selected, setSelected] = useState(null);

  const fetchAdjustments = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get(`/adjustments?page=${page}&limit=50`);
      setAdjustments(res.data?.data || []);
      setPagination(res.data?.pagination || { page: 1, limit: 50, total: 0, pages: 0 });
    } catch (error) {
      toast.error(getApiError(error, 'Failed to load adjustments'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchAdjustments(1);
  }, [fetchAdjustments]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ArrowLeftRight className="w-6 h-6" />
          Balance Adjustments
        </h1>
        <p className="text-muted-foreground">
          History of customer balance set-offs — pending payouts netted against outstanding collections.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Adjustments</CardTitle>
          <CardDescription>
            To create a new adjustment, open a customer with both pending payouts and pending collections.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : adjustments.length === 0 ? (
            <div className="empty-state py-12">
              <ArrowLeftRight className="empty-state-icon" />
              <p className="empty-state-title">No adjustments yet</p>
              <p className="empty-state-description">
                Open a customer page to net off their pending payouts against their pending collections.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Adjustment ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Net Amount</TableHead>
                    <TableHead className="text-center">Payouts</TableHead>
                    <TableHead className="text-center">Collections</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.map(adj => (
                    <TableRow key={adj.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(adj.created_at)}</TableCell>
                      <TableCell className="font-mono text-sm">{adj.adjustment_id}</TableCell>
                      <TableCell>
                        <Link
                          to={`/customers/${adj.customer_id}`}
                          className="hover:underline text-primary inline-flex items-center gap-1"
                        >
                          <User className="w-3 h-3" />
                          {adj.customer_name}
                          {adj.customer_readable_id ? (
                            <span className="text-muted-foreground text-xs">({adj.customer_readable_id})</span>
                          ) : null}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-bold text-indigo-700">
                        {formatCurrency(adj.net_amount)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="gap-1">
                          <Banknote className="w-3 h-3" /> {adj.payouts?.length || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="gap-1">
                          <ArrowDownLeft className="w-3 h-3" /> {adj.collections?.length || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate" title={adj.reason}>
                        {adj.reason}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelected(adj)}
                          data-testid={`adjust-view-${adj.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination.pages > 1 && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.pages} — {pagination.total} adjustment(s)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => fetchAdjustments(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pages}
              onClick={() => fetchAdjustments(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5" />
              Adjustment {selected?.adjustment_id}
            </DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  {formatDate(selected.created_at)} — {selected.customer_name} — by {selected.created_by_name}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="rounded-lg p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200">
                <p className="text-sm text-muted-foreground">Net amount</p>
                <p className="text-2xl font-bold text-indigo-700">{formatCurrency(selected.net_amount)}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Reason</p>
                <p className="text-sm">{selected.reason}</p>
                {selected.notes && (
                  <>
                    <p className="text-sm font-medium mt-3 mb-1">Notes</p>
                    <p className="text-sm text-muted-foreground">{selected.notes}</p>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-1">
                    <Banknote className="w-4 h-4" /> Payouts settled ({selected.payouts?.length || 0})
                  </p>
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    <Table className="text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Transaction</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.payouts?.map(p => (
                          <TableRow key={p.transaction_id}>
                            <TableCell className="font-mono text-xs">
                              {p.transaction_id_readable || p.transaction_id.slice(0, 8)}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(p.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-purple-700 mb-2 flex items-center gap-1">
                    <ArrowDownLeft className="w-4 h-4" /> Collections settled ({selected.collections?.length || 0})
                  </p>
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    <Table className="text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Collection</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.collections?.map(c => (
                          <TableRow key={c.collection_id}>
                            <TableCell className="font-mono text-xs">
                              {c.pending_payment_id || c.transaction_id_readable || c.collection_id.slice(0, 8)}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(c.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
