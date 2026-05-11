import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Building2, CreditCard, Edit, Trash2 } from 'lucide-react';
import TablePagination, { useClientPagination } from '@/components/TablePagination';
import TableSkeleton from '@/components/TableSkeleton';
import { getApiError } from '@/lib/formatters';

export default function BanksAndCardsPage() {
  const { api } = useAuth();
  const [activeTab, setActiveTab] = useState('banks');
  
  // Banks state
  const [banks, setBanks] = useState([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [showBankDialog, setShowBankDialog] = useState(false);
  const [editingBank, setEditingBank] = useState(null);
  const [bankForm, setBankForm] = useState({ name: '', code: '' });

  // Card Networks state
  const [networks, setNetworks] = useState([]);
  const [networksLoading, setNetworksLoading] = useState(true);
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);
  const [editingNetwork, setEditingNetwork] = useState(null);
  const [networkForm, setNetworkForm] = useState({ name: '', code: '' });

  const { paginatedData: paginatedBanks, ...banksPagination } = useClientPagination(banks, 10);
  const { paginatedData: paginatedNetworks, ...networksPagination } = useClientPagination(networks, 10);

  useEffect(() => {
    fetchBanks();
    fetchNetworks();
  }, []);

  // Banks functions
  const fetchBanks = async () => {
    try {
      const response = await api.get('/banks');
      setBanks(response.data);
    } catch (error) {
      toast.error('Failed to load banks');
    } finally {
      setBanksLoading(false);
    }
  };

  const handleBankSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingBank) {
        await api.put(`/banks/${editingBank.id}`, bankForm);
        toast.success('Bank updated successfully');
      } else {
        await api.post('/banks', bankForm);
        toast.success('Bank created successfully');
      }
      setShowBankDialog(false);
      setEditingBank(null);
      setBankForm({ name: '', code: '' });
      fetchBanks();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save bank'));
    }
  };

  const handleEditBank = (bank) => {
    setEditingBank(bank);
    setBankForm({ name: bank.name, code: bank.code || '' });
    setShowBankDialog(true);
  };

  const handleDeleteBank = async (bank) => {
    if (!window.confirm(`Are you sure you want to delete ${bank.name}?`)) return;
    try {
      await api.delete(`/banks/${bank.id}`);
      toast.success('Bank deleted successfully');
      fetchBanks();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete bank'));
    }
  };

  // Card Networks functions
  const fetchNetworks = async () => {
    try {
      const response = await api.get('/card-networks');
      setNetworks(response.data);
    } catch (error) {
      toast.error('Failed to load card networks');
    } finally {
      setNetworksLoading(false);
    }
  };

  const handleNetworkSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingNetwork) {
        await api.put(`/card-networks/${editingNetwork.id}`, networkForm);
        toast.success('Card network updated successfully');
      } else {
        await api.post('/card-networks', networkForm);
        toast.success('Card network created successfully');
      }
      setShowNetworkDialog(false);
      setEditingNetwork(null);
      setNetworkForm({ name: '', code: '' });
      fetchNetworks();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save card network'));
    }
  };

  const handleEditNetwork = (network) => {
    setEditingNetwork(network);
    setNetworkForm({ name: network.name, code: network.code || '' });
    setShowNetworkDialog(true);
  };

  const handleDeleteNetwork = async (network) => {
    if (!window.confirm(`Are you sure you want to delete ${network.name}?`)) return;
    try {
      await api.delete(`/card-networks/${network.id}`);
      toast.success('Card network deleted successfully');
      fetchNetworks();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete card network'));
    }
  };

  return (
    <div className="space-y-6" data-testid="banks-and-cards-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Banks & Cards</h1>
          <p className="text-muted-foreground mt-1">Manage banks and card networks for card categorization</p>
        </div>
        {activeTab === 'banks' ? (
          <Button 
            onClick={() => { setEditingBank(null); setBankForm({ name: '', code: '' }); setShowBankDialog(true); }} 
            data-testid="add-bank-btn"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Bank
          </Button>
        ) : (
          <Button 
            onClick={() => { setEditingNetwork(null); setNetworkForm({ name: '', code: '' }); setShowNetworkDialog(true); }} 
            data-testid="add-network-btn"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Card Network
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="banks" className="flex items-center gap-2" data-testid="banks-tab">
            <Building2 className="w-4 h-4" />
            Banks ({banks.length})
          </TabsTrigger>
          <TabsTrigger value="networks" className="flex items-center gap-2" data-testid="networks-tab">
            <CreditCard className="w-4 h-4" />
            Card Networks ({networks.length})
          </TabsTrigger>
        </TabsList>

        {/* Banks Tab */}
        <TabsContent value="banks" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {banksLoading ? (
                <div className="p-4" data-testid="banks-loading-skeleton">
                  <TableSkeleton rows={4} cols={3} />
                </div>
              ) : banks.length === 0 ? (
                <div className="empty-state py-12">
                  <Building2 className="empty-state-icon" />
                  <p className="empty-state-title">No banks added</p>
                  <p className="empty-state-description">Add banks to categorize customer cards</p>
                </div>
              ) : (
                <>
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bank Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedBanks.map((bank) => (
                      <TableRow key={bank.id} data-testid={`bank-row-${bank.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            {bank.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{bank.code || '-'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleEditBank(bank)} data-testid={`edit-bank-${bank.id}`}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteBank(bank)} data-testid={`delete-bank-${bank.id}`}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
                <TablePagination {...banksPagination} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Card Networks Tab */}
        <TabsContent value="networks" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {networksLoading ? (
                <div className="p-4" data-testid="networks-loading-skeleton">
                  <TableSkeleton rows={4} cols={3} />
                </div>
              ) : networks.length === 0 ? (
                <div className="empty-state py-12">
                  <CreditCard className="empty-state-icon" />
                  <p className="empty-state-title">No card networks added</p>
                  <p className="empty-state-description">Add card networks like Visa, Mastercard, RuPay</p>
                </div>
              ) : (
                <>
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Network Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedNetworks.map((network) => (
                      <TableRow key={network.id} data-testid={`network-row-${network.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-muted-foreground" />
                            {network.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{network.code || '-'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleEditNetwork(network)} data-testid={`edit-network-${network.id}`}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteNetwork(network)} data-testid={`delete-network-${network.id}`}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
                <TablePagination {...networksPagination} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bank Dialog */}
      <Dialog open={showBankDialog} onOpenChange={setShowBankDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBank ? 'Edit Bank' : 'Add Bank'}</DialogTitle>
            <DialogDescription>Enter bank details</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBankSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Bank Name *</Label>
                <Input 
                  value={bankForm.name} 
                  onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} 
                  placeholder="e.g., HDFC Bank" 
                  required 
                  data-testid="bank-name-input" 
                />
              </div>
              <div className="space-y-2">
                <Label>Code</Label>
                <Input 
                  value={bankForm.code} 
                  onChange={(e) => setBankForm({ ...bankForm, code: e.target.value })} 
                  placeholder="e.g., HDFC" 
                  data-testid="bank-code-input" 
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowBankDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-bank-btn">{editingBank ? 'Update' : 'Add'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Card Network Dialog */}
      <Dialog open={showNetworkDialog} onOpenChange={setShowNetworkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingNetwork ? 'Edit Card Network' : 'Add Card Network'}</DialogTitle>
            <DialogDescription>Enter card network details</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNetworkSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Network Name *</Label>
                <Input 
                  value={networkForm.name} 
                  onChange={(e) => setNetworkForm({ ...networkForm, name: e.target.value })} 
                  placeholder="e.g., Visa" 
                  required 
                  data-testid="network-name-input" 
                />
              </div>
              <div className="space-y-2">
                <Label>Code</Label>
                <Input 
                  value={networkForm.code} 
                  onChange={(e) => setNetworkForm({ ...networkForm, code: e.target.value })} 
                  placeholder="e.g., VISA" 
                  data-testid="network-code-input" 
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowNetworkDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-network-btn">{editingNetwork ? 'Update' : 'Add'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
