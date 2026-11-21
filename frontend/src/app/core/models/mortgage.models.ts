/**
 * Contratos TypeScript de Valuriq estrictamente sincronizados con los esquemas
 * Pydantic v2 de `backend/app/domain/models.py` y `backend/app/api/schemas.py`.
 *
 * IMPORTANTE: Todos los campos `Decimal` del backend viajan como `string` en JSON
 * para garantizar aritmética exacta y evitar errores HTTP 422 por uso de `float`.
 */

export type MortgageType = 'FIXED' | 'MIXED' | 'VARIABLE';

export type LinkedProductCategory =
  | 'PAYROLL'
  | 'HOME_INSURANCE'
  | 'LIFE_INSURANCE'
  | 'ALARM'
  | 'CREDIT_CARD'
  | 'PENSION_PLAN'
  | 'INVESTMENT_FUND'
  | 'OTHER';

export type LinkedProductPaymentMode = 'ANNUAL' | 'PUF_FINANCED';

export type EarlyRepaymentFrequency = 'ONE_OFF' | 'MONTHLY' | 'ANNUAL';

export type EarlyRepaymentStrategy = 'REDUCE_PAYMENT' | 'REDUCE_TERM';

export interface LinkedProduct {
  id: string;
  name: string;
  category: LinkedProductCategory;
  bonus_pct: string;
  annual_bank_cost_eur: string;
  annual_market_cost_eur: string;
  apply_ipc: boolean;
  annual_age_increase_pct: string;
  payment_mode?: LinkedProductPaymentMode;
  puf_amount_eur?: string;
  puf_coverage_years?: number;
}

export interface MortgageOfferInput {
  offer_name: string;
  bank_name: string;
  principal_eur: string;
  term_months: number;
  mortgage_type: MortgageType;
  base_tin_pct: string;
  fixed_years: number;
  euribor_pct: string;
  differential_pct: string;
  min_tin_floor_pct: string;
  opening_commission_pct: string;
  appraisal_cost_eur: string;
  other_initial_expenses_eur: string;
  estimated_ipc_pct: string;
  linked_products: LinkedProduct[];
}

export interface AmortizationRow {
  month: number;
  year: number;
  applied_tin_pct: string;
  monthly_payment_eur: string;
  interest_eur: string;
  principal_eur: string;
  remaining_balance_eur: string;
  linked_bank_cost_eur: string;
  linked_market_cost_eur: string;
  linked_total_cost_eur: string;
  linked_overcost_eur: string;
  total_monthly_outflow_eur: string;
}

export interface YearlySummaryRow {
  year: number;
  applied_tin_pct: string;
  mortgage_payments_eur: string;
  interest_paid_eur: string;
  principal_paid_eur: string;
  ending_balance_eur: string;
  linked_bank_cost_eur: string;
  linked_market_cost_eur: string;
  linked_total_cost_eur: string;
  linked_overcost_eur: string;
  annual_total_outflow_eur: string;
  cumulative_mortgage_outflow_eur: string;
  cumulative_interest_paid_eur: string;
  cumulative_linked_cost_eur: string;
  cumulative_linked_overcost_eur: string;
  cumulative_total_outflow_eur: string;
}

export interface CombinationEvaluation {
  combination_id: string;
  rank: number;
  accepted_product_ids: string[];
  rejected_product_ids: string[];
  accepted_product_names: string[];
  rejected_product_names: string[];
  total_bonus_pct: string;
  effective_initial_tin_pct: string;
  effective_variable_tin_pct: string;
  initial_monthly_payment_eur: string;
  variable_monthly_payment_eur: string;
  initial_total_monthly_outflow_eur: string;
  principal_eur: string;
  financed_principal_eur?: string;
  puf_financed_amount_eur?: string;
  puf_extra_interest_eur?: string;
  initial_expenses_eur: string;
  total_interest_eur: string;
  total_mortgage_payments_eur: string;
  total_linked_bank_cost_eur: string;
  total_linked_market_cost_eur: string;
  total_linked_cost_eur: string;
  total_linked_overcost_eur: string;
  total_cost_eur: string;
  tae_real_pct: string;
  tae_overcost_pct: string;
  nominal_tae_pct: string;
  savings_vs_all_bonified_eur: string;
  savings_vs_unbonified_eur: string;
  break_even_year_vs_all_bonified: number | null;
  crossover_year_vs_all_bonified: number | null;
  yearly_summary: YearlySummaryRow[];
  monthly_schedule: AmortizationRow[];
}

