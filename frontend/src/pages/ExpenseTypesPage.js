import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { 
  Tag, Plus, Trash2, Loader2, Pencil, Zap, AlertTriangle
} from 'lucide-react';
import { formatDate , getApiError } from '@/lib/formatters';
import TablePagination, { useClientPagination } from '@/components/TablePagination';

export default function ExpenseTypesPage() {
  const { api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [expenseCounts, setExpenseCounts] = useState({});
  
  // Add/Edit Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  
  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [typesRes, expensesRes] = await Promise.all([
        api.get('/expense-types'),
        api.get('/expenses?limit=100')
      ]);
      
      setExpenseTypes(typesRes.data);
      
      // Count expenses per type
      const counts = {};
      const expenses = expensesRes.data?.data || expensesRes.data || [];
      if (Array.isArray(expenses)) {
        expenses.forEach(exp => {
          counts[exp.expense_type_id] = (counts[exp.expense_type_id] || 0) + 1;
        });
      }
      setExpenseCounts(counts);
    } catch (error) {
      toast.error('Failed to load expense types');
    } finally {
      setLoading(false);
    }
  };

  const openAddDialog = () => {
    setEditingType(null);
    setFormData({ name: '', description: '' });
    setDialogOpen(true);
  };

  const openEditDialog = (type) => {
    setEditingType(type);
    setFormData({ name: type.name, description: type.description || '' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('Please enter a name');
      return;
    }
    
    setSubmitting(true);
    try {
      if (editingType) {
        await api.put(`/expense-types/${editingType.id}`, {
          name: formData.name.trim(),
          description: formData.description.trim()
        });
        toast.success('Expense type updated');
      } else {
        await api.post('/expense-types', {
          name: formData.name.trim(),
          description: formData.description.trim()
        });
        toast.success('Expense type added');
      }
      
      setDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save expense type'));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = (type) => {
    setTypeToDelete(type);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!typeToDelete) return;
    
    try {
      await api.delete(`/expense-types/${typeToDelete.id}`);
      toast.success('Expense type deleted');
      setDeleteDialogOpen(false);
      setTypeToDelete(null);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete'));
    }
  };

  const systemTypes = expenseTypes.filter(t => t.is_system);
  const customTypes = expenseTypes.filter(t => !t.is_system);

  const { paginatedData: paginatedSystem, ...systemPagination } = useClientPagination(systemTypes, 10);
  const { paginatedData: paginatedCustom, ...customPagination } = useClientPagination(customTypes, 10);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="expense-types-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Expense Types</h1>
          <p className="text-muted-foreground mt-1">Manage expense categories for tracking business expenses</p>
        </div>
        <Button onClick={openAddDialog} data-testid="add-expense-type-btn">
          <Plus className="w-4 h-4 mr-2" />
          Add Type
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Tag className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Types</p>
                <p className="text-2xl font-bold">{expenseTypes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <Zap className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">System Types</p>
                <p className="text-2xl font-bold">{systemTypes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <Tag className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Custom Types</p>
                <p className="text-2xl font-bold">{customTypes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Types */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-600" />
            System Types
            <Badge variant="secondary" className="ml-2">{systemTypes.length}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            These are system-managed expense types and cannot be modified or deleted.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Expenses</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {systemTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No system types
                  </TableCell>
                </TableRow>
              ) : (
                paginatedSystem.map((type) => (
                  <TableRow key={type.id} data-testid={`system-type-${type.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          <Zap className="w-3 h-3 mr-1" />
                          {type.name}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {type.description || '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{expenseCounts[type.id] || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {type.created_at ? formatDate(type.created_at) : '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
          <TablePagination {...systemPagination} />
        </CardContent>
      </Card>

      {/* Custom Types */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="w-4 h-4 text-emerald-600" />
            Custom Types
            <Badge variant="secondary" className="ml-2">{customTypes.length}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Custom expense types created by you. These can be edited or deleted.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Expenses</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No custom types yet. Click "Add Type" to create one.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedCustom.map((type) => (
                  <TableRow key={type.id} data-testid={`custom-type-${type.id}`}>
                    <TableCell>
                      <Badge variant="outline">{type.name}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {type.description || '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{expenseCounts[type.id] || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {type.created_at ? formatDate(type.created_at) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(type)}
                          data-testid={`edit-type-${type.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => confirmDelete(type)}
                          data-testid={`delete-type-${type.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
          <TablePagination {...customPagination} />
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              {editingType ? 'Edit Expense Type' : 'Add Expense Type'}
            </DialogTitle>
            <DialogDescription>
              {editingType 
                ? 'Update the expense type details below.'
                : 'Create a new expense category for tracking expenses.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Travel, Marketing, Utilities"
                data-testid="type-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description for this expense type"
                data-testid="type-description-input"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} data-testid="save-type-btn">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingType ? 'Save Changes' : 'Add Type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Expense Type
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{typeToDelete?.name}"? 
              {expenseCounts[typeToDelete?.id] > 0 && (
                <span className="block mt-2 text-amber-600">
                  Warning: This type has {expenseCounts[typeToDelete?.id]} expense(s) associated with it.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} data-testid="confirm-delete-btn">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
