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
import { toast } from 'sonner';
import { CalendarCheck, FileText, CheckCircle } from 'lucide-react';
import { formatCurrency , getApiError } from '@/lib/formatters';


export default function DailyClosingPage() {
  const { api } = useAuth();
  const [todaySummary, setTodaySummary] = useState(null);
  const [closings, setClosings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [summaryRes, closingsRes] = await Promise.all([
        api.get('/daily-closing/today'),
        api.get('/daily-closing'),
      ]);
      setTodaySummary(summaryRes.data);
      setClosings(closingsRes.data);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm('Are you sure you want to close today? This action cannot be undone.')) return;
    try {
      await api.post('/daily-closing');
      toast.success('Daily closing completed successfully');
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to close day'));
    }
  };

  const isTodayClosed = closings.some(c => c.date === todaySummary?.date);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-64 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="daily-closing-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Daily Closing</h1>
          <p className="text-muted-foreground mt-1">End-of-day summary and reconciliation</p>
        </div>
      </div>

      {/* Today's Summary */}
      <Card data-testid="today-summary-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Today's Summary</CardTitle>
              <CardDescription data-testid="summary-date">{todaySummary?.date}</CardDescription>
            </div>
            {!isTodayClosed ? (
              <Button onClick={handleClose} data-testid="close-day-btn">
                <CalendarCheck className="w-4 h-4 mr-2" />
                Close Day
              </Button>
            ) : (
              <Badge className="status-completed" data-testid="day-closed-badge">
                <CheckCircle className="w-4 h-4 mr-1" />
                Closed
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="summary-stats">
            <div className="p-4 rounded-lg bg-muted/50" data-testid="stat-transactions">
              <p className="text-sm text-muted-foreground">Transactions</p>
              <p className="text-2xl font-bold">{todaySummary?.total_transactions || 0}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50" data-testid="stat-volume">
              <p className="text-sm text-muted-foreground">Total Volume</p>
              <p className="text-2xl font-bold">{formatCurrency(todaySummary?.total_swipe_amount || 0)}</p>
            </div>
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20" data-testid="stat-charges">
              <p className="text-sm text-muted-foreground">Gateway Charges</p>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(todaySummary?.total_gateway_charges || 0)}</p>
            </div>
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20" data-testid="stat-profit">
              <p className="text-sm text-muted-foreground">Net Profit</p>
              <p className="text-2xl font-bold text-emerald-600">{formatCurrency(todaySummary?.total_profit || 0)}</p>
            </div>
          </div>

          {/* Gateway-wise Summary */}
          {todaySummary?.gateway_wise_summary && Object.keys(todaySummary.gateway_wise_summary).length > 0 && (
            <div className="mt-6">
              <h3 className="font-medium mb-3">Gateway-wise Breakdown</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(todaySummary.gateway_wise_summary).map(([id, data]) => (
                  <div key={id} className="p-3 rounded-lg border">
                    <p className="font-medium">{data.gateway_name}</p>
                    <div className="flex justify-between mt-2 text-sm">
                      <span className="text-muted-foreground">Transactions:</span>
                      <span>{data.transactions}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Volume:</span>
                      <span>{formatCurrency(data.volume)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Charges:</span>
                      <span className="text-red-600">{formatCurrency(data.charges)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical Closings */}
      <Card>
        <CardHeader>
          <CardTitle>Closing History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {closings.length === 0 ? (
            <div className="empty-state py-12">
              <FileText className="empty-state-icon" />
              <p className="empty-state-title">No closing records yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Transactions</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Gateway Charges</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Closed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closings.map((closing) => (
                  <TableRow key={closing.id} data-testid={`closing-row-${closing.id}`}>
                    <TableCell className="font-medium">{closing.date}</TableCell>
                    <TableCell>{closing.total_transactions}</TableCell>
                    <TableCell className="text-right">{formatCurrency(closing.total_swipe_amount)}</TableCell>
                    <TableCell className="text-right text-red-600">{formatCurrency(closing.total_gateway_charges)}</TableCell>
                    <TableCell className="text-right text-emerald-600 font-medium">{formatCurrency(closing.total_profit)}</TableCell>
                    <TableCell className="text-muted-foreground">{closing.closed_by_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
