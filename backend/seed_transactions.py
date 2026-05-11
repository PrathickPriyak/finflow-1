"""
One-off seed script: create banks, gateways, servers, customers, cards, and
10 transactions of each type (Type-01 direct swipe, Type-02 pay-to-card).

Runs inside the backend container against the local API.

Usage:
    docker exec finflow-backend python /app/seed_transactions.py
"""
import os
import random
import sys
import time
import uuid

import requests

API = os.environ.get("SEED_API", "http://localhost:8001/api")
EMAIL = os.environ.get("SEED_EMAIL", "admin@finflow.local")
PASSWORD = os.environ.get("SEED_PASSWORD", "Admin@Local123!")


def fail(step, resp):
    print(f"[FAIL] {step}: HTTP {resp.status_code} — {resp.text[:400]}", flush=True)
    sys.exit(1)


def ok(step, resp, expected=(200, 201)):
    if resp.status_code not in expected:
        fail(step, resp)
    print(f"[OK]   {step}", flush=True)
    try:
        return resp.json()
    except Exception:
        return {}


def main():
    s = requests.Session()

    # 1) Login (DEV_MODE skips OTP, returns token directly)
    print(f"\n>>> Logging in as {EMAIL} at {API}", flush=True)
    r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    data = ok("auth/login", r)
    token = data.get("token")
    if not token:
        print(f"[FAIL] No token returned: {data}", flush=True)
        sys.exit(1)
    s.headers.update({"Authorization": f"Bearer {token}"})

    # 2) Banks (idempotent — reuse existing if present)
    print("\n>>> Banks", flush=True)
    existing_banks = ok("GET /banks", s.get(f"{API}/banks", timeout=15)) or []
    banks_by_name = {b["name"]: b for b in existing_banks}
    for bank_name in ["HDFC Bank", "ICICI Bank", "SBI"]:
        if bank_name in banks_by_name:
            print(f"[SKIP] {bank_name} already exists", flush=True)
            continue
        r = s.post(f"{API}/banks", json={"name": bank_name, "code": bank_name.split()[0]}, timeout=15)
        if r.status_code in (200, 201):
            banks_by_name[bank_name] = r.json()
            print(f"[OK]   Created bank: {bank_name}", flush=True)
        else:
            fail(f"create bank {bank_name}", r)
    hdfc = banks_by_name["HDFC Bank"]

    # Card networks already seeded by migration; fetch Visa
    networks = ok("GET /card-networks", s.get(f"{API}/card-networks", timeout=15)) or []
    visa = next((n for n in networks if n["name"].lower() == "visa"), None)
    if not visa:
        print("[FAIL] No Visa card network found", flush=True)
        sys.exit(1)

    # 3) Gateways with funded wallets
    print("\n>>> Gateways", flush=True)
    existing_gws = ok("GET /gateways", s.get(f"{API}/gateways", timeout=15)) or []
    gws_by_name = {g["name"]: g for g in existing_gws}
    gateway_specs = [
        ("Razorpay", 2_000_000),  # ample balance for Type-02 pay sources
        ("Stripe", 2_000_000),
    ]
    gateways = []
    for name, balance in gateway_specs:
        if name in gws_by_name:
            gw = gws_by_name[name]
            print(f"[SKIP] {name} already exists", flush=True)
        else:
            r = s.post(
                f"{API}/gateways",
                json={"name": name, "description": f"{name} test gateway", "wallet_balance": balance},
                timeout=15,
            )
            gw = ok(f"POST /gateways {name}", r)
        gateways.append(gw)

    # 4) Gateway servers
    print("\n>>> Gateway servers", flush=True)
    for gw in gateways:
        resp = ok(
            f"GET /gateways/{gw['id']}/servers",
            s.get(f"{API}/gateways/{gw['id']}/servers", timeout=15),
        ) or {}
        existing_servers = resp.get("servers", []) if isinstance(resp, dict) else resp
        server_names = {sr["name"] for sr in existing_servers}
        for server_name, pct in [("Standard", 2.0), ("Premium", 3.5)]:
            if server_name in server_names:
                print(f"[SKIP] {gw['name']} / {server_name} exists", flush=True)
                continue
            r = s.post(
                f"{API}/gateways/{gw['id']}/servers",
                json={"name": server_name, "charge_percentage": pct},
                timeout=15,
            )
            ok(f"POST /gateways/{gw['id']}/servers {server_name} ({pct}%)", r)

    razorpay = gws_by_name.get("Razorpay") or next(g for g in gateways if g["name"] == "Razorpay")
    resp = ok(
        f"GET /gateways/{razorpay['id']}/servers",
        s.get(f"{API}/gateways/{razorpay['id']}/servers", timeout=15),
    ) or {}
    razorpay_servers = resp.get("servers", []) if isinstance(resp, dict) else resp
    standard_server = next(sr for sr in razorpay_servers if sr["name"] == "Standard")

    # 5) Create 10 customers with one card each
    print("\n>>> Customers + cards", flush=True)
    customers = []
    for i in range(1, 11):
        phone = f"99999{10000 + i:05d}"
        # Try to reuse if a customer with this phone already exists
        existing = s.get(f"{API}/customers?search={phone}", timeout=15).json().get("data", [])
        if existing:
            cust = existing[0]
            print(f"[SKIP] Customer {cust.get('customer_id')} ({phone}) exists", flush=True)
        else:
            r = s.post(
                f"{API}/customers",
                json={
                    "name": f"Test Customer {i:02d}",
                    "phone": phone,
                    "id_proof": f"PAN{1000+i}",
                    "charge_note": "5% standard",
                    "notes": "Seeded for transaction testing",
                },
                timeout=15,
            )
            cust = ok(f"POST /customers #{i}", r)
        if not cust.get("cards"):
            r = s.post(
                f"{API}/customers/{cust['id']}/cards",
                json={
                    "bank_id": hdfc["id"],
                    "card_network_id": visa["id"],
                    "last_four_digits": f"{1000 + i:04d}",
                },
                timeout=15,
            )
            card = ok(f"POST /customers/{cust['id']}/cards", r)
            cust["cards"] = [card]
        customers.append(cust)

    print(f"\n[OK]   {len(customers)} customers ready with cards", flush=True)

    # 6) Create 10 Type-01 transactions (one per customer)
    print("\n>>> Type 01 transactions (Direct Swipe)", flush=True)
    type01_results = []
    for i, cust in enumerate(customers, start=1):
        card_id = cust["cards"][0]["id"]
        swipe_amount = round(5000 + i * 1500.0, 2)  # 6500, 8000, ...
        total_charge_pct = 5.0  # >= server pg %
        r = s.post(
            f"{API}/transactions/type01",
            json={
                "customer_id": cust["id"],
                "card_id": card_id,
                "swipe_gateway_id": razorpay["id"],
                "swipe_server_id": standard_server["id"],
                "swipe_amount": swipe_amount,
                "total_charge_percentage": total_charge_pct,
                "notes": f"Seed Type-01 #{i:02d}",
            },
            timeout=15,
        )
        if r.status_code not in (200, 201):
            print(f"[FAIL] Type-01 #{i} for {cust.get('name')}: {r.status_code} {r.text[:300]}", flush=True)
            sys.exit(1)
        tx = r.json()
        type01_results.append(tx)
        print(
            f"[OK]   T01 #{i:02d} — {tx.get('transaction_id')} — {cust['name']} — ₹{swipe_amount:,.2f}",
            flush=True,
        )

    # 7) Create 10 Type-02 transactions (one per customer, different amount)
    print("\n>>> Type 02 transactions (Pay to Card + Swipe Later)", flush=True)
    type02_results = []
    for i, cust in enumerate(customers, start=1):
        card_id = cust["cards"][0]["id"]
        pay_amount = round(3000 + i * 1200.0, 2)
        # Single pay source from Razorpay
        r = s.post(
            f"{API}/transactions/type02",
            json={
                "customer_id": cust["id"],
                "card_id": card_id,
                "pay_to_card_amount": pay_amount,
                "pay_sources": [{"gateway_id": razorpay["id"], "amount": pay_amount}],
                "notes": f"Seed Type-02 #{i:02d}",
            },
            timeout=15,
        )
        if r.status_code not in (200, 201):
            print(f"[FAIL] Type-02 #{i} for {cust.get('name')}: {r.status_code} {r.text[:300]}", flush=True)
            sys.exit(1)
        tx = r.json()
        type02_results.append(tx)
        print(
            f"[OK]   T02 #{i:02d} — {tx.get('transaction_id')} — {cust['name']} — ₹{pay_amount:,.2f}",
            flush=True,
        )

    print("\n" + "=" * 60, flush=True)
    print(f"  SUCCESS: {len(type01_results)} Type-01 + {len(type02_results)} Type-02 transactions created", flush=True)
    print(f"  Total customers used: {len(customers)}", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
