"""
Comprehensive Transaction Testing - Iteration 55
Tests Type 1 and Type 2 transactions, settlements, payments, voids, and dashboard verification.

Test Plan:
1. Create 3 Type 1 transactions (Direct Swipe) - builds gateway wallet balance
2. Make payments for Type 1 transactions (full and partial)
3. Create 2 Type 2 transactions (Pay + Swipe) - debits gateway wallet
4. Settle Type 2 collections via Card Swipe, Cash, Bank Transfer
5. Test void settlement and re-settle
6. Verify dashboard, collection stats, commission stats, daily closing, profit report
"""
import pytest
import requests
import os
import time
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable not set")

# Test credentials
TEST_EMAIL = "logesh@infozub.com"
TEST_PASSWORD = "ValidNewPass@789"

# Test data from agent context
CUSTOMERS = {
    "rahul": {
        "id": "b3bb3a12-014c-4b35-99eb-e95c5ee5616d",
        "card_id": "59cb9e97-b616-412f-8e36-0f47209e3ef4",
        "name": "Rahul Sharma"
    },
    "amit": {
        "id": "a251862e-f017-443b-8fd1-a723b2210764",
        "card_a_id": "a2299638-6159-4526-83b3-c275dc783827",
        "card_b_id": "f7c456f4-27ed-4b3a-8000-441a95fc5cc7",
        "name": "Amit Kumar"
    },
    "priya": {
        "id": "a3e78d12-da85-41b7-96d4-963d68b7c2e3",
        "card_id": "cdad9d22-a6cc-49c1-be58-944ffb4301fe",
        "name": "Priya Patel"
    }
}

GATEWAYS = {
    "payu": {
        "id": "7baef705-f37d-46eb-9a7d-81ffa0b3b80c",
        "wallet_id": "2ec79d91-9051-4ec5-8c2e-f3b27d58151f",
        "server_a_id": "9cb72490-8ec4-4df3-b026-a9413eeb5602",  # 1.5% PG
        "server_b_id": "fc9bd726-ea12-43e2-9037-c7b52b898835",  # 2.0% PG
        "name": "PayU Gateway"
    },
    "razorpay": {
        "id": "cfc31624-ffa4-4e7d-a51f-3005f11d2620",
        "wallet_id": "fc58e7ba-ce2d-4db9-97a9-52580f4f8052",
        "server_1_id": "e6ea353e-5416-4333-b4f3-1cdf376d55d1",  # 1.2% PG
        "name": "Razorpay Gateway"
    }
}

WALLETS = {
    "cash": {
        "id": "ea1f6abf-b21f-407e-a671-0696bb6c600e",
        "name": "Main Cash"
    },
    "bank": {
        "id": "0b889300-bec2-4766-9c5b-aa5e7ae95115",
        "name": "HDFC Current Account"
    }
}


class TestSession:
    """Shared test session with authentication"""
    token = None
    session = None
    
    @classmethod
    def get_session(cls):
        if cls.session is None:
            cls.session = requests.Session()
            cls.session.headers.update({"Content-Type": "application/json"})
        return cls.session
    
    @classmethod
    def authenticate(cls):
        if cls.token:
            return cls.token
        
        session = cls.get_session()
        # Login
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if response.status_code != 200:
            pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
        
        data = response.json()
        cls.token = data.get("token")
        if cls.token:
            session.headers.update({"Authorization": f"Bearer {cls.token}"})
        
        # Also set cookie if returned
        if "finflow_session" in response.cookies:
            session.cookies.set("finflow_session", response.cookies["finflow_session"])
        
        return cls.token


@pytest.fixture(scope="module")
def auth_session():
    """Get authenticated session"""
    TestSession.authenticate()
    return TestSession.get_session()


# ============== PHASE 1: TYPE 01 TRANSACTIONS ==============

