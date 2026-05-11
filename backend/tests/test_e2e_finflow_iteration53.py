"""
FinFlow E2E Test Suite - Iteration 53
Comprehensive end-to-end testing for financial management operations.

Tests cover:
- Authentication (login, OTP bypass in dev mode)
- Master Data (Gateway, Server, Customer, Card, Wallet)
- Type 01 Transactions (Direct Swipe) - Full lifecycle
- Type 02 Transactions (Pay + Swipe) - Full lifecycle
- Collections and Settlements
- Bulk Operations
- Wallet Operations and Transfers
- Dashboard and Reports
- Edge Cases
"""

import pytest
import requests
import os
import time
from datetime import datetime

# Get BASE_URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # Fallback for local testing
    BASE_URL = "https://pwa-financial-hub.preview.emergentagent.com"

# Test credentials
TEST_EMAIL = "logesh@infozub.com"
TEST_PASSWORD = "ValidNewPass@789"

# Test data prefix for cleanup
TEST_PREFIX = "E2E_Test_"


class TestAuthPhase:
    """Phase 1: Authentication Tests"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create a requests session"""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        return s
    
    def test_01_login_valid_credentials(self, session):
        """Test login with valid credentials - should return token in dev mode"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # In dev mode, token should be returned directly
        assert "token" in data, "Token not returned in dev mode"
        assert data.get("requires_otp") == False, "OTP should be bypassed in dev mode"
        
        # Store token for subsequent tests
        session.headers.update({"Authorization": f"Bearer {data['token']}"})
        pytest.auth_token = data['token']
        pytest.user_id = data.get("user", {}).get("id")
        print(f"✓ Login successful, token obtained")
    
    def test_02_login_wrong_password(self, session):
        """Test login with wrong password - should return 401"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": "WrongPassword123!"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"✓ Wrong password correctly rejected with 401")
    
    def test_03_protected_endpoint_without_auth(self):
        """Test accessing protected endpoint without auth - should return 401"""
        response = requests.get(f"{BASE_URL}/api/dashboard")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"✓ Protected endpoint correctly requires auth")


