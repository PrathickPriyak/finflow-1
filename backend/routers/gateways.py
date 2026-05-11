"""
Gateways Router - Payment gateways and gateway servers
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs
from models import (
    Gateway, GatewayCreate, GatewayUpdate,
    GatewayServer, GatewayServerCreate, GatewayServerUpdate,
    Wallet, WalletOperation, WalletOperationCreate
)

router = APIRouter(tags=["Gateways"])


# ============== GATEWAYS ROUTES ==============

@router.get("/gateways")
async def get_gateways(auth: dict = Depends(auth_required)):
    """Get all gateways with wallet balances from unified wallets collection"""
    gateways = await db.gateways.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    
    gateway_wallets = await db.wallets.find(
        {"wallet_type": "gateway", "is_deleted": False},
        {"_id": 0}
    ).to_list(100)
    wallet_balance_map = {w.get("gateway_id"): w.get("balance", 0) for w in gateway_wallets}
    
    # Get all servers grouped by gateway
    all_servers = await db.gateway_servers.find(
        {"is_deleted": False},
        {"_id": 0}
    ).to_list(1000)
    
    servers_by_gateway = {}
    for server in all_servers:
        gw_id = server.get("gateway_id")
        if gw_id not in servers_by_gateway:
            servers_by_gateway[gw_id] = []
        servers_by_gateway[gw_id].append({
            "id": server.get("id"),
            "name": server.get("name"),
            "charge_percentage": server.get("charge_percentage"),
            "is_active": server.get("is_active", True)
        })
    
    for gateway in gateways:
        gateway["wallet_balance"] = wallet_balance_map.get(gateway["id"], 0)
        gateway["servers"] = servers_by_gateway.get(gateway["id"], [])
    
    return serialize_docs(gateways)


@router.get("/gateways/{gateway_id}")
async def get_gateway(gateway_id: str, auth: dict = Depends(auth_required)):
    """Get gateway by ID with wallet balance from unified wallets collection"""
    gateway = await db.gateways.find_one({"id": gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    gateway_wallet = await db.wallets.find_one(
        {"wallet_type": "gateway", "gateway_id": gateway_id, "is_deleted": False},
        {"_id": 0}
    )
    gateway["wallet_balance"] = gateway_wallet.get("balance", 0) if gateway_wallet else 0
    
    return serialize_doc(gateway)


@router.post("/gateways")
async def create_gateway(data: GatewayCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new gateway and corresponding unified wallet"""
    await check_permission(auth, "pg-and-servers")
    
    existing = await db.gateways.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Gateway with this name already exists")
    
    gateway = Gateway(name=data.name, description=data.description)
    doc = gateway.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.gateways.insert_one(doc)
    doc.pop("_id", None)
    
    initial_balance = data.wallet_balance if hasattr(data, 'wallet_balance') else 0
    wallet = Wallet(
        name=f"{data.name} Wallet",
        wallet_type="gateway",
        gateway_id=gateway.id,
        balance=initial_balance,
        description=f"Gateway wallet for {data.name}"
    )
    wallet_doc = wallet.model_dump()
    wallet_doc['created_at'] = wallet_doc['created_at'].isoformat()
    wallet_doc['updated_at'] = wallet_doc['updated_at'].isoformat()
    await db.wallets.insert_one(wallet_doc)
    wallet_doc.pop("_id", None)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "gateways", gateway.id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    doc["wallet_balance"] = initial_balance
    return serialize_doc(doc)


