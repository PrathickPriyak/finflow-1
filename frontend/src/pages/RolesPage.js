import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  Plus, Shield, Edit, Trash2, Eye, Clock, Copy, Loader2, Check,
  ChevronDown, ChevronRight, LayoutDashboard, Wallet, Settings, FileText, Users
} from 'lucide-react';
import { formatDate , getApiError } from '@/lib/formatters';
import TablePagination, { useClientPagination } from '@/components/TablePagination';

// Permission Groups Configuration
const PERMISSION_GROUPS = {
  core: {
    name: 'Core Operations',
    icon: LayoutDashboard,
    color: 'blue',
    modules: ['dashboard', 'customers', 'transactions']
  },
  financials: {
    name: 'Financial Management',
    icon: Wallet,
    color: 'emerald',
    modules: ['payments', 'collections', 'wallets', 'expenses', 'expense-types']
  },
  config: {
    name: 'Configuration',
    icon: Settings,
    color: 'purple',
    modules: ['pg-and-servers', 'banks-and-cards']
  },
  reports: {
    name: 'Reports & Analytics',
    icon: FileText,
    color: 'amber',
    modules: ['audit-log', 'daily-closing', 'reconciliation', 'balance-verification', 'data-integrity', 'reports', 'downloads']
  },
  admin: {
    name: 'Administration',
    icon: Users,
    color: 'red',
    modules: ['users', 'roles', 'settings', 'security', 'system-reset']
  }
};

