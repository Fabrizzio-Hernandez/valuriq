# Valuriq (`valuriq.com`) — Auditoría Hipotecaria y TAE Real para España

**Valuriq** es una plataforma fintech Full-Stack de auditoría hipotecaria diseñada para el mercado español bajo la **Ley 5/2019 Reguladora de los Contratos de Crédito Inmobiliario (LCCI)**. Su motor financiero puro en Python (`decimal.Decimal` con redondeo bancario `ROUND_HALF_UP`, prohibido `float`) audita todas las combinaciones posibles de vinculaciones ($2^N$), detecta **Primas Únicas Financiadas (PUF)** sumadas al capital, calcula en qué año exacto conviene cancelar cada seguro (**Desvinculación Dinámica**) y enfrenta hasta 3 ofertas bancarias por su **Escenario Óptimo (C)**.

---

## 1. Arquitectura Multipágina con Lazy Loading (Angular 19 + Signals)

El frontend de **Valuriq** aplica **divulgación progresiva** mediante 5 rutas independientes con **Lazy Loading** (`loadComponent`), conectadas por un store reactivo en memoria (`ValuriqWorkspaceService`) para que el usuario nunca tenga que reescribir sus datos al saltar entre herramientas:

| Ruta | Título de Página | Propósito y Funcionalidad |
| :--- | :--- | :--- |
| `/` | `Valuriq — Auditoría Hipotecaria y TAE Real` | **Hub de Decisión Hipotecaria:** Portada ejecutiva con las 4 herramientas del comprador de vivienda en España y barra de garantías técnicas. |
| `/gastos-compra` | `Valuriq \| Gastos de Compra Día 1` | **Calculadora "Dinero Real el Día 1":** Calcula entrada + impuestos autonómicos (**17 CCAA + Ceuta y Melilla**: ITP general y reducido joven, IVA 10 % / IGIC 7 % / IPSI 4 % + AJD, y VPO) + gastos de formalización (Notaría, Registro, Gestoría, Tasación, Inmobiliaria). Botón de 1 clic para auditar la hipoteca resultante en `/auditor`. |
| `/auditor` y `/audit/:slug` | `Valuriq \| Auditor Hipotecario` | **Auditor de Vinculaciones, PUF y TAE Real:** Presets instantáneos, acordeones colapsables de vinculaciones (hasta 12 productos, pago anual o **PUF financiada**), Hero Card de veredicto y 3 pestañas analíticas bajo demanda: *(1) Veredicto & Plan por Años*, *(2) Gráficas & Comparativa*, *(3) Esfuerzo 35 % BdE & Cuadro Francés Completo*. |
| `/comparar` | `Valuriq \| Batalla de Bancos` | **Batalla de Bancos (2 a 3 Ofertas):** Compara ofertas de distintas entidades enfrentando sus respectivos **Escenarios Óptimos (C)** a ancho completo, con preset de 3 bancos en 1 clic, gráfica apilada Chart.js y **Drawer lateral (Slide-over)** para editar cualquier banco bajo demanda. |
| `/amortizacion` | `Valuriq \| Amortización Anticipada` | **Simulador de Amortización Anticipada (Ley 5/2019):** Hereda automáticamente la hipoteca activa (con edición rápida en 3 campos) y compara matemáticamente **Reducir Plazo vs. Reducir Cuota** en aportaciones puntuales o periódicas. |

---

## 2. Armas Matemáticas del Motor Financiero (`/backend/app/domain`)

El paquete `/backend/app/domain` cumple **Clean Architecture estricta** (0 imports de FastAPI, SQLAlchemy o librerías HTTP, verificado mediante test AST):

1. **Aritmética Decimal Exacta (`money.py`):**
   - Prohibición total de `float` (validada en runtime y por Pydantic v2).
   - Cuadro de amortización francés mes a mes (`1..N`) para hipotecas **Fijas**, **Mixtas** (recálculo de cuota al pasar a tramo Euríbor + diferencial) y **Variables**, con ajuste exacto de céntimos en la última cuota (`remaining_balance_eur == Decimal("0.00")`).
