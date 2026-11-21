"""
Configuración centralizada del backend de Valuriq (valuriq.com) mediante `pydantic-settings`.
"""

import json
from functools import lru_cache
from typing import Annotated
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_ASYNC_PG_INCOMPATIBLE_QUERY_PARAMS = frozenset({"sslmode", "channel_binding"})
_LOCAL_DB_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "db"})


class Settings(BaseSettings):
    """Variables de entorno y ajustes de producción/desarrollo de Valuriq."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(
        default="Valuriq — Auditoría Hipotecaria y TAE Real",
        description="Nombre oficial de la API",
    )
    app_version: str = Field(default="1.0.0", description="Versión semántica de la API")
    api_v1_prefix: str = Field(default="/api/v1", description="Prefijo base para endpoints REST v1")

    database_url: str = Field(
        default="sqlite+aiosqlite:///./hiporeal_local.db",
        description="URL de conexión asíncrona (PostgreSQL en producción vía DATABASE_URL, SQLite async por defecto en desarrollo local)",
    )

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=[
            "http://localhost:4200",
            "http://127.0.0.1:4200",
            "http://localhost:80",
            "http://localhost",
            "https://valuriq.com",
            "https://www.valuriq.com",
            "https://valuriq.netlify.app",
        ],
        description="Orígenes CORS permitidos para el frontend Angular (configurable vía CORS_ORIGINS como lista JSON o cadena separada por comas)",
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_async_database_url(cls, value: object) -> str:
        """
        Convierte automáticamente URLs `postgres://` o `postgresql://` al driver asíncrono
        `postgresql+asyncpg://` y elimina parámetros de query string incompatibles con `asyncpg`
        (`sslmode`, `channel_binding`).
        """
        if not isinstance(value, str) or not value.strip():
            return "sqlite+aiosqlite:///./hiporeal_local.db"
        url = value.strip()
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://") :]
        elif url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]

        if url.startswith("postgresql+asyncpg://"):
            parts = urlsplit(url)
            if parts.query:
                filtered_query = [
                    (k, v)
                    for k, v in parse_qsl(parts.query, keep_blank_values=True)
                    if k.lower() not in _ASYNC_PG_INCOMPATIBLE_QUERY_PARAMS
                ]
                url = urlunsplit(
                    (
                        parts.scheme,
                        parts.netloc,
                        parts.path,
                        urlencode(filtered_query),
                        parts.fragment,
                    )
                )
        return url

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> list[str]:
        """Permite definir `CORS_ORIGINS` como lista JSON o como orígenes separados por comas."""
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                parsed = json.loads(raw)
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [origin.strip() for origin in raw.split(",") if origin.strip()]
        if isinstance(value, (list, tuple)):
            return [str(item).strip() for item in value if str(item).strip()]
        return [
            "http://localhost:4200",
            "http://127.0.0.1:4200",
            "https://valuriq.com",
            "https://www.valuriq.com",
            "https://valuriq.netlify.app",
        ]

    @property
    def is_remote_postgres(self) -> bool:
        """
        Indica si `database_url` apunta a un PostgreSQL remoto/serverless (Neon, Supabase, Cloud),
        excluyendo SQLite y contenedores locales (`localhost`, `127.0.0.1`, `db`).
        """
        if not self.database_url.startswith("postgresql"):
            return False
        host = (urlsplit(self.database_url).hostname or "").lower()
        return bool(host) and host not in _LOCAL_DB_HOSTS


@lru_cache
def get_settings() -> Settings:
    """Devuelve la instancia cacheada de Settings."""
    return Settings()
