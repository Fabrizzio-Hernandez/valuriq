"""
Tests de integración de extremo a extremo para la API FastAPI de HipoReal.

Ejecuta contra `sqlite+aiosqlite:///:memory:` con `StaticPool`, validando:
- Configuración CORS para Angular (`http://localhost:4200`).
- Endpoint de presets (`GET /api/v1/presets`).
- Cálculo directo (`POST /api/v1/audits/calculate`) y protección combinatoria 2^N (`max_length=12`).
- Persistencia JSON/JSONB y recuperación por `slug` (`POST /api/v1/audits` y `GET /api/v1/audits/{slug}`).
- Simulador de amortización anticipada (`POST /api/v1/audits/early-repayment`).
- Generación y descarga de PDF con ReportLab (`POST /api/v1/audits/pdf` y `GET /api/v1/audits/{slug}/pdf`),
  verificando la cabecera binaria `%PDF-`.
"""

from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db_session
from app.domain.presets import get_spanish_mortgage_presets
from app.main import app


@pytest.fixture()
async def api_client() -> AsyncGenerator[AsyncClient, None]:
    """
    Crea una base de datos SQLite asíncrona en memoria aislada por test
    y sobreescribe la dependencia `get_db_session` de FastAPI.
    """
    test_engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    test_session_maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with test_session_maker() as session:
            yield session

    app.dependency_overrides[get_db_session] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    await test_engine.dispose()


