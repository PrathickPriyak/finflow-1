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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { 
  Shield, ShieldAlert, ShieldCheck, RefreshCw, Trash2, 
  Loader2, Clock, Mail, Globe, AlertTriangle, Ban,
  Unlock, Users
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function SecurityPage() {
  const { api, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [clearing, setClearing] = useState(null);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);

  useEffect(() => {
    fetchRateLimits();
  }, []);

  const fetchRateLimits = async () => {
    setLoading(true);
    try {
      const response = await api.get('/auth/rate-limits');
      setData(response.data);
    } catch (error) {
      if (error.response?.status === 403) {
        toast.error('Only SuperAdmin can access this page');
      } else {
        toast.error('Failed to load rate limit data');
      }
    } finally {
      setLoading(false);
    }
  };

  const clearEmailLimit = async (email) => {
    setClearing(email);
    try {
      await api.delete(`/auth/rate-limits/email/${encodeURIComponent(email)}`);
      toast.success(`Cleared rate limit for ${email}`);
      fetchRateLimits();
    } catch (error) {
      toast.error('Failed to clear rate limit');
    } finally {
      setClearing(null);
    }
  };

  const clearIpLimit = async (ip) => {
    setClearing(ip);
    try {
      await api.delete(`/auth/rate-limits/ip/${encodeURIComponent(ip)}`);
      toast.success(`Cleared rate limit for IP ${ip}`);
      fetchRateLimits();
    } catch (error) {
      toast.error('Failed to clear rate limit');
    } finally {
      setClearing(null);
    }
  };

  const clearAllLimits = async () => {
    setClearing('all');
    try {
      const response = await api.delete('/auth/rate-limits/all');
      toast.success(response.data.message);
      setShowClearAllDialog(false);
      fetchRateLimits();
    } catch (error) {
      toast.error('Failed to clear all rate limits');
    } finally {
      setClearing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <ShieldAlert className="w-16 h-16 text-muted-foreground" />
        <p className="text-muted-foreground">Unable to load security data</p>
        <Button onClick={fetchRateLimits}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="security-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Security</h1>
          <p className="text-muted-foreground mt-1">Monitor and manage login rate limits</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchRateLimits}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {data.summary.total_attempts > 0 && (
            <Button variant="destructive" onClick={() => setShowClearAllDialog(true)}>
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{data.summary.total_attempts}</p>
                <p className="text-sm text-muted-foreground">Total Attempts</p>
              </div>
              <Users className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-red-600">{data.summary.total_failed}</p>
                <p className="text-sm text-muted-foreground">Failed Attempts</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card className={data.summary.blocked_emails > 0 ? 'border-red-200 bg-red-50 dark:bg-red-950/20' : ''}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{data.summary.blocked_emails}</p>
                <p className="text-sm text-muted-foreground">Blocked Emails</p>
              </div>
              <Ban className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{data.summary.limited_ips}</p>
                <p className="text-sm text-muted-foreground">Limited IPs</p>
              </div>
              <Globe className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rate Limit Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Rate Limit Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span>Window: <strong>{data.window_minutes} minutes</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span>Max failed per email: <strong>{data.thresholds.max_failed_per_email}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <span>Max per IP: <strong>{data.thresholds.max_per_ip}</strong></span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Blocked Emails */}
      {data.blocked_emails.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-600">
              <ShieldAlert className="w-4 h-4" />
              Blocked Emails ({data.blocked_emails.length})
            </CardTitle>
            <CardDescription>
              These emails have exceeded the failed attempt threshold and are temporarily blocked
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Failed Attempts</TableHead>
                  <TableHead>Last Attempt</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.blocked_emails.map((item) => (
                  <TableRow key={item.email}>
                    <TableCell className="font-medium">{item.email}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{item.failed} / {data.thresholds.max_failed_per_email}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {item.last_attempt ? formatDistanceToNow(new Date(item.last_attempt), { addSuffix: true }) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => clearEmailLimit(item.email)}
                        disabled={clearing === item.email}
                      >
                        {clearing === item.email ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Unlock className="w-4 h-4 mr-1" />
                            Unblock
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rate Limited IPs */}
      {data.limited_ips.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-600">
              <Globe className="w-4 h-4" />
              Rate Limited IPs ({data.limited_ips.length})
            </CardTitle>
            <CardDescription>
              These IPs have exceeded the request limit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Total Attempts</TableHead>
                  <TableHead>Emails Targeted</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.limited_ips.map((item) => (
                  <TableRow key={item.ip}>
                    <TableCell className="font-mono">{item.ip}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{item.total} / {data.thresholds.max_per_ip}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.emails.slice(0, 3).map(email => (
                          <Badge key={email} variant="outline" className="text-xs">
                            {email.length > 20 ? email.slice(0, 20) + '...' : email}
                          </Badge>
                        ))}
                        {item.emails.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{item.emails.length - 3} more</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => clearIpLimit(item.ip)}
                        disabled={clearing === item.ip}
                      >
                        {clearing === item.ip ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4 mr-1" />
                            Clear
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Recent Login Activity
          </CardTitle>
          <CardDescription>
            Top 20 emails by failed attempts in the last {data.window_minutes} minutes
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.all_emails.length === 0 ? (
            <div className="text-center py-8">
              <ShieldCheck className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-muted-foreground">No login attempts in the current window</p>
              <p className="text-sm text-muted-foreground mt-1">All clear!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.all_emails.map((item) => {
                  const isBlocked = item.failed >= data.thresholds.max_failed_per_email;
                  return (
                    <TableRow key={item.email}>
                      <TableCell className="font-medium">{item.email}</TableCell>
                      <TableCell>{item.total}</TableCell>
                      <TableCell>
                        <span className={item.failed > 0 ? 'text-red-600 font-medium' : ''}>
                          {item.failed}
                        </span>
                      </TableCell>
                      <TableCell>
                        {isBlocked ? (
                          <Badge variant="destructive" className="gap-1">
                            <Ban className="w-3 h-3" />
                            Blocked
                          </Badge>
                        ) : item.failed > 0 ? (
                          <Badge variant="secondary" className="gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Warning
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-green-600">
                            <ShieldCheck className="w-3 h-3" />
                            OK
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => clearEmailLimit(item.email)}
                          disabled={clearing === item.email}
                        >
                          {clearing === item.email ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clear All Confirmation */}
      <AlertDialog open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Rate Limits?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all {data.summary.total_attempts} login attempt records. 
              All blocked emails and rate-limited IPs will be unblocked immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button 
              variant="destructive" 
              onClick={clearAllLimits}
              disabled={clearing === 'all'}
            >
              {clearing === 'all' ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Clear All
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
