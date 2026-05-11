import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  Download, FileSpreadsheet, Users, CreditCard, Wallet, Receipt, 
  ScrollText, Building2, Calendar, Loader2, CheckCircle2, Clock,
  ArrowDownLeft, ArrowUpRight, DollarSign, Percent
} from 'lucide-react';
// UI/UX-02: Use centralized formatters
import { formatDateForAPI } from '@/lib/formatters';

export default function DownloadsPage() {
  const { api } = useAuth();
  const [downloading, setDownloading] = useState({});
  
  // Date filters
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  const [dateFrom, setDateFrom] = useState(formatDateForAPI(thirtyDaysAgo));
  const [dateTo, setDateTo] = useState(formatDateForAPI(today));

  const downloadFile = async (endpoint, filename, category) => {
    setDownloading(prev => ({ ...prev, [category]: true }));
    try {
      const response = await api.get(endpoint, { responseType: 'blob' });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success(`Downloaded ${filename}`);
    } catch (error) {
      toast.error(`Failed to download ${category}`);

    } finally {
      setDownloading(prev => ({ ...prev, [category]: false }));
    }
  };

  const exportCategories = [
    {
      id: 'transactions',
      title: 'Transactions',
      description: 'All swipe transactions with customer, gateway, and amount details',
      icon: CreditCard,
      color: 'bg-blue-100 text-blue-600',
      endpoint: `/export/transactions?date_from=${dateFrom}&date_to=${dateTo}`,
      filename: `transactions_${dateFrom}_to_${dateTo}.xlsx`,
      hasDateFilter: true,
    },
    {
      id: 'customers',
      title: 'Customers',
      description: 'Customer list with contact info, cards, and transaction history',
      icon: Users,
      color: 'bg-purple-100 text-purple-600',
      endpoint: '/export/customers',
      filename: `customers_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'collections',
      title: 'Pending Collections',
      description: 'All pending collections from customers with aging info',
      icon: Percent,
      color: 'bg-amber-100 text-amber-600',
      endpoint: '/export/collections',
      filename: `collections_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'payments',
      title: 'Payment History',
      description: 'History of all payments made TO customers',
      icon: ArrowUpRight,
      color: 'bg-emerald-100 text-emerald-600',
      endpoint: '/export/payments',
      filename: `payment_history_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'collection_history',
      title: 'Collection History',
      description: 'History of all collections received FROM customers',
      icon: ArrowDownLeft,
      color: 'bg-teal-100 text-teal-600',
      endpoint: '/export/collection-history',
      filename: `collection_history_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'expenses',
      title: 'Expenses',
      description: 'All expenses with type, wallet, and amount details',
      icon: Receipt,
      color: 'bg-red-100 text-red-600',
      endpoint: '/export/expenses',
      filename: `expenses_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'wallet_operations',
      title: 'Wallet Operations',
      description: 'All wallet credits, debits, and transfers',
      icon: Wallet,
      color: 'bg-indigo-100 text-indigo-600',
      endpoint: '/export/wallet-operations',
      filename: `wallet_operations_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'daily_closings',
      title: 'Daily Closings',
      description: 'Daily closing reports with summaries',
      icon: Calendar,
      color: 'bg-pink-100 text-pink-600',
      endpoint: '/export/daily-closings',
      filename: `daily_closings_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'audit_logs',
      title: 'Audit Logs',
      description: 'System audit trail with user actions and IP addresses',
      icon: ScrollText,
      color: 'bg-gray-100 text-gray-600',
      endpoint: '/export/audit-logs',
      filename: `audit_logs_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
    {
      id: 'gateways',
      title: 'Gateways & Servers',
      description: 'Gateway configuration with servers and charge rates',
      icon: Building2,
      color: 'bg-cyan-100 text-cyan-600',
      endpoint: '/export/gateways',
      filename: `gateways_${formatDateForAPI(today)}.xlsx`,
      hasDateFilter: false,
    },
  ];

  return (
    <div className="space-y-6" data-testid="downloads-page">
      {/* Header */}
      <div>
        <h1 className="page-title">Downloads</h1>
        <p className="text-muted-foreground mt-1">Export data from the application in Excel format</p>
      </div>

      {/* Date Filter for Transactions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Date Range Filter
          </CardTitle>
          <CardDescription>Applied to transaction exports</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="date-from">From</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full sm:w-[160px]"
                data-testid="date-from"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-to">To</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full sm:w-[160px]"
                data-testid="date-to"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                data-testid="filter-today-btn"
                onClick={() => {
                  const today = new Date();
                  setDateFrom(formatDateForAPI(today));
                  setDateTo(formatDateForAPI(today));
                }}
              >
                Today
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                data-testid="filter-week-btn"
                onClick={() => {
                  const today = new Date();
                  const weekAgo = new Date(today);
                  weekAgo.setDate(today.getDate() - 7);
                  setDateFrom(formatDateForAPI(weekAgo));
                  setDateTo(formatDateForAPI(today));
                }}
              >
                Last 7 Days
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                data-testid="filter-month-btn"
                onClick={() => {
                  const today = new Date();
                  const monthAgo = new Date(today);
                  monthAgo.setDate(today.getDate() - 30);
                  setDateFrom(formatDateForAPI(monthAgo));
                  setDateTo(formatDateForAPI(today));
                }}
              >
                Last 30 Days
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {exportCategories.map((category) => {
          const Icon = category.icon;
          const isDownloading = downloading[category.id];
          
          return (
            <Card key={category.id} className="hover:shadow-md transition-shadow" data-testid={`export-${category.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${category.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium flex items-center gap-2">
                        {category.title}
                        {category.hasDateFilter && (
                          <Badge variant="outline" className="text-[10px]">Date Filtered</Badge>
                        )}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{category.description}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    <FileSpreadsheet className="w-3 h-3 mr-1" />
                    Excel (.xlsx)
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => downloadFile(category.endpoint, category.filename, category.id)}
                    disabled={isDownloading}
                    data-testid={`download-${category.id}`}
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info Note */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
            <div>
              <h4 className="font-medium">Export Information</h4>
              <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                <li>• All exports are in Excel format (.xlsx) for easy viewing and analysis</li>
                <li>• Transaction export respects the date range filter above</li>
                <li>• Other exports include all records (not filtered by date)</li>
                <li>• Export activity is logged in the audit trail</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
