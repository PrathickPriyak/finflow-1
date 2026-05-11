import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Plus, Wallet, Landmark, Banknote, Building2, Edit, Trash2, ArrowRight, Settings, CreditCard } from 'lucide-react';
import { formatCurrency , getApiError } from '@/lib/formatters';
import { EmptyState } from '@/components/ui/empty-state';

export default function WalletsPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('gateway');
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bankPaymentTypes, setBankPaymentTypes] = useState([]);

  // Wallet dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingWallet, setEditingWallet] = useState(null);
  const [walletForm, setWalletForm] = useState({
    name: '',
    wallet_type: 'cash',
    description: '',
    balance: '',
    bank_name: '',
    account_number: '',
  });

  // Payment type dialog
  const [showPaymentTypeDialog, setShowPaymentTypeDialog] = useState(false);
  const [newPaymentType, setNewPaymentType] = useState('');

  // Delete confirmation dialog (UX-02)
  const [walletToDelete, setWalletToDelete] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchWallets();
    fetchPaymentTypes();
  }, []);

  const fetchWallets = async () => {
    try {
      const response = await api.get('/wallets');
      setWallets(response.data);
    } catch (error) {
      toast.error('Failed to load wallets');
    } finally {
      setLoading(false);
    }
  };

  const fetchPaymentTypes = async () => {
    try {
      const response = await api.get('/bank-payment-types');
      setBankPaymentTypes(response.data);
    } catch (error) {

    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = {
        name: walletForm.name,
        wallet_type: walletForm.wallet_type,
        description: walletForm.description,
      };
      
      // AUDIT-R3-05: Only include balance for new wallets, not edits
      if (!editingWallet) {
        data.balance = parseFloat(walletForm.balance) || 0;
      }

      if (walletForm.wallet_type === 'bank') {
        data.bank_name = walletForm.bank_name;
        data.account_number = walletForm.account_number;
      }

      if (editingWallet) {
        await api.put(`/wallets/${editingWallet.id}`, data);
        toast.success('Wallet updated successfully');
      } else {
        await api.post('/wallets', data);
        toast.success('Wallet created successfully');
      }

      setShowDialog(false);
      setEditingWallet(null);
      resetForm();
      fetchWallets();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save wallet'));
    }
  };

  const handleEdit = (wallet) => {
    setEditingWallet(wallet);
    setWalletForm({
      name: wallet.name,
      wallet_type: wallet.wallet_type,
      description: wallet.description || '',
      balance: wallet.balance?.toString() || '0',
      bank_name: wallet.bank_name || '',
      account_number: wallet.account_number || '',
    });
    setShowDialog(true);
  };

  const handleDelete = async (wallet) => {
    setWalletToDelete(wallet);
    setShowDeleteDialog(true);
  };
  
  const confirmDelete = async () => {
    if (!walletToDelete) return;
    
    setDeleting(true);
    try {
      await api.delete(`/wallets/${walletToDelete.id}`);
      toast.success('Wallet deleted successfully');
      setShowDeleteDialog(false);
      setWalletToDelete(null);
      fetchWallets();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete wallet'));
    } finally {
      setDeleting(false);
    }
  };

  const resetForm = () => {
    setWalletForm({
      name: '',
      wallet_type: activeTab === 'gateway' ? 'cash' : activeTab,
      description: '',
      balance: '',
      bank_name: '',
      account_number: '',
    });
  };

  const openAddDialog = () => {
    setEditingWallet(null);
    resetForm();
    setWalletForm(prev => ({ ...prev, wallet_type: activeTab === 'gateway' ? 'cash' : activeTab }));
    setShowDialog(true);
  };

  const handleAddPaymentType = async (e) => {
    e.preventDefault();
    if (!newPaymentType.trim()) return;
    try {
      await api.post('/bank-payment-types', { name: newPaymentType.trim() });
      toast.success('Payment type added');
      setNewPaymentType('');
      setShowPaymentTypeDialog(false);
      fetchPaymentTypes();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to add payment type'));
    }
  };

  const handleDeletePaymentType = async (typeId) => {
    if (!window.confirm('Delete this payment type?')) return;
    try {
      await api.delete(`/bank-payment-types/${typeId}`);
      toast.success('Payment type deleted');
      fetchPaymentTypes();
    } catch (error) {
      toast.error('Failed to delete payment type');
    }
  };

  const gatewayWallets = wallets.filter(w => w.wallet_type === 'gateway');
  const cashWallets = wallets.filter(w => w.wallet_type === 'cash');
  const bankWallets = wallets.filter(w => w.wallet_type === 'bank');

  const totalBalance = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
  const pgBalance = gatewayWallets.reduce((sum, w) => sum + (w.balance || 0), 0);
  const bankBalance = bankWallets.reduce((sum, w) => sum + (w.balance || 0), 0);
  const cashBalance = cashWallets.reduce((sum, w) => sum + (w.balance || 0), 0);

  const getWalletIcon = (type) => {
    switch (type) {
      case 'gateway': return <Landmark className="w-4 h-4" />;
      case 'cash': return <Banknote className="w-4 h-4" />;
      case 'bank': return <Building2 className="w-4 h-4" />;
      default: return <Wallet className="w-4 h-4" />;
    }
  };

  const renderWalletTable = (walletList, type) => {
    if (loading) {
      return (
        <div className="p-8 space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 skeleton rounded" />)}
        </div>
      );
    }

    if (walletList.length === 0) {
      return (
        <EmptyState
          icon="wallets"
          title={`No ${type} wallets`}
          description={type === 'gateway' 
            ? 'Gateway wallets are automatically created when you add payment gateways in PG & Servers.'
            : `Create a ${type} wallet to track your ${type} transactions.`
          }
          action={type !== 'gateway'}
          actionLabel={`Add ${type.charAt(0).toUpperCase() + type.slice(1)} Wallet`}
          onAction={openAddDialog}
        />
      );
    }

    return (
      <div className="overflow-x-auto">
      <Table className="min-w-[700px]">
        <TableHeader>
          <TableRow>
            <TableHead>Wallet Name</TableHead>
            {type === 'bank' && <TableHead>Bank Details</TableHead>}
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {walletList.map((wallet) => (
            <TableRow key={wallet.id} data-testid={`wallet-row-${wallet.id}`}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${wallet.balance > 100000 ? 'bg-emerald-500' : wallet.balance > 10000 ? 'bg-amber-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="font-medium">{wallet.name}</p>
                    {wallet.gateway_name && <p className="text-xs text-muted-foreground">Linked to: {wallet.gateway_name}</p>}
                  </div>
                </div>
              </TableCell>
              {type === 'bank' && (
                <TableCell>
                  <div className="text-sm">
                    {wallet.bank_name && <p>{wallet.bank_name}</p>}
                    {wallet.account_number && <p className="text-muted-foreground">A/C: {wallet.account_number}</p>}
                  </div>
                </TableCell>
              )}
              <TableCell className="text-muted-foreground max-w-[200px] truncate">{wallet.description || '-'}</TableCell>
              <TableCell className="text-right">
                <p className="font-semibold text-lg">{formatCurrency(wallet.balance || 0)}</p>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={() => navigate(`/wallets/${wallet.id}/operations`)}
                    data-testid={`operations-${wallet.id}`}
                  >
                    Operations
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                  {type !== 'gateway' && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(wallet)} title="Edit">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(wallet)} title="Delete">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6" data-testid="wallets-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Wallets</h1>
          <p className="text-muted-foreground mt-1">Manage all your wallets - Gateway, Cash, and Bank</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab !== 'gateway' && (
            <Button onClick={openAddDialog} data-testid="add-wallet-btn">
              <Plus className="w-4 h-4 mr-2" />
              Add {activeTab === 'cash' ? 'Cash' : 'Bank'} Wallet
            </Button>
          )}
        </div>
      </div>

      {/* Balance Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4" data-testid="total-balance-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-100">
              <Wallet className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Balance</p>
              <p className="text-xl font-bold">{formatCurrency(totalBalance)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4" data-testid="pg-balance-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100">
              <Landmark className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">PG Balance</p>
              <p className="text-xl font-bold text-purple-600">{formatCurrency(pgBalance)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4" data-testid="bank-balance-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Bank Balance</p>
              <p className="text-xl font-bold text-blue-600">{formatCurrency(bankBalance)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4" data-testid="cash-balance-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100">
              <Banknote className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cash Balance</p>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(cashBalance)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="gateway" className="flex items-center gap-2" data-testid="gateway-tab">
            <Landmark className="w-4 h-4" />
            Gateway ({gatewayWallets.length})
          </TabsTrigger>
          <TabsTrigger value="cash" className="flex items-center gap-2" data-testid="cash-tab">
            <Banknote className="w-4 h-4" />
            Cash ({cashWallets.length})
          </TabsTrigger>
          <TabsTrigger value="bank" className="flex items-center gap-2" data-testid="bank-tab">
            <Building2 className="w-4 h-4" />
            Bank ({bankWallets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gateway" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {renderWalletTable(gatewayWallets, 'gateway')}
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground mt-2">
            * Gateway wallets are automatically created and synced with Payment Gateways
          </p>
        </TabsContent>

        <TabsContent value="cash" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {renderWalletTable(cashWallets, 'cash')}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank" className="mt-6">
          <div className="flex justify-end mb-4">
            <Button variant="outline" size="sm" onClick={() => setShowPaymentTypeDialog(true)}>
              <Settings className="w-4 h-4 mr-2" />
              Manage Payment Types
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {renderWalletTable(bankWallets, 'bank')}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Wallet Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingWallet ? 'Edit Wallet' : `Add ${walletForm.wallet_type === 'cash' ? 'Cash' : 'Bank'} Wallet`}</DialogTitle>
            <DialogDescription>Enter wallet details</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Wallet Name *</Label>
                <Input
                  value={walletForm.name}
                  onChange={(e) => setWalletForm({ ...walletForm, name: e.target.value })}
                  placeholder={walletForm.wallet_type === 'cash' ? 'e.g., Main Cash, Petty Cash' : 'e.g., HDFC Savings, SBI Current'}
                  required
                  data-testid="wallet-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={walletForm.description}
                  onChange={(e) => setWalletForm({ ...walletForm, description: e.target.value })}
                  placeholder="Optional description"
                  data-testid="wallet-description-input"
                />
              </div>
              {!editingWallet && (
                <div className="space-y-2">
                  <Label>Opening Balance (₹)</Label>
                  <Input
                    type="number"
                    value={walletForm.balance}
                    onChange={(e) => setWalletForm({ ...walletForm, balance: e.target.value })}
                    placeholder="0"
                    data-testid="wallet-balance-input"
                  />
                </div>
              )}
              {walletForm.wallet_type === 'bank' && (
                <>
                  <div className="space-y-2">
                    <Label>Bank Name</Label>
                    <Input
                      value={walletForm.bank_name}
                      onChange={(e) => setWalletForm({ ...walletForm, bank_name: e.target.value })}
                      placeholder="e.g., HDFC Bank"
                      data-testid="wallet-bank-name-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input
                      value={walletForm.account_number}
                      onChange={(e) => setWalletForm({ ...walletForm, account_number: e.target.value })}
                      placeholder="e.g., XXXX1234"
                      data-testid="wallet-account-input"
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-wallet-btn">{editingWallet ? 'Update' : 'Add'} Wallet</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Payment Types Dialog */}
      <Dialog open={showPaymentTypeDialog} onOpenChange={setShowPaymentTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bank Payment Types</DialogTitle>
            <DialogDescription>Configure payment types for bank wallet credits</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2 mb-4">
              {bankPaymentTypes.map((pt) => (
                <div key={pt.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <span className="font-medium">{pt.name}</span>
                  <Button variant="ghost" size="icon" onClick={() => handleDeletePaymentType(pt.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddPaymentType} className="flex gap-2">
              <Input
                value={newPaymentType}
                onChange={(e) => setNewPaymentType(e.target.value)}
                placeholder="New payment type name"
                data-testid="new-payment-type-input"
              />
              <Button type="submit" data-testid="add-payment-type-btn">Add</Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Wallet Confirmation Dialog (UX-02) */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Wallet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{walletToDelete?.name}</strong>? 
              {walletToDelete?.balance > 0 && (
                <span className="block mt-2 text-amber-600">
                  Warning: This wallet has a balance of {formatCurrency(walletToDelete.balance)}.
                </span>
              )}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-wallet"
            >
              {deleting ? 'Deleting...' : 'Delete Wallet'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
