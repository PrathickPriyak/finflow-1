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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { 
  Banknote, Building2, Loader2, History,
  ArrowDownLeft, Calendar, Search, Percent, CreditCard,
  Clock, TrendingUp, Users, Link2, CheckCircle2,
  Wallet, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown, Download, BarChart3
} from 'lucide-react';
import { formatCurrency, formatDate, formatDateShort, getAgeDays , getApiError } from '@/lib/formatters';
import TableSkeleton from '@/components/TableSkeleton';
import { CollectionDetailDrawer } from '@/components/DetailDrawers';
import SettlementWizard from '@/components/SettlementWizard';

export default function CollectionsPage() {
  const { api } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [pendingPayments, setPendingPayments] = useState([]);
  const [collectionHistory, setCollectionHistory] = useState([]);
  const [historyStats, setHistoryStats] = useState(null);
  const [pendingStats, setPendingStats] = useState(null);
  const [summary, setSummary] = useState({ total_receivable: 0, collected_today: 0 });
  const [wallets, setWallets] = useState([]);
  const [bankPaymentTypes, setBankPaymentTypes] = useState([]);
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
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [datePreset, setDatePreset] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Detail drawer
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [selectedCollectionDetail, setSelectedCollectionDetail] = useState(null);

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
  
  // NEW: Unified Settlement Wizard
  const [showSettlementWizard, setShowSettlementWizard] = useState(false);
  const [selectedCollectionForSettlement, setSelectedCollectionForSettlement] = useState(null);

  // Void settlement state
  const [voidTarget, setVoidTarget] = useState(null); // { collectionId, settlementId, amount, customerName }
  const [voiding, setVoiding] = useState(false);

  // Date preset helper
  const applyDatePreset = (preset) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let from = today, to = today;
    
    if (preset === 'today') {
      from = to = today;
    } else if (preset === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      from = to = yesterday.toISOString().split('T')[0];
    } else if (preset === 'this_week') {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      from = weekStart.toISOString().split('T')[0];
      to = today;
    } else if (preset === 'this_month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      to = today;
    } else if (preset === 'last_30') {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      from = past.toISOString().split('T')[0];
      to = today;
    }
    
    setDatePreset(preset);
    setDateFrom(from);
    setDateTo(to);
  };

  // Age badge helper
  const getAgeBadge = (createdAt) => {
    if (!createdAt) return null;
    try {
      const created = new Date(createdAt);
      const days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      if (days >= 30) return <Badge className="bg-red-100 text-red-700 text-xs" data-testid="age-badge-overdue">{days}d</Badge>;
      if (days >= 7) return <Badge className="bg-amber-100 text-amber-700 text-xs" data-testid="age-badge-aging">{days}d</Badge>;
      if (days >= 1) return <Badge className="bg-blue-100 text-blue-700 text-xs" data-testid="age-badge-recent">{days}d</Badge>;
      return <Badge className="bg-emerald-100 text-emerald-700 text-xs" data-testid="age-badge-new">Today</Badge>;
    } catch { return null; }
  };
  
  const handleVoidSettlement = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      const res = await api.post(`/collections/${voidTarget.collectionId}/void-settlement/${voidTarget.settlementId}`);
      toast.success(res.data?.message || 'Settlement voided successfully');
      setVoidTarget(null);
      fetchData();
      fetchHistoryData(historyPagination?.page || 1);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to void settlement'));
    } finally {
      setVoiding(false);
    }
  };
  
  // Open unified settlement wizard
  const openSettlementWizard = (collection) => {
    setSelectedCollectionForSettlement(collection);
    setShowSettlementWizard(true);
  };
  
  // Handle settlement success
  const handleSettlementSuccess = () => {
    fetchData();
    if (activeTab === 'pending') {
      fetchPendingData(pendingPagination.page);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);
  
  // Fetch history stats when date filter or tab changes
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistoryStats();
      fetchHistoryData(1);
    }
  }, [dateFilter, activeTab]);
  
  // Refetch when page size changes
  useEffect(() => {
    if (activeTab === 'pending') {
      fetchPendingData(1);
    } else {
      fetchHistoryData(1);
    }
  }, [pageSize]);
  
  // Debounced search for pending collections
  useEffect(() => {
    if (activeTab === 'pending') {
      const timer = setTimeout(() => {
        fetchPendingData(1);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchQuery]);

  // Sort change triggers
  useEffect(() => {
    if (activeTab === 'pending') fetchPendingData(1);
  }, [pendingSortBy, pendingSortOrder, sourceFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistoryData(1);
  }, [historySortBy, historySortOrder]);

  // Debounced search for history tab
  useEffect(() => {
    if (activeTab === 'history') {
      const timer = setTimeout(() => {
        fetchHistoryData(1);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [historySearchQuery]);

  // BUG-FIX: Wrap fetchData in useCallback with api dependency
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRes, walletsRes, paymentTypesRes, pendingStatsRes] = await Promise.all([
        api.get(`/collections?page=1&limit=${pageSize}`),
        api.get('/wallets'),
        api.get('/bank-payment-types'),
        api.get('/collections/stats'),
      ]);
      
      // Handle paginated response
      const pendingData = pendingRes.data?.data || pendingRes.data || [];
      const pending = Array.isArray(pendingData) ? pendingData : [];
      setPendingPayments(pending);
      
      if (pendingRes.data?.pagination) {
        setPendingPagination(pendingRes.data.pagination);
      }
      
      // Only cash and bank wallets for collections
      setWallets(walletsRes.data.filter(w => w.wallet_type === 'cash' || w.wallet_type === 'bank'));
      setBankPaymentTypes(paymentTypesRes.data);
      
      // Calculate summary
      const totalReceivable = pending.reduce((sum, p) => sum + (p.amount - (p.settled_amount || 0)), 0);
      
      // Get today's collections from settlements
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      let collectedToday = 0;
      const allHistory = [];
      
      (Array.isArray(pendingData) ? pendingData : []).forEach(p => {
        if (p.settlements) {
          p.settlements.forEach(s => {
            allHistory.push({
              ...s,
              customer_name: p.customer_name,
              transaction_id: p.transaction_id,
            });
            
            const settledDate = new Date(s.settled_at);
            if (settledDate >= todayStart) {
              collectedToday += s.amount;
            }
          });
        }
      });
      
      // Sort history by date descending
      allHistory.sort((a, b) => new Date(b.settled_at) - new Date(a.settled_at));
      setCollectionHistory(allHistory);
      
      setSummary({
        total_receivable: totalReceivable,
        collected_today: collectedToday,
      });
      
      setPendingStats(pendingStatsRes.data || null);
      
      // Fetch enhanced history from new endpoint
      try {
        const historyRes = await api.get(`/collections/history?page=1&limit=${pageSize}`);
        if (historyRes.data?.data) {
          setCollectionHistory(historyRes.data.data);
        }
        if (historyRes.data?.pagination) {
          setHistoryPagination(historyRes.data.pagination);
        }
      } catch (e) {
        // Fallback to basic history
      }
    } catch (error) {
      toast.error('Failed to load collections data');
    } finally {
      setLoading(false);
    }
  }, [api, pageSize]);
  
  const fetchPendingData = async (page = 1) => {
    try {
      let url = `/collections?page=${page}&limit=${pageSize}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      if (pendingSortBy) url += `&sort_by=${pendingSortBy}&sort_order=${pendingSortOrder}`;
      if (sourceFilter !== 'all') url += `&source=${sourceFilter}`;
      if (statusFilter !== 'all') url += `&status=${statusFilter}`;
      if (dateFrom) url += `&date_from=${dateFrom}`;
      if (dateTo) url += `&date_to=${dateTo}`;
      const res = await api.get(url);
      const pendingData = res.data?.data || res.data || [];
      const pending = Array.isArray(pendingData) ? pendingData : [];
      setPendingPayments(pending);
      if (res.data?.pagination) {
        setPendingPagination(res.data.pagination);
      }
    } catch (error) {
      toast.error('Failed to load pending collections');
    }
  };
  
  const fetchHistoryData = async (page = 1) => {
    try {
      let url = `/collections/history?page=${page}&limit=${pageSize}`;
      if (historySortBy) url += `&sort_by=${historySortBy}&sort_order=${historySortOrder}`;
      if (historySearchQuery) url += `&search=${encodeURIComponent(historySearchQuery)}`;
      const res = await api.get(url);
      if (res.data?.data) {
        setCollectionHistory(res.data.data);
      }
      if (res.data?.pagination) {
        setHistoryPagination(res.data.pagination);
      }
    } catch (error) {
      toast.error('Failed to load collection history');
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

  const handleExportExcel = async (tab) => {
    try {
      toast.info('Generating Excel file...');
      let url = `/collections/export-excel?tab=${tab}`;
      if (tab === 'pending') {
        if (sourceFilter !== 'all') url += `&source=${sourceFilter}`;
        if (statusFilter !== 'all') url += `&status=${statusFilter}`;
        if (dateFrom) url += `&date_from=${dateFrom}`;
        if (dateTo) url += `&date_to=${dateTo}`;
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      }
      const res = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = tab === 'history' ? 'collection_history.xlsx' : 'pending_collections.xlsx';
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Excel downloaded successfully');
    } catch (error) {
      toast.error(getApiError(error, 'Failed to export Excel'));
    }
  };
  
  const fetchHistoryStats = async () => {
    try {
      const res = await api.get(`/collections/history-stats?period=${dateFilter}`);
      setHistoryStats(res.data);
    } catch (error) {
      toast.error('Failed to load collection stats');
    }
  };

  // Filter history
  const filteredHistory = collectionHistory.filter(collection => {
    const matchesSearch = !searchQuery || 
      collection.customer_phone?.includes(searchQuery);
    
    if (dateFilter === 'all') return matchesSearch;
    
    const days = getAgeDays(collection.settled_at);
    if (dateFilter === 'today' && days < 1) return matchesSearch;
    if (dateFilter === 'week' && days <= 7) return matchesSearch;
    if (dateFilter === 'month' && days <= 30) return matchesSearch;
    
    return false;
  });

  if (loading) {
    return (
      <div className="space-y-6" data-testid="collections-loading-skeleton">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array(4).fill(0).map((_, i) => (
            <Card key={`skeleton-${i}`}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
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
    <div className="space-y-6" data-testid="collections-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Collections</h1>
          <p className="text-muted-foreground mt-1">Manage incoming collections from customers</p>
        </div>
      </div>

      {/* Summary Cards - 3 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <Percent className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Receivable</p>
                <p className="text-2xl font-bold text-amber-600" data-testid="stat-total-receivable">
                  {formatCurrency(pendingStats?.total_receivable || summary.total_receivable)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Collected Today</p>
                <p className="text-2xl font-bold text-emerald-600" data-testid="stat-collected-today">
                  {formatCurrency(pendingStats?.collected_today || summary.collected_today)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${pendingStats?.overdue_amount > 0 ? 'bg-red-100' : 'bg-purple-100'}`}>
                <Clock className={`w-5 h-5 ${pendingStats?.overdue_amount > 0 ? 'text-red-600' : 'text-purple-600'}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue (30+ days)</p>
                <p className={`text-2xl font-bold ${pendingStats?.overdue_amount > 0 ? 'text-red-600' : ''}`} data-testid="stat-overdue">
                  {formatCurrency(pendingStats?.overdue_amount || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Top Pending Customers */}
      {pendingStats?.top_pending_customers?.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Top Pending Customers</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingStats.top_pending_customers.map((cust, i) => (
                <Badge key={cust.customer || i} variant={cust.amount > 50000 ? "destructive" : "secondary"} className="text-xs">
                  {cust.customer}: {formatCurrency(cust.amount)} ({cust.count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="pending-collections-tab">
            <Percent className="w-4 h-4 mr-2" />
            Pending Collections
            {pendingPayments.length > 0 && (
              <Badge variant="secondary" className="ml-2">{pendingPayments.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="collection-history-tab">
            <History className="w-4 h-4 mr-2" />
            Collection History
          </TabsTrigger>
        </TabsList>

        {/* Pending Collections Tab */}
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
                data-testid="pending-search"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-full sm:w-[160px]" data-testid="source-filter-trigger">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="type_02_transaction">Card Swipe</SelectItem>
                  <SelectItem value="service_charge">Service Charge</SelectItem>
                  <SelectItem value="migration">Migration</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[140px]" data-testid="status-filter-trigger">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date Range + Presets + Export */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setDatePreset(null); }}
                className="w-[150px]"
                data-testid="date-from-input"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setDatePreset(null); }}
                className="w-[150px]"
                data-testid="date-to-input"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'today', label: 'Today' },
                { key: 'this_week', label: 'This Week' },
                { key: 'this_month', label: 'This Month' },
                { key: 'last_30', label: 'Last 30 Days' },
              ].map(({ key, label }) => (
                <Button
                  key={key}
                  variant={datePreset === key ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    if (datePreset === key) {
                      setDatePreset(null);
                      setDateFrom('');
                      setDateTo('');
                    } else {
                      applyDatePreset(key);
                    }
                  }}
                  data-testid={`date-preset-${key}`}
                >
                  {label}
                </Button>
              ))}
            </div>
            {(sourceFilter !== 'all' || statusFilter !== 'all' || datePreset || dateFrom || dateTo || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSourceFilter('all');
                  setStatusFilter('all');
                  setDatePreset(null);
                  setDateFrom('');
                  setDateTo('');
                  setSearchQuery('');
                }}
                data-testid="clear-filters-btn"
              >
                Clear Filters
              </Button>
            )}
            <div className="ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExportExcel('pending')}
                data-testid="export-pending-excel"
              >
                <Download className="w-4 h-4 mr-1" />
                Export Excel
              </Button>
            </div>
          </div>

          {/* Summary Bar */}
          {pendingPayments.length > 0 && (
            <Card data-testid="collection-summary-bar">
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Total Due:</span>
                    <span className="font-semibold" data-testid="summary-total-due">
                      {formatCurrency(pendingPayments.reduce((sum, p) => sum + (p.amount || 0), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Collected:</span>
                    <span className="font-semibold text-emerald-600" data-testid="summary-collected">
                      {formatCurrency(pendingPayments.reduce((sum, p) => sum + (p.settled_amount || 0), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-semibold text-amber-600" data-testid="summary-remaining">
                      {formatCurrency(pendingPayments.reduce((sum, p) => sum + ((p.amount || 0) - (p.settled_amount || 0)), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Count:</span>
                    <span className="font-semibold" data-testid="summary-count">{pendingPagination.total || pendingPayments.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Flat Pending Table */}
          {pendingPayments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Percent className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pending collections</p>
                <p className="text-sm text-muted-foreground mt-1">All customer dues are collected</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Txn ID</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handlePendingSort('customer')} data-testid="coll-pending-sort-customer">
                      <span className="flex items-center">Customer<SortIcon column="customer" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead>Card</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handlePendingSort('date')} data-testid="coll-pending-sort-date">
                      <span className="flex items-center">Date<SortIcon column="date" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handlePendingSort('amount')} data-testid="coll-pending-sort-amount">
                      <span className="flex items-center justify-end">Total Due<SortIcon column="amount" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handlePendingSort('settled')} data-testid="coll-pending-sort-settled">
                      <span className="flex items-center justify-end">Collected<SortIcon column="settled" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handlePendingSort('remaining')} data-testid="coll-pending-sort-remaining">
                      <span className="flex items-center justify-end">Remaining<SortIcon column="remaining" sortBy={pendingSortBy} sortOrder={pendingSortOrder} /></span>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingPayments.map((payment) => {
                    const remaining = payment.amount - (payment.settled_amount || 0);
                    return (
                      <TableRow 
                        key={payment.id} 
                        data-testid={`collection-row-${payment.id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          setSelectedCollectionDetail(payment);
                          setShowDetailDrawer(true);
                        }}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline" className="font-mono text-xs">
                              {payment.transaction_id_readable || payment.transaction_id_display || '-'}
                            </Badge>
                            {payment.source === 'service_charge' && (
                              <Badge className="bg-amber-100 text-amber-700 text-xs" data-testid={`service-charge-badge-${payment.id}`}>
                                SC
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {payment.customer_name || '-'}
                            {payment.customer_readable_id && (
                              <span className="ml-1 text-xs text-muted-foreground">({payment.customer_readable_id})</span>
                            )}
                          </div>
                          {payment.customer_phone && (
                            <div className="text-xs text-muted-foreground">{payment.customer_phone}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          {payment.card_last_four ? (
                            <div className="flex items-center gap-1">
                              <CreditCard className="w-3 h-3 text-muted-foreground" />
                              <span className="text-sm">{payment.card_last_four}</span>
                            </div>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {formatDateShort(payment.created_at)}
                            {getAgeBadge(payment.created_at)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className="text-right text-emerald-600">
                          {payment.settled_amount > 0 ? formatCurrency(payment.settled_amount) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium text-amber-600">
                          {formatCurrency(remaining)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCollectionDetail(payment);
                                setShowDetailDrawer(true);
                              }}
                              data-testid={`view-collection-${payment.id}`}
                            >
                              View
                            </Button>
                            <Button 
                              size="sm" 
                              onClick={(e) => {
                                e.stopPropagation();
                                openSettlementWizard(payment);
                              }}
                              data-testid={`settle-btn-${payment.id}`}
                            >
                              <Wallet className="w-3 h-3 mr-1" />
                              Settle
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
                  <SelectTrigger className="w-[100px] h-10 sm:h-8" data-testid="collections-pending-page-size">
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
                    className="h-10 sm:h-8"
                    size="sm"
                    onClick={() => handlePendingPageChange(pendingPagination.page - 1)}
                    disabled={pendingPagination.page <= 1}
                    data-testid="collections-pending-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {pendingPagination.page} of {pendingPagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePendingPageChange(pendingPagination.page + 1)}
                    disabled={pendingPagination.page >= pendingPagination.pages}
                    data-testid="collections-pending-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Collection History Tab */}
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
                      <p className="text-xs text-muted-foreground">Total Collected</p>
                      <p className="text-lg font-bold text-emerald-600">{formatCurrency(historyStats.total_collected)}</p>
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
                      <p className="text-xs text-muted-foreground">Collection Count</p>
                      <p className="text-lg font-bold">{historyStats.collection_count || filteredHistory.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-100">
                      <ArrowDownLeft className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Largest Collection</p>
                      <p className="text-lg font-bold">{formatCurrency(historyStats.largest_collection || 0)}</p>
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
                      <p className="text-xs text-muted-foreground">Last Collection</p>
                      <p className="text-lg font-bold text-sm">{historyStats.latest_collection_date ? formatDateShort(historyStats.latest_collection_date) : '-'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by phone or transaction..."
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                className="pl-9"
                data-testid="history-search"
              />
            </div>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-[150px]" data-testid="date-filter">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => handleExportExcel('history')}
              data-testid="export-history-excel"
            >
              <Download className="w-4 h-4 mr-1" />
              Export Excel
            </Button>
          </div>

          {/* Enhanced History Table */}
          <Card className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleHistorySort('date')} data-testid="coll-history-sort-date">
                    <span className="flex items-center">Date<SortIcon column="date" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleHistorySort('customer')} data-testid="coll-history-sort-customer">
                    <span className="flex items-center">Customer<SortIcon column="customer" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleHistorySort('due')} data-testid="coll-history-sort-due">
                    <span className="flex items-center justify-end">Due<SortIcon column="due" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleHistorySort('amount')} data-testid="coll-history-sort-amount">
                    <span className="flex items-center justify-end">Collected<SortIcon column="amount" sortBy={historySortBy} sortOrder={historySortOrder} /></span>
                  </TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead className="text-center">Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No collection history found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredHistory.map((collection, index) => (
                    <TableRow 
                      key={collection.id || index} 
                      data-testid={`history-row-${index}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSelectedCollectionDetail(collection);
                        setShowDetailDrawer(true);
                      }}
                    >
                      <TableCell className="text-sm">{formatDateShort(collection.settled_at)}</TableCell>
                      <TableCell>
                        {collection.transaction_id_readable ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            <Link2 className="w-3 h-3 mr-1" />
                            {collection.transaction_id_readable}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{collection.customer_name || '-'}</div>
                        {collection.card_details && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <CreditCard className="w-3 h-3" />
                            {collection.card_details}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {collection.total_due_amount ? formatCurrency(collection.total_due_amount) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium text-emerald-600">
                        {formatCurrency(collection.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {collection.wallet_type === 'bank' ? (
                            <Building2 className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <Banknote className="w-3 h-3 text-muted-foreground" />
                          )}
                          <span className="text-sm">{collection.wallet_name || '-'}</span>
                        </div>
                        {collection.payment_type && (
                          <Badge variant="outline" className="text-xs mt-1">{collection.payment_type}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {collection.gateway_name || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        {collection.days_outstanding !== undefined && collection.days_outstanding !== null ? (
                          <Badge variant={collection.days_outstanding <= 7 ? "default" : collection.days_outstanding <= 30 ? "secondary" : "destructive"} className="text-xs">
                            {collection.days_outstanding}d
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {collection.is_full_settlement ? (
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
                              setSelectedCollectionDetail(collection);
                              setShowDetailDrawer(true);
                            }}
                            data-testid={`view-history-${collection.id || index}`}
                          >
                            View
                          </Button>
                          {!collection.voided && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setVoidTarget({
                                  collectionId: collection.pending_payment_id,
                                  settlementId: collection.id,
                                  amount: collection.amount,
                                  customerName: collection.customer_name
                                });
                              }}
                              data-testid={`void-settlement-${collection.id || index}`}
                              title="Void this settlement"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
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
                  <SelectTrigger className="w-[100px] h-8" data-testid="collections-history-page-size">
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
                    data-testid="collections-history-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {historyPagination.page} of {historyPagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleHistoryPageChange(historyPagination.page + 1)}
                    disabled={historyPagination.page >= historyPagination.pages}
                    data-testid="collections-history-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* NEW: Unified Settlement Wizard */}
      <SettlementWizard
        collection={selectedCollectionForSettlement}
        open={showSettlementWizard}
        onOpenChange={setShowSettlementWizard}
        onSuccess={handleSettlementSuccess}
      />

      {/* Collection Detail Drawer */}
      <CollectionDetailDrawer
        open={showDetailDrawer}
        onClose={() => setShowDetailDrawer(false)}
        collection={selectedCollectionDetail}
        api={api}
      />

      {/* Void Settlement Confirmation */}
      <AlertDialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Settlement</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the settlement of <strong>{voidTarget && formatCurrency(voidTarget.amount)}</strong> for <strong>{voidTarget?.customerName}</strong>. 
              The wallet will be debited and the collection will be reopened. This action is logged in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoidSettlement}
              disabled={voiding}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-void-settlement"
            >
              {voiding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Void Settlement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
