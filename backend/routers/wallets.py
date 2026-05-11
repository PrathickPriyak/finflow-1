"""
Wallets Router - Unified wallet management, operations, and transfers
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
import logging
import io

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs, generate_operation_id, generate_transaction_id, get_next_operation_sequence
from models import Wallet, WalletCreate, WalletUpdate, WalletOperation, WalletOperationCreate, WalletTransfer, Transaction

router = APIRouter(tags=["Wallets"])
logger = logging.getLogger(__name__)


@router.get("/wallets")
async def get_wallets(wallet_type: str = None, auth: dict = Depends(auth_required)):
    """Get all wallets, optionally filtered by type (read access for all authenticated users)"""
    
    query = {"is_deleted": False}
    if wallet_type:
        query["wallet_type"] = wallet_type
    
    wallets = await db.wallets.find(query, {"_id": 0}).sort("wallet_type", 1).to_list(500)
    
    for wallet in wallets:
        if wallet.get("wallet_type") == "gateway" and wallet.get("gateway_id"):
            gateway = await db.gateways.find_one({"id": wallet["gateway_id"], "is_deleted": False}, {"_id": 0})
            if gateway:
                wallet["gateway_name"] = gateway.get("name", "")
    
    return wallets


@router.get("/wallets/{wallet_id}")
async def get_wallet(wallet_id: str, auth: dict = Depends(auth_required)):
    """Get wallet by ID (read access for all authenticated users)"""
    
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    if wallet.get("wallet_type") == "gateway" and wallet.get("gateway_id"):
        gateway = await db.gateways.find_one({"id": wallet["gateway_id"], "is_deleted": False}, {"_id": 0})
        if gateway:
            wallet["gateway_name"] = gateway.get("name", "")
    
    return wallet


@router.post("/wallets")
async def create_wallet(data: WalletCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create a new cash or bank wallet"""
    await check_permission(auth, "wallets")
    
    if data.wallet_type not in ["cash", "bank"]:
        raise HTTPException(status_code=400, detail="Can only create cash or bank wallets")
    
    existing = await db.wallets.find_one({
        "name": data.name, 
        "wallet_type": data.wallet_type, 
        "is_deleted": False
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail=f"A {data.wallet_type} wallet with this name already exists")
    
    wallet = Wallet(
        name=data.name,
        wallet_type=data.wallet_type,
        description=data.description,
        balance=data.balance,
        bank_name=data.bank_name if data.wallet_type == "bank" else None,
        account_number=data.account_number if data.wallet_type == "bank" else None,
    )
    
    doc = wallet.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.wallets.insert_one(doc)
    doc.pop("_id", None)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "wallets", wallet.id, {"name": wallet.name, "type": wallet.wallet_type}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.put("/wallets/{wallet_id}")
async def update_wallet(wallet_id: str, data: WalletUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update wallet details"""
    await check_permission(auth, "wallets")
    
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    if wallet.get("wallet_type") == "gateway":
        raise HTTPException(status_code=400, detail="Gateway wallets cannot be edited directly")
    
    # AUDIT-R3-05: Prevent direct balance override through wallet edit
    update_data = {k: v for k, v in data.model_dump().items() if v is not None and k != "balance"}
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.wallets.update_one({"id": wallet_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "wallets", wallet_id, update_data, ip=request.client.host if request.client else "")
    
    updated = await db.wallets.find_one({"id": wallet_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/wallets/{wallet_id}")
async def delete_wallet(wallet_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Delete a wallet (soft delete)"""
    await check_permission(auth, "wallets")
    
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    if wallet.get("wallet_type") == "gateway":
        raise HTTPException(status_code=400, detail="Gateway wallets cannot be deleted. Delete the gateway instead.")
    
    if wallet.get("balance", 0) != 0:
        raise HTTPException(status_code=400, detail="Cannot delete wallet with non-zero balance")
    
    await db.wallets.update_one(
        {"id": wallet_id},
        {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "wallets", wallet_id, {"name": wallet["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Wallet deleted successfully"}


@router.get("/wallets/{wallet_id}/operations")
async def get_wallet_operations(
    wallet_id: str,
    limit: int = 50,
    skip: int = 0,
    date_from: str = None,
    date_to: str = None,
    operation_type: str = None,
    created_by: str = None,
    auth: dict = Depends(auth_required)
):
    """Get wallet operation history with optional filters"""
    await check_permission(auth, "wallets")
    
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    query = {"wallet_id": wallet_id}
    
    # Date filter
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            date_query["$lte"] = f"{date_to}T23:59:59.999999"
        if date_query:
            query["created_at"] = date_query
    
    # Operation type filter (credit, debit — also matches transfer_in/transfer_out)
    if operation_type and operation_type != "all":
        if operation_type == "credit":
            query["operation_type"] = {"$in": ["credit", "transfer_in"]}
        elif operation_type == "debit":
            query["operation_type"] = {"$in": ["debit", "transfer_out"]}
    
    # User filter
    if created_by and created_by != "all":
        query["created_by"] = created_by
    
    operations = await db.wallet_operations.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    total = await db.wallet_operations.count_documents(query)
    
    return {
        "wallet": serialize_doc(wallet),
        "operations": serialize_docs(operations),
        "total": total
    }


@router.get("/wallets/{wallet_id}/operations/export")
async def export_wallet_operations(
    wallet_id: str,
    request: Request,
    date_from: str = None,
    date_to: str = None,
    operation_type: str = None,
    created_by: str = None,
    auth: dict = Depends(auth_required)
):
    """Export wallet operations to Excel with the same filters as the list endpoint"""
    await check_permission(auth, "wallets")
    
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    query = {"wallet_id": wallet_id}
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            date_query["$lte"] = f"{date_to}T23:59:59.999999"
        if date_query:
            query["created_at"] = date_query
    if operation_type and operation_type != "all":
        if operation_type == "credit":
            query["operation_type"] = {"$in": ["credit", "transfer_in"]}
        elif operation_type == "debit":
            query["operation_type"] = {"$in": ["debit", "transfer_out"]}
    if created_by and created_by != "all":
        query["created_by"] = created_by
    
    operations = await db.wallet_operations.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    
    import xlsxwriter
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output)
    worksheet = workbook.add_worksheet("Wallet Operations")
    
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "white", "border": 1})
    text_fmt = workbook.add_format({"border": 1})
    money_fmt = workbook.add_format({"num_format": "₹#,##0.00", "border": 1})
    
    headers = ["Op ID", "Seq #", "Date", "Wallet", "Wallet Type", "Type", "Amount", "Balance Before", "Balance After",
               "Transaction", "Customer", "Reference", "Reference ID", "Payment Method", "Transfer Wallet", "Notes", "User"]
    for ci, h in enumerate(headers):
        worksheet.write(0, ci, h, header_fmt)
    
    for ri, op in enumerate(operations, 1):
        op_type = op.get("operation_type", "")
        worksheet.write(ri, 0, op.get("operation_id", ""), text_fmt)
        worksheet.write(ri, 1, op.get("sequence_number", ""), text_fmt)
        worksheet.write(ri, 2, op.get("created_at", "")[:19].replace("T", " "), text_fmt)
        worksheet.write(ri, 3, op.get("wallet_name", ""), text_fmt)
        worksheet.write(ri, 4, (op.get("wallet_type", "") or "").replace("_", " ").title(), text_fmt)
        worksheet.write(ri, 5, op_type.replace("_", " ").title(), text_fmt)
        worksheet.write(ri, 6, op.get("amount", 0), money_fmt)
        worksheet.write(ri, 7, op.get("balance_before", 0), money_fmt)
        worksheet.write(ri, 8, op.get("balance_after", 0), money_fmt)
        worksheet.write(ri, 9, op.get("transaction_id", ""), text_fmt)
        worksheet.write(ri, 10, op.get("customer_id", ""), text_fmt)
        worksheet.write(ri, 11, (op.get("reference_type", "") or "").replace("_", " ").title(), text_fmt)
        worksheet.write(ri, 12, op.get("reference_id", ""), text_fmt)
        worksheet.write(ri, 13, op.get("payment_type", "") or "", text_fmt)
        worksheet.write(ri, 14, op.get("transfer_wallet_name", "") or "", text_fmt)
        worksheet.write(ri, 15, op.get("notes", ""), text_fmt)
        worksheet.write(ri, 16, op.get("created_by_name", ""), text_fmt)
    
    for s, e, w in [(0, 0, 12), (1, 1, 6), (2, 2, 20), (3, 3, 22), (4, 4, 12), (5, 5, 14), (6, 8, 15), (9, 10, 14), (11, 11, 18), (12, 12, 12), (13, 14, 14), (15, 15, 25), (16, 16, 15)]:
        worksheet.set_column(s, e, w)
    
    workbook.close()
    output.seek(0)
    
    wallet_name = wallet.get("name", "wallet").replace(" ", "_")
    filename = f"wallet_ops_{wallet_name}_{date_from or 'all'}_{date_to or 'all'}.xlsx"
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "wallet_operations", wallet_id, {"count": len(operations), "wallet": wallet.get("name")}, ip=request.client.host if request.client else "")
    
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}"})



