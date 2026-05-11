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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, UserCog, Edit, Trash2, Eye, Mail, Phone, Shield, Clock, User, KeyRound } from 'lucide-react';
import { formatDate , getApiError } from '@/lib/formatters';


export default function UsersPage() {
  const { api, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    phone: '',
    role_id: '',
  });
  
  // View details dialog
  const [selectedUser, setSelectedUser] = useState(null);
  const [showViewDialog, setShowViewDialog] = useState(false);

  // Password reset dialog
  const [resetTarget, setResetTarget] = useState(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetForm, setResetForm] = useState({ new_password: '', confirm_password: '' });
  const [resetLoading, setResetLoading] = useState(false);
  
  // Pagination
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 0 });
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    fetchData();
  }, [pageSize]);

  const fetchData = async (page = 1) => {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get(`/users?page=${page}&limit=${pageSize}`),
        api.get('/roles'),
      ]);
      if (usersRes.data?.data) {
        setUsers(usersRes.data.data);
        setPagination(usersRes.data.pagination);
      } else {
        setUsers(usersRes.data);
        setPagination({ page: 1, total: usersRes.data.length, pages: 1 });
      }
      setRoles(rolesRes.data);
    } catch (error) {
      toast.error('Failed to load data');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const updateData = {
          name: formData.name,
          phone: formData.phone,
          role_id: formData.role_id,
        };
        await api.put(`/users/${editingUser.id}`, updateData);
        toast.success('User updated successfully');
      } else {
        await api.post('/users', formData);
        toast.success('User created successfully');
      }
      setShowDialog(false);
      setEditingUser(null);
      setFormData({ email: '', password: '', name: '', phone: '', role_id: '' });
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save user'));
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      password: '',
      name: user.name,
      phone: user.phone || '',
      role_id: user.role_id,
    });
    setShowDialog(true);
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Are you sure you want to delete ${user.name}?`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('User deleted successfully');
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete user'));
    }
  };

  const toggleActive = async (user) => {
    try {
      await api.put(`/users/${user.id}`, { is_active: !user.is_active });
      toast.success(`User ${user.is_active ? 'deactivated' : 'activated'}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update user');
    }
  };

  const viewUser = (user) => {
    setSelectedUser(user);
    setShowViewDialog(true);
  };

  const openResetDialog = (user) => {
    setResetTarget(user);
    setResetForm({ new_password: '', confirm_password: '' });
    setShowResetDialog(true);
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (resetForm.new_password !== resetForm.confirm_password) {
      toast.error('Passwords do not match');
      return;
    }
    setResetLoading(true);
    try {
      await api.post(`/users/${resetTarget.id}/reset-password`, { new_password: resetForm.new_password });
      toast.success(`Password reset for ${resetTarget.name}. Their sessions have been invalidated.`);
      setShowResetDialog(false);
    } catch (error) {
      toast.error(getApiError(error, 'Password reset failed'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="text-muted-foreground mt-1">Manage system users and their access</p>
        </div>
        <Button onClick={() => { setEditingUser(null); setFormData({ email: '', password: '', name: '', phone: '', role_id: '' }); setShowDialog(true); }} data-testid="add-user-btn">
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 skeleton rounded" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="empty-state py-12">
              <UserCog className="empty-state-icon" />
              <p className="empty-state-title">No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow 
                    key={user.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => viewUser(user)}
                    data-testid={`user-row-${user.id}`}
                  >
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell className="text-muted-foreground">{user.phone || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{user.role_name}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={user.is_active}
                          onCheckedChange={() => toggleActive(user)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={user.id === currentUser?.id}
                          data-testid={`toggle-${user.id}`}
                        />
                        <Badge className={user.is_active ? 'status-active' : 'status-inactive'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => { e.stopPropagation(); viewUser(user); }} 
                        data-testid={`view-${user.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => { e.stopPropagation(); handleEdit(user); }} 
                        data-testid={`edit-${user.id}`}
                        title="Edit user"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); openResetDialog(user); }}
                        data-testid={`reset-password-${user.id}`}
                        title="Reset password"
                      >
                        <KeyRound className="w-4 h-4 text-amber-500" />
                      </Button>
                      {user.id !== currentUser?.id && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={(e) => { e.stopPropagation(); handleDelete(user); }} 
                          data-testid={`delete-${user.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
          
          {/* Pagination */}
          {users.length > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pageSize) + 1} to {Math.min(pagination.page * pageSize, pagination.total)} of {pagination.total}
                </p>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="w-[100px] h-8" data-testid="users-page-size">
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
                    data-testid="users-prev-page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm">Page {pagination.page} of {pagination.pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    data-testid="users-next-page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add User'}</DialogTitle>
            <DialogDescription>
              {editingUser ? 'Update user information' : 'Create a new system user'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Full name" required data-testid="user-name-input" />
              </div>
              {!editingUser && (
                <>
                  <div className="space-y-2">
                    <Label>Email *</Label>
                    <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="email@example.com" required data-testid="user-email-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Password *</Label>
                    <Input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="Min 12 chars, uppercase, number, special" required minLength={12} data-testid="user-password-input" />
                    <p className="text-xs text-muted-foreground">12+ characters with uppercase, number, and special character</p>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="10-digit mobile" data-testid="user-phone-input" />
              </div>
              <div className="space-y-2">
                <Label>Role *</Label>
                <SearchableSelect
                  value={formData.role_id}
                  onValueChange={(v) => setFormData({ ...formData, role_id: v })}
                  placeholder="Search role..."
                  items={roles.map(r => ({ value: r.id, label: r.name }))}
                  triggerTestId="role-select"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-user-btn">{editingUser ? 'Update' : 'Create'} User</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View User Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              User Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-4">
              {/* User Info */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xl font-semibold">{selectedUser.name}</p>
                  <Badge className={selectedUser.is_active ? 'status-active' : 'status-inactive'}>
                    {selectedUser.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span>{selectedUser.email}</span>
                  </div>
                  {selectedUser.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4" />
                      <span>{selectedUser.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Role */}
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">Role & Permissions</span>
                </div>
                <Badge variant="secondary" className="text-sm">{selectedUser.role_name}</Badge>
              </div>

              {/* Meta Info */}
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Created: {formatDate(selectedUser.created_at)}</span>
                </div>
              </div>

              {/* Current User Badge */}
              {selectedUser.id === currentUser?.id && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm text-blue-700 font-medium">This is your account</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Reset Password Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <strong>{resetTarget?.name}</strong>. Their active sessions will be invalidated.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetPassword}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>New Password *</Label>
                <Input
                  type="password"
                  value={resetForm.new_password}
                  onChange={(e) => setResetForm({ ...resetForm, new_password: e.target.value })}
                  placeholder="Min 12 chars, 1 uppercase, 1 number, 1 special"
                  required
                  data-testid="reset-new-password-input"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm Password *</Label>
                <Input
                  type="password"
                  value={resetForm.confirm_password}
                  onChange={(e) => setResetForm({ ...resetForm, confirm_password: e.target.value })}
                  placeholder="Re-enter new password"
                  required
                  data-testid="reset-confirm-password-input"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Requirements: 12+ characters, 1 uppercase, 1 number, 1 special character (!@#$%^&amp;*...)
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowResetDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={resetLoading} data-testid="confirm-reset-password-btn">
                {resetLoading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
