"""
Banks Router - Banks, card networks, and bank payment types
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs
from models import Bank, BankCreate, CardNetwork, CardNetworkCreate, BankPaymentType, BankPaymentTypeCreate

router = APIRouter(tags=["Banks & Cards"])


# ============== BANKS ROUTES ==============

@router.get("/banks")
async def get_banks(auth: dict = Depends(auth_required)):
    """Get all banks"""
    banks = await db.banks.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    return serialize_docs(banks)


@router.post("/banks")
async def create_bank(data: BankCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new bank"""
    await check_permission(auth, "banks-and-cards")
    
    existing = await db.banks.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Bank with this name already exists")
    
    bank = Bank(**data.model_dump())
    doc = bank.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.banks.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "banks", bank.id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.put("/banks/{bank_id}")
async def update_bank(bank_id: str, data: BankCreate, request: Request, auth: dict = Depends(auth_required)):
    """Update bank"""
    await check_permission(auth, "banks-and-cards")
    
    bank = await db.banks.find_one({"id": bank_id, "is_deleted": False}, {"_id": 0})
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    
    update_data = data.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.banks.update_one({"id": bank_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "banks", bank_id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    updated = await db.banks.find_one({"id": bank_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/banks/{bank_id}")
async def delete_bank(bank_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete bank"""
    await check_permission(auth, "banks-and-cards")
    
    bank = await db.banks.find_one({"id": bank_id, "is_deleted": False}, {"_id": 0})
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    
    # Safety check: prevent deleting banks referenced by active customer cards
    customers_with_bank = await db.customers.count_documents({
        "is_deleted": False, "cards.bank_id": bank_id
    })
    if customers_with_bank > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {customers_with_bank} customer(s) have cards from this bank")
    
    await db.banks.update_one({"id": bank_id}, {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "banks", bank_id, {"name": bank["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Bank deleted successfully"}


# ============== CARD NETWORKS ROUTES ==============

@router.get("/card-networks")
async def get_card_networks(auth: dict = Depends(auth_required)):
    """Get all card networks"""
    networks = await db.card_networks.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    return serialize_docs(networks)


@router.post("/card-networks")
async def create_card_network(data: CardNetworkCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new card network"""
    await check_permission(auth, "banks-and-cards")
    
    existing = await db.card_networks.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Card network with this name already exists")
    
    network = CardNetwork(**data.model_dump())
    doc = network.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.card_networks.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "card_networks", network.id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.put("/card-networks/{network_id}")
async def update_card_network(network_id: str, data: CardNetworkCreate, request: Request, auth: dict = Depends(auth_required)):
    """Update card network"""
    await check_permission(auth, "banks-and-cards")
    
    network = await db.card_networks.find_one({"id": network_id, "is_deleted": False}, {"_id": 0})
    if not network:
        raise HTTPException(status_code=404, detail="Card network not found")
    
    update_data = data.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.card_networks.update_one({"id": network_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "card_networks", network_id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    updated = await db.card_networks.find_one({"id": network_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/card-networks/{network_id}")
async def delete_card_network(network_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete card network"""
    await check_permission(auth, "banks-and-cards")
    
    network = await db.card_networks.find_one({"id": network_id, "is_deleted": False}, {"_id": 0})
    if not network:
        raise HTTPException(status_code=404, detail="Card network not found")
    
    # Safety check: prevent deleting card networks referenced by active customer cards
    customers_with_network = await db.customers.count_documents({
        "is_deleted": False, "cards.card_network_id": network_id
    })
    if customers_with_network > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {customers_with_network} customer(s) have cards with this network")
    
    await db.card_networks.update_one({"id": network_id}, {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "card_networks", network_id, {"name": network["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Card network deleted successfully"}


# ============== BANK PAYMENT TYPES ROUTES ==============

@router.get("/bank-payment-types")
async def get_bank_payment_types(auth: dict = Depends(auth_required)):
    """Get all bank payment types"""
    types = await db.bank_payment_types.find({"is_deleted": False}, {"_id": 0}).to_list(500)
    return types


@router.post("/bank-payment-types")
async def create_bank_payment_type(data: BankPaymentTypeCreate, auth: dict = Depends(auth_required)):
    """Create a new bank payment type"""
    await check_permission(auth, "banks-and-cards")
    
    existing = await db.bank_payment_types.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Payment type already exists")
    
    payment_type = BankPaymentType(name=data.name, description=data.description)
    doc = payment_type.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.bank_payment_types.insert_one(doc)
    
    return serialize_doc(doc)


@router.delete("/bank-payment-types/{type_id}")
async def delete_bank_payment_type(type_id: str, auth: dict = Depends(auth_required)):
    """Delete a bank payment type"""
    await check_permission(auth, "banks-and-cards")
    
    ptype = await db.bank_payment_types.find_one({"id": type_id, "is_deleted": False}, {"_id": 0})
    if not ptype:
        raise HTTPException(status_code=404, detail="Payment type not found")
    
    # Safety check: prevent deleting payment types referenced by existing payments
    payments_using = await db.payments.count_documents({
        "is_deleted": False, "payment_type_id": type_id
    })
    if payments_using > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {payments_using} payment(s) reference this type")
    
    await db.bank_payment_types.update_one(
        {"id": type_id},
        {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": "Payment type deleted"}
