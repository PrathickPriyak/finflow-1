import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { 
  AlertTriangle, Trash2, Loader2, RefreshCw, 
  Wallet, Users, FileText, Settings, Database,
  ShieldAlert, ChevronDown, Zap, RotateCcw,
  ArrowRight, Info
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// Simplified reset option groups
const resetGroups = [
  {
    id: 'financial',
    title: 'Financial Data',
    icon: Wallet,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    options: [
      { id: 'transactions', label: 'Transactions', desc: 'All swipe transactions' },
      { id: 'wallet_operations', label: 'Wallet Operations', desc: 'Credit/debit history' },
      { id: 'collections', label: 'Collections', desc: 'Amounts owed by customers' },
      { id: 'expenses', label: 'Expenses', desc: 'Business expense records' },
      { id: 'reset_wallet_balances', label: 'Reset Wallet Balances', desc: 'Set all wallet balances to 0' },
    ]
  },
  {
    id: 'master',
    title: 'Master Data',
    icon: Database,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    options: [
      { id: 'customers', label: 'Customers', desc: 'Customer profiles & cards' },
      { id: 'gateways', label: 'Gateways', desc: 'Payment gateways & their wallets' },
      { id: 'wallets', label: 'Wallets', desc: 'All bank & cash wallets' },
      { id: 'gateway_servers', label: 'Gateway Servers', desc: 'Server configurations' },
      { id: 'banks', label: 'Banks', desc: 'Bank master data' },
      { id: 'card_networks', label: 'Card Networks', desc: 'Visa, Mastercard, etc.' },
      { id: 'expense_types', label: 'Expense Types', desc: 'Expense categories' },
    ]
  },
  {
    id: 'reports',
    title: 'Reports & Logs',
    icon: FileText,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    options: [
      { id: 'audit_logs', label: 'Audit Logs', desc: 'User activity history' },
      { id: 'reconciliation_reports', label: 'Reconciliation', desc: 'Data check reports' },
      { id: 'daily_closings', label: 'Daily Closings', desc: 'End-of-day records' },
      { id: 'security_logs', label: 'Security Logs', desc: 'Rate limit & login attempts' },
    ]
  },
];

// Advanced options (collapsed by default)
const advancedOptions = [
  { id: 'balance_snapshots', label: 'Balance Snapshots', desc: 'Integrity check data' },
  { id: 'balance_verifications', label: 'Balance Verifications', desc: 'Manual verification records' },
  { id: 'id_counters', label: 'ID Counters', desc: 'Reset C001, T1-0001 to start' },
  { id: 'users', label: 'Users', desc: 'All users except you' },
  { id: 'roles', label: 'Roles', desc: 'All roles except SuperAdmin' },
  { id: 'settings', label: 'Settings', desc: 'Reset to defaults' },
  { id: 'sessions', label: 'Sessions', desc: 'Logout all users' },
];

export default function ResetPage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [counts, setCounts] = useState({});
  const [selected, setSelected] = useState({});
  const [confirmation, setConfirmation] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activePreset, setActivePreset] = useState('');

  useEffect(() => {
    fetchPreview();
  }, []);

  const fetchPreview = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/reset-preview`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setCounts(data);
      } else if (res.status === 403) {
        toast.error('Only SuperAdmin can access this page');
      }
    } catch (error) {
      toast.error('Failed to load data preview');
    } finally {
      setLoading(false);
    }
  };

  // Apply preset selection
  const applyPreset = (presetId) => {
    if (!counts.presets || !counts.presets[presetId]) return;
    
    const newSelected = {};
    counts.presets[presetId].options.forEach(opt => {
      newSelected[opt] = true;
    });
    setSelected(newSelected);
    setActivePreset(presetId);
    
    // Show advanced section if preset includes advanced options
    const hasAdvanced = advancedOptions.some(opt => newSelected[opt.id]);
    if (hasAdvanced) setShowAdvanced(true);
  };

  // Toggle individual option with dependency handling
  const toggleOption = (optionId) => {
    const newSelected = { ...selected };
    const newValue = !newSelected[optionId];
    newSelected[optionId] = newValue;
    
    // Apply dependencies if enabling
    if (newValue && counts.dependencies && counts.dependencies[optionId]) {
      counts.dependencies[optionId].forEach(dep => {
        newSelected[dep] = true;
      });
      toast.info(`Auto-selected dependent items`, { duration: 2000 });
    }
    
    setSelected(newSelected);
    setActivePreset(''); // Clear preset when manually selecting
  };

  const toggleGroup = (groupId) => {
    const group = resetGroups.find(g => g.id === groupId);
    if (!group) return;
    
    const allSelected = group.options.every(opt => selected[opt.id]);
    const newState = { ...selected };
    group.options.forEach(opt => {
      newState[opt.id] = !allSelected;
    });
    setSelected(newState);
    setActivePreset('');
  };

  const clearAll = () => {
    setSelected({});
    setActivePreset('');
  };

  const getSelectedCount = () => {
    return Object.values(selected).filter(Boolean).length;
  };

  const isGroupFullySelected = (groupId) => {
    const group = resetGroups.find(g => g.id === groupId);
    return group?.options.every(opt => selected[opt.id]);
  };

  const handleReset = async () => {
    if (confirmation !== 'RESET') {
      toast.error("Please type 'RESET' to confirm");
      return;
    }

    setResetting(true);
    try {
      const payload = {
        ...selected,
        preset: activePreset,
        confirmation: 'RESET'
      };

      const res = await fetch(`${API_URL}/api/admin/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        toast.success('Data reset completed successfully');
        setShowConfirmDialog(false);
        setConfirmation('');
        setSelected({});
        setActivePreset('');
        fetchPreview();
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Reset failed');
      }
    } catch (error) {
      toast.error('Reset failed: ' + error.message);
    } finally {
      setResetting(false);
    }
  };

  const getCountForOption = (optionId) => counts[optionId];

  // Get warnings for selected items
  const getActiveWarnings = () => {
    if (!counts.warnings) return [];
    return counts.warnings.filter(w => selected[w.trigger]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="reset-page">
      {/* Warning Header */}
      <div className="bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">System Reset</h1>
            <p className="text-white/80 mt-1">
              Permanently delete selected data. This cannot be undone.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-2xl font-bold">{counts.transactions || 0}</p>
          <p className="text-xs text-muted-foreground">Transactions</p>
        </Card>
        <Card className="p-3">
          <p className="text-2xl font-bold">{counts.customers || 0}</p>
          <p className="text-xs text-muted-foreground">Customers</p>
        </Card>
        <Card className="p-3">
          <p className="text-2xl font-bold">{counts.wallets || 0}</p>
          <p className="text-xs text-muted-foreground">Wallets</p>
        </Card>
        <Card className="p-3">
          <p className="text-2xl font-bold">{formatCurrency(counts.total_wallet_balance || 0)}</p>
          <p className="text-xs text-muted-foreground">Total Balance</p>
        </Card>
      </div>

      {/* Preset Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            Quick Actions
          </CardTitle>
          <CardDescription>Choose a preset or select individual items below</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Fresh Start */}
            <button
              onClick={() => applyPreset('fresh_start')}
              className={`p-4 rounded-lg border-2 text-left transition-all hover:border-red-300 ${
                activePreset === 'fresh_start' 
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/30' 
                  : 'border-muted'
              }`}
              data-testid="preset-fresh-start"
            >
              <div className="flex items-center gap-2 mb-2">
                <RotateCcw className="w-5 h-5 text-red-500" />
                <span className="font-semibold">Fresh Start</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Delete ALL data. Start completely fresh.
              </p>
            </button>

            {/* Reset Financials */}
            <button
              onClick={() => applyPreset('financials')}
              className={`p-4 rounded-lg border-2 text-left transition-all hover:border-emerald-300 ${
                activePreset === 'financials' 
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' 
                  : 'border-muted'
              }`}
              data-testid="preset-financials"
            >
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold">Reset Financials</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Clear transactions & balances. Keep master data.
              </p>
            </button>

            {/* Reset Master Data */}
            <button
              onClick={() => applyPreset('master_data')}
              className={`p-4 rounded-lg border-2 text-left transition-all hover:border-blue-300 ${
                activePreset === 'master_data' 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' 
                  : 'border-muted'
              }`}
              data-testid="preset-master-data"
            >
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-5 h-5 text-blue-500" />
                <span className="font-semibold">Reset Master Data</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Clear customers, gateways, wallets.
              </p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Dependency Warnings */}
      {getActiveWarnings().length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-700 dark:text-amber-400">Dependency Notice</p>
                {getActiveWarnings().map((warning, idx) => (
                  <p key={idx} className="text-sm text-amber-600 dark:text-amber-500">
                    {warning.message}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom Selection */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Custom Selection</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear All
          </Button>
          <Badge variant={getSelectedCount() > 0 ? 'destructive' : 'secondary'}>
            {getSelectedCount()} selected
          </Badge>
        </div>
      </div>

      {/* Main Options */}
      <div className="space-y-4">
        {resetGroups.map((group) => {
          const Icon = group.icon;
          const isFullySelected = isGroupFullySelected(group.id);
          
          return (
            <Card key={group.id} className={isFullySelected ? 'ring-2 ring-red-400' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${group.bgColor} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${group.color}`} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{group.title}</CardTitle>
                    </div>
                  </div>
                  <Checkbox
                    checked={isFullySelected}
                    onCheckedChange={() => toggleGroup(group.id)}
                    data-testid={`group-${group.id}`}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {group.options.map((option) => {
                    const count = getCountForOption(option.id);
                    const isSelected = selected[option.id];
                    return (
                      <div
                        key={option.id}
                        onClick={() => toggleOption(option.id)}
                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800' 
                            : 'hover:bg-muted/50 border border-transparent'
                        }`}
                        data-testid={`option-${option.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected || false}
                            onCheckedChange={() => toggleOption(option.id)}
                          />
                          <div>
                            <p className="font-medium text-sm">{option.label}</p>
                            <p className="text-xs text-muted-foreground">{option.desc}</p>
                          </div>
                        </div>
                        {count !== undefined && count > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {count}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Advanced Options (Collapsible) */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
                    <Settings className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Advanced Options</CardTitle>
                    <CardDescription>System settings & rarely-used options</CardDescription>
                  </div>
                </div>
                <ChevronDown className={`w-5 h-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {advancedOptions.map((option) => {
                  const count = getCountForOption(option.id);
                  const isSelected = selected[option.id];
                  return (
                    <div
                      key={option.id}
                      onClick={() => toggleOption(option.id)}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800' 
                          : 'hover:bg-muted/50 border border-transparent'
                      }`}
                      data-testid={`option-${option.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isSelected || false}
                          onCheckedChange={() => toggleOption(option.id)}
                        />
                        <div>
                          <p className="font-medium text-sm">{option.label}</p>
                          <p className="text-xs text-muted-foreground">{option.desc}</p>
                        </div>
                      </div>
                      {count !== undefined && count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {count}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Reset Button */}
      <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <div>
                <p className="font-medium text-red-700 dark:text-red-400">
                  {getSelectedCount()} items selected for deletion
                </p>
                <p className="text-sm text-red-600/70 dark:text-red-400/70">
                  This action cannot be undone
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="lg"
              disabled={getSelectedCount() === 0}
              onClick={() => setShowConfirmDialog(true)}
              data-testid="reset-button"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Reset Selected Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Confirm Data Reset
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  You are about to permanently delete <strong>{getSelectedCount()}</strong> categories of data.
                  This action <strong>cannot be undone</strong>.
                </p>
                
                {activePreset && (
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-sm">
                      <span className="font-medium">Using preset:</span>{' '}
                      <Badge variant="outline">{activePreset.replace('_', ' ')}</Badge>
                    </p>
                  </div>
                )}
                
                <div className="bg-muted p-3 rounded-lg max-h-32 overflow-y-auto">
                  <p className="text-sm font-medium mb-2">Selected for deletion:</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(selected)
                      .filter(([_, v]) => v)
                      .map(([key]) => (
                        <Badge key={key} variant="destructive" className="text-xs">
                          {key.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="confirm-input" className="text-sm font-medium">
                    Type <span className="font-bold text-red-600">RESET</span> to confirm:
                  </Label>
                  <Input
                    id="confirm-input"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value.toUpperCase())}
                    placeholder="Type RESET"
                    className="font-mono"
                    data-testid="reset-confirmation-input"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmation('')}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={confirmation !== 'RESET' || resetting}
              data-testid="confirm-reset-button"
            >
              {resetting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Confirm Reset
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