@router.get("/wallet-operations")
async def get_wallet_operations_by_filter(
    reference_id: str = None, 
    transaction_id: str = None,
    customer_id: str = None,
    limit: int = 100,
    auth: dict = Depends(auth_required)
):
    """Get wallet operations filtered by reference_id, transaction_id, or customer_id"""
    await check_permission(auth, "wallets")
    
    query = {"is_deleted": False}
    
    if reference_id:
        query["reference_id"] = reference_id
    if transaction_id:
        query["transaction_id"] = transaction_id
    if customer_id:
        query["customer_id"] = customer_id
    
    operations = await db.wallet_operations.find(
        query, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    return serialize_docs(operations)


@router.post("/wallets/{wallet_id}/operations")
async def create_wallet_operation(wallet_id: str, data: WalletOperationCreate, auth: dict = Depends(auth_required)):
    """Credit or debit a wallet"""
    await check_permission(auth, "wallets")
    
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    if data.operation_type not in ["credit", "debit"]:
        raise HTTPException(status_code=400, detail="Operation type must be 'credit' or 'debit'")
    
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    if wallet.get("wallet_type") == "bank" and data.operation_type == "credit" and not data.payment_type:
        raise HTTPException(status_code=400, detail="Payment type is required for bank wallet credits")
    
    # ARCH-01 FIX: Use atomic $inc to prevent race conditions
    inc_amount = data.amount if data.operation_type == "credit" else -data.amount
    
    # For debits, use conditional update to ensure sufficient balance
    if data.operation_type == "debit":
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": wallet_id, "balance": {"$gte": data.amount}},
            {
                "$inc": {"balance": inc_amount},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            },
            return_document=True,
            projection={"_id": 0}
        )
        if not updated_wallet:
            raise HTTPException(status_code=400, detail="Insufficient balance")
    else:
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": wallet_id},
            {
                "$inc": {"balance": inc_amount},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            },
            return_document=True,
            projection={"_id": 0}
        )
    
    # Calculate balance_before from the updated balance
    balance_after = updated_wallet.get("balance", 0)
    if data.operation_type == "credit":
        balance_before = balance_after - data.amount
    else:
        balance_before = balance_after + data.amount
    
    operation_id_readable = await generate_operation_id(db)
    
    operation = WalletOperation(
        operation_id=operation_id_readable,
        wallet_id=wallet_id,
        wallet_name=wallet["name"],
        wallet_type=wallet["wallet_type"],
        operation_type=data.operation_type,
        amount=data.amount,
        balance_before=balance_before,
        balance_after=balance_after,
        payment_type=data.payment_type,
        reference_type="manual",
        notes=data.notes,
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"],
    )
    
    op_doc = operation.model_dump()
    op_doc['created_at'] = op_doc['created_at'].isoformat()
    op_doc['updated_at'] = op_doc['updated_at'].isoformat()
    # BUG-5 FIX: Add sequence_number to manual wallet operations (was missing, breaking sequence integrity)
    op_doc['sequence_number'] = await get_next_operation_sequence(db, wallet_id)
    await db.wallet_operations.insert_one(op_doc)
    
    return {"operation": serialize_doc(op_doc), "new_balance": balance_after}


