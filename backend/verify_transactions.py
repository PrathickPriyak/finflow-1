"""Quick verification: count transactions by type and summarize amounts."""
import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    t1 = await db.transactions.count_documents({"transaction_type": "type_01", "is_deleted": False})
    t2 = await db.transactions.count_documents({"transaction_type": "type_02", "is_deleted": False})

    sum1 = await db.transactions.aggregate([
        {"$match": {"transaction_type": "type_01", "is_deleted": False}},
        {"$group": {"_id": None, "sum_swipe": {"$sum": "$swipe_amount"},
                    "sum_remaining": {"$sum": "$amount_remaining_to_customer"}}},
    ]).to_list(1)
    sum2 = await db.transactions.aggregate([
        {"$match": {"transaction_type": "type_02", "is_deleted": False}},
        {"$group": {"_id": None, "sum_pay": {"$sum": "$pay_to_card_amount"},
                    "sum_remaining": {"$sum": "$amount_remaining_to_customer"}}},
    ]).to_list(1)

    print("=" * 60)
    print(f"  Type-01 transactions:  {t1}")
    if sum1:
        print(f"    Total swipe amount:           Rs {sum1[0]['sum_swipe']:>14,.2f}")
        print(f"    Pending payouts (Type-01):    Rs {sum1[0]['sum_remaining']:>14,.2f}")
    print()
    print(f"  Type-02 transactions:  {t2}")
    if sum2:
        print(f"    Total pay-to-card amount:     Rs {sum2[0]['sum_pay']:>14,.2f}")
        print(f"    Pending payouts (Type-02):    Rs {sum2[0]['sum_remaining']:>14,.2f}")

    print()
    coll_count = await db.collections.count_documents({"is_deleted": False, "source": {"$ne": "service_charge"}})
    coll_pending = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "status": {"$ne": "settled"}, "source": {"$ne": "service_charge"}}},
        {"$project": {"diff": {"$subtract": ["$amount", {"$ifNull": ["$settled_amount", 0]}]}}},
        {"$group": {"_id": None, "sum": {"$sum": "$diff"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    print(f"  Total collections rows: {coll_count}")
    if coll_pending:
        print(f"  Outstanding collections (customers owe business): "
              f"Rs {coll_pending[0]['sum']:>14,.2f}  ({coll_pending[0]['count']} pending)")

    print()
    customers = await db.customers.count_documents({"is_deleted": False})
    gateways = await db.gateways.count_documents({"is_deleted": False})
    banks = await db.banks.count_documents({"is_deleted": False})
    print(f"  Setup state: {customers} customers | {gateways} gateways | {banks} banks")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
