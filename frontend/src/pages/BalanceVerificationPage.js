import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { 
  Scale, Wallet, CheckCircle2, AlertTriangle, Clock, 
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Loader2, History, RefreshCw, CreditCard, Banknote, Building2
} from 'lucide-react';
import { formatCurrency, formatDate, formatDateShort } from '@/lib/formatters';

const ADJUSTMENT_TYPES = [
  { value: 'shortage', label: 'Shortage', color: 'text-red-600' },
  { value: 'excess', label: 'Excess', color: 'text-emerald-600' },
  { value: 'gateway_fee', label: 'Gateway Fee', color: 'text-amber-600' },
  { value: 'bank_charges', label: 'Bank Charges', color: 'text-amber-600' },
  { value: 'error_correction', label: 'Error Correction', color: 'text-blue-600' },
  { value: 'other', label: 'Other', color: 'text-gray-600' },
];

const WalletIcon = ({ type }) => {
  switch (type) {
    case 'gateway':
      return <CreditCard className="w-4 h-4" />;
    case 'cash':
      return <Banknote className="w-4 h-4" />;
    case 'bank':
      return <Building2 className="w-4 h-4" />;
    default:
      return <Wallet className="w-4 h-4" />;
  }
};

const WalletTypeBadge = ({ type }) => {
  const colors = {
    gateway: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    cash: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    bank: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  
  return (
    <Badge variant="outline" className={colors[type] || ''}>
      <WalletIcon type={type} />
      <span className="ml-1 capitalize">{type}</span>
    </Badge>
  );
};

export default function BalanceVerificationPage() {
  const { api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [walletsData, setWalletsData] = useState([]);
  const [verifications, setVerifications] = useState([]);
  const [summary, setSummary] = useState(null);
  
  // Dialog state
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [actualBalance, setActualBalance] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('other');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [walletsRes, verificationsRes, summaryRes] = await Promise.all([
        api.get('/balance-verifications/wallets-status'),
        api.get('/balance-verifications?limit=20'),
        api.get('/balance-verifications/summary')
      ]);
      
      // walletsRes.data is an array of wallets
      setWalletsData(Array.isArray(walletsRes.data) ? walletsRes.data : []);
      // verificationsRes.data might be paginated or an array
      setVerifications(verificationsRes.data?.data || verificationsRes.data || []);
      setSummary(summaryRes.data);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const openVerifyDialog = (wallet) => {
    setSelectedWallet(wallet);
    setActualBalance(wallet.system_balance.toString());
    setAdjustmentType('other');
    setReferenceNumber('');
    setNotes('');
    setVerifyDialogOpen(true);
  };

  const handleVerify = async () => {
    if (!actualBalance || isNaN(parseFloat(actualBalance))) {
      toast.error('Please enter a valid balance');
      return;
    }
    
    setSubmitting(true);
    try {
      await api.post('/balance-verifications', {
        wallet_id: selectedWallet.id,
        actual_balance: parseFloat(actualBalance),
        adjustment_type: adjustmentType,
        reference_number: referenceNumber,
        notes: notes
      });
      
      const difference = parseFloat(actualBalance) - selectedWallet.system_balance;
      if (Math.abs(difference) > 0.01) {
        toast.success(`Verified! Adjustment of ${formatCurrency(Math.abs(difference))} applied.`);
      } else {
        toast.success('Verified! Balance matches.');
      }
      
      setVerifyDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to verify balance');
    } finally {
      setSubmitting(false);
    }
  };

  const calculatedDifference = selectedWallet 
    ? parseFloat(actualBalance || 0) - selectedWallet.system_balance 
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="balance-verification-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Balance Verification</h1>
          <p className="text-muted-foreground mt-1">Verify physical wallet balances against system records</p>
        </div>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total System Balance</p>
                <p className="text-2xl font-bold">{formatCurrency(summary?.total_system_balance || walletsData.reduce((sum, w) => sum + (w.balance || 0), 0))}</p>
              </div>
              <div className="p-2 rounded-lg bg-primary/10">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Shortages (30d)</p>
                <p className="text-2xl font-bold text-red-600">-{formatCurrency(summary?.total_shortages || 0)}</p>
              </div>
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <TrendingDown className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Excess (30d)</p>
                <p className="text-2xl font-bold text-emerald-600">+{formatCurrency(summary?.total_excess || 0)}</p>
              </div>
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Never Verified</p>
                <p className="text-2xl font-bold text-amber-600">{summary?.wallets_never_verified || walletsData.filter(w => !w.last_verified_at).length}</p>
              </div>
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Wallets Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="w-4 h-4" />
            Wallets to Verify
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {walletsData.map((wallet) => (
              <Card key={wallet.id} className="border" data-testid={`wallet-card-${wallet.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium">{wallet.name}</h3>
                      <WalletTypeBadge type={wallet.wallet_type} />
                    </div>
                    {wallet.last_verified_at ? (
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                        <Clock className="w-3 h-3 mr-1" />
                        Never
                      </Badge>
                    )}
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">System Balance</span>
                      <span className="font-bold">{formatCurrency(wallet.system_balance)}</span>
                    </div>
                    
                    {wallet.last_actual_balance !== null && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Last Actual</span>
                          <span className="font-medium">{formatCurrency(wallet.last_actual_balance)}</span>
                        </div>
                        {wallet.last_difference !== 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Last Difference</span>
                            <span className={`font-medium ${wallet.last_difference > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {wallet.last_difference > 0 ? '+' : ''}{formatCurrency(wallet.last_difference)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    
                    {wallet.last_verified_at && (
                      <div className="text-xs text-muted-foreground pt-2 border-t">
                        Last verified {formatDateShort(wallet.last_verified_at)} by {wallet.last_verified_by}
                      </div>
                    )}
                  </div>
                  
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => openVerifyDialog(wallet)}
                    data-testid={`verify-btn-${wallet.id}`}
                  >
                    <Scale className="w-4 h-4 mr-2" />
                    Verify Now
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Verifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" />
            Recent Verifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">System Balance</TableHead>
                <TableHead className="text-right">Actual Balance</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Adjustment</TableHead>
                <TableHead>Verified By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verifications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No verifications yet. Start by verifying your first wallet.
                  </TableCell>
                </TableRow>
              ) : (
                verifications.map((v) => (
                  <TableRow key={v.id} data-testid={`verification-row-${v.id}`}>
                    <TableCell className="whitespace-nowrap">{formatDateShort(v.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <WalletIcon type={v.wallet_type} />
                        {v.wallet_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-xs">
                        {v.wallet_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(v.system_balance)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(v.actual_balance)}</TableCell>
                    <TableCell className="text-right">
                      {v.difference === 0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span className={`font-medium ${v.difference > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {v.difference > 0 ? '+' : ''}{formatCurrency(v.difference)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.adjustment_applied ? (
                        <Badge className={
                          v.adjustment_type === 'shortage' ? 'bg-red-100 text-red-700' :
                          v.adjustment_type === 'excess' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-amber-100 text-amber-700'
                        }>
                          {v.adjustment_type.replace('_', ' ')}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No adjustment</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{v.verified_by_name}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Verify Dialog */}
      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5" />
              Verify Balance
            </DialogTitle>
            <DialogDescription>
              Enter the actual physical balance for <strong>{selectedWallet?.name}</strong>
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* System Balance Display */}
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current System Balance</span>
                <span className="font-bold text-lg">{formatCurrency(selectedWallet?.system_balance || 0)}</span>
              </div>
            </div>
            
            {/* Actual Balance Input */}
            <div className="space-y-2">
              <Label htmlFor="actual_balance">Actual Balance (₹)</Label>
              <Input
                id="actual_balance"
                type="number"
                step="0.01"
                value={actualBalance}
                onChange={(e) => setActualBalance(e.target.value)}
                placeholder="Enter actual balance"
                className="text-lg"
                data-testid="actual-balance-input"
              />
            </div>
            
            {/* Difference Preview */}
            {actualBalance && !isNaN(parseFloat(actualBalance)) && (
              <div className={`p-3 rounded-lg ${
                calculatedDifference === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                calculatedDifference > 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                'bg-red-50 dark:bg-red-900/20'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Difference</span>
                  <span className={`font-bold text-lg flex items-center gap-1 ${
                    calculatedDifference === 0 ? 'text-emerald-600' :
                    calculatedDifference > 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {calculatedDifference === 0 ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Matches!
                      </>
                    ) : (
                      <>
                        {calculatedDifference > 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        {calculatedDifference > 0 ? '+' : ''}{formatCurrency(calculatedDifference)}
                      </>
                    )}
                  </span>
                </div>
                {calculatedDifference !== 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {calculatedDifference > 0 ? 'Excess found - will be credited' : 'Shortage found - will be debited'}
                  </p>
                )}
              </div>
            )}
            
            {/* Adjustment Type */}
            {calculatedDifference !== 0 && (
              <div className="space-y-2">
                <Label>Adjustment Type</Label>
                <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                  <SelectTrigger data-testid="adjustment-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* Reference Number */}
            <div className="space-y-2">
              <Label htmlFor="reference">Reference Number (Optional)</Label>
              <Input
                id="reference"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Bank statement ref, Gateway txn ID, etc."
              />
            </div>
            
            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional details..."
                rows={2}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleVerify} disabled={submitting} data-testid="confirm-verify-btn">
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              {calculatedDifference !== 0 ? 'Verify & Adjust' : 'Verify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
