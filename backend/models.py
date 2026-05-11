"""
Fin Flow - Data Models
All MongoDB models with Pydantic
"""
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import uuid


def generate_id():
    return str(uuid.uuid4())


def utc_now():
    return datetime.now(timezone.utc)


# Base model with common fields
class BaseDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=generate_id)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    is_deleted: bool = Field(default=False)


# ============== AUTH & USERS ==============

class OTPSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=generate_id)
    email: str
    otp_hash: str  # Store hashed OTP for security
    user_id: str   # Store user_id for faster session creation
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)


class Session(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=generate_id)
    user_id: str
    token: str
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)
    last_activity: datetime = Field(default_factory=utc_now)


class Module(BaseDocument):
    """Dynamic modules for role permissions"""
    name: str  # e.g., "dashboard", "customers", "transactions"
    display_name: str  # e.g., "Dashboard", "Customers", "Transactions"
    icon: str = "circle"  # lucide icon name
    route: str  # e.g., "/dashboard", "/customers"
    order: int = 0  # Display order in sidebar


class ModuleCreate(BaseModel):
    name: str
    display_name: str
    icon: str = "circle"
    route: str
    order: int = 0


class Role(BaseDocument):
    """Custom roles with module permissions"""
    name: str  # e.g., "SuperAdmin", "Agent"
    description: str = ""
    permissions: List[str] = []  # List of module names with access


class RoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: List[str] = []  # List of module names with access


class User(BaseDocument):
    """System users"""
    email: EmailStr
    password_hash: str
    name: str
    phone: str = ""
    role_id: str
    is_active: bool = True


class AdminPasswordResetRequest(BaseModel):
    new_password: str = Field(..., min_length=12, max_length=128)

    @field_validator('new_password')
    @classmethod
    def validate_password(cls, v):
        import re
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[0-9]', v):
            raise ValueError('Password must contain at least one number')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    name: str
    phone: str = ""
    role_id: str

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        import re as _re
        if not _re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not _re.search(r'[0-9]', v):
            raise ValueError('Password must contain at least one number')
        if not _re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v


class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role_id: Optional[str] = None
    is_active: Optional[bool] = None



# ============== PAYMENT GATEWAYS ==============

class Gateway(BaseDocument):
    """Payment gateways (balance stored in unified wallets collection)"""
    name: str
    description: str = ""
    is_active: bool = True


class GatewayCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    wallet_balance: float = Field(default=0.0, ge=0, le=10000000)


class GatewayUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


# ============== BANKS & CARD NETWORKS ==============

class Bank(BaseDocument):
    """Banks (HDFC, ICICI, SBI, etc.)"""
    name: str
    code: str = ""  # Short code like "HDFC"


class BankCreate(BaseModel):
    name: str
    code: str = ""


class CardNetwork(BaseDocument):
    """Card networks (Visa, Mastercard, RuPay)"""
    name: str
    code: str = ""  # "VISA", "MC", "RUPAY"


class CardNetworkCreate(BaseModel):
    name: str
    code: str = ""


class GatewayServer(BaseDocument):
    """Gateway servers with specific charge percentages"""
    gateway_id: str
    name: str  # e.g., "Server01", "Server02"
    charge_percentage: float
    is_active: bool = True


class GatewayServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    charge_percentage: float = Field(..., ge=0, le=100)


class GatewayServerUpdate(BaseModel):
    name: Optional[str] = None
    charge_percentage: Optional[float] = None
    is_active: Optional[bool] = None



# ============== CUSTOMERS ==============

class CustomerCard(BaseModel):
    """Customer's credit card"""
    id: str = Field(default_factory=generate_id)
    bank_id: str
    bank_name: str = ""
    card_network_id: str
    card_network_name: str = ""
    last_four_digits: str


class Customer(BaseDocument):
    """Customers"""
    customer_id: str = ""  # Human-readable ID: C001, C002, etc.
    name: str
    phone: str
    id_proof: str = ""  # ID proof details
    charge_note: str = ""  # Reminder note for charge % (e.g., "5% standard")
    cards: List[CustomerCard] = []
    is_blacklisted: bool = False
    blacklist_reason: str = ""
    notes: str = ""


class CustomerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    phone: str = Field(..., min_length=1, max_length=20)
    id_proof: str = Field(default="", max_length=100)
    charge_note: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=1000)


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    id_proof: Optional[str] = None
    charge_note: Optional[str] = None
    is_blacklisted: Optional[bool] = None
    blacklist_reason: Optional[str] = None
    notes: Optional[str] = None


class CustomerCardCreate(BaseModel):
    bank_id: str
    card_network_id: str
    last_four_digits: str


# ============== TRANSACTIONS ==============

class Transaction(BaseDocument):
    """
    Transaction Types:
    - type_01: Direct swipe (customer has limit)
    - type_02: Pay to card + Swipe (customer exhausted limit, supports multi-source & two-phase)
    - transfer: Wallet transfer (internal)
    """
    transaction_id: str = ""  # Human-readable ID: T1-0001, T2-0001, TRF-0001
    transaction_type: str  # "type_01", "type_02", or "transfer"
    customer_id: str
    customer_readable_id: str = ""  # Linked customer_id (C001)
    customer_name: str = ""
    card_id: str = ""  # CustomerCard id (optional for transfer)
    card_details: str = ""  # "HDFC - Visa - 1234"
    
    # Type 02: Pay to card details
    pay_to_card_gateway_id: Optional[str] = None
    pay_to_card_gateway_name: str = ""
    pay_to_card_amount: float = 0.0
    
    # Type 02: Multi-source pay tracking
    total_pay_to_card: float = 0.0
    pay_sources_count: int = 0
    
    # Type 02: Swipe tracking (two-phase)
    total_swiped: float = 0.0
    pending_swipe_amount: float = 0.0
    swipe_history: list = Field(default_factory=list)
    
    # Swipe details - now includes server info
    swipe_gateway_id: str = ""
    swipe_gateway_name: str = ""
    swipe_server_id: str = ""  # Gateway server used
    swipe_server_name: str = ""
    swipe_amount: float = 0.0
    gateway_charge_percentage: float = 0.0
    gateway_charge_amount: float = 0.0
    
    # Commission
    commission_percentage: float = 0.0
    commission_amount: float = 0.0
    
    # Final amounts
    amount_to_customer: float = 0.0  # For type_01
    pending_amount: float = 0.0  # For type_02 (commission to collect)
    
    # Customer Payment Tracking (for Type 01)
    customer_payment_status: str = "pending"  # "pending", "partial", "paid"
    amount_paid_to_customer: float = 0.0
    amount_remaining_to_customer: float = 0.0
    
    # Status: payment_pending, completed, pending, pending_swipe, partially_completed, cancelled, reversed
    status: str = "payment_pending"
    is_locked: bool = False
    locked_at: Optional[datetime] = None
    
    # Cancellation tracking
    cancel_reason: str = ""
    cancelled_at: Optional[str] = None
    cancelled_by: str = ""
    cancelled_by_name: str = ""
    
    # Transfer specific fields
    transfer_from_wallet_id: Optional[str] = None
    transfer_from_wallet_name: str = ""
    transfer_to_wallet_id: Optional[str] = None
    transfer_to_wallet_name: str = ""
    transfer_amount: float = 0.0
    
    # User tracking
    user_email: str = ""
    ip_address: str = ""
    user_agent: str = ""
    
    # Meta
    notes: str = ""
    created_by: str = ""
    created_by_name: str = ""


class TransactionType01Create(BaseModel):
    """Create Type 01 transaction - Direct swipe"""
    customer_id: str
    card_id: str
    swipe_gateway_id: str
    swipe_server_id: str
    swipe_amount: float = Field(..., gt=0, le=10000000, description="Amount must be positive and <= 1 crore")
    total_charge_percentage: float = Field(..., ge=0, le=100, description="Total charges to customer must be 0-100%")
    notes: str = Field(default="", max_length=1000)


class PaySourceItem(BaseModel):
    """A single pay source for Type 02 multi-source transaction"""
    gateway_id: str
    amount: float = Field(..., gt=0, le=10000000)


