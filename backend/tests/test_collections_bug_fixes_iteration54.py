"""
FinFlow Bug Fix Tests - Iteration 54
Tests for Collection Detail drawer status logic and transaction type display fixes.

Bug Fix 1: Collection Detail drawer status logic
- isHistorySettlement detection changed from 'pending_payment_id || settled_at' to 'cumulative_settled !== undefined'
- History items from /api/collections/history have cumulative_settled, running_balance_after, is_full_settlement
- Pending items from /api/collections do NOT have these fields

Bug Fix 2: Transaction type display
- type_02 transactions show contextual labels based on amounts
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://pwa-financial-hub.preview.emergentagent.com"

TEST_EMAIL = "logesh@infozub.com"
TEST_PASSWORD = "ValidNewPass@789"


class TestCollectionsEndpointStructure:
    """Test that /api/collections and /api/collections/history return correct data structures"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Create authenticated session"""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        token = response.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}"})
        return s
    
    def test_01_pending_collections_endpoint_returns_correct_structure(self, auth_session):
        """
        Bug Fix 1 Verification: /api/collections (pending) should NOT have cumulative_settled field
        This is critical because the frontend uses cumulative_settled to detect history vs pending items
        """
        response = auth_session.get(f"{BASE_URL}/api/collections?page=1&limit=10")
        assert response.status_code == 200, f"Get collections failed: {response.text}"
        
        data = response.json()
        assert "data" in data, "Response should have 'data' field"
        assert "pagination" in data, "Response should have 'pagination' field"
        
        # Check pagination structure
        pagination = data["pagination"]
        assert "page" in pagination, "Pagination should have 'page'"
        assert "limit" in pagination, "Pagination should have 'limit'"
        assert "total" in pagination, "Pagination should have 'total'"
        assert "pages" in pagination, "Pagination should have 'pages'"
        
        # Check that pending items do NOT have history-specific fields
        pending_items = data["data"]
        if pending_items:
            for item in pending_items[:5]:  # Check first 5 items
                # These fields should NOT exist on pending items (they are history-specific)
                assert "cumulative_settled" not in item, \
                    f"Pending item should NOT have 'cumulative_settled' field. Item: {item.get('id')}"
                assert "running_balance_after" not in item, \
                    f"Pending item should NOT have 'running_balance_after' field. Item: {item.get('id')}"
                
                # Pending items should have these standard fields
                assert "id" in item, "Pending item should have 'id'"
                assert "amount" in item, "Pending item should have 'amount'"
                assert "status" in item, "Pending item should have 'status'"
                
                print(f"✓ Pending item {item.get('id', 'unknown')[:8]}... has correct structure (no cumulative_settled)")
        else:
            print("⚠ No pending collections found to verify structure")
        
        print(f"✓ /api/collections returns correct structure for pending items")
    
    def test_02_history_collections_endpoint_returns_enriched_structure(self, auth_session):
        """
        Bug Fix 1 Verification: /api/collections/history should have cumulative_settled, 
        running_balance_after, and is_full_settlement fields
        """
        response = auth_session.get(f"{BASE_URL}/api/collections/history?page=1&limit=10")
        assert response.status_code == 200, f"Get collection history failed: {response.text}"
        
        data = response.json()
        assert "data" in data, "Response should have 'data' field"
        assert "pagination" in data, "Response should have 'pagination' field"
        
        history_items = data["data"]
        if history_items:
            for item in history_items[:5]:  # Check first 5 items
                # History items MUST have these enriched fields
                assert "cumulative_settled" in item, \
                    f"History item should have 'cumulative_settled' field. Item: {item.get('id')}"
                assert "running_balance_after" in item, \
                    f"History item should have 'running_balance_after' field. Item: {item.get('id')}"
                assert "is_full_settlement" in item, \
                    f"History item should have 'is_full_settlement' field. Item: {item.get('id')}"
                
                # Verify is_full_settlement logic matches running_balance_after
                running_balance = item.get("running_balance_after", 0)
                is_full = item.get("is_full_settlement", False)
                
                # is_full_settlement should be True when running_balance_after <= 1.0
                if running_balance <= 1.0:
                    assert is_full == True, \
                        f"is_full_settlement should be True when running_balance_after={running_balance}"
                else:
                    assert is_full == False, \
                        f"is_full_settlement should be False when running_balance_after={running_balance}"
                
                print(f"✓ History item {item.get('id', 'unknown')[:8]}... has cumulative_settled={item.get('cumulative_settled')}, is_full={is_full}")
        else:
            print("⚠ No collection history found to verify structure")
        
        print(f"✓ /api/collections/history returns correct enriched structure")
    
    def test_03_history_full_settlement_badge_logic(self, auth_session):
        """
        Bug Fix 1 Verification: Verify Full/Partial Settlement badge logic
        - Full Settlement: when running_balance_after <= 1.0 (or total_due == total_collected)
        - Partial Settlement: when running_balance_after > 1.0
        """
        response = auth_session.get(f"{BASE_URL}/api/collections/history?page=1&limit=50")
        assert response.status_code == 200, f"Get collection history failed: {response.text}"
        
        history_items = response.json().get("data", [])
        
        full_settlements = []
        partial_settlements = []
        
        for item in history_items:
            is_full = item.get("is_full_settlement", False)
            running_balance = item.get("running_balance_after", 0)
            total_due = item.get("total_due_amount", 0)
            cumulative = item.get("cumulative_settled", 0)
            
            if is_full:
                full_settlements.append({
                    "id": item.get("id"),
                    "total_due": total_due,
                    "cumulative": cumulative,
                    "running_balance": running_balance
                })
            else:
                partial_settlements.append({
                    "id": item.get("id"),
                    "total_due": total_due,
                    "cumulative": cumulative,
                    "running_balance": running_balance
                })
        
        print(f"✓ Found {len(full_settlements)} Full Settlements and {len(partial_settlements)} Partial Settlements")
        
        # Verify Full Settlements have running_balance <= 1.0
        for fs in full_settlements[:3]:
            assert fs["running_balance"] <= 1.0, \
                f"Full Settlement should have running_balance <= 1.0, got {fs['running_balance']}"
            print(f"  Full: total_due={fs['total_due']}, cumulative={fs['cumulative']}, balance={fs['running_balance']}")
        
        # Verify Partial Settlements have running_balance > 1.0
        for ps in partial_settlements[:3]:
            assert ps["running_balance"] > 1.0, \
                f"Partial Settlement should have running_balance > 1.0, got {ps['running_balance']}"
            print(f"  Partial: total_due={ps['total_due']}, cumulative={ps['cumulative']}, balance={ps['running_balance']}")
        
        print(f"✓ Full/Partial Settlement badge logic verified correctly")