const GROUP_STYLES = {
  blue: { bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30', icon: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30', icon: 'text-emerald-600' },
  purple: { bg: 'bg-purple-50 border-purple-200 dark:bg-purple-950/30', icon: 'text-purple-600' },
  amber: { bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30', icon: 'text-amber-600' },
  red: { bg: 'bg-red-50 border-red-200 dark:bg-red-950/30', icon: 'text-red-600' },
};

export default function RolesPage() {
  const { api } = useAuth();
  const [roles, setRoles] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Dialog states
  const [showDialog, setShowDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [selectedRole, setSelectedRole] = useState(null);
  
  // Form state - separate useState for each field
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPermissions, setFormPermissions] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({
    core: true, financials: true, config: true, reports: true, admin: true
  });

  const { paginatedData: paginatedRoles, ...rolesPagination } = useClientPagination(roles, 10);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [rolesRes, modulesRes] = await Promise.all([
        api.get('/roles'),
        api.get('/modules'),
      ]);
      setRoles(rolesRes.data);
      setModules(modulesRes.data);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formPermissions.length === 0) {
      toast.warning('Please select at least one permission');
      return;
    }
    
    const payload = {
      name: formName,
      description: formDescription,
      permissions: formPermissions
    };
    
    try {
      if (editingRole) {
        await api.put(`/roles/${editingRole.id}`, payload);
        toast.success('Role updated successfully');
      } else {
        await api.post('/roles', payload);
        toast.success('Role created successfully');
      }
      closeDialog();
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to save role'));
    }
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingRole(null);
    setFormName('');
    setFormDescription('');
    setFormPermissions([]);
  };

  const openCreateDialog = () => {
    setEditingRole(null);
    setFormName('');
    setFormDescription('');
    setFormPermissions(['dashboard']);
    setShowDialog(true);
  };

  const handleEdit = (role) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormDescription(role.description || '');
    const perms = Array.isArray(role.permissions) 
      ? role.permissions 
      : Object.keys(role.permissions || {}).filter(k => role.permissions[k]);
    setFormPermissions([...perms]);
    setShowDialog(true);
  };

  const handleClone = async (role) => {
    try {
      await api.post(`/roles/clone/${role.id}`);
      toast.success(`Role "${role.name}" cloned`);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to clone role'));
    }
  };

  const handleDelete = async (role) => {
    if (!window.confirm(`Delete "${role.name}"?`)) return;
    try {
      await api.delete(`/roles/${role.id}`);
      toast.success('Role deleted');
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to delete role'));
    }
  };

  const togglePermission = (moduleName) => {
    setFormPermissions(prev => {
      if (prev.includes(moduleName)) {
        return prev.filter(p => p !== moduleName);
      }
      return [...prev, moduleName];
    });
  };

  const toggleGroup = (groupId) => {
    const group = PERMISSION_GROUPS[groupId];
    if (!group) return;
    
    const allEnabled = group.modules.every(m => formPermissions.includes(m));
    setFormPermissions(prev => {
      if (allEnabled) {
        return prev.filter(p => !group.modules.includes(p));
      }
      return [...new Set([...prev, ...group.modules])];
    });
  };

  const toggleExpand = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const getGroupStatus = (groupId) => {
    const group = PERMISSION_GROUPS[groupId];
    if (!group) return { count: 0, total: 0, allSelected: false };
    const count = group.modules.filter(m => formPermissions.includes(m)).length;
    return { count, total: group.modules.length, allSelected: count === group.modules.length };
  };

  const getModuleDisplayName = (moduleName) => {
    return modules.find(m => m.name === moduleName)?.display_name || moduleName;
  };

  const countPermissions = (perms) => {
    return Array.isArray(perms) ? perms.length : Object.values(perms || {}).filter(Boolean).length;
  };

  const hasPermission = (perms, name) => {
    return Array.isArray(perms) ? perms.includes(name) : perms?.[name] || false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="roles-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles</h1>
          <p className="text-muted-foreground mt-1">Manage user roles and module permissions</p>
        </div>
        <Button onClick={openCreateDialog} data-testid="add-role-btn">
          <Plus className="w-4 h-4 mr-2" />
          Add Role
        </Button>
      </div>

      {/* Roles Table */}
      <Card>
        <CardContent className="p-0">
          {roles.length === 0 ? (
            <div className="empty-state py-12">
              <Shield className="empty-state-icon" />
              <p className="empty-state-title">No roles configured</p>
              <p className="empty-state-description">Create your first role to manage user permissions</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Role Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRoles.map((role) => (
                  <TableRow 
                    key={role.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => { setSelectedRole(role); setShowViewDialog(true); }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Shield className={`w-4 h-4 ${role.name === 'SuperAdmin' ? 'text-amber-500' : 'text-muted-foreground'}`} />
                        <span className="font-medium">{role.name}</span>
                        {role.name === 'SuperAdmin' && <Badge variant="secondary" className="text-xs">System</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{role.description || '-'}</TableCell>
                    <TableCell>
                      {role.name === 'SuperAdmin' ? (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Full Access</Badge>
                      ) : (
                        <Badge variant="secondary">{countPermissions(role.permissions)} / {modules.length} modules</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setSelectedRole(role); setShowViewDialog(true); }} title="View">
                          <Eye className="w-4 h-4" />
                        </Button>
                        {role.name !== 'SuperAdmin' && (
                          <>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleClone(role); }} title="Clone">
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEdit(role); }} title="Edit role">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(role); }} title="Delete">
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <TablePagination {...rolesPagination} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog with Grouped Permissions */}
      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Edit Role' : 'Create New Role'}</DialogTitle>
            <DialogDescription>{editingRole ? 'Modify role permissions' : 'Set up a new role with specific permissions'}</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="space-y-4 overflow-y-auto flex-1 pr-2">
              {/* Name & Description */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="role-name">Role Name *</Label>
                  <Input 
                    id="role-name"
                    value={formName} 
                    onChange={(e) => setFormName(e.target.value)} 
                    placeholder="e.g., Agent, Manager" 
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role-desc">Description</Label>
                  <Input 
                    id="role-desc"
                    value={formDescription} 
                    onChange={(e) => setFormDescription(e.target.value)} 
                    placeholder="What this role does" 
                  />
                </div>
              </div>

              {/* Permission Summary */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm font-medium">Selected Permissions</span>
                <Badge variant={formPermissions.length > 0 ? 'default' : 'secondary'}>
                  {formPermissions.length} / {modules.length} modules
                </Badge>
              </div>

              {/* Grouped Permissions with native checkboxes */}
              <div className="space-y-3">
                <Label>Module Permissions</Label>
                {Object.entries(PERMISSION_GROUPS).map(([groupId, group]) => {
                  const Icon = group.icon;
                  const styles = GROUP_STYLES[group.color];
                  const { count, total, allSelected } = getGroupStatus(groupId);
                  const isExpanded = expandedGroups[groupId];
                  
                  return (
                    <div key={groupId} className={`border rounded-lg overflow-hidden ${styles.bg}`}>
                      {/* Group Header */}
                      <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => toggleExpand(groupId)}>
                        <div className="flex items-center gap-3">
                          <Icon className={`w-5 h-5 ${styles.icon}`} />
                          <span className="font-medium">{group.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary" className="text-xs">{count}/{total}</Badge>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(e) => { e.stopPropagation(); toggleGroup(groupId); }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </div>
                      </div>
                      
                      {/* Group Content */}
                      {isExpanded && (
                        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                          {group.modules.map((moduleName) => {
                            const isChecked = formPermissions.includes(moduleName);
                            return (
                              <label
                                key={moduleName}
                                className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                                  isChecked ? 'bg-white/60 dark:bg-black/20' : 'hover:bg-white/40 dark:hover:bg-black/10'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => togglePermission(moduleName)}
                                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                />
                                <span className="text-sm">{getModuleDisplayName(moduleName)}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="mt-4 pt-4 border-t">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit">{editingRole ? 'Update' : 'Create'} Role</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className={`w-5 h-5 ${selectedRole?.name === 'SuperAdmin' ? 'text-amber-500' : ''}`} />
              {selectedRole?.name}
              {selectedRole?.name === 'SuperAdmin' && <Badge className="bg-amber-100 text-amber-700">System Role</Badge>}
            </DialogTitle>
            {selectedRole?.description && <DialogDescription>{selectedRole.description}</DialogDescription>}
          </DialogHeader>
          
          {selectedRole && (
            <div className="space-y-4">
              {selectedRole.name === 'SuperAdmin' ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200">
                  <p className="text-amber-700 dark:text-amber-400 font-medium">Full System Access</p>
                  <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">This role has unrestricted access to all modules.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(PERMISSION_GROUPS).map(([groupId, group]) => {
                    const Icon = group.icon;
                    const styles = GROUP_STYLES[group.color];
                    const enabledModules = group.modules.filter(m => hasPermission(selectedRole.permissions, m));
                    if (enabledModules.length === 0) return null;
                    
                    return (
                      <div key={groupId} className={`p-3 rounded-lg border ${styles.bg}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className={`w-4 h-4 ${styles.icon}`} />
                          <span className="font-medium text-sm">{group.name}</span>
                          <Badge variant="secondary" className="text-xs ml-auto">{enabledModules.length}/{group.modules.length}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {enabledModules.map((moduleName) => (
                            <Badge key={moduleName} variant="default" className="text-xs">
                              <Check className="w-3 h-3 mr-1" />
                              {getModuleDisplayName(moduleName)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {countPermissions(selectedRole.permissions) === 0 && (
                    <div className="text-center py-8 text-muted-foreground">No permissions assigned</div>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Created: {formatDate(selectedRole.created_at)}</span>
                </div>
                {selectedRole.name !== 'SuperAdmin' && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowViewDialog(false); handleClone(selectedRole); }}>
                      <Copy className="w-4 h-4 mr-1" /> Clone
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowViewDialog(false); handleEdit(selectedRole); }}>
                      <Edit className="w-4 h-4 mr-1" /> Edit
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
