"""
Payments & Collections Router Package
Provides clean API endpoints:
  - /payments/* - Payouts to customers (money OUT)
  - /collections/* - Collections from customers (money IN)
"""
from fastapi import APIRouter

from .collections import router as collections_router
from .payments import router as payments_router

# Create main router that includes all sub-routers
router = APIRouter(tags=["Money"])

# Include all sub-routers
router.include_router(payments_router)
router.include_router(collections_router)
