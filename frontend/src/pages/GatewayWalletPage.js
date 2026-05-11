import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Minus, ArrowDownToLine, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, formatDate , getApiError } from '@/lib/formatters';



export default function GatewayWalletPage() {
  const { id } = useParams();
  const { api } = useAuth();
  const navigate = useNavigate();
  const [gateway, setGateway] = useState(null);
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [operationType, setOperationType] = useState('credit');
  const [formData, setFormData] = useState({
    amount: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const response = await api.get(`/gateways/${id}/wallet`);
      setGateway(response.data.gateway);
      setOperations(response.data.operations);
    } catch (error) {
      toast.error('Failed to load wallet data');
      navigate('/gateways');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      await api.post(`/gateways/${id}/wallet`, {
        operation_type: operationType,
        amount: parseFloat(formData.amount),
        notes: formData.notes,
      });
      toast.success(`${operationType.charAt(0).toUpperCase() + operationType.slice(1)} successful`);
      setShowDialog(false);
      setFormData({ amount: '', notes: '' });
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Operation failed'));
    }
  };

  const openDialog = (type) => {
    setOperationType(type);
    setFormData({ amount: '', notes: '' });
    setShowDialog(true);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton rounded" />
        <div className="h-64 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="gateway-wallet-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/gateways')} data-testid="back-btn">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="page-title">{gateway?.name} Wallet</h1>
          <p className="text-muted-foreground mt-1">Manage wallet balance and view transactions</p>
        </div>
      </div>

      {/* Balance Card */}
      <Card className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-300 text-sm">Current Balance</p>
              <p className="text-4xl font-bold mt-1">{formatCurrency(gateway?.wallet_balance || 0)}</p>
            </div>
            <Wallet className="w-12 h-12 text-slate-400" />
          </div>
          <div className="flex gap-3 mt-6">
            <Button onClick={() => openDialog('credit')} className="bg-emerald-600 hover:bg-emerald-700" data-testid="credit-btn">
              <Plus className="w-4 h-4 mr-2" />
              Credit
            </Button>
            <Button onClick={() => openDialog('debit')} variant="secondary" data-testid="debit-btn">
              <Minus className="w-4 h-4 mr-2" />
              Debit
            </Button>
            <Button onClick={() => openDialog('withdraw')} variant="outline" className="text-white border-white hover:bg-white/10" data-testid="withdraw-btn">
              <ArrowDownToLine className="w-4 h-4 mr-2" />
              Withdraw
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Operations History */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>All wallet operations for this gateway</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {operations.length === 0 ? (
            <div className="empty-state py-12">
              <Wallet className="empty-state-icon" />
              <p className="empty-state-title">No transactions yet</p>
              <p className="empty-state-description">Wallet operations will appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((op) => (
                  <TableRow key={op.id} data-testid={`op-row-${op.id}`}>
                    <TableCell>{formatDate(op.created_at)}</TableCell>
                    <TableCell>
                      <Badge className={
                        op.operation_type === 'credit' ? 'bg-emerald-100 text-emerald-700' :
                        op.operation_type === 'debit' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }>
                        {op.operation_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {op.reference_type === 'transaction' ? 'Transaction' : 'Manual'}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">{op.notes || '-'}</TableCell>
                    <TableCell className={`text-right font-medium ${
                      op.operation_type === 'credit' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {op.operation_type === 'credit' ? '+' : '-'}{formatCurrency(op.amount)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(op.balance_after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operation Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {operationType === 'credit' ? 'Credit Wallet' :
               operationType === 'debit' ? 'Debit Wallet' : 'Withdraw to Bank'}
            </DialogTitle>
            <DialogDescription>
              {operationType === 'credit' ? 'Add funds to the wallet' :
               operationType === 'debit' ? 'Deduct funds from the wallet' :
               'Withdraw funds to your bank account'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Current Balance</p>
                <p className="text-xl font-bold">{formatCurrency(gateway?.wallet_balance || 0)}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (₹) *</Label>
                <Input
                  id="amount"
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="Enter amount"
                  required
                  data-testid="operation-amount-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes"
                  data-testid="operation-notes-input"
                />
              </div>

              {formData.amount && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">New Balance</p>
                  <p className={`text-xl font-bold ${
                    operationType === 'credit' ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(
                      operationType === 'credit'
                        ? (gateway?.wallet_balance || 0) + parseFloat(formData.amount || 0)
                        : (gateway?.wallet_balance || 0) - parseFloat(formData.amount || 0)
                    )}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                className={operationType === 'credit' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                data-testid="confirm-operation-btn"
              >
                Confirm {operationType.charAt(0).toUpperCase() + operationType.slice(1)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
