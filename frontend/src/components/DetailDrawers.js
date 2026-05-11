import React, { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../components/ui/sheet';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  CreditCard,
  User,
  Wallet,
  ArrowRightLeft,
  Clock,
  Phone,
  FileText,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Hash,
  RotateCcw,
  Building2,
  Banknote,
  Receipt,
  AlertTriangle,
  AlertCircle,
  Timer,
} from 'lucide-react';
// UI/UX-02: Use centralized formatters instead of local duplicates
import { formatCurrency, formatDate, formatDateTime } from '@/lib/formatters';

// Section Component
const Section = ({ title, icon: Icon, children, count }) => (
  <Card className="mb-4">
    <CardHeader className="py-3 px-4">
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        {title}
        {count !== undefined && (
          <Badge variant="secondary" className="ml-auto">{count}</Badge>
        )}
      </CardTitle>
    </CardHeader>
    <CardContent className="px-4 pb-4 pt-0">
      {children}
    </CardContent>
  </Card>
);

// Info Row Component
const InfoRow = ({ label, value, badge, badgeVariant = "secondary" }) => (
  <div className="flex justify-between items-center py-1.5">
    <span className="text-sm text-muted-foreground">{label}</span>
    {badge ? (
      <Badge variant={badgeVariant}>{value}</Badge>
    ) : (
      <span className="text-sm font-medium">{value}</span>
    )}
  </div>
);

