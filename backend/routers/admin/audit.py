"""
Admin Audit Router - Audit log endpoints
Extracted from admin.py for ARCH-10
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
import logging

from core.database import db
from core.dependencies import auth_required, check_permission
from utils import serialize_docs

router = APIRouter(tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/audit-logs")
async def get_audit_logs(
    user_id: Optional[str] = None,
    module: Optional[str] = None,
    action: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get audit logs with pagination"""
    await check_permission(auth, "audit-log")
    
    query = {}
    if user_id:
        query["user_id"] = user_id
    if module:
        query["module"] = module
    if action:
        query["action"] = action
    if date_from:
        query["timestamp"] = {"$gte": date_from}
    if date_to:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = date_to + "T23:59:59.999999"
        else:
            query["timestamp"] = {"$lte": date_to + "T23:59:59.999999"}
    
    total = await db.audit_logs.count_documents(query)
    skip = (page - 1) * limit
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).skip(skip).limit(limit).to_list(limit)
    
    return {
        "data": serialize_docs(logs),
        "pagination": {"page": page, "limit": limit, "total": total, "pages": (total + limit - 1) // limit}
    }