class TestMasterDataPhase:
    """Phase 2: Master Data Setup (Gateway, Server, Customer, Card, Wallet)"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Create authenticated session"""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        
        # Login
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_create_gateway(self, auth_session):
        """Create a new gateway for testing"""
        response = auth_session.post(f"{BASE_URL}/api/gateways", json={
            "name": f"{TEST_PREFIX}Gateway",
            "description": "E2E Test Gateway",
            "wallet_balance": 0
        })
        
        if response.status_code == 400 and "already exists" in response.text:
            # Gateway exists, get it
            gateways = auth_session.get(f"{BASE_URL}/api/gateways").json()
            gateway = next((g for g in gateways if g["name"] == f"{TEST_PREFIX}Gateway"), None)
            assert gateway is not None, "Gateway not found"
            pytest.test_gateway_id = gateway["id"]
            print(f"✓ Gateway already exists: {gateway['id']}")
        else:
            assert response.status_code == 200, f"Create gateway failed: {response.text}"
            data = response.json()
            pytest.test_gateway_id = data["id"]
            print(f"✓ Gateway created: {data['id']}")
    
    def test_02_create_gateway_server(self, auth_session):
        """Create a gateway server with charge_percentage=1.5"""
        gateway_id = pytest.test_gateway_id
        
        response = auth_session.post(f"{BASE_URL}/api/gateways/{gateway_id}/servers", json={
            "name": f"{TEST_PREFIX}Server",
            "charge_percentage": 1.5
        })
        
        if response.status_code == 400 and "already exists" in response.text:
            # Server exists, get it
            servers_resp = auth_session.get(f"{BASE_URL}/api/gateways/{gateway_id}/servers")
            servers = servers_resp.json().get("servers", [])
            server = next((s for s in servers if s["name"] == f"{TEST_PREFIX}Server"), None)
            assert server is not None, "Server not found"
            pytest.test_server_id = server["id"]
            print(f"✓ Server already exists: {server['id']}")
        else:
            assert response.status_code == 200, f"Create server failed: {response.text}"
            data = response.json()
            pytest.test_server_id = data["id"]
            print(f"✓ Server created: {data['id']}")
    
    def test_03_verify_gateway_charge_percentage_field(self, auth_session):
        """Verify GET /gateways returns charge_percentage (NOT charge_percent)"""
        response = auth_session.get(f"{BASE_URL}/api/gateways")
        assert response.status_code == 200, f"Get gateways failed: {response.text}"
        
        gateways = response.json()
        test_gateway = next((g for g in gateways if g["id"] == pytest.test_gateway_id), None)
        assert test_gateway is not None, "Test gateway not found"
        
        # Check servers array
        servers = test_gateway.get("servers", [])
        if servers:
            server = servers[0]
            assert "charge_percentage" in server, f"charge_percentage field missing. Got: {server.keys()}"
            assert "charge_percent" not in server, "charge_percent should NOT exist (use charge_percentage)"
            print(f"✓ Gateway servers correctly use 'charge_percentage' field: {server['charge_percentage']}%")
        else:
            print("⚠ No servers found on gateway to verify field name")
    
    def test_04_fund_gateway_wallet(self, auth_session):
        """Fund the gateway wallet with manual credit"""
        gateway_id = pytest.test_gateway_id
        
        response = auth_session.post(f"{BASE_URL}/api/gateways/{gateway_id}/wallet", json={
            "operation_type": "credit",
            "amount": 500000,
            "notes": "E2E Test: Initial funding"
        })
        assert response.status_code == 200, f"Fund gateway wallet failed: {response.text}"
        data = response.json()
        print(f"✓ Gateway wallet funded. New balance: {data.get('new_balance')}")
        pytest.gateway_wallet_balance = data.get('new_balance', 500000)
    
    def test_05_create_customer(self, auth_session):
        """Create a test customer"""
        response = auth_session.post(f"{BASE_URL}/api/customers", json={
            "name": f"{TEST_PREFIX}Customer",
            "phone": "9876543210",
            "id_proof": "AADHAAR-1234",
            "charge_note": "3% standard",
            "notes": "E2E Test Customer"
        })
        
        if response.status_code == 400 and "already exists" in response.text:
            # Customer exists, find by phone
            customers_resp = auth_session.get(f"{BASE_URL}/api/customers?search=9876543210")
            customers = customers_resp.json().get("data", [])
            customer = next((c for c in customers if "9876543210" in c.get("phone", "")), None)
            assert customer is not None, "Customer not found"
            pytest.test_customer_id = customer["id"]
            print(f"✓ Customer already exists: {customer['id']}")
        else:
            assert response.status_code == 200, f"Create customer failed: {response.text}"
            data = response.json()
            pytest.test_customer_id = data["id"]
            print(f"✓ Customer created: {data['id']}")
    
    def test_06_get_banks_and_networks(self, auth_session):
        """Get banks and card networks for card creation"""
        banks_resp = auth_session.get(f"{BASE_URL}/api/banks")
        networks_resp = auth_session.get(f"{BASE_URL}/api/card-networks")
        
        assert banks_resp.status_code == 200, f"Get banks failed: {banks_resp.text}"
        assert networks_resp.status_code == 200, f"Get networks failed: {networks_resp.text}"
        
        banks = banks_resp.json()
        networks = networks_resp.json()
        
        assert len(banks) > 0, "No banks found"
        assert len(networks) > 0, "No card networks found"
        
        pytest.test_bank_id = banks[0]["id"]
        pytest.test_network_id = networks[0]["id"]
        print(f"✓ Found {len(banks)} banks and {len(networks)} card networks")
    
    def test_07_add_card_to_customer(self, auth_session):
        """Add a card to the test customer"""
        customer_id = pytest.test_customer_id
        
        response = auth_session.post(f"{BASE_URL}/api/customers/{customer_id}/cards", json={
            "bank_id": pytest.test_bank_id,
            "card_network_id": pytest.test_network_id,
            "last_four_digits": "1234"
        })
        
        if response.status_code == 200:
            data = response.json()
            pytest.test_card_id = data["id"]
            print(f"✓ Card added: {data['id']}")
        else:
            # Card might already exist, get customer to find card
            customer_resp = auth_session.get(f"{BASE_URL}/api/customers/{customer_id}")
            customer = customer_resp.json().get("customer", {})
            cards = customer.get("cards", [])
            if cards:
                pytest.test_card_id = cards[0]["id"]
                print(f"✓ Using existing card: {cards[0]['id']}")
            else:
                pytest.fail(f"Add card failed and no existing cards: {response.text}")
    
    def test_08_create_cash_wallet(self, auth_session):
        """Create a cash wallet for payments"""
        response = auth_session.post(f"{BASE_URL}/api/wallets", json={
            "name": f"{TEST_PREFIX}Cash_Wallet",
            "wallet_type": "cash",
            "description": "E2E Test Cash Wallet",
            "balance": 0
        })
        
        if response.status_code == 400 and "already exists" in response.text:
            # Wallet exists, find it
            wallets_resp = auth_session.get(f"{BASE_URL}/api/wallets?wallet_type=cash")
            wallets = wallets_resp.json()
            wallet = next((w for w in wallets if w["name"] == f"{TEST_PREFIX}Cash_Wallet"), None)
            if wallet:
                pytest.test_cash_wallet_id = wallet["id"]
                print(f"✓ Cash wallet already exists: {wallet['id']}")
            else:
                # Use any cash wallet
                cash_wallet = next((w for w in wallets if w["wallet_type"] == "cash"), None)
                assert cash_wallet is not None, "No cash wallet found"
                pytest.test_cash_wallet_id = cash_wallet["id"]
                print(f"✓ Using existing cash wallet: {cash_wallet['id']}")
        else:
            assert response.status_code == 200, f"Create cash wallet failed: {response.text}"
            data = response.json()
            pytest.test_cash_wallet_id = data["id"]
            print(f"✓ Cash wallet created: {data['id']}")
    
    def test_09_fund_cash_wallet(self, auth_session):
        """Fund the cash wallet"""
        wallet_id = pytest.test_cash_wallet_id
        
        response = auth_session.post(f"{BASE_URL}/api/wallets/{wallet_id}/operations", json={
            "operation_type": "credit",
            "amount": 100000,
            "notes": "E2E Test: Initial funding"
        })
        assert response.status_code == 200, f"Fund cash wallet failed: {response.text}"
        data = response.json()
        print(f"✓ Cash wallet funded. New balance: {data.get('new_balance')}")


