"""
SMTP Configuration - Single source of truth from ENV variables
All SMTP settings are read from environment variables at request time.
"""
import os
import logging

logger = logging.getLogger(__name__)


def get_smtp_config() -> dict:
    """
    Get SMTP configuration from environment variables.
    Called at request time to allow changes without restart.
    """
    return {
        "host": os.environ.get('SMTP_HOST', ''),
        "port": int(os.environ.get('SMTP_PORT', '465')),
        "user": os.environ.get('SMTP_USER', ''),
        "password": os.environ.get('SMTP_PASSWORD', ''),
        "from_email": os.environ.get('SMTP_FROM', '') or os.environ.get('SMTP_USER', ''),
        "use_ssl": os.environ.get('SMTP_SSL', 'true').lower() == 'true',
    }


def is_smtp_configured() -> bool:
    """Check if SMTP is properly configured"""
    config = get_smtp_config()
    return bool(config["host"] and config["user"] and config["password"])


def get_smtp_status() -> dict:
    """Get SMTP status for UI display"""
    config = get_smtp_config()
    tls_mode = "Implicit TLS (port 465)" if config["use_ssl"] else "STARTTLS (port 587)"
    return {
        "configured": is_smtp_configured(),
        "host": config["host"] or "Not set",
        "port": config["port"],
        "from_email": config["from_email"] or "Not set",
        "ssl_enabled": config["use_ssl"],
        "tls_mode": tls_mode,
        "message": "SMTP is configured and ready" if is_smtp_configured() else "SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in environment."
    }
