"""
Punto de entrada de la aplicación FastAPI de Valuriq (valuriq.com).

Incluye:
- Compresión HTTP GZip automática (`GZipMiddleware`) para respuestas JSON ultrarrápidas.
- Configuración CORS lista para Angular (`http://localhost:4200`) y producción (`https://valuriq.com`).
- Documentación interactiva OpenAPI (`/docs` y `/redoc`).
- Endpoints REST bajo `/api/v1`.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import router as api_v1_router
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """
    Asegura que el esquema de base de datos (`audits`) exista al arrancar en desarrollo local con SQLite.
    En PostgreSQL (Docker / Producción), las migraciones las gestiona `alembic upgrade head`.
    """
    if settings.database_url.startswith("sqlite"):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield


def create_app() -> FastAPI:
    """Factoría de aplicación FastAPI para producción y tests de integración."""
    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        description=(
            "API oficial de **Valuriq** (`valuriq.com`): Auditoría Hipotecaria y TAE Real "
            "para el mercado español. Motor financiero exacto en `Decimal`, optimizador "
            "combinatorio de vinculaciones, cálculo de TAE Real Oculta (TIR), simulador de amortización "
            "anticipada y exportación de informes ejecutivos en PDF."
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    application.add_middleware(GZipMiddleware, minimum_size=500)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    application.include_router(api_v1_router, prefix=settings.api_v1_prefix)
    return application


app = create_app()