@router.post("/wallets/transfer")
async def transfer_between_wallets(data: WalletTransfer, request: Request, auth: dict = Depends(auth_required)):
    """Transfer money between wallets"""
    await check_permission(auth, "wallets")
    
    if data.from_wallet_id == data.to_wallet_id:
        raise HTTPException(status_code=400, detail="Cannot transfer to the same wallet")
    
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    from_wallet = await db.wallets.find_one({"id": data.from_wallet_id, "is_deleted": False}, {"_id": 0})
    if not from_wallet:
        raise HTTPException(status_code=404, detail="Source wallet not found")
    
    to_wallet = await db.wallets.find_one({"id": data.to_wallet_id, "is_deleted": False}, {"_id": 0})
    if not to_wallet:
        raise HTTPException(status_code=404, detail="Destination wallet not found")
    
    if to_wallet.get("wallet_type") == "bank" and not data.payment_type:
        data.payment_type = "Transfer"
    
    transaction_id_readable = await generate_transaction_id(db, "transfer")
    
    user_email = auth["user"].get("email", "")
    ip_address = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")[:255]
    
    # AUDIT-FIX-04: Debit source wallet BEFORE inserting transaction to prevent phantom records
    # Debit source wallet with balance check
    from_updated = await db.wallets.find_one_and_update(
        {"id": data.from_wallet_id, "balance": {"$gte": data.amount}},
        {
            "$inc": {"balance": -data.amount},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        },
        return_document=True,
        projection={"_id": 0}
    )
    
    if not from_updated:
        raise HTTPException(status_code=400, detail="Insufficient balance in source wallet")
    
    from_balance_after = from_updated.get("balance", 0)
    from_balance_before = from_balance_after + data.amount
    
    # Credit destination wallet
    to_updated = await db.wallets.find_one_and_update(
        {"id": data.to_wallet_id, "is_deleted": False},
        {
            "$inc": {"balance": data.amount},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        },
        return_document=True,
        projection={"_id": 0}
    )

    if not to_updated:
        # Destination wallet gone — roll back the source debit to prevent money loss
        await db.wallets.update_one(
            {"id": data.from_wallet_id},
            {"$inc": {"balance": data.amount}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        raise HTTPException(status_code=404, detail="Destination wallet not found or was deleted. Transfer cancelled and source balance restored.")

    to_balance_after = to_updated.get("balance", 0)
    to_balance_before = to_balance_after - data.amount
    
    # Now insert the transaction record (both wallets already updated)
    transfer_transaction = Transaction(
        transaction_id=transaction_id_readable,
        transaction_type="transfer",
        customer_id="",
        customer_readable_id="",
        customer_name="",
        transfer_from_wallet_id=data.from_wallet_id,
        transfer_from_wallet_name=from_wallet["name"],
        transfer_to_wallet_id=data.to_wallet_id,
        transfer_to_wallet_name=to_wallet["name"],
        transfer_amount=data.amount,
        status="completed",
        user_email=user_email,
        ip_address=ip_address,
        user_agent=user_agent,
        notes=data.notes or f"Transfer from {from_wallet['name']} to {to_wallet['name']}",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    txn_doc = transfer_transaction.model_dump()
    txn_doc['created_at'] = txn_doc['created_at'].isoformat()
    txn_doc['updated_at'] = txn_doc['updated_at'].isoformat()
    await db.transactions.insert_one(txn_doc)
    
    debit_operation_id = await generate_operation_id(db)
    credit_operation_id = await generate_operation_id(db)
    
    debit_op = WalletOperation(
        operation_id=debit_operation_id,
        wallet_id=data.from_wallet_id,
        wallet_name=from_wallet["name"],
        wallet_type=from_wallet["wallet_type"],
        operation_type="debit",
        amount=data.amount,
        balance_before=from_balance_before,
        balance_after=from_balance_after,
        reference_id=transfer_transaction.id,
        reference_type="transfer",
        transaction_id=transaction_id_readable,
        notes=f"Transfer to {to_wallet['name']}",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    credit_op = WalletOperation(
        operation_id=credit_operation_id,
        wallet_id=data.to_wallet_id,
        wallet_name=to_wallet["name"],
        wallet_type=to_wallet["wallet_type"],
        operation_type="credit",
        amount=data.amount,
        balance_before=to_balance_before,
        balance_after=to_balance_after,
        payment_type=data.payment_type if to_wallet.get("wallet_type") == "bank" else None,
        reference_id=transfer_transaction.id,
        reference_type="transfer",
        transaction_id=transaction_id_readable,
        notes=f"Transfer from {from_wallet['name']}",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    debit_doc = debit_op.model_dump()
    debit_doc['created_at'] = debit_doc['created_at'].isoformat()
    debit_doc['updated_at'] = debit_doc['updated_at'].isoformat()
    # BUG-6 FIX: Add sequence_number to transfer wallet ops (were missing, breaking sequence integrity)
    debit_doc['sequence_number'] = await get_next_operation_sequence(db, data.from_wallet_id)
    
    credit_doc = credit_op.model_dump()
    credit_doc['created_at'] = credit_doc['created_at'].isoformat()
    credit_doc['updated_at'] = credit_doc['updated_at'].isoformat()
    # BUG-6 FIX: Add sequence_number to transfer wallet ops
    credit_doc['sequence_number'] = await get_next_operation_sequence(db, data.to_wallet_id)
    
    await db.wallet_operations.insert_one(debit_doc)
    await db.wallet_operations.insert_one(credit_doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "transfer", "wallets", transfer_transaction.id, {
        "from": from_wallet["name"],
        "to": to_wallet["name"],
        "amount": data.amount,
        "transaction_id": transaction_id_readable
    }, ip=request.client.host if request.client else "")
    
    return {
        "message": "Transfer completed successfully",
        "transaction_id": transaction_id_readable,
        "transfer_id": transfer_transaction.id,
        "from_wallet": {"id": data.from_wallet_id, "name": from_wallet["name"], "new_balance": from_balance_after},
        "to_wallet": {"id": data.to_wallet_id, "name": to_wallet["name"], "new_balance": to_balance_after}
    }
