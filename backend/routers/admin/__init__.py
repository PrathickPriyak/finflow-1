"""
Admin Router Package - Aggregates all admin sub-modules
Refactored from monolithic admin.py for ARCH-10
"""
from fastapi import APIRouter

from .settings import router as settings_router
from .audit import router as audit_router
from .daily_closing import router as daily_closing_router
from .system_reset import router as system_reset_router

# Create main admin router that includes all sub-routers
router = APIRouter(tags=["Admin"])

# Include all sub-routers
router.include_router(settings_router)
router.include_router(audit_router)
router.include_router(daily_closing_router)
router.include_router(system_reset_router)
