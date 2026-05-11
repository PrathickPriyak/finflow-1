import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Settings, Building2, Mail, Shield, Clock, Save, Loader2, CalendarClock, RefreshCw, CheckCircle, XCircle, Send, AlertCircle, Calculator } from 'lucide-react';
import { getApiError } from '@/lib/formatters';

export default function SettingsPage() {
  const { api } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [triggeringClose, setTriggeringClose] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState(null);
  const [smtpLoading, setSmtpLoading] = useState(true);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchSchedulerStatus();
    fetchSmtpStatus();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await api.get('/settings');
      setSettings(response.data);
    } catch (error) {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedulerStatus = async () => {
    try {
      const response = await api.get('/daily-closing/scheduler-status');
      setSchedulerStatus(response.data);
    } catch (error) {

    }
  };

  const fetchSmtpStatus = async () => {
    try {
      const response = await api.get('/smtp/status');
      setSmtpStatus(response.data);
    } catch (error) {

    } finally {
      setSmtpLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!smtpStatus?.configured) {
      toast.error('SMTP is not configured. Please set environment variables.');
      return;
    }
    
    setSendingTestEmail(true);
    try {
      const toEmail = smtpStatus.from_email || prompt('Enter email address to send test to:');
      if (!toEmail) {
        setSendingTestEmail(false);
        return;
      }
      
      const response = await api.post('/smtp/test', { to_email: toEmail });
      toast.success(response.data.message || 'Test email sent successfully!');
    } catch (error) {
      toast.error(getApiError(error, 'Failed to send test email'));
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings', settings);
      toast.success('Settings saved successfully');
      // Refresh scheduler status after saving
      await fetchSchedulerStatus();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerAutoClose = async () => {
    setTriggeringClose(true);
    try {
      await api.post('/daily-closing/trigger-auto-close');
      toast.success('Auto closing triggered successfully');
    } catch (error) {
      toast.error(getApiError(error, 'Failed to trigger auto closing'));
    } finally {
      setTriggeringClose(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-64 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure system settings and preferences</p>
        </div>
        <Button onClick={handleSave} disabled={saving} data-testid="save-settings-btn">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </div>

      {/* Business Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            <div>
              <CardTitle>Business Settings</CardTitle>
              <CardDescription>Configure your business information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Business Name</Label>
              <Input
                value={settings?.business_name || ''}
                onChange={(e) => setSettings({ ...settings, business_name: e.target.value })}
                placeholder="Fin Flow"
                data-testid="business-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input value="INR (₹)" disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SMTP Settings - ENV-only, read-only status */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            <div>
              <CardTitle>Email / SMTP Configuration</CardTitle>
              <CardDescription>SMTP settings are configured via environment variables</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {smtpLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Status Banner */}
              <div className={`flex items-center justify-between p-4 rounded-lg border ${
                smtpStatus?.configured 
                  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' 
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
              }`}>
                <div className="flex items-center gap-3">
                  {smtpStatus?.configured ? (
                    <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  )}
                  <div>
                    <p className={`font-medium ${
                      smtpStatus?.configured 
                        ? 'text-emerald-700 dark:text-emerald-300' 
                        : 'text-amber-700 dark:text-amber-300'
                    }`}>
                      {smtpStatus?.configured ? 'SMTP Configured' : 'SMTP Not Configured'}
                    </p>
                    <p className={`text-sm ${
                      smtpStatus?.configured 
                        ? 'text-emerald-600 dark:text-emerald-400' 
                        : 'text-amber-600 dark:text-amber-400'
                    }`}>
                      {smtpStatus?.message}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleSendTestEmail}
                  disabled={!smtpStatus?.configured || sendingTestEmail}
                  variant={smtpStatus?.configured ? 'default' : 'outline'}
                  size="sm"
                  data-testid="send-test-email-btn"
                >
                  {sendingTestEmail ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Send Test Email
                </Button>
              </div>

              {/* Configuration Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Host</Label>
                  <p className="font-mono text-sm bg-muted/50 p-2 rounded">{smtpStatus?.host || 'Not set'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Port</Label>
                  <p className="font-mono text-sm bg-muted/50 p-2 rounded">{smtpStatus?.port || 'Not set'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">From Email</Label>
                  <p className="font-mono text-sm bg-muted/50 p-2 rounded">{smtpStatus?.from_email || 'Not set'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">TLS Enabled</Label>
                  <p className="font-mono text-sm bg-muted/50 p-2 rounded">
                    {smtpStatus?.tls_enabled ? 'Yes' : 'No'}
                  </p>
                </div>
              </div>

              {/* Info about ENV configuration */}
              <div className="p-3 rounded-lg bg-muted/30 border border-dashed">
                <p className="text-sm text-muted-foreground">
                  <strong>Note:</strong> SMTP settings are configured via environment variables for security. 
                  Set <code className="text-xs bg-muted px-1 py-0.5 rounded">SMTP_HOST</code>, 
                  <code className="text-xs bg-muted px-1 py-0.5 rounded ml-1">SMTP_PORT</code>, 
                  <code className="text-xs bg-muted px-1 py-0.5 rounded ml-1">SMTP_USER</code>, 
                  <code className="text-xs bg-muted px-1 py-0.5 rounded ml-1">SMTP_PASSWORD</code>, and 
                  <code className="text-xs bg-muted px-1 py-0.5 rounded ml-1">SMTP_FROM</code> in your deployment configuration.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <div>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Configure security and session settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Session Timeout (minutes)</Label>
              <Input
                type="number"
                value={settings?.session_timeout_minutes || ''}
                onChange={(e) => setSettings({ ...settings, session_timeout_minutes: parseInt(e.target.value) || 30 })}
                placeholder="30"
                data-testid="session-timeout-input"
              />
              <p className="text-xs text-muted-foreground">Auto-logout after inactivity</p>
            </div>
            <div className="space-y-2">
              <Label>Transaction Lock (hours)</Label>
              <Input
                type="number"
                value={settings?.transaction_lock_hours || ''}
                onChange={(e) => setSettings({ ...settings, transaction_lock_hours: parseInt(e.target.value) || 24 })}
                placeholder="24"
                data-testid="transaction-lock-input"
              />
              <p className="text-xs text-muted-foreground">Lock transactions after this time</p>
            </div>
            <div className="space-y-2">
              <Label>OTP Expiry (minutes)</Label>
              <Input
                type="number"
                value={settings?.otp_expiry_minutes || ''}
                onChange={(e) => setSettings({ ...settings, otp_expiry_minutes: parseInt(e.target.value) || 5 })}
                placeholder="5"
                data-testid="otp-expiry-input"
              />
              <p className="text-xs text-muted-foreground">OTP validity duration</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Commission & Charges Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            <div>
              <CardTitle>Commission & Charges</CardTitle>
              <CardDescription>Configure default commission rates and charge thresholds</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Commission (%)</Label>
              <Input
                type="number"
                value={settings?.default_commission_percentage ?? ''}
                onChange={(e) => setSettings({ ...settings, default_commission_percentage: parseFloat(e.target.value) || 0 })}
                placeholder="1"
                step="0.1"
                min="0"
                max="100"
                data-testid="default-commission-input"
              />
              <p className="text-xs text-muted-foreground">Pre-fills commission % for cash/bank settlements</p>
            </div>
            <div className="space-y-2">
              <Label>Min Outstanding Threshold (INR)</Label>
              <Input
                type="number"
                value={settings?.min_outstanding_threshold ?? ''}
                onChange={(e) => setSettings({ ...settings, min_outstanding_threshold: parseFloat(e.target.value) || 0 })}
                placeholder="50"
                step="1"
                min="0"
                data-testid="min-outstanding-threshold-input"
              />
              <p className="text-xs text-muted-foreground">Below this, charges are written off as expense instead of creating a new collection</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto Daily Closing Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5" />
            <div>
              <CardTitle>Auto Daily Closing</CardTitle>
              <CardDescription>Automatically close the previous day at a scheduled time</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div>
              <Label className="text-base">Enable Auto Daily Closing</Label>
              <p className="text-sm text-muted-foreground">
                Automatically close and lock transactions at the scheduled time
              </p>
            </div>
            <Switch
              checked={settings?.auto_daily_closing_enabled || false}
              onCheckedChange={(v) => setSettings({ ...settings, auto_daily_closing_enabled: v })}
              data-testid="auto-closing-switch"
            />
          </div>

          {settings?.auto_daily_closing_enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label>Closing Time (24-hour format)</Label>
                <Input
                  type="time"
                  value={settings?.auto_daily_closing_time || '00:00'}
                  onChange={(e) => setSettings({ ...settings, auto_daily_closing_time: e.target.value })}
                  data-testid="auto-closing-time-input"
                />
                <p className="text-xs text-muted-foreground">
                  Time when auto-closing runs (IST timezone)
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <Label>Email Report</Label>
                  <p className="text-sm text-muted-foreground">Send daily summary via email</p>
                </div>
                <Switch
                  checked={settings?.auto_closing_email_report || false}
                  onCheckedChange={(v) => setSettings({ ...settings, auto_closing_email_report: v })}
                  data-testid="auto-closing-email-switch"
                />
              </div>
            </div>
          )}

          {/* Scheduler Status */}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Scheduler Status</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${schedulerStatus?.scheduler_running ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {schedulerStatus?.scheduler_running ? 'Running' : 'Stopped'}
                </span>
                {schedulerStatus?.next_run && (
                  <span>Next run: {new Date(schedulerStatus.next_run).toLocaleString()}</span>
                )}
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleTriggerAutoClose}
              disabled={triggeringClose}
              data-testid="trigger-auto-close-btn"
            >
              {triggeringClose ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Run Now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 text-muted-foreground">
            <Clock className="w-5 h-5" />
            <div>
              <p className="font-medium">Backup Reminder</p>
              <p className="text-sm">Remember to regularly backup your database for data safety.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Migration */}
      <DataMigrationSection api={api} />
    </div>
  );
}

// Data Migration Component
function DataMigrationSection({ api }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await api.get('/admin/migration-status');
      setStatus(response.data);
    } catch (error) {

    } finally {
      setLoading(false);
    }
  };

  const runMigration = async () => {
    if (!window.confirm('This will assign IDs to all existing customers, transactions, and wallet operations. Continue?')) {
      return;
    }
    setMigrating(true);
    try {
      const response = await api.post('/admin/migrate-ids');
      toast.success(`Migration completed: ${response.data.results.customers_updated} customers, ${response.data.results.transactions_updated} transactions, ${response.data.results.wallet_operations_updated} operations updated`);
      await checkStatus();
    } catch (error) {
      toast.error(getApiError(error, 'Migration failed'));
    } finally {
      setMigrating(false);
    }
  };

  if (loading) return null;

  const needsMigration = status?.total_records_to_migrate > 0;

  return (
    <Card className={needsMigration ? 'border-amber-500' : ''}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          <div>
            <CardTitle>Data Migration</CardTitle>
            <CardDescription>Manage unique ID assignments for existing records</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{status.customers_needing_migration}</p>
              <p className="text-sm text-muted-foreground">Customers</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{status.transactions_needing_migration}</p>
              <p className="text-sm text-muted-foreground">Transactions</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{status.wallet_operations_needing_migration}</p>
              <p className="text-sm text-muted-foreground">Wallet Operations</p>
            </div>
          </div>
        )}
        
        {needsMigration ? (
          <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {status?.total_records_to_migrate} records need unique IDs
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Run migration to assign IDs (C001, T1-0001, OP-0001, etc.)
              </p>
            </div>
            <Button 
              onClick={runMigration} 
              disabled={migrating}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="run-migration-btn"
            >
              {migrating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Run Migration
            </Button>
          </div>
        ) : (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg text-center">
            <p className="text-emerald-700 dark:text-emerald-300">
              ✓ All records have unique IDs assigned
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
