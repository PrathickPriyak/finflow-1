import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { 
  Banknote, Wallet, Loader2, History,
  ArrowUpRight, Calendar, Search, CreditCard, CheckCircle2,
  Clock, TrendingUp, Users, BarChart3, Link2, AlertTriangle, Filter, Building2,
  Check, Ban, ArrowUpDown, ArrowUp, ArrowDown, Download
} from 'lucide-react';
import { formatCurrency, formatDate, formatDateShort, getAgeDays , getApiError } from '@/lib/formatters';
import TableSkeleton from '@/components/TableSkeleton';
import { PaymentDetailDrawer } from '@/components/DetailDrawers';
import { EmptyState } from '@/components/ui/empty-state';

// Payments page component

export default function PaymentsPage() {
  const { api } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [pendingTxns, setPendingTxns] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [historyStats, setHistoryStats] = useState(null);
  const [pendingStats, setPendingStats] = useState(null);
  const [summary, setSummary] = useState({ total_outstanding: 0, paid_today: 0 });
  const [loading, setLoading] = useState(true);
  
  // Pagination state
  const [pendingPagination, setPendingPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [historyPagination, setHistoryPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(10);
  
  // Search and filter
  const [searchQuery, setSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [pendingFilter, setPendingFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [datePreset, setDatePreset] = useState(null);
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historyDatePreset, setHistoryDatePreset] = useState(null);
  const [historyMethodFilter, setHistoryMethodFilter] = useState('all');
  
  // Payment dialog
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [paymentSources, setPaymentSources] = useState([]);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_source_type: '',
    payment_source_id: '',
    reference_number: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  
  // Detail drawer
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState(null);

  // Sorting state
  const [pendingSortBy, setPendingSortBy] = useState(null);
  const [pendingSortOrder, setPendingSortOrder] = useState('desc');
  const [historySortBy, setHistorySortBy] = useState(null);
  const [historySortOrder, setHistorySortOrder] = useState('desc');

  const handlePendingSort = (column) => {
    if (pendingSortBy === column) {
      setPendingSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setPendingSortBy(column);
      setPendingSortOrder('desc');
    }
  };

  const handleHistorySort = (column) => {
    if (historySortBy === column) {
      setHistorySortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setHistorySortBy(column);
      setHistorySortOrder('desc');
    }
  };

  const SortIcon = ({ column, sortBy, sortOrder }) => {
    if (sortBy !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  // Void dialog
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [selectedVoidPayment, setSelectedVoidPayment] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  
  useEffect(() => {
    fetchData();
  }, []);
  
  // Fetch history stats when date filter changes
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistoryStats();
      fetchHistoryData(1);
    }
  }, [activeTab, historyDateFrom, historyDateTo, historyMethodFilter]);
  
  // Fetch pending when filter changes
  useEffect(() => {
    fetchPendingData(1);
  }, [pendingFilter, pendingSortBy, pendingSortOrder, dateFrom, dateTo]);
  
  // Refetch history when sort changes
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistoryData(1);
    }
  }, [historySortBy, historySortOrder]);

  // Debounced search for history tab
  useEffect(() => {
    if (activeTab === 'history') {
      const timer = setTimeout(() => fetchHistoryData(1), 300);
      return () => clearTimeout(timer);
    }
  }, [historySearchQuery]);
  
  // Refetch when page size changes
  useEffect(() => {
    if (activeTab === 'pending') {
      fetchPendingData(1);
    } else {
      fetchHistoryData(1);
    }
  }, [pageSize]);
  
  // Debounced search for pending payments
  useEffect(() => {
    if (activeTab === 'pending') {
      const timer = setTimeout(() => {
        fetchPendingData(1);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchQuery]);

  // BUG-FIX: Wrap fetchData in useCallback with api dependency
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRes, historyRes, summaryRes, pendingStatsRes] = await Promise.all([
        api.get(`/payments/pending?filter=all&page=1&limit=${pageSize}`),
        api.get(`/payments/history?page=1&limit=${pageSize}`),
        api.get('/payments/summary'),
        api.get('/payments/pending-stats'),
      ]);
      
      setPendingTxns(pendingRes.data?.data || pendingRes.data || []);
      if (pendingRes.data?.pagination) {
        setPendingPagination(pendingRes.data.pagination);
      }
      
      const historyData = historyRes.data?.data || historyRes.data || [];
      setPaymentHistory(Array.isArray(historyData) ? historyData : []);
      if (historyRes.data?.pagination) {
        setHistoryPagination(historyRes.data.pagination);
      }
      
      setSummary(summaryRes.data || {});
      setPendingStats(pendingStatsRes.data || null);
    } catch (error) {
      toast.error('Failed to load payments data');
    } finally {
      setLoading(false);
    }
  }, [api, pageSize]);
  
  const fetchPendingData = async (page = 1) => {
    try {
      let url = `/payments/pending?filter=${pendingFilter}&page=${page}&limit=${pageSize}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      if (pendingSortBy) url += `&sort_by=${pendingSortBy}&sort_order=${pendingSortOrder}`;
      if (dateFrom) url += `&date_from=${dateFrom}`;
      if (dateTo) url += `&date_to=${dateTo}`;
      const res = await api.get(url);
      setPendingTxns(res.data?.data || res.data || []);
      if (res.data?.pagination) {
        setPendingPagination(res.data.pagination);
      }
    } catch (error) {
      toast.error('Failed to load pending payments');
    }
  };
  
  const fetchHistoryData = async (page = 1) => {
    try {
      let url = `/payments/history?page=${page}&limit=${pageSize}`;
      if (historySortBy) url += `&sort_by=${historySortBy}&sort_order=${historySortOrder}`;
      if (historySearchQuery) url += `&search=${encodeURIComponent(historySearchQuery)}`;
      if (historyDateFrom) url += `&date_from=${historyDateFrom}`;
      if (historyDateTo) url += `&date_to=${historyDateTo}`;
      if (historyMethodFilter !== 'all') url += `&payment_method=${historyMethodFilter}`;
      const res = await api.get(url);
      const historyData = res.data?.data || res.data || [];
      setPaymentHistory(Array.isArray(historyData) ? historyData : []);
      if (res.data?.pagination) {
        setHistoryPagination(res.data.pagination);
      }
    } catch (error) {
      toast.error('Failed to load payment history');
    }
  };
  
  const handlePageSizeChange = (newSize) => {
    setPageSize(parseInt(newSize));
  };
  
  const handlePendingPageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pendingPagination.pages) {
      fetchPendingData(newPage);
    }
  };
  
  const handleHistoryPageChange = (newPage) => {
    if (newPage >= 1 && newPage <= historyPagination.pages) {
      fetchHistoryData(newPage);
    }
  };

  const applyPendingDatePreset = (preset) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let from = today, to = today;
    if (preset === 'today') { from = to = today; }
    else if (preset === 'this_week') {
      const ws = new Date(now); ws.setDate(ws.getDate() - ws.getDay());
      from = ws.toISOString().split('T')[0]; to = today;
    } else if (preset === 'this_month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; to = today;
    } else if (preset === 'last_30') {
      const p = new Date(now); p.setDate(p.getDate() - 30);
      from = p.toISOString().split('T')[0]; to = today;
    }
    setDatePreset(preset); setDateFrom(from); setDateTo(to);
  };

  const applyHistoryDatePreset = (preset) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let from = today, to = today;
    if (preset === 'today') { from = to = today; }
    else if (preset === 'this_week') {
      const ws = new Date(now); ws.setDate(ws.getDate() - ws.getDay());
      from = ws.toISOString().split('T')[0]; to = today;
    } else if (preset === 'this_month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; to = today;
    } else if (preset === 'last_30') {
      const p = new Date(now); p.setDate(p.getDate() - 30);
      from = p.toISOString().split('T')[0]; to = today;
    }
    setHistoryDatePreset(preset); setHistoryDateFrom(from); setHistoryDateTo(to);
  };

  const handleExportExcel = async (tab) => {
    try {
      toast.info('Generating Excel file...');
      let url = `/payments/export-excel?tab=${tab}`;
      if (tab === 'pending') {
        if (dateFrom) url += `&date_from=${dateFrom}`;
        if (dateTo) url += `&date_to=${dateTo}`;
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      } else {
        if (historyDateFrom) url += `&date_from=${historyDateFrom}`;
        if (historyDateTo) url += `&date_to=${historyDateTo}`;
        if (historyMethodFilter !== 'all') url += `&payment_method=${historyMethodFilter}`;
      }
      const res = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = tab === 'history' ? 'payment_history.xlsx' : 'pending_payouts.xlsx';
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Excel downloaded successfully');
    } catch (error) {
      toast.error(getApiError(error, 'Failed to export Excel'));
    }
  };
  
  const fetchHistoryStats = async () => {
    try {
      const res = await api.get(`/payments/history-stats?period=${dateFilter}`);
      setHistoryStats(res.data);
    } catch (error) {
      toast.error('Failed to load payment stats');
    }
  };

  const openPaymentDialog = async (txn) => {
    // Close detail drawer first to avoid Sheet + Dialog z-index conflict
    setShowDetailDrawer(false);
    setSelectedPaymentDetail(null);

    setSelectedTxn(txn);
    const remaining = txn.amount_remaining_to_customer || txn.amount_to_customer || 0;
    setPaymentForm({
      amount: remaining.toString(),
      payment_source_type: '',
      payment_source_id: '',
      reference_number: '',
      notes: '',
    });
    
    try {
      const res = await api.get(`/payments/sources?amount=${remaining}`);
      // Filter out bank wallets - only gateway and cash allowed for customer payments
      const filteredSources = res.data.filter(s => s.source_type !== 'bank');
      setPaymentSources(filteredSources);
    } catch (error) {
      toast.error('Failed to load payment sources');
    }
    
    setShowPayDialog(true);
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    
    if (!paymentForm.payment_source_id) {
      toast.error('Please select a payment source');
      return;
    }
    
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    
    // Auto-determine payment method based on source type
    // Gateway Wallet → Bank Transfer, Cash Register → Cash
    const paymentMethod = paymentForm.payment_source_type === 'gateway_wallet' ? 'bank_transfer' : 'cash';
    
    setSubmitting(true);
    try {
      await api.post('/payments/record', {
        transaction_id: selectedTxn.id,
        amount: parseFloat(paymentForm.amount),
        payment_source_type: paymentForm.payment_source_type,
        payment_source_id: paymentForm.payment_source_id,
        payment_method: paymentMethod,  // Auto-determined
        reference_number: paymentForm.reference_number,
        notes: paymentForm.notes,
      });
      toast.success('Payment recorded successfully');
      setShowPayDialog(false);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Payment failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoidPayment = async () => {
    if (!voidReason || voidReason.trim().length < 5) {
      toast.error('Please provide a reason (at least 5 characters)');
      return;
    }
    setVoidSubmitting(true);
    try {
      await api.post(
        `/payments/${selectedVoidPayment.id}/void`,
        { reason: voidReason.trim() }
      );
      toast.success(`Payment of ${formatCurrency(selectedVoidPayment.amount)} voided successfully`);
      setShowVoidDialog(false);
      setVoidReason('');
      setSelectedVoidPayment(null);
      fetchHistoryData(1);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to void payment'));
    } finally {
      setVoidSubmitting(false);
    }
  };

  const openVoidDialog = (e, payment) => {
    e.stopPropagation();
    setSelectedVoidPayment(payment);
    setVoidReason('');
    setShowVoidDialog(true);
  };

  const getSelectedSourceBalance = () => {
    const source = paymentSources.find(
      s => s.source_type === paymentForm.payment_source_type && s.source_id === paymentForm.payment_source_id
    );
    return source?.balance || 0;
  };

  if (loading) {
    return (
      <div className="space-y-6" data-testid="payments-loading-skeleton">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array(4).fill(0).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-3">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-4">
            <TableSkeleton rows={5} cols={6} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="payments-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="text-muted-foreground mt-1">Manage outgoing payments to customers</p>
        </div>
      </div>

      {/* Summary Cards - 3 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-100">
                <Banknote className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Payable</p>
                <p className="text-lg font-bold text-amber-600" data-testid="stat-total-payable">
                  {formatCurrency(pendingStats?.total_payable || summary.total_outstanding || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-100">
                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Paid Today</p>
                <p className="text-lg font-bold text-emerald-600" data-testid="stat-paid-today">
                  {formatCurrency(pendingStats?.paid_today || summary.paid_today || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${pendingStats?.overdue_amount > 0 ? 'bg-red-100' : 'bg-blue-100'}`}>
                <AlertTriangle className={`w-4 h-4 ${pendingStats?.overdue_amount > 0 ? 'text-red-600' : 'text-blue-600'}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Overdue Amount</p>
                <p className={`text-lg font-bold ${pendingStats?.overdue_amount > 0 ? 'text-red-600' : ''}`} data-testid="stat-overdue">
                  {formatCurrency(pendingStats?.overdue_amount || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Alert Cards for Overdue and High Value */}
      {pendingStats && (pendingStats.overdue_count > 0 || pendingStats.high_value_count > 0) && (
        <div className="flex flex-wrap gap-3">
          {pendingStats.overdue_count > 0 && (
            <Badge variant="destructive" className="px-3 py-1.5 text-sm cursor-pointer" onClick={() => setPendingFilter('overdue')}>
              <AlertTriangle className="w-4 h-4 mr-1" />
              {pendingStats.overdue_count} Overdue ({formatCurrency(pendingStats.overdue_amount)})
            </Badge>
          )}
          {pendingStats.high_value_count > 0 && (
            <Badge variant="secondary" className="px-3 py-1.5 text-sm bg-amber-100 text-amber-800 cursor-pointer" onClick={() => setPendingFilter('high_value')}>
              <TrendingUp className="w-4 h-4 mr-1" />
              {pendingStats.high_value_count} High Value ({formatCurrency(pendingStats.high_value_amount)})
            </Badge>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="pending-payouts-tab">
            <Banknote className="w-4 h-4 mr-2" />
            Pending Payouts
            {pendingTxns.length > 0 && (
              <Badge variant="secondary" className="ml-2">{pendingTxns.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="payment-history-tab">
            <History className="w-4 h-4 mr-2" />
            Payment History
          </TabsTrigger>
        </TabsList>

        {/* Pending Payouts Tab */}
        <TabsContent value="pending" className="space-y-4">
          {/* Filter Toolbar */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by phone, transaction ID, or card..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="payments-pending-search"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={pendingFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setPendingFilter('all')}>All</Button>
              <Button variant={pendingFilter === 'overdue' ? 'destructive' : 'outline'} size="sm" onClick={() => setPendingFilter('overdue')}>
                <AlertTriangle className="w-3 h-3 mr-1" /> Overdue
              </Button>
              <Button variant={pendingFilter === 'high_value' ? 'default' : 'outline'} size="sm" onClick={() => setPendingFilter('high_value')} className={pendingFilter === 'high_value' ? 'bg-amber-600' : ''}>
                <TrendingUp className="w-3 h-3 mr-1" /> High Value
              </Button>
            </div>
          </div>

          {/* Date Range + Presets + Export */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDatePreset(null); }} className="w-[150px]" data-testid="pending-date-from" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDatePreset(null); }} className="w-[150px]" data-testid="pending-date-to" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'today', label: 'Today' },
                { key: 'this_week', label: 'This Week' },
                { key: 'this_month', label: 'This Month' },
                { key: 'last_30', label: 'Last 30 Days' },
              ].map(({ key, label }) => (
                <Button key={key} variant={datePreset === key ? 'default' : 'outline'} size="sm" className="h-8 text-xs"
                  onClick={() => { if (datePreset === key) { setDatePreset(null); setDateFrom(''); setDateTo(''); } else { applyPendingDatePreset(key); } }}
                  data-testid={`pending-preset-${key}`}
                >{label}</Button>
              ))}
            </div>
            {(pendingFilter !== 'all' || datePreset || dateFrom || dateTo || searchQuery) && (
              <Button variant="ghost" size="sm" onClick={() => { setPendingFilter('all'); setDatePreset(null); setDateFrom(''); setDateTo(''); setSearchQuery(''); }} data-testid="clear-pending-filters">
                Clear Filters
              </Button>
            )}
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={() => handleExportExcel('pending')} data-testid="export-pending-excel">
                <Download className="w-4 h-4 mr-1" /> Export Excel
              </Button>
            </div>
          </div>

          {/* Summary Bar */}
          {pendingTxns.length > 0 && (
            <Card data-testid="pending-summary-bar">
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Total Payable:</span>
                    <span className="font-semibold text-amber-600" data-testid="summary-total-payable">
                      {formatCurrency(pendingTxns.reduce((sum, t) => sum + (t.amount_remaining_to_customer || 0), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Swipe Total:</span>
                    <span className="font-semibold" data-testid="summary-swipe-total">
                      {formatCurrency(pendingTxns.reduce((sum, t) => sum + (t.transaction_type === 'type_02' ? (t.pay_to_card_amount || t.swipe_amount || 0) : (t.swipe_amount || 0)), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Paid:</span>
                    <span className="font-semibold text-emerald-600" data-testid="summary-paid">
                      {formatCurrency(pendingTxns.reduce((sum, t) => sum + (t.amount_paid_to_customer || 0), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Count:</span>
                    <span className="font-semibold" data-testid="summary-count">{pendingPagination.total || pendingTxns.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {pendingTxns.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Banknote className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pending payouts</p>
                <p className="text-sm text-muted-foreground mt-1">All customer payments are up to date</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Txn ID</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handlePendingSort('customer')} data-testid="pending-sort-customer">
                      <span className="flex items-center">Customer<SortIcon column="customer" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handlePendingSort('gateway')} data-testid="pending-sort-gateway">
                      <span className="flex items-center">Gateway<SortIcon column="gateway" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handlePendingSort('swipe')} data-testid="pending-sort-swipe">
                      <span className="flex items-center justify-end">Swipe<SortIcon column="swipe" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handlePendingSort('remaining')} data-testid="pending-sort-remaining">
                      <span className="flex items-center justify-end">Remaining<SortIcon column="remaining" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-center" onClick={() => handlePendingSort('date')} data-testid="pending-sort-date">
                      <span className="flex items-center justify-center">Days<SortIcon column="date" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingTxns.map((txn) => {
                    const remaining = txn.amount_remaining_to_customer || txn.amount_to_customer || 0;
                    const paid = txn.amount_paid_to_customer || ((txn.amount_to_customer || 0) - remaining);
                    const isOverdue = txn.is_overdue || txn.days_pending > 7;
                    const isHighValue = txn.is_high_value || remaining > 50000;
                    return (
                      <TableRow 
                        key={txn.id} 
                        data-testid={`payout-row-${txn.id}`} 
                        className={`cursor-pointer hover:bg-muted/50 ${isOverdue ? 'bg-red-50' : ''}`}
                        onClick={() => {
                          setSelectedPaymentDetail(txn);
                          setShowDetailDrawer(true);
                        }}
                      >
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            <Link2 className="w-3 h-3 mr-1" />
                            {txn.transaction_id || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {txn.customer_name}
                            {txn.customer_readable_id && (
                              <span className="ml-1 text-xs text-muted-foreground">({txn.customer_readable_id})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {txn.card_details && (
                              <span className="flex items-center gap-1">
                                <CreditCard className="w-3 h-3" />
                                {txn.card_details}
                              </span>
                            )}
                            {txn.customer_payment_history > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                {txn.customer_payment_history} prev payments
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <Building2 className="w-3 h-3 inline mr-1 text-muted-foreground" />
                            {txn.swipe_gateway_name || txn.gateway_name || '-'}
                          </div>
                          {(txn.swipe_server_name || txn.server_name) && (
                            <div className="text-xs text-muted-foreground">{txn.swipe_server_name || txn.server_name}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatCurrency(txn.transaction_type === 'type_02' ? (txn.pay_to_card_amount || txn.swipe_amount || txn.total_swiped || 0) : (txn.swipe_amount || txn.total_swiped || 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium text-amber-600">{formatCurrency(remaining)}</div>
                          {paid > 0 && (
                            <div className="text-xs text-emerald-600">Paid: {formatCurrency(paid)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={txn.days_pending <= 1 ? "default" : txn.days_pending <= 7 ? "secondary" : "destructive"} className="text-xs">
                            {txn.days_pending || 0}d
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {isOverdue && (
                              <Badge variant="destructive" className="text-[10px]">
                                <AlertTriangle className="w-2 h-2 mr-0.5" /> Overdue
                              </Badge>
                            )}
                            {isHighValue && (
                              <Badge className="text-[10px] bg-amber-100 text-amber-800">
                                High Value
                              </Badge>
                            )}
                            {!isOverdue && !isHighValue && (
                              <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPaymentDetail(txn);
                                setShowDetailDrawer(true);
                              }}
                              data-testid={`view-payment-${txn.id}`}
                            >
                              View
                            </Button>
                            <Button 
                              size="sm" 
                              onClick={(e) => {
                                e.stopPropagation();
                                openPaymentDialog(txn);
                              }}
                              data-testid={`pay-btn-${txn.id}`}
                            >
                              Pay
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
          
          {/* Pending Pagination */}
          {pendingPagination.total > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Showing {((pendingPagination.page - 1) * pageSize) + 1} to {Math.min(pendingPagination.page * pageSize, pendingPagination.total)} of {pendingPagination.total}
                </span>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[100px] h-10 sm:h-8" data-testid="pending-page-size">
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
              {pendingPagination.pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 sm:h-8"
                    onClick={() => handlePendingPageChange(pendingPagination.page - 1)}
                    disabled={pendingPagination.page <= 1}
                    data-testid="pending-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {pendingPagination.page} of {pendingPagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 sm:h-8"
                    onClick={() => handlePendingPageChange(pendingPagination.page + 1)}
                    disabled={pendingPagination.page >= pendingPagination.pages}
                    data-testid="pending-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Payment History Tab */}
        <TabsContent value="history" className="space-y-4">
          {/* Stats Summary Cards - Action-oriented */}
          {historyStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-100">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Paid</p>
                      <p className="text-lg font-bold text-emerald-600">{formatCurrency(historyStats.total_paid)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-100">
                      <BarChart3 className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Payment Count</p>
                      <p className="text-lg font-bold">{historyStats.payment_count || paymentHistory.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-100">
                      <ArrowUpRight className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Largest Payment</p>
                      <p className="text-lg font-bold">{formatCurrency(historyStats.largest_payment || 0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-100">
                      <Clock className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last Payment</p>
                      <p className="text-lg font-bold text-sm">{historyStats.latest_payment_date ? formatDateShort(historyStats.latest_payment_date) : '-'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Filters */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by phone or transaction..."
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                className="pl-9"
                data-testid="history-search"
              />
            </div>
            <Select value={historyMethodFilter} onValueChange={setHistoryMethodFilter}>
              <SelectTrigger className="w-[160px]" data-testid="history-method-filter">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
              <Input type="date" value={historyDateFrom} onChange={(e) => { setHistoryDateFrom(e.target.value); setHistoryDatePreset(null); }} className="w-[150px]" data-testid="history-date-from" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
              <Input type="date" value={historyDateTo} onChange={(e) => { setHistoryDateTo(e.target.value); setHistoryDatePreset(null); }} className="w-[150px]" data-testid="history-date-to" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'today', label: 'Today' },
                { key: 'this_week', label: 'This Week' },
                { key: 'this_month', label: 'This Month' },
                { key: 'last_30', label: 'Last 30 Days' },
              ].map(({ key, label }) => (
                <Button key={key} variant={historyDatePreset === key ? 'default' : 'outline'} size="sm" className="h-8 text-xs"
                  onClick={() => { if (historyDatePreset === key) { setHistoryDatePreset(null); setHistoryDateFrom(''); setHistoryDateTo(''); } else { applyHistoryDatePreset(key); } }}
                  data-testid={`history-preset-${key}`}
                >{label}</Button>
              ))}
            </div>
            {(historyMethodFilter !== 'all' || historyDatePreset || historyDateFrom || historyDateTo || historySearchQuery) && (
              <Button variant="ghost" size="sm" onClick={() => { setHistoryMethodFilter('all'); setHistoryDatePreset(null); setHistoryDateFrom(''); setHistoryDateTo(''); setHistorySearchQuery(''); }} data-testid="clear-history-filters">
                Clear Filters
              </Button>
            )}
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={() => handleExportExcel('history')} data-testid="export-history-excel">
                <Download className="w-4 h-4 mr-1" /> Export Excel
              </Button>
            </div>
          </div>

          {/* Enhanced History Table */}
          <Card className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleHistorySort('date')} data-testid="history-sort-date">
                    <span className="flex items-center">Date<SortIcon column="date" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleHistorySort('customer')} data-testid="history-sort-customer">
                    <span className="flex items-center">Customer<SortIcon column="customer" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead className="text-right">Swipe</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleHistorySort('amount')} data-testid="history-sort-amount">
                    <span className="flex items-center justify-end">Paid<SortIcon column="amount" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead className="text-center">Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No payment history found
                    </TableCell>
                  </TableRow>
                ) : (
                  paymentHistory.map((payment) => (
                    <TableRow 
                      key={payment.id} 
                      data-testid={`history-row-${payment.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSelectedPaymentDetail(payment);
                        setShowDetailDrawer(true);
                      }}
                    >
                      <TableCell className="text-sm">{formatDateShort(payment.created_at || payment.paid_at)}</TableCell>
                      <TableCell>
                        {payment.transaction_id_readable ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            <Link2 className="w-3 h-3 mr-1" />
                            {payment.transaction_id_readable}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{payment.customer_name || '-'}</div>
                        {payment.card_details && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <CreditCard className="w-3 h-3" />
                            {payment.card_details}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatCurrency(payment.transaction_type === 'type_02' ? (payment.pay_to_card_amount || payment.swipe_amount || 0) : (payment.swipe_amount || 0)) || '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium text-emerald-600">
                        {formatCurrency(payment.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{payment.payment_source_name || payment.source_name || '-'}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {payment.gateway_name || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        {payment.days_to_payment !== undefined && payment.days_to_payment !== null ? (
                          <Badge variant={payment.days_to_payment <= 1 ? "default" : payment.days_to_payment <= 7 ? "secondary" : "destructive"} className="text-xs">
                            {payment.days_to_payment}d
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {payment.is_full_payment ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Full
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <Clock className="w-3 h-3 mr-1" /> Partial
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPaymentDetail(payment);
                              setShowDetailDrawer(true);
                            }}
                            data-testid={`view-history-${payment.id}`}
                          >
                            View
                          </Button>
                          {!payment.voided && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                              onClick={(e) => openVoidDialog(e, payment)}
                              data-testid={`void-payment-${payment.id}`}
                            >
                              <Ban className="w-3 h-3 mr-1" />
                              Void
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
          
          {/* History Pagination */}
          {historyPagination.total > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Showing {((historyPagination.page - 1) * pageSize) + 1} to {Math.min(historyPagination.page * pageSize, historyPagination.total)} of {historyPagination.total}
                </span>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[100px] h-8" data-testid="history-page-size">
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
              {historyPagination.pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleHistoryPageChange(historyPagination.page - 1)}
                    disabled={historyPagination.page <= 1}
                    data-testid="history-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {historyPagination.page} of {historyPagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleHistoryPageChange(historyPagination.page + 1)}
                    disabled={historyPagination.page >= historyPagination.pages}
                    data-testid="history-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Payment Dialog */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment to Customer</DialogTitle>
            <DialogDescription>
              Pay {selectedTxn?.customer_name} for transaction on {selectedTxn && formatDateShort(selectedTxn.created_at)}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePayment}>
            <div className="space-y-4">
              {/* Amount Info */}
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex justify-between text-sm">
                  <span>{selectedTxn?.transaction_type === 'type_02' ? 'Pay to Card:' : 'Swipe Amount:'}</span>
                  <span>{formatCurrency(selectedTxn?.transaction_type === 'type_02' ? (selectedTxn?.pay_to_card_amount || 0) : (selectedTxn?.swipe_amount || 0))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>To Pay:</span>
                  <span>{formatCurrency(selectedTxn?.amount_to_customer || 0)}</span>
                </div>
                <div className="flex justify-between font-medium pt-2 border-t mt-2">
                  <span>Remaining:</span>
                  <span className="text-amber-600">
                    {formatCurrency(selectedTxn?.amount_remaining_to_customer || selectedTxn?.amount_to_customer || 0)}
                  </span>
                </div>
              </div>

              {/* Payment Source */}
              <div className="space-y-2">
                <Label>Payment Source *</Label>
                <SearchableSelect
                  value={`${paymentForm.payment_source_type}:${paymentForm.payment_source_id}`}
                  onValueChange={(v) => {
                    const [type, id] = v.split(':');
                    setPaymentForm(prev => ({ ...prev, payment_source_type: type, payment_source_id: id }));
                  }}
                  placeholder="Search source..."
                  items={paymentSources.map(source => ({
                    value: `${source.source_type}:${source.source_id}`,
                    label: `${source.source_name} (${formatCurrency(source.balance)})`,
                  }))}
                  triggerTestId="payment-source-select"
                />
                {paymentForm.payment_source_id && (
                  <p className="text-xs text-muted-foreground">
                    Available balance: {formatCurrency(getSelectedSourceBalance())}
                  </p>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="Enter amount"
                  data-testid="payment-amount-input"
                />
              </div>

              {/* Payment Method - Auto-determined */}
              {paymentForm.payment_source_id && (
                <div className="p-2 bg-muted/50 rounded text-sm">
                  <span className="text-muted-foreground">Payment Method: </span>
                  <span className="font-medium">
                    {paymentForm.payment_source_type.includes('gateway') ? 'Bank Transfer' : 'Cash'}
                  </span>
                </div>
              )}

              {/* Reference Number */}
              <div className="space-y-2">
                <Label>Reference Number</Label>
                <Input
                  value={paymentForm.reference_number}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, reference_number: e.target.value }))}
                  placeholder="UTR, cheque number, etc."
                  data-testid="reference-input"
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  data-testid="notes-input"
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setShowPayDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} data-testid="confirm-payment-btn">
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Record Payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      {/* Payment Detail Drawer */}
      <PaymentDetailDrawer
        open={showDetailDrawer}
        onClose={() => setShowDetailDrawer(false)}
        payment={selectedPaymentDetail}
        api={api}
      />

      {/* Void Payment Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={(open) => { setShowVoidDialog(open); if (!open) setVoidReason(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="w-5 h-5" />
              Void Payment
            </DialogTitle>
            <DialogDescription>
              This will reverse the payment of{' '}
              <span className="font-semibold text-foreground">
                {formatCurrency(selectedVoidPayment?.amount || 0)}
              </span>{' '}
              to{' '}
              <span className="font-semibold text-foreground">
                {selectedVoidPayment?.customer_name}
              </span>
              . The wallet will be credited back and the transaction will return to pending status.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Payment summary */}
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount to reverse</span>
                <span className="font-semibold text-red-600">{formatCurrency(selectedVoidPayment?.amount || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Source wallet</span>
                <span>{selectedVoidPayment?.payment_source_name || selectedVoidPayment?.wallet_name || '-'}</span>
              </div>
              {selectedVoidPayment?.transaction_id_readable && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transaction</span>
                  <span className="font-mono">{selectedVoidPayment.transaction_id_readable}</span>
                </div>
              )}
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="void-reason">
                Reason <span className="text-red-500">*</span>
              </Label>
              <Input
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Duplicate payment, wrong amount..."
                maxLength={500}
                data-testid="void-reason-input"
              />
              <p className="text-xs text-muted-foreground">
                {voidReason.length}/500 · Minimum 5 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowVoidDialog(false); setVoidReason(''); }}
              disabled={voidSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoidPayment}
              disabled={voidSubmitting || voidReason.trim().length < 5}
              data-testid="confirm-void-btn"
            >
              {voidSubmitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Voiding...</>
              ) : (
                <><Ban className="w-4 h-4 mr-2" /> Void Payment</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
