"""
Routers Package - All API routers
"""
from .auth import router as auth_router
from .users import router as users_router
from .gateways import router as gateways_router
from .banks import router as banks_router
from .customers import router as customers_router
from .transactions import router as transactions_router
from .payments import router as payments_router
from .wallets import router as wallets_router
from .expenses import router as expenses_router
from .dashboard import router as dashboard_router
from .admin import router as admin_router
from .reconciliation import router as reconciliation_router
from .smtp import router as smtp_router
from .adjustments import router as adjustments_router

__all__ = [
    'auth_router',
    'users_router', 
    'gateways_router',
    'banks_router',
    'customers_router',
    'transactions_router',
    'payments_router',
    'wallets_router',
    'expenses_router',
    'dashboard_router',
    'admin_router',
    'reconciliation_router',
    'smtp_router',
    'adjustments_router',
]
