import { Injectable, signal } from '@angular/core';

import {
  BankBattleComparisonResult,
  DayOneCostsResult,
  DynamicUnlinkingStrategyResult,
  EarlyRepaymentComparisonResult,
  EarlyRepaymentConfig,
  MortgageAuditResult,
  MortgageOfferInput,
  PresetItemResponse
} from '../models/mortgage.models';

export const DEFAULT_VALURIQ_OFFER: MortgageOfferInput = {
  offer_name: 'Oferta típica Fija 2.60% bonificada vs 3.40% base',
  bank_name: 'Banco Tradicional Español',
  principal_eur: '220000.00',
  term_months: 360,
  mortgage_type: 'FIXED',
  base_tin_pct: '3.40',
  fixed_years: 0,
  euribor_pct: '2.50',
  differential_pct: '1.00',
  min_tin_floor_pct: '0.00',
  opening_commission_pct: '0.00',
  appraisal_cost_eur: '450.00',
  other_initial_expenses_eur: '0.00',
  estimated_ipc_pct: '2.00',
  linked_products: [
    {
      id: 'nomina',
      name: 'Domiciliación de Nómina',
      category: 'PAYROLL',
      bonus_pct: '0.30',
      annual_bank_cost_eur: '0.00',
      annual_market_cost_eur: '0.00',
      apply_ipc: false,
      annual_age_increase_pct: '0.00',
      payment_mode: 'ANNUAL',
      puf_amount_eur: '0.00',
      puf_coverage_years: 10
    },
    {
      id: 'hogar',
      name: 'Seguro de Hogar',
      category: 'HOME_INSURANCE',
      bonus_pct: '0.15',
      annual_bank_cost_eur: '310.00',
      annual_market_cost_eur: '195.00',
      apply_ipc: true,
      annual_age_increase_pct: '0.00',
      payment_mode: 'ANNUAL',
      puf_amount_eur: '0.00',
      puf_coverage_years: 10
    },
    {
      id: 'vida',
      name: 'Seguro de Vida',
      category: 'LIFE_INSURANCE',
      bonus_pct: '0.25',
      annual_bank_cost_eur: '680.00',
      annual_market_cost_eur: '210.00',
      apply_ipc: true,
      annual_age_increase_pct: '3.50',
      payment_mode: 'ANNUAL',
      puf_amount_eur: '0.00',
      puf_coverage_years: 10
    },
    {
      id: 'alarma',
      name: 'Alarma Securitas / Prosegur',
      category: 'ALARM',
      bonus_pct: '0.10',
      annual_bank_cost_eur: '580.00',
      annual_market_cost_eur: '0.00',
      apply_ipc: true,
      annual_age_increase_pct: '0.00',
      payment_mode: 'ANNUAL',
      puf_amount_eur: '0.00',
      puf_coverage_years: 10
    }
  ]
};

/**
 * Store global reactivo con Angular Signals para compartir el contexto financiero
 * entre las 5 páginas de Valuriq (/ , /gastos-compra, /auditor, /comparar, /amortizacion)
 * sin obligar al usuario a reescribir datos.
 */
@Injectable({
  providedIn: 'root'
})
export class ValuriqWorkspaceService {
  readonly presetsCatalog = signal<PresetItemResponse[]>([]);
  readonly activeOffer = signal<MortgageOfferInput>(structuredClone(DEFAULT_VALURIQ_OFFER));
  readonly activePresetId = signal<string | null>('fija_tipica_trampa');
  readonly activeSlug = signal<string | null>(null);

  readonly lastAuditResult = signal<MortgageAuditResult | null>(null);
  readonly lastDynamicStrategy = signal<DynamicUnlinkingStrategyResult | null>(null);
  readonly lastEarlyRepaymentResult = signal<EarlyRepaymentComparisonResult | null>(null);
  readonly activeEarlyRepaymentConfig = signal<EarlyRepaymentConfig | null>(null);

  readonly monthlyNetHouseholdIncomeEur = signal<string>('3500');
  readonly lastDayOneResult = signal<DayOneCostsResult | null>(null);
  readonly hasCustomAuditorContext = signal<boolean>(false);

  readonly battleOffers = signal<MortgageOfferInput[]>([]);
  readonly lastBattleResult = signal<BankBattleComparisonResult | null>(null);

  /**
   * Traslada el capital hipotecario y gastos calculados en `/gastos-compra`
   * directamente a la oferta activa del auditor (`/auditor`).
   */
  applyDayOneResultToActiveOffer(dayOne: DayOneCostsResult): void {
    this.lastDayOneResult.set(dayOne);
    const current = structuredClone(this.activeOffer());
    current.principal_eur = dayOne.mortgage_principal_eur;
    current.appraisal_cost_eur = dayOne.appraisal_cost_eur;
    this.activeOffer.set(current);
    this.activePresetId.set(null);
    this.activeSlug.set(null);
    this.hasCustomAuditorContext.set(true);
  }

  /**
   * Actualiza la oferta activa cuando el usuario edita en `/auditor` o `/amortizacion`.
   */
  updateActiveOffer(offer: MortgageOfferInput): void {
    this.activeOffer.set(structuredClone(offer));
    this.hasCustomAuditorContext.set(true);
  }

  /**
   * Promociona la oferta activa del auditor como Oferta #1 (Banco 1) en `/comparar`.
   */
  promoteActiveOfferToBattle(): void {
    const current = structuredClone(this.activeOffer());
    const existing = [...this.battleOffers()];
    if (existing.length >= 2) {
      existing[0] = current;
      this.battleOffers.set(existing);
    } else {
      this.battleOffers.set([current]);
    }
  }
}