@router.put("/gateways/{gateway_id}")
async def update_gateway(gateway_id: str, data: GatewayUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update gateway"""
    await check_permission(auth, "pg-and-servers")
    
    gateway = await db.gateways.find_one({"id": gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.gateways.update_one({"id": gateway_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "gateways", gateway_id, update_data, ip=request.client.host if request.client else "")
    
    updated = await db.gateways.find_one({"id": gateway_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/gateways/{gateway_id}")
async def delete_gateway(gateway_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete gateway and its associated unified wallet"""
    await check_permission(auth, "pg-and-servers")
    
    gateway = await db.gateways.find_one({"id": gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    # AUDIT-FIX-03: Safety check — prevent deleting gateways with non-zero wallet balance or active transactions
    gateway_wallet = await db.wallets.find_one(
        {"wallet_type": "gateway", "gateway_id": gateway_id, "is_deleted": False},
        {"_id": 0, "balance": 1}
    )
    if gateway_wallet and gateway_wallet.get("balance", 0) != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: gateway wallet has non-zero balance ({gateway_wallet['balance']})"
        )
    
    active_txns = await db.transactions.count_documents({
        "is_deleted": False,
        "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]},
        "swipe_gateway_id": gateway_id
    })
    # BUG-6 FIX: Also check if gateway is used as a pay source in active Type 02 transactions
    active_pay_sources = await db.transaction_pay_sources.count_documents({
        "gateway_id": gateway_id,
        "status": "completed",
        "refunded_at": None
    })
    total_active = active_txns + active_pay_sources
    if total_active > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: gateway has {total_active} active transaction reference(s)")
    
    await db.gateways.update_one({"id": gateway_id}, {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await db.wallets.update_one(
        {"wallet_type": "gateway", "gateway_id": gateway_id},
        {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "gateways", gateway_id, {"name": gateway["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Gateway deleted successfully"}


# ============== GATEWAY WALLET OPERATIONS ==============

@router.get("/gateways/{gateway_id}/wallet")
async def get_gateway_wallet(gateway_id: str, auth: dict = Depends(auth_required)):
    """Get wallet details and operations for a gateway"""
    gateway = await db.gateways.find_one({"id": gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    gateway_wallet = await db.wallets.find_one({
        "wallet_type": "gateway",
        "gateway_id": gateway_id,
        "is_deleted": False
    }, {"_id": 0})
    
    if gateway_wallet:
        operations = await db.wallet_operations.find(
            {"wallet_id": gateway_wallet["id"], "is_deleted": False}, 
            {"_id": 0}
        ).sort("created_at", -1).to_list(100)
    else:
        operations = []
    
    return {
        "gateway": serialize_doc(gateway),
        "wallet": serialize_doc(gateway_wallet) if gateway_wallet else None,
        "operations": serialize_docs(operations)
    }


@router.post("/gateways/{gateway_id}/wallet")
async def create_gateway_wallet_operation(gateway_id: str, data: WalletOperationCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create manual wallet operation (credit/debit) for a gateway"""
    await check_permission(auth, "pg-and-servers")
    
    gateway_wallet = await db.wallets.find_one({
        "wallet_type": "gateway",
        "gateway_id": gateway_id,
        "is_deleted": False
    }, {"_id": 0})
    
    if not gateway_wallet:
        raise HTTPException(status_code=404, detail="Gateway wallet not found")
    
    if data.operation_type not in ["credit", "debit"]:
        raise HTTPException(status_code=400, detail="Invalid operation type. Use 'credit' or 'debit'")
    
    # ARCH-01 FIX: Use atomic $inc to prevent race conditions
    if data.operation_type == "credit":
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": gateway_wallet["id"]},
            {
                "$inc": {"balance": data.amount},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            },
            return_document=True,
            projection={"_id": 0}
        )
        balance_after = updated_wallet.get("balance", 0)
        balance_before = balance_after - data.amount
    else:
        # For debits, use conditional update to ensure sufficient balance
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": gateway_wallet["id"], "balance": {"$gte": data.amount}},
            {
                "$inc": {"balance": -data.amount},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            },
            return_document=True,
            projection={"_id": 0}
        )
        if not updated_wallet:
            raise HTTPException(status_code=400, detail="Insufficient wallet balance")
        balance_after = updated_wallet.get("balance", 0)
        balance_before = balance_after + data.amount
    
    wallet_op = WalletOperation(
        wallet_id=gateway_wallet["id"],
        wallet_name=gateway_wallet["name"],
        wallet_type="gateway",
        operation_type=data.operation_type,
        amount=data.amount,
        balance_before=balance_before,
        balance_after=balance_after,
        reference_type="manual",
        notes=data.notes,
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    op_doc = wallet_op.model_dump()
    op_doc['created_at'] = op_doc['created_at'].isoformat()
    op_doc['updated_at'] = op_doc['updated_at'].isoformat()
    await db.wallet_operations.insert_one(op_doc)
    
    await log_audit(
        auth["user"]["id"], auth["user"]["name"], "wallet_operation", "wallets", 
        gateway_wallet["id"], {"type": data.operation_type, "amount": data.amount},
        ip=request.client.host if request.client else ""
    )
    
    return {"message": "Operation completed", "new_balance": balance_after}


# ============== GATEWAY SERVERS ROUTES ==============

@router.get("/gateway-servers")
async def get_all_gateway_servers(gateway_id: str = None, auth: dict = Depends(auth_required)):
    """Get all gateway servers with gateway details. Optionally filter by gateway_id."""
    query = {"is_deleted": False}
    if gateway_id:
        query["gateway_id"] = gateway_id
    servers = await db.gateway_servers.find(query, {"_id": 0}).to_list(1000)
    
    gateways = {g["id"]: g for g in await db.gateways.find({"is_deleted": False}, {"_id": 0}).to_list(100)}
    
    result = []
    for server in servers:
        gateway = gateways.get(server["gateway_id"], {})
        result.append({
            "id": server["id"],
            "gateway_id": server["gateway_id"],
            "gateway_name": gateway.get("name", ""),
            "name": server["name"],
            "charge_percentage": server["charge_percentage"],
            "is_active": server.get("is_active", True),
            "created_at": server.get("created_at"),
            "updated_at": server.get("updated_at")
        })
    
    return result


@router.get("/gateways/{gateway_id}/servers")
async def get_gateway_servers(gateway_id: str, auth: dict = Depends(auth_required)):
    """Get all servers for a gateway"""
    gateway = await db.gateways.find_one({"id": gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    servers = await db.gateway_servers.find(
        {"gateway_id": gateway_id, "is_deleted": False}, 
        {"_id": 0}
    ).sort("charge_percentage", 1).to_list(100)
    
    return {
        "gateway": serialize_doc(gateway),
        "servers": serialize_docs(servers)
    }


@router.post("/gateways/{gateway_id}/servers")
async def create_gateway_server(gateway_id: str, data: GatewayServerCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create a new server for a gateway"""
    await check_permission(auth, "pg-and-servers")
    
    gateway = await db.gateways.find_one({"id": gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    existing = await db.gateway_servers.find_one({
        "gateway_id": gateway_id,
        "name": data.name,
        "is_deleted": False
    }, {"_id": 0})
    
    if existing:
        raise HTTPException(status_code=400, detail="Server with this name already exists for this gateway")
    
    server = GatewayServer(
        gateway_id=gateway_id,
        name=data.name,
        charge_percentage=data.charge_percentage
    )
    doc = server.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.gateway_servers.insert_one(doc)
    doc.pop("_id", None)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "gateway_servers", server.id, {
        "gateway": gateway["name"],
        "server": data.name,
        "percentage": data.charge_percentage
    }, ip=request.client.host if request.client else "")
    
    return {
        "id": server.id,
        "gateway_id": gateway_id,
        "gateway_name": gateway["name"],
        "name": data.name,
        "charge_percentage": data.charge_percentage,
        "is_active": True
    }


@router.put("/gateways/{gateway_id}/servers/{server_id}")
async def update_gateway_server(gateway_id: str, server_id: str, data: GatewayServerUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update a gateway server"""
    await check_permission(auth, "pg-and-servers")
    
    server = await db.gateway_servers.find_one({
        "id": server_id, 
        "gateway_id": gateway_id,
        "is_deleted": False
    }, {"_id": 0})
    
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Warn if charge_percentage changed with active transactions
    if "charge_percentage" in update_data and update_data["charge_percentage"] != server.get("charge_percentage"):
        active_count = await db.transactions.count_documents({
            "is_deleted": False, "swipe_server_id": server_id,
            "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]}
        })
        if active_count > 0:
            try:
                await db.system_alerts.insert_one({
                    "type": "server_charge_changed", "severity": "info",
                    "message": f"Server '{server.get('name')}' PG charge changed {server.get('charge_percentage')}% → {update_data['charge_percentage']}% with {active_count} active txn(s)",
                    "server_id": server_id, "created_at": update_data["updated_at"],
                })
            except Exception:
                pass

    await db.gateway_servers.update_one({"id": server_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "gateway_servers", server_id, update_data, ip=request.client.host if request.client else "")
    
    updated = await db.gateway_servers.find_one({"id": server_id}, {"_id": 0})
    gateway = await db.gateways.find_one({"id": gateway_id}, {"_id": 0})
    
    return {
        "id": server_id,
        "gateway_id": gateway_id,
        "gateway_name": gateway["name"] if gateway else "",
        "name": updated["name"],
        "charge_percentage": updated["charge_percentage"],
        "is_active": updated.get("is_active", True)
    }


@router.delete("/gateways/{gateway_id}/servers/{server_id}")
async def delete_gateway_server(gateway_id: str, server_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete a gateway server"""
    await check_permission(auth, "pg-and-servers")
    
    server = await db.gateway_servers.find_one({
        "id": server_id,
        "gateway_id": gateway_id,
        "is_deleted": False
    }, {"_id": 0})
    
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # BUG-8 FIX: Prevent deletion when server is referenced by active transactions
    active_txns = await db.transactions.count_documents({
        "is_deleted": False,
        "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]},
        "swipe_server_id": server_id
    })
    if active_txns > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: server has {active_txns} active transaction(s)")
    
    await db.gateway_servers.update_one(
        {"id": server_id}, 
        {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "gateway_servers", server_id, {"name": server["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Server deleted successfully"}


# ============== DIRECT GATEWAY SERVER ROUTES (for frontend compatibility) ==============

@router.put("/gateway-servers/{server_id}")
async def update_gateway_server_direct(server_id: str, data: GatewayServerUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update a gateway server by server ID only (for frontend compatibility)"""
    await check_permission(auth, "pg-and-servers")
    
    server = await db.gateway_servers.find_one({
        "id": server_id, 
        "is_deleted": False
    }, {"_id": 0})
    
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.gateway_servers.update_one({"id": server_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "gateway_servers", server_id, update_data, ip=request.client.host if request.client else "")
    
    updated = await db.gateway_servers.find_one({"id": server_id}, {"_id": 0})
    gateway = await db.gateways.find_one({"id": server["gateway_id"]}, {"_id": 0})
    
    return {
        "id": server_id,
        "gateway_id": server["gateway_id"],
        "gateway_name": gateway["name"] if gateway else "",
        "name": updated["name"],
        "charge_percentage": updated["charge_percentage"],
        "is_active": updated.get("is_active", True)
    }


@router.delete("/gateway-servers/{server_id}")
async def delete_gateway_server_direct(server_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete a gateway server by server ID only (for frontend compatibility)"""
    await check_permission(auth, "pg-and-servers")
    
    server = await db.gateway_servers.find_one({
        "id": server_id,
        "is_deleted": False
    }, {"_id": 0})
    
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # BUG-8 FIX: Prevent deletion when server is referenced by active transactions
    active_txns = await db.transactions.count_documents({
        "is_deleted": False,
        "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]},
        "swipe_server_id": server_id
    })
    if active_txns > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: server has {active_txns} active transaction(s)")
    
    await db.gateway_servers.update_one(
        {"id": server_id}, 
        {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "gateway_servers", server_id, {"name": server["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Server deleted successfully"}
