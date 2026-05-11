"""
Fin Flow Security Hardening Tests - Iteration 52
Testing security fixes: httpOnly cookies, security headers, regex injection protection,
account lockout, rate limiting, password validation
"""
import pytest
import requests
import os
import time
import re

# Get BASE_URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable not set")

# Test credentials
TEST_EMAIL = "logesh@infozub.com"
TEST_PASSWORD = "ValidNewPass@789"


class TestSecurityHeaders:
    """SEC: Verify security headers are present in all API responses"""

    def test_security_headers_on_health(self):
        """Health endpoint should have all required security headers"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        
        # Check required security headers
        headers = response.headers
        assert headers.get("X-Frame-Options") == "DENY", "Missing X-Frame-Options: DENY"
        assert headers.get("X-Content-Type-Options") == "nosniff", "Missing X-Content-Type-Options: nosniff"
        assert headers.get("X-XSS-Protection") == "1; mode=block", "Missing X-XSS-Protection"
        assert "strict-origin" in headers.get("Referrer-Policy", "").lower(), "Missing Referrer-Policy"
        assert "camera=()" in headers.get("Permissions-Policy", ""), "Missing Permissions-Policy"
        print("All security headers present on /api/health")

    def test_security_headers_on_auth(self):
        """Auth endpoint should have security headers even on 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "fake@test.com", "password": "wrong"},
            timeout=10
        )
        headers = response.headers
        # Should have security headers even on error responses
        assert headers.get("X-Frame-Options") == "DENY"
        assert headers.get("X-Content-Type-Options") == "nosniff"
        print("Security headers present on auth error response")


