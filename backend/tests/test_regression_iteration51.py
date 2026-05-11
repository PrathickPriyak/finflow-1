"""
Fin Flow Regression Tests - Iteration 51
Post-refactor validation: Backend API health, authentication, CRUD operations
Tests for critical endpoints after massive cleanup and bug fixes
"""
import pytest
import requests
import os
import time

# Get BASE_URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable not set")

# Test credentials
TEST_EMAIL = "logesh@infozub.com"
TEST_PASSWORD = "ValidNewPass@789"


class TestHealthEndpoint:
    """Basic health check - run first to verify API is reachable"""

    def test_health_endpoint_returns_200(self):
        """Health endpoint should return 200 OK"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.text}"

    def test_health_endpoint_fields(self):
        """Health endpoint should return required fields"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"
        assert "version" in data
        assert "dev_mode" in data


class TestAuthenticationFlow:
    """Two-step auth: password login -> OTP verification (dev mode returns OTP)"""

    def test_login_with_invalid_credentials(self):
        """Login with invalid credentials should fail"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "invalid@example.com", "password": "wrongpassword"},
            timeout=10
        )
        assert response.status_code == 401

    def test_login_step1_password(self):
        """Step 1: Password login should succeed and return token directly in dev mode"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        # In dev mode with skip OTP, token should be returned directly
        assert "token" in data or "requires_otp" in data
        # Store for later tests
        if "token" in data:
            TestAuthenticationFlow.auth_token = data["token"]
        else:
            # Requires OTP step
            assert "requires_otp" in data
            TestAuthenticationFlow.requires_otp = True
            TestAuthenticationFlow.otp = data.get("dev_otp")

    def test_auth_me_endpoint(self):
        """Get current user info with token"""
        token = getattr(TestAuthenticationFlow, 'auth_token', None)
        if not token:
            pytest.skip("No auth token available")
        
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert "permissions" in data


class TestDashboardEndpoints:
    """Dashboard and analytics endpoints"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token for dashboard tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            self.token = data.get("token")
        else:
            self.token = None

    def test_dashboard_main(self):
        """Main dashboard endpoint should return stats"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/dashboard",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=15
        )
        assert response.status_code == 200
        data = response.json()
        # Check expected fields exist
        assert "today_profit" in data or "total_pending" in data or "total_wallet_balance" in data

    def test_dashboard_health_score(self):
        """Health score endpoint should return scores"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/dashboard/health-score",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_score" in data
        assert "components" in data
        assert "grade" in data

    def test_dashboard_daily_profit(self):
        """Daily profit endpoint should work"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/dashboard/daily-profit",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_dashboard_commission_stats(self):
        """Commission stats endpoint should return commission tracking data"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/dashboard/commission-stats",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestCustomersEndpoints:
    """Customer CRUD operations - phone-only search after refactor"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_customers_list(self):
        """Get customers list should return paginated data"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/customers",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert "pagination" in data

    def test_search_customers_by_phone(self):
        """Search customers by phone number (phone-only search after refactor)"""
        if not self.token:
            pytest.skip("Auth failed")
        
        # Search with a partial phone number
        response = requests.get(
            f"{BASE_URL}/api/customers?search=9",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        # Should not crash - phone-only search working

    def test_get_recent_customers(self):
        """Get recent customers endpoint"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/customers/recent",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestTransactionsEndpoints:
    """Transaction operations - was crashing before fix"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_transactions_list(self):
        """Get transactions list should return paginated data"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/transactions",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert "pagination" in data

    def test_transactions_with_filters(self):
        """Transactions endpoint with filters"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/transactions?page=1&limit=10&sort_by=date&sort_order=desc",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_transactions_search_by_phone(self):
        """Search transactions by phone number"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/transactions?search=9",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestPaymentsEndpoints:
    """Payments operations"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_payments_pending(self):
        """Get pending payments"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/payments/pending",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_payments_search_by_phone(self):
        """Search payments by phone"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/payments/pending?search=9",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_payments_summary(self):
        """Get payments summary stats"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/payments/summary",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestCollectionsEndpoints:
    """Collections operations"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_collections_pending(self):
        """Get pending collections"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/collections",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_collections_history(self):
        """Get collections history"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/collections/history",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_collections_stats(self):
        """Get collections stats"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/collections/stats",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestWalletsEndpoints:
    """Wallets operations"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_wallets_list(self):
        """Get wallets list"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/wallets",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        # Should be a list
        assert isinstance(data, list)
        # No MongoDB _id should be present
        for wallet in data:
            assert "_id" not in wallet

    def test_wallet_operations_list(self):
        """Get wallet operations"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/wallet-operations",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestReconciliationEndpoints:
    """Reconciliation endpoints - bug fixes verified"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_reconciliation_status(self):
        """Get reconciliation status"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/reconciliation/status",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_reconciliation_check(self):
        """Run reconciliation check"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/reconciliation/check",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=15
        )
        assert response.status_code == 200


class TestExpensesEndpoints:
    """Expenses operations"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_expenses_list(self):
        """Get expenses list"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/expenses",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_get_expense_types(self):
        """Get expense types"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/expense-types",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestSettingsEndpoints:
    """Settings endpoints"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_settings(self):
        """Get app settings"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/settings",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


class TestGatewaysAndBanks:
    """Gateways and banks endpoints"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_get_gateways(self):
        """Get gateways list"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/gateways",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_get_banks(self):
        """Get banks list"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/banks",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200

    def test_get_card_networks(self):
        """Get card networks"""
        if not self.token:
            pytest.skip("Auth failed")
        
        response = requests.get(
            f"{BASE_URL}/api/card-networks",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
