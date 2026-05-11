import React from 'react';
import { FileQuestion, Plus, Search, Database, Users, Receipt, Wallet, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';

const iconMap = {
  default: FileQuestion,
  search: Search,
  database: Database,
  customers: Users,
  transactions: Receipt,
  wallets: Wallet,
  banks: Building,
};

export function EmptyState({ 
  icon = 'default',
  title = 'No data found',
  description = 'Get started by creating your first item.',
  action,
  actionLabel = 'Create New',
  onAction,
  className = ''
}) {
  const IconComponent = iconMap[icon] || iconMap.default;
  
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <IconComponent className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      {action && onAction && (
        <Button onClick={onAction}>
          <Plus className="w-4 h-4 mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function TableEmptyState({ 
  colSpan = 1,
  icon = 'default',
  title = 'No records found',
  description = 'Try adjusting your filters or create a new record.',
  action,
  actionLabel,
  onAction 
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-48">
        <EmptyState 
          icon={icon}
          title={title}
          description={description}
          action={action}
          actionLabel={actionLabel}
          onAction={onAction}
        />
      </td>
    </tr>
  );
}

export function SearchEmptyState({ searchTerm }) {
  return (
    <EmptyState
      icon="search"
      title="No results found"
      description={`No items match "${searchTerm}". Try a different search term.`}
    />
  );
}
