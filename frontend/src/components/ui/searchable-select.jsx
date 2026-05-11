import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Drop-in searchable replacement for shadcn <Select>.
 *
 * @param {string}   value          - Currently selected value
 * @param {function} onValueChange  - Callback with new value
 * @param {string}   placeholder    - Search input placeholder
 * @param {Array}    items          - [{value, label}] list
 * @param {string}   allOption      - Label for the "All" reset option (optional)
 * @param {string}   className      - Trigger button className
 * @param {boolean}  disabled       - Disable the trigger
 * @param {string}   triggerTestId  - data-testid for trigger
 */
const SearchableSelect = ({
  value,
  onValueChange,
  placeholder = "Search...",
  items = [],
  allOption,
  className,
  disabled,
  triggerTestId,
}) => {
  const [open, setOpen] = useState(false);
  const selectedItem = items.find((i) => i.value === value);

  const displayText = selectedItem
    ? selectedItem.label
    : allOption || placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal h-10", className)}
          disabled={disabled}
          data-testid={triggerTestId}
        >
          <span className="truncate">{displayText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {allOption && (
                <CommandItem
                  value={allOption}
                  onSelect={() => { onValueChange(""); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                  {allOption}
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.label}
                  onSelect={() => { onValueChange(item.value); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === item.value ? "opacity-100" : "opacity-0")} />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export { SearchableSelect };