export interface OptimizationVerdict {
  headline: string;
  explanation: string;
  optimal_matches_all_bonified: boolean;
  optimal_matches_unbonified: boolean;
  net_savings_vs_all_bonified_eur: string;
  net_savings_vs_unbonified_eur: string;
  max_possible_savings_eur: string;
  hidden_tae_spread_pct: string;
  break_even_year: number | null;
}

export interface MortgageAuditResult {
  offer: MortgageOfferInput;
  total_combinations_evaluated: number;
  scenario_a_all_bonified: CombinationEvaluation;
  scenario_b_unbonified: CombinationEvaluation;
  scenario_c_optimal: CombinationEvaluation;
  verdict: OptimizationVerdict;
  ranking: CombinationEvaluation[];
}

export interface ProductYearlyBenefitPoint {
  year: number;
  remaining_balance_start_eur: string;
  interest_saved_by_bonus_eur: string;
  bank_cost_eur: string;
  market_cost_eur: string;
  annual_overcost_eur: string;
  net_annual_benefit_eur: string;
  is_active_with_bank: boolean;
}

export interface ProductDynamicStrategy {
  product_id: string;
  product_name: string;
  payment_mode: LinkedProductPaymentMode;
  bonus_pct: string;
  keep_years: number;
  cancel_at_year: number | null;
  total_years: number;
  recommendation: string;
  crossover_year: number | null;
  cumulative_net_benefit_eur: string;
  puf_extra_interest_eur: string;
  yearly_breakdown: ProductYearlyBenefitPoint[];
}

export interface DynamicUnlinkingStrategyResult {
  total_years: number;
  dynamic_optimal_total_cost_eur: string;
  static_optimal_total_cost_eur: string;
  all_bonified_total_cost_eur: string;
  extra_savings_vs_static_optimum_eur: string;
  total_savings_vs_all_bonified_eur: string;
  dynamic_tae_real_pct: string;
  summary_headline: string;
  product_strategies: ProductDynamicStrategy[];
}

export interface EarlyRepaymentConfig {
  amount_eur: string;
  frequency: EarlyRepaymentFrequency;
  start_month: number;
  end_month: number | null;
  commission_pct: string;
}

export interface EarlyRepaymentRow {
  month: number;
  year: number;
  applied_tin_pct: string;
  regular_payment_eur: string;
  interest_eur: string;
  regular_principal_eur: string;
  early_repayment_eur: string;
  commission_eur: string;
  total_month_outflow_eur: string;
  remaining_balance_eur: string;
}

export interface YearlyBalancePoint {
  year: number;
  remaining_balance_eur: string;
  cumulative_interest_eur: string;
  cumulative_early_repaid_eur: string;
}

export interface EarlyRepaymentStrategyResult {
  strategy: EarlyRepaymentStrategy;
  original_term_months: number;
  new_term_months: number;
  months_saved: number;
  years_saved: string;
  initial_monthly_payment_eur: string;
  monthly_payment_after_first_repayment_eur: string;
  final_regular_monthly_payment_eur: string;
  total_early_repaid_eur: string;
  total_commission_paid_eur: string;
  baseline_total_interest_eur: string;
  total_interest_paid_eur: string;
  gross_interest_saved_eur: string;
  net_savings_eur: string;
  yearly_curve: YearlyBalancePoint[];
  schedule: EarlyRepaymentRow[];
}

export interface EarlyRepaymentComparisonResult {
  config: EarlyRepaymentConfig;
  principal_eur: string;
  baseline_term_months: number;
  baseline_initial_payment_eur: string;
  baseline_total_interest_eur: string;
  reduce_payment: EarlyRepaymentStrategyResult;
  reduce_term: EarlyRepaymentStrategyResult;
  recommended_strategy: EarlyRepaymentStrategy;
  extra_savings_reducing_term_eur: string;
  verdict_summary: string;
}

export interface PresetItemResponse {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  offer: MortgageOfferInput;
}

export interface AuditCalculationRequest {
  offer: MortgageOfferInput;
  early_repayment_config?: EarlyRepaymentConfig | null;
}

export interface AuditCalculationResponse {
  audit_result: MortgageAuditResult;
  early_repayment_result: EarlyRepaymentComparisonResult | null;
  dynamic_strategy?: DynamicUnlinkingStrategyResult | null;
}

export interface SavedAuditResponse {
  id: string;
  slug: string;
  created_at: string;
  audit_result: MortgageAuditResult;
  early_repayment_result: EarlyRepaymentComparisonResult | null;
  dynamic_strategy?: DynamicUnlinkingStrategyResult | null;
}

