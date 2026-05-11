import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Plus, Server, Edit, Trash2, ArrowLeft, Percent, Eye, Clock, Info } from 'lucide-react';
import { formatDate , getApiError } from '@/lib/formatters';


export default function GatewayServersPage() {
  const { api } = useAuth();
  const { gatewayId } = useParams();
  const navigate = useNavigate();
  const [gateway, setGateway] = useState(null);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    charge_percentage: '',
  });
  
  // View details dialog
  const [selectedServer, setSelectedServer] = useState(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  
  // Delete confirmation dialog (UX-02)
  const [serverToDelete, setServerToDelete] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [gatewayId]);

  const fetchData = async () => {
    try {
      if (gatewayId) {
        // Gateway-specific servers
        const response = await api.get(`/gateways/${gatewayId}/servers`);
        setGateway(response.data.gateway);
        setServers(response.data.servers);
      } else {
        // All servers (standalone mode)
        const response = await api.get('/gateway-servers');
        setServers(response.data);
        setGateway(null);
      }
    } catch (error) {
      toast.error('Failed to load servers');
      if (gatewayId) navigate('/gateways');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = {
        name: formData.name,
        charge_percentage: parseFloat(formData.charge_percentage),
      };

      if (editingServer) {
        await api.put(`/gateways/${gatewayId}/servers/${editingServer.id}`, data);
        toast.success('Server updated successfully');
      } else {
        await api.post(`/gateways/${gatewayId}/servers`, data);
        toast.success('Server created successfully');
      }
      setShowDialog(false);
      setEditingServer(null);
      setFormData({ name: '', charge_percentage: '' });
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save server'));
    }
  };

  const handleEdit = (server) => {
    setEditingServer(server);
    setFormData({
      name: server.name,
      charge_percentage: server.charge_percentage.toString(),
    });
    setShowDialog(true);
  };

  const handleDelete = async (server) => {
    setServerToDelete(server);
    setShowDeleteDialog(true);
  };
  
  const confirmDelete = async () => {
    if (!serverToDelete) return;
    
    setDeleting(true);
    try {
      await api.delete(`/gateways/${gatewayId}/servers/${serverToDelete.id}`);
      toast.success('Server deleted successfully');
      setShowDeleteDialog(false);
      setServerToDelete(null);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete server'));
    } finally {
      setDeleting(false);
    }
  };

  const toggleActive = async (server) => {
    try {
      await api.put(`/gateways/${gatewayId}/servers/${server.id}`, { is_active: !server.is_active });
      toast.success(`Server ${server.is_active ? 'deactivated' : 'activated'}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update server');
    }
  };

  const viewServer = (server) => {
    setSelectedServer(server);
    setShowViewDialog(true);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton rounded" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 skeleton rounded" />)}
        </div>
      </div>
    );
  }

  // Standalone mode (all servers)
  const isStandaloneMode = !gatewayId;

  return (
    <div className="space-y-6" data-testid="gateway-servers-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        {!isStandaloneMode && (
          <Button variant="ghost" size="icon" onClick={() => navigate('/gateways')} data-testid="back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <div className="flex-1">
          <h1 className="page-title">{isStandaloneMode ? 'Gateway Servers' : `${gateway?.name} - Servers`}</h1>
          <p className="text-muted-foreground mt-1">
            {isStandaloneMode ? 'View all gateway servers and their charge percentages' : 'Manage processing servers and their charge percentages'}
          </p>
        </div>
        {!isStandaloneMode && (
          <Button onClick={() => { setEditingServer(null); setFormData({ name: '', charge_percentage: '' }); setShowDialog(true); }} data-testid="add-server-btn">
            <Plus className="w-4 h-4 mr-2" />
            Add Server
          </Button>
        )}
      </div>

      {/* Servers Table */}
      <Card>
        <CardContent className="p-0">
          {servers.length === 0 ? (
            <div className="empty-state py-12">
              <Server className="empty-state-icon" />
              <p className="empty-state-title">No servers configured</p>
              <p className="empty-state-description">{isStandaloneMode ? 'No gateway servers found' : 'Add servers with their charge percentages to start processing transactions'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Server Name</TableHead>
                  {isStandaloneMode && <TableHead>Gateway</TableHead>}
                  <TableHead className="text-right">Charge %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow 
                    key={server.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => viewServer(server)}
                    data-testid={`server-row-${server.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Server className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{server.name}</span>
                      </div>
                    </TableCell>
                    {isStandaloneMode && (
                      <TableCell>
                        <span className="text-muted-foreground">{server.gateway_name || '-'}</span>
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Badge variant="outline" className="text-lg font-bold">
                        {server.charge_percentage}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={server.is_active !== false}
                          onCheckedChange={() => !isStandaloneMode && toggleActive(server)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={isStandaloneMode}
                          data-testid={`toggle-${server.id}`}
                        />
                        <Badge className={server.is_active !== false ? 'status-active' : 'status-inactive'}>
                          {server.is_active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => { e.stopPropagation(); viewServer(server); }} 
                        data-testid={`view-${server.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {!isStandaloneMode && (
                        <>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={(e) => { e.stopPropagation(); handleEdit(server); }} 
                            data-testid={`edit-${server.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={(e) => { e.stopPropagation(); handleDelete(server); }} 
                            data-testid={`delete-${server.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog - only for gateway-specific mode */}
      {!isStandaloneMode && (
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingServer ? 'Edit Server' : 'Add Server'}</DialogTitle>
            <DialogDescription>Configure server name and charge percentage</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Server Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Server01, Premium, Standard"
                  required
                  data-testid="server-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label>Charge Percentage (%) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formData.charge_percentage}
                  onChange={(e) => setFormData({ ...formData, charge_percentage: e.target.value })}
                  placeholder="e.g., 2.0, 2.4, 3.5"
                  required
                  data-testid="charge-percentage-input"
                />
                <p className="text-xs text-muted-foreground">
                  This is the gateway processing fee for transactions on this server
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-server-btn">{editingServer ? 'Update' : 'Add'} Server</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      )}

      {/* View Server Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              Server Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedServer && (
            <div className="space-y-4">
              {/* Server Info */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xl font-semibold">{selectedServer.name}</p>
                  <Badge className={selectedServer.is_active !== false ? 'status-active' : 'status-inactive'}>
                    {selectedServer.is_active !== false ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <p className="text-muted-foreground">Gateway: {gateway?.name}</p>
              </div>

              {/* Charge Percentage */}
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Percent className="w-4 h-4 text-blue-600" />
                  <span className="font-medium text-blue-700">Charge Percentage</span>
                </div>
                <p className="text-3xl font-bold text-blue-700">{selectedServer.charge_percentage}%</p>
                <p className="text-sm text-blue-600 mt-1">Gateway processing fee per transaction</p>
              </div>

              {/* Meta Info */}
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Created: {formatDate(selectedServer.created_at)}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog (UX-02) */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
              onClick={confirmDelete}
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
