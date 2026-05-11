"""
Users Router - Users, roles, and modules management
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone

import asyncio

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from auth import hash_password
from utils import serialize_doc, serialize_docs, validate_phone, normalize_phone
from models import Module, ModuleCreate, Role, RoleCreate, User, UserCreate, UserUpdate, AdminPasswordResetRequest

router = APIRouter(tags=["Users & Roles"])


# ============== MODULES ROUTES ==============

@router.get("/modules")
async def get_modules(auth: dict = Depends(auth_required)):
    """Get all modules"""
    modules = await db.modules.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    return sorted(modules, key=lambda x: x.get("order", 0))


@router.post("/modules")
async def create_module(data: ModuleCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new module"""
    await check_permission(auth, "roles")
    
    existing = await db.modules.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Module with this name already exists")
    
    module = Module(**data.model_dump())
    doc = module.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.modules.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "modules", module.id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


# ============== ROLES ROUTES ==============

# Permission groups for organizing modules
PERMISSION_GROUPS = {
    "core": {
        "name": "Core Operations",
        "description": "Essential daily operations",
        "modules": ["dashboard", "customers", "transactions"]
    },
    "financials": {
        "name": "Financials",
        "description": "Money management",
        "modules": ["payments", "collections", "wallets", "expenses", "expense-types"]
    },
    "config": {
        "name": "Configuration",
        "description": "System setup",
        "modules": ["pg-and-servers", "banks-and-cards"]
    },
    "reports": {
        "name": "Reports & Audit",
        "description": "Tracking and compliance",
        "modules": ["audit-log", "daily-closing", "reconciliation", "balance-verification", "data-integrity", "reports", "downloads"]
    },
    "admin": {
        "name": "System Admin",
        "description": "User and system management",
        "modules": ["users", "roles", "settings", "security", "system-reset"]
    }
}

# Role templates for quick setup
ROLE_TEMPLATES = {
    "agent": {
        "name": "Agent",
        "description": "Day-to-day operations staff",
        "permissions": [
            "dashboard", "customers", "transactions",
            "payments", "collections", "wallets"
        ]
    },
    "manager": {
        "name": "Manager",
        "description": "Full access except system admin",
        "permissions": [
            "dashboard", "customers", "transactions",
            "payments", "collections", "wallets", "expenses", "expense-types",
            "pg-and-servers", "banks-and-cards",
            "audit-log", "daily-closing", "reconciliation", "balance-verification", "data-integrity", "reports", "downloads"
        ]
    },
    "accountant": {
        "name": "Accountant",
        "description": "Financial operations and reporting",
        "permissions": [
            "dashboard", "transactions",
            "payments", "collections", "wallets", "expenses", "expense-types",
            "daily-closing", "reconciliation", "reports", "downloads"
        ]
    },
    "viewer": {
        "name": "Viewer",
        "description": "Read-only access to reports",
        "permissions": [
            "dashboard", "reports", "downloads"
        ]
    }
}


@router.get("/roles/templates")
async def get_role_templates(auth: dict = Depends(auth_required)):
    """Get role templates and permission groups for UI"""
    await check_permission(auth, "roles")
    return {
        "templates": ROLE_TEMPLATES,
        "groups": PERMISSION_GROUPS
    }


@router.get("/roles")
async def get_roles(auth: dict = Depends(auth_required)):
    """Get all roles"""
    roles = await db.roles.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    return serialize_docs(roles)


@router.get("/roles/{role_id}")
async def get_role(role_id: str, auth: dict = Depends(auth_required)):
    """Get role by ID"""
    role = await db.roles.find_one({"id": role_id, "is_deleted": False}, {"_id": 0})
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return serialize_doc(role)