2. **Detector de Prima Única Financiada — PUF (`optimizer.py`):**
   - Cuando una vinculación se configura como `payment_mode="PUF_FINANCED"`, el motor suma `puf_amount_eur` al capital financiado del préstamo y cuantifica al céntimo los intereses compuestos extra que el banco cobra durante 30 años sobre el propio seguro (`puf_extra_interest_eur`).
3. **Optimizador Combinatorio $2^N$ y TAE Real Oculta (`optimizer.py` + `irr.py`):**
   - Evalúa las $2^N$ combinaciones de productos vinculados ($N \le 12$, hasta 4.096 escenarios) considerando inflación compuesta (IPC) y progresión anual por edad en seguros de vida.
   - Calcula la **TAE Real Oculta (TIR)** mediante **Newton-Raphson con fallback automático a Bisección** sobre los 360 flujos de caja mensuales reales.
4. **Optimizador de Desvinculación Dinámica por Años (`dynamic_unlinking.py`):**
   - Evalúa año a año el ahorro de intereses generado por la bonificación sobre el saldo vivo decreciente frente al sobrecoste creciente del seguro respecto al mercado libre, indicando el año exacto de corte (`"Mantener Años 1–11 · Cancelar en Año 12"`).
5. **Calculadora Fiscal Autonómica Día 1 (`day_one_costs.py`):**
   - Reglas fiscales de los **19 territorios españoles** (17 CCAA + Ceuta y Melilla) para 2.ª mano (ITP general y tipo reducido joven), Obra Nueva (IVA/IGIC/IPSI + AJD) y VPO.
6. **Termómetro de Riesgo 35 % Banco de España y Test de Estrés de Euríbor (`stress_test.py`):**
   - Clasifica la tasa de esfuerzo familiar en `HEALTHY` ($\le 30\%$), `TIGHT` ($30\%\text{–}35\%$) o `RISK` ($> 35\%$), proyecta choques de Euríbor al `2 %`, `3 %`, `4 %` y `5 %` y despeja el **Euríbor crítico exacto** que supera el límite del 35 %.
7. **Comparador Multi-Oferta "Batalla de Bancos" (`comparison.py`):**
   - Optimiza primero cada banco de forma independiente y los clasifica por el menor desembolso neto total de su **Escenario Óptimo (C)**.

---

## 3. Estructura del Monorepo

