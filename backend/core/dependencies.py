"""
Shared dependencies and helper functions used across routers
"""
import logging
from fastapi import HTTPException, Request
from .database import db
from auth import get_auth_dependency
from models import AuditLog, Settings

logger = logging.getLogger(__name__)

# Auth dependency
auth_required = get_auth_dependency(db)

# Cache for valid module names (refreshed on startup and periodically)
_valid_modules_cache: set = set()


def get_client_ip(request: Request) -> str:
    """
    Get real client IP, supporting Cloudflare Tunnel.
    Priority: CF-Connecting-IP > X-Forwarded-For > X-Real-IP > client.host
    """
    # Cloudflare's header for original client IP
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip
    
    # Standard proxy headers
    x_forwarded_for = request.headers.get("X-Forwarded-For")
    if x_forwarded_for:
        # Take the first IP (original client)
        return x_forwarded_for.split(",")[0].strip()
    
    x_real_ip = request.headers.get("X-Real-IP")
    if x_real_ip:
        return x_real_ip
    
    # Fallback to direct connection
    if request.client:
        return request.client.host
    
    return ""


async def log_audit(user_id: str, user_name: str, action: str, module: str, 
                    entity_id: str = None, details: dict = None, ip: str = ""):
    """Create audit log entry"""
    log = AuditLog(
        user_id=user_id,
        user_name=user_name,
        action=action,
        module=module,
        entity_id=entity_id,
        details=details or {},
        ip_address=ip
    )
    doc = log.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    await db.audit_logs.insert_one(doc)


async def get_settings() -> dict:
    """Get app settings"""
    settings = await db.settings.find_one({"id": "app_settings"}, {"_id": 0})
    if not settings:
        default = Settings()
        doc = default.model_dump()
        await db.settings.insert_one(doc)
        return doc
    return settings


async def check_permission(auth: dict, module_name: str, action: str = "view"):
    """
    Check if user has permission for a module.
    
    IMPORTANT: module_name MUST match a module name in the modules collection.
    This ensures permissions are always valid and in sync with the UI.
    
    Convention: Permission Name = Module Name (kebab-case)
    Example: "payments", "collections", "pg-and-servers", "daily-closing"
    
    Args:
        auth: Authentication dict containing user and role info
        module_name: Must match a module name from the modules collection
        action: Action type (for future granular permissions, currently unused)
    
    Raises:
        HTTPException 403: User doesn't have permission
        HTTPException 500: Invalid module name (developer error)
    """
    global _valid_modules_cache
    
    role = auth.get("role")
    if not role:
        raise HTTPException(status_code=403, detail="No role assigned")
    
    # SuperAdmin has all permissions
    if role.get("name") == "SuperAdmin":
        return True
    
    # Validate module exists (security + catches developer errors)
    # Refresh cache if empty
    if not _valid_modules_cache:
        modules = await db.modules.find({"is_deleted": False}, {"_id": 0, "name": 1, "display_name": 1}).to_list(100)
        _valid_modules_cache = {m["name"]: m.get("display_name", m["name"]) for m in modules}
    
    if module_name not in _valid_modules_cache:
        # This is a developer error - log it prominently
        logger.error(f"PERMISSION_ERROR: Invalid module '{module_name}' in check_permission. "
                    f"Valid modules: {list(_valid_modules_cache.keys())}")
        raise HTTPException(
            status_code=500, 
            detail="Internal permission configuration error. Please contact administrator."
        )
    
    # Check module permission
    permissions = role.get("permissions", [])
    
    if isinstance(permissions, list):
        if module_name in permissions:
            return True
    
    # User doesn't have permission - use display name for user-friendly message
    display_name = _valid_modules_cache.get(module_name, module_name)
    # Log permission denial for security auditing
    user = auth.get("user", {})
    await log_audit(
        user.get("id", "unknown"), user.get("name", "unknown"),
        "permission_denied", module_name,
        details={"attempted_module": module_name, "role": role.get("name", "unknown")}
    )
    raise HTTPException(status_code=403, detail=f"No permission for {display_name}")