@router.post("/roles/clone/{role_id}")
async def clone_role(role_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Clone an existing role with a new name"""
    await check_permission(auth, "roles")
    
    source_role = await db.roles.find_one({"id": role_id, "is_deleted": False}, {"_id": 0})
    if not source_role:
        raise HTTPException(status_code=404, detail="Source role not found")
    
    # Create new role with copied permissions
    new_name = f"{source_role['name']} (Copy)"
    counter = 1
    while await db.roles.find_one({"name": new_name, "is_deleted": False}):
        counter += 1
        new_name = f"{source_role['name']} (Copy {counter})"
    
    role = Role(
        name=new_name,
        description=f"Cloned from {source_role['name']}",
        permissions=source_role.get("permissions", [])
    )
    doc = role.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.roles.insert_one(doc)
    
    await log_audit(
        auth["user"]["id"], auth["user"]["name"], "clone", "roles", role.id,
        {"source": source_role['name'], "new_name": new_name},
        ip=request.client.host if request.client else ""
    )
    
    return serialize_doc(doc)


@router.post("/roles")
async def create_role(data: RoleCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new role"""
    await check_permission(auth, "roles")
    
    existing = await db.roles.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Role with this name already exists")
    
    role = Role(**data.model_dump())
    doc = role.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.roles.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "roles", role.id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.put("/roles/{role_id}")
async def update_role(role_id: str, data: RoleCreate, request: Request, auth: dict = Depends(auth_required)):
    """Update role"""
    await check_permission(auth, "roles")
    
    role = await db.roles.find_one({"id": role_id, "is_deleted": False}, {"_id": 0})
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role["name"] == "SuperAdmin":
        raise HTTPException(status_code=400, detail="Cannot modify SuperAdmin role")
    
    update_data = data.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.roles.update_one({"id": role_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "roles", role_id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    updated = await db.roles.find_one({"id": role_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete role"""
    await check_permission(auth, "roles")
    
    role = await db.roles.find_one({"id": role_id, "is_deleted": False}, {"_id": 0})
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role["name"] == "SuperAdmin":
        raise HTTPException(status_code=400, detail="Cannot delete SuperAdmin role")
    
    user_count = await db.users.count_documents({"role_id": role_id, "is_deleted": False})
    if user_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete role with {user_count} assigned users")
    
    await db.roles.update_one({"id": role_id}, {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "roles", role_id, {"name": role["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Role deleted successfully"}


# ============== USERS ROUTES ==============

from fastapi import Query

@router.get("/users")
async def get_users(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get all users with pagination"""
    await check_permission(auth, "users")
    
    query = {"is_deleted": False}
    total = await db.users.count_documents(query)
    skip = (page - 1) * limit
    
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).skip(skip).limit(limit).to_list(limit)
    
    roles = {r["id"]: r["name"] for r in await db.roles.find({"is_deleted": False}, {"_id": 0}).to_list(100)}
    for user in users:
        user["role_name"] = roles.get(user.get("role_id"), "")
    
    return {
        "data": serialize_docs(users),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/users/{user_id}")
async def get_user(user_id: str, auth: dict = Depends(auth_required)):
    """Get user by ID"""
    await check_permission(auth, "users")
    
    user = await db.users.find_one({"id": user_id, "is_deleted": False}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    role = await db.roles.find_one({"id": user.get("role_id")}, {"_id": 0})
    user["role_name"] = role["name"] if role else ""
    
    return serialize_doc(user)


@router.post("/users")
async def create_user(data: UserCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new user"""
    await check_permission(auth, "users")
    
    existing = await db.users.find_one({"email": data.email, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    
    if data.phone and not validate_phone(data.phone):
        raise HTTPException(status_code=400, detail="Invalid phone number")
    
    role = await db.roles.find_one({"id": data.role_id, "is_deleted": False}, {"_id": 0})
    if not role:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    user = User(
        email=data.email,
        password_hash=await asyncio.to_thread(hash_password, data.password),
        name=data.name,
        phone=normalize_phone(data.phone) if data.phone else "",
        role_id=data.role_id
    )
    doc = user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.users.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "users", user.id, {"email": data.email}, ip=request.client.host if request.client else "")
    
    del doc["password_hash"]
    doc["role_name"] = role["name"]
    
    return serialize_doc(doc)


@router.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update user"""
    await check_permission(auth, "users")
    
    user = await db.users.find_one({"id": user_id, "is_deleted": False}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if "phone" in update_data and update_data["phone"]:
        if not validate_phone(update_data["phone"]):
            raise HTTPException(status_code=400, detail="Invalid phone number")
        update_data["phone"] = normalize_phone(update_data["phone"])
    
    if "role_id" in update_data:
        role = await db.roles.find_one({"id": update_data["role_id"], "is_deleted": False}, {"_id": 0})
        if not role:
            raise HTTPException(status_code=400, detail="Invalid role")
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.users.update_one({"id": user_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "users", user_id, update_data, ip=request.client.host if request.client else "")
    
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    role = await db.roles.find_one({"id": updated.get("role_id")}, {"_id": 0})
    updated["role_name"] = role["name"] if role else ""
    
    return serialize_doc(updated)


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, data: AdminPasswordResetRequest, request: Request, auth: dict = Depends(auth_required)):
    """Admin resets password for any user — no current password required"""
    await check_permission(auth, "users")

    user = await db.users.find_one({"id": user_id, "is_deleted": False}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_hash = await asyncio.to_thread(hash_password, data.new_password)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": new_hash, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    # Invalidate all active sessions for this user
    await db.sessions.delete_many({"user_id": user_id})

    await log_audit(
        auth["user"]["id"], auth["user"]["name"],
        "password_reset", "users", user_id,
        {"target_email": user["email"], "reset_by": auth["user"]["name"]},
        ip=request.client.host if request.client else ""
    )

    return {"message": f"Password reset successfully for {user['name']}. Their sessions have been invalidated."}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete user"""
    await check_permission(auth, "users")
    
    user = await db.users.find_one({"id": user_id, "is_deleted": False}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user_id == auth["user"]["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    # Safety check: prevent deleting users with active transactions
    active_txns = await db.transactions.count_documents({
        "is_deleted": False, "created_by": user_id,
        "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]}
    })
    if active_txns > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: user has {active_txns} active transaction(s)")
    
    await db.users.update_one({"id": user_id}, {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await db.sessions.delete_many({"user_id": user_id})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "users", user_id, {"email": user["email"]}, ip=request.client.host if request.client else "")
    
    return {"message": "User deleted successfully"}
