import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Receipt, Plus, Loader2, Wallet, TrendingDown, TrendingUp,
  Calendar as CalendarIcon, CreditCard, Banknote, Building2, PieChart,
  Zap, Download, Search, X, Trash2, ArrowUpDown, ArrowUp, ArrowDown,
  Users, FileText, ChevronLeft, ChevronRight
} from 'lucide-react';
import { formatCurrency, formatDateShort, formatDateTime , getApiError } from '@/lib/formatters';
import { ExpenseDetailDrawer } from '@/components/DetailDrawers';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const WalletIcon = ({ type }) => {
  switch (type) {
    case 'gateway': return <CreditCard className="w-4 h-4" />;
    case 'cash': return <Banknote className="w-4 h-4" />;
    case 'bank': return <Building2 className="w-4 h-4" />;
    default: return <Wallet className="w-4 h-4" />;
  }
};

const SortIcon = ({ column, sortBy, sortOrder }) => {
  if (sortBy !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
  return sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
};

export default function ExpensesPage() {
  const { api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState(null);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterWallet, setFilterWallet] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterAuto, setFilterAuto] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState(null);
  const [customDateTo, setCustomDateTo] = useState(null);

  // Sorting
  const [sortBy, setSortBy] = useState(null);
  const [sortOrder, setSortOrder] = useState('desc');

  // Add Expense Dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    expense_type_id: '',
    amount: '',
    wallet_id: '',
    expense_date: new Date().toISOString().split('T')[0],
    description: '',
    reference_number: '',
    vendor_name: ''
  });
  const [submitting, setSubmitting] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Detail Drawer
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);

  // Pagination
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(25);

  // Export
  const [exporting, setExporting] = useState(false);

  // Month selector for Overview
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const isCurrentMonth = selectedMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const navigateMonth = (direction) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    let newYear = y, newMonth = m + direction;
    if (newMonth > 12) { newMonth = 1; newYear++; }
    if (newMonth < 1) { newMonth = 12; newYear--; }
    setSelectedMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const applyDatePreset = useCallback((preset) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let from = today, to = today;
    if (preset === 'today') { from = to = today; }
    else if (preset === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = to = y.toISOString().split('T')[0];
    } else if (preset === 'this_week') {
      const ws = new Date(now); ws.setDate(ws.getDate() - ws.getDay());
      from = ws.toISOString().split('T')[0]; to = today;
    } else if (preset === 'this_month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; to = today;
    } else if (preset === 'last_30') {
      const p = new Date(now); p.setDate(p.getDate() - 30);
      from = p.toISOString().split('T')[0]; to = today;
    }
    setDateFrom(from);
    setDateTo(to);
    setCustomDateFrom(null);
    setCustomDateTo(null);
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [selectedMonth]);

  useEffect(() => {
    fetchExpenses(1);
  }, [filterType, filterWallet, filterUser, filterAuto, debouncedSearch, dateFrom, dateTo, pageSize, sortBy, sortOrder]);

  const fetchSummary = async () => {
    try {
      const summaryRes = await api.get(`/expenses/summary?month=${selectedMonth}`);
      setSummary(summaryRes.data);
    } catch (error) {
      // silent
    }
  };

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [typesRes, walletsRes, summaryRes, usersRes] = await Promise.all([
        api.get('/expense-types'),
        api.get('/wallets'),
        api.get(`/expenses/summary?month=${selectedMonth}`),
        api.get('/users').catch(() => ({ data: [] }))
      ]);
      setExpenseTypes(typesRes.data);
      setWallets(walletsRes.data.filter(w => !w.is_deleted));
      setSummary(summaryRes.data);
      const usersData = usersRes.data?.data || usersRes.data || [];
      setUsers(Array.isArray(usersData) ? usersData : []);
      await fetchExpenses(1);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchExpenses = async (page = 1) => {
    try {
      let url = `/expenses?page=${page}&limit=${pageSize}`;
      if (filterType) url += `&expense_type_id=${filterType}`;
      if (filterWallet) url += `&wallet_id=${filterWallet}`;
      if (filterUser) url += `&created_by=${filterUser}`;
      if (filterAuto !== 'all') url += `&is_auto=${filterAuto}`;
      if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
      if (dateFrom) url += `&from_date=${dateFrom}`;
      if (dateTo) url += `&to_date=${dateTo}`;
      if (sortBy) url += `&sort_by=${sortBy}&sort_order=${sortOrder}`;

      const response = await api.get(url);
      if (response.data?.data) {
        setExpenses(response.data.data);
        setPagination(response.data.pagination || { page, total: response.data.data.length, pages: 1 });
      } else {
        setExpenses(response.data);
        setPagination({ page: 1, total: response.data.length, pages: 1 });
      }
    } catch (error) {
      // silent
    }
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) fetchExpenses(newPage);
  };

  const handleAddExpense = async () => {
    if (!expenseForm.expense_type_id || !expenseForm.amount || !expenseForm.wallet_id) {
      toast.error('Please fill all required fields');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/expenses', { ...expenseForm, amount: parseFloat(expenseForm.amount) });
      toast.success('Expense added successfully');
      setAddDialogOpen(false);
      setExpenseForm({
        expense_type_id: '', amount: '', wallet_id: '',
        expense_date: new Date().toISOString().split('T')[0],
        description: '', reference_number: '', vendor_name: ''
      });
      fetchInitialData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to add expense'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/expenses/${deleteTarget.id}`);
      toast.success('Expense deleted and wallet refunded');
      setDeleteTarget(null);
      fetchInitialData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete'));
    }
  };

  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const params = [];
      if (filterType) params.push(`expense_type_id=${filterType}`);
      if (filterWallet) params.push(`wallet_id=${filterWallet}`);
      if (filterUser) params.push(`created_by=${filterUser}`);
      if (filterAuto !== 'all') params.push(`is_auto=${filterAuto}`);
      if (debouncedSearch) params.push(`search=${encodeURIComponent(debouncedSearch)}`);
      if (dateFrom) params.push(`from_date=${dateFrom}`);
      if (dateTo) params.push(`to_date=${dateTo}`);

      const response = await api.get(`/expenses/export?${params.join('&')}`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `expenses_${dateFrom || 'all'}_${dateTo || 'all'}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Excel exported successfully');
    } catch (error) {
      toast.error('Failed to export');
    } finally {
      setExporting(false);
    }
  };

  const clearAllFilters = () => {
    setFilterType('');
    setFilterWallet('');
    setFilterUser('');
    setFilterAuto('all');
    setSearchQuery('');
    setDatePreset(null);
    setDateFrom('');
    setDateTo('');
    setCustomDateFrom(null);
    setCustomDateTo(null);
    setSortBy(null);
    setSortOrder('desc');
  };

  const hasActiveFilters = filterType || filterWallet || filterUser ||
    filterAuto !== 'all' || searchQuery || datePreset || dateFrom || dateTo;

  const selectedWallet = wallets.find(w => w.id === expenseForm.wallet_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const mom = summary?.month_over_month;

  return (
    <div className="space-y-6" data-testid="expenses-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="text-muted-foreground mt-1">Track and manage business expenses</p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} data-testid="add-expense-btn">
          <Plus className="w-4 h-4 mr-2" />
          Add Expense
        </Button>
      </div>

      {/* Two Tabs */}
      <Tabs defaultValue="overview" data-testid="expenses-tabs">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <PieChart className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="tab-transactions">
            <FileText className="w-4 h-4 mr-2" />
            Expense Transactions
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: OVERVIEW ===== */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          {/* Month Navigator */}
          <div className="flex items-center justify-center gap-4" data-testid="month-navigator">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigateMonth(-1)}
              data-testid="month-prev-btn"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-[140px] sm:min-w-[180px] text-center">
              <h2 className="text-lg font-semibold" data-testid="month-label">
                {summary?.month_label || selectedMonth}
              </h2>
              {!isCurrentMonth && (
                <button
                  className="text-xs text-primary hover:underline mt-0.5"
                  onClick={() => setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)}
                  data-testid="go-to-current-btn"
                >
                  Go to current month
                </button>
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigateMonth(1)}
              disabled={isCurrentMonth}
              data-testid="month-next-btn"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          {/* Summary Cards */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${summary?.today ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
            {/* Today card - only shown for current month */}
            {summary?.today && (
              <Card data-testid="summary-today">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Today</p>
                      <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.today.total || 0)}</p>
                      <p className="text-xs text-muted-foreground">{summary.today.count || 0} expenses</p>
                    </div>
                    <div className="p-2 rounded-lg bg-red-100">
                      <TrendingDown className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card data-testid="summary-this-month">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{isCurrentMonth ? 'This Month' : summary?.month_label || 'Selected Month'}</p>
                    <p className="text-2xl font-bold">{formatCurrency(summary?.this_month?.total || 0)}</p>
                    <p className="text-xs text-muted-foreground">{summary?.this_month?.count || 0} expenses</p>
                  </div>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <CalendarIcon className="w-5 h-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="summary-auto">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Auto (PG Charges)</p>
                    <p className="text-2xl font-bold text-amber-600">{formatCurrency(summary?.auto_vs_manual?.auto?.total || 0)}</p>
                    <p className="text-xs text-muted-foreground">{summary?.auto_vs_manual?.auto?.count || 0} expenses</p>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-100">
                    <Zap className="w-5 h-5 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="summary-manual">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Manual</p>
                    <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary?.auto_vs_manual?.manual?.total || 0)}</p>
                    <p className="text-xs text-muted-foreground">{summary?.auto_vs_manual?.manual?.count || 0} expenses</p>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-100">
                    <Receipt className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Month-over-Month Comparison */}
          {mom && (
            <Card data-testid="mom-comparison">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${mom.direction === 'up' ? 'bg-red-100' : mom.direction === 'down' ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                    {mom.direction === 'up' ? (
                      <TrendingUp className="w-6 h-6 text-red-600" />
                    ) : mom.direction === 'down' ? (
                      <TrendingDown className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-6 h-6 text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Month-over-Month</p>
                    <div className="flex items-baseline gap-3 mt-1">
                      <span className="text-lg font-bold">{formatCurrency(mom.current_month_total)}</span>
                      <span className="text-sm text-muted-foreground">this month vs</span>
                      <span className="text-lg font-semibold text-muted-foreground">{formatCurrency(mom.last_month_total)}</span>
                      <span className="text-sm text-muted-foreground">last month</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      className={`text-sm px-3 py-1 ${
                        mom.direction === 'up' ? 'bg-red-100 text-red-700' :
                        mom.direction === 'down' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-gray-100 text-gray-700'
                      }`}
                      data-testid="mom-badge"
                    >
                      {mom.direction === 'up' ? '+' : ''}{mom.change_percent}%
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {mom.direction === 'down' ? 'Spending decreased' : mom.direction === 'up' ? 'Spending increased' : 'No change'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Daily Expense Trend */}
          {summary?.daily_trend?.length > 0 && (
            <Card data-testid="daily-trend-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="w-4 h-4" />
                  Daily Spending — {summary?.month_label || 'This Month'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={summary.daily_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) => { const parts = d.split('-'); return `${parts[2]}/${parts[1]}`; }}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        interval={4}
                      />
                      <YAxis
                        tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        width={45}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                        formatter={(value) => [formatCurrency(value), 'Spent']}
                        labelFormatter={(d) => { const parts = d.split('-'); return `${parts[2]}/${parts[1]}/${parts[0]}`; }}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#ef4444"
                        strokeWidth={2}
                        fill="url(#expenseGrad)"
                        dot={false}
                        activeDot={{ r: 4, stroke: '#ef4444', strokeWidth: 2, fill: '#fff' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>{summary.daily_trend[0]?.date?.split('-').reverse().join('/')}</span>
                  <span>
                    Total: {formatCurrency(summary.daily_trend.reduce((s, d) => s + d.total, 0))} across {summary.daily_trend.reduce((s, d) => s + d.count, 0)} expenses
                  </span>
                  <span>{summary.daily_trend[summary.daily_trend.length - 1]?.date?.split('-').reverse().join('/')}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Expense Type */}
            <Card data-testid="by-type-breakdown">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChart className="w-4 h-4" />
                  By Expense Type
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summary?.by_type?.length > 0 ? (
                  <div className="space-y-3">
                    {summary.by_type.map((item, idx) => {
                      const maxTotal = summary.by_type[0]?.total || 1;
                      const pct = Math.round((item.total / maxTotal) * 100);
                      return (
                        <div key={idx}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{item.name}</span>
                              <Badge variant="outline" className="text-xs">{item.count}</Badge>
                            </div>
                            <span className="font-bold text-red-600 text-sm">{formatCurrency(item.total)}</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5">
                            <div className="bg-red-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No expenses in {summary?.month_label || 'this month'}</p>
                )}
              </CardContent>
            </Card>

            {/* Top Vendors */}
            <Card data-testid="top-vendors">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Top 5 Vendors
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summary?.top_vendors?.length > 0 ? (
                  <div className="space-y-3">
                    {summary.top_vendors.map((vendor, idx) => {
                      const maxTotal = summary.top_vendors[0]?.total || 1;
                      const pct = Math.round((vendor.total / maxTotal) * 100);
                      return (
                        <div key={idx}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{idx + 1}</span>
                              <span className="font-medium text-sm">{vendor.name}</span>
                              <Badge variant="outline" className="text-xs">{vendor.count} txns</Badge>
                            </div>
                            <span className="font-bold text-red-600 text-sm">{formatCurrency(vendor.total)}</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5">
                            <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No vendor data in {summary?.month_label || 'this month'}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== TAB 2: EXPENSE TRANSACTIONS ===== */}
        <TabsContent value="transactions" className="space-y-4 mt-4">
          {/* Filters Row */}
          <div className="flex flex-wrap gap-3 items-center" data-testid="expense-filters">
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search description, vendor, reference, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="expense-search"
              />
            </div>
            <SearchableSelect
              value={filterType}
              onValueChange={setFilterType}
              placeholder="Search types..."
              allOption="All Types"
              items={expenseTypes.map(type => ({ value: type.id, label: type.name }))}
              className="w-[150px]"
              triggerTestId="type-filter-trigger"
            />
            <SearchableSelect
              value={filterWallet}
              onValueChange={setFilterWallet}
              placeholder="Search wallets..."
              allOption="All Wallets"
              items={wallets.map(w => ({ value: w.id, label: w.name }))}
              className="w-[150px]"
              triggerTestId="wallet-filter-trigger"
            />
            <SearchableSelect
              value={filterUser}
              onValueChange={setFilterUser}
              placeholder="Search users..."
              allOption="All Users"
              items={users.map(u => ({ value: u.id, label: u.name }))}
              className="w-[150px]"
              triggerTestId="user-filter-trigger"
            />
            <Select value={filterAuto} onValueChange={setFilterAuto}>
              <SelectTrigger className="w-[130px]" data-testid="auto-filter-trigger">
                <SelectValue placeholder="Auto/Manual" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Auto (PG)</SelectItem>
                <SelectItem value="false">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="custom-date-btn">
                  <CalendarIcon className="w-4 h-4" />
                  {customDateFrom ? (
                    <span className="text-xs">
                      {customDateFrom.toLocaleDateString()} - {customDateTo ? customDateTo.toLocaleDateString() : '...'}
                    </span>
                  ) : 'Custom Date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="start">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Calendar
                      mode="single"
                      selected={customDateFrom}
                      onSelect={(date) => {
                        setCustomDateFrom(date);
                        if (date) {
                          setDatePreset(null);
                          const from = date.toISOString().split('T')[0];
                          setDateFrom(from);
                          if (!customDateTo || date > customDateTo) {
                            setCustomDateTo(date);
                            setDateTo(from);
                          }
                        }
                      }}
                      disabled={(date) => date > new Date()}
                      className="rounded-md border"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Calendar
                      mode="single"
                      selected={customDateTo}
                      onSelect={(date) => {
                        setCustomDateTo(date);
                        if (date) {
                          setDatePreset(null);
                          setDateTo(date.toISOString().split('T')[0]);
                        }
                      }}
                      disabled={(date) => date > new Date() || (customDateFrom && date < customDateFrom)}
                      className="rounded-md border"
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="clear-filters-btn">
                <X className="w-3 h-3 mr-1" /> Clear Filters
              </Button>
            )}
          </div>

          {/* Date Presets */}
          <div className="flex flex-wrap gap-2 items-center" data-testid="date-presets">
            {[
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'this_week', label: 'This Week' },
              { key: 'this_month', label: 'This Month' },
              { key: 'last_30', label: 'Last 30 Days' },
            ].map(({ key, label }) => (
              <Button
                key={key}
                variant={datePreset === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (datePreset === key) {
                    setDatePreset(null); setDateFrom(''); setDateTo('');
                  } else {
                    setDatePreset(key); applyDatePreset(key);
                  }
                }}
                data-testid={`date-preset-${key}`}
              >
                {label}
              </Button>
            ))}
            <div className="ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={exporting || expenses.length === 0}
                data-testid="export-excel-btn"
              >
                <Download className="w-4 h-4 mr-2" />
                {exporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            </div>
          </div>

          {/* Summary Bar */}
          {expenses.length > 0 && (
            <Card data-testid="expense-summary-bar">
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-semibold text-red-600" data-testid="summary-total">
                      {formatCurrency(expenses.reduce((sum, e) => sum + (e.amount || 0), 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Count:</span>
                    <span className="font-semibold">{pagination.total}</span>
                  </div>
                  {pagination.total > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Page Avg:</span>
                      <span className="font-semibold">
                        {formatCurrency(expenses.reduce((sum, e) => sum + (e.amount || 0), 0) / expenses.length)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Expenses Table */}
          <Card>
            <CardContent className="p-0">
              {expenses.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="font-medium">{hasActiveFilters ? 'No expenses match filters' : 'No expenses yet'}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {hasActiveFilters ? 'Try adjusting your filters' : 'Click "Add Expense" to record one'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Expense ID</TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('date')}>
                        <div className="flex items-center">Date <SortIcon column="date" sortBy={sortBy} sortOrder={sortOrder} /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('type')}>
                        <div className="flex items-center">Type <SortIcon column="type" sortBy={sortBy} sortOrder={sortOrder} /></div>
                      </TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleSort('vendor')}>
                        <div className="flex items-center">Vendor <SortIcon column="vendor" sortBy={sortBy} sortOrder={sortOrder} /></div>
                      </TableHead>
                      <TableHead>Wallet</TableHead>
                      <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('amount')}>
                        <div className="flex items-center justify-end">Amount <SortIcon column="amount" sortBy={sortBy} sortOrder={sortOrder} /></div>
                      </TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((expense) => (
                      <TableRow
                        key={expense.id}
                        className="cursor-pointer hover:bg-muted/50"
                        data-testid={`expense-row-${expense.id}`}
                        onClick={() => { setSelectedExpense(expense); setShowDetailDrawer(true); }}
                      >
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {expense.expense_id || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateShort(expense.expense_date)}</TableCell>
                        <TableCell>
                          <Badge variant={expense.is_auto_created ? 'secondary' : 'outline'}>
                            {expense.is_auto_created && <Zap className="w-3 h-3 mr-1" />}
                            {expense.expense_type_name}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">{expense.description || '-'}</TableCell>
                        <TableCell className="text-sm">{expense.vendor_name || '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <WalletIcon type={expense.wallet_type} />
                            <span className="text-sm">{expense.wallet_name || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          -{formatCurrency(expense.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{expense.created_by_name || '-'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); setSelectedExpense(expense); setShowDetailDrawer(true); }}
                              data-testid={`view-expense-${expense.id}`}
                            >
                              View
                            </Button>
                            {!expense.is_auto_created && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget(expense); }}
                                data-testid={`delete-expense-${expense.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}

              {/* Pagination */}
              {expenses.length > 0 && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 px-4 pb-4">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      Showing {((pagination.page - 1) * pageSize) + 1} to {Math.min(pagination.page * pageSize, pagination.total)} of {pagination.total}
                    </p>
                    <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(parseInt(v))}>
                      <SelectTrigger className="w-[100px] h-8" data-testid="expenses-page-size">
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
                      <Button variant="outline" size="sm" onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page <= 1} data-testid="expenses-prev-page">
                        Previous
                      </Button>
                      <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
                      <Button variant="outline" size="sm" onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page >= pagination.pages} data-testid="expenses-next-page">
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Expense Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Add Expense
            </DialogTitle>
            <DialogDescription>
              Record a new expense. Amount will be deducted from selected wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Expense Type *</Label>
              <Select
                value={expenseForm.expense_type_id}
                onValueChange={(v) => setExpenseForm({...expenseForm, expense_type_id: v})}
              >
                <SelectTrigger data-testid="expense-type-select">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {expenseTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Amount (*) *</Label>
              <Input
                type="number"
                step="0.01"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm({...expenseForm, amount: e.target.value})}
                placeholder="Enter amount"
                data-testid="expense-amount-input"
              />
            </div>

            <div className="space-y-2">
              <Label>Pay From Wallet *</Label>
              <Select
                value={expenseForm.wallet_id}
                onValueChange={(v) => setExpenseForm({...expenseForm, wallet_id: v})}
              >
                <SelectTrigger data-testid="expense-wallet-select">
                  <SelectValue placeholder="Select wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <div className="flex items-center gap-2">
                        <WalletIcon type={w.wallet_type} />
                        {w.name} ({formatCurrency(w.balance)})
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWallet && (
                <div className="flex items-center justify-between px-3 py-2 bg-muted rounded-md text-sm" data-testid="wallet-balance-display">
                  <span className="text-muted-foreground">Available Balance:</span>
                  <span className={`font-semibold ${
                    expenseForm.amount && parseFloat(expenseForm.amount) > selectedWallet.balance ? 'text-red-500' : 'text-emerald-600'
                  }`}>
                    {formatCurrency(selectedWallet.balance)}
                  </span>
                </div>
              )}
              {selectedWallet && expenseForm.amount && parseFloat(expenseForm.amount) > selectedWallet.balance && (
                <p className="text-xs text-red-500">Insufficient balance</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={expenseForm.expense_date}
                onChange={(e) => setExpenseForm({...expenseForm, expense_date: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={expenseForm.description}
                onChange={(e) => setExpenseForm({...expenseForm, description: e.target.value})}
                placeholder="What is this expense for?"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reference/Invoice #</Label>
                <Input
                  value={expenseForm.reference_number}
                  onChange={(e) => setExpenseForm({...expenseForm, reference_number: e.target.value})}
                  placeholder="Bill number"
                />
              </div>
              <div className="space-y-2">
                <Label>Vendor Name</Label>
                <Input
                  value={expenseForm.vendor_name}
                  onChange={(e) => setExpenseForm({...expenseForm, vendor_name: e.target.value})}
                  placeholder="Who did you pay?"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddExpense}
              disabled={submitting || (selectedWallet && expenseForm.amount && parseFloat(expenseForm.amount) > selectedWallet.balance)}
              data-testid="confirm-add-expense-btn"
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the expense "{deleteTarget?.description || deleteTarget?.expense_type_name}" for {formatCurrency(deleteTarget?.amount || 0)} and refund the wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700" data-testid="confirm-delete-expense-btn">
              <Trash2 className="w-4 h-4 mr-2" /> Delete & Refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail Drawer */}
      <ExpenseDetailDrawer
        open={showDetailDrawer}
        onClose={() => setShowDetailDrawer(false)}
        expense={selectedExpense}
        api={api}
      />
    </div>
  );
}
