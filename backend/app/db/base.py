"""
Base declarativa SQLAlchemy 2.0 para la capa de persistencia de HipoReal.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Clase base para todos los modelos ORM de SQLAlchemy 2.0."""
