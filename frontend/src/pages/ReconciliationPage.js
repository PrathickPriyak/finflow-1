import React, { useEffect, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  ShieldCheck, AlertTriangle, AlertCircle, RefreshCw, 
  Loader2, CheckCircle2, XCircle, Clock, Activity,
  Wallet, ArrowLeftRight, TrendingUp, History, Eye,
  FileText, ExternalLink
} from 'lucide-react';
import { formatDate, formatDateShort, formatCurrency } from '@/lib/formatters';

// Status indicator component
const StatusIndicator = ({ status, size = 'lg' }) => {
  const sizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8'
  };
  
  const colors = {
    healthy: 'text-emerald-500',
    warning: 'text-amber-500',
    critical: 'text-red-500',
    unknown: 'text-gray-400'
  };
  
  const Icon = status === 'healthy' ? CheckCircle2 : 
               status === 'warning' ? AlertTriangle :
               status === 'critical' ? AlertCircle : Clock;
  
  return <Icon className={`${sizes[size]} ${colors[status]}`} />;
};

// Progress ring component
const ProgressRing = ({ value, max, color = '#10b981', size = 120, label, sublabel }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted/30"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
        {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  );
};

// Timeline item component
const TimelineItem = ({ report, isLast }) => {
  const hasIssues = (report.wallets_with_issues || 0) + (report.transactions_with_issues || 0) > 0;
  const status = hasIssues ? 'warning' : 'healthy';
  
  return (
    <div className="flex gap-4">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${
          status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'
        }`} />
        {!isLast && <div className="w-0.5 h-full bg-border flex-1 mt-1" />}
      </div>
      
      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">
              {report.report_type === 'scheduled' ? 'Scheduled Check' : 'Manual Check'}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(report.completed_at || report.created_at)}
            </p>
          </div>
          <Badge variant={hasIssues ? 'destructive' : 'default'} className={
            hasIssues ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
          }>
            {hasIssues ? `${report.wallets_with_issues + report.transactions_with_issues} issues` : 'All clear'}
          </Badge>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Wallet className="w-3 h-3" />
            {report.wallets_checked} wallets
          </span>
          <span className="flex items-center gap-1">
            <ArrowLeftRight className="w-3 h-3" />
            {report.transactions_checked} transactions
          </span>
          {report.triggered_by_name && (
            <span>by {report.triggered_by_name}</span>
          )}
        </div>
      </div>
    </div>
  );
};

// Report Detail Dialog
const ReportDetailDialog = ({ open, onClose, report }) => {
  if (!report) return null;
  
  const totalIssues = (report.wallets_with_issues || 0) + (report.transactions_with_issues || 0);
  const hasWalletIssues = report.wallet_discrepancies?.length > 0;
  const hasTransactionIssues = report.transaction_discrepancies?.length > 0;
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Reconciliation Report
            <Badge variant={totalIssues > 0 ? 'destructive' : 'default'} className={
              totalIssues > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }>
              {totalIssues > 0 ? `${totalIssues} Issues` : 'Healthy'}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {report.report_type === 'manual' ? 'Manual check' : 'Scheduled check'} • {formatDate(report.completed_at || report.created_at)}
          </DialogDescription>
        </DialogHeader>
        
        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-muted/50 rounded-lg">
          <div className="text-center">
            <p className="text-2xl font-bold">{report.wallets_checked || 0}</p>
            <p className="text-xs text-muted-foreground">Wallets Checked</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${report.wallets_with_issues > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {report.wallets_with_issues || 0}
            </p>
            <p className="text-xs text-muted-foreground">Wallet Issues</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{report.transactions_checked || 0}</p>
            <p className="text-xs text-muted-foreground">Txns Checked</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${report.transactions_with_issues > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {report.transactions_with_issues || 0}
            </p>
            <p className="text-xs text-muted-foreground">Txn Issues</p>
          </div>
        </div>
        
        {/* Report Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Report ID:</span>
            <span className="ml-2 font-mono text-xs">{report.id?.slice(0, 8)}...</span>
          </div>
          <div>
            <span className="text-muted-foreground">Triggered By:</span>
            <span className="ml-2">{report.triggered_by_name || 'System'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Status:</span>
            <span className="ml-2 capitalize">{report.status}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Message:</span>
            <span className="ml-2 text-muted-foreground">{report.message || '-'}</span>
          </div>
        </div>
        
        {/* Discrepancies */}
        {(hasWalletIssues || hasTransactionIssues) ? (
          <Tabs defaultValue="wallets" className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="wallets" className="flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                Wallet Issues ({report.wallet_discrepancies?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="transactions" className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4" />
                Transaction Issues ({report.transaction_discrepancies?.length || 0})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="wallets" className="mt-4">
              {hasWalletIssues ? (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead className="text-right">Current Balance</TableHead>
                        <TableHead className="text-right">Expected Balance</TableHead>
                        <TableHead className="text-right">Discrepancy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.wallet_discrepancies.map((d, i) => (
                        <TableRow key={d.wallet_name || i}>
                          <TableCell className="font-medium">{d.wallet_name}</TableCell>
                          <TableCell>
                            <Badge variant={d.severity === 'high' ? 'destructive' : 'secondary'} className={
                              d.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }>
                              {d.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(d.current_balance)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(d.expected_balance)}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-medium ${
                            d.discrepancy > 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}>
                            {d.discrepancy > 0 ? '+' : ''}{formatCurrency(d.discrepancy)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-500" />
                  <p className="text-emerald-600 font-medium">No wallet discrepancies</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="transactions" className="mt-4">
              {hasTransactionIssues ? (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction ID</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead className="text-right">Recorded</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.transaction_discrepancies.map((d, i) => (
                        <TableRow key={d.transaction_id || i}>
                          <TableCell className="font-mono">{d.transaction_id}</TableCell>
                          <TableCell>{d.customer_name || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={d.severity === 'high' ? 'destructive' : 'secondary'} className={
                              d.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }>
                              {d.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(d.recorded_paid)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(d.actual_payments_sum)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-500" />
                  <p className="text-emerald-600 font-medium">No transaction discrepancies</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="text-center py-8 mt-4 bg-emerald-50 rounded-lg">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-3 text-emerald-500" />
            <p className="text-lg font-medium text-emerald-700">All Clear!</p>
            <p className="text-sm text-emerald-600">No discrepancies found in this reconciliation check</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default function ReconciliationPage() {
  const { api } = useAuth();
  const [status, setStatus] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [latestReport, setLatestReport] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null); // For detail dialog

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusRes, reportsRes] = await Promise.all([
        api.get('/reconciliation/status'),
        api.get('/reconciliation/reports?limit=20')
      ]);
      
      setStatus(statusRes.data);
      setReports(reportsRes.data);
      
      if (reportsRes.data.length > 0) {
        setLatestReport(reportsRes.data[0]);
      }
    } catch (error) {
      toast.error('Failed to load reconciliation data');
    } finally {
      setLoading(false);
    }
  };

  const runReconciliation = async () => {
    setRunning(true);
    try {
      const response = await api.post('/reconciliation/run');
      toast.success('Reconciliation completed');
      setLatestReport(response.data);
      fetchData();
    } catch (error) {
      toast.error('Reconciliation failed');
    } finally {
      setRunning(false);
    }
  };

  // Calculate stats from reports
  const totalChecks = reports.length;
  const issuesFound = reports.filter(r => 
    (r.wallets_with_issues || 0) + (r.transactions_with_issues || 0) > 0
  ).length;
  const healthyChecks = totalChecks - issuesFound;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="reconciliation-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Data Reconciliation</h1>
          <p className="text-muted-foreground mt-1">Monitor and verify data consistency</p>
        </div>
        <Button onClick={runReconciliation} disabled={running} data-testid="run-check-btn">
          {running ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Run Check Now
        </Button>
      </div>

      {/* Current Status - Hero Card */}
      <Card data-testid="status-card" className={`border-2 ${
        status?.status === 'healthy' ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900' :
        status?.status === 'warning' ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900' :
        status?.status === 'critical' ? 'border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900' :
        'border-border'
      }`}>
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div data-testid="status-icon" className={`p-4 rounded-2xl ${
                status?.status === 'healthy' ? 'bg-emerald-100 dark:bg-emerald-900/50' :
                status?.status === 'warning' ? 'bg-amber-100 dark:bg-amber-900/50' :
                status?.status === 'critical' ? 'bg-red-100 dark:bg-red-900/50' :
                'bg-muted'
              }`}>
                {status?.status === 'healthy' ? (
                  <ShieldCheck className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
                ) : status?.status === 'warning' ? (
                  <AlertTriangle className="w-12 h-12 text-amber-600 dark:text-amber-400" />
                ) : status?.status === 'critical' ? (
                  <AlertCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
                ) : (
                  <Clock className="w-12 h-12 text-muted-foreground" />
                )}
              </div>
              <div>
                <h2 data-testid="status-title" className={`text-3xl font-bold ${
                  status?.status === 'healthy' ? 'text-emerald-700 dark:text-emerald-400' :
                  status?.status === 'warning' ? 'text-amber-700 dark:text-amber-400' :
                  status?.status === 'critical' ? 'text-red-700 dark:text-red-400' :
                  'text-foreground'
                }`}>
                  {status?.status === 'healthy' ? 'All Systems Healthy' :
                   status?.status === 'warning' ? 'Issues Detected' :
                   status?.status === 'critical' ? 'Critical Issues' :
                   'Status Unknown'}
                </h2>
                <p className="text-muted-foreground mt-1">{status?.message}</p>
                {status?.last_check && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Last verified: {formatDate(status.last_check)}
                  </p>
                )}
              </div>
            </div>
            
            {/* Quick Stats */}
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-4xl font-bold text-foreground">{totalChecks}</p>
                <p className="text-sm text-muted-foreground">Total Checks</p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold text-emerald-600">{healthyChecks}</p>
                <p className="text-sm text-muted-foreground">Passed</p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold text-amber-600">{issuesFound}</p>
                <p className="text-sm text-muted-foreground">With Issues</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Health Score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Health Score
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-4">
            <ProgressRing
              value={totalChecks > 0 ? Math.round((healthyChecks / totalChecks) * 100) : 0}
              max={100}
              color={healthyChecks === totalChecks ? '#10b981' : '#f59e0b'}
              size={140}
              label="%"
              sublabel="healthy"
            />
          </CardContent>
        </Card>

        {/* Latest Check Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Latest Check Results
            </CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            {latestReport ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Wallets Checked</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{latestReport.wallets_checked}</span>
                    {latestReport.wallets_with_issues > 0 ? (
                      <Badge variant="destructive" className="text-xs">{latestReport.wallets_with_issues} issues</Badge>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Transactions Checked</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{latestReport.transactions_checked}</span>
                    {latestReport.transactions_with_issues > 0 ? (
                      <Badge variant="destructive" className="text-xs">{latestReport.transactions_with_issues} issues</Badge>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2" />
                <p>No checks yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Auto-Check Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Automatic Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Auto-check</span>
                <Badge variant={status?.auto_reconciliation_enabled ? 'default' : 'secondary'}>
                  {status?.auto_reconciliation_enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Check Interval</span>
                <span className="font-medium">Every {status?.reconciliation_interval_hours || 6} hours</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Total Reports</span>
                <span className="font-medium">{reports.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Timeline & Discrepancies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="w-8 h-8 mx-auto mb-2" />
                <p>No reconciliation activity yet</p>
                <p className="text-sm mt-1">Run your first check to see activity here</p>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto pr-2">
                {reports.slice(0, 10).map((report, index) => (
                  <TimelineItem 
                    key={report.id} 
                    report={report} 
                    isLast={index === Math.min(reports.length - 1, 9)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Discrepancies Found */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Recent Discrepancies
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestReport && (latestReport.wallet_discrepancies?.length > 0 || latestReport.transaction_discrepancies?.length > 0) ? (
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {/* Wallet Discrepancies */}
                {latestReport.wallet_discrepancies?.slice(0, 3).map((d, i) => (
                  <div key={`wallet-${i}`} className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet className="w-4 h-4 text-amber-600" />
                      <span className="font-medium text-sm">{d.wallet_name}</span>
                      <Badge variant="outline" className={
                        d.severity === 'high' ? 'border-red-300 text-red-600' : 'border-amber-300 text-amber-600'
                      }>
                        {d.severity}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Current:</span>
                        <span className="ml-1 font-medium">₹{d.current_balance?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Expected:</span>
                        <span className="ml-1 font-medium">₹{d.expected_balance?.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-xs mt-1 text-amber-700 dark:text-amber-400">
                      Discrepancy: ₹{Math.abs(d.discrepancy)?.toLocaleString()}
                    </div>
                  </div>
                ))}
                
                {/* Transaction Discrepancies */}
                {latestReport.transaction_discrepancies?.slice(0, 3).map((d, i) => (
                  <div key={`txn-${i}`} className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
                    <div className="flex items-center gap-2 mb-2">
                      <ArrowLeftRight className="w-4 h-4 text-amber-600" />
                      <span className="font-medium text-sm">{d.transaction_id}</span>
                      <Badge variant="outline" className={
                        d.severity === 'high' ? 'border-red-300 text-red-600' : 'border-amber-300 text-amber-600'
                      }>
                        {d.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{d.customer_name}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Recorded:</span>
                        <span className="ml-1 font-medium">₹{d.recorded_paid?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Actual:</span>
                        <span className="ml-1 font-medium">₹{d.actual_payments_sum?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* View All Button */}
                {((latestReport.wallet_discrepancies?.length || 0) + (latestReport.transaction_discrepancies?.length || 0)) > 3 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => setSelectedReport(latestReport)}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View All {(latestReport.wallet_discrepancies?.length || 0) + (latestReport.transaction_discrepancies?.length || 0)} Discrepancies
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                <p className="font-medium text-emerald-700 dark:text-emerald-400">No Discrepancies Found</p>
                <p className="text-sm text-muted-foreground mt-1">All wallet balances and transactions are consistent</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* All Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Reconciliation Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Wallets</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead>Issues</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Triggered By</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No reconciliation reports yet
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((report) => {
                  const totalIssues = (report.wallets_with_issues || 0) + (report.transactions_with_issues || 0);
                  return (
                    <TableRow key={report.id} data-testid={`report-row-${report.id}`}>
                      <TableCell>{formatDateShort(report.completed_at || report.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {report.report_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          {report.wallets_checked}
                          {report.wallets_with_issues > 0 && (
                            <XCircle className="w-3 h-3 text-amber-500" />
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          {report.transactions_checked}
                          {report.transactions_with_issues > 0 && (
                            <XCircle className="w-3 h-3 text-amber-500" />
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        {totalIssues > 0 ? (
                          <Badge variant="destructive" className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                            {totalIssues}
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">0</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusIndicator status={totalIssues > 0 ? 'warning' : 'healthy'} size="sm" />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {report.triggered_by_name || 'System'}
                      </TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 px-2"
                          onClick={() => setSelectedReport(report)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
      
      {/* Report Detail Dialog */}
      <ReportDetailDialog 
        open={!!selectedReport} 
        onClose={() => setSelectedReport(null)} 
        report={selectedReport}
      />
    </div>
  );
}
