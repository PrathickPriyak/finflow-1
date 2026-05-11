"""
Auth Router - Two-factor authentication (Password + OTP)
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, validator
from datetime import datetime, timezone, timedelta
import re
import hashlib
import asyncio

from core.database import db
from core.dependencies import auth_required, log_audit, get_settings, get_client_ip
from auth import generate_otp, generate_token, send_otp_email, is_dev_mode, verify_password, hash_password, set_auth_cookie, clear_auth_cookie
from core.smtp_config import is_smtp_configured
from models import OTPSession, Session

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Rate limiting for OTP requests
OTP_RATE_LIMIT_WINDOW = 60  # seconds
OTP_RATE_LIMIT_MAX = 3  # max requests per window

# SEC-08: Rate limiting for login attempts
LOGIN_RATE_LIMIT_WINDOW = 900  # 15 minutes
LOGIN_MAX_FAILED_PER_EMAIL = 5  # max failed attempts per email
LOGIN_MAX_PER_IP = 20  # max requests per IP per window
# SEC-09: Account lockout after repeated failures
LOCKOUT_THRESHOLD = 10  # consecutive failures across windows before lockout
LOCKOUT_DURATION = 1800  # 30 minute lockout


def hash_otp(otp: str) -> str:
    """SEC-03: Hash OTP with SHA-256 for secure storage"""
    return hashlib.sha256(otp.encode()).hexdigest()


# ============== REQUEST MODELS ==============

class PasswordLoginRequest(BaseModel):
    email: str
    password: str

class VerifyOTPRequest(BaseModel):
    email: str
    otp: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @validator('new_password')
    def validate_password(cls, v):
        if len(v) < 12:
            raise ValueError('Password must be at least 12 characters')
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[0-9]', v):
            raise ValueError('Password must contain at least one number')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v


def validate_password_strength(password: str) -> tuple[bool, str]:
    """Validate password meets requirements: 12+ chars, uppercase, number, special char"""
    if len(password) < 12:
        return False, "Password must be at least 12 characters"
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number"
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character (!@#$%^&*(),.?\":{}|<>)"
    return True, "Valid"


async def check_otp_rate_limit(email: str) -> bool:
    """Check if OTP request is within rate limit"""
    if is_dev_mode():
        return True
        
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=OTP_RATE_LIMIT_WINDOW)
    
    count = await db.rate_limits.count_documents({
        "key": email,
        "timestamp": {"$gte": window_start.isoformat()}
    })
    
    if count >= OTP_RATE_LIMIT_MAX:
        return False
    
    await db.rate_limits.insert_one({
        "key": email,
        "timestamp": now.isoformat(),
        "expires_at": (now + timedelta(seconds=OTP_RATE_LIMIT_WINDOW * 2)).isoformat()
    })
    
    await db.rate_limits.delete_many({
        "timestamp": {"$lt": window_start.isoformat()}
    })
    
    return True


async def check_login_rate_limit(email: str, ip: str) -> dict:
    """
    SEC-08: Check login rate limits for both email and IP.
    SEC-09: Check account lockout for persistent attackers.
    Returns dict with 'allowed' bool and 'reason' if blocked.
    """
    now = datetime.now(timezone.utc)
    
    # SEC-09: Check account lockout first
    lockout = await db.account_lockouts.find_one({"email": email}, {"_id": 0})
    if lockout:
        locked_until = lockout.get("locked_until", "")
        if isinstance(locked_until, str) and locked_until:
            locked_until_dt = datetime.fromisoformat(locked_until)
            if locked_until_dt.tzinfo is None:
                locked_until_dt = locked_until_dt.replace(tzinfo=timezone.utc)
            if locked_until_dt > now:
                remaining_mins = int((locked_until_dt - now).total_seconds() / 60) + 1
                return {
                    "allowed": False,
                    "reason": f"Account temporarily locked due to too many failed attempts. Try again in {remaining_mins} minutes."
                }
            else:
                # Lockout expired, remove it
                await db.account_lockouts.delete_one({"email": email})
    
    window_start = now - timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW)
    window_start_iso = window_start.isoformat()
    
    # Check failed attempts per email
    email_failures = await db.login_attempts.count_documents({
        "email": email,
        "success": False,
        "timestamp": {"$gte": window_start_iso}
    })
    
    if email_failures >= LOGIN_MAX_FAILED_PER_EMAIL:
        remaining = LOGIN_RATE_LIMIT_WINDOW // 60
        return {
            "allowed": False,
            "reason": f"Too many failed attempts for this email. Try again in {remaining} minutes."
        }
    
    # Check total attempts per IP
    ip_attempts = await db.login_attempts.count_documents({
        "ip": ip,
        "timestamp": {"$gte": window_start_iso}
    })
    
    if ip_attempts >= LOGIN_MAX_PER_IP:
        return {
            "allowed": False,
            "reason": "Too many login attempts from your location. Please wait and try again."
        }
    
    return {"allowed": True}


async def record_login_attempt(email: str, ip: str, success: bool):
    """SEC-08: Record login attempt for rate limiting. SEC-09: Trigger lockout on persistent failures."""
    now = datetime.now(timezone.utc)
    await db.login_attempts.insert_one({
        "email": email,
        "ip": ip,
        "success": success,
        "timestamp": now.isoformat(),
        "expires_at": (now + timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW * 2)).isoformat()
    })
    
    # SEC-09: Check for account lockout on failure
    if not success:
        # Count total recent failures (broader window for lockout)
        lockout_window = now - timedelta(seconds=LOCKOUT_DURATION)
        total_failures = await db.login_attempts.count_documents({
            "email": email,
            "success": False,
            "timestamp": {"$gte": lockout_window.isoformat()}
        })
        if total_failures >= LOCKOUT_THRESHOLD:
            await db.account_lockouts.update_one(
                {"email": email},
                {"$set": {
                    "email": email,
                    "locked_until": (now + timedelta(seconds=LOCKOUT_DURATION)).isoformat(),
                    "failure_count": total_failures,
                    "locked_at": now.isoformat()
                }},
                upsert=True
            )
    elif success:
        # Clear lockout on successful login
        await db.account_lockouts.delete_one({"email": email})
    
    # Cleanup old records periodically (1% chance per request)
    import random
    if random.random() < 0.01:
        cleanup_before = (now - timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW * 2)).isoformat()
        await db.login_attempts.delete_many({"timestamp": {"$lt": cleanup_before}})


# ============== AUTH ENDPOINTS ==============

@router.post("/login")
async def password_login(data: PasswordLoginRequest, request: Request):
    """
    Step 1: Validate password and send OTP
    Two-factor authentication: Password + OTP
    """
    client_ip = get_client_ip(request)
    
    # Normalize email for case-insensitive matching
    normalized_email = data.email.lower().strip()
    
    # SEC-08: Check rate limits
    rate_check = await check_login_rate_limit(normalized_email, client_ip)
    if not rate_check["allowed"]:
        raise HTTPException(status_code=429, detail=rate_check["reason"])
    
    # Find user
    user = await db.users.find_one({"email": normalized_email, "is_deleted": False}, {"_id": 0})
    if not user:
        await record_login_attempt(normalized_email, client_ip, False)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.get("is_active"):
        raise HTTPException(status_code=403, detail="Account is deactivated")
    
    # Verify password — run bcrypt in thread pool to avoid blocking the event loop
    if not await asyncio.to_thread(verify_password, data.password, user.get("password_hash", "")):
        await record_login_attempt(normalized_email, client_ip, False)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # In dev/preview mode, skip OTP entirely — issue token directly
    if is_dev_mode():
        # Clean up stale sessions
        await db.sessions.delete_many({
            "user_id": user["id"],
            "expires_at": {"$lt": datetime.now(timezone.utc).isoformat()}
        })
        token = generate_token(user["id"], normalized_email, expires_hours=12)
        session = Session(
            user_id=user["id"],
            token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=12)
        )
        doc = session.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['last_activity'] = doc['last_activity'].isoformat()
        await db.sessions.insert_one(doc)
        role = await db.roles.find_one({"id": user["role_id"], "is_deleted": False}, {"_id": 0})
        await record_login_attempt(normalized_email, client_ip, True)
        await log_audit(user["id"], user["name"], "login", "auth", entity_id=user["id"],
            details={"email": user["email"], "role": role["name"] if role else "Unknown", "mode": "dev_skip_otp"},
            ip=client_ip)
        response = JSONResponse(content={
            "token": token,
            "requires_otp": False,
            "user": {
                "id": user["id"], "email": user["email"], "name": user["name"],
                "phone": user.get("phone", ""), "role_id": user["role_id"],
                "role_name": role["name"] if role else ""
            }
        })
        set_auth_cookie(response, token, max_age=43200)
        return response

    # SEC-04: Check OTP rate limit
    if not await check_otp_rate_limit(normalized_email):
        raise HTTPException(
            status_code=429, 
            detail="Too many OTP requests. Please wait before trying again."
        )
    
    # Generate and store OTP
    otp = generate_otp()
    otp_hash = hash_otp(otp)
    
    # Get settings for OTP expiry
    settings = await get_settings()
    otp_expiry_minutes = settings.get('otp_expiry_minutes', 5) if settings else 5
    
    otp_session = OTPSession(
        email=normalized_email,
        otp_hash=otp_hash,
        user_id=user["id"],
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=otp_expiry_minutes)
    )
    
    # Store OTP session (replace any existing)
    await db.otp_sessions.delete_many({"email": normalized_email})
    doc = otp_session.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['expires_at'] = doc['expires_at'].isoformat()
    await db.otp_sessions.insert_one(doc)
    
    # Send OTP email
    email_sent = await send_otp_email(normalized_email, otp, settings)
    
    # Log the attempt
    await log_audit(
        user["id"],
        user["name"],
        "login_attempt",
        "auth",
        entity_id=user["id"],
        details={"email": normalized_email, "otp_sent": email_sent},
        ip=client_ip
    )
    
    # Build response
    response = {
        "message": "OTP sent to your email",
        "email": normalized_email,
        "otp_expiry_minutes": otp_expiry_minutes,
        "requires_otp": True
    }

    if is_dev_mode():
        # Explicit dev mode — include OTP in response for convenience
        response["dev_otp"] = otp
        response["message"] = f"OTP: {otp} (Dev Mode)"
    elif not email_sent:
        # Production mode: NEVER leak OTP — return an error instead
        if is_smtp_configured():
            raise HTTPException(
                status_code=500,
                detail="Failed to send OTP email. Please try again. If this persists, contact your administrator to check SMTP logs."
            )
        else:
            raise HTTPException(
                status_code=500,
                detail="Email service is not configured. Contact your administrator."
            )

    return response


@router.post("/verify-otp")
async def verify_otp(data: VerifyOTPRequest, request: Request):
    """Step 2: Verify OTP and complete login"""
    
    # Strip whitespace from OTP input (users may accidentally copy spaces)
    cleaned_otp = data.otp.strip()
    normalized_email = data.email.lower().strip()
    
    otp_session = await db.otp_sessions.find_one({"email": normalized_email}, {"_id": 0})
    if not otp_session:
        raise HTTPException(status_code=400, detail="No OTP request found. Please login again.")
    
    expires_at = otp_session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    
    # Handle timezone-naive datetime from MongoDB
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    if expires_at < datetime.now(timezone.utc):
        await db.otp_sessions.delete_one({"email": normalized_email})
        raise HTTPException(status_code=400, detail="OTP has expired. Please login again.")
    
    # SEC-02 FIX: Check failed attempts and increment on wrong OTP
    # SEC-03 FIX: Compare hashed OTPs
    input_otp_hash = hash_otp(cleaned_otp)
    stored_otp_hash = otp_session.get("otp_hash") or otp_session.get("otp")  # Support both field names
    if stored_otp_hash != input_otp_hash:
        # Increment failed attempt counter atomically
        result = await db.otp_sessions.find_one_and_update(
            {"email": normalized_email},
            {"$inc": {"attempts": 1}},
            return_document=True,
            projection={"_id": 0}
        )
        
        if result and result.get("attempts", 0) >= 5:
            # Max attempts reached - delete OTP session and force re-login
            await db.otp_sessions.delete_one({"email": normalized_email})
            raise HTTPException(status_code=400, detail="Too many failed attempts. Please login again.")
        
        raise HTTPException(status_code=400, detail="Invalid OTP")
    
    # Clear OTP session
    await db.otp_sessions.delete_one({"email": normalized_email})
    
    # Get user
    user = await db.users.find_one({"email": normalized_email, "is_deleted": False}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # AUDIT-R3-07: Only delete sessions from this device/context, keep other device sessions alive
    # Delete only expired sessions for this user to clean up stale sessions
    await db.sessions.delete_many({
        "user_id": user["id"],
        "expires_at": {"$lt": datetime.now(timezone.utc).isoformat()}
    })
    
    # Create new session (12 hour expiry)
    token = generate_token(user["id"], normalized_email, expires_hours=12)
    
    session = Session(
        user_id=user["id"],
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=12)
    )
    doc = session.model_dump()
    # SEC-05 FIX: Store expires_at as native datetime (BSON Date) for TTL index
    # expires_at remains as datetime object (not converted to string)
    doc['created_at'] = doc['created_at'].isoformat()
    doc['last_activity'] = doc['last_activity'].isoformat()
    await db.sessions.insert_one(doc)
    
    # Get role
    role = await db.roles.find_one({"id": user["role_id"], "is_deleted": False}, {"_id": 0})
    
    # Log audit
    await log_audit(
        user["id"], 
        user["name"], 
        "login", 
        "auth", 
        entity_id=user["id"],
        details={"email": user["email"], "role": role["name"] if role else "Unknown"},
        ip=get_client_ip(request)
    )
    
    response = JSONResponse(content={
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "phone": user.get("phone", ""),
            "role_id": user["role_id"],
            "role_name": role["name"] if role else ""
        }
    })
    set_auth_cookie(response, token, max_age=43200)
    return response


@router.post("/logout")
async def logout(request: Request, auth: dict = Depends(auth_required)):
    """Logout and invalidate session"""
    user_id = auth["user"]["id"]
    
    await db.sessions.delete_many({"user_id": user_id})
    
    await log_audit(
        user_id, 
        auth["user"]["name"], 
        "logout", 
        "auth",
        ip=get_client_ip(request)
    )
    
    response = JSONResponse(content={"message": "Logged out successfully"})
    clear_auth_cookie(response)
    return response


@router.get("/me")
async def get_current_user(auth: dict = Depends(auth_required)):
    """Get current user info and permissions"""
    user = auth["user"]
    role = auth["role"]
    
    modules = await db.modules.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    
    # Build permissions from role
    permissions = {}
    if role["name"] == "SuperAdmin":
        # SuperAdmin has access to all modules
        permissions = {m["name"]: True for m in modules}
    else:
        # Other roles: permissions is a list of module names with access
        role_permissions = role.get("permissions", [])
        for m in modules:
            permissions[m["name"]] = m["name"] in role_permissions
    
    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "phone": user.get("phone", ""),
            "role_id": user["role_id"],
            "role_name": role["name"] if role else ""
        },
        "permissions": permissions,
        "modules": sorted(modules, key=lambda x: x.get("order", 0))
    }


@router.post("/change-password")
async def change_password(data: ChangePasswordRequest, request: Request, auth: dict = Depends(auth_required)):
    """Change user password"""
    user = auth["user"]
    
    # Get full user with password hash
    full_user = await db.users.find_one({"id": user["id"], "is_deleted": False}, {"_id": 0})
    if not full_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify current password — run bcrypt in thread pool to avoid blocking the event loop
    if not await asyncio.to_thread(verify_password, data.current_password, full_user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Hash new password — run bcrypt in thread pool
    new_hash = await asyncio.to_thread(hash_password, data.new_password)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": new_hash, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    # Invalidate all sessions (force re-login)
    await db.sessions.delete_many({"user_id": user["id"]})
    
    await log_audit(
        user["id"],
        user["name"],
        "password_change",
        "auth",
        ip=get_client_ip(request)
    )
    
    return {"message": "Password changed successfully. Please login again."}


# ============== RATE LIMIT MANAGEMENT (Admin Only) ==============

@router.get("/rate-limits")
async def get_rate_limit_status(auth: dict = Depends(auth_required)):
    """Get current rate limit status - blocked emails and IPs"""
    # Only SuperAdmin can view rate limits
    if auth["role"]["name"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can view rate limits")
    
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW)).isoformat()
    
    # Get all attempts within the window
    attempts = await db.login_attempts.find(
        {"timestamp": {"$gte": window_start}},
        {"_id": 0}
    ).to_list(1000)
    
    # Aggregate by email
    email_stats = {}
    for attempt in attempts:
        email = attempt.get("email", "unknown")
        if email not in email_stats:
            email_stats[email] = {"total": 0, "failed": 0, "last_attempt": None}
        email_stats[email]["total"] += 1
        if not attempt.get("success", True):
            email_stats[email]["failed"] += 1
        email_stats[email]["last_attempt"] = attempt.get("timestamp")
    
    # Aggregate by IP
    ip_stats = {}
    for attempt in attempts:
        ip = attempt.get("ip", "unknown")
        if ip not in ip_stats:
            ip_stats[ip] = {"total": 0, "failed": 0, "emails": set()}
        ip_stats[ip]["total"] += 1
        if not attempt.get("success", True):
            ip_stats[ip]["failed"] += 1
        ip_stats[ip]["emails"].add(attempt.get("email", "unknown"))
    
    # Convert sets to lists for JSON serialization
    for ip in ip_stats:
        ip_stats[ip]["emails"] = list(ip_stats[ip]["emails"])
    
    # Identify blocked emails (>= threshold)
    blocked_emails = [
        {"email": email, **stats}
        for email, stats in email_stats.items()
        if stats["failed"] >= LOGIN_MAX_FAILED_PER_EMAIL
    ]
    
    # Identify rate-limited IPs
    limited_ips = [
        {"ip": ip, **stats}
        for ip, stats in ip_stats.items()
        if stats["total"] >= LOGIN_MAX_PER_IP
    ]
    
    # Get total counts
    total_attempts = len(attempts)
    total_failed = sum(1 for a in attempts if not a.get("success", True))
    
    return {
        "window_minutes": LOGIN_RATE_LIMIT_WINDOW // 60,
        "thresholds": {
            "max_failed_per_email": LOGIN_MAX_FAILED_PER_EMAIL,
            "max_per_ip": LOGIN_MAX_PER_IP
        },
        "summary": {
            "total_attempts": total_attempts,
            "total_failed": total_failed,
            "blocked_emails": len(blocked_emails),
            "limited_ips": len(limited_ips)
        },
        "blocked_emails": sorted(blocked_emails, key=lambda x: x["failed"], reverse=True),
        "limited_ips": sorted(limited_ips, key=lambda x: x["total"], reverse=True),
        "all_emails": sorted(
            [{"email": email, **stats} for email, stats in email_stats.items()],
            key=lambda x: x["failed"],
            reverse=True
        )[:20]  # Top 20 by failed attempts
    }


@router.delete("/rate-limits/email/{email}")
async def clear_email_rate_limit(email: str, request: Request, auth: dict = Depends(auth_required)):
    """Clear rate limit for a specific email"""
    if auth["role"]["name"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can clear rate limits")
    
    result = await db.login_attempts.delete_many({"email": email})
    
    await log_audit(
        auth["user"]["id"],
        auth["user"]["name"],
        "clear_rate_limit",
        "auth",
        details={"email": email, "cleared_count": result.deleted_count},
        ip=get_client_ip(request)
    )
    
    return {
        "message": f"Cleared {result.deleted_count} login attempts for {email}",
        "email": email,
        "cleared_count": result.deleted_count
    }


@router.delete("/rate-limits/ip/{ip}")
async def clear_ip_rate_limit(ip: str, request: Request, auth: dict = Depends(auth_required)):
    """Clear rate limit for a specific IP"""
    if auth["role"]["name"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can clear rate limits")
    
    result = await db.login_attempts.delete_many({"ip": ip})
    
    await log_audit(
        auth["user"]["id"],
        auth["user"]["name"],
        "clear_rate_limit",
        "auth",
        details={"ip": ip, "cleared_count": result.deleted_count},
        ip=get_client_ip(request)
    )
    
    return {
        "message": f"Cleared {result.deleted_count} login attempts from IP {ip}",
        "ip": ip,
        "cleared_count": result.deleted_count
    }


@router.delete("/rate-limits/all")
async def clear_all_rate_limits(request: Request, auth: dict = Depends(auth_required)):
    """Clear all rate limits"""
    if auth["role"]["name"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can clear rate limits")
    
    result = await db.login_attempts.delete_many({})
    
    await log_audit(
        auth["user"]["id"],
        auth["user"]["name"],
        "clear_all_rate_limits",
        "auth",
        details={"cleared_count": result.deleted_count},
        ip=get_client_ip(request)
    )
    
    return {
        "message": f"Cleared all {result.deleted_count} login attempts",
        "cleared_count": result.deleted_count
    }


