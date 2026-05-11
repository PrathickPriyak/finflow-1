"""
Payments Page API Tests - Iteration 58
Tests for new Payments page features:
- Date range filtering on pending payouts
- Date range filtering on payment history
- Payment method filter on history
- Export Excel for pending and history tabs
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Module-level session with auth
_session = None

def get_session():
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_response = _session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "logesh@infozub.com",
            "password": "ValidNewPass@789"
        })
        
        if login_response.status_code == 200:
            data = login_response.json()
            token = data.get("access_token") or data.get("token")
            if token:
                _session.headers.update({"Authorization": f"Bearer {token}"})
                print(f"Login successful, token obtained")
            else:
                print(f"Login response: {data}")
        else:
            print(f"Login failed: {login_response.status_code} - {login_response.text}")
    
    return _session


# ===== Pending Payouts Tests =====

def test_pending_payouts_basic():
    """Test GET /api/payments/pending returns data"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert "data" in data
    assert "pagination" in data
    print(f"Pending payouts count: {len(data['data'])}")


def test_pending_payouts_with_date_from():
    """Test GET /api/payments/pending with date_from filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending?date_from=2026-01-01")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Pending payouts with date_from=2026-01-01: {len(data['data'])}")


def test_pending_payouts_with_date_to():
    """Test GET /api/payments/pending with date_to filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending?date_to=2026-12-31")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Pending payouts with date_to=2026-12-31: {len(data['data'])}")


def test_pending_payouts_with_date_range():
    """Test GET /api/payments/pending with date_from and date_to"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending?date_from=2026-03-01&date_to=2026-03-31")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Pending payouts in March 2026: {len(data['data'])}")


def test_pending_payouts_sorting():
    """Test GET /api/payments/pending with sorting"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending?sort_by=remaining&sort_order=desc")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    
    # Verify sorting
    if len(data['data']) > 1:
        amounts = [item.get('amount_remaining_to_customer', 0) for item in data['data']]
        assert amounts == sorted(amounts, reverse=True), "Should be sorted by remaining descending"
    print(f"Sorted pending payouts: {len(data['data'])}")


def test_pending_payouts_filter_overdue():
    """Test GET /api/payments/pending with overdue filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending?filter=overdue")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Overdue pending payouts: {len(data['data'])}")


def test_pending_payouts_filter_high_value():
    """Test GET /api/payments/pending with high_value filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending?filter=high_value")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"High value pending payouts: {len(data['data'])}")


# ===== Payment History Tests =====

def test_payment_history_basic():
    """Test GET /api/payments/history returns data"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "pagination" in data
    print(f"Payment history count: {len(data['data'])}")


def test_payment_history_with_date_from():
    """Test GET /api/payments/history with date_from filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history?date_from=2026-01-01")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Payment history with date_from=2026-01-01: {len(data['data'])}")


def test_payment_history_with_date_to():
    """Test GET /api/payments/history with date_to filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history?date_to=2026-12-31")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Payment history with date_to=2026-12-31: {len(data['data'])}")


def test_payment_history_with_date_range():
    """Test GET /api/payments/history with date_from and date_to"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history?date_from=2026-03-01&date_to=2026-03-31")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Payment history in March 2026: {len(data['data'])}")


def test_payment_history_with_payment_method_cash():
    """Test GET /api/payments/history with payment_method=cash"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history?payment_method=cash")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Payment history with cash method: {len(data['data'])}")


def test_payment_history_with_payment_method_bank_transfer():
    """Test GET /api/payments/history with payment_method=bank_transfer"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history?payment_method=bank_transfer")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Payment history with bank_transfer method: {len(data['data'])}")


def test_payment_history_sorting():
    """Test GET /api/payments/history with sorting"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history?sort_by=amount&sort_order=desc")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    print(f"Sorted payment history: {len(data['data'])}")


# ===== Export Excel Tests =====

def test_export_excel_pending():
    """Test GET /api/payments/export-excel?tab=pending returns valid xlsx"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/export-excel?tab=pending")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    # Check content type
    content_type = response.headers.get('Content-Type', '')
    assert 'spreadsheetml' in content_type or 'octet-stream' in content_type, f"Expected xlsx content type, got: {content_type}"
    
    # Check content disposition
    content_disp = response.headers.get('Content-Disposition', '')
    assert 'attachment' in content_disp, "Should have attachment disposition"
    assert '.xlsx' in content_disp, "Should have .xlsx extension"
    
    # Check content length
    assert len(response.content) > 0, "Excel file should not be empty"
    print(f"Pending Excel export size: {len(response.content)} bytes")


def test_export_excel_history():
    """Test GET /api/payments/export-excel?tab=history returns valid xlsx"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/export-excel?tab=history")
    assert response.status_code == 200
    
    # Check content type
    content_type = response.headers.get('Content-Type', '')
    assert 'spreadsheetml' in content_type or 'octet-stream' in content_type, f"Expected xlsx content type, got: {content_type}"
    
    # Check content disposition
    content_disp = response.headers.get('Content-Disposition', '')
    assert 'attachment' in content_disp, "Should have attachment disposition"
    assert '.xlsx' in content_disp, "Should have .xlsx extension"
    
    # Check content length
    assert len(response.content) > 0, "Excel file should not be empty"
    print(f"History Excel export size: {len(response.content)} bytes")


def test_export_excel_pending_with_date_filter():
    """Test export pending with date filters"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/export-excel?tab=pending&date_from=2026-03-01&date_to=2026-03-31")
    assert response.status_code == 200
    assert len(response.content) > 0
    print(f"Filtered pending Excel export size: {len(response.content)} bytes")


def test_export_excel_history_with_method_filter():
    """Test export history with payment method filter"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/export-excel?tab=history&payment_method=cash")
    assert response.status_code == 200
    assert len(response.content) > 0
    print(f"Filtered history Excel export size: {len(response.content)} bytes")


# ===== Stats Tests =====

def test_pending_stats():
    """Test GET /api/payments/pending-stats returns correct data"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/pending-stats")
    assert response.status_code == 200
    data = response.json()
    
    # Check required fields
    assert "total_payable" in data
    assert "pending_count" in data
    assert "paid_today" in data
    assert "overdue_count" in data
    assert "overdue_amount" in data
    assert "high_value_count" in data
    assert "high_value_amount" in data
    
    print(f"Pending stats: total_payable={data['total_payable']}, pending_count={data['pending_count']}")


def test_history_stats():
    """Test GET /api/payments/history-stats returns correct data"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/history-stats")
    assert response.status_code == 200
    data = response.json()
    
    # Check required fields
    assert "total_paid" in data
    assert "payment_count" in data
    
    print(f"History stats: total_paid={data['total_paid']}, payment_count={data['payment_count']}")


def test_summary():
    """Test GET /api/payments/summary returns correct data"""
    session = get_session()
    response = session.get(f"{BASE_URL}/api/payments/summary")
    assert response.status_code == 200
    data = response.json()
    
    print(f"Summary: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
