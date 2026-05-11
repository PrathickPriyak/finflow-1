import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Filter, Lock, Eye, Clock, RotateCcw, ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertCircle, Search, ArrowUpDown, ArrowUp, ArrowDown, Calendar } from 'lucide-react';
import { formatCurrency, formatDate , getApiError } from '@/lib/formatters';
import TableSkeleton from '@/components/TableSkeleton';
import { TransactionDetailDrawer } from '@/components/DetailDrawers';
import { EmptyState } from '@/components/ui/empty-state';

export default function TransactionsPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    transaction_type: '',
    gateway_id: '',
    status: '',
    created_by: '',
    date_from: '',
    date_to: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  
  // Sorting
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Pagination
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(10);
  
  // Detail drawer state
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  
  // Reverse dialog
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [txnToReverse, setTxnToReverse] = useState(null);
  
  const searchTimeout = useRef(null);

  const fetchData = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('limit', pageSize);
      params.set('sort_by', sortBy);
      params.set('sort_order', sortOrder);
      if (filters.transaction_type && filters.transaction_type !== 'all') params.set('transaction_type', filters.transaction_type);
      if (filters.gateway_id && filters.gateway_id !== 'all') params.set('gateway_id', filters.gateway_id);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.created_by && filters.created_by !== 'all') params.set('created_by', filters.created_by);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      
      const [txnRes, gwRes] = await Promise.all([
        api.get(`/transactions?${params.toString()}`),
        gateways.length ? Promise.resolve(null) : api.get('/gateways'),
      ]);
      
      const txnData = txnRes.data;
      setTransactions(txnData.data || []);
      setPagination(txnData.pagination || { page: 1, limit: pageSize, total: 0, pages: 0 });
      if (gwRes) setGateways(gwRes.data || []);
      
      // Fetch users only once
      if (users.length === 0) {
        try {
          const usersRes = await api.get('/users');
          const userData = usersRes.data?.data || usersRes.data || [];
          setUsers(Array.isArray(userData) ? userData : []);
        } catch { /* users endpoint may require admin permission */ }
      }
    } catch (error) {
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [api, pageSize, filters, searchQuery, sortBy, sortOrder, gateways.length, users.length]);

  useEffect(() => {
    fetchData(1);
  }, [fetchData]);

  const applyFilters = (page) => {
    fetchData(typeof page === 'number' ? page : 1);
  };

  const clearFilters = () => {
    setFilters({ transaction_type: '', gateway_id: '', status: '', created_by: '', date_from: '', date_to: '' });
    setSearchQuery('');
    setSortBy('date');
    setSortOrder('desc');
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      fetchData(newPage);
    }
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(parseInt(newSize));
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortOrder === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" /> 
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // Date presets
  const applyDatePreset = (preset) => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
    let from, to;
    
    switch (preset) {
      case 'today':
        from = to = fmt(today);
        break;
      case 'yesterday': {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        from = to = fmt(y);
        break;
      }
      case 'this_week': {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay());
        from = fmt(d);
        to = fmt(today);
        break;
      }
      case 'this_month':
        from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
        to = fmt(today);
        break;
      case 'last_30':
        from = fmt(new Date(today.getTime() - 30 * 86400000));
        to = fmt(today);
        break;
      default:
        return;
    }
    setFilters(prev => ({ ...prev, date_from: from, date_to: to }));
  };

  const viewTransaction = (txn) => {
    setSelectedTxn(txn);
    setShowDetailDrawer(true);
  };

  const openReverseDialog = (txn) => {
    setTxnToReverse(txn);
    setReverseReason('');
    setShowReverseDialog(true);
  };

  const handleReverseTransaction = async () => {
    if (!txnToReverse || reverseReason.length < 10) return;
    setReversing(true);
    try {
      await api.post(`/transactions/${txnToReverse.id}/reverse`, { reason: reverseReason });
      toast.success('Transaction reversed successfully');
      setShowReverseDialog(false);
      fetchData(pagination.page);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to reverse transaction'));
    } finally {
      setReversing(false);
    }
  };

  const getStatusBadge = (txn) => {
    if (txn.status === 'reversed') {
      return <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" />Reversed</Badge>;
    }
    if (txn.is_locked) {
      return <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-200"><Lock className="w-3 h-3 mr-1" />Locked</Badge>;
    }
    return <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
  };

  const getPaymentStatusBadge = (txn) => {
    if (txn.customer_payment_status === 'not_applicable') {
      return null;
    }
    if (txn.customer_payment_status === 'paid') {
      return <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Paid</Badge>;
    } else if (txn.customer_payment_status === 'partial') {
      return <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />Partial</Badge>;
    }
    return <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  };

  const getChargesPendingBadge = (txn) => {
    if (txn.pending_charges_amount > 0) {
      return <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-200">{formatCurrency(txn.pending_charges_amount)} charges due</Badge>;
    }
    return null;
  };

  return (
    <>
    <div className="space-y-4" data-testid="transactions-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="text-muted-foreground mt-1">View and manage all transactions</p>
        </div>
        <Button onClick={() => navigate('/transactions/new')} data-testid="new-transaction-btn">
          <Plus className="w-4 h-4 mr-2" />
          New Transaction
        </Button>
      </div>

      {/* Search, Filters & Date Presets */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by phone, transaction ID, or card..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters(1)}
                className="pl-9"
                data-testid="transaction-search"
              />
            </div>
            
            {/* Date Presets */}
            <div className="flex flex-wrap gap-2" data-testid="date-presets">
              <div className="flex items-center gap-1 mr-1 text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                <span className="text-xs font-medium hidden sm:inline">Quick:</span>
              </div>
              {[
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'this_week', label: 'This Week' },
                { key: 'this_month', label: 'This Month' },
                { key: 'last_30', label: 'Last 30 Days' },
              ].map(p => (
                <Button
                  key={p.key}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => applyDatePreset(p.key)}
                  data-testid={`date-preset-${p.key}`}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            {/* Filters row */}
            <div className="flex flex-col md:flex-row gap-3 flex-wrap">
              <Select
                value={filters.transaction_type}
                onValueChange={(v) => setFilters({ ...filters, transaction_type: v })}
              >
                <SelectTrigger className="w-full md:w-36" data-testid="type-filter">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="type_01">Type 01 - Direct</SelectItem>
                  <SelectItem value="type_02">Type 02 - Pay+Swipe</SelectItem>
                </SelectContent>
              </Select>
              
              <Select
                value={filters.status}
                onValueChange={(v) => setFilters({ ...filters, status: v })}
              >
                <SelectTrigger className="w-full md:w-36" data-testid="status-filter">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="payment_pending">Payment Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending_swipe">Pending Swipe</SelectItem>
                  <SelectItem value="reversed">Reversed</SelectItem>
                </SelectContent>
              </Select>

              <SearchableSelect
                value={filters.gateway_id}
                onValueChange={(v) => setFilters({ ...filters, gateway_id: v })}
                placeholder="Search gateways..."
                allOption="All Gateways"
                items={gateways.map(gw => ({ value: gw.id, label: gw.name }))}
                className="w-full md:w-44"
                triggerTestId="gateway-filter"
              />

              {users.length > 0 && (
                <SearchableSelect
                  value={filters.created_by}
                  onValueChange={(v) => setFilters({ ...filters, created_by: v })}
                  placeholder="Search users..."
                  allOption="All Users"
                  items={users.map(u => ({ value: u.id, label: u.email }))}
                  className="w-full md:w-48"
                  triggerTestId="user-filter"
                />
              )}
              
              <Input
                type="date"
                value={filters.date_from}
                onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
                className="w-full md:w-36"
                data-testid="date-from"
              />
              
              <Input
                type="date"
                value={filters.date_to}
                onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
                className="w-full md:w-36"
                data-testid="date-to"
              />
              
              <div className="flex gap-2">
                <Button onClick={applyFilters} data-testid="apply-filters-btn">
                  <Filter className="w-4 h-4 mr-2" />
                  Apply
                </Button>
                <Button variant="outline" onClick={clearFilters} data-testid="clear-filters-btn">
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4" data-testid="transactions-loading-skeleton">
              <TableSkeleton rows={5} cols={9} />
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              icon="transactions"
              title="No transactions found"
              description="Create your first transaction or adjust your filters to see results."
              action={true}
              actionLabel="New Transaction"
              onAction={() => navigate('/transactions/new')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Transactions table" className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Txn ID</TableHead>
                    <TableHead className="hidden sm:table-cell cursor-pointer select-none" onClick={() => handleSort('date')} data-testid="sort-date">
                      <span className="flex items-center">Date<SortIcon column="date" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('type')} data-testid="sort-type">
                      <span className="flex items-center">Type<SortIcon column="type" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('customer')} data-testid="sort-customer">
                      <span className="flex items-center">Customer<SortIcon column="customer" /></span>
                    </TableHead>
                    <TableHead className="hidden md:table-cell cursor-pointer select-none" onClick={() => handleSort('gateway')} data-testid="sort-gateway">
                      <span className="flex items-center">Gateway<SortIcon column="gateway" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('amount')} data-testid="sort-amount">
                      <span className="flex items-center justify-end">Amount<SortIcon column="amount" /></span>
                    </TableHead>
                    <TableHead className="text-right hidden lg:table-cell cursor-pointer select-none" onClick={() => handleSort('commission')} data-testid="sort-commission">
                      <span className="flex items-center justify-end">Commission<SortIcon column="commission" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')} data-testid="sort-status">
                      <span className="flex items-center">Status<SortIcon column="status" /></span>
                    </TableHead>
                    <TableHead className="hidden sm:table-cell" data-testid="col-payment-status">Payment</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => (
                    <TableRow 
                      key={txn.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => viewTransaction(txn)}
                      data-testid={`txn-row-${txn.id}`}
                    >
                      <TableCell>
                        <code className="px-2 py-1 rounded bg-muted text-xs font-mono">
                          {txn.transaction_id || '-'}
                        </code>
                      </TableCell>
                      <TableCell className="whitespace-nowrap hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          {txn.is_locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                          {formatDate(txn.created_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          txn.transaction_type === 'type_01' ? 'bg-blue-100 text-blue-700' : 
                          txn.transaction_type === 'transfer' ? 'bg-green-100 text-green-700' : 
                          'bg-purple-100 text-purple-700'
                        }>
                          {txn.transaction_type === 'type_01' ? 'Direct' : 
                           txn.transaction_type === 'transfer' ? 'Transfer' : 'Pay+Swipe'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {txn.customer_name || (txn.transaction_type === 'transfer' ? '-' : '')}
                        {txn.customer_readable_id && (
                          <span className="ml-1 text-xs text-muted-foreground hidden sm:inline">({txn.customer_readable_id})</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {txn.transaction_type === 'transfer' 
                          ? `${txn.transfer_from_wallet_name} → ${txn.transfer_to_wallet_name}` 
                          : txn.swipe_gateway_name}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(txn.transaction_type === 'transfer' ? txn.transfer_amount : txn.transaction_type === 'type_02' ? (txn.pay_to_card_amount || txn.swipe_amount) : txn.swipe_amount)}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 font-medium hidden lg:table-cell">
                        {txn.transaction_type === 'transfer' ? '-' : formatCurrency(txn.commission_amount)}
                      </TableCell>
                      <TableCell>{getStatusBadge(txn)}</TableCell>
                      <TableCell className="hidden sm:table-cell" data-testid={`payment-status-${txn.id}`}>
                        {txn.transaction_type !== 'transfer' && getPaymentStatusBadge(txn)}
                        {txn.transaction_type !== 'transfer' && getChargesPendingBadge(txn)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); viewTransaction(txn); }}
                          data-testid={`view-btn-${txn.id}`}
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

      {/* Reverse Transaction Dialog */}
      <Dialog open={showReverseDialog} onOpenChange={setShowReverseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <RotateCcw className="w-5 h-5" />
              Reverse Transaction
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm text-red-700">
                <strong>Warning:</strong> This will reverse all financial operations associated with this transaction. 
                Gateway wallet balances will be adjusted accordingly. This action cannot be undone.
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Reason for Reversal *</label>
              <Textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Enter the reason for reversing this transaction (minimum 10 characters)..."
                rows={3}
                data-testid="reverse-reason-input"
              />
              <p className="text-xs text-muted-foreground mt-1">{reverseReason.length}/500 characters</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReverseDialog(false)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={handleReverseTransaction}
              disabled={reversing || reverseReason.length < 10}
              data-testid="confirm-reverse-btn"
            >
              {reversing ? 'Reversing...' : 'Confirm Reversal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {pagination.total > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {((pagination.page - 1) * pageSize) + 1} to {Math.min(pagination.page * pageSize, pagination.total)} of {pagination.total}
            </p>
            <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="w-[100px] h-10 sm:h-8" data-testid="transactions-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 / page</SelectItem>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {pagination.pages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-10 sm:h-8 px-3"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                aria-label="Previous page"
                data-testid="transactions-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                aria-label="Next page"
                data-testid="transactions-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>

      {/* Transaction Detail Drawer */}
      <TransactionDetailDrawer 
        open={showDetailDrawer}
        onClose={() => setShowDetailDrawer(false)}
        transaction={selectedTxn}
        api={api}
        onReverse={(txn) => {
          setShowDetailDrawer(false);
          openReverseDialog(txn);
        }}
      />
    </>
  );
}
