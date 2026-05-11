import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ScrollText, Filter, Download, Eye, Clock, User, Activity, Globe, FileText } from 'lucide-react';
import { formatDate } from '@/lib/formatters';


// Detail Dialog for viewing full audit log details
const AuditLogDetailDialog = ({ open, onClose, log }) => {
  if (!log) return null;
  
  const hasDetails = log.details && Object.keys(log.details).length > 0;
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="w-5 h-5" />
            Audit Log Details
          </DialogTitle>
          <DialogDescription>
            {formatDate(log.timestamp)}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <User className="w-3 h-3" />
                User
              </div>
              <p className="font-medium">{log.user_name}</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Activity className="w-3 h-3" />
                Action
              </div>
              <Badge className={getActionColorClass(log.action)}>{log.action}</Badge>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <FileText className="w-3 h-3" />
                Module
              </div>
              <p className="font-medium capitalize">{log.module}</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Globe className="w-3 h-3" />
                IP Address
              </div>
              <p className="font-medium font-mono text-sm">{log.ip_address || 'N/A'}</p>
            </div>
          </div>
          
          {/* Entity ID */}
          {log.entity_id && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-muted-foreground text-xs mb-1">Entity ID</div>
              <p className="font-mono text-sm">{log.entity_id}</p>
            </div>
          )}
          
          {/* Details */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-muted-foreground text-xs mb-2">Details</div>
            {hasDetails ? (
              <div className="space-y-2">
                {Object.entries(log.details).map(([key, value]) => (
                  <div key={key} className="flex justify-between items-start py-1 border-b border-border/50 last:border-0">
                    <span className="text-sm text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-medium text-right max-w-[60%] break-words">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No additional details recorded</p>
            )}
          </div>
          
          {/* Timestamp */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Logged at: {formatDate(log.timestamp)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Helper function for action colors (used in both table and dialog)
const getActionColorClass = (action) => {
  switch (action) {
    case 'create': return 'bg-emerald-100 text-emerald-700';
    case 'update': return 'bg-blue-100 text-blue-700';
    case 'delete': return 'bg-red-100 text-red-700';
    case 'login': return 'bg-purple-100 text-purple-700';
    case 'logout': return 'bg-slate-100 text-slate-700';
    case 'run': return 'bg-amber-100 text-amber-700';
    case 'sync_counters': return 'bg-cyan-100 text-cyan-700';
    case 'system_reset': return 'bg-red-100 text-red-700';
    case 'balance_adjustment': return 'bg-indigo-100 text-indigo-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};


export default function AuditLogPage() {
  const { api } = useAuth();
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [filters, setFilters] = useState({
    user_id: '',
    module: '',
    action: '',
    date_from: '',
    date_to: '',
  });
  
  // Pagination
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(10);

  const modules = ['auth', 'customers', 'transactions', 'gateways', 'banks', 'card_networks', 'payments', 'collections', 'adjustments', 'users', 'roles', 'settings', 'daily_closing', 'reconciliation', 'data_integrity', 'admin', 'wallets', 'expenses'];
  const actions = ['create', 'update', 'delete', 'login', 'logout', 'wallet_operation', 'settle', 'add_card', 'remove_card', 'run', 'verify_checksums', 'sync_counters', 'system_reset', 'add_checksums', 'balance_adjustment'];

  useEffect(() => {
    fetchData();
  }, [pageSize]);

  const fetchData = async (page = 1) => {
    try {
      const [logsRes, usersRes] = await Promise.all([
        api.get(`/audit-logs?page=${page}&limit=${pageSize}`),
        api.get('/users'),
      ]);
      if (logsRes.data?.data) {
        setLogs(logsRes.data.data);
        setPagination(logsRes.data.pagination || { page, total: logsRes.data.data.length, pages: 1 });
      } else {
        setLogs(logsRes.data);
        setPagination({ page: 1, total: logsRes.data.length, pages: 1 });
      }
      const usersData = usersRes.data?.data || usersRes.data;
      setUsers(usersData);
    } catch (error) {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };
  
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      fetchData(newPage);
    }
  };
  
  const handlePageSizeChange = (newSize) => {
    setPageSize(parseInt(newSize));
  };

  const applyFilters = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', pageSize.toString());
      if (filters.user_id && filters.user_id !== 'all') params.append('user_id', filters.user_id);
      if (filters.module && filters.module !== 'all') params.append('module', filters.module);
      if (filters.action && filters.action !== 'all') params.append('action', filters.action);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);

      const response = await api.get(`/audit-logs?${params.toString()}`);
      if (response.data?.data) {
        setLogs(response.data.data);
        setPagination(response.data.pagination || { page, total: response.data.data.length, pages: 1 });
      } else {
        setLogs(response.data);
        setPagination({ page: 1, total: response.data.length, pages: 1 });
      }
    } catch (error) {
      toast.error('Failed to filter logs');
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setFilters({ user_id: '', module: '', action: '', date_from: '', date_to: '' });
    fetchData(1);
  };

  // Format details for display in table
  const formatDetailsPreview = (details) => {
    if (!details || Object.keys(details).length === 0) {
      return <span className="text-muted-foreground italic">-</span>;
    }
    const entries = Object.entries(details).slice(0, 2);
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ') + (Object.keys(details).length > 2 ? '...' : '');
  };

  return (
    <div className="space-y-6" data-testid="audit-log-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="text-muted-foreground mt-1">Track all system activities and changes</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <SearchableSelect
              value={filters.user_id}
              onValueChange={(v) => setFilters({ ...filters, user_id: v })}
              placeholder="Search users..."
              allOption="All Users"
              items={users.map(u => ({ value: u.id, label: u.name }))}
              className="w-full md:w-40"
              triggerTestId="user-filter"
            />

            <SearchableSelect
              value={filters.module}
              onValueChange={(v) => setFilters({ ...filters, module: v })}
              placeholder="Search modules..."
              allOption="All Modules"
              items={modules.map(m => ({ value: m, label: m }))}
              className="w-full md:w-40"
              triggerTestId="module-filter"
            />

            <SearchableSelect
              value={filters.action}
              onValueChange={(v) => setFilters({ ...filters, action: v })}
              placeholder="Search actions..."
              allOption="All Actions"
              items={actions.map(a => ({ value: a, label: a }))}
              className="w-full md:w-40"
              triggerTestId="action-filter"
            />

            <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className="w-full md:w-40" data-testid="date-from" />
            <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className="w-full md:w-40" data-testid="date-to" />

            <div className="flex gap-2">
              <Button onClick={applyFilters} data-testid="apply-filters-btn">
                <Filter className="w-4 h-4 mr-2" />
                Apply
              </Button>
              <Button variant="outline" onClick={clearFilters} data-testid="clear-filters-btn">
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 skeleton rounded" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="empty-state py-12">
              <ScrollText className="empty-state-icon" />
              <p className="empty-state-title">No audit logs found</p>
              <p className="empty-state-description">System activities will be recorded here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead className="w-[80px]">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow 
                      key={log.id} 
                      data-testid={`log-row-${log.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="whitespace-nowrap">{formatDate(log.timestamp)}</TableCell>
                      <TableCell className="font-medium">{log.user_name}</TableCell>
                      <TableCell>
                        <Badge className={getActionColorClass(log.action)}>{log.action}</Badge>
                      </TableCell>
                      <TableCell className="capitalize">{log.module}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                        {formatDetailsPreview(log.details)}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{log.ip_address || '-'}</TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* Pagination */}
          {logs.length > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pageSize) + 1} to {Math.min(pagination.page * pageSize, pagination.total)} of {pagination.total}
                </p>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[100px] h-8" data-testid="audit-page-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / page</SelectItem>
                    <SelectItem value="25">25 / page</SelectItem>
                    <SelectItem value="50">50 / page</SelectItem>
                    <SelectItem value="100">100 / page</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {pagination.pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    data-testid="audit-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    data-testid="audit-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Detail Dialog */}
      <AuditLogDetailDialog 
        open={!!selectedLog} 
        onClose={() => setSelectedLog(null)} 
        log={selectedLog}
      />
    </div>
  );
}
