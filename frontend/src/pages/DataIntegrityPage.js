import React, { useEffect, useState, useCallback } from 'react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { 
  ShieldCheck, AlertTriangle, AlertCircle, RefreshCw, 
  Loader2, CheckCircle2, XCircle, Clock, Camera,
  Wallet, Hash, ListOrdered, Scale, History, Plus,
  ChevronDown, ChevronRight, Eye, ExternalLink
} from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/formatters';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// Status badge component
const StatusBadge = ({ status }) => {
  const configs = {
    healthy: { variant: 'default', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: CheckCircle2, label: 'Healthy' },
    warning: { variant: 'default', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: AlertTriangle, label: 'Warning' },
    critical: { variant: 'default', className: 'bg-red-500/10 text-red-600 border-red-500/20', icon: AlertCircle, label: 'Critical' },
    unknown: { variant: 'secondary', className: '', icon: Clock, label: 'Unknown' }
  };
  
  const config = configs[status] || configs.unknown;
  const Icon = config.icon;
  
  return (
    <Badge variant={config.variant} className={config.className}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
};

// Overall status indicator
const OverallStatus = ({ status, timestamp }) => {
  const configs = {
    healthy: { bg: 'bg-emerald-500', icon: ShieldCheck, text: 'All Systems Healthy', desc: 'No data integrity issues detected' },
    warning: { bg: 'bg-amber-500', icon: AlertTriangle, text: 'Warnings Detected', desc: 'Some checks require attention' },
    critical: { bg: 'bg-red-500', icon: AlertCircle, text: 'Critical Issues', desc: 'Immediate attention required' },
    unknown: { bg: 'bg-gray-500', icon: Clock, text: 'Status Unknown', desc: 'Run a check to get status' }
  };
  
  const config = configs[status] || configs.unknown;
  const Icon = config.icon;
  
  return (
    <div className={`${config.bg} text-white rounded-xl p-6 flex items-center gap-4`}>
      <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
        <Icon className="w-8 h-8" />
      </div>
      <div className="flex-1">
        <h2 className="text-2xl font-bold">{config.text}</h2>
        <p className="text-white/80">{config.desc}</p>
        {timestamp && (
          <p className="text-white/60 text-sm mt-1">Last checked: {formatDate(timestamp)}</p>
        )}
      </div>
    </div>
  );
};

// Check card component
const CheckCard = ({ title, icon: Icon, status, onViewDetails, hasIssues, children }) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {hasIssues && onViewDetails && (
              <Button variant="ghost" size="sm" onClick={onViewDetails} className="h-7 px-2">
                <Eye className="w-3.5 h-3.5 mr-1" />
                Details
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

// Detailed Issues Dialog
const IssuesDialog = ({ open, onClose, title, icon: Icon, status, data, type }) => {
  const getContent = () => {
    switch (type) {
      case 'checksums':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-2xl font-bold">{data?.total_checked || 0}</p>
                <p className="text-sm text-muted-foreground">Total Checked</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-600">{(data?.total_checked || 0) - (data?.tampered_count || 0)}</p>
                <p className="text-sm text-muted-foreground">Valid</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600">{data?.tampered_count || 0}</p>
                <p className="text-sm text-muted-foreground">Tampered</p>
              </div>
            </div>
            
            {data?.tampered_transactions?.length > 0 && (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  Tampered Transactions
                </h4>
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction ID</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.tampered_transactions.map((txn, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{txn.transaction_id}</TableCell>
                          <TableCell>{txn.amount ? formatCurrency(txn.amount) : '-'}</TableCell>
                          <TableCell>
                            <Badge variant="destructive">Checksum Mismatch</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  ⚠️ These transactions may have been modified after creation. Investigate immediately.
                </p>
              </div>
            )}
          </div>
        );
        
      case 'sequences':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-2xl font-bold">{data?.wallets_checked || 0}</p>
                <p className="text-sm text-muted-foreground">Wallets Checked</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-600">{data?.wallets_with_gaps || 0}</p>
                <p className="text-sm text-muted-foreground">With Gaps</p>
              </div>
            </div>
            
            {data?.issues?.length > 0 && (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Sequence Gaps Detected
                </h4>
                <div className="space-y-2">
                  {data.issues.map((issue, i) => (
                    <Collapsible key={i}>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg cursor-pointer hover:bg-amber-100">
                          <div className="flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-amber-600" />
                            <span className="font-medium">{issue.wallet_name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-amber-100 text-amber-700">
                              {issue.total_gaps} gaps
                            </Badge>
                            <ChevronDown className="w-4 h-4" />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                          <p className="text-sm text-muted-foreground mb-2">Missing sequence numbers:</p>
                          <div className="flex flex-wrap gap-1">
                            {issue.gaps?.slice(0, 20).map((gap, j) => (
                              <Badge key={j} variant="secondary" className="font-mono">
                                #{gap}
                              </Badge>
                            ))}
                            {issue.gaps?.length > 20 && (
                              <Badge variant="secondary">+{issue.gaps.length - 20} more</Badge>
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  ⚠️ Sequence gaps may indicate missing or deleted operations.
                </p>
              </div>
            )}
          </div>
        );
        
      case 'balance':
        return (
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Last Snapshot</p>
                  <p className="font-medium">{data?.snapshot_date || 'None'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Discrepancies</p>
                  <p className={`text-xl font-bold ${data?.discrepancies_count > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {data?.discrepancies_count || 0}
                  </p>
                </div>
              </div>
            </div>
            
            {data?.discrepancies?.length > 0 && (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Balance Discrepancies
                </h4>
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead className="text-right">Snapshot Balance</TableHead>
                        <TableHead className="text-right">Expected Balance</TableHead>
                        <TableHead className="text-right">Current Balance</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.discrepancies.map((disc, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{disc.wallet_name}</TableCell>
                          <TableCell className="text-right">{formatCurrency(disc.snapshot_balance)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(disc.expected_balance)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(disc.current_balance)}</TableCell>
                          <TableCell className={`text-right font-medium ${disc.difference > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {disc.difference > 0 ? '+' : ''}{formatCurrency(disc.difference)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  ⚠️ Balance discrepancies may indicate untracked transactions or calculation errors.
                </p>
              </div>
            )}
          </div>
        );
        
      case 'negative':
        return (
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg text-center">
              <p className={`text-3xl font-bold ${data?.count > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {data?.count || 0}
              </p>
              <p className="text-sm text-muted-foreground">Wallets with Negative Balance</p>
            </div>
            
            {data?.wallets?.length > 0 ? (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  Affected Wallets
                </h4>
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet Name</TableHead>
                        <TableHead className="text-right">Current Balance</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.wallets.map((wallet, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{wallet.name}</TableCell>
                          <TableCell className="text-right text-red-600 font-medium">
                            {formatCurrency(wallet.balance)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive">Negative Balance</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  ⚠️ Negative balances should not occur. This indicates a system error or unauthorized modification.
                </p>
              </div>
            ) : (
              <div className="text-center py-6">
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-2" />
                <p className="font-medium text-emerald-600">All wallets have positive balances</p>
                <p className="text-sm text-muted-foreground">Balance protection is working correctly</p>
              </div>
            )}
          </div>
        );
        
      default:
        return null;
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {Icon && <Icon className="w-5 h-5" />}
            {title}
            <StatusBadge status={status} />
          </DialogTitle>
          <DialogDescription>
            Detailed view of integrity check results
          </DialogDescription>
        </DialogHeader>
        {getContent()}
      </DialogContent>
    </Dialog>
  );
};

export default function DataIntegrityPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [verifyingChecksums, setVerifyingChecksums] = useState(false);
  const [addingChecksums, setAddingChecksums] = useState(false);
  
  // Dialog states for detailed views
  const [dialogOpen, setDialogOpen] = useState(null); // 'checksums', 'sequences', 'balance', 'negative'

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/data-integrity/status`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {

    }
  }, [token]);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/data-integrity/snapshots?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data);
      }
    } catch (error) {

    }
  }, [token]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchSnapshots()]);
    setLoading(false);
  }, [fetchStatus, fetchSnapshots]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateSnapshot = async () => {
    setCreatingSnapshot(true);
    try {
      const res = await fetch(`${API_URL}/api/data-integrity/create-snapshot`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Snapshot created: ${data.wallets?.length || 0} wallets captured`);
        await loadData();
      } else {
        toast.error('Failed to create snapshot');
      }
    } catch (error) {
      toast.error('Error creating snapshot');
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleVerifyChecksums = async () => {
    setVerifyingChecksums(true);
    try {
      const res = await fetch(`${API_URL}/api/data-integrity/verify-all-checksums`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tampered > 0) {
          toast.error(`⚠️ ${data.tampered} tampered transactions detected!`);
        } else {
          toast.success(`✓ All ${data.valid} transactions verified`);
        }
        await fetchStatus();
      } else {
        toast.error('Failed to verify checksums');
      }
    } catch (error) {
      toast.error('Error verifying checksums');
    } finally {
      setVerifyingChecksums(false);
    }
  };

  const handleAddMissingChecksums = async () => {
    setAddingChecksums(true);
    try {
      const res = await fetch(`${API_URL}/api/data-integrity/add-missing-checksums`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Added checksums to ${data.updated} transactions`);
        await fetchStatus();
      } else {
        toast.error('Failed to add checksums');
      }
    } catch (error) {
      toast.error('Error adding checksums');
    } finally {
      setAddingChecksums(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const checksums = status?.checks?.transaction_checksums || {};
  const sequences = status?.checks?.operation_sequences || {};
  const balanceSnapshot = status?.checks?.balance_snapshot || {};
  const negativeBalances = status?.checks?.negative_balances || {};

  return (
    <div className="space-y-6" data-testid="data-integrity-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Data Integrity</h1>
          <p className="text-muted-foreground">Monitor and verify financial data integrity</p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Overall Status */}
      <OverallStatus status={status?.overall_status} timestamp={status?.timestamp} />

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Perform integrity checks and create snapshots</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={handleCreateSnapshot} 
              disabled={creatingSnapshot}
              data-testid="create-snapshot-btn"
            >
              {creatingSnapshot ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Camera className="w-4 h-4 mr-2" />
              )}
              Create Snapshot
            </Button>
            <Button 
              onClick={handleVerifyChecksums} 
              disabled={verifyingChecksums}
              variant="outline"
              data-testid="verify-checksums-btn"
            >
              {verifyingChecksums ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Hash className="w-4 h-4 mr-2" />
              )}
              Verify Checksums
            </Button>
            <Button 
              onClick={handleAddMissingChecksums} 
              disabled={addingChecksums}
              variant="outline"
              data-testid="add-checksums-btn"
            >
              {addingChecksums ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add Missing Checksums
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Integrity Checks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Transaction Checksums */}
        <CheckCard 
          title="Transaction Checksums" 
          icon={Hash} 
          status={checksums.status}
          hasIssues={checksums.tampered_count > 0 || checksums.total_checked > 0}
          onViewDetails={() => setDialogOpen('checksums')}
        >
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Transactions Checked</span>
              <span className="font-medium">{checksums.total_checked || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tampered</span>
              <span className={`font-medium ${checksums.tampered_count > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {checksums.tampered_count || 0}
              </span>
            </div>
            {checksums.tampered_count > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-red-600" onClick={() => setDialogOpen('checksums')}>
                View {checksums.tampered_count} tampered transactions →
              </Button>
            )}
          </div>
        </CheckCard>

        {/* Operation Sequences */}
        <CheckCard 
          title="Operation Sequences" 
          icon={ListOrdered} 
          status={sequences.status}
          hasIssues={sequences.wallets_with_gaps > 0 || sequences.wallets_checked > 0}
          onViewDetails={() => setDialogOpen('sequences')}
        >
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Wallets Checked</span>
              <span className="font-medium">{sequences.wallets_checked || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Wallets with Gaps</span>
              <span className={`font-medium ${sequences.wallets_with_gaps > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {sequences.wallets_with_gaps || 0}
              </span>
            </div>
            {sequences.wallets_with_gaps > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-amber-600" onClick={() => setDialogOpen('sequences')}>
                View {sequences.wallets_with_gaps} wallets with gaps →
              </Button>
            )}
          </div>
        </CheckCard>

        {/* Balance Snapshot */}
        <CheckCard 
          title="Balance Verification" 
          icon={Scale} 
          status={balanceSnapshot.status}
          hasIssues={balanceSnapshot.discrepancies_count > 0 || balanceSnapshot.snapshot_date}
          onViewDetails={() => setDialogOpen('balance')}
        >
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Last Snapshot</span>
              <span className="font-medium">
                {balanceSnapshot.snapshot_date ? formatDate(balanceSnapshot.snapshot_date) : 'None'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Discrepancies</span>
              <span className={`font-medium ${balanceSnapshot.discrepancies_count > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {balanceSnapshot.discrepancies_count || 0}
              </span>
            </div>
            {balanceSnapshot.discrepancies_count > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-amber-600" onClick={() => setDialogOpen('balance')}>
                View {balanceSnapshot.discrepancies_count} discrepancies →
              </Button>
            )}
          </div>
        </CheckCard>

        {/* Negative Balances */}
        <CheckCard 
          title="Negative Balances" 
          icon={Wallet} 
          status={negativeBalances.status}
          hasIssues={negativeBalances.count > 0}
          onViewDetails={() => setDialogOpen('negative')}
        >
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Wallets with Negative Balance</span>
              <span className={`font-medium ${negativeBalances.count > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {negativeBalances.count || 0}
              </span>
            </div>
            {negativeBalances.count > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-red-600" onClick={() => setDialogOpen('negative')}>
                View {negativeBalances.count} affected wallets →
              </Button>
            )}
            {negativeBalances.count === 0 && (
              <p className="text-sm text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                All wallet balances are positive
              </p>
            )}
          </div>
        </CheckCard>
      </div>

      {/* Snapshots History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Snapshot History</CardTitle>
            </div>
            <Badge variant="secondary">{snapshots.length} snapshots</Badge>
          </div>
          <CardDescription>Balance snapshots for audit trail and recovery</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshots.length > 0 ? (
            <div className="rounded-md border">
              <div className="overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Triggered By</TableHead>
                    <TableHead>Wallets</TableHead>
                    <TableHead className="text-right">Total Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((snapshot) => (
                    <TableRow key={snapshot.id}>
                      <TableCell className="font-medium">{snapshot.date}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(snapshot.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{snapshot.triggered_by}</Badge>
                      </TableCell>
                      <TableCell>{snapshot.wallets?.length || 0}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(snapshot.total_balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No snapshots yet</p>
              <p className="text-sm">Create your first snapshot to start tracking balances</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-primary mt-0.5" />
            <div className="text-sm">
              <p className="font-medium mb-1">About Data Integrity Checks</p>
              <ul className="text-muted-foreground space-y-1">
                <li>• <strong>Checksums</strong>: SHA-256 hash of critical transaction fields to detect tampering</li>
                <li>• <strong>Sequences</strong>: Tracks operation order per wallet to detect missing operations</li>
                <li>• <strong>Snapshots</strong>: Daily balance captures for audit trail (auto at midnight)</li>
                <li>• <strong>Balance Protection</strong>: Prevents wallets from going negative</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Detail Dialogs */}
      <IssuesDialog
        open={dialogOpen === 'checksums'}
        onClose={() => setDialogOpen(null)}
        title="Transaction Checksums"
        icon={Hash}
        status={checksums.status}
        data={checksums}
        type="checksums"
      />
      <IssuesDialog
        open={dialogOpen === 'sequences'}
        onClose={() => setDialogOpen(null)}
        title="Operation Sequences"
        icon={ListOrdered}
        status={sequences.status}
        data={sequences}
        type="sequences"
      />
      <IssuesDialog
        open={dialogOpen === 'balance'}
        onClose={() => setDialogOpen(null)}
        title="Balance Verification"
        icon={Scale}
        status={balanceSnapshot.status}
        data={balanceSnapshot}
        type="balance"
      />
      <IssuesDialog
        open={dialogOpen === 'negative'}
        onClose={() => setDialogOpen(null)}
        title="Negative Balances"
        icon={Wallet}
        status={negativeBalances.status}
        data={negativeBalances}
        type="negative"
      />
    </div>
  );
}
