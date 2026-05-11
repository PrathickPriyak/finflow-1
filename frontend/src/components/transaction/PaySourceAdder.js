import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Plus, X, ChevronsUpDown, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const PaySourceAdder = ({ gateways, remaining, onAdd }) => {
  const [selectedGw, setSelectedGw] = useState('');
  const [amount, setAmount] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [gwOpen, setGwOpen] = useState(false);

  const selectedGateway = gateways.find((g) => g.id === selectedGw);

  const handleAdd = () => {
    if (!selectedGw || !amount) return;
    const amt = parseFloat(amount);
    if (amt <= 0 || amt > remaining + 0.01) return;

    const gw = gateways.find((g) => g.id === selectedGw);
    if (!gw) return;

    onAdd({
      gateway_id: gw.id,
      gateway_name: gw.name,
      amount: amt,
      wallet_balance: gw.wallet_balance || 0,
    });
    setSelectedGw('');
    setAmount('');
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={() => setExpanded(true)}
        data-testid="add-pay-source-btn"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Gateway Source ({formatCurrency(remaining)} remaining)
      </Button>
    );
  }

  return (
    <div className="p-4 rounded-xl border-2 border-dashed border-purple-300 bg-purple-50/50 dark:bg-purple-900/10 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-purple-700 dark:text-purple-400">Add Pay Source</p>
        <Button variant="ghost" size="icon" onClick={() => setExpanded(false)}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <Popover open={gwOpen} onOpenChange={setGwOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={gwOpen}
            className="w-full justify-between h-10 font-normal"
            data-testid="pay-source-gateway-select"
          >
            {selectedGateway
              ? `${selectedGateway.name} (${formatCurrency(selectedGateway.wallet_balance || 0)})`
              : "Search gateway..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search gateway..." />
            <CommandList>
              <CommandEmpty>No gateway found.</CommandEmpty>
              <CommandGroup>
                {gateways.map((gw) => (
                  <CommandItem
                    key={gw.id}
                    value={gw.name}
                    onSelect={() => {
                      setSelectedGw(gw.id);
                      setGwOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selectedGw === gw.id ? "opacity-100" : "opacity-0")} />
                    {gw.name} ({formatCurrency(gw.wallet_balance || 0)})
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedGateway && (
        <p className="text-xs text-muted-foreground">
          Available balance: {formatCurrency(selectedGateway.wallet_balance || 0)}
        </p>
      )}
      <div className="flex gap-2">
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onWheel={(e) => e.target.blur()}
          placeholder={`Max: ${remaining}`}
          className="flex-1"
          data-testid="pay-source-amount-input"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAmount(remaining.toString())}
          data-testid="fill-remaining-btn"
        >
          Fill Remaining
        </Button>
      </div>
      <Button
        onClick={handleAdd}
        disabled={!selectedGw || !amount || parseFloat(amount) <= 0}
        className="w-full"
        data-testid="confirm-add-source-btn"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Source
      </Button>
    </div>
  );
};

export default PaySourceAdder;