class TestType01TransactionPhase:
    """Phase 3: Type 01 Transaction - Full Lifecycle"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Create authenticated session"""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_create_type01_transaction(self, auth_session):
        """Create Type 01 transaction: swipe_amount=10000, total_charge=3.0%"""
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "swipe_gateway_id": pytest.test_gateway_id,
            "swipe_server_id": pytest.test_server_id,
            "swipe_amount": 10000,
            "total_charge_percentage": 3.0,
            "notes": "E2E Test Type 01"
        })
        assert response.status_code == 200, f"Create Type 01 failed: {response.text}"
        data = response.json()
        
        pytest.type01_txn_id = data["id"]
        pytest.type01_txn_readable = data.get("transaction_id", "")
        
        # Verify calculations: 1.5% PG + 1.5% commission = 3% total
        # swipe_amount = 10000
        # gateway_charge = 10000 * 1.5% = 150
        # commission = 10000 * 1.5% = 150
        # amount_to_customer = 10000 - 150 - 150 = 9700
        
        assert data.get("commission_amount") == 150, f"Commission should be 150, got {data.get('commission_amount')}"
        assert data.get("gateway_charge_amount") == 150, f"Gateway charge should be 150, got {data.get('gateway_charge_amount')}"
        assert data.get("amount_to_customer") == 9700, f"Amount to customer should be 9700, got {data.get('amount_to_customer')}"
        assert data.get("status") == "payment_pending", f"Status should be payment_pending, got {data.get('status')}"
        
        print(f"✓ Type 01 transaction created: {data.get('transaction_id')}")
        print(f"  Commission: ₹{data.get('commission_amount')}, Gateway: ₹{data.get('gateway_charge_amount')}, To Customer: ₹{data.get('amount_to_customer')}")
    
    def test_02_verify_transaction_in_list(self, auth_session):
        """Verify transaction appears in GET /transactions"""
        response = auth_session.get(f"{BASE_URL}/api/transactions")
        assert response.status_code == 200, f"Get transactions failed: {response.text}"
        
        transactions = response.json().get("data", [])
        txn = next((t for t in transactions if t["id"] == pytest.type01_txn_id), None)
        assert txn is not None, "Transaction not found in list"
        print(f"✓ Transaction found in list")
    
    def test_03_verify_in_pending_payments(self, auth_session):
        """Verify transaction appears in GET /payments/pending with ALL fields"""
        response = auth_session.get(f"{BASE_URL}/api/payments/pending")
        assert response.status_code == 200, f"Get pending payments failed: {response.text}"
        
        pending = response.json().get("data", [])
        txn = next((t for t in pending if t["id"] == pytest.type01_txn_id), None)
        assert txn is not None, "Transaction not found in pending payments"
        
        # Verify all required fields are present (BUG FIX verification: **txn spread)
        required_fields = ["commission_amount", "gateway_charge_amount", "swipe_gateway_name", 
                          "amount_to_customer", "amount_remaining_to_customer"]
        for field in required_fields:
            assert field in txn, f"Field '{field}' missing from pending payment response"
        
        print(f"✓ Transaction in pending payments with all required fields")
    
    def test_04_record_partial_payment(self, auth_session):
        """Record partial payment of 5000 to customer"""
        response = auth_session.post(f"{BASE_URL}/api/payments/record", json={
            "transaction_id": pytest.type01_txn_id,
            "amount": 5000,
            "payment_source_type": "cash_wallet",
            "payment_source_id": pytest.test_cash_wallet_id,
            "payment_method": "Cash",
            "notes": "E2E Test: Partial payment"
        })
        assert response.status_code == 200, f"Record payment failed: {response.text}"
        
        # Verify transaction state
        txn_resp = auth_session.get(f"{BASE_URL}/api/transactions/{pytest.type01_txn_id}")
        txn = txn_resp.json()
        
        assert txn.get("amount_paid_to_customer") == 5000, f"Paid should be 5000, got {txn.get('amount_paid_to_customer')}"
        assert txn.get("amount_remaining_to_customer") == 4700, f"Remaining should be 4700, got {txn.get('amount_remaining_to_customer')}"
        assert txn.get("status") == "payment_pending", f"Status should still be payment_pending"
        assert txn.get("customer_payment_status") == "partial", f"Payment status should be partial"
        
        print(f"✓ Partial payment recorded. Remaining: ₹{txn.get('amount_remaining_to_customer')}")
    
    def test_05_record_final_payment(self, auth_session):
        """Record remaining payment of 4700 to customer"""
        response = auth_session.post(f"{BASE_URL}/api/payments/record", json={
            "transaction_id": pytest.type01_txn_id,
            "amount": 4700,
            "payment_source_type": "cash_wallet",
            "payment_source_id": pytest.test_cash_wallet_id,
            "payment_method": "Cash",
            "notes": "E2E Test: Final payment"
        })
        assert response.status_code == 200, f"Record final payment failed: {response.text}"
        
        # Verify transaction completed
        txn_resp = auth_session.get(f"{BASE_URL}/api/transactions/{pytest.type01_txn_id}")
        txn = txn_resp.json()
        
        assert txn.get("amount_remaining_to_customer") == 0, f"Remaining should be 0, got {txn.get('amount_remaining_to_customer')}"
        assert txn.get("status") == "completed", f"Status should be completed, got {txn.get('status')}"
        assert txn.get("customer_payment_status") == "paid", f"Payment status should be paid"
        
        print(f"✓ Final payment recorded. Transaction completed.")
    
    def test_06_verify_not_in_pending(self, auth_session):
        """Verify completed transaction no longer in pending payments"""
        response = auth_session.get(f"{BASE_URL}/api/payments/pending")
        assert response.status_code == 200
        
        pending = response.json().get("data", [])
        txn = next((t for t in pending if t["id"] == pytest.type01_txn_id), None)
        assert txn is None, "Completed transaction should not be in pending payments"
        
        print(f"✓ Completed transaction correctly removed from pending payments")


