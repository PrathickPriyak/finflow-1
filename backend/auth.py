"""
Fin Flow - Authentication Module
Email + OTP based authentication with single session
"""
import os
import random
import string
import aiosmtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from passlib.context import CryptContext
import jwt
from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core.smtp_config import get_smtp_config, is_smtp_configured

# Configure logger
logger = logging.getLogger(__name__)

# Load environment variables from .env file ONLY for local development
# In Docker, environment variables are passed via docker-compose and should take precedence
ROOT_DIR = Path(__file__).parent
# Load .env only for local development; in Docker, env vars come from docker-compose
if not os.environ.get('DOCKER_ENV'):
    load_dotenv(ROOT_DIR / '.env')

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

# Cookie name for httpOnly auth token
AUTH_COOKIE_NAME = "finflow_session"

# JWT Configuration - MUST be set in environment, no default allowed
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    dev_mode = os.environ.get("DEV_MODE", "false").lower() == "true"
    if not dev_mode:
        raise RuntimeError("JWT_SECRET environment variable is required in production. Set it with: export JWT_SECRET=$(openssl rand -hex 32)")
    import secrets
    JWT_SECRET = secrets.token_hex(32)
    logger.warning("JWT_SECRET not set — using auto-generated secret. All sessions will be invalidated on restart.")

JWT_ALGORITHM = "HS256"

# Environment detection — evaluated at runtime to avoid import-order bugs
def is_dev_mode() -> bool:
    """Check DEV_MODE at runtime, never at import time.
    SEC-06: Safeguard against accidental dev mode in production.
    """
    dev = os.environ.get("DEV_MODE", "false").lower() == "true"
    if dev:
        react_url = os.environ.get("REACT_APP_BACKEND_URL", "")
        if any(kw in react_url.lower() for kw in ["prod", "live", "finflow.com"]):
            logger.critical(
                "DEV_MODE is ON but REACT_APP_BACKEND_URL looks like production (%s). "
                "This bypasses OTP verification! Set DEV_MODE=false for production.",
                react_url
            )
    return dev


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def generate_otp(length: int = 6) -> str:
    return ''.join(random.choices(string.digits, k=length))


def set_auth_cookie(response, token: str, max_age: int = 43200):
    """Set httpOnly secure cookie with the auth token."""
    is_secure = os.environ.get("REACT_APP_BACKEND_URL", "").startswith("https")
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        path="/api",
        max_age=max_age,
    )


def clear_auth_cookie(response):
    """Clear the auth cookie on logout."""
    is_secure = os.environ.get("REACT_APP_BACKEND_URL", "").startswith("https")
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        path="/api",
    )


def generate_token(user_id: str, email: str, expires_hours: int = 24) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=expires_hours),
        "iat": datetime.now(timezone.utc)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def send_otp_email(email: str, otp: str, settings: dict = None) -> bool:
    """
    Send OTP via SMTP configured in environment variables.
    Uses aiosmtplib (async) to avoid blocking the event loop.
    """
    smtp = get_smtp_config()

    if not is_smtp_configured():
        logger.warning(f"SMTP not configured. Cannot send OTP to {email}")
        return False  # Return False so caller knows email was not sent

    try:
        msg = MIMEMultipart()
        msg['From'] = smtp["from_email"]
        msg['To'] = email
        msg['Subject'] = "Fin Flow - Your Login OTP"

        otp_expiry = settings.get('otp_expiry_minutes', 5) if settings else 5

        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Fin Flow Login OTP</h2>
            <p>Your one-time password for login is:</p>
            <h1 style="color: #0F172A; letter-spacing: 4px; font-size: 32px;">{otp}</h1>
            <p>This OTP will expire in {otp_expiry} minutes.</p>
            <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </body>
        </html>
        """
        msg.attach(MIMEText(body, 'html'))

        # Use aiosmtplib (async) — never blocks the event loop
        # SMTP_SSL=true  → implicit TLS (port 465): use_tls=True
        # SMTP_SSL=false → STARTTLS   (port 587): start_tls=True
        tls_kwargs = {}
        if smtp["use_ssl"]:
            tls_kwargs["use_tls"] = True
        else:
            tls_kwargs["start_tls"] = True

        await aiosmtplib.send(
            msg,
            hostname=smtp["host"],
            port=smtp["port"],
            username=smtp["user"],
            password=smtp["password"],
            **tls_kwargs
        )

        logger.info(f"OTP email sent successfully to {email}")
        return True
    except aiosmtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP auth failed (sender={smtp['user']}, recipient={email}): {e} — check SMTP_USER and SMTP_PASSWORD")
        return False
    except aiosmtplib.SMTPConnectError as e:
        logger.error(f"SMTP connection failed (host={smtp['host']}:{smtp['port']}, ssl={smtp['use_ssl']}, recipient={email}): {e}")
        return False
    except Exception as e:
        logger.error(f"OTP email send failed (host={smtp['host']}:{smtp['port']}, ssl={smtp['use_ssl']}, recipient={email}): {type(e).__name__}: {e}")
        return False


class AuthDependency:
    """Dependency for protected routes. Supports httpOnly cookie and Bearer token."""
    def __init__(self, db):
        self.db = db
    
    async def __call__(
        self,
        request: Request,
        credentials: HTTPAuthorizationCredentials = Depends(security)
    ) -> dict:
        # SEC-03: Try httpOnly cookie first, then fall back to Bearer token
        token = None
        if request.cookies.get(AUTH_COOKIE_NAME):
            token = request.cookies[AUTH_COOKIE_NAME]
        elif credentials:
            token = credentials.credentials
        
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        
        payload = decode_token(token)
        
        # Check if session exists and is valid
        session = await self.db.sessions.find_one(
            {"token": token, "user_id": payload["user_id"]},
            {"_id": 0}
        )
        
        if not session:
            raise HTTPException(status_code=401, detail="Session invalid or expired")
        
        # Check session expiry
        expires_at = session.get("expires_at")
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        
        # SEC-05: Handle native datetime from MongoDB (offset-naive)
        # Convert offset-naive to UTC if needed
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        
        if expires_at < datetime.now(timezone.utc):
            await self.db.sessions.delete_one({"token": token})
            raise HTTPException(status_code=401, detail="Session expired")
        
        # Get user
        user = await self.db.users.find_one(
            {"id": payload["user_id"], "is_deleted": False},
            {"_id": 0, "password_hash": 0}
        )
        
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        if not user.get("is_active"):
            raise HTTPException(status_code=401, detail="User is deactivated")
        
        # BUG-S3-20 FIX: fire-and-forget last_activity update — avoid a DB write
        # on every single authenticated request that blocks the response path.
        import asyncio
        asyncio.ensure_future(
            self.db.sessions.update_one(
                {"token": token},
                {"$set": {"last_activity": datetime.now(timezone.utc).isoformat()}}
            )
        )
        
        # Get role permissions
        role = await self.db.roles.find_one(
            {"id": user["role_id"], "is_deleted": False},
            {"_id": 0}
        )
        
        return {
            "user": user,
            "role": role,
            "token": token
        }


def get_auth_dependency(db):
    return AuthDependency(db)
