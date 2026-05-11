import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeftRight, Clock, Landmark, TrendingUp, 
  ArrowUpRight, ArrowDownRight, Plus,
  BarChart3, PieChart, Calendar, ShieldCheck, 
  AlertTriangle, AlertCircle, RefreshCw, Loader2,
  Activity
} from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '@/lib/formatters';

// Simple bar chart component
const SimpleBarChart = ({ data, valueKey, labelKey, color = "#10b981" }) => {
  if (!data || data.length === 0) return null;
  const maxValue = Math.max(...data.map(d => d[valueKey]));
  
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-16 truncate">{item[labelKey]}</span>
          <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ 
                width: `${maxValue > 0 ? (item[valueKey] / maxValue) * 100 : 0}%`,
                backgroundColor: color
              }}
            />
          </div>
          <span className="text-xs font-medium w-20 text-right">{formatCurrency(item[valueKey])}</span>
        </div>
      ))}
    </div>
  );
};

export default function DashboardPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [dailyProfit, setDailyProfit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7');
  const [reconciliationStatus, setReconciliationStatus] = useState(null);
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [healthScore, setHealthScore] = useState(null);
  const [commissionStats, setCommissionStats] = useState(null);
  const [failedSections, setFailedSections] = useState(new Set());

  // BUG-FIX: Use useCallback to prevent stale closures and add proper dependencies
  const fetchAnalytics = useCallback(async () => {
    try {
      const response = await api.get(`/dashboard/analytics?days=${period}`);
      setAnalytics(response.data);
    } catch (error) {
      console.error('Analytics fetch failed:', error);
      toast.error('Failed to load analytics data');
    }
  }, [api, period]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setFailedSections(new Set());
    try {
      const failed = new Set();
      const [dashRes, profitRes, reconcRes, healthRes, commRes] = await Promise.all([
        api.get('/dashboard'),
        api.get('/dashboard/daily-profit').catch(() => { failed.add('profit'); return null; }),
        api.get('/reconciliation/status').catch(() => { failed.add('reconciliation'); return null; }),
        api.get('/dashboard/health-score').catch(() => { failed.add('health'); return null; }),
        api.get('/dashboard/commission-stats').catch(() => { failed.add('commission'); return null; }),
      ]);
      setStats(dashRes.data);
      if (profitRes) setDailyProfit(profitRes.data);
      if (reconcRes) setReconciliationStatus(reconcRes.data);
      if (healthRes) setHealthScore(healthRes.data);
      if (commRes) setCommissionStats(commRes.data);
      if (failed.size > 0) setFailedSections(failed);
    } catch (error) {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [api]);

  // BUG-FIX: Added api to dependency array
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // BUG-FIX: Added fetchAnalytics to dependency array (now stable via useCallback)
  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const runReconciliation = async () => {
    setRunningReconciliation(true);
    try {
      await api.post('/reconciliation/run');
      toast.success('Reconciliation completed');
      // Refresh reconciliation status after running
      const r = await api.get('/reconciliation/status').catch(() => null);
      if (r) setReconciliationStatus(r.data);
    } catch (error) {
      toast.error('Reconciliation failed');
    } finally {
      setRunningReconciliation(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 skeleton rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dashboard">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your business</p>
        </div>
        <Button onClick={() => navigate('/transactions/new')} data-testid="new-transaction-btn">
          <Plus className="w-4 h-4 mr-2" />
          New Transaction
        </Button>
      </div>

      {/* Stats Grid - Distinct Insights Only */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {/* Net Profit Today - The Key Metric */}
        <Card className="stat-card bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-background border-emerald-200 dark:border-emerald-800" data-testid="stat-profit">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="stat-label text-xs sm:text-sm">Net Profit Today</p>
              <p className="stat-value currency text-emerald-600 text-lg sm:text-2xl truncate">{formatCurrency(stats?.today_profit || 0)}</p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex-shrink-0">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
        </Card>

        {/* Pending Outflow - Money You Owe */}
        <Card className="stat-card" data-testid="stat-pending-out">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="stat-label text-xs sm:text-sm">Pending Outflow</p>
              <p className="stat-value currency text-amber-600 text-lg sm:text-2xl truncate">{formatCurrency(stats?.total_pending || 0)}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">To pay customers</p>
            </div>
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex-shrink-0">
              <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
        </Card>

        {/* Pending Inflow - Money Owed To You */}
        <Card className="stat-card" data-testid="stat-pending-in">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="stat-label text-xs sm:text-sm">Pending Inflow</p>
              <p className="stat-value currency text-blue-600 text-lg sm:text-2xl truncate">{formatCurrency(stats?.total_receivable || 0)}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">To collect from customers</p>
            </div>
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex-shrink-0">
              <ArrowDownRight className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </Card>

        {/* Total Wallet Balance */}
        <Card className="stat-card" data-testid="stat-wallet">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="stat-label text-xs sm:text-sm">Wallet Balance</p>
              <p className="stat-value currency text-lg sm:text-2xl truncate">{formatCurrency(stats?.total_wallet_balance || 0)}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">All wallets combined</p>
            </div>
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex-shrink-0">
              <Landmark className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </Card>
      </div>

      {/* Data Consistency Status */}
      <Card data-testid="reconciliation-status">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                reconciliationStatus?.status === 'healthy' || reconciliationStatus?.status === 'ok' ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                reconciliationStatus?.status === 'warning' || reconciliationStatus?.status === 'issues_found' ? 'bg-amber-100 dark:bg-amber-900/30' :
                reconciliationStatus?.status === 'critical' || reconciliationStatus?.status === 'error' ? 'bg-red-100 dark:bg-red-900/30' :
                'bg-muted'
              }`}>
                {reconciliationStatus?.status === 'healthy' || reconciliationStatus?.status === 'ok' ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                ) : reconciliationStatus?.status === 'warning' || reconciliationStatus?.status === 'issues_found' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                ) : reconciliationStatus?.status === 'critical' || reconciliationStatus?.status === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                ) : (
                  <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                )}
              </div>
              <div>
                <p className="font-medium">Data Consistency</p>
                <p className={`text-sm ${
                  reconciliationStatus?.status === 'healthy' || reconciliationStatus?.status === 'ok' ? 'text-emerald-600' :
                  reconciliationStatus?.status === 'warning' || reconciliationStatus?.status === 'issues_found' ? 'text-amber-600' :
                  reconciliationStatus?.status === 'critical' || reconciliationStatus?.status === 'error' ? 'text-red-600' :
                  'text-muted-foreground'
                }`}>
                  {reconciliationStatus?.message || 
                   (reconciliationStatus?.status === 'issues_found' 
                     ? `${reconciliationStatus.discrepancies_count || 0} discrepancies found` 
                     : reconciliationStatus?.status === 'ok' || reconciliationStatus?.status === 'healthy'
                       ? 'All data is consistent'
                       : 'Checking...'
                   )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {reconciliationStatus?.timestamp && (
                <p className="text-xs text-muted-foreground">
                  Last check: {formatDate(reconciliationStatus.timestamp)}
                </p>
              )}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={runReconciliation}
                disabled={runningReconciliation}
                data-testid="run-reconciliation-btn"
              >
                {runningReconciliation ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Check Now
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Health Score */}
      {healthScore ? (
        <Card data-testid="health-score-widget">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* Score Ring */}
              <div className="relative flex-shrink-0">
                <svg width="140" height="140" viewBox="0 0 140 140" className="transform -rotate-90">
                  <circle cx="70" cy="70" r="58" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/30" />
                  <circle
                    cx="70" cy="70" r="58" fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(healthScore.total_score / 100) * 364.4} 364.4`}
                    className={
                      healthScore.total_score >= 80 ? 'text-emerald-500' :
                      healthScore.total_score >= 60 ? 'text-amber-500' :
                      'text-red-500'
                    }
                    stroke="currentColor"
                    style={{ transition: 'stroke-dasharray 1s ease-out' }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-bold ${
                    healthScore.total_score >= 80 ? 'text-emerald-600' :
                    healthScore.total_score >= 60 ? 'text-amber-600' :
                    'text-red-600'
                  }`}>{healthScore.total_score}</span>
                  <span className="text-xs text-muted-foreground font-medium">/ 100</span>
                </div>
              </div>

              {/* Score Breakdown */}
              <div className="flex-1 w-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Financial Health
                  </h3>
                  <Badge variant={
                    healthScore.total_score >= 80 ? 'default' :
                    healthScore.total_score >= 60 ? 'secondary' :
                    'destructive'
                  } className={
                    healthScore.total_score >= 80 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' :
                    healthScore.total_score >= 60 ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' :
                    ''
                  }>
                    Grade {healthScore.grade}
                  </Badge>
                </div>
                <div className="space-y-3">
                  {healthScore.components.map((c, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{c.name}</span>
                        <span className="font-medium tabular-nums">{c.score}/{c.max}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              c.score / c.max >= 0.8 ? 'bg-emerald-500' :
                              c.score / c.max >= 0.5 ? 'bg-amber-500' :
                              'bg-red-500'
                            }`}
                            style={{ width: `${(c.score / c.max) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-40 text-right truncate" title={c.detail}>{c.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : failedSections.has('health') && (
        <Card data-testid="health-score-widget">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            Unable to load Health Score
          </CardContent>
        </Card>
      )}

      {/* Daily Profit Summary */}
      {dailyProfit ? (
        <Card data-testid="daily-profit-summary">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              Today's Profit Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Transactions</p>
                <p className="text-xl font-bold">{dailyProfit.summary?.total_transactions || 0}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Volume</p>
                <p className="text-xl font-bold">{formatCurrency(dailyProfit.summary?.total_volume || 0)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <p className="text-xs text-emerald-600">Commission Earned</p>
                <p className="text-xl font-bold text-emerald-600">{formatCurrency(dailyProfit.summary?.total_commission_earned || 0)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
                <p className="text-xs text-red-600">PG Charges</p>
                <p className="text-xl font-bold text-red-600">-{formatCurrency(dailyProfit.summary?.total_pg_charges || 0)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-primary/10">
                <p className="text-xs text-primary">Net Profit</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(dailyProfit.summary?.net_profit || 0)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                <p className="text-xs text-amber-600">Paid Out</p>
                <p className="text-xl font-bold text-amber-600">{formatCurrency(dailyProfit.summary?.total_paid_to_customers || 0)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <p className="text-xs text-blue-600">Collected</p>
                <p className="text-xl font-bold text-blue-600">{formatCurrency(dailyProfit.summary?.total_collected || 0)}</p>
              </div>
            </div>
            
            {/* By Transaction Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-sm">Direct Swipe (Type 01)</h4>
                  <Badge variant="outline">{dailyProfit.by_transaction_type?.type_01?.count || 0} txns</Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volume</span>
                    <span className="font-medium">{formatCurrency(dailyProfit.by_transaction_type?.type_01?.volume || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Commission</span>
                    <span className="font-medium text-emerald-600">+{formatCurrency(dailyProfit.by_transaction_type?.type_01?.commission || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PG Charges</span>
                    <span className="font-medium text-red-600">-{formatCurrency(dailyProfit.by_transaction_type?.type_01?.pg_charges || 0)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="font-medium">Net</span>
                    <span className="font-bold text-primary">{formatCurrency(dailyProfit.by_transaction_type?.type_01?.net || 0)}</span>
                  </div>
                </div>
              </div>
              
              <div className="p-4 rounded-lg border">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-sm">Pay to Card + Swipe (Type 02)</h4>
                  <Badge variant="outline">{dailyProfit.by_transaction_type?.type_02?.count || 0} txns</Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volume</span>
                    <span className="font-medium">{formatCurrency(dailyProfit.by_transaction_type?.type_02?.volume || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Commission</span>
                    <span className="font-medium text-emerald-600">+{formatCurrency(dailyProfit.by_transaction_type?.type_02?.commission || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PG Charges</span>
                    <span className="font-medium text-red-600">-{formatCurrency(dailyProfit.by_transaction_type?.type_02?.pg_charges || 0)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="font-medium">Net</span>
                    <span className="font-bold text-primary">{formatCurrency(dailyProfit.by_transaction_type?.type_02?.net || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* By Gateway */}
            {dailyProfit.by_gateway && dailyProfit.by_gateway.length > 0 && (
              <div className="mt-4 p-4 rounded-lg border">
                <h4 className="font-medium text-sm mb-3">By Gateway</h4>
                <div className="space-y-2">
                  {dailyProfit.by_gateway.map((gw, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{gw.gateway}</span>
                        <Badge variant="outline" className="text-xs">{gw.count}</Badge>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">{formatCurrency(gw.volume)}</span>
                        <span className="font-medium text-primary w-24 text-right">{formatCurrency(gw.net)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : failedSections.has('profit') && (
        <Card data-testid="daily-profit-summary">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            Unable to load Daily Profit Summary
          </CardContent>
        </Card>
      )}

      {/* Commission Tracker */}
      {commissionStats ? (
        <Card data-testid="commission-tracker">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="w-5 h-5 text-violet-600" />
              Commission Tracker
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <p className="text-xs text-emerald-600 font-medium mb-1">Earned</p>
                <p className="text-xl font-bold text-emerald-700" data-testid="commission-earned">
                  {formatCurrency(commissionStats.commission_earned)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Type 01: {formatCurrency(commissionStats.commission_earned_type01 || 0)} | Type 02: {formatCurrency(commissionStats.commission_earned_type02 || 0)}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-600 font-medium mb-1">Collected</p>
                <p className="text-xl font-bold text-blue-700" data-testid="commission-collected">
                  {formatCurrency(commissionStats.commission_collected)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Include charges + service payments
                </p>
              </div>
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-600 font-medium mb-1">Outstanding</p>
                <p className="text-xl font-bold text-amber-700" data-testid="commission-outstanding">
                  {formatCurrency(commissionStats.commission_outstanding)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {commissionStats.commission_outstanding_count} pending collection{commissionStats.commission_outstanding_count !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 font-medium mb-1">Written Off</p>
                <p className="text-xl font-bold text-gray-600" data-testid="commission-written-off">
                  {formatCurrency(commissionStats.commission_written_off)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {commissionStats.commission_writeoff_count} write-off{commissionStats.commission_writeoff_count !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            {/* Collection Rate Bar */}
            {commissionStats.commission_earned > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Collection Rate</span>
                  <span className="text-sm font-medium">
                    {Math.round((commissionStats.commission_collected / commissionStats.commission_earned) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (commissionStats.commission_collected / commissionStats.commission_earned) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : failedSections.has('commission') && (
        <Card data-testid="commission-tracker">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            Unable to load Commission Stats
          </CardContent>
        </Card>
      )}

      {/* Analytics Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Analytics
            </CardTitle>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-32" data-testid="period-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {analytics ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Period Summary */}
              <div className="space-y-4">
                <h3 className="font-medium">Period Summary ({period} days)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">Total Transactions</p>
                    <p className="text-2xl font-bold">{analytics.summary?.total_transactions || 0}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">Total Volume</p>
                    <p className="text-2xl font-bold">{formatCurrency(analytics.summary?.total_volume || 0)}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                    <p className="text-sm text-muted-foreground">Total Profit</p>
                    <p className="text-2xl font-bold text-emerald-600">{formatCurrency(analytics.summary?.total_profit || 0)}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
                    <p className="text-sm text-muted-foreground">Gateway Charges</p>
                    <p className="text-2xl font-bold text-red-600">{formatCurrency(analytics.summary?.total_gateway_charges || 0)}</p>
                  </div>
                </div>
              </div>

              {/* Gateway Breakdown */}
              <div className="space-y-4">
                <h3 className="font-medium">Gateway-wise Volume</h3>
                {analytics.gateway_data?.length > 0 ? (
                  <SimpleBarChart 
                    data={analytics.gateway_data} 
                    valueKey="volume" 
                    labelKey="name" 
                    color="#3b82f6"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No gateway data available</p>
                )}
              </div>

              {/* Daily Trend */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="font-medium">Daily Profit Trend</h3>
                {analytics.daily_data?.length > 0 ? (
                  <SimpleBarChart 
                    data={analytics.daily_data.slice(-7)} 
                    valueKey="profit" 
                    labelKey="date" 
                    color="#10b981"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No daily data available</p>
                )}
              </div>

              {/* Transaction Type Breakdown */}
              <div className="lg:col-span-2">
                <h3 className="font-medium mb-4">Transaction Type Breakdown</h3>
                <div className="flex gap-4">
                  <div className="flex-1 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="type-badge type-01">Type 01</Badge>
                      <span className="text-sm">Direct Swipe</span>
                    </div>
                    <p className="text-xl font-bold">{formatCurrency(analytics.type_breakdown?.type_01 || 0)}</p>
                  </div>
                  <div className="flex-1 p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="type-badge type-02">Type 02</Badge>
                      <span className="text-sm">Pay + Swipe</span>
                    </div>
                    <p className="text-xl font-bold">{formatCurrency(analytics.type_breakdown?.type_02 || 0)}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              Loading analytics...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gateway Balances & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gateway Balances */}
        <Card className="lg:col-span-1" data-testid="gateway-balances">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Gateway Wallets</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/pg-and-servers')}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.gateway_balances?.length === 0 ? (
              <div className="empty-state py-8">
                <Landmark className="empty-state-icon" />
                <p className="empty-state-title">No gateways</p>
                <p className="empty-state-description">Add payment gateways to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats?.gateway_balances?.map((gateway) => (
                  <div
                    key={gateway.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                    onClick={() => navigate(`/gateways/${gateway.id}/wallet`)}
                    data-testid={`gateway-${gateway.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`health-indicator ${
                        gateway.balance > 100000 ? 'healthy' : 
                        gateway.balance > 10000 ? 'low' : 'critical'
                      }`} />
                      <div>
                        <p className="font-medium text-sm">{gateway.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {gateway.is_active ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold currency text-sm">{formatCurrency(gateway.balance)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card className="lg:col-span-2" data-testid="recent-transactions">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Recent Transactions</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/transactions')}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.recent_transactions?.length === 0 ? (
              <div className="empty-state py-8">
                <ArrowLeftRight className="empty-state-icon" />
                <p className="empty-state-title">No transactions yet</p>
                <p className="empty-state-description">Create your first transaction to see it here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats?.recent_transactions?.map((txn) => (
                  <div
                    key={txn.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => navigate('/transactions')}
                    data-testid={`txn-${txn.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${
                        txn.transaction_type === 'type_01' 
                          ? 'bg-blue-100 dark:bg-blue-900/30' 
                          : 'bg-purple-100 dark:bg-purple-900/30'
                      }`}>
                        {txn.transaction_type === 'type_01' ? (
                          <ArrowUpRight className={`w-4 h-4 ${
                            txn.transaction_type === 'type_01' 
                              ? 'text-blue-600 dark:text-blue-400' 
                              : 'text-purple-600 dark:text-purple-400'
                          }`} />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{txn.customer_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {txn.card_details} • {txn.swipe_gateway_name}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold currency text-sm">{formatCurrency(txn.transaction_type === 'type_02' ? (txn.pay_to_card_amount || txn.swipe_amount) : txn.swipe_amount)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(txn.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