class TestType01ReversalPhase:
    """Phase 4: Type 01 Transaction Reversal"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_create_type01_for_reversal(self, auth_session):
        """Create Type 01 transaction for reversal test"""
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "swipe_gateway_id": pytest.test_gateway_id,
            "swipe_server_id": pytest.test_server_id,
            "swipe_amount": 5000,
            "total_charge_percentage": 3.0,
            "notes": "E2E Test: For reversal"
        })
        assert response.status_code == 200, f"Create transaction failed: {response.text}"
        data = response.json()
        pytest.reversal_txn_id = data["id"]
        print(f"✓ Transaction created for reversal: {data.get('transaction_id')}")
    
    def test_02_reverse_transaction(self, auth_session):
        """Reverse the transaction"""
        response = auth_session.post(
            f"{BASE_URL}/api/transactions/{pytest.reversal_txn_id}/reverse",
            params={"reason": "E2E Test: Testing reversal functionality"}
        )
        assert response.status_code == 200, f"Reverse failed: {response.text}"
        
        # Verify transaction state
        txn_resp = auth_session.get(f"{BASE_URL}/api/transactions/{pytest.reversal_txn_id}")
        txn = txn_resp.json()
        
        assert txn.get("status") == "reversed", f"Status should be reversed, got {txn.get('status')}"
        assert txn.get("commission_amount") == 0, f"Commission should be 0 after reversal"
        assert txn.get("gateway_charge_amount") == 0, f"Gateway charge should be 0 after reversal"
        
        print(f"✓ Transaction reversed successfully")
    
    def test_03_verify_not_in_pending_after_reversal(self, auth_session):
        """Verify reversed transaction not in pending payments"""
        response = auth_session.get(f"{BASE_URL}/api/payments/pending")
        assert response.status_code == 200
        
        pending = response.json().get("data", [])
        txn = next((t for t in pending if t["id"] == pytest.reversal_txn_id), None)
        assert txn is None, "Reversed transaction should not be in pending payments"
        
        print(f"✓ Reversed transaction not in pending payments")
    
    def test_04_double_reversal_should_fail(self, auth_session):
        """Try to reverse again - should get 400 error"""
        response = auth_session.post(
            f"{BASE_URL}/api/transactions/{pytest.reversal_txn_id}/reverse",
            params={"reason": "E2E Test: Double reversal attempt"}
        )
        assert response.status_code == 400, f"Expected 400 for double reversal, got {response.status_code}"
        print(f"✓ Double reversal correctly rejected with 400")


class TestType02TransactionPhase:
    """Phase 5: Type 02 Transaction - Full Lifecycle"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_create_type02_transaction(self, auth_session):
        """Create Type 02 transaction: pay_to_card_amount=20000"""
        # Get gateway wallet ID
        gw_wallet_resp = auth_session.get(f"{BASE_URL}/api/gateways/{pytest.test_gateway_id}/wallet")
        gw_wallet = gw_wallet_resp.json().get("wallet", {})
        
        response = auth_session.post(f"{BASE_URL}/api/transactions/type02", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "pay_to_card_amount": 20000,
            "pay_sources": [
                {"gateway_id": pytest.test_gateway_id, "amount": 20000}
            ],
            "notes": "E2E Test Type 02"
        })
        assert response.status_code == 200, f"Create Type 02 failed: {response.text}"
        data = response.json()
        
        pytest.type02_txn_id = data["id"]
        pytest.type02_txn_readable = data.get("transaction_id", "")
        
        assert data.get("status") == "pending_swipe", f"Status should be pending_swipe, got {data.get('status')}"
        assert data.get("pending_swipe_amount") == 20000, f"Pending swipe should be 20000"
        assert data.get("pay_sources_count") == 1, f"Pay sources count should be 1"
        
        print(f"✓ Type 02 transaction created: {data.get('transaction_id')}")
    
    def test_02_verify_collection_created(self, auth_session):
        """Verify a collection record was created"""
        response = auth_session.get(f"{BASE_URL}/api/collections?customer_id={pytest.test_customer_id}")
        assert response.status_code == 200, f"Get collections failed: {response.text}"
        
        collections = response.json().get("data", [])
        collection = next((c for c in collections if c.get("transaction_id") == pytest.type02_txn_id), None)
        assert collection is not None, "Collection not found for Type 02 transaction"
        
        pytest.type02_collection_id = collection["id"]
        assert collection.get("amount") == 20000, f"Collection amount should be 20000"
        assert collection.get("status") == "pending", f"Collection status should be pending"
        
        print(f"✓ Collection created: {collection.get('pending_payment_id')}")
    
    def test_03_settle_collection_via_card_swipe(self, auth_session):
        """Settle the collection via card_swipe"""
        response = auth_session.post(f"{BASE_URL}/api/collections/{pytest.type02_collection_id}/settle-unified", json={
            "method": "card_swipe",
            "gross_amount": 20000,
            "charge_percentage": 3.0,
            "gateway_id": pytest.test_gateway_id,
            "server_id": pytest.test_server_id,
            "notes": "E2E Test: Card swipe settlement"
        })
        assert response.status_code == 200, f"Settle collection failed: {response.text}"
        data = response.json()
        
        assert data.get("success") == True
        collection = data.get("collection", {})
        assert collection.get("status") == "settled", f"Collection should be settled"
        
        # Verify transaction updated
        txn_resp = auth_session.get(f"{BASE_URL}/api/transactions/{pytest.type02_txn_id}")
        txn = txn_resp.json()
        
        assert txn.get("total_swiped") == 20000, f"Total swiped should be 20000"
        assert txn.get("pending_swipe_amount") == 0, f"Pending swipe should be 0"
        assert txn.get("commission_amount") > 0, f"Commission should be > 0"
        assert txn.get("gateway_charge_amount") > 0, f"Gateway charge should be > 0"
        
        print(f"✓ Collection settled. Commission: ₹{txn.get('commission_amount')}")
    
    def test_04_verify_amount_to_customer(self, auth_session):
        """Verify transaction has amount_to_customer and is in payment_pending"""
        txn_resp = auth_session.get(f"{BASE_URL}/api/transactions/{pytest.type02_txn_id}")
        txn = txn_resp.json()
        
        # After settlement, there should be amount to pay customer (overpayment scenario)
        # or the transaction should be in payment_pending status
        assert txn.get("status") in ["payment_pending", "completed"], f"Status should be payment_pending or completed"
        
        print(f"✓ Transaction status: {txn.get('status')}, Amount to customer: ₹{txn.get('amount_to_customer', 0)}")


