import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { ArrowLeft, ArrowLeftRight, Wallet, Landmark, Banknote, Building2, Clock, Download, CalendarIcon, X } from 'lucide-react';
import { formatCurrency, formatDateTime , getApiError } from '@/lib/formatters';
import { WalletOperationDetailDrawer } from '@/components/DetailDrawers';

export default function WalletOperationsPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const { walletId } = useParams();

  const [wallet, setWallet] = useState(null);
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allWallets, setAllWallets] = useState([]);
  const [bankPaymentTypes, setBankPaymentTypes] = useState([]);
  const [users, setUsers] = useState([]);

  // Pagination
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [datePreset, setDatePreset] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState(null);
  const [customDateTo, setCustomDateTo] = useState(null);
  const [operationTypeFilter, setOperationTypeFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  // Operation dialog
  const [showDialog, setShowDialog] = useState(false);
  const [operationType, setOperationType] = useState('credit');
  
  // Detail drawer
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState(null);
  const [operationForm, setOperationForm] = useState({
    amount: '',
    payment_type: '',
    to_wallet_id: '',
    notes: '',
  });

  // Date preset helper
  const applyDatePreset = useCallback((preset) => {
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
    
    setDateFrom(from);
    setDateTo(to);
    setCustomDateFrom(null);
    setCustomDateTo(null);
  }, []);

  useEffect(() => {
    fetchAllWallets();
    fetchPaymentTypes();
    fetchUsers();
  }, [walletId]);

  useEffect(() => {
    if (walletId) {
      fetchWalletData(1);
    }
  }, [pageSize, dateFrom, dateTo, operationTypeFilter, userFilter]);

  const fetchWalletData = async (page = 1) => {
    try {
      const skip = (page - 1) * pageSize;
      let url = `/wallets/${walletId}/operations?limit=${pageSize}&skip=${skip}`;
      if (dateFrom) url += `&date_from=${dateFrom}`;
      if (dateTo) url += `&date_to=${dateTo}`;
      if (operationTypeFilter !== 'all') url += `&operation_type=${operationTypeFilter}`;
      if (userFilter) url += `&created_by=${userFilter}`;
      
      const response = await api.get(url);
      setWallet(response.data.wallet);
      setOperations(response.data.operations);
      const total = response.data.total || response.data.operations.length;
      const pages = Math.ceil(total / pageSize);
      setPagination({ page, total, pages });
    } catch (error) {
      toast.error('Failed to load wallet data');
      navigate('/wallets');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      fetchWalletData(newPage);
    }
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(parseInt(newSize));
  };

  const fetchAllWallets = async () => {
    try {
      const response = await api.get('/wallets');
      setAllWallets(response.data.filter(w => w.id !== walletId));
    } catch (error) {
      toast.error('Failed to load wallets');
    }
  };

  const fetchPaymentTypes = async () => {
    try {
      const response = await api.get('/bank-payment-types');
      setBankPaymentTypes(response.data);
    } catch (error) {
      toast.error('Failed to load payment types');
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      // Handle both {data: [...]} and direct array responses
      const usersData = response.data?.data || response.data || [];
      setUsers(Array.isArray(usersData) ? usersData : []);
    } catch (error) {
      // Non-critical, silently fail
    }
  };

  const handleExportExcel = async () => {
    try {
      setExporting(true);
      let url = `/wallets/${walletId}/operations/export?`;
      const params = [];
      if (dateFrom) params.push(`date_from=${dateFrom}`);
      if (dateTo) params.push(`date_to=${dateTo}`);
      if (operationTypeFilter !== 'all') params.push(`operation_type=${operationTypeFilter}`);
      if (userFilter) params.push(`created_by=${userFilter}`);
      url += params.join('&');
      
      const response = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const walletName = wallet?.name?.replace(/\s+/g, '_') || 'wallet';
      link.download = `wallet_ops_${walletName}_${dateFrom || 'all'}_${dateTo || 'all'}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Excel exported successfully');
    } catch (error) {
      toast.error('Failed to export Excel');
    } finally {
      setExporting(false);
    }
  };

  const clearAllFilters = () => {
    setDatePreset(null);
    setDateFrom('');
    setDateTo('');
    setCustomDateFrom(null);
    setCustomDateTo(null);
    setOperationTypeFilter('all');
    setUserFilter('');
  };

  const hasActiveFilters = datePreset || dateFrom || dateTo || operationTypeFilter !== 'all' || userFilter;

  const openOperationDialog = (type) => {
    setOperationType(type);
    setOperationForm({ amount: '', payment_type: '', to_wallet_id: '', notes: '' });
    setShowDialog(true);
  };

  const handleOperation = async (e) => {
    e.preventDefault();

    if (!operationForm.amount || parseFloat(operationForm.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      if (operationType === 'transfer') {
        if (!operationForm.to_wallet_id) {
          toast.error('Please select destination wallet');
          return;
        }

        await api.post('/wallets/transfer', {
          from_wallet_id: walletId,
          to_wallet_id: operationForm.to_wallet_id,
          amount: parseFloat(operationForm.amount),
          payment_type: operationForm.payment_type || undefined,
          notes: operationForm.notes,
        });
        toast.success('Transfer successful');
      } else {
        // For bank wallet credits, payment type is required
        if (wallet?.wallet_type === 'bank' && operationType === 'credit' && !operationForm.payment_type) {
          toast.error('Please select payment type');
          return;
        }

        await api.post(`/wallets/${walletId}/operations`, {
          operation_type: operationType,
          amount: parseFloat(operationForm.amount),
          payment_type: operationForm.payment_type || undefined,
          notes: operationForm.notes,
        });
        toast.success(`${operationType === 'credit' ? 'Credit' : 'Debit'} successful`);
      }

      setShowDialog(false);
      fetchWalletData(pagination.page);
    } catch (error) {
      toast.error(getApiError(error, 'Operation failed'));
    }
  };

  const getWalletIcon = (type) => {
    switch (type) {
      case 'gateway': return <Landmark className="w-5 h-5" />;
      case 'cash': return <Banknote className="w-5 h-5" />;
      case 'bank': return <Building2 className="w-5 h-5" />;
      default: return <Wallet className="w-5 h-5" />;
    }
  };

  const getOperationBadge = (type) => {
    switch (type) {
      case 'credit':
      case 'transfer_in':
        return <Badge className="bg-emerald-100 text-emerald-700">Credit</Badge>;
      case 'debit':
      case 'transfer_out':
        return <Badge className="bg-red-100 text-red-700">Debit</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton rounded" />
        <div className="h-32 skeleton rounded" />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 skeleton rounded" />)}
        </div>
      </div>
    );
  }

  if (!wallet) {
    return <div>Wallet not found</div>;
  }

  const canTransfer = true;

  return (
    <div className="space-y-6" data-testid="wallet-operations-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/wallets')} data-testid="back-btn">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {getWalletIcon(wallet.wallet_type)}
            <h1 className="page-title">{wallet.name}</h1>
            <Badge variant="outline" className="capitalize">{wallet.wallet_type}</Badge>
          </div>
          <p className="text-muted-foreground mt-1">{wallet.description || 'Wallet operations and history'}</p>
        </div>
      </div>

      {/* Balance Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{formatCurrency(wallet.balance || 0)}</p>
            {wallet.bank_name && (
              <p className="text-sm text-muted-foreground mt-2">
                {wallet.bank_name} {wallet.account_number && `• A/C: ${wallet.account_number}`}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {canTransfer && (
              <Button variant="outline" className="w-full justify-start" onClick={() => openOperationDialog('transfer')}>
                <ArrowLeftRight className="w-4 h-4 mr-2 text-blue-600" />
                Transfer
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Operations History */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Transaction History
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              disabled={exporting || operations.length === 0}
              data-testid="export-excel-btn"
            >
              <Download className="w-4 h-4 mr-2" />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center" data-testid="operations-filters">
            <div className="flex gap-3">
            <Select value={operationTypeFilter} onValueChange={setOperationTypeFilter}>
              <SelectTrigger className="w-full sm:w-[140px]" data-testid="type-filter-trigger">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="debit">Debit</SelectItem>
              </SelectContent>
            </Select>
            <SearchableSelect
              value={userFilter}
              onValueChange={setUserFilter}
              placeholder="Search users..."
              allOption="All Users"
              items={users.map(u => ({ value: u.id, label: u.name }))}
              className="w-full sm:w-[170px]"
              triggerTestId="user-filter-trigger"
            />
            </div>
            {/* Custom Date Range */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="custom-date-btn">
                  <CalendarIcon className="w-4 h-4" />
                  {customDateFrom ? (
                    <span className="text-xs">
                      {customDateFrom.toLocaleDateString()} - {customDateTo ? customDateTo.toLocaleDateString() : '...'}
                    </span>
                  ) : (
                    'Custom Date'
                  )}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                data-testid="clear-filters-btn"
              >
                <X className="w-3 h-3 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>

          {/* Date Presets */}
          <div className="flex flex-wrap gap-2" data-testid="date-presets">
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
                    setDatePreset(null);
                    setDateFrom('');
                    setDateTo('');
                  } else {
                    setDatePreset(key);
                    applyDatePreset(key);
                  }
                }}
                data-testid={`date-preset-${key}`}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Table or Empty */}
          {operations.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="font-medium">{hasActiveFilters ? 'No operations match filters' : 'No transactions yet'}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {hasActiveFilters ? 'Try adjusting your filters' : 'Operations will appear here'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Op ID</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Linked To</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((op) => (
                  <TableRow 
                    key={op.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      setSelectedOperation(op);
                      setShowDetailDrawer(true);
                    }}
                  >
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {op.operation_id || '-'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{formatDateTime(op.created_at)}</p>
                      {op.created_by_name && (
                        <p className="text-xs text-muted-foreground">by {op.created_by_name}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {getOperationBadge(op.operation_type)}
                      {op.payment_type && (
                        <Badge variant="outline" className="ml-2">{op.payment_type}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {op.transaction_id && (
                          <Badge variant="secondary" className="font-mono text-xs">
                            {op.transaction_id}
                          </Badge>
                        )}
                        {op.customer_id && (
                          <div className="text-xs text-muted-foreground">
                            Customer: {op.customer_id}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[200px]">
                        {op.transfer_wallet_name && (
                          <p className="text-sm">
                            {op.operation_type === 'transfer_out' ? 'To: ' : 'From: '}
                            <span className="font-medium">{op.transfer_wallet_name}</span>
                          </p>
                        )}
                        {op.notes && <p className="text-sm text-muted-foreground truncate">{op.notes}</p>}
                        {op.reference_type && op.reference_type !== 'manual' && op.reference_type !== 'transfer' && (
                          <Badge variant="secondary" className="text-xs">{op.reference_type}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-semibold ${op.operation_type === 'credit' || op.operation_type === 'transfer_in' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {op.operation_type === 'credit' || op.operation_type === 'transfer_in' ? '+' : '-'}
                        {formatCurrency(op.amount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(op.balance_after)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOperation(op);
                          setShowDetailDrawer(true);
                        }}
                        data-testid={`view-operation-${op.id}`}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
          
          {/* Pagination */}
          {operations.length > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 px-4 pb-4">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pageSize) + 1} to {Math.min(pagination.page * pageSize, pagination.total)} of {pagination.total}
                </p>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[100px] h-10 sm:h-8" data-testid="operations-page-size">
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
                    className="h-10 sm:h-8"
                    size="sm"
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    data-testid="operations-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    data-testid="operations-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operation Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {operationType === 'credit' && 'Credit Wallet'}
              {operationType === 'debit' && 'Debit Wallet'}
              {operationType === 'transfer' && 'Transfer to Another Wallet'}
            </DialogTitle>
            <DialogDescription>
              {operationType === 'credit' && 'Add money to this wallet'}
              {operationType === 'debit' && 'Withdraw money from this wallet'}
              {operationType === 'transfer' && 'Transfer money to another wallet'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleOperation}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Amount (₹) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={operationForm.amount}
                  onChange={(e) => setOperationForm({ ...operationForm, amount: e.target.value })}
                  placeholder="Enter amount"
                  required
                  data-testid="operation-amount-input"
                />
              </div>

              {operationType === 'transfer' && (
                <div className="space-y-2">
                  <Label>Destination Wallet *</Label>
                  <SearchableSelect
                    value={operationForm.to_wallet_id}
                    onValueChange={(v) => setOperationForm({ ...operationForm, to_wallet_id: v })}
                    placeholder="Search wallet..."
                    items={allWallets.map(w => ({ value: w.id, label: `${w.name} (${w.wallet_type}) - ${formatCurrency(w.balance || 0)}` }))}
                    triggerTestId="destination-wallet-select"
                  />
                </div>
              )}

              {/* Payment type for bank wallet credits or transfers to bank */}
              {((wallet.wallet_type === 'bank' && operationType === 'credit') ||
                (operationType === 'transfer' && allWallets.find(w => w.id === operationForm.to_wallet_id)?.wallet_type === 'bank')) && (
                <div className="space-y-2">
                  <Label>Payment Type {wallet.wallet_type === 'bank' && operationType === 'credit' ? '*' : ''}</Label>
                  <Select
                    value={operationForm.payment_type}
                    onValueChange={(v) => setOperationForm({ ...operationForm, payment_type: v })}
                  >
                    <SelectTrigger data-testid="payment-type-select">
                      <SelectValue placeholder="Select payment type" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankPaymentTypes.map((pt) => (
                        <SelectItem key={pt.id} value={pt.name}>{pt.name}</SelectItem>
                      ))}
                      {operationType === 'transfer' && (
                        <SelectItem value="Transfer">Transfer</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={operationForm.notes}
                  onChange={(e) => setOperationForm({ ...operationForm, notes: e.target.value })}
                  placeholder="Optional notes"
                  rows={2}
                  data-testid="operation-notes-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button 
                type="submit" 
                className={operationType === 'credit' ? 'bg-emerald-600 hover:bg-emerald-700' : operationType === 'debit' ? 'bg-red-600 hover:bg-red-700' : ''}
                data-testid="confirm-operation-btn"
              >
                {operationType === 'credit' && 'Credit'}
                {operationType === 'debit' && 'Debit'}
                {operationType === 'transfer' && 'Transfer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Wallet Operation Detail Drawer */}
      <WalletOperationDetailDrawer
        open={showDetailDrawer}
        onClose={() => setShowDetailDrawer(false)}
        operation={selectedOperation}
        api={api}
      />
    </div>
  );
}
