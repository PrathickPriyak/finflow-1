"""
Core module - Database, dependencies, and shared utilities
"""
from .database import db, client, scheduler
from .dependencies import auth_required, check_permission, log_audit, get_settings, get_client_ip

__all__ = [
    'db', 'client', 'scheduler',
    'auth_required', 'check_permission', 'log_audit', 'get_settings', 'get_client_ip'
]