class TestWalletOperationsPhase:
    """Phase 9: Wallet Operations"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_wallet_transfer(self, auth_session):
        """Test wallet transfer between two wallets"""
        # Get gateway wallet
        gw_wallet_resp = auth_session.get(f"{BASE_URL}/api/gateways/{pytest.test_gateway_id}/wallet")
        gw_wallet = gw_wallet_resp.json().get("wallet", {})
        gw_wallet_id = gw_wallet.get("id")
        gw_balance_before = gw_wallet.get("balance", 0)
        
        # Get cash wallet balance
        cash_wallet_resp = auth_session.get(f"{BASE_URL}/api/wallets/{pytest.test_cash_wallet_id}")
        cash_balance_before = cash_wallet_resp.json().get("balance", 0)
        
        transfer_amount = 1000
        
        response = auth_session.post(f"{BASE_URL}/api/wallets/transfer", json={
            "from_wallet_id": gw_wallet_id,
            "to_wallet_id": pytest.test_cash_wallet_id,
            "amount": transfer_amount,
            "notes": "E2E Test: Wallet transfer"
        })
        assert response.status_code == 200, f"Transfer failed: {response.text}"
        data = response.json()
        
        # Verify balances
        assert data["from_wallet"]["new_balance"] == gw_balance_before - transfer_amount
        assert data["to_wallet"]["new_balance"] == cash_balance_before + transfer_amount
        
        print(f"✓ Transfer successful. Transaction ID: {data.get('transaction_id')}")
    
    def test_02_verify_wallet_operations_log(self, auth_session):
        """Verify wallet operations log has both debit and credit entries"""
        # Check cash wallet operations
        response = auth_session.get(f"{BASE_URL}/api/wallets/{pytest.test_cash_wallet_id}/operations")
        assert response.status_code == 200, f"Get operations failed: {response.text}"
        
        operations = response.json().get("operations", [])
        assert len(operations) > 0, "No operations found"
        
        # Find transfer credit
        credit_op = next((op for op in operations if op.get("operation_type") == "credit" and "Transfer" in op.get("notes", "")), None)
        assert credit_op is not None, "Transfer credit operation not found"
        
        print(f"✓ Wallet operations log verified")
    
    def test_03_overdraft_should_fail(self, auth_session):
        """Try overdraft (transfer more than balance) - should fail"""
        # Get a wallet with known balance
        cash_wallet_resp = auth_session.get(f"{BASE_URL}/api/wallets/{pytest.test_cash_wallet_id}")
        cash_balance = cash_wallet_resp.json().get("balance", 0)
        
        # Get gateway wallet
        gw_wallet_resp = auth_session.get(f"{BASE_URL}/api/gateways/{pytest.test_gateway_id}/wallet")
        gw_wallet = gw_wallet_resp.json().get("wallet", {})
        gw_wallet_id = gw_wallet.get("id")
        
        # Try to transfer more than available
        response = auth_session.post(f"{BASE_URL}/api/wallets/transfer", json={
            "from_wallet_id": pytest.test_cash_wallet_id,
            "to_wallet_id": gw_wallet_id,
            "amount": cash_balance + 1000000,  # More than available
            "notes": "E2E Test: Overdraft attempt"
        })
        assert response.status_code == 400, f"Expected 400 for overdraft, got {response.status_code}"
        print(f"✓ Overdraft correctly rejected")


class TestDashboardAndReportsPhase:
    """Phase 11: Dashboard & Reports"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_dashboard(self, auth_session):
        """Test GET /dashboard"""
        response = auth_session.get(f"{BASE_URL}/api/dashboard")
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        
        data = response.json()
        required_fields = ["today_transactions", "today_volume", "today_profit", 
                          "total_pending", "total_receivable", "gateway_balances"]
        for field in required_fields:
            assert field in data, f"Dashboard missing field: {field}"
        
        print(f"✓ Dashboard: {data.get('today_transactions')} transactions today, ₹{data.get('today_volume')} volume")
    
    def test_02_commission_stats(self, auth_session):
        """Test GET /dashboard/commission-stats"""
        response = auth_session.get(f"{BASE_URL}/api/dashboard/commission-stats")
        assert response.status_code == 200, f"Commission stats failed: {response.text}"
        
        data = response.json()
        assert "commission_earned" in data, "commission_earned missing"
        assert "commission_collected" in data, "commission_collected missing"
        
        print(f"✓ Commission Stats: Earned ₹{data.get('commission_earned')}, Collected ₹{data.get('commission_collected')}")
    
    def test_03_analytics(self, auth_session):
        """Test GET /dashboard/analytics"""
        response = auth_session.get(f"{BASE_URL}/api/dashboard/analytics?days=7")
        assert response.status_code == 200, f"Analytics failed: {response.text}"
        
        data = response.json()
        assert "daily_data" in data, "daily_data missing"
        assert "type_breakdown" in data, "type_breakdown missing"
        
        print(f"✓ Analytics: {len(data.get('daily_data', []))} days of data")
    
    def test_04_payments_summary(self, auth_session):
        """Test GET /payments/summary"""
        response = auth_session.get(f"{BASE_URL}/api/payments/summary")
        assert response.status_code == 200, f"Payments summary failed: {response.text}"
        
        data = response.json()
        assert "total_pending_amount" in data, "total_pending_amount missing"
        
        print(f"✓ Payments Summary: ₹{data.get('total_pending_amount')} pending")
    
    def test_05_pending_stats(self, auth_session):
        """Test GET /payments/pending-stats"""
        response = auth_session.get(f"{BASE_URL}/api/payments/pending-stats")
        assert response.status_code == 200, f"Pending stats failed: {response.text}"
        
        data = response.json()
        assert "total_payable" in data, "total_payable missing"
        assert "pending_count" in data, "pending_count missing"
        
        print(f"✓ Pending Stats: {data.get('pending_count')} pending, ₹{data.get('total_payable')} payable")
    
    def test_06_collections_stats(self, auth_session):
        """Test GET /collections/stats"""
        response = auth_session.get(f"{BASE_URL}/api/collections/stats")
        assert response.status_code == 200, f"Collections stats failed: {response.text}"
        
        data = response.json()
        assert "total_receivable" in data, "total_receivable missing"
        
        print(f"✓ Collections Stats: ₹{data.get('total_receivable')} receivable")


