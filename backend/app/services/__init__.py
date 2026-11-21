"""Servicios de aplicación y exportación PDF de HipoReal."""

from app.services.audit_service import (
    create_and_save_audit,
    generate_audit_slug,
    get_audit_record_by_slug,
)
from app.services.pdf_service import generate_audit_pdf_bytes

__all__ = [
    "create_and_save_audit",
    "generate_audit_pdf_bytes",
    "generate_audit_slug",
    "get_audit_record_by_slug",
]