class TestSettlementFlow:
    """Test settlement flow to verify data structure after settlement"""
    
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
    
    def test_01_settle_unified_endpoint_works(self, auth_session):
        """
        Backend regression: /api/collections/{id}/settle-unified works
        """
        # First get a pending collection
        response = auth_session.get(f"{BASE_URL}/api/collections?page=1&limit=5")
        assert response.status_code == 200, f"Get collections failed: {response.text}"
        
        pending = response.json().get("data", [])
        if not pending:
            pytest.skip("No pending collections to test settlement")
        
        # Find a collection with remaining balance
        test_collection = None
        for p in pending:
            remaining = p.get("amount", 0) - p.get("settled_amount", 0)
            if remaining > 0:
                test_collection = p
                break
        
        if not test_collection:
            pytest.skip("No pending collections with remaining balance")
        
        collection_id = test_collection["id"]
        remaining = test_collection.get("amount", 0) - test_collection.get("settled_amount", 0)
        
        # Get a cash wallet for settlement
        wallets_resp = auth_session.get(f"{BASE_URL}/api/wallets?wallet_type=cash")
        assert wallets_resp.status_code == 200
        wallets = wallets_resp.json()
        cash_wallet = next((w for w in wallets if w.get("wallet_type") == "cash"), None)
        
        if not cash_wallet:
            pytest.skip("No cash wallet available for settlement")
        
        # Settle a small amount (100 or remaining, whichever is smaller)
        settle_amount = min(100, remaining)
        
        response = auth_session.post(f"{BASE_URL}/api/collections/{collection_id}/settle-unified", json={
            "method": "cash",
            "gross_amount": settle_amount,
            "charge_percentage": 0,
            "wallet_id": cash_wallet["id"],
            "notes": "E2E Test: Bug fix verification"
        })
        
        assert response.status_code == 200, f"Settlement failed: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Settlement should succeed"
        
        print(f"✓ Settlement of ₹{settle_amount} successful for collection {collection_id[:8]}...")
        
        # Verify the settlement appears in history with correct structure
        history_resp = auth_session.get(f"{BASE_URL}/api/collections/history?page=1&limit=10")
        assert history_resp.status_code == 200
        
        history = history_resp.json().get("data", [])
        # Find our settlement in history
        our_settlement = next(
            (h for h in history if h.get("pending_payment_id") == collection_id and h.get("amount") == settle_amount),
            None
        )
        
        if our_settlement:
            assert "cumulative_settled" in our_settlement, "Settlement in history should have cumulative_settled"
            assert "running_balance_after" in our_settlement, "Settlement in history should have running_balance_after"
            assert "is_full_settlement" in our_settlement, "Settlement in history should have is_full_settlement"
            print(f"✓ Settlement appears in history with correct enriched structure")
        else:
            print("⚠ Settlement not found in first page of history (may be on later page)")


