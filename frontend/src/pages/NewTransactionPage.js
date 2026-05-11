import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  ArrowLeft, ArrowRight, Search, CreditCard, Calculator, User, Server,
  AlertTriangle, Check, Loader2, Plus, ChevronDown, ChevronUp,
  Wallet, Phone, Building2, CheckCircle2, CheckCircle, X,
  RefreshCw, ArrowDownUp, CircleDollarSign, Clock, Zap
} from 'lucide-react';
import { formatCurrency , getApiError } from '@/lib/formatters';
import StepIndicator from '@/components/transaction/StepIndicator';
import AddCustomerInline from '@/components/transaction/AddCustomerInline';
import AddCardInline from '@/components/transaction/AddCardInline';
import PaySourceAdder from '@/components/transaction/PaySourceAdder';

export default function NewTransactionPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const searchDebounceRef = useRef(null);
  
  // Data
  const [customers, setCustomers] = useState([]);
  const [recentCustomers, setRecentCustomers] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [allServers, setAllServers] = useState([]);
  const [cardNetworks, setCardNetworks] = useState([]);
  const [banks, setBanks] = useState([]);
  const [pendingByCustomer, setPendingByCustomer] = useState({}); // {customer_id: {count, amount}}
  
  // Form
  const [transactionType, setTransactionType] = useState(null); // null until selected
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedPayFromGateway, setSelectedPayFromGateway] = useState(null); // For Type 02
  const [selectedServer, setSelectedServer] = useState(null);
  
  // Multi-source pay (Type 02)
  const [paySources, setPaySources] = useState([]);  // [{gateway_id, gateway_name, amount, wallet_balance}]
  
  // Search
  const [customerSearch, setCustomerSearch] = useState('');
  const [gatewaySearch, setGatewaySearch] = useState('');
  
  // Inline forms
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showAllGateways, setShowAllGateways] = useState(true);
  
  // Transaction details
  const [swipeAmount, setSwipeAmount] = useState('');
  const [totalChargePercentage, setTotalChargePercentage] = useState('');
  const [notes, setNotes] = useState('');
  const [payToCardAmount, setPayToCardAmount] = useState('');
  
  // Calculations
  const [calculations, setCalculations] = useState(null);
  
  // Dialog states
  const [showBackWarning, setShowBackWarning] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const steps = useMemo(() => {
    if (transactionType === 'type_02') {
      return [
        { num: 1, label: 'Customer' },
        { num: 2, label: 'Card' },
        { num: 3, label: 'Type' },
        { num: 4, label: 'Pay Sources' },
        { num: 6, label: 'Review' },
      ];
    }
    return [
      { num: 1, label: 'Customer' },
      { num: 2, label: 'Card' },
      { num: 3, label: 'Type' },
      { num: 4, label: 'Gateway' },
      { num: 5, label: 'Details' },
      { num: 6, label: 'Confirm' },
    ];
  }, [transactionType]);

  useEffect(() => {
    fetchInitialData();
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  // UX-03: Prevent accidental navigation when form has data
  const hasUnsavedChanges = useMemo(() => {
    return step > 1 || selectedCustomer || selectedCard || selectedServer || 
           swipeAmount || payToCardAmount || notes;
  }, [step, selectedCustomer, selectedCard, selectedServer, swipeAmount, payToCardAmount, notes]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [customersRes, recentRes, gatewaysRes, networksRes, banksRes, pendingCollRes] = await Promise.all([
        api.get('/customers'),
        api.get('/customers/recent'),
        api.get('/gateways'),
        api.get('/card-networks'),
        api.get('/banks'),
        api.get('/collections?status=pending&limit=100'),
      ]);
      
      const customersData = customersRes.data?.data || customersRes.data || [];
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setRecentCustomers(recentRes.data || []);
      
      const gatewaysData = (gatewaysRes.data || []).filter(g => g.is_active && !g.is_deleted);
      setGateways(gatewaysData);
      
      // Build all servers list from gateways
      const servers = [];
      gatewaysData.forEach(gw => {
        if (gw.servers) {
          gw.servers.forEach(srv => {
            if (srv.is_active) {
              servers.push({
                gateway_id: gw.id,
                gateway_name: gw.name,
                server_id: srv.id,
                server_name: srv.name,
                charge_percentage: srv.charge_percentage || gw.charge_percentage,
                wallet_balance: gw.wallet_balance || 0,
              });
            }
          });
        }
      });
      setAllServers(servers);
      
      setCardNetworks(networksRes.data || []);
      setBanks(banksRes.data || []);

      // Build pending-by-customer map
      const pendingItems = pendingCollRes.data?.data || pendingCollRes.data || [];
      const pendingMap = {};
      (Array.isArray(pendingItems) ? pendingItems : []).forEach(col => {
        const cid = col.customer_id;
        if (!cid) return;
        if (!pendingMap[cid]) pendingMap[cid] = { count: 0, amount: 0 };
        pendingMap[cid].count += 1;
        pendingMap[cid].amount += (col.amount || 0) - (col.settled_amount || 0);
      });
      setPendingByCustomer(pendingMap);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchCustomers = useCallback((query) => {
    setCustomerSearch(query);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        if (query.length >= 2) {
          const response = await api.get(`/customers?search=${encodeURIComponent(query)}`);
          const data = response.data?.data || response.data || [];
          setCustomers(Array.isArray(data) ? data : []);
        } else if (query.length === 0) {
          const response = await api.get('/customers');
          const data = response.data?.data || response.data || [];
          setCustomers(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        // Silent fail for search
      }
    }, 300);
  }, [api]);

  const selectCustomer = (customer) => {
    if (customer.is_blacklisted) {
      toast.error(`Cannot select blacklisted customer: ${customer.blacklist_reason || 'No reason specified'}`);
      return;
    }
    setSelectedCustomer(customer);
    setShowAddCustomer(false);
    setStep(2);
  };

  const handleAddCustomer = async (data) => {
    try {
      const response = await api.post('/customers', data);
      toast.success('Customer added successfully!');
      const newCustomer = response.data;
      setSelectedCustomer(newCustomer);
      setShowAddCustomer(false);
      setStep(2);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to add customer'));
      throw error;
    }
  };

  const selectCard = (card) => {
    setSelectedCard(card);
    setShowAddCard(false);
    setStep(3);
  };

  const handleAddCard = async (data) => {
    try {
      const response = await api.post(`/customers/${selectedCustomer.id}/cards`, {
        bank_id: data.bank_id,
        card_network_id: data.card_network_id,
        last_four_digits: data.last_four_digits,
      });
      toast.success('Card added successfully!');
      
      const newCard = response.data;
      setSelectedCustomer(prev => ({
        ...prev,
        cards: [...(prev.cards || []), newCard]
      }));
      setSelectedCard(newCard);
      setShowAddCard(false);
      setStep(3);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to add card'));
      throw error;
    }
  };

  const selectTransactionType = (type) => {
    setTransactionType(type);
    setSelectedPayFromGateway(null);
    setSelectedServer(null);
    setPaySources([]);
    setStep(4);
  };

  const selectPayFromGateway = (gateway) => {
    setSelectedPayFromGateway(gateway);
  };

  const selectServer = (server) => {
    setSelectedServer(server);
    if (!totalChargePercentage) {
      setTotalChargePercentage(server.charge_percentage?.toString() || '');
    }
    // #12: Remember last used gateway per customer
    if (selectedCustomer?.id) {
      try {
        localStorage.setItem(`lastGateway_${selectedCustomer.id}`, JSON.stringify({ gateway_id: server.gateway_id, server_id: server.server_id }));
      } catch (e) { /* localStorage may be full or disabled */ }
    }
    setStep(5);
  };

  // Filter gateways/servers by search
  const filteredServers = useMemo(() => {
    if (!gatewaySearch.trim()) return allServers;
    const search = gatewaySearch.toLowerCase();
    return allServers.filter(s => 
      s.gateway_name?.toLowerCase().includes(search) ||
      s.server_name?.toLowerCase().includes(search)
    );
  }, [allServers, gatewaySearch]);

  // Calculations
  const calculateAmounts = () => {
    if (!swipeAmount || !totalChargePercentage || !selectedServer) return;
    
    const amount = parseFloat(swipeAmount);
    const totalCharge = parseFloat(totalChargePercentage);
    const gatewayPercentage = selectedServer.charge_percentage;
    
    // BUG-FIX: Handle NaN values from invalid input
    if (isNaN(amount) || isNaN(totalCharge)) {
      setCalculations({
        error: true,
        errorMessage: 'Please enter valid numeric values',
      });
      return;
    }
    
    if (amount <= 0) {
      setCalculations({
        error: true,
        errorMessage: 'Swipe amount must be greater than 0',
      });
      return;
    }
    
    if (totalCharge < gatewayPercentage) {
      setCalculations({
        error: true,
        errorMessage: `Total charges (${totalCharge}%) must be at least PG charges (${gatewayPercentage}%)`,
      });
      return;
    }
    
    const commissionPercentage = totalCharge - gatewayPercentage;
    const gatewayCharge = amount * gatewayPercentage / 100;
    const commissionAmount = amount * commissionPercentage / 100;
    const totalChargeAmount = gatewayCharge + commissionAmount;
    
    if (transactionType === 'type_01') {
      const amountToCustomer = amount - totalChargeAmount;
      setCalculations({
        swipeAmount: amount,
        totalChargePercentage: totalCharge,
        gatewayPercentage,
        gatewayCharge,
        commissionPercentage,
        commissionAmount,
        totalChargeAmount,
        amountToCustomer,
        profit: commissionAmount,
      });
    } else {
      const payToCard = parseFloat(payToCardAmount) || 0;
      const baseDifference = payToCard - amount;
      const netAmount = baseDifference + totalChargeAmount;
      
      let pendingCollection = 0;
      let pendingPayment = 0;
      let outcomeType = 'balanced';
      
      if (netAmount > 0) {
        pendingCollection = netAmount;
        outcomeType = 'collection';
      } else if (netAmount < 0) {
        pendingPayment = Math.abs(netAmount);
        outcomeType = 'payment';
      }
      
      setCalculations({
        payToCardAmount: payToCard,
        swipeAmount: amount,
        totalChargePercentage: totalCharge,
        gatewayPercentage,
        gatewayCharge,
        commissionPercentage,
        commissionAmount,
        totalChargeAmount,
        baseDifference,
        netAmount,
        pendingCollection,
        pendingPayment,
        outcomeType,
        profit: commissionAmount,
      });
    }
  };

  useEffect(() => {
    calculateAmounts();
  }, [swipeAmount, totalChargePercentage, selectedServer, payToCardAmount, transactionType]);

  const handleSubmit = async () => {
    if (!selectedCustomer || !selectedCard) {
      toast.error('Please fill all required fields');
      return;
    }
    
    if (transactionType === 'type_01') {
      if (!selectedServer || !swipeAmount || !totalChargePercentage) {
        toast.error('Please fill all required fields');
        return;
      }
      const gatewayPercentage = selectedServer.charge_percentage;
      if (parseFloat(totalChargePercentage) < gatewayPercentage) {
        toast.error(`Total charges must be at least ${gatewayPercentage}% (PG charges)`);
        return;
      }
    }
    
    if (transactionType === 'type_02') {
      if (!payToCardAmount || paySources.length === 0) {
        toast.error('Please add pay sources');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (transactionType === 'type_01') {
        await api.post('/transactions/type01', {
          customer_id: selectedCustomer.id,
          card_id: selectedCard.id,
          swipe_gateway_id: selectedServer.gateway_id,
          swipe_server_id: selectedServer.server_id,
          swipe_amount: parseFloat(swipeAmount),
          total_charge_percentage: parseFloat(totalChargePercentage),
          notes,
        });
      } else {
        await api.post('/transactions/type02', {
          customer_id: selectedCustomer.id,
          card_id: selectedCard.id,
          pay_to_card_amount: parseFloat(payToCardAmount),
          pay_sources: paySources.map(s => ({
            gateway_id: s.gateway_id,
            amount: s.amount
          })),
          notes,
        });
      }
      toast.success('Transaction created successfully!');
      setShowSuccessDialog(true);
    } catch (error) {
      toast.error(getApiError(error, 'Failed to create transaction'));
    } finally {
      setSubmitting(false);
    }
  };

  // Compute pay sources total
  const paySourcesTotal = useMemo(() => {
    return paySources.reduce((sum, s) => sum + (s.amount || 0), 0);
  }, [paySources]);
  
  const paySourcesComplete = useMemo(() => {
    const target = parseFloat(payToCardAmount) || 0;
    return target > 0 && Math.abs(paySourcesTotal - target) < 0.01;
  }, [paySourcesTotal, payToCardAmount]);

  const canProceed = () => {
    switch (step) {
      case 1: return !!selectedCustomer;
      case 2: return !!selectedCard;
      case 3: return !!transactionType;
      case 4: 
        if (transactionType === 'type_02') {
          return paySourcesComplete;
        }
        return !!selectedServer;
      case 5: return !!swipeAmount && !!totalChargePercentage && calculations && !calculations.error &&
               (transactionType === 'type_01' || !!payToCardAmount);
      case 6: return true;
      default: return false;
    }
  };

  const nextStepLabel = useMemo(() => {
    if (step >= 6) return null;
    const labels = {
      1: 'Select Card',
      2: 'Choose Type',
      3: null, // auto-advances
      4: transactionType === 'type_02' ? 'Review' : 'Enter Details',
      5: 'Review',
    };
    return labels[step] || null;
  }, [step, transactionType]);

  // Enter key advances steps
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !submitting && step < 6 && canProceed()) {
        e.preventDefault();
        goNext();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [step, submitting]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = () => {
    if (canProceed()) {
      if (step === 4 && transactionType === 'type_02') {
        // Type 02: Skip step 5, go directly to review
        setStep(6);
      } else if (step < 6) {
        setStep(step + 1);
      }
    }
  };

  const goBack = () => {
    if (step === 6 && transactionType === 'type_02') {
      // Type 02: Go back to step 4 (skipping step 5)
      setStep(4);
    } else if (step === 4) {
      setShowBackWarning(true);
    } else if (step > 1) {
      setStep(step - 1);
    } else {
      navigate('/transactions');
    }
  };

  const confirmGoBackToType = () => {
    setSelectedPayFromGateway(null);
    setSelectedServer(null);
    setTransactionType(null);
    setPaySources([]);
    setShowBackWarning(false);
    setStep(3);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" data-testid="new-transaction-page">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-4 p-4">
          <Button variant="ghost" size="icon" onClick={goBack} data-testid="back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg sm:text-xl font-semibold">New Transaction</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Step {steps.findIndex(s => s.num === step) + 1} of {steps.length}</p>
          </div>
        </div>
        <div className="px-4 pb-4">
          <StepIndicator currentStep={step} steps={steps} />
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        {/* Step 1: Select Customer */}
        {step === 1 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Select Customer
                </CardTitle>
                <CardDescription>Search by name or phone number</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by phone number..."
                    value={customerSearch}
                    onChange={(e) => handleSearchCustomers(e.target.value)}
                    className="pl-10 h-12 text-base"
                    data-testid="customer-search"
                  />
                </div>

                {/* Recent Customers */}
                {!customerSearch && recentCustomers.length > 0 && !showAddCustomer && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-3">Recent Customers</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {recentCustomers.slice(0, 6).map((customer) => {
                        const pending = pendingByCustomer[customer.id];
                        return (
                        <div
                          key={customer.id}
                          onClick={() => selectCustomer(customer)}
                          className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                            selectedCustomer?.id === customer.id 
                              ? 'border-primary bg-primary/5' 
                              : customer.is_blacklisted 
                                ? 'border-red-200 bg-red-50 dark:bg-red-900/20' 
                                : 'border-transparent hover:border-primary/50 hover:bg-muted/50'
                          }`}
                          data-testid={`recent-customer-${customer.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{customer.name}</p>
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {customer.phone}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              {customer.is_blacklisted && (
                                <AlertTriangle className="w-5 h-5 text-red-500" />
                              )}
                              {transactionType !== 'type_01' && pending && pending.count > 0 && (
                                <div className="text-right">
                                  <p className="text-xs font-semibold text-amber-600">{formatCurrency(pending.amount)}</p>
                                  <p className="text-xs text-amber-500">{pending.count} pending</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Search Results */}
                {customerSearch && !showAddCustomer && (
                  <div className="space-y-3">
                    {customers.length === 0 ? (
                      <div className="text-center py-8">
                        <User className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                        <p className="font-medium">No customers found</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          No match for "{customerSearch}"
                        </p>
                        <Button onClick={() => setShowAddCustomer(true)} data-testid="add-customer-from-search">
                          <Plus className="w-4 h-4 mr-2" />
                          Add New Customer
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">{customers.length} customer(s) found</p>
                        {customers.map((customer) => (
                          <div
                            key={customer.id}
                            onClick={() => selectCustomer(customer)}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedCustomer?.id === customer.id 
                                ? 'border-primary bg-primary/5' 
                                : customer.is_blacklisted 
                                  ? 'border-red-200 bg-red-50 dark:bg-red-900/20' 
                                  : 'border-transparent hover:border-primary/50 hover:bg-muted/50'
                            }`}
                            data-testid={`search-customer-${customer.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="w-5 h-5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{customer.name}</p>
                                <p className="text-sm text-muted-foreground">{customer.phone}</p>
                              </div>
                              <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                                {customer.is_blacklisted && (
                                  <Badge variant="destructive">Blacklisted</Badge>
                                )}
                                {transactionType !== 'type_01' && pendingByCustomer[customer.id]?.count > 0 && (
                                  <span className="text-xs font-medium text-amber-600">
                                    {formatCurrency(pendingByCustomer[customer.id].amount)} pending
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Add Customer Inline Form */}
                {showAddCustomer && (
                  <AddCustomerInline
                    onAdd={handleAddCustomer}
                    onCancel={() => setShowAddCustomer(false)}
                    initialPhone={/^\d+$/.test(customerSearch) ? customerSearch : ''}
                  />
                )}

                {/* Add Customer Button (when not searching) */}
                {!customerSearch && !showAddCustomer && (
                  <Separator className="my-4" />
                )}
                {!customerSearch && !showAddCustomer && (
                  <Button 
                    variant="outline" 
                    className="w-full h-12" 
                    onClick={() => setShowAddCustomer(true)}
                    data-testid="add-new-customer-btn"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add New Customer
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2: Select Card */}
        {step === 2 && selectedCustomer && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5" />
                      Select Card
                    </CardTitle>
                    <CardDescription>Choose a card for {selectedCustomer.name}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                    Change Customer
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Selected Customer Info */}
                <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{selectedCustomer.name}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                  </div>
                </div>

                {/* Cards List */}
                {!showAddCard && (
                  <>
                    {selectedCustomer.cards?.length === 0 ? (
                      <div className="text-center py-8">
                        <CreditCard className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                        <p className="font-medium">No cards added</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          Add a card to continue
                        </p>
                        <Button onClick={() => setShowAddCard(true)} data-testid="add-first-card">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Card
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {selectedCustomer.cards.map((card) => (
                          <div
                            key={card.id}
                            onClick={() => selectCard(card)}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedCard?.id === card.id 
                                ? 'border-primary bg-primary/5' 
                                : 'border-transparent hover:border-primary/50 hover:bg-muted/50'
                            }`}
                            data-testid={`card-${card.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-8 rounded bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
                                <CreditCard className="w-5 h-5 text-white" />
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">{card.bank_name}</p>
                                <p className="font-mono text-lg font-medium">•••• {card.last_four_digits}</p>
                              </div>
                            </div>
                            {card.card_network_name && (
                              <Badge variant="secondary" className="mt-2">{card.card_network_name}</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedCustomer.cards?.length > 0 && (
                      <>
                        <Separator />
                        <Button 
                          variant="outline" 
                          className="w-full" 
                          onClick={() => setShowAddCard(true)}
                          data-testid="add-another-card"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add New Card
                        </Button>
                      </>
                    )}
                  </>
                )}

                {/* Add Card Inline Form */}
                {showAddCard && (
                  <AddCardInline
                    onAdd={handleAddCard}
                    onCancel={() => setShowAddCard(false)}
                    customerName={selectedCustomer.name}
                    banks={banks}
                    cardNetworks={cardNetworks}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 3: Select Transaction Type */}
        {step === 3 && selectedCard && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <ArrowDownUp className="w-6 h-6" />
                  Select Transaction Type
                </CardTitle>
                <CardDescription>Choose how you want to process this transaction</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Selected Info Summary */}
                <div className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{selectedCustomer.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    <span className="font-mono">{selectedCard.bank_name} •••• {selectedCard.last_four_digits}</span>
                  </div>
                </div>

                {/* Transaction Type Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Type 01 - Direct Swipe */}
                  <div
                    onClick={() => selectTransactionType('type_01')}
                    className={`p-6 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-lg ${
                      transactionType === 'type_01' 
                        ? 'border-primary bg-primary/5 shadow-md' 
                        : 'border-muted hover:border-primary/50'
                    }`}
                    data-testid="type-01-card"
                  >
                    <div className="text-center space-y-4">
                      <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <Zap className="w-8 h-8 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">Type 01</h3>
                        <p className="text-lg text-primary font-medium">Direct Swipe</p>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-2 text-left bg-muted/50 p-4 rounded-lg">
                        <p className="font-medium text-foreground">How it works:</p>
                        <ol className="list-decimal list-inside space-y-1">
                          <li>Customer's card is swiped</li>
                          <li>Processing fee is deducted</li>
                          <li>Customer receives cash</li>
                        </ol>
                      </div>
                      <div className="pt-2">
                        <Badge variant="secondary" className="text-emerald-600 bg-emerald-100">
                          Simple & Fast
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Type 02 - Pay + Swipe */}
                  <div
                    onClick={() => selectTransactionType('type_02')}
                    className={`p-6 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-lg ${
                      transactionType === 'type_02' 
                        ? 'border-primary bg-primary/5 shadow-md' 
                        : 'border-muted hover:border-primary/50'
                    }`}
                    data-testid="type-02-card"
                  >
                    <div className="text-center space-y-4">
                      <div className="w-16 h-16 mx-auto rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <RefreshCw className="w-8 h-8 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">Type 02</h3>
                        <p className="text-lg text-primary font-medium">Pay to Card</p>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-2 text-left bg-muted/50 p-4 rounded-lg">
                        <p className="font-medium text-foreground">How it works:</p>
                        <ol className="list-decimal list-inside space-y-1">
                          <li>Pay amount TO customer's card</li>
                          <li>Collection created automatically</li>
                          <li>Settle via Card, Cash, or Bank from Collections</li>
                        </ol>
                      </div>
                      <div className="pt-2">
                        <Badge variant="secondary" className="text-purple-600 bg-purple-100">
                          Two-Phase Transaction
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Gateway/Pay Sources */}
        {step === 4 && transactionType && (
          <div className="space-y-4">
            {/* ===== TYPE 02: Pay to Card Sources Only ===== */}
            {transactionType === 'type_02' && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <CircleDollarSign className="w-5 h-5 text-purple-600" />
                        Pay to Card
                      </CardTitle>
                      <CardDescription>Enter amount and select gateway sources to pay the customer's card</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setStep(3)} data-testid="change-type-btn">Change Type</Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Context: Selected Customer & Card */}
                  <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{selectedCustomer?.name}</span>
                    </div>
                    <Separator orientation="vertical" className="h-4" />
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedCard ? `${selectedCard.bank_name} - ${selectedCard.card_network_name} - ${selectedCard.last_four_digits}` : ''}</span>
                    </div>
                  </div>

                  {/* Pay to Card Amount */}
                  <div className="p-4 border-2 border-purple-200 rounded-lg space-y-2 bg-purple-50/50 dark:bg-purple-900/10">
                    <Label className="text-purple-700 dark:text-purple-400 font-semibold">Pay to Card Amount *</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      value={payToCardAmount}
                      onChange={(e) => setPayToCardAmount(e.target.value)}
                      onWheel={(e) => e.target.blur()}
                      placeholder="Enter total amount to pay"
                      className="h-12 text-lg font-semibold"
                      data-testid="pay-amount-input"
                    />
                  </div>
                  
                  {parseFloat(payToCardAmount) > 0 && (
                    <>
                      {/* Section header */}
                      <div className="flex items-center gap-2 pt-2">
                        <Wallet className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">
                          Gateway Sources ({paySources.length}/4)
                        </span>
                      </div>

                      {/* Pay Sources List */}
                      {paySources.map((source, idx) => (
                        <div key={source.gateway_id + '-' + source.server_id} className="p-4 rounded-xl border-2 border-purple-200 bg-white dark:bg-background flex items-center gap-4" data-testid={`pay-source-${idx}`}>
                          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-sm font-bold text-purple-600">{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{source.gateway_name}</p>
                            <p className="text-xs text-muted-foreground">
                              Wallet: {formatCurrency(source.wallet_balance)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-purple-700 dark:text-purple-400">{formatCurrency(source.amount)}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => setPaySources(prev => prev.filter((_, i) => i !== idx))} data-testid={`remove-source-${idx}`}>
                            <X className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      ))}
                      
                      {/* Progress Bar */}
                      <div className="space-y-2">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${paySourcesComplete ? 'bg-emerald-500' : 'bg-purple-500'}`}
                            style={{ width: `${Math.min(((paySourcesTotal / (parseFloat(payToCardAmount) || 1)) * 100), 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Allocated</span>
                          <span className={`font-bold ${paySourcesComplete ? 'text-emerald-600' : 'text-purple-600'}`}>
                            {formatCurrency(paySourcesTotal)} / {formatCurrency(parseFloat(payToCardAmount) || 0)}
                            {paySourcesComplete && <Check className="w-4 h-4 inline ml-1" />}
                          </span>
                        </div>
                      </div>
                      
                      {/* Add Source */}
                      {!paySourcesComplete && paySources.length < 4 && (
                        <>
                          <PaySourceAdder
                            gateways={gateways}
                            remaining={Math.round(((parseFloat(payToCardAmount) || 0) - paySourcesTotal) * 100) / 100}
                            onAdd={(source) => setPaySources(prev => [...prev, source])}
                          />
                        </>
                      )}

                      {/* Info: Collection will be created */}
                      {paySourcesComplete && (
                        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-900/10 flex items-start gap-3">
                          <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Collection will be created automatically</p>
                            <p className="text-xs text-muted-foreground mt-0.5">After the card is paid, you can settle the collection via Card Swipe, Cash, or Bank Transfer from the Collections page.</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ===== TYPE 01: Swipe Gateway Selection ===== */}
            {transactionType !== 'type_02' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="w-5 h-5" />
                      Select Payment Gateway
                    </CardTitle>
                    <CardDescription>Choose processing server for the transaction</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setStep(3)}>Change Type</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Context: Selected Customer & Card */}
                <div className="p-3 rounded-lg bg-muted/50 flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{selectedCustomer?.name}</span>
                  </div>
                  <Separator orientation="vertical" className="h-4" />
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    <span>{selectedCard ? `${selectedCard.bank_name} - ${selectedCard.card_network_name} - ${selectedCard.last_four_digits}` : ''}</span>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search gateways..."
                    value={gatewaySearch}
                    onChange={(e) => setGatewaySearch(e.target.value)}
                    className="pl-10"
                    data-testid="gateway-search"
                  />
                </div>

                {/* All Gateways */}
                <Collapsible open={showAllGateways || !!gatewaySearch} onOpenChange={setShowAllGateways}>
                  {!gatewaySearch && (
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between" data-testid="toggle-all-gateways">
                        <span className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          All Gateways ({allServers.length})
                        </span>
                        {showAllGateways ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </CollapsibleTrigger>
                  )}
                  <CollapsibleContent className="space-y-2 mt-2">
                    {allServers.length === 0 ? (
                      <div className="text-center py-6 border border-dashed rounded-lg">
                        <Server className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="font-medium text-muted-foreground">No PG Servers Configured</p>
                      </div>
                    ) : filteredServers.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">No gateways match your search</p>
                    ) : (
                      filteredServers.map((s) => {
                        let lastUsed = false;
                        try {
                          const stored = JSON.parse(localStorage.getItem(`lastGateway_${selectedCustomer?.id}`) || 'null');
                          lastUsed = stored?.gateway_id === s.gateway_id && stored?.server_id === s.server_id;
                        } catch (e) { /* localStorage may be full or disabled */ }
                        return (
                        <div
                          key={`${s.gateway_id}-${s.server_id}`}
                          onClick={() => selectServer(s)}
                          className={`p-3 rounded-lg border cursor-pointer transition-all ${
                            selectedServer?.server_id === s.server_id && selectedServer?.gateway_id === s.gateway_id
                              ? 'border-primary bg-primary/5'
                              : lastUsed
                                ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20'
                                : 'hover:border-primary/50 hover:bg-muted/50'
                          }`}
                          data-testid={`server-${s.server_id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{s.gateway_name}</p>
                                <Badge variant="outline" className="text-xs">{s.server_name}</Badge>
                                {lastUsed && <Badge className="text-xs bg-blue-100 text-blue-600 border-0">Last used</Badge>}
                              </div>
                              <p className="text-sm text-muted-foreground">Balance: {formatCurrency(s.wallet_balance)}</p>
                            </div>
                            <p className="text-lg font-bold">{s.charge_percentage}%</p>
                          </div>
                        </div>
                        );
                      })
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
            )}
          </div>
        )}

        {/* Step 5: Transaction Details */}
        {step === 5 && selectedServer && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Form */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Transaction Details</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setStep(4)}>
                    Change Gateway
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Selected Summary */}
                <div className="p-3 rounded-lg bg-muted/50 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="font-medium">{selectedCustomer.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Card</span>
                    <span className="font-medium">{selectedCard.bank_name} •••• {selectedCard.last_four_digits}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <Badge variant="secondary">
                      {transactionType === 'type_01' ? 'Type 01 - Direct Swipe' : 'Type 02 - Pay to Card'}
                    </Badge>
                  </div>
                  {transactionType === 'type_02' && paySources.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pay Sources</span>
                      <span className="font-medium text-purple-600">{paySources.length} gateway(s)</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Swipe Gateway</span>
                    <span className="font-medium">{selectedServer.gateway_name} / {selectedServer.server_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PG Rate</span>
                    <span className="font-medium">{selectedServer.charge_percentage}%</span>
                  </div>
                </div>

                {/* Type 02: Pay to Card Amount (read-only, set in step 4) */}
                {transactionType === 'type_02' && (
                  <div className="p-4 border-2 border-purple-200 rounded-lg space-y-2 bg-purple-50 dark:bg-purple-900/20">
                    <Label className="text-purple-700 dark:text-purple-400">Pay to Card Amount</Label>
                    <p className="text-lg font-bold">{formatCurrency(parseFloat(payToCardAmount) || 0)}</p>
                    <p className="text-xs text-muted-foreground">{paySources.length} source(s)</p>
                  </div>
                )}

                {/* Swipe Amount */}
                <div className="space-y-2">
                  <Label>Swipe Amount (₹) *</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={swipeAmount}
                    onChange={(e) => setSwipeAmount(e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    placeholder="200000"
                    className="h-12 text-lg"
                    data-testid="swipe-amount-input"
                  />
                </div>

                {/* Total Charges */}
                <div className="space-y-2">
                  <Label>Total Charges % *</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 px-3 font-semibold min-w-[60px]"
                      onClick={() => setTotalChargePercentage(v => Math.max(parseFloat(selectedServer?.charge_percentage || 0), Math.round((parseFloat(v || 0) - 0.5) * 100) / 100).toString())}
                      data-testid="charge-decrement-btn"
                    >−0.5%</Button>
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      value={totalChargePercentage}
                      onChange={(e) => setTotalChargePercentage(e.target.value)}
                      onWheel={(e) => e.target.blur()}
                      placeholder={`Min: ${selectedServer.charge_percentage}%`}
                      className="h-12 text-lg text-center"
                      data-testid="total-charge-input"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 px-3 font-semibold min-w-[60px]"
                      onClick={() => setTotalChargePercentage(v => (Math.round((parseFloat(v || 0) + 0.5) * 100) / 100).toString())}
                      data-testid="charge-increment-btn"
                    >+0.5%</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Minimum: {selectedServer.charge_percentage}% (PG Charges)
                  </p>
                  {selectedCustomer?.charge_note && (
                    <p className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded mt-1" data-testid="charge-note-hint">
                      {selectedCustomer.charge_note}
                    </p>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional notes..."
                    data-testid="notes-input"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Calculation Preview */}
            <Card className="lg:sticky lg:top-32 h-fit">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="w-5 h-5" />
                  Calculation Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {calculations?.error ? (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm">{calculations.errorMessage}</p>
                  </div>
                ) : calculations ? (
                  <div className="space-y-4">
                    {transactionType === 'type_02' && calculations.payToCardAmount > 0 && (
                      <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                        <p className="text-sm text-purple-600 dark:text-purple-400">Pay to Card</p>
                        <p className="text-xl font-bold">{formatCurrency(calculations.payToCardAmount)}</p>
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <div className="flex justify-between py-2 border-b">
                        <span>Swipe Amount</span>
                        <span className="font-semibold">{formatCurrency(calculations.swipeAmount)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b text-amber-600">
                        <span>Total Charges ({calculations.totalChargePercentage}%)</span>
                        <span className="font-semibold">- {formatCurrency(calculations.totalChargeAmount)}</span>
                      </div>
                      <div className="pl-4 text-sm text-muted-foreground space-y-1">
                        <div className="flex justify-between">
                          <span>PG Charges ({calculations.gatewayPercentage}%)</span>
                          <span>{formatCurrency(calculations.gatewayCharge)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-600">
                          <span>Your Commission ({calculations.commissionPercentage}%)</span>
                          <span>{formatCurrency(calculations.commissionAmount)}</span>
                        </div>
                      </div>
                      
                      {transactionType === 'type_01' ? (
                        <div className="flex justify-between items-center py-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 mt-2 border border-emerald-200">
                          <span className="font-medium text-emerald-700">Amount to Customer</span>
                          <span className="text-2xl font-bold text-emerald-600">{formatCurrency(calculations.amountToCustomer)}</span>
                        </div>
                      ) : (
                        <div className={`p-4 rounded-lg mt-2 border-2 ${
                          calculations.outcomeType === 'collection' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300' :
                          calculations.outcomeType === 'payment' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300' :
                          'bg-muted border-muted-foreground/20'
                        }`}>
                          {calculations.outcomeType === 'collection' && (
                            <>
                              <p className="text-sm font-medium text-amber-600 mb-1">Customer owes you</p>
                              <p className="text-3xl font-bold text-amber-600">{formatCurrency(calculations.pendingCollection)}</p>
                              <p className="text-xs text-amber-500 mt-1">Collection will be created automatically</p>
                            </>
                          )}
                          {calculations.outcomeType === 'payment' && (
                            <>
                              <p className="text-sm font-medium text-emerald-600 mb-1">You owe customer</p>
                              <p className="text-3xl font-bold text-emerald-600">{formatCurrency(calculations.pendingPayment)}</p>
                            </>
                          )}
                          {calculations.outcomeType === 'balanced' && (
                            <p className="text-center text-muted-foreground font-medium">Transaction is balanced</p>
                          )}
                        </div>
                      )}
                      
                      <div className="flex justify-between py-2 border-t mt-2">
                        <span className="font-medium">Your Profit</span>
                        <span className="font-bold text-emerald-600">+ {formatCurrency(calculations.profit)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calculator className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Enter amounts to see calculations</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 6: Review & Confirm */}
        {step === 6 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  Review & Confirm
                </CardTitle>
                <CardDescription>Verify all details before confirming</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Customer & Card - side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg border flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold">{selectedCustomer?.name}</p>
                      <p className="text-sm text-muted-foreground">{selectedCustomer?.phone}</p>
                    </div>
                  </div>
                  <div className="p-4 rounded-lg border flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-900/30 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-slate-600" />
                    </div>
                    <div>
                      <p className="font-semibold">{selectedCard?.bank_name} - {selectedCard?.card_network_name}</p>
                      <p className="text-sm text-muted-foreground font-mono">**** {selectedCard?.last_four_digits}</p>
                    </div>
                  </div>
                </div>

                {/* Transaction Type Badge */}
                <div className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Transaction Type</span>
                  <Badge variant="secondary" className="text-sm">
                    {transactionType === 'type_01' ? 'Type 01 - Direct Swipe' : 'Type 02 - Pay to Card'}
                  </Badge>
                </div>

                {/* ===== TYPE 02 REVIEW ===== */}
                {transactionType === 'type_02' && paySources.length > 0 && (
                  <>
                    {/* Pay Sources Breakdown */}
                    <div className="p-4 rounded-lg border-2 border-purple-200 bg-purple-50/30 dark:bg-purple-900/10 space-y-3">
                      <p className="text-sm font-semibold text-purple-700 dark:text-purple-400 flex items-center gap-2">
                        <CircleDollarSign className="w-4 h-4" />
                        Pay to Card Breakdown
                      </p>
                      {paySources.map((s, i) => (
                        <div key={s.gateway_id + '-' + s.server_id} className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-xs font-bold text-purple-600">{i + 1}</div>
                            <span className="text-sm">{s.gateway_name}</span>
                          </div>
                          <span className="font-semibold">{formatCurrency(s.amount)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex items-center justify-between font-bold text-lg">
                        <span>Total</span>
                        <span className="text-purple-700 dark:text-purple-400">{formatCurrency(parseFloat(payToCardAmount) || 0)}</span>
                      </div>
                    </div>

                    {/* Swipe Info */}
                    <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/30 dark:bg-amber-900/10">
                      <div className="flex items-center gap-3">
                        <Clock className="w-5 h-5 text-amber-500" />
                        <div>
                          <p className="font-medium text-amber-700 dark:text-amber-400">Swipe will be completed separately</p>
                          <p className="text-sm text-muted-foreground">A Collection will be created automatically — settle it via Card Swipe, Cash, or Bank Transfer from the Collections page.</p>
                        </div>
                      </div>
                    </div>

                    {/* Notes for Type 02 */}
                    <div className="space-y-2">
                      <Label>Notes (optional)</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Any notes for this transaction..."
                        className="resize-none"
                        rows={2}
                        data-testid="review-notes-input"
                      />
                    </div>
                  </>
                )}

                {/* ===== TYPE 01 REVIEW ===== */}
                {transactionType === 'type_01' && (
                  <>
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">Swipe Gateway</p>
                      <p className="font-semibold text-lg">{selectedServer?.gateway_name} / {selectedServer?.server_name}</p>
                      <p className="text-sm text-muted-foreground">Processing Fee: {selectedServer?.charge_percentage}%</p>
                    </div>

                    {calculations && !calculations.error && (
                      <div className="p-4 rounded-lg border-2 border-primary/20 bg-primary/5 space-y-3">
                        <div className="flex justify-between">
                          <span>Swipe Amount</span>
                          <span className="font-semibold">{formatCurrency(calculations.swipeAmount)}</span>
                        </div>
                        <div className="flex justify-between text-amber-600">
                          <span>Total Charges ({calculations.totalChargePercentage}%)</span>
                          <span className="font-semibold">- {formatCurrency(calculations.totalChargeAmount)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between text-lg">
                          <span className="font-medium">Amount to Customer</span>
                          <span className="font-bold text-emerald-600">{formatCurrency(calculations.amountToCustomer)}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t">
                          <span>Your Profit</span>
                          <span className="font-bold text-emerald-600">+ {formatCurrency(calculations.profit)}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Type 01 notes display */}
                {transactionType === 'type_01' && notes && (
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Notes</p>
                    <p>{notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 bg-background border-t p-4 safe-area-pb z-40">
        <div className="max-w-4xl mx-auto flex gap-3">
          {step > 1 && (
            <Button variant="outline" onClick={goBack} className="flex-1 h-12">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          )}
          {step < 6 ? (
            <Button 
              onClick={goNext} 
              disabled={!canProceed()} 
              className="flex-1 h-12"
              data-testid="next-step-btn"
            >
              {nextStepLabel ? `Next: ${nextStepLabel}` : 'Next'}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button 
              onClick={handleSubmit} 
              disabled={submitting || !canProceed()} 
              className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700"
              data-testid="confirm-transaction-btn"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {transactionType === 'type_02' ? 'Confirm - Pay to Card' : 'Confirm Transaction'}
            </Button>
          )}
        </div>
      </div>

      {/* Success Dialog — Create Another or View Transactions */}
      <Dialog open={showSuccessDialog} onOpenChange={() => navigate('/transactions')}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader className="items-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-2">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <DialogTitle>Transaction Confirmed!</DialogTitle>
            <DialogDescription>
              {transactionType === 'type_02'
                ? 'The card has been paid. A Collection has been created — settle it from the Collections page when ready.'
                : 'Transaction completed successfully.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              className="w-full"
              onClick={() => {
                setShowSuccessDialog(false);
                setStep(2);
                setSelectedCard(null);
                setTransactionType(null);
                setPaySources([]);
                setPayToCardAmount('');
                setSelectedServer(null);
                setSwipeAmount('');
                setTotalChargePercentage('');
                setNotes('');
                setCalculations(null);
              }}
              data-testid="create-another-same-customer-btn"
            >
              New Transaction — {selectedCustomer?.name}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate('/transactions')} data-testid="go-transactions-btn">
              View Transactions
            </Button>
            {transactionType === 'type_02' && (
              <Button variant="outline" className="w-full" onClick={() => navigate('/collections')} data-testid="go-collections-btn">
                Go to Collections
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Back Warning Dialog */}
      <Dialog open={showBackWarning} onOpenChange={setShowBackWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Change Transaction Type?
            </DialogTitle>
            <DialogDescription>
              Going back will reset your gateway selections. You'll need to select them again after changing the transaction type.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowBackWarning(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmGoBackToType}>
              Yes, Go Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
