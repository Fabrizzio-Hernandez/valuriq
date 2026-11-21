"""
Modo Batalla de Bancos (Comparador Matemático de 2 a 3 Ofertas Hipotecarias Reales)
para Valuriq.

Enfrenta cara a cara el Escenario Óptimo (C) de cada entidad bancaria (mostrando también
su Escenario A 100% bonificado), coronando al banco ganador por menor Desembolso Total Real.

Arquitectura Limpia:
- Pertenece a `/backend/app/domain/`.
- 100% aritmética `decimal.Decimal` (`ROUND_HALF_UP`), cero `float`, cero dependencias
  de FastAPI o SQLAlchemy.
"""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.dynamic_unlinking import optimize_dynamic_unlinking_strategy
from app.domain.models import (
    CombinationEvaluation,
    DynamicUnlinkingStrategyResult,
    MortgageOfferInput,
    OptimizationVerdict,
)
from app.domain.money import ZERO, round_currency, round_rate
from app.domain.optimizer import format_eur_es, optimize_mortgage_offer


class BankBattleEntry(BaseModel):
    """Resultado individual de un banco dentro de la Batalla de Bancos."""

    model_config = ConfigDict(frozen=True)

    rank: int = Field(..., ge=1, le=3, description="Posición en el podio (1 = Ganador)")
    is_winner: bool
    offer: MortgageOfferInput
    optimal_scenario: CombinationEvaluation = Field(
        ...,
        description="Escenario C (Óptimo Matemático) de este banco",
    )
    all_bonified_scenario: CombinationEvaluation = Field(
        ...,
        description="Escenario A (100% Bonificado) de este banco",
    )
    unbonified_scenario: CombinationEvaluation = Field(
        ...,
        description="Escenario B (Sin vinculaciones) de este banco",
    )
    verdict: OptimizationVerdict
    dynamic_strategy: DynamicUnlinkingStrategyResult
    diff_vs_winner_eur: Decimal = Field(
        ...,
        description="Sobrecoste total frente al banco ganador (0.00 € para el ganador)",
    )
    tae_spread_vs_winner_pct: Decimal = Field(
        ...,
        description="Diferencia de TAE Real respecto al banco ganador (puntos porcentuales)",
    )


class BankBattleComparisonResult(BaseModel):
    """Resultado global de enfrentar de 2 a 3 ofertas hipotecarias en el Modo Batalla."""

    model_config = ConfigDict(frozen=True)

    total_offers_compared: int
    winner_bank_name: str
    winner_offer_name: str
    winner_optimal_total_cost_eur: Decimal
    winner_optimal_tae_real_pct: Decimal
    savings_vs_second_eur: Decimal = Field(
        ...,
        description="Ahorro neto real del ganador frente al 2.º clasificado",
    )
    savings_vs_last_eur: Decimal = Field(
        ...,
        description="Ahorro neto real del ganador frente al último clasificado",
    )
    battle_verdict_headline: str
    battle_verdict_explanation: str
    entries: list[BankBattleEntry]


def compare_mortgage_offers_battle(
    offers: list[MortgageOfferInput],
) -> BankBattleComparisonResult:
    """
    Ejecuta el optimizador combinatorio y de desvinculación dinámica sobre 2 o 3 ofertas
    bancarias y devuelve el podio ordenado por menor Desembolso Total Real en su Escenario Óptimo.
    """
    if len(offers) < 2 or len(offers) > 3:
        raise ValueError("El Modo Batalla requiere comparar entre 2 y 3 ofertas hipotecarias.")

    evaluated_items = []
    for offer in offers:
        audit = optimize_mortgage_offer(offer)
        dyn = optimize_dynamic_unlinking_strategy(offer=offer, static_audit=audit)
        evaluated_items.append((offer, audit, dyn))

    # Ordenar por menor Desembolso Total Real del Escenario Óptimo (C), desempatando por menor TAE Real
    evaluated_items.sort(
        key=lambda item: (
            item[1].scenario_c_optimal.total_cost_eur,
            item[1].scenario_c_optimal.tae_real_pct,
        )
    )

    winner_offer, winner_audit, _ = evaluated_items[0]
    winner_opt = winner_audit.scenario_c_optimal
    winner_cost = winner_opt.total_cost_eur
    winner_tae = winner_opt.tae_real_pct

    entries: list[BankBattleEntry] = []
    for idx, (offer, audit, dyn) in enumerate(evaluated_items, start=1):
        opt = audit.scenario_c_optimal
        diff_eur = round_currency(opt.total_cost_eur - winner_cost)
        tae_diff = round_rate(opt.tae_real_pct - winner_tae)

        entries.append(
            BankBattleEntry(
                rank=idx,
                is_winner=(idx == 1),
                offer=offer,
                optimal_scenario=opt,
                all_bonified_scenario=audit.scenario_a_all_bonified,
                unbonified_scenario=audit.scenario_b_unbonified,
                verdict=audit.verdict,
                dynamic_strategy=dyn,
                diff_vs_winner_eur=diff_eur,
                tae_spread_vs_winner_pct=tae_diff,
            )
        )

    second_entry = entries[1]
    last_entry = entries[-1]
    savings_vs_second = second_entry.diff_vs_winner_eur
    savings_vs_last = last_entry.diff_vs_winner_eur

    headline = (
        f"Ganador Real: {winner_offer.bank_name} ({winner_offer.offer_name}) · "
        f"Ahorras {format_eur_es(savings_vs_second)} frente a {second_entry.offer.bank_name}"
    )

    if len(entries) == 3:
        explanation = (
            f"Tras optimizar las vinculaciones de las 3 entidades, {winner_offer.bank_name} logra el menor "
            f"desembolso total real ({format_eur_es(winner_cost)}) y una TAE Real del "
            f"{str(round_currency(winner_tae)).replace('.', ',')} %. Ahorras {format_eur_es(savings_vs_second)} "
            f"respecto a {second_entry.offer.bank_name} (2.º) y {format_eur_es(savings_vs_last)} "
            f"respecto a {last_entry.offer.bank_name} (3.º)."
        )
    else:
        explanation = (
            f"Comparando el escenario óptimo de ambas entidades, {winner_offer.bank_name} logra un desembolso "
            f"total real de {format_eur_es(winner_cost)} (TAE Real {str(round_currency(winner_tae)).replace('.', ',')} %), "
            f"ahorrando {format_eur_es(savings_vs_second)} netos frente a {second_entry.offer.bank_name}."
        )

    return BankBattleComparisonResult(
        total_offers_compared=len(entries),
        winner_bank_name=winner_offer.bank_name,
        winner_offer_name=winner_offer.offer_name,
        winner_optimal_total_cost_eur=winner_cost,
        winner_optimal_tae_real_pct=winner_tae,
        savings_vs_second_eur=savings_vs_second,
        savings_vs_last_eur=savings_vs_last,
        battle_verdict_headline=headline,
        battle_verdict_explanation=explanation,
        entries=entries,
    )