class TestHttpOnlyCookieAuth:
    """SEC-03: Verify httpOnly cookie authentication works"""

    def test_login_sets_httponly_cookie(self):
        """Login should set httpOnly cookie finflow_session"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        # Check Set-Cookie header for httpOnly cookie
        cookies = response.cookies
        set_cookie_header = response.headers.get("Set-Cookie", "")
        
        # The cookie should be set
        assert "finflow_session" in set_cookie_header or cookies.get("finflow_session"), "No finflow_session cookie set"
        
        # Verify httpOnly flag
        assert "httponly" in set_cookie_header.lower(), "Cookie is not httpOnly"
        print(f"Cookie header: {set_cookie_header[:100]}...")
        print("httpOnly cookie set correctly on login")
    
    def test_auth_with_cookie_works(self):
        """Auth via httpOnly cookie should work"""
        session = requests.Session()
        
        # Login to get cookie
        login_resp = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert login_resp.status_code == 200
        
        # Access /api/auth/me using cookie (session preserves cookies)
        me_resp = session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert me_resp.status_code == 200, f"Cookie auth failed: {me_resp.text}"
        data = me_resp.json()
        assert "user" in data
        print("Cookie-based authentication working")

    def test_auth_with_bearer_token_still_works(self):
        """Bearer token auth should still work for backward compatibility"""
        # Login to get token
        login_resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert login_resp.status_code == 200
        token = login_resp.json().get("token")
        assert token, "No token in login response"
        
        # Access /api/auth/me using Bearer token
        me_resp = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        assert me_resp.status_code == 200, f"Bearer auth failed: {me_resp.text}"
        print("Bearer token authentication still working (backward compatible)")

    def test_logout_clears_cookie(self):
        """Logout should clear the httpOnly cookie"""
        session = requests.Session()
        
        # Login
        login_resp = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert login_resp.status_code == 200
        
        # Logout
        logout_resp = session.post(f"{BASE_URL}/api/auth/logout", timeout=10)
        assert logout_resp.status_code == 200
        
        # Check if cookie is cleared (should have Max-Age=0 or Expires in past)
        set_cookie_header = logout_resp.headers.get("Set-Cookie", "")
        # After logout, accessing /me should fail
        me_resp = session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert me_resp.status_code == 401, "Session still valid after logout"
        print("Logout clears session correctly")


class TestRegexInjectionProtection:
    """SEC: Verify regex injection protection in expenses search"""

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

    def test_expenses_search_with_regex_chars_no_crash(self):
        """Search expenses with regex special chars should NOT crash"""
        if not self.token:
            pytest.skip("Auth failed")
        
        # These are regex special characters that would crash unescaped regex
        dangerous_searches = [
            "test(.*)",
            "expense+amount",
            ".*",
            "[a-z]",
            "test\\d+",
            "^start",
            "end$",
            "foo|bar",
            "test?",
            "test{1,3}",
        ]
        
        for search_term in dangerous_searches:
            response = requests.get(
                f"{BASE_URL}/api/expenses",
                params={"search": search_term},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            assert response.status_code == 200, f"Crash with search term '{search_term}': {response.text}"
            print(f"Search '{search_term}' - OK (no crash)")
        
        print("All regex special characters handled safely")


class TestAuthenticationRequired:
    """SEC: Verify all protected endpoints require authentication"""

    def test_dashboard_requires_auth(self):
        """Dashboard endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard", timeout=10)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"

    def test_customers_requires_auth(self):
        """Customers endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/customers", timeout=10)
        assert response.status_code == 401

    def test_transactions_requires_auth(self):
        """Transactions endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/transactions", timeout=10)
        assert response.status_code == 401

    def test_wallets_requires_auth(self):
        """Wallets endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/wallets", timeout=10)
        assert response.status_code == 401

    def test_settings_requires_auth(self):
        """Settings endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/settings", timeout=10)
        assert response.status_code == 401

    def test_expenses_requires_auth(self):
        """Expenses endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/expenses", timeout=10)
        assert response.status_code == 401

    def test_auth_me_requires_auth(self):
        """Auth/me endpoint should require auth"""
        response = requests.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert response.status_code == 401
        print("All protected endpoints return 401 without authentication")


class TestPasswordValidation:
    """SEC: Verify password validation on UserCreate"""

    @pytest.fixture(autouse=True)
    def setup_auth(self):
        """Get auth token for admin operations"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            self.token = response.json().get("token")
        else:
            self.token = None

    def test_weak_password_rejected_short(self):
        """Password less than 12 chars should be rejected"""
        if not self.token:
            pytest.skip("Auth failed")
        
        # First get a valid role_id
        roles_resp = requests.get(
            f"{BASE_URL}/api/roles",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        if roles_resp.status_code != 200:
            pytest.skip("Cannot get roles")
        
        roles = roles_resp.json()
        if not roles:
            pytest.skip("No roles available")
        role_id = roles[0].get("id")
        
        # Try to create user with weak password
        response = requests.post(
            f"{BASE_URL}/api/users",
            json={
                "email": "testweakpass@test.com",
                "password": "Short1!",  # Too short
                "name": "Test Weak",
                "role_id": role_id
            },
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 422, f"Expected 422 for short password, got {response.status_code}: {response.text}"
        print("Short password correctly rejected")

    def test_weak_password_rejected_no_uppercase(self):
        """Password without uppercase should be rejected"""
        if not self.token:
            pytest.skip("Auth failed")
        
        roles_resp = requests.get(
            f"{BASE_URL}/api/roles",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        if roles_resp.status_code != 200:
            pytest.skip("Cannot get roles")
        
        roles = roles_resp.json()
        if not roles:
            pytest.skip("No roles available")
        role_id = roles[0].get("id")
        
        response = requests.post(
            f"{BASE_URL}/api/users",
            json={
                "email": "testnoupper@test.com",
                "password": "alllowercase123!",  # No uppercase
                "name": "Test No Upper",
                "role_id": role_id
            },
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10
        )
        assert response.status_code == 422, f"Expected 422 for no uppercase, got {response.status_code}"
        print("Password without uppercase correctly rejected")


class TestAccountLockout:
    """SEC-09: Verify account lockout after repeated failures"""

    def test_rate_limiting_on_failed_logins(self):
        """Multiple failed logins should trigger rate limiting"""
        # Note: This test may affect rate limits for the test email
        # We use a different email to avoid affecting other tests
        test_email = "lockout_test@example.com"
        
        failed_count = 0
        for i in range(6):  # Try 6 times (threshold is 5)
            response = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"email": test_email, "password": "wrongpassword"},
                timeout=10
            )
            if response.status_code == 429:
                print(f"Rate limited after {i+1} attempts: {response.json()}")
                break
            failed_count += 1
            time.sleep(0.1)  # Small delay between requests
        
        # Should be rate limited before reaching 6 attempts
        assert failed_count <= 5, f"Rate limiting not triggered after {failed_count} attempts"
        print(f"Rate limiting triggered correctly after {failed_count} failed attempts")


class TestLoginFlowComplete:
    """Full login flow test with dev mode"""

    def test_full_login_flow_dev_mode(self):
        """Complete login flow in dev mode (skips OTP)"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # In dev mode, should get token directly
        assert "token" in data, "No token in response"
        assert "user" in data, "No user in response"
        
        # Verify user data
        user = data["user"]
        assert user.get("email") == TEST_EMAIL.lower()
        assert "id" in user
        assert "name" in user
        
        print(f"Login successful for {user['email']}, role: {user.get('role_name')}")

    def test_requires_otp_flag(self):
        """Check requires_otp flag in dev mode"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        
        # In dev mode with skip OTP, requires_otp should be False
        if "requires_otp" in data:
            assert data["requires_otp"] == False, "Dev mode should skip OTP"
        print("requires_otp flag correct for dev mode")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