export interface EarlyRepaymentSimulationRequest {
  offer: MortgageOfferInput;
  config: EarlyRepaymentConfig;
  accepted_product_ids?: string[] | null;
}

/**
 * ============================================================================
 * ETAPA 2: Contratos para Gastos Día 1 (CCAA), Test de Estrés 35% BdE y Batalla
 * ============================================================================
 */

export type PropertyTaxRegime = 'SECOND_HAND' | 'NEW_BUILD' | 'NEW_BUILD_VPO';

export interface RegionTaxRule {
  code: string;
  name: string;
  itp_general_pct: string;
  itp_young_pct: string;
  young_max_age: number;
  ajd_new_build_pct: string;
  ajd_young_pct: string;
  new_build_indirect_tax_name: string;
  new_build_general_vat_pct: string;
  new_build_vpo_vat_pct: string;
  notes: string;
}

export interface DayOneCostsInput {
  property_price_eur: string;
  financing_pct: string;
  region_code: string;
  property_regime: PropertyTaxRegime;
  apply_young_buyer_reduction: boolean;
  notary_cost_eur?: string | null;
  registry_cost_eur?: string | null;
  gestoria_cost_eur: string;
  appraisal_cost_eur: string;
  real_estate_agency_fee_eur: string;
}

export interface DayOneCostsResult {
  property_price_eur: string;
  financing_pct: string;
  mortgage_principal_eur: string;
  down_payment_eur: string;
  region: RegionTaxRule;
  property_regime: PropertyTaxRegime;
  apply_young_buyer_reduction: boolean;
  applied_itp_pct: string;
  itp_amount_eur: string;
  indirect_tax_name: string;
  applied_iva_pct: string;
  iva_amount_eur: string;
  applied_ajd_pct: string;
  ajd_amount_eur: string;
  total_taxes_eur: string;
  notary_cost_eur: string;
  registry_cost_eur: string;
  gestoria_cost_eur: string;
  appraisal_cost_eur: string;
  real_estate_agency_fee_eur: string;
  total_formalization_expenses_eur: string;
  total_taxes_and_expenses_eur: string;
  taxes_and_expenses_over_price_pct: string;
  total_cash_needed_day_one_eur: string;
  young_buyer_tax_savings_eur: string;
  young_buyer_price_cap_warning?: string | null;
}

export type EffortRiskLevel = 'HEALTHY' | 'TIGHT' | 'RISK';

export interface EuriborStressScenarioPoint {
  euribor_pct: string;
  effective_tin_pct: string;
  monthly_mortgage_payment_eur: string;
  monthly_linked_cost_eur: string;
  total_monthly_outflow_eur: string;
  delta_vs_initial_outflow_eur: string;
  effort_ratio_pct: string;
  risk_level: EffortRiskLevel;
  exceeds_35_pct_limit: boolean;
}

export interface StressTestResult {
  mortgage_type: MortgageType;
  monthly_net_household_income_eur: string;
  initial_monthly_mortgage_payment_eur: string;
  initial_monthly_linked_cost_eur: string;
  initial_total_monthly_outflow_eur: string;
  initial_effort_ratio_pct: string;
  initial_risk_level: EffortRiskLevel;
  max_prudent_monthly_outflow_30_pct_eur: string;
  max_recommended_monthly_outflow_35_pct_eur: string;
  is_fixed_rate_protected: boolean;
  variable_tranche_start_month: number;
  variable_tranche_principal_balance_eur: string;
  critical_euribor_35_pct: string | null;
  scenarios: EuriborStressScenarioPoint[];
  verdict_headline: string;
  verdict_explanation: string;
}

export interface BankBattleEntry {
  rank: number;
  is_winner: boolean;
  offer: MortgageOfferInput;
  optimal_scenario: CombinationEvaluation;
  all_bonified_scenario: CombinationEvaluation;
  unbonified_scenario: CombinationEvaluation;
  verdict: OptimizationVerdict;
  dynamic_strategy: DynamicUnlinkingStrategyResult;
  diff_vs_winner_eur: string;
  tae_spread_vs_winner_pct: string;
}

export interface BankBattleComparisonResult {
  total_offers_compared: number;
  winner_bank_name: string;
  winner_offer_name: string;
  winner_optimal_total_cost_eur: string;
  winner_optimal_tae_real_pct: string;
  savings_vs_second_eur: string;
  savings_vs_last_eur: string;
  battle_verdict_headline: string;
  battle_verdict_explanation: string;
  entries: BankBattleEntry[];
}