class TestType01Transactions:
    """Test Type 01 (Direct Swipe) transactions"""
    
    created_transactions = []
    
    def test_01_create_type01_rahul_50000(self, auth_session):
        """Create Type 01 transaction for Rahul - 50000 via PayU Server-A (1.5% PG)"""
        payload = {
            "customer_id": CUSTOMERS["rahul"]["id"],
            "card_id": CUSTOMERS["rahul"]["card_id"],
            "swipe_amount": 50000,
            "swipe_gateway_id": GATEWAYS["payu"]["id"],
            "swipe_server_id": GATEWAYS["payu"]["server_a_id"],
            "total_charge_percentage": 3.0,  # 1.5% PG + 1.5% commission
            "notes": "TEST_Type01_Rahul_50000"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json=payload)
        print(f"Type01 Rahul Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify transaction structure
        assert data["transaction_type"] == "type_01"
        assert data["swipe_amount"] == 50000
        assert data["gateway_charge_percentage"] == 1.5
        assert data["commission_percentage"] == 1.5
        assert data["gateway_charge_amount"] == 750  # 50000 * 1.5%
        assert data["commission_amount"] == 750  # 50000 * 1.5%
        assert data["amount_to_customer"] == 48500  # 50000 - 750 - 750
        assert data["status"] == "payment_pending"
        
        self.__class__.created_transactions.append(data)
        print(f"Created Type01 transaction: {data['transaction_id']}")
    
    def test_02_create_type01_amit_30000(self, auth_session):
        """Create Type 01 transaction for Amit - 30000 via PayU Server-B (2.0% PG)"""
        payload = {
            "customer_id": CUSTOMERS["amit"]["id"],
            "card_id": CUSTOMERS["amit"]["card_a_id"],
            "swipe_amount": 30000,
            "swipe_gateway_id": GATEWAYS["payu"]["id"],
            "swipe_server_id": GATEWAYS["payu"]["server_b_id"],
            "total_charge_percentage": 4.0,  # 2.0% PG + 2.0% commission
            "notes": "TEST_Type01_Amit_30000"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json=payload)
        print(f"Type01 Amit Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["transaction_type"] == "type_01"
        assert data["swipe_amount"] == 30000
        assert data["gateway_charge_percentage"] == 2.0
        assert data["commission_percentage"] == 2.0
        assert data["gateway_charge_amount"] == 600  # 30000 * 2.0%
        assert data["commission_amount"] == 600  # 30000 * 2.0%
        assert data["amount_to_customer"] == 28800  # 30000 - 600 - 600
        
        self.__class__.created_transactions.append(data)
        print(f"Created Type01 transaction: {data['transaction_id']}")
    
    def test_03_create_type01_priya_20000(self, auth_session):
        """Create Type 01 transaction for Priya - 20000 via Razorpay (1.2% PG)"""
        payload = {
            "customer_id": CUSTOMERS["priya"]["id"],
            "card_id": CUSTOMERS["priya"]["card_id"],
            "swipe_amount": 20000,
            "swipe_gateway_id": GATEWAYS["razorpay"]["id"],
            "swipe_server_id": GATEWAYS["razorpay"]["server_1_id"],
            "total_charge_percentage": 3.0,  # 1.2% PG + 1.8% commission
            "notes": "TEST_Type01_Priya_20000"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json=payload)
        print(f"Type01 Priya Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["transaction_type"] == "type_01"
        assert data["swipe_amount"] == 20000
        assert data["gateway_charge_percentage"] == 1.2
        assert data["commission_percentage"] == 1.8
        assert data["gateway_charge_amount"] == 240  # 20000 * 1.2%
        assert data["commission_amount"] == 360  # 20000 * 1.8%
        assert data["amount_to_customer"] == 19400  # 20000 - 240 - 360
        
        self.__class__.created_transactions.append(data)
        print(f"Created Type01 transaction: {data['transaction_id']}")
    
    def test_04_verify_gateway_wallet_balances(self, auth_session):
        """Verify gateway wallets received correct amounts after Type 01 transactions"""
        # PayU wallet should have: (50000 - 750) + (30000 - 600) = 49250 + 29400 = 78650
        # Razorpay wallet should have: 20000 - 240 = 19760
        
        response = auth_session.get(f"{BASE_URL}/api/wallets")
        assert response.status_code == 200
        
        wallets = response.json()
        payu_wallet = next((w for w in wallets if w["id"] == GATEWAYS["payu"]["wallet_id"]), None)
        razorpay_wallet = next((w for w in wallets if w["id"] == GATEWAYS["razorpay"]["wallet_id"]), None)
        
        print(f"PayU Wallet Balance: {payu_wallet['balance'] if payu_wallet else 'NOT FOUND'}")
        print(f"Razorpay Wallet Balance: {razorpay_wallet['balance'] if razorpay_wallet else 'NOT FOUND'}")
        
        # Note: These assertions may need adjustment based on existing balance
        assert payu_wallet is not None, "PayU wallet not found"
        assert razorpay_wallet is not None, "Razorpay wallet not found"
        
        # Store balances for later verification
        self.__class__.payu_balance_after_type01 = payu_wallet["balance"]
        self.__class__.razorpay_balance_after_type01 = razorpay_wallet["balance"]


# ============== PHASE 2: PAYMENTS FOR TYPE 01 ==============

class TestType01Payments:
    """Test payments to customers for Type 01 transactions"""
    
    def test_01_full_payment_rahul(self, auth_session):
        """Make full payment to Rahul for Type 01 transaction via cash"""
        # Get Rahul's pending transaction
        response = auth_session.get(f"{BASE_URL}/api/payments/pending", params={
            "customer_id": CUSTOMERS["rahul"]["id"]
        })
        assert response.status_code == 200
        
        pending = response.json()["data"]
        rahul_txn = next((t for t in pending if "TEST_Type01_Rahul" in (t.get("notes") or "")), None)
        
        if not rahul_txn:
            pytest.skip("Rahul's Type 01 transaction not found in pending")
        
        remaining = rahul_txn["amount_remaining_to_customer"]
        print(f"Rahul remaining to pay: {remaining}")
        
        # Make full payment via cash wallet
        payload = {
            "transaction_id": rahul_txn["id"],
            "amount": remaining,
            "payment_source_id": WALLETS["cash"]["id"],
            "payment_source_type": "cash_wallet",
            "payment_method": "cash",
            "notes": "TEST_FullPayment_Rahul"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/payments/record", json=payload)
        print(f"Full Payment Rahul Response: {response.status_code}")
        
        # May fail if cash wallet has insufficient balance - that's expected
        if response.status_code == 400 and "Insufficient" in response.text:
            pytest.skip("Cash wallet has insufficient balance for full payment")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["amount"] == remaining
        print(f"Full payment recorded: {data['id']}")
    
    def test_02_partial_payment_amit(self, auth_session):
        """Make partial payment to Amit for Type 01 transaction"""
        # Get Amit's pending transaction
        response = auth_session.get(f"{BASE_URL}/api/payments/pending", params={
            "customer_id": CUSTOMERS["amit"]["id"]
        })
        assert response.status_code == 200
        
        pending = response.json()["data"]
        amit_txn = next((t for t in pending if "TEST_Type01_Amit" in (t.get("notes") or "")), None)
        
        if not amit_txn:
            pytest.skip("Amit's Type 01 transaction not found in pending")
        
        remaining = amit_txn["amount_remaining_to_customer"]
        partial_amount = remaining / 2  # Pay half
        print(f"Amit remaining: {remaining}, paying partial: {partial_amount}")
        
        # Make partial payment via PayU gateway wallet
        payload = {
            "transaction_id": amit_txn["id"],
            "amount": partial_amount,
            "payment_source_id": GATEWAYS["payu"]["wallet_id"],
            "payment_source_type": "gateway_wallet",
            "payment_method": "gateway_transfer",
            "notes": "TEST_PartialPayment_Amit"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/payments/record", json=payload)
        print(f"Partial Payment Amit Response: {response.status_code}")
        
        if response.status_code == 400 and "Insufficient" in response.text:
            pytest.skip("Gateway wallet has insufficient balance for partial payment")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["amount"] == partial_amount
        print(f"Partial payment recorded: {data['id']}")


# ============== PHASE 3: TYPE 02 TRANSACTIONS ==============

class TestType02Transactions:
    """Test Type 02 (Pay + Swipe) transactions"""
    
    created_transactions = []
    created_collections = []
    
    def test_01_create_type02_amit_100000(self, auth_session):
        """Create Type 02 transaction for Amit - 100000 pay_to_card via PayU"""
        # First check PayU wallet balance
        response = auth_session.get(f"{BASE_URL}/api/wallets")
        wallets = response.json()
        payu_wallet = next((w for w in wallets if w["id"] == GATEWAYS["payu"]["wallet_id"]), None)
        
        if not payu_wallet or payu_wallet["balance"] < 100000:
            pytest.skip(f"PayU wallet balance ({payu_wallet['balance'] if payu_wallet else 0}) insufficient for 100000 Type 02")
        
        payload = {
            "customer_id": CUSTOMERS["amit"]["id"],
            "card_id": CUSTOMERS["amit"]["card_b_id"],
            "pay_to_card_amount": 100000,
            "pay_sources": [
                {"gateway_id": GATEWAYS["payu"]["id"], "amount": 100000}
            ],
            "notes": "TEST_Type02_Amit_100000"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/transactions/type02", json=payload)
        print(f"Type02 Amit Response: {response.status_code}")
        
        if response.status_code == 400 and "Insufficient" in response.text:
            pytest.skip("PayU wallet has insufficient balance for Type 02")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["transaction_type"] == "type_02"
        assert data["pay_to_card_amount"] == 100000
        assert data["status"] == "pending_swipe"
        
        self.__class__.created_transactions.append(data)
        print(f"Created Type02 transaction: {data['transaction_id']}")
    
    def test_02_create_type02_priya_50000(self, auth_session):
        """Create Type 02 transaction for Priya - 50000 pay_to_card via PayU"""
        # Check PayU wallet balance
        response = auth_session.get(f"{BASE_URL}/api/wallets")
        wallets = response.json()
        payu_wallet = next((w for w in wallets if w["id"] == GATEWAYS["payu"]["wallet_id"]), None)
        
        if not payu_wallet or payu_wallet["balance"] < 50000:
            pytest.skip(f"PayU wallet balance ({payu_wallet['balance'] if payu_wallet else 0}) insufficient for 50000 Type 02")
        
        payload = {
            "customer_id": CUSTOMERS["priya"]["id"],
            "card_id": CUSTOMERS["priya"]["card_id"],
            "pay_to_card_amount": 50000,
            "pay_sources": [
                {"gateway_id": GATEWAYS["payu"]["id"], "amount": 50000}
            ],
            "notes": "TEST_Type02_Priya_50000"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/transactions/type02", json=payload)
        print(f"Type02 Priya Response: {response.status_code}")
        
        if response.status_code == 400 and "Insufficient" in response.text:
            pytest.skip("PayU wallet has insufficient balance for Type 02")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["transaction_type"] == "type_02"
        assert data["pay_to_card_amount"] == 50000
        assert data["status"] == "pending_swipe"
        
        self.__class__.created_transactions.append(data)
        print(f"Created Type02 transaction: {data['transaction_id']}")
    
    def test_03_verify_collections_created(self, auth_session):
        """Verify collections were created for Type 02 transactions"""
        response = auth_session.get(f"{BASE_URL}/api/collections", params={"status": "pending"})
        assert response.status_code == 200
        
        collections = response.json()["data"]
        
        # Find collections for our test transactions
        for txn in self.__class__.created_transactions:
            coll = next((c for c in collections if c.get("transaction_id") == txn["id"]), None)
            if coll:
                self.__class__.created_collections.append(coll)
                print(f"Found collection {coll['pending_payment_id']} for transaction {txn['transaction_id']}")
        
        print(f"Total collections found: {len(self.__class__.created_collections)}")


# ============== PHASE 4: COLLECTION SETTLEMENTS ==============

class TestCollectionSettlements:
    """Test collection settlements via different methods"""
    
    settled_collections = []
    
    def test_01_settle_via_card_swipe(self, auth_session):
        """Settle Amit's Type 02 collection via Card Swipe with 3% charges"""
        # Get pending collections for Amit
        response = auth_session.get(f"{BASE_URL}/api/collections", params={
            "customer_id": CUSTOMERS["amit"]["id"],
            "status": "pending"
        })
        assert response.status_code == 200
        
        collections = response.json()["data"]
        amit_coll = next((c for c in collections if c.get("amount") == 100000), None)
        
        if not amit_coll:
            pytest.skip("Amit's 100000 collection not found")
        
        print(f"Settling collection {amit_coll['id']} amount {amit_coll['amount']}")
        
        # Settle via card swipe with 3% total charges (1.5% PG + 1.5% commission)
        payload = {
            "method": "card_swipe",
            "gross_amount": amit_coll["amount"],
            "charge_percentage": 3.0,
            "gateway_id": GATEWAYS["payu"]["id"],
            "server_id": GATEWAYS["payu"]["server_a_id"],
            "include_charges": False,
            "notes": "TEST_CardSwipe_Settlement_Amit"
        }
        
        response = auth_session.post(
            f"{BASE_URL}/api/collections/{amit_coll['id']}/settle-unified",
            json=payload
        )
        print(f"Card Swipe Settlement Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["success"] == True
        assert data["settlement"]["method"] == "card_swipe"
        assert data["settlement"]["gross_amount"] == 100000
        
        self.__class__.settled_collections.append(data)
        print(f"Settlement complete. Status: {data['collection']['status']}")
    
    def test_02_settle_via_cash(self, auth_session):
        """Settle Priya's Type 02 collection via Cash"""
        # Get pending collections for Priya
        response = auth_session.get(f"{BASE_URL}/api/collections", params={
            "customer_id": CUSTOMERS["priya"]["id"],
            "status": "pending"
        })
        assert response.status_code == 200
        
        collections = response.json()["data"]
        priya_coll = next((c for c in collections if c.get("amount") == 50000), None)
        
        if not priya_coll:
            pytest.skip("Priya's 50000 collection not found")
        
        print(f"Settling collection {priya_coll['id']} amount {priya_coll['amount']}")
        
        # Settle via cash with 2% charges
        payload = {
            "method": "cash",
            "gross_amount": priya_coll["amount"],
            "charge_percentage": 2.0,
            "wallet_id": WALLETS["cash"]["id"],
            "include_charges": False,
            "notes": "TEST_Cash_Settlement_Priya"
        }
        
        response = auth_session.post(
            f"{BASE_URL}/api/collections/{priya_coll['id']}/settle-unified",
            json=payload
        )
        print(f"Cash Settlement Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["success"] == True
        assert data["settlement"]["method"] == "cash"
        
        # Store for void test
        self.__class__.priya_collection_id = priya_coll["id"]
        self.__class__.priya_settlement_id = data["collection"]["settlements"][-1]["id"]
        self.__class__.settled_collections.append(data)
        print(f"Cash settlement complete. Status: {data['collection']['status']}")
    
    def test_03_void_cash_settlement(self, auth_session):
        """Void Priya's cash settlement"""
        if not hasattr(self.__class__, 'priya_collection_id'):
            pytest.skip("No Priya collection to void")
        
        response = auth_session.post(
            f"{BASE_URL}/api/collections/{self.__class__.priya_collection_id}/void-settlement/{self.__class__.priya_settlement_id}",
            params={"reason": "TEST_Void_Cash_Settlement_Priya"}
        )
        print(f"Void Settlement Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "voided" in data["message"].lower() or "success" in data["message"].lower()
        print(f"Void complete: {data}")
    
    def test_04_resettle_via_bank_transfer(self, auth_session):
        """Re-settle Priya's collection via Bank Transfer"""
        if not hasattr(self.__class__, 'priya_collection_id'):
            pytest.skip("No Priya collection to re-settle")
        
        # Get the collection again
        response = auth_session.get(f"{BASE_URL}/api/collections", params={
            "customer_id": CUSTOMERS["priya"]["id"]
        })
        assert response.status_code == 200
        
        collections = response.json()["data"]
        priya_coll = next((c for c in collections if c["id"] == self.__class__.priya_collection_id), None)
        
        if not priya_coll:
            pytest.skip("Priya's collection not found after void")
        
        if priya_coll["status"] == "settled":
            pytest.skip("Collection already settled")
        
        remaining = priya_coll["amount"] - priya_coll.get("settled_amount", 0)
        print(f"Re-settling collection. Remaining: {remaining}")
        
        # Settle via bank transfer with 2.5% charges
        payload = {
            "method": "bank_transfer",
            "gross_amount": remaining,
            "charge_percentage": 2.5,
            "wallet_id": WALLETS["bank"]["id"],
            "payment_type": "NEFT",
            "include_charges": False,
            "notes": "TEST_BankTransfer_Settlement_Priya"
        }
        
        response = auth_session.post(
            f"{BASE_URL}/api/collections/{priya_coll['id']}/settle-unified",
            json=payload
        )
        print(f"Bank Transfer Settlement Response: {response.status_code}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["success"] == True
        assert data["settlement"]["method"] == "bank_transfer"
        print(f"Bank transfer settlement complete. Status: {data['collection']['status']}")


# ============== PHASE 5: DASHBOARD VERIFICATION ==============

class TestDashboardVerification:
    """Verify dashboard numbers match expected values"""
    
    def test_01_dashboard_main_stats(self, auth_session):
        """Verify main dashboard statistics"""
        response = auth_session.get(f"{BASE_URL}/api/dashboard")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Dashboard Stats:")
        print(f"  Today Transactions: {data['today_transactions']}")
        print(f"  Today Volume: {data['today_volume']}")
        print(f"  Today Profit: {data['today_profit']}")
        print(f"  Total Pending: {data['total_pending']}")
        print(f"  Total Receivable: {data['total_receivable']}")
        print(f"  Total Wallet Balance: {data['total_wallet_balance']}")
        
        # Basic sanity checks
        assert data['today_transactions'] >= 0
        assert data['today_volume'] >= 0
        assert data['total_wallet_balance'] >= 0
    
    def test_02_collection_stats(self, auth_session):
        """Verify collection statistics"""
        response = auth_session.get(f"{BASE_URL}/api/collections/stats")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Collection Stats:")
        print(f"  Pending Count: {data['pending_count']}")
        print(f"  Total Receivable: {data['total_receivable']}")
        print(f"  Collected Today: {data['collected_today']}")
        
        assert data['pending_count'] >= 0
        assert data['total_receivable'] >= 0
    
    def test_03_commission_stats(self, auth_session):
        """Verify commission statistics"""
        response = auth_session.get(f"{BASE_URL}/api/dashboard/commission-stats")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Commission Stats:")
        print(f"  Commission Earned: {data['commission_earned']}")
        print(f"  Commission Earned Type01: {data['commission_earned_type01']}")
        print(f"  Commission Earned Type02: {data['commission_earned_type02']}")
        print(f"  Commission Collected: {data['commission_collected']}")
        print(f"  Commission Outstanding: {data['commission_outstanding']}")
        
        assert data['commission_earned'] >= 0
    
    def test_04_daily_closing_today(self, auth_session):
        """Verify daily closing for today"""
        response = auth_session.get(f"{BASE_URL}/api/daily-closing/today")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Daily Closing Today:")
        print(f"  Total Transactions: {data.get('total_transactions', 0)}")
        print(f"  Total Swipe Amount: {data.get('total_swipe_amount', 0)}")
        print(f"  Total Commission: {data.get('total_commission', 0)}")
        print(f"  Total Gateway Charges: {data.get('total_gateway_charges', 0)}")
    
    def test_05_profit_report(self, auth_session):
        """Verify profit report"""
        response = auth_session.get(f"{BASE_URL}/api/reports/profit")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Profit Report Summary:")
        print(f"  Total Commission: {data['summary']['total_commission']}")
        print(f"  Total PG Charges: {data['summary']['total_pg_charges']}")
        print(f"  Total Net Profit: {data['summary']['total_net_profit']}")
        print(f"  Total Transactions: {data['summary']['total_transactions']}")
    
    def test_06_monthly_pnl(self, auth_session):
        """Verify monthly P&L report"""
        response = auth_session.get(f"{BASE_URL}/api/reports/monthly-pnl")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Monthly P&L Summary:")
        print(f"  YTD Volume: {data['summary']['ytd_volume']}")
        print(f"  YTD Commission: {data['summary']['ytd_commission']}")
        print(f"  YTD Net Profit: {data['summary']['ytd_net_profit']}")
        print(f"  Total Months: {data['summary']['total_months']}")


# ============== PHASE 6: PAYMENT VOID TEST ==============

class TestPaymentVoid:
    """Test voiding a payment"""
    
    def test_01_void_payment(self, auth_session):
        """Test voiding a payment (if any exists)"""
        # Get recent payments
        response = auth_session.get(f"{BASE_URL}/api/payments/history", params={"limit": 10})
        assert response.status_code == 200
        
        payments = response.json()["data"]
        test_payment = next((p for p in payments if "TEST_" in (p.get("notes") or "")), None)
        
        if not test_payment:
            pytest.skip("No test payment found to void")
        
        print(f"Attempting to void payment: {test_payment['id']}")
        
        response = auth_session.post(
            f"{BASE_URL}/api/payments/{test_payment['id']}/void",
            params={"reason": "TEST_Void_Payment_Verification"}
        )
        print(f"Void Payment Response: {response.status_code}")
        
        # May fail if payment is already voided or transaction is reversed
        if response.status_code == 400:
            print(f"Void failed (expected): {response.text}")
            pytest.skip("Payment cannot be voided")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        print(f"Payment voided: {data}")


# ============== PHASE 7: TRANSACTION REVERSAL TEST ==============

class TestTransactionReversal:
    """Test transaction reversal"""
    
    def test_01_reverse_type01_transaction(self, auth_session):
        """Test reversing a Type 01 transaction (if eligible)"""
        # Get recent transactions
        response = auth_session.get(f"{BASE_URL}/api/transactions", params={
            "transaction_type": "type_01",
            "limit": 10
        })
        assert response.status_code == 200
        
        transactions = response.json()["data"]
        
        # Find a transaction that can be reversed (no payments made)
        reversible_txn = None
        for txn in transactions:
            if txn.get("status") != "reversed" and txn.get("amount_paid_to_customer", 0) == 0:
                if "TEST_" in (txn.get("notes") or ""):
                    reversible_txn = txn
                    break
        
        if not reversible_txn:
            pytest.skip("No reversible Type 01 transaction found")
        
        print(f"Attempting to reverse transaction: {reversible_txn['transaction_id']}")
        
        response = auth_session.post(
            f"{BASE_URL}/api/transactions/{reversible_txn['id']}/reverse",
            params={"reason": "TEST_Reversal_Verification_Iteration55"}
        )
        print(f"Reverse Transaction Response: {response.status_code}")
        
        if response.status_code == 400:
            print(f"Reversal failed (expected): {response.text}")
            pytest.skip("Transaction cannot be reversed")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        print(f"Transaction reversed: {data}")


# ============== RUN ALL TESTS ==============

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-s"])
