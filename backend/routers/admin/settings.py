"""
Admin Settings Router - App configuration endpoints
Extracted from admin.py for ARCH-10
"""
from fastapi import APIRouter, Depends, Request
import logging

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit, get_settings
from models import SettingsUpdate

router = APIRouter(tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/settings")
async def get_app_settings(auth: dict = Depends(auth_required)):
    """Get app settings (read access for all authenticated users)"""
    settings = await get_settings()
    # Filter out SMTP fields from response
    smtp_fields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from_email', 'smtp_use_ssl']
    filtered_settings = {k: v for k, v in dict(settings).items() if k not in smtp_fields}
    return filtered_settings


@router.put("/settings")
async def update_app_settings(data: SettingsUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update app settings"""
    await check_permission(auth, "settings")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if update_data:
        await db.settings.update_one({"id": "app_settings"}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "settings", "app_settings", 
                    update_data, ip=request.client.host if request.client else "")
    
    settings = await get_settings()
    # Filter out SMTP fields
    smtp_fields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from_email', 'smtp_use_ssl']
    filtered_settings = {k: v for k, v in dict(settings).items() if k not in smtp_fields}
    return filtered_settings
