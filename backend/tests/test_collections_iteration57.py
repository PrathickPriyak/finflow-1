"""
Test Collections Page Changes - Iteration 57
Tests for:
1. GET /api/collections excludes cancelled items by default
2. GET /api/collections?sort_by=remaining&sort_order=asc works correctly
3. GET /api/collections/export-excel?tab=pending returns valid xlsx
4. GET /api/collections/export-excel?tab=history returns valid xlsx
5. GET /api/collections/stats returns correct totals
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCollectionsAPI:
    """Test Collections API endpoints for iteration 57 changes"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get auth token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "logesh@infozub.com",
            "password": "ValidNewPass@789"
        })
        
        if login_response.status_code == 200:
            data = login_response.json()
            token = data.get("access_token") or data.get("token")
            if token:
                self.session.headers.update({"Authorization": f"Bearer {token}"})
                self.authenticated = True
            else:
                self.authenticated = False
        else:
            self.authenticated = False
            pytest.skip(f"Authentication failed: {login_response.status_code}")
    
    def test_collections_excludes_cancelled_by_default(self):
        """Test that GET /api/collections excludes cancelled items by default"""
        response = self.session.get(f"{BASE_URL}/api/collections")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "data" in data, "Response should have 'data' field"
        
        # Check that no cancelled items are in the response
        collections = data.get("data", [])
        for collection in collections:
            status = collection.get("status", "")
            assert status != "cancelled", f"Found cancelled collection in default response: {collection.get('id')}"
            assert status != "settled", f"Found settled collection in default response: {collection.get('id')}"
            assert status != "overpaid", f"Found overpaid collection in default response: {collection.get('id')}"
        
        print(f"✓ Collections API excludes cancelled/settled/overpaid by default. Found {len(collections)} pending/partial collections.")
    
    def test_collections_sort_by_remaining_asc(self):
        """Test that GET /api/collections?sort_by=remaining&sort_order=asc works correctly"""
        response = self.session.get(f"{BASE_URL}/api/collections?sort_by=remaining&sort_order=asc")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "data" in data, "Response should have 'data' field"
        
        collections = data.get("data", [])
        if len(collections) >= 2:
            # Verify ascending order by remaining amount
            remaining_amounts = []
            for c in collections:
                remaining = c.get("amount", 0) - c.get("settled_amount", 0)
                remaining_amounts.append(remaining)
            
            # Check if sorted in ascending order
            for i in range(len(remaining_amounts) - 1):
                assert remaining_amounts[i] <= remaining_amounts[i+1], \
                    f"Not sorted ascending: {remaining_amounts[i]} > {remaining_amounts[i+1]}"
        
        print(f"✓ Collections sort by remaining (asc) works. Found {len(collections)} collections.")
    
    def test_collections_sort_by_remaining_desc(self):
        """Test that GET /api/collections?sort_by=remaining&sort_order=desc works correctly"""
        response = self.session.get(f"{BASE_URL}/api/collections?sort_by=remaining&sort_order=desc")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "data" in data, "Response should have 'data' field"
        
        collections = data.get("data", [])
        if len(collections) >= 2:
            # Verify descending order by remaining amount
            remaining_amounts = []
            for c in collections:
                remaining = c.get("amount", 0) - c.get("settled_amount", 0)
                remaining_amounts.append(remaining)
            
            # Check if sorted in descending order
            for i in range(len(remaining_amounts) - 1):
                assert remaining_amounts[i] >= remaining_amounts[i+1], \
                    f"Not sorted descending: {remaining_amounts[i]} < {remaining_amounts[i+1]}"
        
        print(f"✓ Collections sort by remaining (desc) works. Found {len(collections)} collections.")
    
    def test_collections_stats_accuracy(self):
        """Test that GET /api/collections/stats returns accurate totals"""
        # Get stats
        stats_response = self.session.get(f"{BASE_URL}/api/collections/stats")
        assert stats_response.status_code == 200, f"Expected 200, got {stats_response.status_code}: {stats_response.text}"
        
        stats = stats_response.json()
        assert "total_receivable" in stats, "Stats should have 'total_receivable'"
        assert "pending_count" in stats, "Stats should have 'pending_count'"
        
        # Get all pending collections to verify
        collections_response = self.session.get(f"{BASE_URL}/api/collections?limit=100")
        assert collections_response.status_code == 200
        
        collections_data = collections_response.json()
        collections = collections_data.get("data", [])
        
        # Calculate expected total from collections
        calculated_total = sum(
            c.get("amount", 0) - c.get("settled_amount", 0) 
            for c in collections
        )
        
        # Verify stats match (allow small rounding difference)
        stats_total = stats.get("total_receivable", 0)
        diff = abs(stats_total - calculated_total)
        assert diff < 1, f"Stats total ({stats_total}) doesn't match calculated ({calculated_total}), diff={diff}"
        
        print(f"✓ Collections stats accurate. Total receivable: ₹{stats_total}, Pending count: {stats.get('pending_count')}")
    
    def test_export_excel_pending(self):
        """Test that GET /api/collections/export-excel?tab=pending returns valid xlsx"""
        response = self.session.get(f"{BASE_URL}/api/collections/export-excel?tab=pending")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Check content type
        content_type = response.headers.get("Content-Type", "")
        assert "spreadsheetml" in content_type or "application/vnd" in content_type, \
            f"Expected Excel content type, got: {content_type}"
        
        # Check content disposition
        content_disp = response.headers.get("Content-Disposition", "")
        assert "attachment" in content_disp, f"Expected attachment disposition, got: {content_disp}"
        assert ".xlsx" in content_disp, f"Expected .xlsx filename, got: {content_disp}"
        
        # Check file size (should be > 0)
        content_length = len(response.content)
        assert content_length > 0, "Excel file should not be empty"
        
        # Check Excel magic bytes (PK for ZIP/XLSX)
        assert response.content[:2] == b'PK', "File should start with PK (ZIP/XLSX magic bytes)"
        
        print(f"✓ Export pending Excel works. File size: {content_length} bytes")
    
    def test_export_excel_history(self):
        """Test that GET /api/collections/export-excel?tab=history returns valid xlsx"""
        response = self.session.get(f"{BASE_URL}/api/collections/export-excel?tab=history")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Check content type
        content_type = response.headers.get("Content-Type", "")
        assert "spreadsheetml" in content_type or "application/vnd" in content_type, \
            f"Expected Excel content type, got: {content_type}"
        
        # Check content disposition
        content_disp = response.headers.get("Content-Disposition", "")
        assert "attachment" in content_disp, f"Expected attachment disposition, got: {content_disp}"
        assert ".xlsx" in content_disp, f"Expected .xlsx filename, got: {content_disp}"
        
        # Check file size (should be > 0)
        content_length = len(response.content)
        assert content_length > 0, "Excel file should not be empty"
        
        # Check Excel magic bytes (PK for ZIP/XLSX)
        assert response.content[:2] == b'PK', "File should start with PK (ZIP/XLSX magic bytes)"
        
        print(f"✓ Export history Excel works. File size: {content_length} bytes")
    
    def test_collections_date_range_filter(self):
        """Test that date range filters work correctly"""
        # Test with date_from and date_to
        from datetime import datetime, timedelta
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        response = self.session.get(f"{BASE_URL}/api/collections?date_from={week_ago}&date_to={today}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "data" in data, "Response should have 'data' field"
        
        print(f"✓ Date range filter works. Found {len(data.get('data', []))} collections in date range.")
    
    def test_collections_source_filter(self):
        """Test that source filter works correctly"""
        response = self.session.get(f"{BASE_URL}/api/collections?source=type_02_transaction")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        collections = data.get("data", [])
        
        # Verify all returned collections have the correct source
        for c in collections:
            assert c.get("source") == "type_02_transaction", \
                f"Found collection with wrong source: {c.get('source')}"
        
        print(f"✓ Source filter works. Found {len(collections)} type_02_transaction collections.")
    
    def test_collections_status_filter(self):
        """Test that status filter works correctly"""
        # Test with status=partial
        response = self.session.get(f"{BASE_URL}/api/collections?status=partial")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        collections = data.get("data", [])
        
        # Verify all returned collections have the correct status
        for c in collections:
            assert c.get("status") == "partial", \
                f"Found collection with wrong status: {c.get('status')}"
        
        print(f"✓ Status filter works. Found {len(collections)} partial collections.")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
