#!/bin/bash
# ============================================
# Pre-Deployment Check Script for FinFlow
# ============================================
# Run this before every deployment to verify:
# - Backend is running
# - All API routes are accessible  
# - Frontend-Backend route matching is correct
#
# Usage:
#   ./scripts/pre-deploy-check.sh
#
# Exit codes:
#   0 - All checks passed
#   1 - Checks failed, do not deploy
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# API Base URL
API_URL="${API_BASE_URL:-http://localhost:8001}"

echo ""
echo "============================================"
echo "🔍 FINFLOW PRE-DEPLOYMENT CHECKS"
echo "============================================"
echo "API URL: $API_URL"
echo "Time: $(date)"
echo "============================================"
echo ""

# Track failures
FAILURES=0

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local expected_status=$3
    local description=$4
    
    response=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$API_URL$endpoint" 2>/dev/null || echo "000")
    
    if [ "$response" == "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $description ($endpoint) - $response"
        return 0
    else
        echo -e "${RED}✗${NC} $description ($endpoint) - Expected $expected_status, got $response"
        FAILURES=$((FAILURES + 1))
        return 1
    fi
}

echo "📋 Testing Critical Endpoints..."
echo ""

# Health check
test_endpoint "GET" "/api/health" "200" "Health Check"

# Auth endpoints (should exist)
echo ""
echo "🔐 Auth Routes..."
test_endpoint "POST" "/api/auth/request-otp?email=test@test.com" "404" "Request OTP (user not found is OK)"

# Transaction routes - CRITICAL regression test
echo ""
echo "💳 Transaction Routes (CRITICAL)..."
echo -e "${YELLOW}   These must match frontend exactly!${NC}"

# Test correct routes exist (401 = needs auth, 422 = validation failed - both mean route exists)
response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/transactions/type01" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
if [ "$response" == "401" ] || [ "$response" == "403" ] || [ "$response" == "422" ]; then
    echo -e "${GREEN}✓${NC} POST /api/transactions/type01 - Route exists ($response)"
else
    echo -e "${RED}✗${NC} POST /api/transactions/type01 - Route MISSING (got $response)"
    FAILURES=$((FAILURES + 1))
fi

response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/transactions/type02" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
if [ "$response" == "401" ] || [ "$response" == "403" ] || [ "$response" == "422" ]; then
    echo -e "${GREEN}✓${NC} POST /api/transactions/type02 - Route exists ($response)"
else
    echo -e "${RED}✗${NC} POST /api/transactions/type02 - Route MISSING (got $response)"
    FAILURES=$((FAILURES + 1))
fi

# Test wrong routes don't exist (should be 404/405)
response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/transactions/type-01" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
if [ "$response" == "404" ] || [ "$response" == "405" ]; then
    echo -e "${GREEN}✓${NC} POST /api/transactions/type-01 (hyphenated) - Correctly not found ($response)"
else
    echo -e "${RED}✗${NC} POST /api/transactions/type-01 - Should NOT exist but got $response"
    FAILURES=$((FAILURES + 1))
fi

echo ""
echo "============================================"
if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CHECKS PASSED - SAFE TO DEPLOY${NC}"
    exit 0
else
    echo -e "${RED}❌ $FAILURES CHECK(S) FAILED - DO NOT DEPLOY${NC}"
    exit 1
fi
