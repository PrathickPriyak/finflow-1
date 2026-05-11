import React, { useCallback, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  LayoutDashboard, Users, ArrowLeftRight, Clock, Landmark, 
  Building2, CreditCard, Percent, Wallet, UserCog, Shield, 
  ScrollText, CalendarCheck, Settings, X, ChevronRight,
  Banknote, Server, WalletCards, Search, ShieldCheck, Scale, Receipt,
  ShieldAlert, Trash2, Download, Tag, BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap = {
  'layout-dashboard': LayoutDashboard,
  'users': Users,
  'arrow-left-right': ArrowLeftRight,
  'clock': Clock,
  'landmark': Landmark,
  'building-2': Building2,
  'credit-card': CreditCard,
  'percent': Percent,
  'wallet': Wallet,
  'user-cog': UserCog,
  'shield': Shield,
  'scroll-text': ScrollText,
  'calendar-check': CalendarCheck,
  'settings': Settings,
  'banknote': Banknote,
  'server': Server,
  'wallet-cards': WalletCards,
  'shield-check': ShieldCheck,
  'shield-alert': ShieldAlert,
  'scale': Scale,
  'receipt': Receipt,
  'trash-2': Trash2,
  'download': Download,
  'tag': Tag,
  'bar-chart-3': BarChart3,
};

// Module groupings for navigation (order matters - using array of tuples)
// NOTE: Module names use hyphens to match database format (e.g., 'pg-and-servers')
const moduleGroupsOrder = ['Main', 'Money', 'Setup', 'Reports', 'Admin', 'Settings'];
const moduleGroups = {
  'Main': ['dashboard', 'customers', 'transactions'],
  'Money': ['payments', 'collections', 'wallets', 'expenses'],
  'Setup': ['pg-and-servers', 'banks-and-cards', 'expense-types'],
  'Reports': ['reports', 'daily-closing', 'reconciliation', 'downloads'],
  'Admin': ['users', 'roles', 'audit-log', 'data-integrity', 'balance-verification', 'system-reset', 'security'],
  'Settings': ['settings'],
};

export default function Sidebar({ isOpen, onClose }) {
  const { modules, hasPermission, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Filter modules based on permissions
  const visibleModules = modules.filter(module => hasPermission(module.name));

  // Keyboard shortcuts
  const handleKeyboardShortcut = useCallback((e) => {
    // Only handle shortcuts if not in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Ctrl/Cmd + K for search (future feature)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      // Could open search modal
    }
    
    // Ctrl/Cmd + N for new transaction
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      navigate('/transactions/new');
    }
    
    // Number shortcuts for main sections
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      switch (e.key) {
        case '1': navigate('/dashboard'); break;
        case '2': navigate('/transactions'); break;
        case '3': navigate('/customers'); break;
        case '4': navigate('/gateways'); break;
        case '5': navigate('/settings'); break;
        default: break;
      }
    }
  }, [navigate]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcut);
    return () => document.removeEventListener('keydown', handleKeyboardShortcut);
  }, [handleKeyboardShortcut]);

  // Group modules for display
  const getModuleGroup = (moduleName) => {
    for (const [group, names] of Object.entries(moduleGroups)) {
      if (names.includes(moduleName)) return group;
    }
    return 'Other';
  };

  const groupedModules = {};
  visibleModules.forEach(module => {
    const group = getModuleGroup(module.name);
    if (!groupedModules[group]) groupedModules[group] = [];
    groupedModules[group].push(module);
  });

  return (
    <aside
      className={cn(
        'sidebar',
        isOpen && 'sidebar-open'
      )}
      data-testid="sidebar"
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">FF</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Fin Flow</span>
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-1 rounded-md hover:bg-muted"
          data-testid="close-sidebar-btn"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="px-4 py-2 border-b bg-muted/30 shrink-0">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Ctrl+N</kbd>
          <span>New Transaction</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 min-h-0" aria-label="Sidebar navigation">
        {moduleGroupsOrder
          .filter(group => group !== 'Settings' && groupedModules[group]?.length > 0)
          .map((group) => (
          <div key={group} className="mb-2">
            <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group}
            </p>
            {groupedModules[group].map((module) => {
              const Icon = iconMap[module.icon] || LayoutDashboard;
              const isActive = location.pathname === module.route || 
                              location.pathname.startsWith(module.route + '/');

              return (
                <NavLink
                  key={module.name}
                  to={module.route}
                  onClick={onClose}
                  className={cn('sidebar-item', isActive && 'active')}
                  data-testid={`nav-${module.name}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span className="truncate">{module.display_name}</span>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto" aria-hidden="true" />}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Settings - Fixed at bottom */}
      {groupedModules['Settings']?.length > 0 && (
        <div className="border-t shrink-0">
          {groupedModules['Settings'].map((module) => {
            const Icon = iconMap[module.icon] || Settings;
            const isActive = location.pathname === module.route;
            return (
              <NavLink
                key={module.name}
                to={module.route}
                onClick={onClose}
                className={cn('sidebar-item', isActive && 'active')}
                data-testid={`nav-${module.name}`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.5} />
                <span className="truncate">{module.display_name}</span>
              </NavLink>
            );
          })}
        </div>
      )}

      {/* User info */}
      <div className="p-4 border-t shrink-0">
        <div className="flex items-center gap-3">
          <div 
            className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="text-primary font-medium text-sm">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.role_name}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
