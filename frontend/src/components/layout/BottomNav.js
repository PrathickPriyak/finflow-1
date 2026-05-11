import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Banknote, Receipt, Plus, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { name: 'dashboard', icon: LayoutDashboard, label: 'Home', path: '/dashboard' },
  { name: 'transactions', icon: ArrowLeftRight, label: 'Txns', path: '/transactions' },
  { name: 'new', icon: Plus, label: 'New', path: '/transactions/new', isAction: true },
  { name: 'collections', icon: Receipt, label: 'Collect', path: '/collections' },
  { name: 'payments', icon: Banknote, label: 'Pay', path: '/payments' },
];

export default function BottomNav({ onMenuClick }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-background border-t z-50 md:hidden safe-area-pb"
      aria-label="Bottom navigation"
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          // Check permission
          const permModule = item.name === 'new' ? 'transactions' : item.name;
          if (!hasPermission(permModule)) return null;

          const Icon = item.icon;
          const isActive = location.pathname === item.path || 
                          (item.path !== '/dashboard' && location.pathname.startsWith(item.path));

          if (item.isAction) {
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center justify-center -mt-5"
                data-testid={`bottom-nav-${item.name}`}
              >
                <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                  <Icon className="w-6 h-6" strokeWidth={2} />
                </div>
              </button>
            );
          }

          return (
            <NavLink
              key={item.name}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[64px] min-h-[48px] px-2 py-1 rounded-lg transition-colors",
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`bottom-nav-${item.name}`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2 : 1.5} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
