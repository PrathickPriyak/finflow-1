import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Search, Users, AlertTriangle, Phone, Edit, Trash2, Eye, CreditCard, FileText, Clock, User, ChevronLeft, ChevronRight, CheckCircle2, Percent } from 'lucide-react';
import { formatDate , getApiError } from '@/lib/formatters';
import TableSkeleton from '@/components/TableSkeleton';
import { EmptyState } from '@/components/ui/empty-state';

// UX-01: Table skeleton moved to shared component — imported above

export default function CustomersPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    id_proof: '',
    charge_note: '',
    notes: '',
  });
  
  // Pagination
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(10);
  
  // View details dialog
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  
  // Delete confirmation dialog (UX-02)
  const [customerToDelete, setCustomerToDelete] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  // UX-05: Use ref for search debounce instead of window namespace
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async (searchTerm = '', page = 1) => {
    try {
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', pageSize.toString());
      if (searchTerm) params.append('search', searchTerm);
      
      const response = await api.get(`/customers?${params.toString()}`);
      if (response.data.data) {
        setCustomers(response.data.data);
        setPagination(response.data.pagination);
      } else {
        setCustomers(response.data);
      }
    } catch (error) {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  };
  
  const handlePageSizeChange = (newSize) => {
    setPageSize(parseInt(newSize));
    fetchCustomers(search, 1);
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearch(value);
    // UX-05: Use ref instead of window namespace to avoid global pollution
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchCustomers(value, 1);
    }, 300);
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      fetchCustomers(search, newPage);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingCustomer) {
        await api.put(`/customers/${editingCustomer.id}`, formData);
        toast.success('Customer updated successfully');
      } else {
        await api.post('/customers', formData);
        toast.success('Customer created successfully');
      }
      setShowDialog(false);
      setEditingCustomer(null);
      setFormData({ name: '', phone: '', id_proof: '', charge_note: '', notes: '' });
      fetchCustomers(search);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save customer'));
    }
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      phone: customer.phone,
      id_proof: customer.id_proof || '',
      charge_note: customer.charge_note || '',
      notes: customer.notes || '',
    });
    setShowDialog(true);
  };

  const handleDelete = async (customer) => {
    setCustomerToDelete(customer);
    setShowDeleteDialog(true);
  };
  
  const confirmDelete = async () => {
    if (!customerToDelete) return;
    
    setDeleting(true);
    try {
      await api.delete(`/customers/${customerToDelete.id}`);
      toast.success('Customer deleted successfully');
      setShowDeleteDialog(false);
      setCustomerToDelete(null);
      fetchCustomers(search);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete customer'));
    } finally {
      setDeleting(false);
    }
  };

  const viewCustomer = (customer) => {
    navigate(`/customers/${customer.id}`);
  };

  return (
    <div className="space-y-6" data-testid="customers-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="text-muted-foreground mt-1">Manage your customers and their cards</p>
        </div>
        <Button onClick={() => { setEditingCustomer(null); setFormData({ name: '', phone: '', id_proof: '', charge_note: '', notes: '' }); setShowDialog(true); }} data-testid="add-customer-btn">
          <Plus className="w-4 h-4 mr-2" />
          Add Customer
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by phone number..."
              value={search}
              onChange={handleSearch}
              className="pl-10"
              data-testid="search-input"
            />
          </div>
        </CardContent>
      </Card>

      {/* Customers Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4" data-testid="customers-loading-skeleton">
              <TableSkeleton rows={5} cols={6} />
            </div>
          ) : customers.length === 0 ? (
            <EmptyState
              icon="customers"
              title={search ? "No results found" : "No customers yet"}
              description={search ? `No customers match "${search}". Try a different search term.` : "Add your first customer to start managing their cards and transactions."}
              action={!search}
              actionLabel="Add Customer"
              onAction={() => setShowDialog(true)}
            />
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]" aria-label="Customers table">
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Cards</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow 
                    key={customer.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => viewCustomer(customer)}
                    data-testid={`customer-row-${customer.id}`}
                  >
                    <TableCell>
                      <code className="px-2 py-1 rounded bg-muted text-xs font-mono">
                        {customer.customer_id || '-'}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {customer.is_blacklisted && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="font-medium">{customer.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="w-4 h-4" />
                        {customer.phone}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary">{customer.cards?.length || 0} cards</Badge>
                    </TableCell>
                    <TableCell>
                      {customer.is_blacklisted ? (
                        <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Blacklisted
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); viewCustomer(customer); }}
                          data-testid={`view-${customer.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); handleEdit(customer); }}
                          data-testid={`edit-${customer.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); handleDelete(customer); }}
                          data-testid={`delete-${customer.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
          
          {/* Pagination */}
          {pagination.total > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pageSize) + 1} to {Math.min(pagination.page * pageSize, pagination.total)} of {pagination.total}
                </p>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[100px] h-8" data-testid="customers-page-size">
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
                    data-testid="customers-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    data-testid="customers-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? 'Update customer information' : 'Enter customer details'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Customer name"
                  required
                  data-testid="customer-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="10-digit mobile number"
                  required
                  data-testid="customer-phone-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="id_proof">ID Proof</Label>
                <Input
                  id="id_proof"
                  value={formData.id_proof}
                  onChange={(e) => setFormData({ ...formData, id_proof: e.target.value })}
                  placeholder="Aadhaar / PAN / Driving License"
                  data-testid="customer-id-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="charge_note">Charge % Note</Label>
                <Input
                  id="charge_note"
                  value={formData.charge_note}
                  onChange={(e) => setFormData({ ...formData, charge_note: e.target.value })}
                  placeholder="e.g., 5% standard, 3% VIP rate"
                  data-testid="customer-charge-note-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Any additional notes"
                  data-testid="customer-notes-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" data-testid="save-customer-btn">
                {editingCustomer ? 'Update' : 'Add'} Customer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Customer Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Customer Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedCustomer && (
            <div className="space-y-4">
              {/* Customer Info */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xl font-semibold">{selectedCustomer.name}</p>
                  {selectedCustomer.is_blacklisted ? (
                    <Badge variant="destructive">Blacklisted</Badge>
                  ) : (
                    <Badge className="status-active">Active</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-4 h-4" />
                  <span>{selectedCustomer.phone}</span>
                </div>
              </div>

              {/* ID Proof */}
              {selectedCustomer.id_proof && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">ID Proof</span>
                  </div>
                  <p className="text-muted-foreground">{selectedCustomer.id_proof}</p>
                </div>
              )}

              {/* Charge Note */}
              {selectedCustomer.charge_note && (
                <div className="px-4 py-3 rounded-lg bg-blue-50 border border-blue-200" data-testid="customer-charge-note-display">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">Charge Note:</span>
                    <span className="text-sm text-blue-700">{selectedCustomer.charge_note}</span>
                  </div>
                </div>
              )}

              {/* Cards */}
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">Registered Cards</span>
                  <Badge variant="secondary">{selectedCustomer.cards?.length || 0}</Badge>
                </div>
                {selectedCustomer.cards && selectedCustomer.cards.length > 0 ? (
                  <div className="space-y-2">
                    {selectedCustomer.cards.map((card, index) => (
                      <div key={index} className="p-2 bg-muted/30 rounded text-sm">
                        {card.card_last_four ? `**** ${card.card_last_four}` : card.description || `Card ${index + 1}`}
                        {card.bank && <span className="text-muted-foreground ml-2">({card.bank})</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No cards registered</p>
                )}
              </div>

              {/* Notes */}
              {selectedCustomer.notes && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p>{selectedCustomer.notes}</p>
                </div>
              )}

              {/* Meta Info */}
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Created: {formatDate(selectedCustomer.created_at)}</span>
                </div>
              </div>

              {/* Action to navigate to full detail page */}
              <div className="pt-2">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => { setShowViewDialog(false); navigate(`/customers/${selectedCustomer.id}`); }}
                >
                  View Full Profile & Transactions
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog (UX-02) */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{customerToDelete?.name}</strong>? 
              This action cannot be undone. All associated data including cards and transaction history 
              references will be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-customer"
            >
              {deleting ? 'Deleting...' : 'Delete Customer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
