"""
Generador de Informes Ejecutivos en PDF para Valuriq (valuriq.com) utilizando ReportLab.

Produce un documento ejecutivo en tamaño A4 libre de dependencias nativas de sistema
(compatible de forma idéntica en Windows, Linux y contenedores Docker), con logotipo
vectorial de Valuriq y pie de página corporativo.
"""

from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO

from reportlab.graphics.shapes import Circle, Drawing, Polygon, Rect
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.domain.models import (
    EarlyRepaymentComparisonResult,
    LinkedProductPaymentMode,
    MortgageAuditResult,
    MortgageType,
)
from app.domain.money import round_rate_2
from app.domain.optimizer import format_eur_es


def _format_pct_es(value: object) -> str:
    quantized = round_rate_2(Decimal(str(value)))
    return str(quantized).replace(".", ",") + " %"


def _format_mortgage_type_es(m_type: MortgageType) -> str:
    mapping = {
        MortgageType.FIXED: "Fija (Sistema Francés)",
        MortgageType.MIXED: "Mixta (Tramo Fijo + Euríbor)",
        MortgageType.VARIABLE: "Variable (Euríbor + Diferencial)",
    }
    return mapping.get(m_type, str(m_type))


def _build_valuriq_logo_drawing() -> Drawing:
    """Construye el isotipo vectorial de Valuriq (V geométrica sobre fondo Obsidiana #0B1120 con acento #10B981)."""
    d = Drawing(28, 28)
    # Fondo redondeado Obsidiana #0B1120
    d.add(
        Rect(
            0,
            0,
            28,
            28,
            rx=6,
            ry=6,
            fillColor=colors.HexColor("#0B1120"),
            strokeColor=colors.HexColor("#1E293B"),
            strokeWidth=0.5,
        )
    )
    # V estilizada blanca
    d.add(
        Polygon(
            [6.5, 20.5, 10.2, 20.5, 14.0, 10.8, 17.8, 20.5, 21.5, 20.5, 15.6, 6.5, 12.4, 6.5],
            fillColor=colors.white,
            strokeColor=colors.white,
            strokeWidth=0,
        )
    )
    # Punto de precisión esmeralda #10B981
    d.add(
        Circle(
            21.2,
            8.2,
            2.1,
            fillColor=colors.HexColor("#10B981"),
            strokeColor=colors.HexColor("#10B981"),
            strokeWidth=0,
        )
    )
    return d


def _draw_footer(canvas: Canvas, doc: SimpleDocTemplate) -> None:
    """Dibuja el pie de página corporativo de Valuriq (valuriq.com) en cada página."""
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#E2E8F0"))
    canvas.setLineWidth(0.5)
    canvas.line(15 * mm, 12 * mm, A4[0] - 15 * mm, 12 * mm)

    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(colors.HexColor("#0B1120"))
    canvas.drawString(15 * mm, 8.2 * mm, "VALURIQ — Auditoría Hipotecaria y TAE Real")

    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawCentredString(
        A4[0] / 2.0,
        8.2 * mm,
        "valuriq.com · Aritmética Financiera Decimal Exacta (Ley 5/2019 LCCI)",
    )
    canvas.drawRightString(A4[0] - 15 * mm, 8.2 * mm, f"Página {doc.page}")
    canvas.restoreState()