```text
.
├── backend/
│   ├── alembic/                        # Migraciones asíncronas PostgreSQL (JSONB) / SQLite
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes.py               # Endpoints REST v1 (/presets, /audits/*, /tools/*)
│   │   │   └── schemas.py              # Contratos Pydantic v2 con límite 2^12 y validación Decimal
│   │   ├── core/config.py              # Configuración Pydantic Settings + CORS_ORIGINS dinámico
│   │   ├── db/                         # Modelos SQLAlchemy 2.0 Async + JSON/JSONB
│   │   ├── domain/                     # NÚCLEO MATEMÁTICO PURO (0 dependencias web/ORM)
│   │   │   ├── comparison.py           # Modo Batalla de Bancos (2 a 3 ofertas)
│   │   │   ├── day_one_costs.py        # Calculadora Día 1 (17 CCAA + Ceuta y Melilla)
│   │   │   ├── dynamic_unlinking.py    # Plan óptimo de cancelación de seguros por años
│   │   │   ├── early_repayment.py      # Simulador Reducir Plazo vs. Reducir Cuota
│   │   │   ├── irr.py                  # Solver TIR / TAE Real (Newton-Raphson + Bisección)
│   │   │   ├── models.py               # Entidades inmutables y validadores anti-float
│   │   │   ├── money.py                # Aritmética Decimal ROUND_HALF_UP
│   │   │   ├── optimizer.py            # Motor combinatorio 2^N + soporte PUF
│   │   │   ├── presets.py              # Catálogo de ofertas reales del mercado español
│   │   │   └── stress_test.py          # Termómetro 35% BdE + Test de Estrés de Euríbor
│   │   ├── services/
│   │   │   ├── audit_service.py        # Persistencia de snapshots por slug único
│   │   │   └── pdf_service.py          # Generador de informes ejecutivos A4 en ReportLab
│   │   └── main.py                     # Factoría FastAPI + OpenAPI Valuriq
│   └── tests/                          # 49 tests unitarios, paramétricos y de integración API
├── frontend/
│   ├── public/
│   │   ├── _redirects                  # Regla SPA (/* /index.html 200) para Cloudflare Pages
│   │   └── favicon.svg                 # Isotipo vectorial de Valuriq (#0B1120 + #10B981)
│   ├── src/app/
│   │   ├── core/
│   │   │   ├── layout/navbar.component.ts
│   │   │   ├── models/mortgage.models.ts
│   │   │   ├── services/valuriq-api.service.ts
│   │   │   ├── services/valuriq-workspace.service.ts
│   │   │   └── utils/decimal-format.ts
│   │   ├── features/
│   │   │   ├── home/home-hub-page.component.ts
│   │   │   ├── day-one/day-one-costs-page.component.ts
│   │   │   ├── auditor/auditor-page.component.ts
│   │   │   ├── battle/bank-battle-page.component.ts
│   │   │   └── amortization/early-repayment-page.component.ts
│   │   ├── app.config.ts               # Router con scrollPositionRestoration: 'top'
│   │   └── app.routes.ts               # 5 rutas con Lazy Loading (loadComponent) y títulos SEO
│   ├── Dockerfile                      # Multi-stage build Node 22 -> Nginx Alpine
│   └── nginx.conf                      # SPA fallback + reverse proxy /api/v1
└── docker-compose.yml                  # Orquestación PostgreSQL 16 + Backend + Frontend
```

---

## 4. Puesta en Marcha y Verificación

### Opción A: Con Docker Compose (Stack Completo con PostgreSQL 16)

```bash
docker compose up --build
```

- **Aplicación Web Valuriq:** `http://localhost:4200` (o `http://localhost:80`)
- **Documentación Interactiva OpenAPI (Swagger UI):** `http://localhost:8000/docs`

### Opción B: Desarrollo Local Rápido (Backend + Frontend)

1. **Backend FastAPI + Suite de 49 Tests (`pytest`):**
   ```bash
   cd backend
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -e ".[dev]"
   pytest -v
   uvicorn app.main:app --reload --port 8000
   ```

2. **Frontend Angular 19:**
   ```bash
   cd frontend
   npm install
   npm start
   ```

---

## 5. Despliegue en Producción (Cloudflare Pages + API Docker FastAPI & PostgreSQL Serverless)

- **Frontend estático en Cloudflare Pages (`valuriq.com`):**
  - Comando de build: `npm run build`
  - Directorio de salida: `dist/hiporeal-frontend/browser`
  - Incluye `frontend/public/_redirects` (`/* /index.html 200`) copiado automáticamente en el bundle final para que todas las rutas SPA (`/gastos-compra`, `/auditor`, `/audit/:slug`, `/comparar`, `/amortizacion`) resuelvan sin errores 404.
- **Backend FastAPI en Docker + PostgreSQL Serverless (Neon / Supabase / Cloud):**
  - El contenedor `backend/Dockerfile` ejecuta `alembic upgrade head` automáticamente al arrancar mediante `entrypoint.sh`.
  - Normaliza automáticamente cadenas `postgres://` o `postgresql://` al driver asíncrono `postgresql+asyncpg://`, limpia parámetros de query string incompatibles con `asyncpg` (`sslmode`, `channel_binding`) y activa `NullPool` con `statement_cache_size=0` para compatibilidad con poolers serverless.
  - Orígenes CORS configurables mediante la variable de entorno `CORS_ORIGINS` (acepta formato JSON o lista separada por comas).

---

## Licencia

*Código público con fines de auditoría técnica y portfolio. Todos los derechos reservados (All Rights Reserved) — no se autoriza su uso, copia o explotación comercial sin permiso expreso.*
