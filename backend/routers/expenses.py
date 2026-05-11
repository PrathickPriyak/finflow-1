"""
Expenses Router - Expense types and expense management
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
from typing import Optional
import logging
import re
import io

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs, get_today_date, generate_expense_id, generate_operation_id, get_next_operation_sequence, validate_date_param
from models import ExpenseType, ExpenseTypeCreate, Expense, ExpenseCreate, WalletOperation

router = APIRouter(tags=["Expenses"])
logger = logging.getLogger(__name__)


# ============== EXPENSE TYPES ==============

@router.get("/expense-types")
async def get_expense_types(auth: dict = Depends(auth_required)):
    """Get all expense types"""
    types = await db.expense_types.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    return serialize_docs(types)


@router.post("/expense-types")
async def create_expense_type(data: ExpenseTypeCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create a new expense type"""
    await check_permission(auth, "expense-types")
    
    existing = await db.expense_types.find_one({"name": data.name, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Expense type already exists")
    
    expense_type = ExpenseType(name=data.name, description=data.description)
    doc = expense_type.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.expense_types.insert_one(doc)
    doc.pop("_id", None)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "expense_types", expense_type.id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.put("/expense-types/{expense_type_id}")
async def update_expense_type(expense_type_id: str, data: ExpenseTypeCreate, request: Request, auth: dict = Depends(auth_required)):
    """Update an expense type"""
    await check_permission(auth, "expense-types")
    
    expense_type = await db.expense_types.find_one({"id": expense_type_id, "is_deleted": False}, {"_id": 0})
    if not expense_type:
        raise HTTPException(status_code=404, detail="Expense type not found")
    
    if expense_type.get("is_system", False):
        raise HTTPException(status_code=400, detail="Cannot modify system expense types")
    
    # Check for duplicate name
    existing = await db.expense_types.find_one({
        "name": {"$regex": f"^{re.escape(data.name)}$", "$options": "i"},
        "id": {"$ne": expense_type_id},
        "is_deleted": False
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="An expense type with this name already exists")
    
    await db.expense_types.update_one(
        {"id": expense_type_id},
        {"$set": {
            "name": data.name,
            "description": data.description,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "expense_types", expense_type_id, {"name": data.name}, ip=request.client.host if request.client else "")
    
    updated = await db.expense_types.find_one({"id": expense_type_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/expense-types/{expense_type_id}")
async def delete_expense_type(expense_type_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Delete an expense type"""
    await check_permission(auth, "expense-types")
    
    expense_type = await db.expense_types.find_one({"id": expense_type_id, "is_deleted": False}, {"_id": 0})
    if not expense_type:
        raise HTTPException(status_code=404, detail="Expense type not found")
    
    if expense_type.get("is_system", False):
        raise HTTPException(status_code=400, detail="Cannot delete system expense types")
    
    # Safety check: prevent deleting expense types with existing expenses
    expenses_using = await db.expenses.count_documents({
        "is_deleted": False, "expense_type_id": expense_type_id
    })
    if expenses_using > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {expenses_using} expense(s) reference this type")
    
    await db.expense_types.update_one(
        {"id": expense_type_id},
        {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "expense_types", expense_type_id, ip=request.client.host if request.client else "")
    
    return {"message": "Expense type deleted"}


# ============== EXPENSES ==============

@router.get("/expenses")
async def get_expenses(
    expense_type_id: Optional[str] = None,
    wallet_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    created_by: Optional[str] = None,
    is_auto: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = "desc",
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get expenses with filters, search, sorting, and pagination"""
    query = {"is_deleted": False}
    
    if expense_type_id:
        query["expense_type_id"] = expense_type_id
    if wallet_id:
        query["wallet_id"] = wallet_id
    if from_date:
        query["expense_date"] = {"$gte": from_date}
    if to_date:
        if "expense_date" in query:
            query["expense_date"]["$lte"] = to_date
        else:
            query["expense_date"] = {"$lte": to_date}
    if created_by and created_by != "all":
        query["created_by"] = created_by
    if is_auto and is_auto != "all":
        query["is_auto_created"] = is_auto == "true"
    if search:
        search_regex = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [
            {"description": search_regex},
            {"vendor_name": search_regex},
            {"reference_number": search_regex},
            {"expense_id": search_regex},
            {"expense_type_name": search_regex},
        ]
    
    # Sorting
    sort_field = "expense_date"
    if sort_by == "amount":
        sort_field = "amount"
    elif sort_by == "type":
        sort_field = "expense_type_name"
    elif sort_by == "wallet":
        sort_field = "wallet_name"
    elif sort_by == "vendor":
        sort_field = "vendor_name"
    elif sort_by == "date":
        sort_field = "expense_date"
    sort_dir = 1 if sort_order == "asc" else -1
    
    total = await db.expenses.count_documents(query)
    skip = (page - 1) * limit
    
    expenses = await db.expenses.find(query, {"_id": 0}).sort(sort_field, sort_dir).skip(skip).limit(limit).to_list(limit)
    
    return {
        "data": serialize_docs(expenses),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.post("/expenses")
async def create_expense(data: ExpenseCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create a new expense and deduct from wallet"""
    await check_permission(auth, "expenses")
    
    expense_type = await db.expense_types.find_one({"id": data.expense_type_id, "is_deleted": False}, {"_id": 0})
    if not expense_type:
        raise HTTPException(status_code=404, detail="Expense type not found")
    
    wallet = await db.wallets.find_one({"id": data.wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    # BUG-S3-18 FIX: removed stale pre-check — atomic $gte guard below is the real guard
    now_iso = datetime.now(timezone.utc).isoformat()
    expense_date = data.expense_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Validate expense_date format
    if data.expense_date:
        expense_date = validate_date_param(data.expense_date, "expense_date")
    
    # Prevent expenses on dates that have already been closed
    closed_day = await db.daily_closings.find_one({"date": expense_date, "is_deleted": False}, {"_id": 0, "date": 1})
    if closed_day:
        raise HTTPException(status_code=400, detail=f"Cannot create expense for {expense_date} — daily closing already done. Reopen the day first.")

    expense_id = await generate_expense_id(db)
    
    # AUDIT-FIX-01: Use atomic $inc with balance check to prevent race conditions
    updated_wallet = await db.wallets.find_one_and_update(
        {"id": data.wallet_id, "balance": {"$gte": data.amount}},
        {
            "$inc": {"balance": -data.amount},
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    if not updated_wallet:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    
    new_balance = updated_wallet.get("balance", 0)
    old_balance = new_balance + data.amount
    
    # BUG-S3-09 FIX: add operation_id and sequence_number to wallet operation
    op_id = await generate_operation_id(db)
    seq = await get_next_operation_sequence(db, wallet["id"])
    wallet_op = WalletOperation(
        wallet_id=wallet["id"],
        wallet_name=wallet["name"],
        wallet_type=wallet.get("wallet_type", ""),
        operation_type="debit",
        amount=data.amount,
        balance_before=old_balance,
        balance_after=new_balance,
        reference_type="expense",
        notes=f"Expense: {expense_type['name']} - {data.description}".strip(),
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    wallet_op_doc = wallet_op.model_dump()
    wallet_op_doc['operation_id'] = op_id
    wallet_op_doc['sequence_number'] = seq
    wallet_op_doc['created_at'] = now_iso
    wallet_op_doc['updated_at'] = now_iso
    await db.wallet_operations.insert_one(wallet_op_doc)
    
    expense = Expense(
        expense_id=expense_id,
        expense_type_id=data.expense_type_id,
        expense_type_name=expense_type["name"],
        amount=data.amount,
        wallet_id=data.wallet_id,
        wallet_name=wallet["name"],
        wallet_type=wallet.get("wallet_type", ""),
        expense_date=expense_date,
        description=data.description,
        reference_number=data.reference_number,
        vendor_name=data.vendor_name,
        is_auto_created=False,
        wallet_operation_id=wallet_op.id,
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    expense_doc = expense.model_dump()
    expense_doc['created_at'] = now_iso
    expense_doc['updated_at'] = now_iso
    await db.expenses.insert_one(expense_doc)
    
    await db.wallet_operations.update_one({"id": wallet_op.id}, {"$set": {"reference_id": expense.id}})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "expenses", expense.id, {
        "type": expense_type["name"],
        "amount": data.amount,
        "wallet": wallet["name"]
    }, ip=request.client.host if request.client else "")
    
    return serialize_doc(expense_doc)


@router.get("/expenses/summary")
async def get_expenses_summary(
    month: Optional[str] = None,
    auth: dict = Depends(auth_required)
):
    """Get expense summary statistics for a given month (YYYY-MM) or current month"""
    import calendar as cal_mod
    from datetime import timedelta

    today = get_today_date()
    now = datetime.now(timezone.utc)

    # Determine target month
    if month:
        parts = month.split('-')
        target_year, target_month = int(parts[0]), int(parts[1])
    else:
        target_year, target_month = now.year, now.month

    is_current_month = (target_year == now.year and target_month == now.month)
    last_day = cal_mod.monthrange(target_year, target_month)[1]
    month_start = f"{target_year}-{str(target_month).zfill(2)}-01"
    month_end = f"{target_year}-{str(target_month).zfill(2)}-{str(last_day).zfill(2)}"

    # Previous month range (for MoM comparison)
    if target_month == 1:
        prev_year, prev_month = target_year - 1, 12
    else:
        prev_year, prev_month = target_year, target_month - 1
    prev_last_day = cal_mod.monthrange(prev_year, prev_month)[1]
    prev_month_start = f"{prev_year}-{str(prev_month).zfill(2)}-01"
    prev_month_end = f"{prev_year}-{str(prev_month).zfill(2)}-{str(prev_last_day).zfill(2)}"

    # Today totals (only for current month)
    today_total = 0
    today_count = 0
    if is_current_month:
        today_agg = await db.expenses.aggregate([
            {"$match": {"is_deleted": False, "expense_date": today}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
        ]).to_list(1)
        today_total = today_agg[0]["total"] if today_agg else 0
        today_count = today_agg[0]["count"] if today_agg else 0

    # Target month stats via $facet
    month_agg = await db.expenses.aggregate([
        {"$match": {"is_deleted": False, "expense_date": {"$gte": month_start, "$lte": month_end}}},
        {"$facet": {
            "totals": [{"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}],
            "auto_manual": [
                {"$group": {"_id": "$is_auto_created", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
            ],
            "by_type": [
                {"$group": {"_id": "$expense_type_name", "count": {"$sum": 1}, "total": {"$sum": "$amount"}}},
                {"$sort": {"total": -1}}
            ],
            "top_vendors": [
                {"$match": {"vendor_name": {"$ne": ""}}},
                {"$group": {"_id": "$vendor_name", "count": {"$sum": 1}, "total": {"$sum": "$amount"}}},
                {"$sort": {"total": -1}},
                {"$limit": 5}
            ]
        }}
    ]).to_list(1)

    # Previous month total
    prev_month_agg = await db.expenses.aggregate([
        {"$match": {"is_deleted": False, "expense_date": {"$gte": prev_month_start, "$lte": prev_month_end}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    prev_month_total = prev_month_agg[0]["total"] if prev_month_agg else 0
    prev_month_count = prev_month_agg[0]["count"] if prev_month_agg else 0

    # Parse facet
    month_total = month_count = 0
    auto_total = auto_count = manual_total = manual_count = 0
    by_type_list = []
    top_vendors_list = []

    if month_agg:
        facet = month_agg[0]
        totals_row = facet.get("totals", [])
        month_total = totals_row[0]["total"] if totals_row else 0
        month_count = totals_row[0]["count"] if totals_row else 0
        for row in facet.get("auto_manual", []):
            if row["_id"]:
                auto_total, auto_count = row["total"], row["count"]
            else:
                manual_total, manual_count = row["total"], row["count"]
        by_type_list = [{"name": r["_id"] or "Unknown", "count": r["count"], "total": r["total"]} for r in facet.get("by_type", [])]
        top_vendors_list = [{"name": r["_id"] or "Unknown", "count": r["count"], "total": r["total"]} for r in facet.get("top_vendors", [])]

    # MoM change
    mom_change = 0
    if prev_month_total > 0:
        mom_change = round(((month_total - prev_month_total) / prev_month_total) * 100, 1)

    # Daily trend for the target month (fill all days)
    daily_trend_agg = await db.expenses.aggregate([
        {"$match": {"is_deleted": False, "expense_date": {"$gte": month_start, "$lte": month_end}}},
        {"$group": {"_id": "$expense_date", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]).to_list(32)

    daily_trend_map = {r["_id"]: {"total": r["total"], "count": r["count"]} for r in daily_trend_agg}
    daily_trend = []
    from datetime import date as date_type
    first_day = date_type(target_year, target_month, 1)
    for i in range(last_day):
        d = first_day + timedelta(days=i)
        date_str = d.isoformat()
        entry = daily_trend_map.get(date_str, {"total": 0, "count": 0})
        daily_trend.append({"date": date_str, "total": entry["total"], "count": entry["count"]})

    # Month label
    month_names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    return {
        "month": f"{target_year}-{str(target_month).zfill(2)}",
        "month_label": f"{month_names[target_month]} {target_year}",
        "is_current_month": is_current_month,
        "today": {"date": today, "count": today_count, "total": today_total} if is_current_month else None,
        "this_month": {"count": month_count, "total": month_total},
        "auto_vs_manual": {
            "auto": {"count": auto_count, "total": auto_total},
            "manual": {"count": manual_count, "total": manual_total}
        },
        "by_type": by_type_list,
        "top_vendors": top_vendors_list,
        "daily_trend": daily_trend,
        "month_over_month": {
            "current_month_total": month_total,
            "last_month_total": prev_month_total,
            "last_month_count": prev_month_count,
            "change_percent": mom_change,
            "direction": "up" if mom_change > 0 else "down" if mom_change < 0 else "flat"
        }
    }


@router.get("/expenses/export")
async def export_expenses(
    request: Request,
    expense_type_id: Optional[str] = None,
    wallet_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    created_by: Optional[str] = None,
    is_auto: Optional[str] = None,
    auth: dict = Depends(auth_required)
):
    """Export expenses to Excel with same filters as list endpoint"""
    await check_permission(auth, "expenses")
    
    query = {"is_deleted": False}
    if expense_type_id:
        query["expense_type_id"] = expense_type_id
    if wallet_id:
        query["wallet_id"] = wallet_id
    if from_date:
        query["expense_date"] = {"$gte": from_date}
    if to_date:
        if "expense_date" in query:
            query["expense_date"]["$lte"] = to_date
        else:
            query["expense_date"] = {"$lte": to_date}
    if created_by and created_by != "all":
        query["created_by"] = created_by
    if is_auto and is_auto != "all":
        query["is_auto_created"] = is_auto == "true"
    if search:
        search_regex = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [
            {"description": search_regex},
            {"vendor_name": search_regex},
            {"reference_number": search_regex},
            {"expense_id": search_regex},
            {"expense_type_name": search_regex},
        ]
    
    expenses = await db.expenses.find(query, {"_id": 0}).sort("expense_date", -1).to_list(50000)
    
    import xlsxwriter
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output)
    worksheet = workbook.add_worksheet("Expenses")
    
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "white", "border": 1})
    text_fmt = workbook.add_format({"border": 1})
    money_fmt = workbook.add_format({"num_format": "₹#,##0.00", "border": 1})
    
    headers = ["Expense ID", "Date", "Type", "Description", "Vendor", "Wallet", "Amount", "Reference", "Auto/Manual", "Created By"]
    for ci, h in enumerate(headers):
        worksheet.write(0, ci, h, header_fmt)
    
    for ri, exp in enumerate(expenses, 1):
        worksheet.write(ri, 0, exp.get("expense_id", ""), text_fmt)
        worksheet.write(ri, 1, exp.get("expense_date", ""), text_fmt)
        worksheet.write(ri, 2, exp.get("expense_type_name", ""), text_fmt)
        worksheet.write(ri, 3, exp.get("description", ""), text_fmt)
        worksheet.write(ri, 4, exp.get("vendor_name", ""), text_fmt)
        worksheet.write(ri, 5, exp.get("wallet_name", ""), text_fmt)
        worksheet.write(ri, 6, exp.get("amount", 0), money_fmt)
        worksheet.write(ri, 7, exp.get("reference_number", ""), text_fmt)
        worksheet.write(ri, 8, "Auto" if exp.get("is_auto_created") else "Manual", text_fmt)
        worksheet.write(ri, 9, exp.get("created_by_name", ""), text_fmt)
    
    for s, e, w in [(0, 0, 12), (1, 1, 12), (2, 2, 18), (3, 3, 30), (4, 4, 20), (5, 5, 18), (6, 6, 14), (7, 7, 15), (8, 8, 10), (9, 9, 15)]:
        worksheet.set_column(s, e, w)
    
    workbook.close()
    output.seek(0)
    
    filename = f"expenses_{from_date or 'all'}_{to_date or 'all'}.xlsx"
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "expenses", details={"count": len(expenses)}, ip=request.client.host if request.client else "")
    
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}"})



@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Delete an expense — refunds the wallet balance and creates a reversal wallet operation"""
    await check_permission(auth, "expenses")
    
    expense = await db.expenses.find_one({"id": expense_id, "is_deleted": False}, {"_id": 0})
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    wallet_id = expense.get("wallet_id")
    refund_amount = expense.get("amount", 0)
    
    # AUDIT-R3-09: Refund the wallet when deleting an expense
    # BUG-5 FIX: Do not refund wallet for auto-created PG charge expenses (they deducted PG fees, not wallet)
    is_auto_created = expense.get("is_auto_created", False)
    if wallet_id and refund_amount > 0 and not is_auto_created:
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": wallet_id, "is_deleted": False},
            {
                "$inc": {"balance": refund_amount},
                "$set": {"updated_at": now_iso}
            },
            return_document=True,
            projection={"_id": 0}
        )
        
        if updated_wallet:
            balance_after = updated_wallet.get("balance", 0)
            balance_before = balance_after - refund_amount
            
            # BUG-S3-10 FIX: add operation_id and sequence_number to wallet operation
            del_op_id = await generate_operation_id(db)
            del_seq = await get_next_operation_sequence(db, wallet_id)
            wallet_op = WalletOperation(
                wallet_id=wallet_id,
                wallet_name=updated_wallet.get("name", ""),
                wallet_type=updated_wallet.get("wallet_type", ""),
                operation_type="credit",
                amount=refund_amount,
                balance_before=balance_before,
                balance_after=balance_after,
                reference_id=expense_id,
                reference_type="expense_reversal",
                notes=f"Expense deleted: {expense.get('description', '')}",
                created_by=auth["user"]["id"],
                created_by_name=auth["user"]["name"]
            )
            op_doc = wallet_op.model_dump()
            op_doc['operation_id'] = del_op_id
            op_doc['sequence_number'] = del_seq
            op_doc['created_at'] = now_iso
            op_doc['updated_at'] = now_iso
            await db.wallet_operations.insert_one(op_doc)
    
    await db.expenses.update_one(
        {"id": expense_id},
        {"$set": {"is_deleted": True, "updated_at": now_iso}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "expenses", expense_id,
        {"refunded_amount": refund_amount, "wallet_id": wallet_id},
        ip=request.client.host if request.client else "")
    
    return {"message": "Expense deleted and wallet refunded", "refunded_amount": refund_amount}