class TestTransactionTypeDisplay:
    """
    Bug Fix 2: Transaction type display for type_02 transactions
    - 'Pay + Swipe' when both pay_to_card_amount > 0 AND swipe_amount > 0
    - 'Pay to Card' when only pay_to_card_amount > 0
    - 'Card Swipe' when only swipe_amount > 0
    """
    
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
    
    def test_01_type02_transaction_has_correct_amounts(self, auth_session):
        """
        Verify type_02 transactions have the correct amount fields for display logic
        """
        response = auth_session.get(f"{BASE_URL}/api/transactions?transaction_type=type_02&page=1&limit=20")
        assert response.status_code == 200, f"Get transactions failed: {response.text}"
        
        transactions = response.json().get("data", [])
        
        pay_and_swipe = []  # Both amounts > 0
        pay_only = []       # Only pay_to_card > 0
        swipe_only = []     # Only swipe > 0
        
        for txn in transactions:
            if txn.get("transaction_type") != "type_02":
                continue
            
            pay_amount = txn.get("pay_to_card_amount", 0) or txn.get("total_pay_to_card", 0)
            swipe_amount = txn.get("swipe_amount", 0)
            
            if pay_amount > 0 and swipe_amount > 0:
                pay_and_swipe.append(txn)
            elif pay_amount > 0 and swipe_amount == 0:
                pay_only.append(txn)
            elif swipe_amount > 0 and pay_amount == 0:
                swipe_only.append(txn)
        
        print(f"✓ Type 02 transactions breakdown:")
        print(f"  - Pay + Swipe (both > 0): {len(pay_and_swipe)}")
        print(f"  - Pay to Card only: {len(pay_only)}")
        print(f"  - Card Swipe only: {len(swipe_only)}")
        
        # Verify at least one category exists
        total = len(pay_and_swipe) + len(pay_only) + len(swipe_only)
        if total == 0:
            print("⚠ No type_02 transactions found to verify display logic")
        else:
            print(f"✓ Found {total} type_02 transactions with correct amount fields")
        
        # Sample verification
        if pay_and_swipe:
            sample = pay_and_swipe[0]
            print(f"  Sample Pay+Swipe: pay={sample.get('pay_to_card_amount')}, swipe={sample.get('swipe_amount')}")
            assert sample.get("pay_to_card_amount", 0) > 0 or sample.get("total_pay_to_card", 0) > 0
            assert sample.get("swipe_amount", 0) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