class TestEdgeCasesPhase:
    """Phase 10: Edge Cases"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_type01_with_minimum_charge(self, auth_session):
        """Create Type 01 with total_charge = gateway charge (commission should be 0)"""
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "swipe_gateway_id": pytest.test_gateway_id,
            "swipe_server_id": pytest.test_server_id,
            "swipe_amount": 5000,
            "total_charge_percentage": 1.5,  # Same as gateway charge
            "notes": "E2E Test: Minimum charge"
        })
        assert response.status_code == 200, f"Create failed: {response.text}"
        data = response.json()
        
        assert data.get("commission_amount") == 0, f"Commission should be 0 when total = gateway charge"
        print(f"✓ Minimum charge transaction: commission = ₹{data.get('commission_amount')}")
    
    def test_02_type01_charge_below_gateway_should_fail(self, auth_session):
        """Create Type 01 with total_charge < gateway charge - should fail"""
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "swipe_gateway_id": pytest.test_gateway_id,
            "swipe_server_id": pytest.test_server_id,
            "swipe_amount": 5000,
            "total_charge_percentage": 1.0,  # Less than 1.5% gateway charge
            "notes": "E2E Test: Below gateway charge"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"✓ Charge below gateway correctly rejected")
    
    def test_03_type02_mismatched_pay_sources_should_fail(self, auth_session):
        """Create Type 02 with pay_sources total != pay_to_card_amount - should fail"""
        response = auth_session.post(f"{BASE_URL}/api/transactions/type02", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "pay_to_card_amount": 10000,
            "pay_sources": [
                {"gateway_id": pytest.test_gateway_id, "amount": 5000}  # Only 5000, not 10000
            ],
            "notes": "E2E Test: Mismatched sources"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"✓ Mismatched pay sources correctly rejected")
    
    def test_04_overpayment_should_be_handled(self, auth_session):
        """Try paying customer more than remaining amount"""
        # Create a new transaction
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "swipe_gateway_id": pytest.test_gateway_id,
            "swipe_server_id": pytest.test_server_id,
            "swipe_amount": 1000,
            "total_charge_percentage": 3.0,
            "notes": "E2E Test: Overpayment test"
        })
        assert response.status_code == 200
        txn = response.json()
        txn_id = txn["id"]
        remaining = txn.get("amount_remaining_to_customer", 0)
        
        # Try to pay more than remaining
        pay_response = auth_session.post(f"{BASE_URL}/api/payments/record", json={
            "transaction_id": txn_id,
            "amount": remaining + 1000,  # More than remaining
            "payment_source_type": "cash_wallet",
            "payment_source_id": pytest.test_cash_wallet_id,
            "payment_method": "Cash",
            "notes": "E2E Test: Overpayment"
        })
        assert pay_response.status_code == 400, f"Expected 400 for overpayment, got {pay_response.status_code}"
        print(f"✓ Overpayment correctly rejected")
    
    def test_05_reverse_with_payments_should_fail(self, auth_session):
        """Try reversing a transaction with payments already made - should fail"""
        # Create and partially pay a transaction
        response = auth_session.post(f"{BASE_URL}/api/transactions/type01", json={
            "customer_id": pytest.test_customer_id,
            "card_id": pytest.test_card_id,
            "swipe_gateway_id": pytest.test_gateway_id,
            "swipe_server_id": pytest.test_server_id,
            "swipe_amount": 2000,
            "total_charge_percentage": 3.0,
            "notes": "E2E Test: Reversal with payment"
        })
        assert response.status_code == 200
        txn = response.json()
        txn_id = txn["id"]
        
        # Make a payment
        pay_response = auth_session.post(f"{BASE_URL}/api/payments/record", json={
            "transaction_id": txn_id,
            "amount": 100,
            "payment_source_type": "cash_wallet",
            "payment_source_id": pytest.test_cash_wallet_id,
            "payment_method": "Cash",
            "notes": "E2E Test: Payment before reversal"
        })
        assert pay_response.status_code == 200
        
        # Try to reverse
        reverse_response = auth_session.post(
            f"{BASE_URL}/api/transactions/{txn_id}/reverse",
            params={"reason": "E2E Test: Reversal with payment attempt"}
        )
        assert reverse_response.status_code == 400, f"Expected 400, got {reverse_response.status_code}"
        print(f"✓ Reversal with payments correctly rejected")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