// Transaction Detail Drawer
export function TransactionDetailDrawer({ open, onClose, transaction, api, onReverse }) {
  const [loading, setLoading] = useState(true);
  const [auditTrail, setAuditTrail] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [linkedData, setLinkedData] = useState({
    walletOperations: [],
    paymentHistory: [],
    customer: null,
  });

  useEffect(() => {
    if (open && transaction) {
      setActiveTab('details');
      fetchLinkedData();
    }
  }, [open, transaction]);

  useEffect(() => {
    if (open && transaction && activeTab === 'audit') {
      fetchAuditTrail();
    }
  }, [activeTab]);

  const fetchAuditTrail = async () => {
    setAuditLoading(true);
    try {
      const res = await api.get(`/transactions/${transaction.id}/audit-trail`);
      setAuditTrail(res.data?.events || []);
    } catch (e) {
      setAuditTrail([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const fetchLinkedData = async () => {
    setLoading(true);
    try {
      // Fetch wallet operations linked to this transaction
      const opsResponse = await api.get(`/wallet-operations?reference_id=${transaction.id}`);
      
      // Fetch customer details if exists
      let customer = null;
      if (transaction.customer_id) {
        try {
          const custResponse = await api.get(`/customers/${transaction.customer_id}`);
          customer = custResponse.data?.customer || custResponse.data || null;
        } catch (e) {
          // Customer fetch failed, will use transaction data as fallback
        }
      }
      
      // Fetch payment history for this transaction
      let paymentHistory = [];
      try {
        const paymentsResponse = await api.get(`/payments?transaction_id=${transaction.id}`);
        // API returns { data: [...], pagination: {...} } structure
        paymentHistory = paymentsResponse.data?.data || paymentsResponse.data || [];
        // Ensure it's always an array
        if (!Array.isArray(paymentHistory)) {
          paymentHistory = [];
        }
      } catch (e) {
        console.warn('Failed to load payment history:', e?.message);
      }

      setLinkedData({
        walletOperations: opsResponse.data || [],
        paymentHistory,
        customer,
      });
    } catch (error) {
      console.error('Failed to load transaction linked data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!transaction) return null;

  const isType01 = transaction.transaction_type === 'type_01';
  const isType02 = transaction.transaction_type === 'type_02';
  const isTransfer = transaction.transaction_type === 'transfer';

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-700';
      case 'payment_pending': return 'bg-amber-100 text-amber-700';
      case 'pending': return 'bg-blue-100 text-blue-700';
      case 'pending_swipe': return 'bg-orange-100 text-orange-700';
      case 'partially_completed': return 'bg-yellow-100 text-yellow-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      case 'reversed': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {transaction.transaction_id || '-'}
            </Badge>
            <Badge className={getStatusColor(transaction.status)}>
              {transaction.status?.replace('_', ' ')}
            </Badge>
          </div>
          <SheetTitle className="text-xl">
            {isTransfer ? 'Wallet Transfer' : isType01 ? 'Direct Swipe' : 'Pay + Swipe'}
          </SheetTitle>
          <SheetDescription>
            {formatDateTime(transaction.created_at)}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mb-4" />

        {/* Simple tab switcher */}
        <div className="flex border rounded-lg mb-4 overflow-hidden">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${activeTab === 'details' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'}`}
            data-testid="txn-tab-details"
          >Details</button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${activeTab === 'audit' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'}`}
            data-testid="txn-tab-audit"
          >Audit Trail</button>
        </div>

        {activeTab === 'details' && (
        <>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            {/* Transaction Summary */}
            <Section title="Transaction Summary" icon={FileText}>
              {isTransfer ? (
                <>
                  <InfoRow label="From Wallet" value={transaction.transfer_from_wallet_name || '-'} />
                  <InfoRow label="To Wallet" value={transaction.transfer_to_wallet_name || '-'} />
                  <InfoRow label="Amount" value={formatCurrency(transaction.transfer_amount)} />
                </>
              ) : (
                <>
                  <InfoRow label="Swipe Amount" value={formatCurrency(transaction.swipe_amount)} />
                  <InfoRow label="Gateway" value={transaction.swipe_gateway_name || '-'} />
                  <InfoRow label="Server" value={transaction.swipe_server_name || '-'} />
                  <InfoRow 
                    label="Gateway Charges" 
                    value={transaction.transaction_type === 'type_02' && transaction.swipe_history?.length > 1
                      ? formatCurrency(transaction.gateway_charge_amount)
                      : `${formatCurrency(transaction.gateway_charge_amount)} (${transaction.gateway_charge_percentage}%)`} 
                  />
                  <InfoRow 
                    label="Commission" 
                    value={transaction.transaction_type === 'type_02' && transaction.swipe_history?.length > 1
                      ? formatCurrency(transaction.commission_amount)
                      : `${formatCurrency(transaction.commission_amount)} (${transaction.commission_percentage}%)`} 
                  />
                  {isType02 && (
                    <>
                      <Separator className="my-2" />
                      <InfoRow label="Pay to Card Amount" value={formatCurrency(transaction.total_pay_to_card || transaction.pay_to_card_amount)} />
                      {transaction.pay_sources && transaction.pay_sources.length > 1 ? (
                        <div className="mt-1 p-2 bg-muted/50 rounded text-xs space-y-1">
                          <p className="font-medium text-muted-foreground">Pay Sources ({transaction.pay_sources.length})</p>
                          {transaction.pay_sources.map((ps, i) => (
                            <div key={i} className="flex justify-between">
                              <span>{ps.gateway_name} ({ps.wallet_name})</span>
                              <span className="font-medium">{formatCurrency(ps.amount)}</span>
                            </div>
                          ))}
                        </div>
                      ) : transaction.pay_sources && transaction.pay_sources.length === 1 ? (
                        <InfoRow label="Pay Gateway" value={transaction.pay_sources[0].gateway_name || '-'} />
                      ) : (
                        <InfoRow label="Pay Gateway" value={transaction.pay_to_card_gateway_name || '-'} />
                      )}
                      {(transaction.status === 'pending_swipe' || transaction.status === 'partially_completed') && (
                        <>
                          <InfoRow label="Total Swiped" value={formatCurrency(transaction.total_swiped || 0)} />
                          <InfoRow label="Pending Swipe" value={formatCurrency(transaction.pending_swipe_amount || 0)} badge badgeVariant="destructive" />
                        </>
                      )}
                      {transaction.swipe_history && transaction.swipe_history.length > 1 && (
                        <div className="mt-2 p-2 bg-muted/50 rounded text-xs space-y-1">
                          <p className="font-medium text-muted-foreground">Swipe History ({transaction.swipe_history.length})</p>
                          {transaction.swipe_history.map((sh, i) => (
                            <div key={i} className="flex justify-between">
                              <span>{sh.gateway_name} ({sh.server_name})</span>
                              <span className="font-medium">{formatCurrency(sh.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <Separator className="my-2" />
                  {transaction.amount_to_customer > 0 && (
                    <InfoRow 
                      label="Amount to Customer" 
                      value={formatCurrency(transaction.amount_to_customer)} 
                      badge 
                      badgeVariant="default"
                    />
                  )}
                  {transaction.pending_amount > 0 && (
                    <InfoRow 
                      label="Pending Collection" 
                      value={formatCurrency(transaction.pending_amount)} 
                      badge 
                      badgeVariant="destructive"
                    />
                  )}
                  {transaction.pending_charges_amount > 0 && (
                    <InfoRow 
                      label="Charges Due from Customer" 
                      value={formatCurrency(transaction.pending_charges_amount)} 
                      badge 
                      badgeVariant="destructive"
                    />
                  )}
                </>
              )}
            </Section>

            {/* Customer Info (if not transfer) */}
            {!isTransfer && linkedData.customer && (
              <Section title="Customer Information" icon={User}>
                <InfoRow label="Customer ID" value={linkedData.customer.customer_id || '-'} badge />
                <InfoRow label="Name" value={linkedData.customer.name} />
                <InfoRow label="Phone" value={linkedData.customer.phone} />
                <InfoRow label="Cards" value={`${linkedData.customer.cards?.length || 0} cards`} />
                {transaction.card_details && (
                  <InfoRow label="Used Card" value={transaction.card_details} />
                )}
                {linkedData.customer.is_blacklisted && (
                  <div className="mt-2 p-2 bg-red-50 rounded text-red-700 text-sm">
                    Blacklisted: {linkedData.customer.blacklist_reason}
                  </div>
                )}
              </Section>
            )}

            {/* Wallet Operations */}
            <Section 
              title="Wallet Operations" 
              icon={Wallet} 
              count={linkedData.walletOperations.length}
            >
              {linkedData.walletOperations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wallet operations found</p>
              ) : (
                <div className="space-y-2">
                  {linkedData.walletOperations.map((op) => (
                    <div 
                      key={op.id} 
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        {op.operation_type === 'credit' || op.operation_type === 'transfer_in' ? (
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-600" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {op.operation_id || '-'}
                            </Badge>
                            <span className="text-sm font-medium">{op.wallet_name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{op.notes}</p>
                        </div>
                      </div>
                      <span className={`font-semibold ${
                        op.operation_type === 'credit' || op.operation_type === 'transfer_in' 
                          ? 'text-emerald-600' 
                          : 'text-red-600'
                      }`}>
                        {op.operation_type === 'credit' || op.operation_type === 'transfer_in' ? '+' : '-'}
                        {formatCurrency(op.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Payment History (for Type 01) */}
            {isType01 && transaction.amount_to_customer > 0 && (
              <Section 
                title="Payment History" 
                icon={ArrowRightLeft} 
                count={linkedData.paymentHistory.length}
              >
                {linkedData.paymentHistory.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No payments made yet</p>
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">Remaining: </span>
                      <span className="font-semibold text-amber-600">
                        {formatCurrency(transaction.amount_remaining_to_customer || transaction.amount_to_customer)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {linkedData.paymentHistory.map((payment) => (
                      <div 
                        key={payment.id} 
                        className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium">{formatDate(payment.created_at)}</p>
                          <p className="text-xs text-muted-foreground">
                            via {payment.payment_source || 'Cash'}
                          </p>
                        </div>
                        <span className="font-semibold text-emerald-600">
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>
                    ))}
                    <Separator className="my-2" />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Paid</span>
                      <span className="font-semibold text-emerald-600">
                        {formatCurrency(transaction.amount_paid_to_customer || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Remaining</span>
                      <span className="font-semibold text-amber-600">
                        {formatCurrency(transaction.amount_remaining_to_customer || 0)}
                      </span>
                    </div>
                  </div>
                )}
              </Section>
            )}

            {/* User Tracking Info */}
            {(transaction.user_email || transaction.ip_address) && (
              <Section title="Audit Trail" icon={Clock}>
                <InfoRow label="Created By" value={transaction.created_by_name || '-'} />
                {transaction.user_email && (
                  <InfoRow label="User Email" value={transaction.user_email} />
                )}
                {transaction.ip_address && (
                  <InfoRow label="IP Address" value={transaction.ip_address} />
                )}
                {transaction.is_locked && (
                  <div className="mt-2 p-2 bg-blue-50 rounded text-blue-700 text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Locked on {formatDate(transaction.locked_at)}
                  </div>
                )}
              </Section>
            )}

            {/* Reverse Transaction Button */}
            {onReverse && transaction.status !== 'reversed' && !transaction.is_locked && !isTransfer && (
              <div className="pt-4 mt-4 border-t">
                <Button 
                  variant="destructive" 
                  className="w-full"
                  onClick={() => onReverse(transaction)}
                  data-testid="reverse-txn-btn"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reverse Transaction
                </Button>
              </div>
            )}

            {/* Reversed Info */}
            {transaction.status === 'reversed' && transaction.reversal_details && (
              <div className="pt-4 mt-4 border-t">
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="font-medium text-red-700 mb-2">Transaction Reversed</p>
                  <div className="text-sm text-red-600 space-y-1">
                    <p><span className="text-muted-foreground">Reason:</span> {transaction.reversal_details.reversal_reason}</p>
                    <p><span className="text-muted-foreground">Reversed by:</span> {transaction.reversal_details.reversed_by_name}</p>
                    <p><span className="text-muted-foreground">Reversed at:</span> {formatDateTime(transaction.reversal_details.reversed_at)}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        </>
        )}

        {activeTab === 'audit' && (
            auditLoading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : auditTrail.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No audit events found</p>
            ) : (
              <div className="relative" data-testid="audit-trail-timeline">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                
                <div className="space-y-0">
                  {auditTrail.map((event, idx) => {
                    const colorMap = {
                      blue: 'bg-blue-500', emerald: 'bg-emerald-500', red: 'bg-red-500',
                      amber: 'bg-amber-500', indigo: 'bg-indigo-500', gray: 'bg-gray-400',
                    };
                    const iconMap = {
                      'plus-circle': FileText, 'check-circle': TrendingUp,
                      'x-circle': AlertTriangle, 'undo-2': RotateCcw,
                      'trending-up': TrendingUp, 'trending-down': TrendingDown,
                      'file-plus': FileText, 'receipt': Receipt, 'banknote': Banknote,
                    };
                    const IconComp = iconMap[event.icon] || Clock;
                    const dotColor = colorMap[event.color] || 'bg-gray-400';
                    
                    return (
                      <div key={idx} className="relative pl-10 pb-6" data-testid={`audit-event-${idx}`}>
                        {/* Timeline dot */}
                        <div className={`absolute left-2.5 w-3 h-3 rounded-full ${dotColor} ring-2 ring-background`} />
                        
                        <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <IconComp className={`w-4 h-4 flex-shrink-0 text-${event.color}-600`} />
                              <span className="text-sm font-medium truncate">{event.title}</span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span>{event.timestamp ? formatDateTime(event.timestamp) : '-'}</span>
                            {event.user && <span>by {event.user}</span>}
                          </div>
                          {event.details && (event.details.operation_id || event.details.wallet || event.details.payment_id) && (
                            <div className="mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground space-y-0.5">
                              {event.details.operation_id && <p>Op: {event.details.operation_id}</p>}
                              {event.details.wallet && <p>Wallet: {event.details.wallet}</p>}
                              {event.details.gateway && <p>Gateway: {event.details.gateway}</p>}
                              {event.details.balance_before !== undefined && (
                                <p>Balance: {formatCurrency(event.details.balance_before)} &rarr; {formatCurrency(event.details.balance_after)}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
        )}
      </SheetContent>
    </Sheet>
  );
}

// Payment Detail Drawer
export function PaymentDetailDrawer({ open, onClose, payment, api }) {
  const [loading, setLoading] = useState(true);
  const [linkedData, setLinkedData] = useState({
    transaction: null,
    settlements: [],
    walletOperations: [],
    customer: null,
  });

  useEffect(() => {
    if (open && payment) {
      fetchLinkedData();
    }
  }, [open, payment]);

  const fetchLinkedData = async () => {
    setLoading(true);
    try {
      // The payment object is actually the transaction for Payments page
      // Fetch customer
      let customer = null;
      if (payment.customer_id) {
        try {
          const custResponse = await api.get(`/customers/${payment.customer_id}`);
          customer = custResponse.data?.customer || custResponse.data || null;
        } catch (e) {
          console.warn('Failed to load customer for payment:', e?.message);
        }
      }

      // Fetch wallet operations
      let walletOperations = [];
      try {
        const opsResponse = await api.get(`/wallet-operations?reference_id=${payment.id}`);
        walletOperations = opsResponse.data || [];
        // Ensure walletOperations is always an array
        if (!Array.isArray(walletOperations)) {
          walletOperations = [];
        }
      } catch (e) {
        console.warn('Failed to load wallet operations:', e?.message);
      }

      // Fetch payment settlements
      let settlements = [];
      try {
        const settlementsResponse = await api.get(`/payments?transaction_id=${payment.id}`);
        // API returns paginated response with data array
        settlements = settlementsResponse.data?.data || settlementsResponse.data || [];
        // Ensure settlements is always an array
        if (!Array.isArray(settlements)) {
          settlements = [];
        }
      } catch (e) {
        console.warn('Failed to load settlements:', e?.message);
      }

      setLinkedData({
        transaction: payment,
        settlements,
        walletOperations,
        customer,
      });
    } catch (error) {
      console.error('Failed to load payment linked data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!payment) return null;

  // Normalize fields: history items use different field names than pending items
  const amountToCustomer = payment.amount_to_customer || payment.total_to_customer || 0;
  const totalPaid = payment.amount_paid_to_customer || payment.cumulative_paid || 0;
  const remaining = payment.amount_remaining_to_customer ?? payment.amount_remaining ?? amountToCustomer;
  const displayTxnId = payment.transaction_id || payment.transaction_id_readable || '-';
  const isHistoryItem = !!payment.paid_at || !!payment.payment_source_name;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {displayTxnId}
            </Badge>
            <Badge className={remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
              {remaining > 0 ? 'Pending' : 'Paid'}
            </Badge>
          </div>
          <SheetTitle className="text-xl">Payment Details</SheetTitle>
          <SheetDescription>
            {formatDateTime(payment.created_at || payment.paid_at)}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mb-4" />

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            {/* Payment Summary */}
            <Section title="Payment Summary" icon={FileText}>
              {isHistoryItem ? (
                <>
                  <InfoRow label="Payment Amount" value={formatCurrency(payment.amount)} badge badgeVariant="default" />
                  <InfoRow label="Total to Customer" value={formatCurrency(amountToCustomer)} />
                  <InfoRow label="Cumulative Paid" value={formatCurrency(totalPaid)} />
                  <InfoRow label="Remaining" value={formatCurrency(remaining)} badge badgeVariant={remaining > 0 ? "destructive" : "default"} />
                </>
              ) : (
                <>
                  <InfoRow label="Total to Pay" value={formatCurrency(amountToCustomer)} />
                  <InfoRow label="Paid" value={formatCurrency(totalPaid)} badge badgeVariant="default" />
                  <InfoRow label="Remaining" value={formatCurrency(remaining)} badge badgeVariant={remaining > 0 ? "destructive" : "default"} />
                </>
              )}
              <Separator className="my-2" />
              <InfoRow label="Swipe Amount" value={formatCurrency(payment.swipe_amount)} />
              {(payment.gateway_charge_amount > 0 || !isHistoryItem) && (
                <InfoRow label="Gateway Charges" value={formatCurrency(payment.gateway_charge_amount || 0)} />
              )}
              {(payment.commission_amount > 0 || !isHistoryItem) && (
                <InfoRow label="Commission" value={formatCurrency(payment.commission_amount || 0)} />
              )}
            </Section>

            {/* Customer Info - Show from payment data if customer API call failed */}
            <Section title="Customer Information" icon={User}>
              {linkedData.customer ? (
                <>
                  <InfoRow label="Customer ID" value={linkedData.customer.customer_id || '-'} badge />
                  <InfoRow label="Name" value={linkedData.customer.name} />
                  <InfoRow label="Phone" value={linkedData.customer.phone || '-'} />
                  {linkedData.customer.email && (
                    <InfoRow label="Email" value={linkedData.customer.email} />
                  )}
                </>
              ) : (
                <>
                  <InfoRow label="Customer ID" value={payment.customer_id_readable || '-'} badge />
                  <InfoRow label="Name" value={payment.customer_name || '-'} />
                </>
              )}
              {payment.card_details && (
                <InfoRow label="Card Used" value={payment.card_details} />
              )}
            </Section>

            {/* Gateway Information */}
            {(payment.gateway_name || payment.server_name) && (
              <Section title="Gateway Information" icon={CreditCard}>
                <InfoRow label="Gateway" value={payment.gateway_name || '-'} />
                {payment.server_name && (
                  <InfoRow label="Server" value={payment.server_name} />
                )}
                {payment.charge_percent !== undefined && (
                  <InfoRow label="Charge Rate" value={`${payment.charge_percent}%`} />
                )}
              </Section>
            )}

            {/* Timeline */}
            <Section title="Timeline" icon={Clock}>
              <InfoRow label="Transaction Date" value={formatDateTime(payment.created_at)} />
              {payment.days_pending !== undefined && (
                <InfoRow label="Days Pending" value={`${payment.days_pending} days`} badge badgeVariant={payment.days_pending > 7 ? "destructive" : "secondary"} />
              )}
              {payment.payment_history && payment.payment_history.length > 0 && (
                <InfoRow label="Payment History" value={`${payment.payment_history.length} payment(s)`} badge />
              )}
            </Section>

            {/* Payment Details - Enhanced with missing fields */}
            {(payment.payment_method || payment.reference_number || payment.payment_source_name || payment.notes) && (
              <Section title="Payment Details" icon={Receipt}>
                {payment.payment_source_name && (
                  <InfoRow label="Payment Source" value={payment.payment_source_name} />
                )}
                {payment.payment_method && (
                  <InfoRow label="Payment Method" value={payment.payment_method === 'bank_transfer' ? 'Bank Transfer' : payment.payment_method === 'cash' ? 'Cash' : payment.payment_method} badge />
                )}
                {payment.reference_number && (
                  <InfoRow label="Reference Number" value={payment.reference_number} />
                )}
                {payment.created_by_name && (
                  <InfoRow label="Processed By" value={payment.created_by_name} />
                )}
                {payment.notes && (
                  <>
                    <Separator className="my-2" />
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{payment.notes}</p>
                    </div>
                  </>
                )}
              </Section>
            )}

            {/* Settlement History */}
            <Section title="Settlement History" icon={ArrowRightLeft} count={linkedData.settlements.length}>
              {linkedData.settlements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No settlements yet</p>
              ) : (
                <div className="space-y-2">
                  {linkedData.settlements.map((settlement) => (
                    <div 
                      key={settlement.id} 
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium">{formatDate(settlement.created_at)}</p>
                        <p className="text-xs text-muted-foreground">
                          {settlement.payment_source || 'Cash'} - {settlement.created_by_name || 'System'}
                        </p>
                      </div>
                      <span className="font-semibold text-emerald-600">
                        {formatCurrency(settlement.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Wallet Operations */}
            <Section title="Wallet Operations" icon={Wallet} count={linkedData.walletOperations.length}>
              {linkedData.walletOperations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wallet operations found</p>
              ) : (
                <div className="space-y-2">
                  {linkedData.walletOperations.map((op) => (
                    <div 
                      key={op.id} 
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        {op.operation_type === 'credit' || op.operation_type === 'transfer_in' ? (
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-600" />
                        )}
                        <div>
                          <Badge variant="outline" className="font-mono text-xs">{op.operation_id || '-'}</Badge>
                          <span className="ml-2 text-sm">{op.wallet_name}</span>
                        </div>
                      </div>
                      <span className={`font-semibold ${
                        op.operation_type === 'credit' || op.operation_type === 'transfer_in' 
                          ? 'text-emerald-600' 
                          : 'text-red-600'
                      }`}>
                        {formatCurrency(op.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Collection Detail Drawer
export function CollectionDetailDrawer({ open, onClose, collection, api }) {
  const [loading, setLoading] = useState(true);
  const [linkedData, setLinkedData] = useState({
    transaction: null,
    settlements: [],
    walletOperations: [],
    customer: null,
  });

  useEffect(() => {
    if (open && collection) {
      fetchLinkedData();
    }
  }, [open, collection]);

  const fetchLinkedData = async () => {
    setLoading(true);
    try {
      // Detect if this is a history item (flattened settlement) vs pending (full collection)
      const isHistorySettlement = collection.cumulative_settled !== undefined;
      // Use correct collection ID for API lookups
      const collectionId = isHistorySettlement ? collection.pending_payment_id : collection.id;
      
      // Fetch transaction if we have transaction_id
      let transaction = null;
      const txnId = collection.transaction_id_internal || collection.transaction_id;
      if (txnId) {
        try {
          const txnResponse = await api.get(`/transactions/${txnId}`);
          transaction = txnResponse.data;
        } catch (e) {
          console.warn('Failed to load linked transaction:', e?.message);
        }
      }

      // Fetch customer
      let customer = null;
      const custId = collection.customer_id_internal || collection.customer_id;
      if (custId) {
        try {
          const custResponse = await api.get(`/customers/${custId}`);
          customer = custResponse.data?.customer || custResponse.data || null;
        } catch (e) {
          console.warn('Failed to load customer for collection:', e?.message);
        }
      }

      // Fetch wallet operations related to the collection (use collection ID, not settlement ID)
      let walletOperations = [];
      if (collectionId) {
        try {
          const opsResponse = await api.get(`/wallet-operations?reference_id=${collectionId}`);
          walletOperations = opsResponse.data || [];
          if (!Array.isArray(walletOperations)) {
            walletOperations = [];
          }
        } catch (e) {
          console.warn('Failed to load wallet operations for collection:', e?.message);
        }
      }

      // Get settlements from the collection itself, or fetch from parent if history item
      let settlements = collection.settlements || [];
      if (isHistorySettlement && settlements.length === 0 && collectionId) {
        try {
          const parentRes = await api.get(`/collections?status=all&search=`);
          // Fallback: the settlement data is within this item itself
        } catch (e) {
          console.warn('Failed to load parent collection:', e?.message);
        }
        // For history items, create a settlement entry from the item's own data
        settlements = [{
          id: collection.id,
          amount: collection.amount,
          method: collection.payment_type || 'Cash',
          wallet_name: collection.wallet_name,
          settled_at: collection.settled_at,
          settled_by_name: collection.settled_by_name,
        }];
      }

      setLinkedData({
        transaction,
        settlements,
        walletOperations,
        customer,
      });
    } catch (error) {

    } finally {
      setLoading(false);
    }
  };

  if (!collection) return null;

  // Detect history settlement vs pending collection
  // History-enriched items have cumulative_settled computed by the aggregation pipeline
  const isHistorySettlement = collection.cumulative_settled !== undefined;
  // For history items: total_due_amount = collection's full amount, amount = settlement amount
  // For pending items: amount = total due, settled_amount = what's been collected
  const totalDue = isHistorySettlement ? (collection.total_due_amount || collection.amount || 0) : (collection.amount || 0);
  const collected = isHistorySettlement ? (collection.settled_amount ?? collection.amount ?? 0) : (collection.settled_amount || 0);
  const remaining = isHistorySettlement ? (collection.running_balance_after ?? (totalDue - collected)) : (totalDue - collected);
  const displayTxnId = collection.transaction_id_readable || collection.transaction_id || '-';
  // Compute is_full_settlement with fallback when backend doesn't provide it
  const isFullSettlement = collection.is_full_settlement ??
    (isHistorySettlement
      ? (collection.running_balance_after ?? 0) <= 1.0
      : (totalDue > 0 && collected >= totalDue));

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {displayTxnId}
            </Badge>
            <Badge className={remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
              {isHistorySettlement ? (isFullSettlement ? 'Full Settlement' : 'Partial Settlement') : (remaining > 0 ? 'Pending' : 'Collected')}
            </Badge>
          </div>
          <SheetTitle className="text-xl">Collection Details</SheetTitle>
          <SheetDescription>
            {formatDateTime(collection.settled_at || collection.created_at)}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mb-4" />

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            {/* Collection Summary */}
            <Section title="Collection Summary" icon={FileText}>
              {isHistorySettlement ? (
                <>
                  <InfoRow label="Settlement Amount" value={formatCurrency(collection.amount)} badge badgeVariant="default" />
                  <InfoRow label="Total Due (Collection)" value={formatCurrency(totalDue)} />
                  <InfoRow label="Total Collected" value={formatCurrency(collected)} />
                  {collection.wallet_name && (
                    <InfoRow label="Wallet" value={collection.wallet_name} />
                  )}
                  {collection.settled_by_name && (
                    <InfoRow label="Settled By" value={collection.settled_by_name} />
                  )}
                </>
              ) : (
                <>
                  <InfoRow label="Total Due" value={formatCurrency(totalDue)} />
                  <InfoRow label="Collected" value={formatCurrency(collected)} badge badgeVariant="default" />
                  <InfoRow label="Remaining" value={formatCurrency(remaining)} badge badgeVariant={remaining > 0 ? "destructive" : "default"} />
                </>
              )}
              
              {collection.breakdown && (
                <>
                  <Separator className="my-2" />
                  <p className="text-xs text-muted-foreground mb-1">Breakdown</p>
                  <InfoRow label="Commission" value={formatCurrency(collection.breakdown.commission || collection.commission_amount)} />
                  <InfoRow label="Gateway Charges" value={formatCurrency(collection.breakdown.gateway_charges || collection.gateway_charge_amount)} />
                </>
              )}
            </Section>

            {/* Service Charge Info - shown only for service_charge collections */}
            {collection.source === 'service_charge' && (
              <Section title="Service Charge Details" icon={AlertCircle}>
                {collection.parent_collection_id && (
                  <InfoRow label="Parent Collection" value={collection.parent_collection_id} badge />
                )}
                {collection.charge_breakdown && (
                  <>
                    <InfoRow label="PG Recovery" value={formatCurrency(collection.charge_breakdown.pg_recovery || 0)} />
                    <InfoRow label="Commission" value={formatCurrency(collection.charge_breakdown.commission || 0)} />
                  </>
                )}
                <InfoRow label="Source" value="Service Charge" badge badgeVariant="secondary" />
              </Section>
            )}

            {/* Customer Info - Show from collection data if customer API call failed */}
            <Section title="Customer Information" icon={User}>
              {linkedData.customer ? (
                <>
                  <InfoRow label="Customer ID" value={linkedData.customer.customer_id || '-'} badge />
                  <InfoRow label="Name" value={linkedData.customer.name} />
                  <InfoRow label="Phone" value={linkedData.customer.phone || '-'} />
                  {linkedData.customer.email && (
                    <InfoRow label="Email" value={linkedData.customer.email} />
                  )}
                </>
              ) : (
                <>
                  <InfoRow label="Customer ID" value={collection.customer_id_readable || '-'} badge />
                  <InfoRow label="Name" value={collection.customer_name || '-'} />
                </>
              )}
              {collection.card_details && (
                <InfoRow label="Card Used" value={collection.card_details} />
              )}
            </Section>

            {/* Gateway Information */}
            {(collection.gateway_name || collection.server_name) && (
              <Section title="Gateway Information" icon={CreditCard}>
                <InfoRow label="Gateway" value={collection.gateway_name || '-'} />
                {collection.server_name && (
                  <InfoRow label="Server" value={collection.server_name} />
                )}
              </Section>
            )}

            {/* Original Transaction */}
            {linkedData.transaction && (
              <Section title="Original Transaction" icon={CreditCard}>
                <InfoRow label="Type" value={
                  linkedData.transaction.transaction_type === 'type_02'
                    ? (linkedData.transaction.swipe_amount > 0 && linkedData.transaction.pay_to_card_amount > 0
                        ? 'Pay + Swipe'
                        : linkedData.transaction.pay_to_card_amount > 0
                          ? 'Pay to Card'
                          : 'Card Swipe')
                    : 'Direct'
                } />
                {linkedData.transaction.swipe_amount > 0 && (
                  <InfoRow label="Swipe Amount" value={formatCurrency(linkedData.transaction.swipe_amount)} />
                )}
                {linkedData.transaction.pay_to_card_amount > 0 && (
                  <InfoRow label="Pay to Card" value={formatCurrency(linkedData.transaction.pay_to_card_amount)} />
                )}
                <InfoRow label="Gateway" value={linkedData.transaction.swipe_gateway_name || '-'} />
              </Section>
            )}

            {/* Timeline */}
            <Section title="Timeline" icon={Clock}>
              <InfoRow label="Transaction Date" value={formatDateTime(collection.created_at)} />
              {collection.days_pending !== undefined && (
                <InfoRow label="Days Pending" value={`${collection.days_pending} days`} badge badgeVariant={collection.days_pending > 7 ? "destructive" : "secondary"} />
              )}
            </Section>

            {/* Collection Details - Enhanced with missing fields */}
            {(collection.wallet_name || collection.payment_type || collection.notes || collection.settled_by_name) && (
              <Section title="Collection Details" icon={Receipt}>
                {collection.wallet_name && (
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-muted-foreground">Received Into</span>
                    <div className="flex items-center gap-1">
                      {collection.wallet_type === 'bank' ? (
                        <Building2 className="w-3 h-3 text-blue-500" />
                      ) : (
                        <Banknote className="w-3 h-3 text-emerald-500" />
                      )}
                      <span className="text-sm font-medium">{collection.wallet_name}</span>
                    </div>
                  </div>
                )}
                {collection.payment_type && (
                  <InfoRow label="Payment Type" value={collection.payment_type} badge />
                )}
                {(collection.settled_by_name || collection.created_by_name) && (
                  <InfoRow label="Processed By" value={collection.settled_by_name || collection.created_by_name} />
                )}
                {collection.notes && (
                  <>
                    <Separator className="my-2" />
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{collection.notes}</p>
                    </div>
                  </>
                )}
              </Section>
            )}

            {/* Settlement History */}
            <Section title="Settlement History" icon={ArrowRightLeft} count={linkedData.settlements.filter(s => !s.voided).length}>
              {linkedData.settlements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No settlements yet</p>
              ) : (
                <div className="space-y-2">
                  {linkedData.settlements.map((settlement, idx) => (
                    <div 
                      key={idx} 
                      className={`flex items-center justify-between p-2 rounded-lg ${settlement.voided ? 'bg-red-50 border border-red-200' : 'bg-muted/50'}`}
                    >
                      <div>
                        <p className={`text-sm font-medium ${settlement.voided ? 'line-through text-muted-foreground' : ''}`}>
                          {formatDate(settlement.date || settlement.created_at)}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs text-muted-foreground ${settlement.voided ? 'line-through' : ''}`}>
                            {settlement.method || 'Cash'}
                          </p>
                          {settlement.voided && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">Voided</Badge>
                          )}
                        </div>
                      </div>
                      <span className={`font-semibold ${settlement.voided ? 'line-through text-muted-foreground' : 'text-emerald-600'}`}>
                        {formatCurrency(settlement.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Wallet Operations */}
            <Section title="Wallet Operations" icon={Wallet} count={linkedData.walletOperations.length}>
              {linkedData.walletOperations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wallet operations found</p>
              ) : (
                <div className="space-y-2">
                  {linkedData.walletOperations.map((op) => (
                    <div 
                      key={op.id} 
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                        <div>
                          <Badge variant="outline" className="font-mono text-xs">{op.operation_id || '-'}</Badge>
                          <span className="ml-2 text-sm">{op.wallet_name}</span>
                        </div>
                      </div>
                      <span className="font-semibold text-emerald-600">
                        {formatCurrency(op.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Wallet Operation Detail Drawer
export function WalletOperationDetailDrawer({ open, onClose, operation, api }) {
  const [loading, setLoading] = useState(true);
  const [linkedData, setLinkedData] = useState({
    transaction: null,
    customer: null,
    relatedOperations: [],
  });

  useEffect(() => {
    if (open && operation) {
      fetchLinkedData();
    }
  }, [open, operation]);

  const fetchLinkedData = async () => {
    setLoading(true);
    try {
      // Fetch parent transaction if linked
      let transaction = null;
      if (operation.reference_id && operation.reference_type === 'transaction') {
        try {
          const txnResponse = await api.get(`/transactions/${operation.reference_id}`);
          transaction = txnResponse.data;
        } catch (e) {
          console.warn('Failed to load transaction for wallet op:', e?.message);
        }
      }

      // Fetch customer if linked
      let customer = null;
      if (operation.customer_id) {
        // customer_id here is the readable ID, we need to find by it
        try {
          const custResponse = await api.get(`/customers`);
          const customers = custResponse.data || [];
          customer = customers.find(c => c.customer_id === operation.customer_id);
        } catch (e) {
          console.warn('Failed to load customer for wallet op:', e?.message);
        }
      }

      // Fetch related operations (e.g., both sides of a transfer)
      let relatedOperations = [];
      if (operation.reference_id && operation.reference_type === 'transfer') {
        try {
          const opsResponse = await api.get(`/wallet-operations?reference_id=${operation.reference_id}`);
          relatedOperations = (opsResponse.data || []).filter(op => op.id !== operation.id);
        } catch (e) {
          console.warn('Failed to load related wallet ops:', e?.message);
        }
      }

      setLinkedData({
        transaction,
        customer,
        relatedOperations,
      });
    } catch (error) {
      console.error('Failed to load wallet operation linked data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!operation) return null;

  const isCredit = operation.operation_type === 'credit' || operation.operation_type === 'transfer_in';

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {operation.operation_id || '-'}
            </Badge>
            <Badge className={isCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
              {operation.operation_type?.replace('_', ' ')}
            </Badge>
          </div>
          <SheetTitle className="text-xl">Wallet Operation</SheetTitle>
          <SheetDescription>
            {formatDateTime(operation.created_at)}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mb-4" />

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            {/* Operation Summary */}
            <Section title="Operation Summary" icon={Wallet}>
              <InfoRow label="Wallet" value={operation.wallet_name} />
              <InfoRow label="Wallet Type" value={operation.wallet_type} badge />
              <InfoRow label="Amount" value={
                <span className={isCredit ? 'text-emerald-600' : 'text-red-600'}>
                  {isCredit ? '+' : '-'}{formatCurrency(operation.amount)}
                </span>
              } />
              <Separator className="my-2" />
              <InfoRow label="Balance Before" value={formatCurrency(operation.balance_before)} />
              <InfoRow label="Balance After" value={formatCurrency(operation.balance_after)} />
              {operation.payment_type && (
                <InfoRow label="Payment Type" value={operation.payment_type} badge />
              )}
              {operation.notes && (
                <>
                  <Separator className="my-2" />
                  <p className="text-sm text-muted-foreground">{operation.notes}</p>
                </>
              )}
            </Section>

            {/* Linked Transaction */}
            {operation.transaction_id && (
              <Section title="Linked Transaction" icon={Hash}>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="font-mono">
                      {operation.transaction_id}
                    </Badge>
                  </div>
                  {linkedData.transaction ? (
                    <>
                      <InfoRow label="Type" value={
                        linkedData.transaction.transaction_type === 'type_01' ? 'Direct Swipe' :
                        linkedData.transaction.transaction_type === 'type_02' ? 'Pay + Swipe' : 'Transfer'
                      } />
                      <InfoRow label="Amount" value={formatCurrency(
                        linkedData.transaction.swipe_amount || linkedData.transaction.transfer_amount
                      )} />
                      <InfoRow label="Status" value={linkedData.transaction.status} badge />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Transaction details not available</p>
                  )}
                </div>
              </Section>
            )}

            {/* Linked Customer */}
            {operation.customer_id && (
              <Section title="Linked Customer" icon={User}>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="font-mono">
                      {operation.customer_id}
                    </Badge>
                  </div>
                  {linkedData.customer ? (
                    <>
                      <InfoRow label="Name" value={linkedData.customer.name} />
                      <InfoRow label="Phone" value={linkedData.customer.phone} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Customer details not available</p>
                  )}
                </div>
              </Section>
            )}

            {/* Related Operations (for transfers) */}
            {linkedData.relatedOperations.length > 0 && (
              <Section title="Related Operations" icon={ArrowRightLeft} count={linkedData.relatedOperations.length}>
                <div className="space-y-2">
                  {linkedData.relatedOperations.map((relOp) => (
                    <div 
                      key={relOp.id} 
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        {relOp.operation_type === 'transfer_in' ? (
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-600" />
                        )}
                        <div>
                          <Badge variant="outline" className="font-mono text-xs">{relOp.operation_id || '-'}</Badge>
                          <span className="ml-2 text-sm">{relOp.wallet_name}</span>
                        </div>
                      </div>
                      <span className={`font-semibold ${
                        relOp.operation_type === 'transfer_in' ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {relOp.operation_type === 'transfer_in' ? '+' : '-'}
                        {formatCurrency(relOp.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Audit Info */}
            <Section title="Audit Trail" icon={Clock}>
              <InfoRow label="Created By" value={operation.created_by_name || '-'} />
              <InfoRow label="Reference Type" value={operation.reference_type || 'manual'} badge />
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Expense Detail Drawer
export function ExpenseDetailDrawer({ open, onClose, expense, api }) {
  const [loading, setLoading] = useState(true);
  const [linkedData, setLinkedData] = useState({
    wallet: null,
    expenseType: null,
    walletOperation: null,
  });

  useEffect(() => {
    if (open && expense) {
      fetchLinkedData();
    }
  }, [open, expense]);

  const fetchLinkedData = async () => {
    setLoading(true);
    try {
      // Fetch wallet details
      let wallet = null;
      if (expense.wallet_id) {
        try {
          const walletResponse = await api.get(`/wallets/${expense.wallet_id}`);
          wallet = walletResponse.data;
        } catch (e) {
          console.warn('Failed to load wallet for expense:', e?.message);
        }
      }

      // Fetch expense type details
      let expenseType = null;
      if (expense.expense_type_id) {
        try {
          const typesResponse = await api.get('/expense-types');
          const types = typesResponse.data || [];
          expenseType = types.find(t => t.id === expense.expense_type_id);
        } catch (e) {
          console.warn('Failed to load expense types:', e?.message);
        }
      }

      // Fetch related wallet operation
      let walletOperation = null;
      try {
        const opsResponse = await api.get(`/wallet-operations?reference_id=${expense.id}`);
        const ops = opsResponse.data || [];
        walletOperation = ops.length > 0 ? ops[0] : null;
      } catch (e) {
        console.warn('Failed to load wallet operation for expense:', e?.message);
      }

      setLinkedData({
        wallet,
        expenseType,
        walletOperation,
      });
    } catch (error) {
      console.error('Failed to load expense linked data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!expense) return null;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {expense.expense_id || expense.id?.slice(0, 8) || '-'}
            </Badge>
            <Badge className="bg-red-100 text-red-700">
              Expense
            </Badge>
          </div>
          <SheetTitle className="text-xl">Expense Details</SheetTitle>
          <SheetDescription>
            {formatDateTime(expense.expense_date || expense.created_at)}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mb-4" />

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            {/* Expense Summary */}
            <Section title="Expense Summary" icon={FileText}>
              <InfoRow label="Amount" value={
                <span className="text-red-600 font-semibold">
                  -{formatCurrency(expense.amount)}
                </span>
              } />
              <InfoRow label="Expense Type" value={expense.expense_type_name || linkedData.expenseType?.name || '-'} badge />
              <InfoRow label="Date" value={formatDate(expense.expense_date || expense.created_at)} />
              {expense.description && (
                <>
                  <Separator className="my-2" />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Description</p>
                    <p className="text-sm">{expense.description}</p>
                  </div>
                </>
              )}
            </Section>

            {/* Vendor Information */}
            {(expense.vendor_name || expense.reference_number) && (
              <Section title="Vendor Information" icon={User}>
                {expense.vendor_name && (
                  <InfoRow label="Vendor Name" value={expense.vendor_name} />
                )}
                {expense.reference_number && (
                  <InfoRow label="Reference/Invoice #" value={expense.reference_number} badge />
                )}
              </Section>
            )}

            {/* Payment Source */}
            <Section title="Payment Source" icon={Wallet}>
              <InfoRow label="Wallet" value={expense.wallet_name || linkedData.wallet?.name || '-'} />
              <InfoRow label="Wallet Type" value={expense.wallet_type || linkedData.wallet?.wallet_type || '-'} badge />
              {linkedData.walletOperation && (
                <>
                  <Separator className="my-2" />
                  <InfoRow label="Balance Before" value={formatCurrency(linkedData.walletOperation.balance_before)} />
                  <InfoRow label="Balance After" value={formatCurrency(linkedData.walletOperation.balance_after)} />
                </>
              )}
            </Section>

            {/* Audit Trail */}
            <Section title="Audit Trail" icon={Clock}>
              <InfoRow label="Created By" value={expense.created_by_name || '-'} />
              <InfoRow label="Created At" value={formatDateTime(expense.created_at)} />
              {expense.updated_at && expense.updated_at !== expense.created_at && (
                <InfoRow label="Last Updated" value={formatDateTime(expense.updated_at)} />
              )}
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