def generate_audit_pdf_bytes(
    audit: MortgageAuditResult,
    slug: str | None = None,
    early_repayment: EarlyRepaymentComparisonResult | None = None,
    created_at: datetime | None = None,
) -> bytes:
    """
    Genera en memoria el informe PDF comparativo de una auditoría hipotecaria de Valuriq
    y devuelve los bytes del archivo PDF (`%PDF-...`).
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=16 * mm,
        title=f"Valuriq — Auditoría Hipotecaria y TAE Real — {audit.offer.offer_name}",
        author="Valuriq (valuriq.com)",
    )

    styles = getSampleStyleSheet()
    obsidian = colors.HexColor("#0B1120")
    emerald = colors.HexColor("#059669")
    emerald_bg = colors.HexColor("#ECFDF5")
    slate_border = colors.HexColor("#CBD5E1")
    slate_light = colors.HexColor("#F6F7F9")
    slate_text = colors.HexColor("#475569")

    title_style = ParagraphStyle(
        "ValuriqTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=obsidian,
        spaceAfter=2,
    )
    subtitle_style = ParagraphStyle(
        "ValuriqSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=slate_text,
        spaceAfter=0,
    )
    section_style = ParagraphStyle(
        "ValuriqSection",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13.5,
        textColor=obsidian,
        spaceBefore=8,
        spaceAfter=4,
    )
    verdict_title_style = ParagraphStyle(
        "VerdictTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13.5,
        textColor=emerald,
        spaceAfter=3,
    )
    body_style = ParagraphStyle(
        "ValuriqBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=obsidian,
    )

    story = []

    issue_dt = (created_at or datetime.now(timezone.utc)).strftime("%d/%m/%Y %H:%M UTC")
    slug_label = slug or "auditoria-directa"

    # 1. Cabecera Corporativa Valuriq con Isotipo Vectorial
    header_text = [
        Paragraph("VALURIQ — AUDITORÍA HIPOTECARIA Y TAE REAL", title_style),
        Paragraph(
            f"<b>Oferta:</b> {audit.offer.offer_name} &nbsp;|&nbsp; "
            f"<b>Entidad:</b> {audit.offer.bank_name} &nbsp;|&nbsp; "
            f"<b>Ref:</b> {slug_label} &nbsp;|&nbsp; "
            f"<b>Emisión:</b> {issue_dt}",
            subtitle_style,
        ),
    ]
    header_table = Table(
        [[_build_valuriq_logo_drawing(), header_text]],
        colWidths=[12 * mm, 168 * mm],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(header_table)

    # 2. Parámetros base del préstamo
    offer = audit.offer
    params_data = [
        [
            "Capital Prestado",
            format_eur_es(offer.principal_eur),
            "Plazo Total",
            f"{offer.term_months // 12} años ({offer.term_months} meses)",
        ],
        [
            "Modalidad",
            _format_mortgage_type_es(offer.mortgage_type),
            "TIN Base (sin bonificar)",
            _format_pct_es(offer.base_tin_pct),
        ],
        [
            "Gastos Iniciales (t=0)",
            format_eur_es(offer.total_initial_expenses_eur),
            "Escenarios Auditados",
            f"{audit.total_combinations_evaluated} combinaciones",
        ],
    ]
    params_table = Table(params_data, colWidths=[40 * mm, 44 * mm, 52 * mm, 44 * mm])
    params_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), slate_light),
                ("TEXTCOLOR", (0, 0), (-1, -1), obsidian),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.5, slate_border),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(params_table)
    story.append(Spacer(1, 5))

    # 3. Tarjeta de Veredicto Ejecutivo
    v = audit.verdict
    clean_headline = v.headline.replace("->", "·")
    verdict_content = [
        [Paragraph(f"VEREDICTO VALURIQ: {clean_headline}", verdict_title_style)],
        [Paragraph(v.explanation, body_style)],
        [
            Paragraph(
                f"<b>Ahorro Neto vs. 100% Bonificada:</b> {format_eur_es(v.net_savings_vs_all_bonified_eur)} &nbsp;&nbsp;|&nbsp;&nbsp; "
                f"<b>Ahorro vs. Sin Bonificar:</b> {format_eur_es(v.net_savings_vs_unbonified_eur)} &nbsp;&nbsp;|&nbsp;&nbsp; "
                f"<b>Sobrecoste TAE Oculta Banco:</b> +{_format_pct_es(v.hidden_tae_spread_pct)}",
                body_style,
            )
        ],
    ]
    verdict_table = Table(verdict_content, colWidths=[180 * mm])
    verdict_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), emerald_bg),
                ("BOX", (0, 0), (-1, -1), 1.0, emerald),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(verdict_table)

    # 4. Tabla comparativa de los 3 Escenarios (A, B y C)
    story.append(
        Paragraph("1. Comparativa de Escenarios (100% Bonificada vs. Sin Vincular vs. Óptimo Valuriq)", section_style)
    )

    sa = audit.scenario_a_all_bonified
    sb = audit.scenario_b_unbonified
    sc = audit.scenario_c_optimal

    comp_rows = [
        [
            "Métrica Financiera",
            "Escenario A\n(100% Bonificado Banco)",
            "Escenario B\n(Sin Vinculaciones)",
            "Escenario C\n(Óptimo Valuriq)",
        ],
        [
            "TIN Efectivo Inicial",
            _format_pct_es(sa.effective_initial_tin_pct),
            _format_pct_es(sb.effective_initial_tin_pct),
            _format_pct_es(sc.effective_initial_tin_pct),
        ],
        [
            "Cuota Hipotecaria Mensual",
            format_eur_es(sa.initial_monthly_payment_eur),
            format_eur_es(sb.initial_monthly_payment_eur),
            format_eur_es(sc.initial_monthly_payment_eur),
        ],
        [
            "Desembolso Mensual Real (Año 1)",
            format_eur_es(sa.initial_total_monthly_outflow_eur),
            format_eur_es(sb.initial_total_monthly_outflow_eur),
            format_eur_es(sc.initial_total_monthly_outflow_eur),
        ],
        [
            "Intereses Totales Préstamo",
            format_eur_es(sa.total_interest_eur),
            format_eur_es(sb.total_interest_eur),
            format_eur_es(sc.total_interest_eur),
        ],
        [
            "Coste Total en Vinculaciones/Seguros",
            format_eur_es(sa.total_linked_cost_eur),
            format_eur_es(sb.total_linked_cost_eur),
            format_eur_es(sc.total_linked_cost_eur),
        ],
        [
            "Sobrecoste Vinculaciones vs. Mercado",
            format_eur_es(sa.total_linked_overcost_eur),
            format_eur_es(sb.total_linked_overcost_eur),
            format_eur_es(sc.total_linked_overcost_eur),
        ],
        [
            "DESEMBOLSO TOTAL REAL",
            format_eur_es(sa.total_cost_eur),
            format_eur_es(sb.total_cost_eur),
            format_eur_es(sc.total_cost_eur),
        ],
        [
            "TAE REAL OCULTA (TIR)",
            _format_pct_es(sa.tae_real_pct),
            _format_pct_es(sb.tae_real_pct),
            _format_pct_es(sc.tae_real_pct),
        ],
        [
            "Ahorro Neto vs. Escenario A",
            format_eur_es(sa.savings_vs_all_bonified_eur),
            format_eur_es(sb.savings_vs_all_bonified_eur),
            format_eur_es(sc.savings_vs_all_bonified_eur),
        ],
    ]

    comp_table = Table(comp_rows, colWidths=[60 * mm, 40 * mm, 40 * mm, 40 * mm])
    comp_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), obsidian),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("BACKGROUND", (3, 1), (3, -1), emerald_bg),
                ("FONTNAME", (0, 7), (-1, 9), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, slate_border),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(comp_table)

    # 5. Desglose de Productos Vinculados y Decisión Óptima
    if offer.linked_products:
        story.append(Paragraph("2. Auditoría Individual de Productos Vinculados", section_style))
        accepted_opt = set(sc.accepted_product_ids)
        prod_rows = [
            [
                "Producto Vinculado",
                "Bonif. TIN",
                "Coste Banco/Año",
                "Mercado Libre/Año",
                "Escala Anual",
                "Decisión Valuriq",
            ]
        ]
        for prod in offer.linked_products:
            decision = "ACEPTAR (Banco)" if prod.id in accepted_opt else "RECHAZAR (Externo)"
            growth_parts = []
            if prod.apply_ipc:
                growth_parts.append(f"IPC {_format_pct_es(offer.estimated_ipc_pct)}")
            if prod.annual_age_increase_pct > 0:
                growth_parts.append(f"+Edad {_format_pct_es(prod.annual_age_increase_pct)}")
            growth_label = " ".join(growth_parts) if growth_parts else "Fijo (0%)"

            if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED:
                bank_cost_label = (
                    f"PUF: {format_eur_es(prod.puf_amount_eur)} ({prod.puf_coverage_years} años)"
                )
            else:
                bank_cost_label = format_eur_es(prod.annual_bank_cost_eur)

            prod_rows.append(
                [
                    Paragraph(prod.name, body_style),
                    f"-{_format_pct_es(prod.bonus_pct)}",
                    bank_cost_label,
                    format_eur_es(prod.annual_market_cost_eur),
                    growth_label,
                    decision,
                ]
            )

        prod_table = Table(prod_rows, colWidths=[44 * mm, 18 * mm, 26 * mm, 28 * mm, 34 * mm, 30 * mm])
        prod_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), obsidian),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (1, 1), (3, -1), "RIGHT"),
                    ("ALIGN", (4, 1), (5, -1), "CENTER"),
                    ("GRID", (0, 0), (-1, -1), 0.5, slate_border),
                    ("PADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(prod_table)

    # 6. Si hay simulación de amortización anticipada, añadir resumen comparativo
    if early_repayment is not None:
        story.append(
            Paragraph("3. Simulación de Amortización Anticipada (Reducir Cuota vs. Reducir Plazo)", section_style)
        )
        rp = early_repayment.reduce_payment
        rt = early_repayment.reduce_term
        er_rows = [
            ["Métrica", "Reducir Cuota", "Reducir Plazo (Recomendado)"],
            ["Total Amortizado Anticipadamente", format_eur_es(rp.total_early_repaid_eur), format_eur_es(rt.total_early_repaid_eur)],
            ["Comisión por Amortización Anticipada", format_eur_es(rp.total_commission_paid_eur), format_eur_es(rt.total_commission_paid_eur)],
            ["Nuevo Plazo Total", f"{rp.new_term_months} meses", f"{rt.new_term_months} meses (-{rt.months_saved} m)"],
            ["Cuota Mensual Tras 1ª Amortización", format_eur_es(rp.monthly_payment_after_first_repayment_eur), format_eur_es(rt.monthly_payment_after_first_repayment_eur)],
            ["Ahorro Neto en Intereses", format_eur_es(rp.net_savings_eur), format_eur_es(rt.net_savings_eur)],
        ]
        er_table = Table(er_rows, colWidths=[70 * mm, 55 * mm, 55 * mm])
        er_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), obsidian),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                    ("BACKGROUND", (2, 1), (2, -1), emerald_bg),
                    ("GRID", (0, 0), (-1, -1), 0.5, slate_border),
                    ("PADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(er_table)

    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)
    return buffer.getvalue()
