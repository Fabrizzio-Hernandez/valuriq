"""
Configuración del motor asíncrono SQLAlchemy 2.0 y proveedor de sesiones para FastAPI.
"""

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

_engine_kwargs: dict[str, Any] = {
    "echo": False,
    "future": True,
}

if settings.is_remote_postgres:
    _engine_kwargs["poolclass"] = NullPool
    _engine_kwargs["connect_args"] = {
        "ssl": "require",
        "statement_cache_size": 0,
    }
else:
    _engine_kwargs["pool_pre_ping"] = True

engine: AsyncEngine = create_async_engine(
    settings.database_url,
    **_engine_kwargs,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependencia FastAPI que entrega una sesión asíncrona de base de datos."""
    async with AsyncSessionLocal() as session:
        yield session