class TransactionType02Create(BaseModel):
    """Create Type 02 transaction - Multi-source Pay to card + Swipe Later"""
    customer_id: str
    card_id: str
    pay_to_card_amount: float = Field(..., gt=0, le=10000000, description="Total pay to card amount")
    pay_sources: list[PaySourceItem] = Field(..., min_length=1, max_length=4)
    notes: str = Field(default="", max_length=1000)


# ============== PENDING PAYMENTS / SETTLEMENTS ==============

class CollectionSettlement(BaseModel):
    """Unified settlement for collections - supports card swipe, cash, and bank transfer"""
    method: str  # "card_swipe", "cash", "bank_transfer"
    gross_amount: float = Field(..., gt=0, le=10000000)  # Amount entered by user
    charge_percentage: float = Field(..., ge=0, le=100)  # Total charges % (PG + Commission) - REQUIRED
    include_charges: bool = False  # Include All Charges mode
    notes: str = ""
    idempotency_key: Optional[str] = None  # Optional dedup key to prevent duplicate submissions
    
    # For card_swipe method
    gateway_id: Optional[str] = None
    server_id: Optional[str] = None
    
    # For cash/bank_transfer method  
    wallet_id: Optional[str] = None
    payment_type: Optional[str] = None  # For bank: NEFT, UPI, QR, etc.


# ============== SETTINGS ==============

class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "app_settings"
    business_name: str = "Fin Flow"
    currency: str = "INR"
    currency_symbol: str = "₹"
    
    # NOTE: SMTP is configured via ENV variables only (SMTP_HOST, SMTP_USER, etc.)
    
    # Security
    session_timeout_minutes: int = 30
    transaction_lock_hours: int = 24
    
    # OTP
    otp_expiry_minutes: int = 5
    
    # Auto Daily Closing
    auto_daily_closing_enabled: bool = False
    auto_daily_closing_time: str = "00:00"  # 24-hour format HH:MM
    auto_closing_email_report: bool = False
    
    # Reconciliation Settings
    reconciliation_enabled: bool = True
    reconciliation_interval_hours: int = 6  # Run every X hours
    
    # Commission & Charges Settings
    default_commission_percentage: float = 1.0  # Default commission % for cash/bank settlements
    min_outstanding_threshold: float = 50.0  # INR, below this -> Charge Write-Off expense


class SettingsUpdate(BaseModel):
    business_name: Optional[str] = None
    # SMTP fields removed - configure via ENV variables
    session_timeout_minutes: Optional[int] = None
    transaction_lock_hours: Optional[int] = None
    otp_expiry_minutes: Optional[int] = None
    auto_daily_closing_enabled: Optional[bool] = None
    auto_daily_closing_time: Optional[str] = None
    auto_closing_email_report: Optional[bool] = None
    reconciliation_enabled: Optional[bool] = None
    reconciliation_interval_hours: Optional[int] = None
    default_commission_percentage: Optional[float] = None
    min_outstanding_threshold: Optional[float] = None


# ============== AUDIT LOG ==============

class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=generate_id)
    user_id: str
    user_name: str
    action: str  # "create", "update", "delete", "login", "logout"
    module: str  # "customers", "transactions", etc.
    entity_id: Optional[str] = None
    details: Dict[str, Any] = {}
    ip_address: str = ""
    timestamp: datetime = Field(default_factory=utc_now)


# ============== DAILY CLOSING ==============

class DailyClosing(BaseDocument):
    """Daily closing summary"""
    date: str  # "2024-01-15"
    total_transactions: int = 0
    total_swipe_amount: float = 0.0
    total_gateway_charges: float = 0.0
    total_commission: float = 0.0
    total_profit: float = 0.0
    total_pending_created: float = 0.0
    total_pending_settled: float = 0.0
    gateway_wise_summary: Dict[str, Any] = {}
    wallet_snapshots: List[Dict[str, Any]] = []  # Snapshot of all wallet balances
    closed_by: str = ""
    closed_by_name: str = ""
    is_auto_closed: bool = False  # True if auto-closed by scheduler
    notes: str = ""


# ============== CUSTOMER PAYMENTS (Type 01) ==============

class CustomerPaymentCreate(BaseModel):
    """Create a customer payment record"""
    transaction_id: str
    amount: float = Field(..., gt=0, le=10000000)
    payment_source_type: str
    payment_source_id: str
    payment_method: str = ""
    reference_number: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=1000)


