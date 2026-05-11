import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
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
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { 
  ArrowLeft, CreditCard, Plus, Trash2, AlertTriangle, 
  Phone, User, FileText, ArrowLeftRight, Clock, Wallet,
  Banknote, ArrowDownLeft, Loader2, Check, Building2, Percent, Server
} from 'lucide-react';
import { formatCurrency, formatDate , getApiError } from '@/lib/formatters';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const { api, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [txnPagination, setTxnPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loadingMoreTxns, setLoadingMoreTxns] = useState(false);
  const [collections, setCollections] = useState([]);
  const [pendingPayouts, setPendingPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banks, setBanks] = useState([]);
  const [cardNetworks, setCardNetworks] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [gateways, setGateways] = useState([]);
  
  // Dialogs
  const [showCardDialog, setShowCardDialog] = useState(false);
  const [showBlacklistDialog, setShowBlacklistDialog] = useState(false);
  const [showBulkPayDialog, setShowBulkPayDialog] = useState(false);
  const [showBulkCollectDialog, setShowBulkCollectDialog] = useState(false);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  
  // Adjust (set-off) form: allocation maps are { id: amountString }
  const [adjustForm, setAdjustForm] = useState({ reason: '', notes: '' });
  const [adjustPayoutAllocations, setAdjustPayoutAllocations] = useState({});
  const [adjustCollectionAllocations, setAdjustCollectionAllocations] = useState({});
  
  // Credit Score
  const [creditScore, setCreditScore] = useState(null);
  
  // Forms
  const [cardForm, setCardForm] = useState({
    bank_id: '',
    card_network_id: '',
    last_four_digits: '',
  });
  const [blacklistReason, setBlacklistReason] = useState('');
  
  // Bulk Pay state
  const [selectedPayouts, setSelectedPayouts] = useState([]);
  const [bulkPayForm, setBulkPayForm] = useState({
    total_amount: '',
    allocation_method: 'fifo',
    payment_source_type: 'wallet',
    payment_source_id: '',
    payment_method: '',
    reference_number: '',
    notes: '',
  });
  const [manualPayAllocations, setManualPayAllocations] = useState({});
  
  // Bulk Collect state
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [bulkCollectForm, setBulkCollectForm] = useState({
    total_amount: '',
    allocation_method: 'fifo',
    method: 'cash',           // card_swipe | cash | bank_transfer
    gateway_id: '',
    server_id: '',
    charge_percentage: '',
    wallet_id: '',
    payment_type: '',
    notes: '',
  });
  const [manualCollectAllocations, setManualCollectAllocations] = useState({});
  const [gatewayServers, setGatewayServers] = useState([]);
  const [bankPaymentTypes, setBankPaymentTypes] = useState([]);
  
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const [customerRes, banksRes, networksRes, walletsRes, gatewaysRes, payoutsRes] = await Promise.all([
        api.get(`/customers/${id}`),
        api.get('/banks'),
        api.get('/card-networks'),
        api.get('/wallets'),
        api.get('/gateways'),
        api.get(`/payments/pending?customer_id=${id}`),
      ]);
      setCustomer(customerRes.data.customer);
      setTransactions(customerRes.data.transactions);
      setTxnPagination(customerRes.data.transactions_pagination || { page: 1, pages: 1, total: 0 });
      setCollections(customerRes.data.collections);
      setBanks(banksRes.data);
      setCardNetworks(networksRes.data);
      setWallets(walletsRes.data?.filter(w => !w.is_deleted && w.wallet_type !== 'gateway') || []);
      setGateways(gatewaysRes.data?.filter(g => g.is_active && !g.is_deleted) || []);
      setPendingPayouts(payoutsRes.data?.data || []);
      // Fetch credit score in background (non-blocking)
      api.get(`/customers/${id}/credit-score`).then(res => setCreditScore(res.data)).catch(() => {});
    } catch (error) {
      toast.error('Failed to load customer details');
      navigate('/customers');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreTransactions = async () => {
    if (txnPagination.page >= txnPagination.pages) return;
    setLoadingMoreTxns(true);
    try {
      const nextPage = txnPagination.page + 1;
      const res = await api.get(`/customers/${id}?txn_page=${nextPage}&txn_limit=50`);
      setTransactions(prev => [...prev, ...res.data.transactions]);
      setTxnPagination(res.data.transactions_pagination);
    } catch (error) {
      toast.error('Failed to load more transactions');
    } finally {
      setLoadingMoreTxns(false);
    }
  };

  // Filter pending collections (not settled)
  const pendingCollections = useMemo(() => {
    return collections.filter(c => c.status !== 'settled');
  }, [collections]);

  // Calculate totals
  const totalPendingPayouts = useMemo(() => {
    return pendingPayouts.reduce((sum, t) => sum + (t.amount_remaining_to_customer || t.pending_amount || 0), 0);
  }, [pendingPayouts]);

  const totalPendingCollections = useMemo(() => {
    return pendingCollections.reduce((sum, c) => sum + (c.amount - (c.settled_amount || 0)), 0);
  }, [pendingCollections]);

  const handleAddCard = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/customers/${id}/cards`, cardForm);
      toast.success('Card added successfully');
      setShowCardDialog(false);
      setCardForm({ bank_id: '', card_network_id: '', last_four_digits: '' });
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to add card'));
    }
  };

  const handleRemoveCard = async (cardId) => {
    if (!window.confirm('Are you sure you want to remove this card?')) return;
    try {
      await api.delete(`/customers/${id}/cards/${cardId}`);
      toast.success('Card removed successfully');
      fetchData();
    } catch (error) {
      toast.error('Failed to remove card');
    }
  };

  const handleBlacklist = async () => {
    try {
      await api.put(`/customers/${id}`, {
        is_blacklisted: !customer.is_blacklisted,
        blacklist_reason: customer.is_blacklisted ? '' : blacklistReason,
      });
      toast.success(customer.is_blacklisted ? 'Customer removed from blacklist' : 'Customer blacklisted');
      setShowBlacklistDialog(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to update customer');
    }
  };

  // ===== BULK PAY FUNCTIONS =====
  const openBulkPayDialog = () => {
    if (pendingPayouts.length === 0) {
      toast.error('No pending payouts for this customer');
      return;
    }
    setSelectedPayouts(pendingPayouts.map(t => t.id));
    setBulkPayForm({
      total_amount: '',
      allocation_method: 'fifo',
      payment_source_type: 'wallet',
      payment_source_id: '',
      payment_method: '',
      reference_number: '',
      notes: '',
    });
    setManualPayAllocations({});
    setShowBulkPayDialog(true);
  };

  const togglePayoutSelection = (txnId) => {
    setSelectedPayouts(prev => 
      prev.includes(txnId) ? prev.filter(id => id !== txnId) : [...prev, txnId]
    );
  };

  const selectedPayoutItems = useMemo(() => {
    return pendingPayouts.filter(t => selectedPayouts.includes(t.id));
  }, [pendingPayouts, selectedPayouts]);

  const totalSelectedPayouts = useMemo(() => {
    return selectedPayoutItems.reduce((sum, t) => sum + (t.amount_remaining_to_customer || 0), 0);
  }, [selectedPayoutItems]);

  const bulkPayPreview = useMemo(() => {
    if (selectedPayoutItems.length === 0) return [];
    
    const payAmount = bulkPayForm.total_amount 
      ? parseFloat(bulkPayForm.total_amount) 
      : totalSelectedPayouts;
    
    if (bulkPayForm.allocation_method === 'manual') {
      return selectedPayoutItems.map(txn => ({
        ...txn,
        allocated: parseFloat(manualPayAllocations[txn.id] || 0)
      }));
    }
    
    if (bulkPayForm.allocation_method === 'fifo') {
      let remaining = payAmount;
      return [...selectedPayoutItems]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(txn => {
          const allocated = Math.min(remaining, txn.amount_remaining_to_customer || 0);
          remaining -= allocated;
          return { ...txn, allocated };
        });
    }
    
    // Proportional — guard against division by zero
    return selectedPayoutItems.map(txn => ({
      ...txn,
      allocated: totalSelectedPayouts > 0
        ? Math.round(((txn.amount_remaining_to_customer || 0) / totalSelectedPayouts) * payAmount * 100) / 100
        : 0
    }));
  }, [selectedPayoutItems, bulkPayForm, manualPayAllocations, totalSelectedPayouts]);

  const handleBulkPayment = async (e) => {
    e.preventDefault();
    if (selectedPayouts.length === 0) {
      toast.error('Please select at least one transaction');
      return;
    }
    if (!bulkPayForm.payment_source_id) {
      toast.error('Please select a payment source');
      return;
    }
    
    setSubmitting(true);
    try {
      const payAmount = bulkPayForm.total_amount 
        ? parseFloat(bulkPayForm.total_amount) 
        : totalSelectedPayouts;
      
      const payload = {
        customer_id: id,
        transaction_ids: selectedPayouts,
        total_amount: payAmount,
        allocation_method: bulkPayForm.allocation_method,
        payment_source_type: bulkPayForm.payment_source_type,
        payment_source_id: bulkPayForm.payment_source_id,
        payment_method: bulkPayForm.payment_method,
        reference_number: bulkPayForm.reference_number,
        notes: bulkPayForm.notes,
      };
      
      if (bulkPayForm.allocation_method === 'manual') {
        payload.manual_allocations = {};
        selectedPayouts.forEach(txnId => {
          const amt = parseFloat(manualPayAllocations[txnId] || 0);
          if (amt > 0) payload.manual_allocations[txnId] = amt;
        });
      }
      
      await api.post('/payments/bulk', payload);
      toast.success(`Bulk payment successful! Paid ${selectedPayouts.length} transactions`);
      setShowBulkPayDialog(false);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to process bulk payment'));
    } finally {
      setSubmitting(false);
    }
  };

  // ===== ADJUST (SET-OFF) FUNCTIONS =====
  // Offsets pending payouts (money we owe customer) against pending collections
  // (money customer owes us). No real cash moves; uses a virtual wallet for ledger.
  const openAdjustDialog = () => {
    if (pendingPayouts.length === 0 || pendingCollections.length === 0) {
      toast.error('Adjustment requires both pending payouts and pending collections');
      return;
    }
    setAdjustForm({ reason: '', notes: '' });
    setAdjustPayoutAllocations({});
    setAdjustCollectionAllocations({});
    setShowAdjustDialog(true);
  };

  const adjustPayoutTotal = useMemo(() => {
    return Object.values(adjustPayoutAllocations).reduce(
      (sum, v) => sum + (parseFloat(v) || 0),
      0,
    );
  }, [adjustPayoutAllocations]);

  const adjustCollectionTotal = useMemo(() => {
    return Object.values(adjustCollectionAllocations).reduce(
      (sum, v) => sum + (parseFloat(v) || 0),
      0,
    );
  }, [adjustCollectionAllocations]);

  const adjustDiff = useMemo(
    () => Math.round((adjustPayoutTotal - adjustCollectionTotal) * 100) / 100,
    [adjustPayoutTotal, adjustCollectionTotal],
  );
  const adjustBalanced = adjustPayoutTotal > 0 && Math.abs(adjustDiff) < 0.01;

  // Auto-fill the smaller side to balance, capped per-row by remaining
  const handleAutoBalanceAdjust = () => {
    const payoutSelected = Object.entries(adjustPayoutAllocations)
      .filter(([, v]) => parseFloat(v) > 0);
    const collectionSelected = Object.entries(adjustCollectionAllocations)
      .filter(([, v]) => parseFloat(v) > 0);
    if (payoutSelected.length === 0 && collectionSelected.length === 0) {
      // Suggest: select the smaller-total side fully, then mirror it on the other
      const fullPayouts = {};
      pendingPayouts.forEach(t => {
        const rem = t.amount_remaining_to_customer || t.pending_amount || 0;
        if (rem > 0) fullPayouts[t.id] = rem;
      });
      const fullCollections = {};
      pendingCollections.forEach(c => {
        const rem = c.amount - (c.settled_amount || 0);
        if (rem > 0) fullCollections[c.id] = rem;
      });
      const sumP = Object.values(fullPayouts).reduce((a, b) => a + b, 0);
      const sumC = Object.values(fullCollections).reduce((a, b) => a + b, 0);
      if (sumP <= sumC) {
        // Fill payouts fully, distribute the same total across collections FIFO
        setAdjustPayoutAllocations(
          Object.fromEntries(Object.entries(fullPayouts).map(([k, v]) => [k, String(v)])),
        );
        let remaining = sumP;
        const sortedC = [...pendingCollections].sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at),
        );
        const colMap = {};
        for (const c of sortedC) {
          const cap = c.amount - (c.settled_amount || 0);
          const take = Math.min(remaining, cap);
          if (take > 0) {
            colMap[c.id] = String(Math.round(take * 100) / 100);
            remaining -= take;
          }
        }
        setAdjustCollectionAllocations(colMap);
      } else {
        setAdjustCollectionAllocations(
          Object.fromEntries(Object.entries(fullCollections).map(([k, v]) => [k, String(v)])),
        );
        let remaining = sumC;
        const sortedP = [...pendingPayouts].sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at),
        );
        const payMap = {};
        for (const t of sortedP) {
          const cap = t.amount_remaining_to_customer || t.pending_amount || 0;
          const take = Math.min(remaining, cap);
          if (take > 0) {
            payMap[t.id] = String(Math.round(take * 100) / 100);
            remaining -= take;
          }
        }
        setAdjustPayoutAllocations(payMap);
      }
      return;
    }
    if (adjustDiff > 0) {
      // Need more on collection side
      let needed = adjustDiff;
      const next = { ...adjustCollectionAllocations };
      const sortedC = [...pendingCollections].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at),
      );
      for (const c of sortedC) {
        if (needed <= 0) break;
        const cap = c.amount - (c.settled_amount || 0);
        const current = parseFloat(next[c.id] || 0);
        const room = cap - current;
        if (room > 0) {
          const take = Math.min(needed, room);
          next[c.id] = String(Math.round((current + take) * 100) / 100);
          needed -= take;
        }
      }
      setAdjustCollectionAllocations(next);
    } else if (adjustDiff < 0) {
      let needed = -adjustDiff;
      const next = { ...adjustPayoutAllocations };
      const sortedP = [...pendingPayouts].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at),
      );
      for (const t of sortedP) {
        if (needed <= 0) break;
        const cap = t.amount_remaining_to_customer || t.pending_amount || 0;
        const current = parseFloat(next[t.id] || 0);
        const room = cap - current;
        if (room > 0) {
          const take = Math.min(needed, room);
          next[t.id] = String(Math.round((current + take) * 100) / 100);
          needed -= take;
        }
      }
      setAdjustPayoutAllocations(next);
    }
  };

  const handleAdjustSubmit = async (e) => {
    e.preventDefault();
    if (!adjustBalanced) {
      toast.error('Payout and collection totals must be equal and greater than zero');
      return;
    }
    if (!adjustForm.reason || adjustForm.reason.trim().length < 5) {
      toast.error('Please provide a reason (at least 5 characters)');
      return;
    }
    const payouts = Object.entries(adjustPayoutAllocations)
      .map(([txnId, v]) => ({ id: txnId, amount: parseFloat(v) || 0 }))
      .filter(a => a.amount > 0);
    const collections = Object.entries(adjustCollectionAllocations)
      .map(([colId, v]) => ({ id: colId, amount: parseFloat(v) || 0 }))
      .filter(a => a.amount > 0);
    if (payouts.length === 0 || collections.length === 0) {
      toast.error('Allocate amounts to at least one payout and one collection');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/adjustments', {
        customer_id: id,
        payouts,
        collections,
        reason: adjustForm.reason.trim(),
        notes: adjustForm.notes || '',
      });
      toast.success(`Adjusted ${formatCurrency(adjustPayoutTotal)} between payouts and collections`);
      setShowAdjustDialog(false);
      fetchData();
    } catch (error) {
      toast.error(getApiError(error, 'Failed to apply adjustment'));
    } finally {
      setSubmitting(false);
    }
  };

  // ===== BULK COLLECT FUNCTIONS =====
  const openBulkCollectDialog = async () => {
    if (pendingCollections.length === 0) {
      toast.error('No pending collections for this customer');
      return;
    }
    setSelectedCollections(pendingCollections.map(c => c.id));
    setBulkCollectForm({
      total_amount: '',
      allocation_method: 'fifo',
      method: 'cash',
      gateway_id: '',
      server_id: '',
      charge_percentage: '',
      wallet_id: '',
      payment_type: '',
      notes: '',
    });
    setManualCollectAllocations({});
    setGatewayServers([]);
    try {
      const res = await api.get('/bank-payment-types');
      setBankPaymentTypes(res.data || []);
    } catch (e) {
      setBankPaymentTypes([]);
    }
    setShowBulkCollectDialog(true);
  };

  const handleBulkCollectGatewayChange = async (gatewayId) => {
    setBulkCollectForm(prev => ({ ...prev, gateway_id: gatewayId, server_id: '', charge_percentage: '' }));
    if (!gatewayId) { setGatewayServers([]); return; }
    try {
      const res = await api.get(`/gateways/${gatewayId}/servers`);
      setGatewayServers(res.data?.filter(s => s.is_active) || []);
    } catch (e) {
      setGatewayServers([]);
    }
  };

  const toggleCollectionSelection = (collectionId) => {
    setSelectedCollections(prev => 
      prev.includes(collectionId) ? prev.filter(id => id !== collectionId) : [...prev, collectionId]
    );
  };

  const selectedCollectionItems = useMemo(() => {
    return pendingCollections.filter(c => selectedCollections.includes(c.id));
  }, [pendingCollections, selectedCollections]);

  const totalSelectedCollections = useMemo(() => {
    return selectedCollectionItems.reduce((sum, c) => sum + (c.amount - (c.settled_amount || 0)), 0);
  }, [selectedCollectionItems]);

  const bulkCollectPreview = useMemo(() => {
    if (selectedCollectionItems.length === 0) return [];
    
    const collectAmount = bulkCollectForm.total_amount 
      ? parseFloat(bulkCollectForm.total_amount) 
      : totalSelectedCollections;
    
    if (bulkCollectForm.allocation_method === 'manual') {
      return selectedCollectionItems.map(col => ({
        ...col,
        remaining: col.amount - (col.settled_amount || 0),
        allocated: parseFloat(manualCollectAllocations[col.id] || 0)
      }));
    }
    
    if (bulkCollectForm.allocation_method === 'fifo') {
      let remaining = collectAmount;
      return [...selectedCollectionItems]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(col => {
          const colRemaining = col.amount - (col.settled_amount || 0);
          const allocated = Math.min(remaining, colRemaining);
          remaining -= allocated;
          return { ...col, remaining: colRemaining, allocated };
        });
    }
    
    // Proportional — guard against division by zero
    return selectedCollectionItems.map(col => {
      const colRemaining = col.amount - (col.settled_amount || 0);
      return {
        ...col,
        remaining: colRemaining,
        allocated: totalSelectedCollections > 0
          ? Math.round((colRemaining / totalSelectedCollections) * collectAmount * 100) / 100
          : 0
      };
    });
  }, [selectedCollectionItems, bulkCollectForm, manualCollectAllocations, totalSelectedCollections]);

  const handleBulkCollection = async (e) => {
    e.preventDefault();
    if (selectedCollections.length === 0) {
      toast.error('Please select at least one collection');
      return;
    }

    const { method, gateway_id, server_id, charge_percentage, wallet_id, payment_type } = bulkCollectForm;

    if (method === 'card_swipe' && (!gateway_id || !server_id)) {
      toast.error('Please select a gateway and server for card swipe');
      return;
    }
    if ((method === 'cash' || method === 'bank_transfer') && !wallet_id) {
      toast.error('Please select a wallet');
      return;
    }
    if (method === 'bank_transfer' && !payment_type) {
      toast.error('Please select a payment type for bank transfer');
      return;
    }

    const chargePercent = parseFloat(charge_percentage) || 0;

    const allocations = bulkCollectPreview.filter(c => c.allocated > 0);
    if (allocations.length === 0) {
      toast.error('No valid allocation to process');
      return;
    }

    // NOTE: No balance check needed here — bulk collect is a CREDIT operation.
    // Money flows FROM the customer INTO the wallet. The wallet's current balance is irrelevant.
    const totalGross = allocations.reduce((sum, c) => sum + c.allocated, 0);

    setSubmitting(true);
    try {
      // Single atomic call — all-or-nothing, backend rolls back on any failure
      const payload = {
        customer_id: id,
        method,
        charge_percentage: chargePercent,
        notes: bulkCollectForm.notes,
        settlements: allocations.map(c => ({
          collection_id: c.id,
          gross_amount: c.allocated,
        })),
      };
      if (method === 'card_swipe') {
        payload.gateway_id = gateway_id;
        payload.server_id = server_id;
      } else {
        payload.wallet_id = wallet_id;
        if (method === 'bank_transfer') payload.payment_type = payment_type;
      }

      const res = await api.post('/collections/bulk-unified', payload);
      const count = res.data?.settled_count || allocations.length;
      toast.success(`Settled ${count} collection${count !== 1 ? 's' : ''} successfully`);
      setShowBulkCollectDialog(false);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Bulk settlement failed. No changes were saved.');
    } finally {
      setSubmitting(false);
    }
  };

  // Payment sources for bulk pay
  const paymentSources = useMemo(() => {
    if (bulkPayForm.payment_source_type === 'wallet') {
      return wallets.map(w => ({ id: w.id, name: w.name, balance: w.balance }));
    } else {
      return gateways.map(g => ({ id: g.id, name: g.name, balance: g.wallet_balance }));
    }
  }, [bulkPayForm.payment_source_type, wallets, gateways]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton rounded" />
        <div className="h-64 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="customer-detail-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/customers')} data-testid="back-btn">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="page-title">{customer?.name}</h1>
            {customer?.is_blacklisted && (
              <Badge variant="destructive">Blacklisted</Badge>
            )}
          </div>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <Phone className="w-4 h-4" />
            {customer?.phone}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              const res = await api.get(`/customers/${id}/ledger`, { responseType: 'blob' });
              const url = window.URL.createObjectURL(new Blob([res.data]));
              const a = document.createElement('a');
              a.href = url;
              a.download = `${customer?.customer_id || 'Customer'}_Ledger.xlsx`;
              a.click();
              window.URL.revokeObjectURL(url);
              toast.success('Ledger downloaded');
            } catch (e) {
              toast.error('Failed to download ledger');
            }
          }}
          data-testid="download-ledger-btn"
        >
          <FileText className="w-4 h-4 mr-2" />
          Download Ledger
        </Button>
        <Button
          variant={customer?.is_blacklisted ? 'outline' : 'destructive'}
          onClick={() => setShowBlacklistDialog(true)}
          data-testid="blacklist-btn"
        >
          <AlertTriangle className="w-4 h-4 mr-2" />
          {customer?.is_blacklisted ? 'Remove from Blacklist' : 'Blacklist'}
        </Button>
      </div>

      {/* Blacklist Warning */}
      {customer?.is_blacklisted && (
        <div className="blacklist-warning">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Blacklisted Customer</span>
          </div>
          <p className="mt-1 text-sm">{customer?.blacklist_reason || 'No reason specified'}</p>
        </div>
      )}

      {/* Charge Note Banner */}
      {customer?.charge_note && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800" data-testid="charge-note-banner">
          <Percent className="w-4 h-4 shrink-0" />
          <span className="text-sm font-medium">Charge Note:</span>
          <span className="text-sm">{customer.charge_note}</span>
        </div>
      )}

      {/* Customer Info & Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{customer?.name}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium">{customer?.phone}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-amber-600">Pending Payouts</p>
                <p className="text-2xl font-bold text-amber-700">{formatCurrency(totalPendingPayouts)}</p>
                <p className="text-xs text-muted-foreground">{pendingPayouts.length} transaction(s)</p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {pendingPayouts.length > 0 && hasPermission('payments') && (
                  <Button size="sm" variant="outline" onClick={openBulkPayDialog} data-testid="bulk-pay-btn">
                    <Banknote className="w-4 h-4 mr-1" />
                    Bulk Pay
                  </Button>
                )}
                {pendingPayouts.length > 0 && pendingCollections.length > 0 && hasPermission('adjustments') && (
                  <Button size="sm" variant="outline" onClick={openAdjustDialog} data-testid="adjust-btn">
                    <ArrowLeftRight className="w-4 h-4 mr-1" />
                    Adjust
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600">Pending Collections</p>
                <p className="text-2xl font-bold text-purple-700">{formatCurrency(totalPendingCollections)}</p>
                <p className="text-xs text-muted-foreground">{pendingCollections.length} item(s)</p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {pendingCollections.length > 0 && hasPermission('collections') && (
                  <Button size="sm" variant="outline" onClick={openBulkCollectDialog} data-testid="bulk-collect-btn">
                    <ArrowDownLeft className="w-4 h-4 mr-1" />
                    Bulk Collect
                  </Button>
                )}
                {pendingPayouts.length > 0 && pendingCollections.length > 0 && hasPermission('adjustments') && (
                  <Button size="sm" variant="outline" onClick={openAdjustDialog} data-testid="adjust-btn-2">
                    <ArrowLeftRight className="w-4 h-4 mr-1" />
                    Adjust
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Credit Score Card */}
      {creditScore && (
        <Card data-testid="credit-score-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`relative w-16 h-16 rounded-full flex items-center justify-center border-4 ${
                  creditScore.grade_color === 'emerald' ? 'border-emerald-500 bg-emerald-50' :
                  creditScore.grade_color === 'blue' ? 'border-blue-500 bg-blue-50' :
                  creditScore.grade_color === 'amber' ? 'border-amber-500 bg-amber-50' :
                  'border-red-500 bg-red-50'
                }`}>
                  <span className={`text-xl font-bold ${
                    creditScore.grade_color === 'emerald' ? 'text-emerald-700' :
                    creditScore.grade_color === 'blue' ? 'text-blue-700' :
                    creditScore.grade_color === 'amber' ? 'text-amber-700' :
                    'text-red-700'
                  }`}>{creditScore.score}</span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Credit Score</p>
                  <Badge className={`${
                    creditScore.grade_color === 'emerald' ? 'bg-emerald-100 text-emerald-700' :
                    creditScore.grade_color === 'blue' ? 'bg-blue-100 text-blue-700' :
                    creditScore.grade_color === 'amber' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`} data-testid="credit-score-grade">{creditScore.grade}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {creditScore.components.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{c.name}</span>
                    <span className="font-medium">{c.score}/{c.max}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="cards">
        <TabsList>
          <TabsTrigger value="cards" data-testid="cards-tab">
            <CreditCard className="w-4 h-4 mr-2" />
            Cards ({customer?.cards?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="transactions-tab">
            <ArrowLeftRight className="w-4 h-4 mr-2" />
            Transactions ({transactions.length})
          </TabsTrigger>
          <TabsTrigger value="payouts" data-testid="payouts-tab">
            <Banknote className="w-4 h-4 mr-2" />
            Payouts ({pendingPayouts.length})
          </TabsTrigger>
          <TabsTrigger value="collections" data-testid="collections-tab">
            <ArrowDownLeft className="w-4 h-4 mr-2" />
            Collections ({collections.length})
          </TabsTrigger>
        </TabsList>

        {/* Cards Tab */}
        <TabsContent value="cards">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Credit Cards</CardTitle>
                <Button onClick={() => setShowCardDialog(true)} data-testid="add-card-btn">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Card
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {customer?.cards?.length === 0 ? (
                <div className="empty-state py-8">
                  <CreditCard className="empty-state-icon" />
                  <p className="empty-state-title">No cards added</p>
                  <p className="empty-state-description">Add customer's credit cards to create transactions</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {customer?.cards?.map((card) => (
                    <div
                      key={card.id}
                      className="p-4 rounded-xl border bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800"
                      data-testid={`card-${card.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">{card.bank_name}</p>
                          <p className="font-mono text-lg font-medium mt-1">•••• {card.last_four_digits}</p>
                          <Badge variant="secondary" className="mt-2">{card.card_network_name}</Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveCard(card.id)}
                          data-testid={`remove-card-${card.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <div className="empty-state py-12">
                  <ArrowLeftRight className="empty-state-icon" />
                  <p className="empty-state-title">No transactions yet</p>
                </div>
              ) : (
                <>
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Card</TableHead>
                      <TableHead>Gateway</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((txn) => (
                      <TableRow key={txn.id}>
                        <TableCell>{formatDate(txn.created_at)}</TableCell>
                        <TableCell>
                          <Badge className={txn.transaction_type === 'type_01' ? 'type-badge type-01' : 'type-badge type-02'}>
                            {txn.transaction_type === 'type_01' ? 'Direct' : 'Pay+Swipe'}
                          </Badge>
                        </TableCell>
                        <TableCell>{txn.card_details}</TableCell>
                        <TableCell>{txn.swipe_gateway_name}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(txn.transaction_type === 'type_02' ? (txn.pay_to_card_amount || txn.swipe_amount) : txn.swipe_amount)}</TableCell>
                        <TableCell className="text-right text-emerald-600">{formatCurrency(txn.commission_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
                {txnPagination.page < txnPagination.pages && (
                  <div className="flex justify-center py-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMoreTransactions}
                      disabled={loadingMoreTxns}
                      data-testid="load-more-txns-btn"
                    >
                      {loadingMoreTxns ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : null}
                      Load More ({txnPagination.total - transactions.length} remaining)
                    </Button>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payouts Tab (Pending payouts to customer) */}
        <TabsContent value="payouts">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Pending Payouts</CardTitle>
                  <CardDescription>Money you owe to this customer</CardDescription>
                </div>
                {pendingPayouts.length > 0 && hasPermission('payments') && (
                  <Button onClick={openBulkPayDialog} data-testid="bulk-pay-tab-btn">
                    <Banknote className="w-4 h-4 mr-2" />
                    Bulk Pay ({pendingPayouts.length})
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {pendingPayouts.length === 0 ? (
                <div className="empty-state py-12">
                  <Check className="empty-state-icon text-emerald-500" />
                  <p className="empty-state-title">All paid up!</p>
                  <p className="empty-state-description">No pending payouts for this customer</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Transaction</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPayouts.map((txn) => (
                      <TableRow key={txn.id}>
                        <TableCell>{formatDate(txn.created_at)}</TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">{txn.id}</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(txn.amount_to_customer)}</TableCell>
                        <TableCell className="text-right text-emerald-600">
                          {formatCurrency(txn.paid_amount || 0)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-amber-600">
                          {formatCurrency(txn.amount_remaining_to_customer || txn.pending_amount || 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Collections Tab */}
        <TabsContent value="collections">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Collections</CardTitle>
                  <CardDescription>Money this customer owes you</CardDescription>
                </div>
                {pendingCollections.length > 0 && hasPermission('collections') && (
                  <Button onClick={openBulkCollectDialog} data-testid="bulk-collect-tab-btn">
                    <ArrowDownLeft className="w-4 h-4 mr-2" />
                    Bulk Collect ({pendingCollections.length})
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {collections.length === 0 ? (
                <div className="empty-state py-12">
                  <Clock className="empty-state-icon" />
                  <p className="empty-state-title">No collections</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Settled</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {collections.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.created_at)}</TableCell>
                        <TableCell>
                          <Badge className={payment.status === 'settled' ? 'status-completed' : 'status-pending'}>
                            {payment.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(payment.amount)}</TableCell>
                        <TableCell className="text-right text-emerald-600">{formatCurrency(payment.settled_amount || 0)}</TableCell>
                        <TableCell className="text-right text-amber-600">{formatCurrency(payment.amount - (payment.settled_amount || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Card Dialog */}
      <Dialog open={showCardDialog} onOpenChange={setShowCardDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Credit Card</DialogTitle>
            <DialogDescription>Add a new credit card for this customer</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCard}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Bank *</Label>
                <SearchableSelect
                  value={cardForm.bank_id}
                  onValueChange={(v) => setCardForm({ ...cardForm, bank_id: v })}
                  placeholder="Search bank..."
                  items={banks.map(b => ({ value: b.id, label: b.name }))}
                  triggerTestId="bank-select"
                />
              </div>
              <div className="space-y-2">
                <Label>Card Network *</Label>
                <SearchableSelect
                  value={cardForm.card_network_id}
                  onValueChange={(v) => setCardForm({ ...cardForm, card_network_id: v })}
                  placeholder="Search network..."
                  items={cardNetworks.map(n => ({ value: n.id, label: n.name }))}
                  triggerTestId="network-select"
                />
              </div>
              <div className="space-y-2">
                <Label>Last 4 Digits *</Label>
                <Input
                  value={cardForm.last_four_digits}
                  onChange={(e) => setCardForm({ ...cardForm, last_four_digits: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="1234"
                  maxLength={4}
                  data-testid="last-four-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCardDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-card-btn">Add Card</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Blacklist Dialog */}
      <Dialog open={showBlacklistDialog} onOpenChange={setShowBlacklistDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{customer?.is_blacklisted ? 'Remove from Blacklist' : 'Blacklist Customer'}</DialogTitle>
            <DialogDescription>
              {customer?.is_blacklisted 
                ? 'This will allow transactions with this customer again.'
                : 'Blacklisted customers cannot make transactions. You can always remove them later.'}
            </DialogDescription>
          </DialogHeader>
          {!customer?.is_blacklisted && (
            <div className="py-4">
              <Label>Reason for blacklisting</Label>
              <Input
                value={blacklistReason}
                onChange={(e) => setBlacklistReason(e.target.value)}
                placeholder="Enter reason..."
                className="mt-2"
                data-testid="blacklist-reason-input"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlacklistDialog(false)}>Cancel</Button>
            <Button 
              variant={customer?.is_blacklisted ? 'default' : 'destructive'}
              onClick={handleBlacklist}
              data-testid="confirm-blacklist-btn"
            >
              {customer?.is_blacklisted ? 'Remove from Blacklist' : 'Blacklist Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Pay Dialog */}
      <Dialog open={showBulkPayDialog} onOpenChange={setShowBulkPayDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5" />
              Bulk Pay - {customer?.name}
            </DialogTitle>
            <DialogDescription>
              Pay multiple pending transactions at once
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkPayment} className="space-y-4">
            {/* Selection */}
            <div className="space-y-2">
              <Label>Select Transactions ({selectedPayouts.length} of {pendingPayouts.length})</Label>
              <div className="max-h-48 overflow-y-auto border rounded-lg">
                {pendingPayouts.map(txn => (
                  <div key={txn.id} className="flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50">
                    <Checkbox
                      checked={selectedPayouts.includes(txn.id)}
                      onCheckedChange={() => togglePayoutSelection(txn.id)}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{formatDate(txn.created_at)}</p>
                      <p className="text-xs text-muted-foreground">{txn.id}</p>
                    </div>
                    <p className="font-medium text-amber-600">{formatCurrency(txn.amount_remaining_to_customer || 0)}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Total Selected: <span className="font-bold">{formatCurrency(totalSelectedPayouts)}</span>
              </p>
            </div>

            <Separator />

            {/* Payment Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Total Amount (optional)</Label>
                <Input
                  type="number"
                  value={bulkPayForm.total_amount}
                  onChange={e => setBulkPayForm({...bulkPayForm, total_amount: e.target.value})}
                  placeholder={`Full: ${formatCurrency(totalSelectedPayouts)}`}
                />
              </div>
              <div className="space-y-2">
                <Label>Allocation Method</Label>
                <Select value={bulkPayForm.allocation_method} onValueChange={v => setBulkPayForm({...bulkPayForm, allocation_method: v})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fifo">FIFO (Oldest First)</SelectItem>
                    <SelectItem value="proportional">Proportional</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Manual Allocations */}
            {bulkPayForm.allocation_method === 'manual' && (
              <div className="space-y-2">
                <Label>Manual Allocations</Label>
                <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                  {selectedPayoutItems.map(txn => (
                    <div key={txn.id} className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{txn.id}</span>
                      <span className="text-sm text-muted-foreground">Max: {formatCurrency(txn.amount_remaining_to_customer || 0)}</span>
                      <Input
                        type="number"
                        className="w-32"
                        value={manualPayAllocations[txn.id] || ''}
                        onChange={e => setManualPayAllocations({...manualPayAllocations, [txn.id]: e.target.value})}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Source */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Type</Label>
                <Select value={bulkPayForm.payment_source_type} onValueChange={v => setBulkPayForm({...bulkPayForm, payment_source_type: v, payment_source_id: ''})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wallet">Wallet</SelectItem>
                    <SelectItem value="gateway">Gateway</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Select {bulkPayForm.payment_source_type === 'wallet' ? 'Wallet' : 'Gateway'}</Label>
                <Select value={bulkPayForm.payment_source_id} onValueChange={v => setBulkPayForm({...bulkPayForm, payment_source_id: v})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentSources.map(src => (
                      <SelectItem key={src.id} value={src.id}>
                        {src.name} ({formatCurrency(src.balance)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment method for bank wallets */}
            {bulkPayForm.payment_source_id && wallets.find(w => w.id === bulkPayForm.payment_source_id && w.wallet_type === 'bank') && (
              <div className="space-y-2">
                <Label>Payment Method *</Label>
                <Select value={bulkPayForm.payment_method} onValueChange={v => setBulkPayForm({...bulkPayForm, payment_method: v})}>
                  <SelectTrigger data-testid="bulk-pay-method-select">
                    <SelectValue placeholder="Select payment method..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bankPaymentTypes.map(t => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Reference Number (optional)</Label>
              <Input
                value={bulkPayForm.reference_number}
                onChange={e => setBulkPayForm({...bulkPayForm, reference_number: e.target.value})}
                placeholder="e.g., Cash, UPI Ref, Check #"
              />
            </div>

            {/* Preview */}
            {bulkPayForm.payment_source_id && bulkPayPreview.length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/50">
                <p className="font-medium mb-2">Allocation Preview</p>
                <div className="space-y-1 text-sm">
                  {bulkPayPreview.filter(p => p.allocated > 0).map(p => (
                    <div key={p.id} className="flex justify-between">
                      <span className="text-muted-foreground">{p.id}</span>
                      <span className="font-medium text-emerald-600">{formatCurrency(p.allocated)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowBulkPayDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || selectedPayouts.length === 0}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Pay {selectedPayouts.length} Transactions
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Collect Dialog */}
      <Dialog open={showBulkCollectDialog} onOpenChange={setShowBulkCollectDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownLeft className="w-5 h-5" />
              Bulk Collect — {customer?.name}
            </DialogTitle>
            <DialogDescription>
              Settle multiple pending collections at once
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkCollection} className="space-y-4">

            {/* Collection Selection */}
            <div className="space-y-2">
              <Label>Select Collections ({selectedCollections.length} of {pendingCollections.length})</Label>
              <div className="max-h-44 overflow-y-auto border rounded-lg">
                {pendingCollections.map(col => (
                  <div key={col.id} className="flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer" onClick={() => toggleCollectionSelection(col.id)}>
                    <Checkbox checked={selectedCollections.includes(col.id)} onCheckedChange={() => toggleCollectionSelection(col.id)} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{col.transaction_id_readable || col.id}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(col.created_at)}</p>
                    </div>
                    <p className="font-medium text-amber-600">{formatCurrency(col.amount - (col.settled_amount || 0))}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Total Selected: <span className="font-bold">{formatCurrency(totalSelectedCollections)}</span>
              </p>
            </div>

            <Separator />

            {/* Amount & Allocation */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Total Amount (optional)</Label>
                <Input
                  type="number"
                  value={bulkCollectForm.total_amount}
                  onChange={e => setBulkCollectForm({...bulkCollectForm, total_amount: e.target.value})}
                  placeholder={`Full: ${formatCurrency(totalSelectedCollections)}`}
                  data-testid="bulk-collect-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Allocation Method</Label>
                <Select value={bulkCollectForm.allocation_method} onValueChange={v => setBulkCollectForm({...bulkCollectForm, allocation_method: v})}>
                  <SelectTrigger data-testid="bulk-collect-allocation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fifo">FIFO (Oldest First)</SelectItem>
                    <SelectItem value="proportional">Proportional</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Manual Allocations */}
            {bulkCollectForm.allocation_method === 'manual' && (
              <div className="space-y-2">
                <Label>Manual Allocations</Label>
                <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                  {selectedCollectionItems.map(col => (
                    <div key={col.id} className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{col.transaction_id_readable || col.id}</span>
                      <span className="text-xs text-muted-foreground">Max: {formatCurrency(col.amount - (col.settled_amount || 0))}</span>
                      <Input
                        type="number"
                        className="w-28"
                        value={manualCollectAllocations[col.id] || ''}
                        onChange={e => setManualCollectAllocations({...manualCollectAllocations, [col.id]: e.target.value})}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Settlement Method */}
            <div className="space-y-3">
              <Label>Settlement Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'card_swipe', label: 'Card Swipe', icon: CreditCard },
                  { value: 'cash', label: 'Cash', icon: Banknote },
                  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building2 },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBulkCollectForm(prev => ({ ...prev, method: value, gateway_id: '', server_id: '', wallet_id: '', payment_type: '' }))}
                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors ${bulkCollectForm.method === value ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}`}
                    data-testid={`bulk-method-${value}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Card Swipe fields */}
            {bulkCollectForm.method === 'card_swipe' && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Server className="w-3 h-3" /> Gateway</Label>
                  <Select value={bulkCollectForm.gateway_id} onValueChange={handleBulkCollectGatewayChange}>
                    <SelectTrigger data-testid="bulk-collect-gateway">
                      <SelectValue placeholder="Select gateway..." />
                    </SelectTrigger>
                    <SelectContent>
                      {gateways.map(g => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {gatewayServers.length > 0 && (
                  <div className="space-y-2">
                    <Label>Server</Label>
                    <Select
                      value={bulkCollectForm.server_id}
                      onValueChange={v => {
                        const srv = gatewayServers.find(s => s.id === v);
                        setBulkCollectForm(prev => ({ ...prev, server_id: v, charge_percentage: srv ? String(srv.charge_percentage) : '' }));
                      }}
                    >
                      <SelectTrigger data-testid="bulk-collect-server">
                        <SelectValue placeholder="Select server..." />
                      </SelectTrigger>
                      <SelectContent>
                        {gatewayServers.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name} ({s.charge_percentage}%)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Percent className="w-3 h-3" /> Total Charge %</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={bulkCollectForm.charge_percentage}
                    onChange={e => setBulkCollectForm(prev => ({ ...prev, charge_percentage: e.target.value }))}
                    placeholder="e.g. 2.5"
                    data-testid="bulk-collect-charge-pct"
                  />
                  <p className="text-xs text-muted-foreground">PG fee + commission. Min = server charge %</p>
                </div>
              </div>
            )}

            {/* Cash fields */}
            {bulkCollectForm.method === 'cash' && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Cash Wallet</Label>
                  <Select value={bulkCollectForm.wallet_id} onValueChange={v => setBulkCollectForm(prev => ({ ...prev, wallet_id: v }))}>
                    <SelectTrigger data-testid="bulk-collect-cash-wallet">
                      <SelectValue placeholder="Select cash wallet..." />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets.filter(w => w.wallet_type === 'cash').map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name} ({formatCurrency(w.balance)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Percent className="w-3 h-3" /> Commission % (optional)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={bulkCollectForm.charge_percentage}
                    onChange={e => setBulkCollectForm(prev => ({ ...prev, charge_percentage: e.target.value }))}
                    placeholder="0"
                    data-testid="bulk-collect-cash-charge"
                  />
                </div>
              </div>
            )}

            {/* Bank Transfer fields */}
            {bulkCollectForm.method === 'bank_transfer' && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Building2 className="w-3 h-3" /> Bank Wallet</Label>
                  <Select value={bulkCollectForm.wallet_id} onValueChange={v => setBulkCollectForm(prev => ({ ...prev, wallet_id: v }))}>
                    <SelectTrigger data-testid="bulk-collect-bank-wallet">
                      <SelectValue placeholder="Select bank wallet..." />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets.filter(w => w.wallet_type === 'bank').map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name} ({formatCurrency(w.balance)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment Type</Label>
                  <Select value={bulkCollectForm.payment_type} onValueChange={v => setBulkCollectForm(prev => ({ ...prev, payment_type: v }))}>
                    <SelectTrigger data-testid="bulk-collect-payment-type">
                      <SelectValue placeholder="Select payment type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {bankPaymentTypes.map(t => (
                        <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Percent className="w-3 h-3" /> Commission % (optional)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={bulkCollectForm.charge_percentage}
                    onChange={e => setBulkCollectForm(prev => ({ ...prev, charge_percentage: e.target.value }))}
                    placeholder="0"
                    data-testid="bulk-collect-bank-charge"
                  />
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                value={bulkCollectForm.notes}
                onChange={e => setBulkCollectForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Reference number, remarks..."
                data-testid="bulk-collect-notes"
              />
            </div>

            {/* Allocation Preview */}
            {bulkCollectPreview.filter(c => c.allocated > 0).length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-sm font-medium mb-2">Allocation Preview</p>
                <div className="space-y-1 text-sm">
                  {bulkCollectPreview.filter(c => c.allocated > 0).map(c => (
                    <div key={c.id} className="flex justify-between">
                      <span className="text-muted-foreground">{c.transaction_id_readable || c.id}</span>
                      <span className="font-medium text-emerald-600">{formatCurrency(c.allocated)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowBulkCollectDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || selectedCollections.length === 0} data-testid="bulk-collect-submit">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Settle {selectedCollections.length} Collection{selectedCollections.length > 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Balance Adjustment (Set-off) Dialog */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5" />
              Balance Adjustment — {customer?.name}
            </DialogTitle>
            <DialogDescription>
              Offset what you owe this customer against what they owe you. No real cash moves;
              the matched amount is netted via a virtual ledger entry on each side.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdjustSubmit} className="space-y-4">
            {/* Reason / Notes */}
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label>Reason *</Label>
                <Input
                  value={adjustForm.reason}
                  onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  placeholder="Why is this adjustment being made? (min 5 chars)"
                  maxLength={500}
                  data-testid="adjust-reason-input"
                />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input
                  value={adjustForm.notes}
                  onChange={e => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                  placeholder="Additional context (optional)"
                  maxLength={1000}
                />
              </div>
            </div>

            <Separator />

            {/* Two-column allocation tables */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Payouts (we owe customer) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1 text-amber-700">
                    <Banknote className="w-4 h-4" /> Pending Payouts (you pay customer)
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {pendingPayouts.length} item(s)
                  </span>
                </div>
                <div className="border rounded-lg max-h-80 overflow-y-auto">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-1/3">Transaction</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead className="text-right w-1/3">Allocate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingPayouts.map(txn => {
                        const remaining = txn.amount_remaining_to_customer || txn.pending_amount || 0;
                        const value = adjustPayoutAllocations[txn.id] || '';
                        const overCap = parseFloat(value || 0) - remaining > 0.01;
                        return (
                          <TableRow key={txn.id}>
                            <TableCell>
                              <div className="font-mono text-xs">{txn.transaction_id || txn.id.slice(0, 8)}</div>
                              <div className="text-xs text-muted-foreground">{formatDate(txn.created_at)}</div>
                            </TableCell>
                            <TableCell className="text-right text-amber-600">
                              {formatCurrency(remaining)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max={remaining}
                                value={value}
                                onChange={e => setAdjustPayoutAllocations(prev => ({
                                  ...prev,
                                  [txn.id]: e.target.value,
                                }))}
                                placeholder="0"
                                className={`h-8 text-right ${overCap ? 'border-destructive' : ''}`}
                                data-testid={`adjust-payout-input-${txn.id}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-sm text-amber-700">
                  Payout total: <span className="font-bold">{formatCurrency(adjustPayoutTotal)}</span>
                </p>
              </div>

              {/* Collections (customer owes us) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1 text-purple-700">
                    <ArrowDownLeft className="w-4 h-4" /> Pending Collections (customer owes you)
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {pendingCollections.length} item(s)
                  </span>
                </div>
                <div className="border rounded-lg max-h-80 overflow-y-auto">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-1/3">Collection</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead className="text-right w-1/3">Allocate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingCollections.map(col => {
                        const remaining = col.amount - (col.settled_amount || 0);
                        const value = adjustCollectionAllocations[col.id] || '';
                        const overCap = parseFloat(value || 0) - remaining > 0.01;
                        return (
                          <TableRow key={col.id}>
                            <TableCell>
                              <div className="font-mono text-xs">
                                {col.pending_payment_id || col.transaction_id_readable || col.id.slice(0, 8)}
                              </div>
                              <div className="text-xs text-muted-foreground">{formatDate(col.created_at)}</div>
                            </TableCell>
                            <TableCell className="text-right text-purple-600">
                              {formatCurrency(remaining)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max={remaining}
                                value={value}
                                onChange={e => setAdjustCollectionAllocations(prev => ({
                                  ...prev,
                                  [col.id]: e.target.value,
                                }))}
                                placeholder="0"
                                className={`h-8 text-right ${overCap ? 'border-destructive' : ''}`}
                                data-testid={`adjust-collection-input-${col.id}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-sm text-purple-700">
                  Collection total: <span className="font-bold">{formatCurrency(adjustCollectionTotal)}</span>
                </p>
              </div>
            </div>

            {/* Net summary */}
            <div className={`rounded-lg p-4 border ${
              adjustBalanced
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200'
            }`}>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Net adjustment amount</p>
                  <p className={`text-2xl font-bold ${adjustBalanced ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {formatCurrency(Math.min(adjustPayoutTotal, adjustCollectionTotal))}
                  </p>
                  {!adjustBalanced && adjustPayoutTotal > 0 && (
                    <p className="text-xs text-amber-700">
                      Difference: {formatCurrency(Math.abs(adjustDiff))}
                      {adjustDiff > 0 ? ' more on payout side' : ' more on collection side'}
                    </p>
                  )}
                  {adjustBalanced && (
                    <p className="text-xs text-emerald-700">Balanced — ready to apply</p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAutoBalanceAdjust}
                  data-testid="adjust-auto-balance-btn"
                >
                  Auto-balance
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdjustDialog(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !adjustBalanced || !adjustForm.reason}
                data-testid="adjust-submit-btn"
              >
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowLeftRight className="w-4 h-4 mr-2" />}
                Apply Adjustment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
