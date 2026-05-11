import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line, ComposedChart
} from 'recharts';
import { 
  BarChart3, Users, Loader2, Building2, TrendingUp, Receipt,
  Calendar, RefreshCw, DollarSign, Hash, TrendingDown, Star
} from 'lucide-react';
import { formatCurrency, formatDateForAPI } from '@/lib/formatters';

// Simple horizontal bar chart
const HorizontalBarChart = ({ data, valueKey, labelKey, color = "#10b981", formatValue = formatCurrency }) => {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  const maxValue = Math.max(...data.map(d => d[valueKey] || 0));
  
  return (
    <div className="space-y-3">
      {data.slice(0, 10).map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground w-32 truncate" title={item[labelKey]}>{item[labelKey]}</span>
          <div className="flex-1 h-8 bg-muted rounded overflow-hidden">
            <div 
              className="h-full rounded transition-all duration-500 flex items-center justify-end pr-2"
              style={{ 
                width: `${maxValue > 0 ? Math.max((item[valueKey] / maxValue) * 100, 5) : 0}%`,
                backgroundColor: color
              }}
            >
              <span className="text-xs font-medium text-white">{formatValue(item[valueKey] || 0)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Simple line/area chart for daily data
const DailyChart = ({ data, valueKey, color = "#8b5cf6" }) => {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  const maxValue = Math.max(...data.map(d => d[valueKey] || 0));
  const minValue = 0;
  
  return (
    <div className="h-48 flex items-end gap-1">
      {data.map((item, i) => {
        const height = maxValue > 0 ? ((item[valueKey] - minValue) / (maxValue - minValue)) * 100 : 0;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex justify-center">
              <div 
                className="w-full max-w-8 rounded-t transition-all duration-300 group-hover:opacity-80"
                style={{ height: `${Math.max(height, 2)}%`, backgroundColor: color, minHeight: '4px' }}
              />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                {formatCurrency(item[valueKey])}
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground rotate-0 truncate w-full text-center">
              {item.date?.slice(5) || ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default function ReportsPage() {
  const { api } = useAuth();
  const [activeTab, setActiveTab] = useState('agent');
  const [loading, setLoading] = useState(false);
  
  // Date range
  const [dateRange, setDateRange] = useState('7days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  
  // Report data
  const [agentData, setAgentData] = useState(null);
  const [gatewayData, setGatewayData] = useState(null);
  const [profitData, setProfitData] = useState(null);
  const [expensesData, setExpensesData] = useState(null);
  const [pnlData, setPnlData] = useState(null);
  const [pnlYear, setPnlYear] = useState(new Date().getFullYear());
  const [pnlLoading, setPnlLoading] = useState(false);

  const pnlYears = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const fetchPnlData = async (yr) => {
    setPnlLoading(true);
    try {
      const res = await api.get(`/reports/monthly-pnl?year=${yr}`);
      setPnlData(res.data);
    } catch {
      toast.error('Failed to load Monthly P&L');
    } finally {
      setPnlLoading(false);
    }
  };

  const getDateRange = () => {
    const today = new Date();
    let from, to;
    
    switch (dateRange) {
      case 'today':
        from = to = formatDateForAPI(today);
        break;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        from = to = formatDateForAPI(yesterday);
        break;
      case '7days':
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 6);
        from = formatDateForAPI(weekAgo);
        to = formatDateForAPI(today);
        break;
      case 'custom':
        from = customFrom;
        to = customTo;
        break;
      default:
        from = to = formatDateForAPI(today);
    }
    
    return { from, to };
  };

  const fetchReportData = async () => {
    const { from, to } = getDateRange();
    if (!from || !to) {
      toast.error('Please select valid date range');
      return;
    }
    
    setLoading(true);
    try {
      const params = `date_from=${from}&date_to=${to}`;
      
      const [agentRes, gatewayRes, profitRes, expensesRes] = await Promise.all([
        api.get(`/reports/agent-performance?${params}`),
        api.get(`/reports/gateway-performance?${params}`),
        api.get(`/reports/profit?${params}`),
        api.get(`/reports/expenses?${params}`)
      ]);
      
      setAgentData(agentRes.data);
      setGatewayData(gatewayRes.data);
      setProfitData(profitRes.data);
      setExpensesData(expensesRes.data);
    } catch (error) {
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [dateRange]);

  useEffect(() => {
    if (dateRange === 'custom' && customFrom && customTo) {
      fetchReportData();
    }
  }, [customFrom, customTo]);

  useEffect(() => {
    fetchPnlData(pnlYear);
  }, [pnlYear]);

  const getDateRangeLabel = () => {
    const { from, to } = getDateRange();
    if (from === to) return from;
    return `${from} to ${to}`;
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            Reports
          </h1>
          <p className="text-sm text-muted-foreground">Performance analytics and insights</p>
        </div>
        <Button variant="outline" onClick={fetchReportData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Date Range Selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Date Range
              </Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-[160px]" data-testid="date-range-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="7days">Last 07 Days</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {dateRange === 'custom' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">From</Label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full sm:w-[150px]"
                    data-testid="custom-from"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To</Label>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full sm:w-[150px]"
                    data-testid="custom-to"
                  />
                </div>
              </>
            )}
            
            <Badge variant="secondary" className="h-9 px-3">
              {getDateRangeLabel()}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-5 sm:max-w-3xl">
          <TabsTrigger value="agent" data-testid="agent-tab">
            <Users className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Agent</span>
            <span className="sm:hidden">Agent</span>
          </TabsTrigger>
          <TabsTrigger value="gateway" data-testid="gateway-tab">
            <Building2 className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Gateway</span>
            <span className="sm:hidden">GW</span>
          </TabsTrigger>
          <TabsTrigger value="profit" data-testid="profit-tab">
            <TrendingUp className="w-4 h-4 mr-1.5" />
            Profit
          </TabsTrigger>
          <TabsTrigger value="expenses" data-testid="expenses-tab">
            <Receipt className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Expenses</span>
            <span className="sm:hidden">Exp</span>
          </TabsTrigger>
          <TabsTrigger value="monthly-pnl" data-testid="monthly-pnl-tab">
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Monthly P&amp;L
          </TabsTrigger>
        </TabsList>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Agent Performance Tab */}
            <TabsContent value="agent" className="space-y-4">
              {/* Summary Cards */}
              {agentData?.summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                          <Users className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Agents</p>
                          <p className="text-xl font-bold">{agentData.summary.total_agents}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-100">
                          <Hash className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Transactions</p>
                          <p className="text-xl font-bold">{agentData.summary.total_transactions}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-100">
                          <DollarSign className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Swipe</p>
                          <p className="text-xl font-bold">{formatCurrency(agentData.summary.total_swipe_amount)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-100">
                          <TrendingUp className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Commission</p>
                          <p className="text-xl font-bold">{formatCurrency(agentData.summary.total_commission)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Swipe Amount by Agent</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart 
                    data={agentData?.agents || []} 
                    valueKey="total_swipe_amount" 
                    labelKey="agent_name"
                    color="#3b82f6"
                  />
                </CardContent>
              </Card>
              
              {/* Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Agent Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent Name</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Swipe Amount</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(agentData?.agents || []).map((agent, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{agent.agent_name}</TableCell>
                          <TableCell className="text-right">{agent.transaction_count}</TableCell>
                          <TableCell className="text-right">{formatCurrency(agent.total_swipe_amount)}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">{formatCurrency(agent.total_commission)}</TableCell>
                        </TableRow>
                      ))}
                      {(!agentData?.agents || agentData.agents.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No data available</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Gateway Performance Tab */}
            <TabsContent value="gateway" className="space-y-4">
              {/* Summary Cards */}
              {gatewayData?.summary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-100">
                          <Building2 className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Active Gateways</p>
                          <p className="text-xl font-bold">{gatewayData.summary.total_gateways}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                          <Hash className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Transactions</p>
                          <p className="text-xl font-bold">{gatewayData.summary.total_transactions}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-100">
                          <DollarSign className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Swipe Amount</p>
                          <p className="text-xl font-bold">{formatCurrency(gatewayData.summary.total_swipe_amount)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Swipe Amount by Gateway</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart 
                    data={gatewayData?.gateways || []} 
                    valueKey="total_swipe_amount" 
                    labelKey="gateway_name"
                    color="#8b5cf6"
                  />
                </CardContent>
              </Card>
              
              {/* Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Gateway Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gateway Name</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Total Swipe Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(gatewayData?.gateways || []).map((gw, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{gw.gateway_name}</TableCell>
                          <TableCell className="text-right">{gw.transaction_count}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(gw.total_swipe_amount)}</TableCell>
                        </TableRow>
                      ))}
                      {(!gatewayData?.gateways || gatewayData.gateways.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">No data available</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Profit Tab */}
            <TabsContent value="profit" className="space-y-4">
              {/* Summary Cards */}
              {profitData?.summary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-100">
                          <TrendingUp className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Commission</p>
                          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(profitData.summary.total_commission)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                          <Hash className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Transactions</p>
                          <p className="text-xl font-bold">{profitData.summary.total_transactions}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-100">
                          <DollarSign className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Avg per Transaction</p>
                          <p className="text-xl font-bold">{formatCurrency(profitData.summary.avg_commission_per_txn)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Daily Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Daily Commission</CardTitle>
                </CardHeader>
                <CardContent>
                  <DailyChart 
                    data={profitData?.daily_breakdown || []} 
                    valueKey="commission"
                    color="#10b981"
                  />
                </CardContent>
              </Card>
              
              {/* Gateway Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Commission by Gateway</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart 
                    data={profitData?.gateway_breakdown || []} 
                    valueKey="commission" 
                    labelKey="gateway_name"
                    color="#10b981"
                  />
                </CardContent>
              </Card>
              
              {/* Daily Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(profitData?.daily_breakdown || []).map((day, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{day.date}</TableCell>
                          <TableCell className="text-right">{day.transaction_count}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">{formatCurrency(day.commission)}</TableCell>
                        </TableRow>
                      ))}
                      {(!profitData?.daily_breakdown || profitData.daily_breakdown.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">No data available</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Expenses Tab */}
            <TabsContent value="expenses" className="space-y-4">
              {/* Summary Cards */}
              {expensesData?.summary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-100">
                          <Receipt className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Expenses</p>
                          <p className="text-2xl font-bold text-red-600">{formatCurrency(expensesData.summary.total_expenses)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                          <Hash className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total Count</p>
                          <p className="text-xl font-bold">{expensesData.summary.total_count}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-100">
                          <BarChart3 className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Expense Types</p>
                          <p className="text-xl font-bold">{expensesData.summary.expense_types_count}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Chart by Type */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Expenses by Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart 
                    data={expensesData?.by_type || []} 
                    valueKey="total_amount" 
                    labelKey="type_name"
                    color="#ef4444"
                  />
                </CardContent>
              </Card>
              
              {/* Table by Type */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Breakdown by Expense Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Expense Type</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead className="text-right">Total Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(expensesData?.by_type || []).map((type, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{type.type_name}</TableCell>
                          <TableCell className="text-right">{type.count}</TableCell>
                          <TableCell className="text-right font-medium text-red-600">{formatCurrency(type.total_amount)}</TableCell>
                        </TableRow>
                      ))}
                      {(!expensesData?.by_type || expensesData.by_type.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">No data available</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Monthly P&L Tab */}
            <TabsContent value="monthly-pnl" className="space-y-4" data-testid="monthly-pnl-content">
              {/* Year selector */}
              <div className="flex items-center gap-4">
                <Label className="text-sm font-medium">Year</Label>
                <Select value={String(pnlYear)} onValueChange={(v) => setPnlYear(Number(v))}>
                  <SelectTrigger className="w-[120px]" data-testid="pnl-year-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pnlYears.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => fetchPnlData(pnlYear)} disabled={pnlLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${pnlLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>

              {pnlLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : pnlData ? (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">YTD Volume</p>
                        <p className="text-xl font-bold text-blue-600">{formatCurrency(pnlData.summary.ytd_volume)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{pnlData.summary.ytd_transactions} transactions</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">YTD Commission</p>
                        <p className="text-xl font-bold text-emerald-600">{formatCurrency(pnlData.summary.ytd_commission)}</p>
                        <p className="text-xs text-muted-foreground mt-1">Gross earned</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">YTD PG Charges</p>
                        <p className="text-xl font-bold text-red-500">{formatCurrency(pnlData.summary.ytd_pg_charges)}</p>
                        <p className="text-xs text-muted-foreground mt-1">Cost of processing</p>
                      </CardContent>
                    </Card>
                    <Card className="border-emerald-200 bg-emerald-50/50">
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">YTD Net Profit</p>
                        <p className="text-xl font-bold text-emerald-700">{formatCurrency(pnlData.summary.ytd_net_profit)}</p>
                        <p className="text-xs text-muted-foreground mt-1">After all charges</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Best Month Callout */}
                  {pnlData.summary.best_month && (
                    <Card className="border-amber-200 bg-amber-50/40">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="p-2 rounded-full bg-amber-100">
                          <Star className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-amber-800">Best Month: {pnlData.summary.best_month.month}</p>
                          <p className="text-xs text-amber-700">
                            Net Profit: {formatCurrency(pnlData.summary.best_month.net_profit)} &nbsp;·&nbsp;
                            {pnlData.summary.best_month.transactions} transactions &nbsp;·&nbsp;
                            Volume: {formatCurrency(pnlData.summary.best_month.volume)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Grouped Bar Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Monthly Commission vs PG Charges vs Net Profit</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {pnlData.months.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">No data for {pnlYear}</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={pnlData.months} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                            <Tooltip formatter={(value, name) => [formatCurrency(value), name]} labelFormatter={v => `Month: ${v}`} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="commission" name="Commission" fill="#10b981" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="pg_charges" name="PG Charges" fill="#f87171" radius={[3, 3, 0, 0]} />
                            <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  {/* Monthly Breakdown Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Monthly Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Month</TableHead>
                            <TableHead className="text-right">Transactions</TableHead>
                            <TableHead className="text-right">Volume</TableHead>
                            <TableHead className="text-right">Commission</TableHead>
                            <TableHead className="text-right">PG Charges</TableHead>
                            <TableHead className="text-right">Net Profit</TableHead>
                            <TableHead className="text-right">MoM Growth</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pnlData.months.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No data for {pnlYear}</TableCell>
                            </TableRow>
                          ) : (
                            [...pnlData.months].reverse().map((m) => (
                              <TableRow key={m.month} data-testid={`pnl-row-${m.month}`}>
                                <TableCell className="font-medium">{m.month}</TableCell>
                                <TableCell className="text-right">{m.transactions}</TableCell>
                                <TableCell className="text-right">{formatCurrency(m.volume)}</TableCell>
                                <TableCell className="text-right text-emerald-600">{formatCurrency(m.commission)}</TableCell>
                                <TableCell className="text-right text-red-500">{formatCurrency(m.pg_charges)}</TableCell>
                                <TableCell className="text-right font-semibold">{formatCurrency(m.net_profit)}</TableCell>
                                <TableCell className="text-right">
                                  {m.mom_growth === null ? (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  ) : m.mom_growth >= 0 ? (
                                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 gap-1">
                                      <TrendingUp className="w-3 h-3" />+{m.mom_growth}%
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="bg-red-100 text-red-700 gap-1">
                                      <TrendingDown className="w-3 h-3" />{m.mom_growth}%
                                    </Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <div className="flex items-center justify-center py-20">
                  <p className="text-muted-foreground">Select a year to view Monthly P&L</p>
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
