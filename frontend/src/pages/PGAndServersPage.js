import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Landmark, Server, Edit, Trash2, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate , getApiError } from '@/lib/formatters';
import TablePagination, { useClientPagination } from '@/components/TablePagination';

export default function PGAndServersPage() {
  const { api } = useAuth();

  // Gateways state
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGatewayDialog, setShowGatewayDialog] = useState(false);
  const [editingGateway, setEditingGateway] = useState(null);
  const [gatewayForm, setGatewayForm] = useState({ name: '', description: '', wallet_balance: '' });

  // Servers panel state
  const [selectedGateway, setSelectedGateway] = useState(null);
  const [showServersPanel, setShowServersPanel] = useState(false);
  const [servers, setServers] = useState([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [showServerDialog, setShowServerDialog] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [serverForm, setServerForm] = useState({ name: '', charge_percentage: '' });

  const { paginatedData: paginatedGateways, ...gatewaysPagination } = useClientPagination(gateways, 10);
  const { paginatedData: paginatedServers, ...serversPagination } = useClientPagination(servers, 10);

  // Delete confirmation dialogs (UX-02)
  const [gatewayToDelete, setGatewayToDelete] = useState(null);
  const [showDeleteGatewayDialog, setShowDeleteGatewayDialog] = useState(false);
  const [serverToDelete, setServerToDelete] = useState(null);
  const [showDeleteServerDialog, setShowDeleteServerDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchGateways();
  }, []);

  // ==================== GATEWAYS ====================
  const fetchGateways = async () => {
    try {
      const response = await api.get('/gateways');
      // Backend already returns servers[] for each gateway — use it, no extra calls needed
      const gatewaysWithCounts = response.data.map(gw => ({
        ...gw,
        serverCount: gw.servers?.length || 0,
      }));
      setGateways(gatewaysWithCounts);
    } catch (error) {
      toast.error('Failed to load gateways');
    } finally {
      setLoading(false);
    }
  };

  const handleGatewaySubmit = async (e) => {
    e.preventDefault();
    try {
      const data = {
        name: gatewayForm.name,
        description: gatewayForm.description,
        wallet_balance: parseFloat(gatewayForm.wallet_balance) || 0,
      };

      if (editingGateway) {
        await api.put(`/gateways/${editingGateway.id}`, { name: data.name, description: data.description });
        toast.success('Gateway updated successfully');
      } else {
        await api.post('/gateways', data);
        toast.success('Gateway created successfully');
      }
      setShowGatewayDialog(false);
      setEditingGateway(null);
      setGatewayForm({ name: '', description: '', wallet_balance: '' });
      fetchGateways();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save gateway'));
    }
  };

  const handleEditGateway = (gateway, e) => {
    e?.stopPropagation();
    setEditingGateway(gateway);
    setGatewayForm({
      name: gateway.name,
      description: gateway.description || '',
      wallet_balance: gateway.wallet_balance?.toString() || '0',
    });
    setShowGatewayDialog(true);
  };

  const handleDeleteGateway = async (gateway, e) => {
    e?.stopPropagation();
    setGatewayToDelete(gateway);
    setShowDeleteGatewayDialog(true);
  };
  
  const confirmDeleteGateway = async () => {
    if (!gatewayToDelete) return;
    
    setDeleting(true);
    try {
      await api.delete(`/gateways/${gatewayToDelete.id}`);
      toast.success('Gateway deleted successfully');
      setShowDeleteGatewayDialog(false);
      setGatewayToDelete(null);
      fetchGateways();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete gateway'));
    } finally {
      setDeleting(false);
    }
  };

  const toggleGatewayActive = async (gateway, e) => {
    e?.stopPropagation();
    try {
      await api.put(`/gateways/${gateway.id}`, { is_active: !gateway.is_active });
      toast.success(`Gateway ${gateway.is_active ? 'deactivated' : 'activated'}`);
      fetchGateways();
    } catch (error) {
      toast.error('Failed to update gateway');
    }
  };

  // ==================== SERVERS ====================
  const openServersPanel = async (gateway) => {
    setSelectedGateway(gateway);
    setShowServersPanel(true);
    setServersLoading(true);
    try {
      const res = await api.get(`/gateways/${gateway.id}/servers`);
      setServers(res.data.servers || []);
    } catch (error) {
      toast.error('Failed to load servers');
      setServers([]);
    } finally {
      setServersLoading(false);
    }
  };

  const handleServerSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingServer) {
        await api.put(`/gateway-servers/${editingServer.id}`, {
          name: serverForm.name,
          charge_percentage: parseFloat(serverForm.charge_percentage),
        });
        toast.success('Server updated successfully');
      } else {
        await api.post(`/gateways/${selectedGateway.id}/servers`, {
          name: serverForm.name,
          charge_percentage: parseFloat(serverForm.charge_percentage),
        });
        toast.success('Server created successfully');
      }
      setShowServerDialog(false);
      setEditingServer(null);
      setServerForm({ name: '', charge_percentage: '' });
      // Refresh servers
      const res = await api.get(`/gateways/${selectedGateway.id}/servers`);
      setServers(res.data.servers || []);
      fetchGateways(); // Update server counts
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save server'));
    }
  };

  const handleEditServer = (server) => {
    setEditingServer(server);
    setServerForm({
      name: server.name,
      charge_percentage: server.charge_percentage?.toString() || '',
    });
    setShowServerDialog(true);
  };

  const handleDeleteServer = async (server) => {
    setServerToDelete(server);
    setShowDeleteServerDialog(true);
  };
  
  const confirmDeleteServer = async () => {
    if (!serverToDelete) return;
    
    setDeleting(true);
    try {
      await api.delete(`/gateway-servers/${serverToDelete.id}`);
      toast.success('Server deleted successfully');
      setShowDeleteServerDialog(false);
      setServerToDelete(null);
      const res = await api.get(`/gateways/${selectedGateway.id}/servers`);
      setServers(res.data.servers || []);
      fetchGateways(); // Update server counts
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete server'));
    } finally {
      setDeleting(false);
    }
  };

  const toggleServerActive = async (server) => {
    try {
      await api.put(`/gateway-servers/${server.id}`, { is_active: !server.is_active });
      toast.success(`Server ${server.is_active ? 'deactivated' : 'activated'}`);
      const res = await api.get(`/gateways/${selectedGateway.id}/servers`);
      setServers(res.data.servers || []);
    } catch (error) {
      toast.error('Failed to update server');
    }
  };

  const totalBalance = gateways.reduce((sum, g) => sum + (g.wallet_balance || 0), 0);

  return (
    <div className="space-y-6" data-testid="pg-and-servers-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payment Gateways</h1>
          <p className="text-muted-foreground mt-1">Manage payment gateways and their processing servers</p>
        </div>
        <div className="flex items-center gap-4">
          <Card className="p-4 hidden md:block">
            <p className="text-sm text-muted-foreground">Total Balance</p>
            <p className="text-xl font-bold">{formatCurrency(totalBalance)}</p>
          </Card>
          <Button onClick={() => { setEditingGateway(null); setGatewayForm({ name: '', description: '', wallet_balance: '' }); setShowGatewayDialog(true); }} data-testid="add-gateway-btn">
            <Plus className="w-4 h-4 mr-2" />
            Add Gateway
          </Button>
        </div>
      </div>

      {/* Gateways List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 skeleton rounded" />)}
            </div>
          ) : gateways.length === 0 ? (
            <div className="empty-state py-12">
              <Landmark className="empty-state-icon" />
              <p className="empty-state-title">No gateways added</p>
              <p className="empty-state-description">Add your first payment gateway to get started</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Servers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Wallet Balance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedGateways.map((gateway) => (
                  <TableRow key={gateway.id} data-testid={`gateway-row-${gateway.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${gateway.wallet_balance > 100000 ? 'bg-emerald-500' : gateway.wallet_balance > 10000 ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <div>
                          <p className="font-medium">{gateway.name}</p>
                          <p className="text-xs text-muted-foreground">Created {formatDate(gateway.created_at)}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{gateway.description || '-'}</TableCell>
                    <TableCell className="text-center">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => openServersPanel(gateway)}
                        className="gap-2"
                        data-testid={`view-servers-${gateway.id}`}
                      >
                        <Server className="w-4 h-4" />
                        {gateway.serverCount || 0} Servers
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch 
                          checked={gateway.is_active} 
                          onCheckedChange={(e) => toggleGatewayActive(gateway, e)} 
                          data-testid={`toggle-gateway-${gateway.id}`} 
                        />
                        <Badge className={gateway.is_active ? 'status-active' : 'status-inactive'}>
                          {gateway.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <p className="font-semibold">{formatCurrency(gateway.wallet_balance || 0)}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={(e) => handleEditGateway(gateway, e)} title="Edit">
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => handleDeleteGateway(gateway, e)} title="Delete">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <TablePagination {...gatewaysPagination} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Gateway Add/Edit Dialog */}
      <Dialog open={showGatewayDialog} onOpenChange={setShowGatewayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGateway ? 'Edit Gateway' : 'Add Gateway'}</DialogTitle>
            <DialogDescription>{editingGateway ? 'Update gateway information' : 'Add a new payment gateway'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGatewaySubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Gateway Name *</Label>
                <Input value={gatewayForm.name} onChange={(e) => setGatewayForm({ ...gatewayForm, name: e.target.value })} placeholder="e.g., Razorpay, PayTM" required data-testid="gateway-name-input" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={gatewayForm.description} onChange={(e) => setGatewayForm({ ...gatewayForm, description: e.target.value })} placeholder="Optional description" data-testid="gateway-description-input" />
              </div>
              {!editingGateway && (
                <div className="space-y-2">
                  <Label>Initial Wallet Balance (₹)</Label>
                  <Input type="number" value={gatewayForm.wallet_balance} onChange={(e) => setGatewayForm({ ...gatewayForm, wallet_balance: e.target.value })} placeholder="0" data-testid="gateway-balance-input" />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowGatewayDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-gateway-btn">{editingGateway ? 'Update' : 'Add'} Gateway</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Servers Panel Dialog */}
      <Dialog open={showServersPanel} onOpenChange={setShowServersPanel}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Landmark className="w-5 h-5" />
                  {selectedGateway?.name} - Servers
                </DialogTitle>
                <DialogDescription>Manage processing servers for this gateway</DialogDescription>
              </div>
              <Button 
                size="sm" 
                onClick={() => { setEditingServer(null); setServerForm({ name: '', charge_percentage: '' }); setShowServerDialog(true); }}
                data-testid="add-server-btn"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Server
              </Button>
            </div>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto mt-4">
            {serversLoading ? (
              <div className="p-8 space-y-4">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 skeleton rounded" />)}
              </div>
            ) : servers.length === 0 ? (
              <div className="text-center py-12">
                <Server className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="font-medium">No servers configured</p>
                <p className="text-sm text-muted-foreground mt-1">Add servers with their charge percentages</p>
              </div>
            ) : (
              <>
              <div className="overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Server Name</TableHead>
                    <TableHead className="text-right">Charge %</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedServers.map((server) => (
                    <TableRow key={server.id} data-testid={`server-row-${server.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{server.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-base font-bold px-3">
                          {server.charge_percentage}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch 
                            checked={server.is_active !== false} 
                            onCheckedChange={() => toggleServerActive(server)}
                            data-testid={`toggle-server-${server.id}`} 
                          />
                          <Badge className={server.is_active !== false ? 'status-active' : 'status-inactive'}>
                            {server.is_active !== false ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEditServer(server)} title="Edit">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteServer(server)} title="Delete">
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              <TablePagination {...serversPagination} />
              </>
            )}
          </div>

          {/* Gateway info footer */}
          {selectedGateway && (
            <div className="flex-shrink-0 pt-4 mt-4 border-t flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Wallet Balance: <strong className="text-foreground text-base">{formatCurrency(selectedGateway.wallet_balance || 0)}</strong>
              </span>
              <span className="text-muted-foreground">
                {servers.length} server{servers.length !== 1 ? 's' : ''} configured
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Server Add/Edit Dialog */}
      <Dialog open={showServerDialog} onOpenChange={setShowServerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingServer ? 'Edit Server' : 'Add Server'}</DialogTitle>
            <DialogDescription>
              {editingServer ? 'Update server information' : `Add a new server to ${selectedGateway?.name}`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleServerSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Server Name *</Label>
                <Input 
                  value={serverForm.name} 
                  onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })} 
                  placeholder="e.g., Server01, FastPay" 
                  required 
                  data-testid="server-name-input" 
                />
              </div>
              <div className="space-y-2">
                <Label>Charge Percentage (%) *</Label>
                <Input 
                  type="number" 
                  step="0.1" 
                  value={serverForm.charge_percentage} 
                  onChange={(e) => setServerForm({ ...serverForm, charge_percentage: e.target.value })} 
                  placeholder="e.g., 2.0, 2.5" 
                  required 
                  data-testid="server-charge-input" 
                />
                <p className="text-xs text-muted-foreground">This is the gateway processing fee for transactions on this server</p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowServerDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-server-btn">{editingServer ? 'Update' : 'Add'} Server</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Gateway Confirmation Dialog (UX-02) */}
      <AlertDialog open={showDeleteGatewayDialog} onOpenChange={setShowDeleteGatewayDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{gatewayToDelete?.name}</strong>? 
              This will also delete all its servers and the associated wallet. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteGateway}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-gateway"
            >
              {deleting ? 'Deleting...' : 'Delete Gateway'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Server Confirmation Dialog (UX-02) */}
      <AlertDialog open={showDeleteServerDialog} onOpenChange={setShowDeleteServerDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Gateway Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{serverToDelete?.name}</strong>? 
              This server will no longer be available for new transactions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteServer}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-server"
            >
              {deleting ? 'Deleting...' : 'Delete Server'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