class BulkPaymentCreate(BaseModel):
    """Create bulk payment to customer for multiple transactions"""
    customer_id: str
    transaction_ids: List[str] = Field(..., min_length=1, max_length=100)
    total_amount: float = Field(..., gt=0, le=10000000)
    allocation_method: str = "fifo"  # "fifo", "proportional", "manual"
    manual_allocations: Optional[Dict[str, float]] = None  # txn_id → amount (for manual mode)
    payment_source_type: str  # "cash", "bank", or "gateway"
    payment_source_id: str  # wallet_id
    payment_method: str = ""
    reference_number: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=1000)


class BulkCollectionCreate(BaseModel):
    """Create bulk collection from customer for multiple pending payments"""
    customer_id: str
    pending_payment_ids: List[str] = Field(..., min_length=1, max_length=100)
    total_amount: float = Field(..., gt=0, le=10000000)
    allocation_method: str = "fifo"  # "fifo", "proportional", "manual"
    manual_allocations: Optional[Dict[str, float]] = None  # payment_id -> amount (for manual mode)
    wallet_id: str  # Cash or bank wallet to credit
    payment_type: Optional[str] = None  # Required for bank wallets (QR, NEFT, UPI, etc.)
    charge_percentage: float = Field(default=0, ge=0, le=100)  # Commission % for cash/bank
    include_charges: bool = False  # Include All Charges mode
    notes: str = Field(default="", max_length=1000)


class BulkUnifiedCollectionItem(BaseModel):
    """One item in a bulk unified collection request"""
    collection_id: str
    gross_amount: float


class BulkUnifiedCollectionCreate(BaseModel):
    """Atomic bulk unified collection - all-or-nothing settlement"""
    customer_id: str
    method: str  # card_swipe, cash, bank_transfer
    charge_percentage: float = 0
    include_charges: bool = False
    notes: str = ""
    settlements: List["BulkUnifiedCollectionItem"]
    # card_swipe
    gateway_id: Optional[str] = None
    server_id: Optional[str] = None
    # cash / bank_transfer
    wallet_id: Optional[str] = None
    payment_type: Optional[str] = None


# ============== BALANCE ADJUSTMENT (Set-off) ==============

class AdjustmentAllocation(BaseModel):
    """Single allocation row for a balance adjustment (payout or collection side)."""
    id: str  # transaction_id or collection_id
    amount: float = Field(..., gt=0, le=10_000_000)


class BalanceAdjustmentCreate(BaseModel):
    """Create a customer balance adjustment - nets pending payouts against outstanding collections.

    The sum of `payouts[*].amount` MUST equal the sum of `collections[*].amount`; this
    common amount is the net amount that is offset against a virtual `Adjustments` wallet.
    """
    customer_id: str
    payouts: List[AdjustmentAllocation] = Field(..., min_length=1, max_length=50)
    collections: List[AdjustmentAllocation] = Field(..., min_length=1, max_length=50)
    reason: str = Field(..., min_length=5, max_length=500)
    notes: str = Field(default="", max_length=1000)



# ============== UNIFIED WALLETS ==============

class Wallet(BaseDocument):
    """Unified wallet for all money tracking"""
    name: str
    wallet_type: str  # "gateway", "cash", "bank"
    description: str = ""
    balance: float = 0.0
    is_active: bool = True
    
    # For gateway wallets - linked to payment gateway
    gateway_id: Optional[str] = None
    
    # For bank wallets - account details
    bank_name: Optional[str] = None
    account_number: Optional[str] = None


class WalletCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    wallet_type: str  # "cash" or "bank"
    description: str = Field(default="", max_length=500)
    balance: float = Field(default=0.0, ge=0, le=10000000)
    bank_name: Optional[str] = Field(default=None, max_length=100)
    account_number: Optional[str] = Field(default=None, max_length=50)


class WalletUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None