async def test_health_check_and_angular_cors_headers(api_client: AsyncClient) -> None:
    """Verifica el endpoint `/api/v1/health` y las cabeceras CORS para `http://localhost:4200`."""
    resp = await api_client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "valuriq-backend"

    cors_resp = await api_client.options(
        "/api/v1/presets",
        headers={
            "Origin": "http://localhost:4200",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert cors_resp.status_code == 200
    assert cors_resp.headers.get("access-control-allow-origin") == "http://localhost:4200"


async def test_get_presets_returns_spanish_mortgage_catalog(api_client: AsyncClient) -> None:
    """Verifica que `GET /api/v1/presets` devuelve los 4 presets listos para Angular (incluyendo PUF)."""
    resp = await api_client.get("/api/v1/presets")
    assert resp.status_code == 200
    presets = resp.json()
    assert isinstance(presets, list)
    assert len(presets) == 4

    preset_ids = {item["id"] for item in presets}
    assert preset_ids == {
        "fija_tipica_trampa",
        "fija_trampa_puf",
        "mixta_5_anos",
        "variable_agresiva",
    }

    fija = next(item for item in presets if item["id"] == "fija_tipica_trampa")
    assert fija["badge"] == "Fija 30 Años"
    assert fija["offer"]["principal_eur"] == "220000.00"
    assert len(fija["offer"]["linked_products"]) == 4

    puf_preset = next(item for item in presets if item["id"] == "fija_trampa_puf")
    vida_puf = next(p for p in puf_preset["offer"]["linked_products"] if p["id"] == "vida_puf")
    assert vida_puf["payment_mode"] == "PUF_FINANCED"
    assert vida_puf["puf_amount_eur"] == "12000.00"


async def test_calculate_audit_stateless_endpoint(api_client: AsyncClient) -> None:
    """Verifica el cálculo stateless `POST /api/v1/audits/calculate` con amortización anticipada opcional."""
    offer_dict = get_spanish_mortgage_presets()["fija_tipica_trampa"].model_dump(mode="json")
    payload = {
        "offer": offer_dict,
        "early_repayment_config": {
            "amount_eur": "15000.00",
            "frequency": "ONE_OFF",
            "start_month": 24,
            "commission_pct": "0.00",
        },
    }

    resp = await api_client.post("/api/v1/audits/calculate", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    audit = data["audit_result"]
    assert audit["total_combinations_evaluated"] == 16
    assert set(audit["scenario_c_optimal"]["accepted_product_ids"]) == {"nomina", "hogar"}
    assert audit["verdict"]["net_savings_vs_all_bonified_eur"] == "42864.97"

    early = data["early_repayment_result"]
    assert early is not None
    assert early["recommended_strategy"] == "REDUCE_TERM"
    assert early["reduce_term"]["months_saved"] > 25


async def test_combinatorial_2_pow_n_protection_rejects_more_than_12_products(
    api_client: AsyncClient,
) -> None:
    """
    Indicación técnica #2:
    Verifica que enviar más de 12 productos vinculados devuelve HTTP 422 Unprocessable Entity
    para proteger el backend contra explosión combinatoria 2^N.
    """
    offer_dict = get_spanish_mortgage_presets()["fija_tipica_trampa"].model_dump(mode="json")
    offer_dict["linked_products"] = [
        {
            "id": f"prod_{i}",
            "name": f"Producto Vinculado {i}",
            "category": "OTHER",
            "bonus_pct": "0.05",
            "annual_bank_cost_eur": "100.00",
            "annual_market_cost_eur": "0.00",
            "apply_ipc": False,
            "annual_age_increase_pct": "0.00",
        }
        for i in range(13)
    ]

    resp = await api_client.post("/api/v1/audits/calculate", json={"offer": offer_dict})
    assert resp.status_code == 422


async def test_save_and_retrieve_audit_by_slug_and_export_pdf(api_client: AsyncClient) -> None:
    """
    Verifica el flujo completo de:
    1. Guardar una auditoría en base de datos (`POST /api/v1/audits`) obteniendo un `slug` único.
    2. Recuperar el snapshot inmutable por `slug` (`GET /api/v1/audits/{slug}`).
    3. Descargar el informe comparativo en PDF por `slug` (`GET /api/v1/audits/{slug}/pdf`)
       y de forma directa (`POST /api/v1/audits/pdf`), comprobando la cabecera `%PDF-`.
    4. Comprobar respuesta 404 para `slug` inexistente.
    """
    offer_dict = get_spanish_mortgage_presets()["fija_tipica_trampa"].model_dump(mode="json")
    payload = {
        "offer": offer_dict,
        "early_repayment_config": {
            "amount_eur": "10000.00",
            "frequency": "ONE_OFF",
            "start_month": 36,
            "commission_pct": "0.15",
        },
    }

    # 1. Crear y guardar auditoría
    create_resp = await api_client.post("/api/v1/audits", json=payload)
    assert create_resp.status_code == 201
    created = create_resp.json()
    slug = created["slug"]
    assert isinstance(slug, str) and len(slug) > 8
    assert created["audit_result"]["verdict"]["net_savings_vs_all_bonified_eur"] == "42864.97"

    # 2. Recuperar auditoría por slug
    get_resp = await api_client.get(f"/api/v1/audits/{slug}")
    assert get_resp.status_code == 200
    fetched = get_resp.json()
    assert fetched["slug"] == slug
    assert fetched["id"] == created["id"]
    assert fetched["audit_result"]["scenario_c_optimal"]["total_cost_eur"] == "360015.40"
    assert fetched["early_repayment_result"]["config"]["amount_eur"] == "10000.00"

    # 3. Descargar PDF de la auditoría guardada por slug
    pdf_slug_resp = await api_client.get(f"/api/v1/audits/{slug}/pdf")
    assert pdf_slug_resp.status_code == 200
    assert pdf_slug_resp.headers["content-type"] == "application/pdf"
    assert f"valuriq-auditoria-{slug}.pdf" in pdf_slug_resp.headers.get("content-disposition", "")
    assert pdf_slug_resp.content.startswith(b"%PDF-")
    assert len(pdf_slug_resp.content) > 2000

    # 4. Descargar PDF directo sin persistencia
    pdf_direct_resp = await api_client.post("/api/v1/audits/pdf", json=payload)
    assert pdf_direct_resp.status_code == 200
    assert pdf_direct_resp.headers["content-type"] == "application/pdf"
    assert pdf_direct_resp.content.startswith(b"%PDF-")
    assert len(pdf_direct_resp.content) > 2000

    # 5. Slug inexistente devuelve 404
    not_found_resp = await api_client.get("/api/v1/audits/slug-no-existente-0000")
    assert not_found_resp.status_code == 404

    not_found_pdf_resp = await api_client.get("/api/v1/audits/slug-no-existente-0000/pdf")
    assert not_found_pdf_resp.status_code == 404


async def test_early_repayment_simulation_endpoint(api_client: AsyncClient) -> None:
    """Verifica el endpoint dedicado `POST /api/v1/audits/early-repayment`."""
    offer_dict = get_spanish_mortgage_presets()["mixta_5_anos"].model_dump(mode="json")
    payload = {
        "offer": offer_dict,
        "config": {
            "amount_eur": "3000.00",
            "frequency": "ANNUAL",
            "start_month": 12,
            "end_month": 120,
            "commission_pct": "0.25",
        },
        "accepted_product_ids": ["nomina", "hogar"],
    }

    resp = await api_client.post("/api/v1/audits/early-repayment", json=payload)
    assert resp.status_code == 200
    result = resp.json()
    assert result["recommended_strategy"] == "REDUCE_TERM"
    assert result["reduce_term"]["total_early_repaid_eur"] == "30000.00"
    assert result["reduce_term"]["total_commission_paid_eur"] == "75.00"


async def test_dynamic_strategy_and_puf_endpoints(api_client: AsyncClient) -> None:
    """
    Verifica el endpoint `POST /api/v1/audits/dynamic-strategy` y la integración de PUF
    en `POST /api/v1/audits/calculate`.
    """
    presets = get_spanish_mortgage_presets()

    # 1. Endpoint dedicado de desvinculación dinámica
    fija_dict = presets["fija_tipica_trampa"].model_dump(mode="json")
    dyn_resp = await api_client.post("/api/v1/audits/dynamic-strategy", json={"offer": fija_dict})
    assert dyn_resp.status_code == 200
    dyn_data = dyn_resp.json()
    assert dyn_data["total_years"] == 30
    assert float(dyn_data["extra_savings_vs_static_optimum_eur"]) > 500.0
    assert len(dyn_data["product_strategies"]) == 4

    # 2. Cálculo completo sobre preset con Prima Única Financiada (PUF)
    puf_dict = presets["fija_trampa_puf"].model_dump(mode="json")
    calc_resp = await api_client.post("/api/v1/audits/calculate", json={"offer": puf_dict})
    assert calc_resp.status_code == 200
    calc_data = calc_resp.json()
    scen_a = calc_data["audit_result"]["scenario_a_all_bonified"]
    assert scen_a["puf_financed_amount_eur"] == "12000.00"
    assert scen_a["financed_principal_eur"] == "232000.00"
    assert float(scen_a["puf_extra_interest_eur"]) > 5000.0
    assert calc_data["dynamic_strategy"] is not None


async def test_etapa2_regions_day_one_costs_stress_test_and_bank_battle_endpoints(
    api_client: AsyncClient,
) -> None:
    """
    Verifica los endpoints REST de ETAPA 2:
    1. `GET /api/v1/tools/regions` y `POST /api/v1/tools/day-one-costs`
    2. `POST /api/v1/audits/stress-test`
    3. `GET /api/v1/presets/battle` y `POST /api/v1/audits/compare` (incluyendo validación 422 si < 2 o > 3).
    """
    # 1. Regiones y Gastos Día 1
    reg_resp = await api_client.get("/api/v1/tools/regions")
    assert reg_resp.status_code == 200
    regions = reg_resp.json()
    assert len(regions) == 19

    day1_resp = await api_client.post(
        "/api/v1/tools/day-one-costs",
        json={
            "property_price_eur": "250000.00",
            "financing_pct": "80.00",
            "region_code": "CATALUNA",
            "property_regime": "SECOND_HAND",
            "apply_young_buyer_reduction": True,
        },
    )
    assert day1_resp.status_code == 200
    day1 = day1_resp.json()
    assert day1["mortgage_principal_eur"] == "200000.00"
    assert day1["down_payment_eur"] == "50000.00"
    assert day1["applied_itp_pct"] == "5.00"
    assert day1["itp_amount_eur"] == "12500.00"
    assert day1["young_buyer_tax_savings_eur"] == "12500.00"

    # 2. Test de Estrés de Euríbor + Tasa de Esfuerzo 35% BdE
    var_offer = get_spanish_mortgage_presets()["variable_agresiva"].model_dump(mode="json")
    stress_resp = await api_client.post(
        "/api/v1/audits/stress-test",
        json={
            "offer": var_offer,
            "monthly_net_household_income_eur": "2800.00",
        },
    )
    assert stress_resp.status_code == 200
    stress_data = stress_resp.json()
    assert len(stress_data["scenarios"]) == 4
    assert stress_data["scenarios"][-1]["exceeds_35_pct_limit"] is True

    # 3. Modo Batalla de Bancos
    battle_presets_resp = await api_client.get("/api/v1/presets/battle")
    assert battle_presets_resp.status_code == 200
    battle_offers = battle_presets_resp.json()
    assert len(battle_offers) == 3

    compare_resp = await api_client.post("/api/v1/audits/compare", json={"offers": battle_offers})
    assert compare_resp.status_code == 200
    comp_data = compare_resp.json()
    assert comp_data["total_offers_compared"] == 3
    assert comp_data["entries"][0]["is_winner"] is True

    # Validación 422 si se envía 1 sola oferta o 4 ofertas
    invalid_1_resp = await api_client.post("/api/v1/audits/compare", json={"offers": [battle_offers[0]]})
    assert invalid_1_resp.status_code == 422

    invalid_4_resp = await api_client.post(
        "/api/v1/audits/compare",
        json={"offers": [battle_offers[0], battle_offers[1], battle_offers[2], battle_offers[0]]},
    )
    assert invalid_4_resp.status_code == 422
