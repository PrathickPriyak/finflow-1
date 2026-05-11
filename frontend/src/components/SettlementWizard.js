import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { 
  CreditCard, Banknote, Building2, Loader2, 
  AlertCircle, CheckCircle2, ArrowRight, Calculator, ChevronsUpDown, Check
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/**
 * Settlement Method Selection Card
 */
const MethodCard = ({ method, icon: Icon, label, description, selected, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`
      flex flex-col items-center p-4 rounded-lg border-2 transition-all w-full
      ${selected 
        ? 'border-primary bg-primary/5' 
        : 'border-border hover:border-primary/50 hover:bg-muted/50'
      }
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
    `}
    data-testid={`method-${method}`}
  >
    <Icon className={`w-8 h-8 mb-2 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
    <span className={`font-medium ${selected ? 'text-primary' : ''}`}>{label}</span>
    <span className="text-xs text-muted-foreground mt-1">{description}</span>
  </button>
);

/**
 * Unified Settlement Wizard Component
 * Supports: Card Swipe, Cash, Bank Transfer
 */
export default function SettlementWizard({ 
  collection, 
  open, 
  onOpenChange, 
  onSuccess 
}) {
  const { api } = useAuth();
  
  // Form state
  const [method, setMethod] = useState('');
  const [grossAmount, setGrossAmount] = useState('');
  const [chargePercentage, setChargePercentage] = useState('');
  const [notes, setNotes] = useState('');
  const [includeCharges, setIncludeCharges] = useState(false);
  
  // Card swipe specific
  const [gatewayId, setGatewayId] = useState('');
  const [serverId, setServerId] = useState('');
  const [gateways, setGateways] = useState([]);
  const [servers, setServers] = useState([]);
  const [gwPopoverOpen, setGwPopoverOpen] = useState(false);
  const [srvPopoverOpen, setSrvPopoverOpen] = useState(false);
  
  // Cash/Bank specific
  const [walletId, setWalletId] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [wallets, setWallets] = useState([]);
  const [allWallets, setAllWallets] = useState([]);
  const [bankPaymentTypes, setBankPaymentTypes] = useState([]);
  
  // Settings
  const [appSettings, setAppSettings] = useState({ default_commission_percentage: 1, min_outstanding_threshold: 50 });
  
  // Customer charge note
  const [customerChargeNote, setCustomerChargeNote] = useState('');
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Fetch required data when dialog opens
  useEffect(() => {
    if (open && collection) {
      fetchData();
      const remaining = collection.amount - (collection.settled_amount || 0);
      setGrossAmount(remaining.toString());
      setChargePercentage('');
      setMethod('');
      setNotes('');
      setCustomerChargeNote('');
      setGatewayId('');
      setServerId('');
      setWalletId('');
      setPaymentType('');
      setIncludeCharges(false);
    }
  }, [open, collection]);
  
  // Fetch servers when gateway changes
  useEffect(() => {
    if (gatewayId) {
      fetchServers(gatewayId);
    } else {
      setServers([]);
      setServerId('');
    }
  }, [gatewayId]);
  
  // Set minimum charge percentage when server is selected (for card swipe)
  useEffect(() => {
    if (method === 'card_swipe' && serverId) {
      const server = servers.find(s => s.id === serverId);
      if (server) {
        setChargePercentage(server.charge_percentage.toString());
      }
    }
  }, [serverId, servers, method]);
  
  const fetchData = async () => {
    setLoading(true);
    try {
      const [gatewaysRes, walletsRes, paymentTypesRes, settingsRes] = await Promise.all([
        api.get('/gateways'),
        api.get('/wallets'),
        api.get('/bank-payment-types'),
        api.get('/settings'),
      ]);
      
      // Fetch customer charge note
      if (collection?.customer_id) {
        try {
          const custRes = await api.get(`/customers/${collection.customer_id}`);
          setCustomerChargeNote(custRes.data?.customer?.charge_note || '');
        } catch { /* ignore — charge note is optional */ }
      }
      
      setGateways(gatewaysRes.data.filter(g => g.is_active && !g.is_deleted));
      setAllWallets(walletsRes.data.filter(w => !w.is_deleted));
      setWallets(walletsRes.data.filter(w => 
        (w.wallet_type === 'cash' || w.wallet_type === 'bank') && !w.is_deleted
      ));
      setBankPaymentTypes(paymentTypesRes.data || []);
      if (settingsRes.data) {
        setAppSettings({
          default_commission_percentage: settingsRes.data.default_commission_percentage ?? 1,
          min_outstanding_threshold: settingsRes.data.min_outstanding_threshold ?? 50,
        });
      }
    } catch (error) {
      console.error('Failed to fetch settlement data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchServers = async (gwId) => {
    try {
      const res = await api.get(`/gateway-servers?gateway_id=${gwId}`);
      setServers(res.data.filter(s => s.is_active && !s.is_deleted));
    } catch (error) {
      console.error('Failed to fetch servers:', error);
      setServers([]);
    }
  };
  
  // Calculate preview values
  const calculations = useMemo(() => {
    const inputAmount = parseFloat(grossAmount) || 0;
    const chargePct = parseFloat(chargePercentage) || 0;
    const remaining = collection ? (collection.amount - (collection.settled_amount || 0)) : 0;
    
    // In Include Charges mode, user enters principal; system calculates gross
    // In Normal mode, user enters gross directly
    let gross, principal;
    if (includeCharges) {
      principal = inputAmount;
      gross = chargePct < 100 ? Math.round(principal / (1 - chargePct / 100) * 100) / 100 : 0;
    } else {
      gross = inputAmount;
      principal = gross;
    }

    const chargeAmount = Math.round(gross * chargePct) / 100;
    const netAmount = gross - chargeAmount;
    
    // For card swipe, calculate PG vs commission split
    let pgPct = 0;
    let pgAmount = 0;
    let commissionPct = chargePct;
    let commissionAmount = chargeAmount;
    let walletCredit = gross; // cash/bank gets full gross
    
    if (method === 'card_swipe' && serverId) {
      const server = servers.find(s => s.id === serverId);
      if (server) {
        pgPct = server.charge_percentage;
        pgAmount = Math.round(gross * pgPct) / 100;
        commissionPct = Math.max(0, chargePct - pgPct);
        commissionAmount = Math.round(gross * commissionPct) / 100;
        walletCredit = Math.round((gross - pgAmount) * 100) / 100;
      }
    }
    
    // Outstanding in Normal mode = commission + (gross - walletCredit)
    const outstandingAmount = !includeCharges && chargePct > 0 
      ? Math.round((commissionAmount + (gross - walletCredit)) * 100) / 100
      : 0;
    
    const newRemaining = remaining - principal;
    const threshold = appSettings.min_outstanding_threshold;
    
    return {
      gross,
      principal,
      inputAmount,
      chargePct,
      chargeAmount,
      netAmount,
      remaining,
      newRemaining,
      pgPct,
      pgAmount,
      commissionPct,
      commissionAmount,
      walletCredit,
      outstandingAmount,
      isWriteoff: outstandingAmount > 0 && outstandingAmount < threshold,
      isOverpayment: newRemaining < -0.01,
      excessAmount: newRemaining < 0 ? Math.abs(newRemaining) : 0,
      isFullSettlement: Math.abs(newRemaining) <= 0.01,
    };
  }, [grossAmount, chargePercentage, collection, method, serverId, servers, includeCharges, appSettings]);
  
  // Validation
  const canSubmit = useMemo(() => {
    if (!method || !grossAmount || parseFloat(grossAmount) <= 0) return false;
    const parsedCharge = parseFloat(chargePercentage);
    if (chargePercentage !== '' && (isNaN(parsedCharge) || parsedCharge < 0 || parsedCharge > 100)) return false;
    if (includeCharges && (chargePercentage === '' || parsedCharge >= 100)) return false;
    
    if (method === 'card_swipe') {
      if (!gatewayId || !serverId) return false;
      const server = servers.find(s => s.id === serverId);
      if (server && parseFloat(chargePercentage) < server.charge_percentage) return false;
    } else {
      if (!walletId) return false;
      if (method === 'bank_transfer' && !paymentType) return false;
    }
    
    return true;
  }, [method, grossAmount, chargePercentage, gatewayId, serverId, walletId, paymentType, servers, includeCharges, collection]);
  
  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    
    setSubmitting(true);
    try {
      // In Include Charges mode, send calculated gross; in Normal mode, send user-entered gross
      const actualGross = includeCharges ? calculations.gross : parseFloat(grossAmount);
      
      const payload = {
        method,
        gross_amount: actualGross,
        charge_percentage: parseFloat(chargePercentage) || 0,
        include_charges: includeCharges,
        notes,
      };
      
      if (method === 'card_swipe') {
        payload.gateway_id = gatewayId;
        payload.server_id = serverId;
      } else {
        payload.wallet_id = walletId;
        if (method === 'bank_transfer') {
          payload.payment_type = paymentType;
        }
      }
      
      const res = await api.post(`/collections/${collection.id}/settle-unified`, payload, { timeout: 30000 });
      
      toast.success(res.data.message || 'Settlement recorded successfully');
      
      if (res.data.outstanding_info) {
        const info = res.data.outstanding_info;
        if (info.type === 'service_charge') {
          toast.info(`Service charge of ${formatCurrency(info.amount)} created as new collection (${info.readable_id})`);
        } else if (info.type === 'writeoff') {
          toast.info(`Small charge of ${formatCurrency(info.amount)} written off as expense`);
        }
      }
      
      if (res.data.payment_created) {
        toast.info(`Payment of ${formatCurrency(res.data.payment_created.amount)} created for customer (overpayment)`);
      }
      
      onSuccess && onSuccess(res.data);
      onOpenChange(false);
    } catch (error) {
      console.error('Settlement error:', error);
      const message = error.code === 'ECONNABORTED'
        ? 'Request timed out. Please check your connection and try again.'
        : (error.response?.data?.detail || 'Failed to record settlement');
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };
  
  const handleUseFullAmount = () => {
    const remaining = collection ? (collection.amount - (collection.settled_amount || 0)) : 0;
    // In Include Charges mode, "Full" fills with remaining (principal)
    // In Normal mode, "Full" fills with remaining (gross = collection amount)
    setGrossAmount(remaining.toString());
  };
  
  const selectedWallet = wallets.find(w => w.id === walletId);
  const selectedGateway = gateways.find(g => g.id === gatewayId);
  const selectedServer = servers.find(s => s.id === serverId);
  
  if (!collection) return null;
  
  const remaining = collection.amount - (collection.settled_amount || 0);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Settle Collection
          </DialogTitle>
          <DialogDescription>
            Customer: <strong>{collection.customer_name}</strong> | 
            Original: <strong>{formatCurrency(collection.amount)}</strong> | 
            Remaining: <strong className="text-primary">{formatCurrency(remaining)}</strong>
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Step 1: Select Method */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">1. Select Settlement Method</Label>
              <div className="grid grid-cols-3 gap-3">
                <MethodCard
                  method="card_swipe"
                  icon={CreditCard}
                  label="Card Swipe"
                  description="PG + Commission charges"
                  selected={method === 'card_swipe'}
                  onClick={() => {
                    setMethod('card_swipe');
                    setWalletId('');
                    setPaymentType('');
                  }}
                />
                <MethodCard
                  method="cash"
                  icon={Banknote}
                  label="Cash"
                  description="Commission charges only"
                  selected={method === 'cash'}
                  onClick={() => {
                    setMethod('cash');
                    setGatewayId('');
                    setServerId('');
                    setChargePercentage(appSettings.default_commission_percentage.toString());
                  }}
                />
                <MethodCard
                  method="bank_transfer"
                  icon={Building2}
                  label="Bank Transfer"
                  description="Commission charges only"
                  selected={method === 'bank_transfer'}
                  onClick={() => {
                    setMethod('bank_transfer');
                    setGatewayId('');
                    setServerId('');
                    setChargePercentage(appSettings.default_commission_percentage.toString());
                  }}
                />
              </div>
            </div>
            
            {/* Step 2: Method-specific fields */}
            {method && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                <Label className="text-base font-semibold">2. Settlement Details</Label>
                
                {method === 'card_swipe' ? (
                  <>
                    {/* Gateway Selection */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Gateway *</Label>
                        <Popover open={gwPopoverOpen} onOpenChange={setGwPopoverOpen} modal={false}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={gwPopoverOpen}
                              className="w-full justify-between h-11 font-normal"
                              data-testid="gateway-select"
                            >
                              {gatewayId
                                ? gateways.find(gw => gw.id === gatewayId)?.name || "Select gateway"
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
                                  {gateways.map(gw => (
                                    <CommandItem
                                      key={gw.id}
                                      value={gw.name}
                                      onSelect={() => {
                                        setGatewayId(gw.id);
                                        setGwPopoverOpen(false);
                                      }}
                                    >
                                      <Check className={cn("mr-2 h-4 w-4", gatewayId === gw.id ? "opacity-100" : "opacity-0")} />
                                      {gw.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="space-y-2">
                        <Label>Server *</Label>
                        <Popover open={srvPopoverOpen} onOpenChange={setSrvPopoverOpen} modal={false}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={srvPopoverOpen}
                              className="w-full justify-between h-11 font-normal"
                              disabled={!gatewayId || servers.length === 0}
                              data-testid="server-select"
                            >
                              {serverId
                                ? (() => { const s = servers.find(s => s.id === serverId); return s ? `${s.name} (${s.charge_percentage}% PG)` : "Select server"; })()
                                : (gatewayId ? "Search server..." : "Select gateway first")}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Search server..." />
                              <CommandList>
                                <CommandEmpty>No server found.</CommandEmpty>
                                <CommandGroup>
                                  {servers.map(s => (
                                    <CommandItem
                                      key={s.id}
                                      value={`${s.name} ${s.charge_percentage}`}
                                      onSelect={() => {
                                        setServerId(s.id);
                                        setSrvPopoverOpen(false);
                                      }}
                                    >
                                      <Check className={cn("mr-2 h-4 w-4", serverId === s.id ? "opacity-100" : "opacity-0")} />
                                      {s.name} ({s.charge_percentage}% PG)
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    {/* AUDIT-R3-08: Show gateway wallet balance */}
                    {gatewayId && (() => {
                      const gwWallet = allWallets.find(w => w.wallet_type === 'gateway' && w.gateway_id === gatewayId);
                      return gwWallet ? (
                        <div className="flex items-center justify-between px-3 py-2 bg-muted rounded-md text-sm" data-testid="gateway-wallet-balance">
                          <span className="text-muted-foreground">Gateway Wallet Balance:</span>
                          <span className="font-semibold text-emerald-600">{formatCurrency(gwWallet.balance)}</span>
                        </div>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <>
                    {/* Wallet Selection */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{method === 'cash' ? 'Cash Wallet' : 'Bank Account'} *</Label>
                        <SearchableSelect
                          value={walletId}
                          onValueChange={setWalletId}
                          placeholder={`Search ${method === 'cash' ? 'cash wallet' : 'bank account'}...`}
                          items={wallets
                            .filter(w => w.wallet_type === (method === 'cash' ? 'cash' : 'bank'))
                            .map(w => ({ value: w.id, label: `${w.name} (${formatCurrency(w.balance)})` }))}
                          triggerTestId="wallet-select"
                        />
                      </div>
                      {method === 'bank_transfer' && (
                        <div className="space-y-2">
                          <Label>Payment Type *</Label>
                          <Select value={paymentType} onValueChange={setPaymentType}>
                            <SelectTrigger data-testid="payment-type-select">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {bankPaymentTypes.map(pt => (
                                <SelectItem key={pt.id} value={pt.name}>
                                  {pt.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </>
                )}
                
                {/* Include All Charges Toggle */}
                <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
                  <div>
                    <span className="font-medium text-sm">Include All Charges</span>
                    <p className="text-xs text-muted-foreground">Customer pays extra to cover all charges upfront</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer" data-testid="include-charges-toggle">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={includeCharges}
                      onChange={(e) => setIncludeCharges(e.target.checked)} 
                    />
                    <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </div>
                
                {/* Amount and Charges */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <Label>{includeCharges ? 'Collection Amount to Settle *' : 'Swipe/Pay Amount *'}</Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*\.?[0-9]*"
                        value={grossAmount}
                        onChange={(e) => setGrossAmount(e.target.value)}
                        placeholder={includeCharges ? "Enter collection amount" : "Enter amount"}
                        className="h-11"
                        data-testid="settlement-amount"
                      />
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="h-11 px-4"
                        onClick={handleUseFullAmount}
                        data-testid="use-full-amount"
                      >
                        Full
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {method === 'card_swipe' ? 'Total Charges (%)' : 'Commission (%)'} *
                      {method === 'card_swipe' && selectedServer && (
                        <span className="text-xs text-muted-foreground ml-2">
                          Min: {selectedServer.charge_percentage}% PG
                        </span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      value={chargePercentage}
                      onChange={(e) => {
                        // BUG-FIX: Prevent negative values at input level
                        const val = e.target.value;
                        if (val === '' || (parseFloat(val) >= 0 && parseFloat(val) <= 100)) {
                          setChargePercentage(val);
                        }
                      }}
                      placeholder={method === 'card_swipe' ? 'e.g., 3' : 'e.g., 1'}
                      className="h-11"
                      data-testid="charge-percentage"
                    />
                    {method === 'card_swipe' && calculations.commissionPct > 0 && (
                      <p className="text-xs text-muted-foreground">
                        PG: {calculations.pgPct}% | Commission: {calculations.commissionPct}%
                      </p>
                    )}
                    {customerChargeNote && (
                      <p className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded mt-1" data-testid="settlement-charge-note-hint">
                        {customerChargeNote}
                      </p>
                    )}
                  </div>
                </div>

                {/* Customer Must Pay — prominent callout for Include Charges mode */}
                {includeCharges && calculations.gross > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-2 border-red-500 rounded-lg" data-testid="customer-must-pay-callout">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                      <span className="font-semibold text-sm text-red-900">
                        {method === 'card_swipe' ? 'Customer must swipe' : method === 'cash' ? 'Customer must pay' : 'Customer must transfer'}
                      </span>
                    </div>
                    <span className="text-lg font-bold text-red-600" data-testid="customer-must-pay-amount">
                      {formatCurrency(calculations.gross)}
                    </span>
                  </div>
                )}
                
                {/* Notes */}
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional notes..."
                    rows={2}
                    data-testid="settlement-notes"
                  />
                </div>
              </div>
            )}
            
            {/* Step 3: Preview */}
            {method && calculations.gross > 0 && (
              <div className="border rounded-lg p-4 bg-background space-y-3">
                <Label className="text-base font-semibold">3. Settlement Preview</Label>
                
                <div className="space-y-2 text-sm">
                  {includeCharges && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Collection Amount to Settle</span>
                      <span className="font-medium">{formatCurrency(calculations.principal)}</span>
                    </div>
                  )}
                  
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {method === 'card_swipe' ? 'Swipe' : method === 'cash' ? 'Cash' : 'Transfer'} Amount
                      {includeCharges && ' (incl. charges)'}
                    </span>
                    <span className="font-medium">{formatCurrency(calculations.gross)}</span>
                  </div>
                  
                  {method === 'card_swipe' && calculations.pgAmount > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>PG Charges ({calculations.pgPct}%)</span>
                      <span>- {formatCurrency(calculations.pgAmount)}</span>
                    </div>
                  )}
                  
                  {calculations.commissionAmount > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Commission ({calculations.commissionPct}%)</span>
                      <span>{formatCurrency(calculations.commissionAmount)}</span>
                    </div>
                  )}
                  
                  <div className="border-t pt-2 flex justify-between font-medium">
                    <span>Wallet Receives</span>
                    <span className="text-emerald-600">{formatCurrency(calculations.walletCredit)}</span>
                  </div>
                  
                  {/* Outstanding / Write-off Info (Normal mode only) */}
                  {!includeCharges && calculations.outstandingAmount > 0 && (
                    <div className="border-t pt-2">
                      {calculations.isWriteoff ? (
                        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-2 rounded text-xs">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>
                            Charge of {formatCurrency(calculations.outstandingAmount)} below threshold ({formatCurrency(appSettings.min_outstanding_threshold)}) — will be written off as expense
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-blue-600 bg-blue-50 p-2 rounded text-xs">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>
                            Service charge of <strong>{formatCurrency(calculations.outstandingAmount)}</strong> will be created as new collection from customer
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {includeCharges && (
                    <div className="border-t pt-2">
                      <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 p-2 rounded text-xs">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        <span>All charges included — no outstanding will be created</span>
                      </div>
                    </div>
                  )}
                  
                  <div className="border-t pt-2">
                    {calculations.isFullSettlement ? (
                      <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 p-2 rounded">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="font-medium">Collection will be fully settled</span>
                      </div>
                    ) : calculations.isOverpayment ? (
                      <div className="flex items-center gap-2 text-blue-600 bg-blue-50 p-2 rounded">
                        <AlertCircle className="w-4 h-4" />
                        <span>
                          Over-payment of <strong>{formatCurrency(calculations.excessAmount)}</strong> will create a Payment to customer
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Remaining after settlement</span>
                        <span className="font-medium text-foreground">
                          {formatCurrency(calculations.newRemaining)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!canSubmit || submitting}
            data-testid="confirm-settlement-btn"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                Confirm Settlement
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