class WalletOperation(BaseDocument):
    """Wallet transaction/operation history"""
    operation_id: str = ""  # Human-readable ID: OP-0001
    wallet_id: str
    wallet_name: str = ""
    wallet_type: str = ""
    operation_type: str  # "credit", "debit", "transfer_in", "transfer_out"
    amount: float
    balance_before: float
    balance_after: float
    
    # For bank wallet credits - payment type
    payment_type: Optional[str] = None  # "QR", "NEFT", "IMPS", "UPI"
    
    # For transfers
    transfer_wallet_id: Optional[str] = None
    transfer_wallet_name: Optional[str] = None
    
    # Reference to transaction or other entity
    reference_id: Optional[str] = None
    reference_type: Optional[str] = None  # "transaction", "pending_payment", "manual"
    
    # Linking fields for traceability
    transaction_id: Optional[str] = None  # Linked transaction's readable ID (T1-0001)
    customer_id: Optional[str] = None  # Linked customer's readable ID (C001)
    
    notes: str = ""
    created_by: str = ""
    created_by_name: str = ""


class WalletOperationCreate(BaseModel):
    operation_type: str  # "credit", "debit"
    amount: float = Field(..., gt=0, le=10000000)
    payment_type: Optional[str] = None  # For bank wallet credits
    notes: str = Field(default="", max_length=1000)


class WalletTransfer(BaseModel):
    """Transfer between wallets"""
    from_wallet_id: str
    to_wallet_id: str
    amount: float = Field(..., gt=0, le=10000000)
    payment_type: Optional[str] = None  # If crediting bank wallet
    notes: str = Field(default="", max_length=1000)


class BankPaymentType(BaseDocument):
    """Configurable payment types for bank wallets"""
    name: str  # "QR", "NEFT", "IMPS", "UPI"
    description: str = ""
    is_active: bool = True


class BankPaymentTypeCreate(BaseModel):
    name: str
    description: str = ""


# ============== BALANCE VERIFICATION ==============

class BalanceVerification(BaseDocument):
    """Physical balance verification record"""
    wallet_id: str
    wallet_name: str
    wallet_type: str  # gateway, cash, bank
    
    # Balances
    system_balance: float  # Balance according to app
    actual_balance: float  # Physically verified balance
    difference: float  # actual - system (positive = excess, negative = shortage)
    
    # Adjustment
    adjustment_type: str  # shortage, excess, gateway_fee, bank_charges, error_correction, other
    adjustment_applied: bool = True  # Whether the adjustment was auto-applied
    reference_number: str = ""  # For bank statements or gateway transaction IDs
    notes: str = ""
    
    # Linked wallet operation (if adjustment was applied)
    wallet_operation_id: Optional[str] = None
    
    # Verification details
    verified_by: str
    verified_by_name: str


class BalanceVerificationCreate(BaseModel):
    """Create balance verification request"""
    wallet_id: str
    actual_balance: float
    adjustment_type: str = "other"  # shortage, excess, gateway_fee, bank_charges, error_correction, other
    reference_number: str = ""
    notes: str = ""


# ============== EXPENSE MANAGEMENT ==============

class ExpenseType(BaseDocument):
    """Expense type/category"""
    name: str
    description: str = ""
    is_system: bool = False  # System types can't be deleted (e.g., PG Charges)
    is_active: bool = True


class ExpenseTypeCreate(BaseModel):
    name: str
    description: str = ""


class Expense(BaseDocument):
    """Expense record"""
    expense_type_id: str
    expense_type_name: str
    
    # Amount
    amount: float
    
    # Source wallet
    wallet_id: str
    wallet_name: str
    wallet_type: str
    
    # Details
    expense_date: str  # ISO date string
    description: str = ""
    reference_number: str = ""  # Bill/invoice number
    vendor_name: str = ""
    
    # Auto-created from transaction (for PG charges)
    is_auto_created: bool = False
    transaction_id: Optional[str] = None
    
    # Charge Write-Off (non-cash expense, no wallet debit)
    is_writeoff: bool = False
    
    # Wallet operation link
    wallet_operation_id: Optional[str] = None
    
    # Created by
    created_by: str
    created_by_name: str


class ExpenseCreate(BaseModel):
    expense_type_id: str
    amount: float
    wallet_id: str
    expense_date: Optional[str] = None  # Defaults to today
    description: str = ""
    reference_number: str = ""
    vendor_name: str = ""

