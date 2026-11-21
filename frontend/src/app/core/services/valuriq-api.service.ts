import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  AuditCalculationRequest,
  AuditCalculationResponse,
  BankBattleComparisonResult,
  DayOneCostsInput,
  DayOneCostsResult,
  DynamicUnlinkingStrategyResult,
  EarlyRepaymentComparisonResult,
  EarlyRepaymentConfig,
  EarlyRepaymentSimulationRequest,
  MortgageOfferInput,
  PresetItemResponse,
  RegionTaxRule,
  SavedAuditResponse,
  StressTestResult
} from '../models/mortgage.models';
import {
  serializeEarlyRepaymentConfig,
  serializeOfferPayload,
  toDecimalString
} from '../utils/decimal-format';

@Injectable({
  providedIn: 'root'
})
export class ValuriqApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  /**
   * Obtiene el catálogo de presets del mercado hipotecario español (`GET /api/v1/presets`).
   */
  getPresets(): Observable<PresetItemResponse[]> {
    return this.http.get<PresetItemResponse[]>(`${this.baseUrl}/presets`);
  }

  /**
   * Ejecuta el optimizador combinatorio en tiempo real sin persistir (`POST /api/v1/audits/calculate`).
   * Serializa todos los importes y tipos de interés como `string` Decimal.
   */
  calculateAudit(
    offer: MortgageOfferInput,
    earlyRepaymentConfig?: EarlyRepaymentConfig | null
  ): Observable<AuditCalculationResponse> {
    const payload: AuditCalculationRequest = {
      offer: serializeOfferPayload(offer),
      early_repayment_config: earlyRepaymentConfig
        ? serializeEarlyRepaymentConfig(earlyRepaymentConfig)
        : null
    };
    return this.http.post<AuditCalculationResponse>(
      `${this.baseUrl}/audits/calculate`,
      payload
    );
  }

  /**
   * Ejecuta y persiste una auditoría inmutable con `slug` único (`POST /api/v1/audits`).
   */
  saveAudit(
    offer: MortgageOfferInput,
    earlyRepaymentConfig?: EarlyRepaymentConfig | null
  ): Observable<SavedAuditResponse> {
    const payload: AuditCalculationRequest = {
      offer: serializeOfferPayload(offer),
      early_repayment_config: earlyRepaymentConfig
        ? serializeEarlyRepaymentConfig(earlyRepaymentConfig)
        : null
    };
    return this.http.post<SavedAuditResponse>(`${this.baseUrl}/audits`, payload);
  }

  /**
   * Recupera una auditoría guardada por su `slug` único (`GET /api/v1/audits/{slug}`).
   */
  getAuditBySlug(slug: string): Observable<SavedAuditResponse> {
    return this.http.get<SavedAuditResponse>(
      `${this.baseUrl}/audits/${encodeURIComponent(slug)}`
    );
  }

  /**
   * Calcula el plan óptimo de desvinculación dinámica año a año (`POST /api/v1/audits/dynamic-strategy`).
   */
  calculateDynamicStrategy(
    offer: MortgageOfferInput
  ): Observable<DynamicUnlinkingStrategyResult> {
    return this.http.post<DynamicUnlinkingStrategyResult>(
      `${this.baseUrl}/audits/dynamic-strategy`,
      { offer: serializeOfferPayload(offer) }
    );
  }

  /**
   * Simula amortizaciones anticipadas comparando Reducir Cuota vs Reducir Plazo (`POST /api/v1/audits/early-repayment`).
   */
  simulateEarlyRepayment(
    offer: MortgageOfferInput,
    config: EarlyRepaymentConfig,
    acceptedProductIds?: string[] | null
  ): Observable<EarlyRepaymentComparisonResult> {
    const payload: EarlyRepaymentSimulationRequest = {
      offer: serializeOfferPayload(offer),
      config: serializeEarlyRepaymentConfig(config),
      accepted_product_ids: acceptedProductIds ?? null
    };
    return this.http.post<EarlyRepaymentComparisonResult>(
      `${this.baseUrl}/audits/early-repayment`,
      payload
    );
  }

  /**
   * Obtiene el catálogo de las 17 CCAA + Ceuta y Melilla con sus tipos de ITP y AJD (`GET /api/v1/tools/regions`).
   */
  getSpanishTaxRegions(): Observable<RegionTaxRule[]> {
    return this.http.get<RegionTaxRule[]>(`${this.baseUrl}/tools/regions`);
  }

  /**
   * Calcula el efectivo total necesario en cuenta el Día 1 (`POST /api/v1/tools/day-one-costs`).
   */
  calculateDayOneCosts(input: DayOneCostsInput): Observable<DayOneCostsResult> {
    const payload: DayOneCostsInput = {
      property_price_eur: toDecimalString(input.property_price_eur, 2, '250000.00'),
      financing_pct: toDecimalString(input.financing_pct, 2, '80.00'),
      region_code: input.region_code || 'MADRID',
      property_regime: input.property_regime || 'SECOND_HAND',
      apply_young_buyer_reduction: Boolean(input.apply_young_buyer_reduction),
      notary_cost_eur:
        input.notary_cost_eur !== null && input.notary_cost_eur !== undefined && String(input.notary_cost_eur).trim() !== ''
          ? toDecimalString(input.notary_cost_eur, 2, '850.00')
          : null,
      registry_cost_eur:
        input.registry_cost_eur !== null && input.registry_cost_eur !== undefined && String(input.registry_cost_eur).trim() !== ''
          ? toDecimalString(input.registry_cost_eur, 2, '480.00')
          : null,
      gestoria_cost_eur: toDecimalString(input.gestoria_cost_eur, 2, '400.00'),
      appraisal_cost_eur: toDecimalString(input.appraisal_cost_eur, 2, '450.00'),
      real_estate_agency_fee_eur: toDecimalString(input.real_estate_agency_fee_eur, 2, '0.00')
    };
    return this.http.post<DayOneCostsResult>(
      `${this.baseUrl}/tools/day-one-costs`,
      payload
    );
  }

  /**
   * Ejecuta el Test de Estrés de Euríbor y Tasa de Esfuerzo 35% BdE (`POST /api/v1/audits/stress-test`).
   */
  runStressTest(
    offer: MortgageOfferInput,
    monthlyNetIncomeEur: string | number,
    acceptedProductIds?: string[] | null
  ): Observable<StressTestResult> {
    return this.http.post<StressTestResult>(`${this.baseUrl}/audits/stress-test`, {
      offer: serializeOfferPayload(offer),
      monthly_net_household_income_eur: toDecimalString(monthlyNetIncomeEur, 2, '3500.00'),
      accepted_product_ids: acceptedProductIds ?? null
    });
  }

  /**
   * Obtiene las 3 ofertas bancarias realistas para el Modo Batalla (`GET /api/v1/presets/battle`).
   */
  getBattlePresets(): Observable<MortgageOfferInput[]> {
    return this.http.get<MortgageOfferInput[]>(`${this.baseUrl}/presets/battle`);
  }

  /**
   * Ejecuta el Modo Batalla de Bancos entre 2 o 3 ofertas (`POST /api/v1/audits/compare`).
   */
  compareBankOffers(
    offers: MortgageOfferInput[]
  ): Observable<BankBattleComparisonResult> {
    return this.http.post<BankBattleComparisonResult>(
      `${this.baseUrl}/audits/compare`,
      {
        offers: offers.slice(0, 3).map((o) => serializeOfferPayload(o))
      }
    );
  }

  /**
   * Descarga el informe comparativo en PDF al vuelo (`POST /api/v1/audits/pdf`).
   */
  downloadDirectPdf(
    offer: MortgageOfferInput,
    earlyRepaymentConfig?: EarlyRepaymentConfig | null
  ): Observable<HttpResponse<Blob>> {
    const payload: AuditCalculationRequest = {
      offer: serializeOfferPayload(offer),
      early_repayment_config: earlyRepaymentConfig
        ? serializeEarlyRepaymentConfig(earlyRepaymentConfig)
        : null
    };
    return this.http.post(`${this.baseUrl}/audits/pdf`, payload, {
      observe: 'response',
      responseType: 'blob'
    });
  }

  /**
   * Descarga el informe comparativo en PDF de una auditoría guardada por `slug` (`GET /api/v1/audits/{slug}/pdf`).
   */
  downloadSavedAuditPdf(slug: string): Observable<HttpResponse<Blob>> {
    return this.http.get(
      `${this.baseUrl}/audits/${encodeURIComponent(slug)}/pdf`,
      {
        observe: 'response',
        responseType: 'blob'
      }
    );
  }
}
