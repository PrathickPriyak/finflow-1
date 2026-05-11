"""
SMTP Router - Email configuration and testing
SMTP settings are ENV-only, read at request time for live updates
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

from core.dependencies import auth_required, check_permission
from core.smtp_config import get_smtp_config, is_smtp_configured, get_smtp_status

router = APIRouter(prefix="/smtp", tags=["SMTP"])

logger = logging.getLogger(__name__)


class TestEmailRequest(BaseModel):
    to_email: EmailStr


@router.get("/status")
async def get_status(auth: dict = Depends(auth_required)):
    """Get SMTP configuration status (not the actual credentials)"""
    await check_permission(auth, "settings")
    return get_smtp_status()


@router.post("/test")
async def send_test_email(data: TestEmailRequest, auth: dict = Depends(auth_required)):
    """Send a test email to verify SMTP configuration"""
    await check_permission(auth, "settings")
    if not is_smtp_configured():
        raise HTTPException(
            status_code=400, 
            detail="SMTP not configured. Please set SMTP_HOST, SMTP_USER, SMTP_PASSWORD environment variables."
        )
    
    # Get fresh config at request time
    smtp = get_smtp_config()
    
    try:
        # Create message
        message = MIMEMultipart()
        message["From"] = smtp["from_email"]
        message["To"] = data.to_email
        message["Subject"] = "Fin Flow - SMTP Test Email"
        
        body = """
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #10b981;">✓ SMTP Configuration Successful!</h2>
            <p>This is a test email from <strong>Fin Flow</strong>.</p>
            <p>Your SMTP settings are working correctly.</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">
                This email was sent to verify your SMTP configuration.<br>
                If you did not request this, please ignore this email.
            </p>
        </body>
        </html>
        """
        message.attach(MIMEText(body, "html"))
        
        # Send email — use SSL (port 465)
        tls_kwargs = {}
        if smtp["use_ssl"]:
            tls_kwargs["use_tls"] = True

        await aiosmtplib.send(
            message,
            hostname=smtp["host"],
            port=smtp["port"],
            username=smtp["user"],
            password=smtp["password"],
            **tls_kwargs
        )
        
        logger.info(f"Test email sent successfully to {data.to_email}")
        
        return {
            "success": True,
            "message": f"Test email sent successfully to {data.to_email}"
        }
        
    except aiosmtplib.SMTPAuthenticationError:
        logger.error("SMTP authentication failed")
        raise HTTPException(status_code=400, detail="SMTP authentication failed. Check SMTP_USER and SMTP_PASSWORD.")
    except aiosmtplib.SMTPConnectError:
        logger.error(f"Failed to connect to SMTP server {smtp['host']}:{smtp['port']}")
        raise HTTPException(status_code=400, detail="Failed to connect to SMTP server. Check SMTP_HOST and SMTP_PORT.")
    except Exception as e:
        logger.error(f"Failed to send test email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")
