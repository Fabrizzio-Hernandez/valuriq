/**
 * Utilidades de serialización estricta a `string` Decimal (para el backend Python)
 * y formateo de visualización financiera en formato español (`es-ES`) para Valuriq.
 */

import {
  EarlyRepaymentConfig,
  LinkedProduct,
  MortgageOfferInput
} from '../models/mortgage.models';

/**
 * Convierte cualquier entrada de formulario (string con coma o punto, o número)
 * a un `string` decimal con punto y `decimals` posiciones fijas (ej. "220000.00").
 * Garantiza que jamás se envíe un `float` nativo de JS al backend FastAPI/Pydantic.
 */
export function toDecimalString(
  value: string | number | null | undefined,
  decimals: number = 2,
  fallback: string = '0.00'
): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed.toFixed(decimals);
}

/**
 * Convierte una entrada a entero seguro para plazos en meses y años fijos.
 */
export function toSafeInt(
  value: string | number | null | undefined,
  fallback: number = 0
): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Convierte un string Decimal del backend a `number` para cálculos de UI o Chart.js.
 */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Formatea un valor numérico para inputs limpios de usuario:
 * - Si es un entero exacto (ej. 220000.00, 450.00, 0.0000), devuelve "220000", "450", "0".
 * - Si tiene decimales significativos (ej. 3.4000, 0.1500), devuelve "3.40", "0.15".
 */
export function formatCleanInput(
  value: string | number | null | undefined,
  preserveTwoDecimalsForRates: boolean = false
): string {
  const num = toNumber(value);
  if (num === 0) {
    return '0';
  }
  if (Number.isInteger(num) && !preserveTwoDecimalsForRates) {
    return String(num);
  }
  return num.toFixed(2);
}

/**
 * Formatea un número decimal genérico en formato español `es-ES` con coma decimal
 * (ej. "2,92" para años recortados, nunca "2.92").
 */
export function formatDecimalEs(
  value: string | number | null | undefined,
  fractionDigits: number = 2
): string {
  const num = toNumber(value);
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true
  }).format(num);
}

/**
 * Formatea un importe en euros con formato español `es-ES` (ej. "220.000,00 €").
 */
export function formatEurEs(
  value: string | number | null | undefined,
  fractionDigits: number = 2
): string {
  return `${formatDecimalEs(value, fractionDigits)} €`;
}

/**
 * Formatea un tipo de interés porcentual en formato español `es-ES` (ej. "3,40 %").
 */
export function formatPctEs(
  value: string | number | null | undefined,
  fractionDigits: number = 2
): string {
  return `${formatDecimalEs(value, fractionDigits)} %`;
}

/**
 * Sanitiza y serializa un `MortgageOfferInput` garantizando que todos los campos
 * `Decimal` sean `string` exactos y todos los enteros sean `number` enteros.
 */
export function serializeOfferPayload(raw: MortgageOfferInput): MortgageOfferInput {
  const serializeProduct = (p: LinkedProduct, idx: number): LinkedProduct => {
    const mode = p.payment_mode || 'ANNUAL';
    const rawPufAmount = toNumber(p.puf_amount_eur);
    const pufAmountStr =
      mode === 'PUF_FINANCED'
        ? toDecimalString(rawPufAmount > 0 ? rawPufAmount : 12000, 2, '12000.00')
        : toDecimalString(rawPufAmount, 2, '0.00');
    const pufCovYears = Math.max(1, Math.min(50, toSafeInt(p.puf_coverage_years, 10)));

    return {
      id: (p.id || `prod_${idx + 1}`).trim(),
      name: (p.name || `Vinculación ${idx + 1}`).trim(),
      category: p.category || 'OTHER',
      bonus_pct: toDecimalString(p.bonus_pct, 2, '0.10'),
      annual_bank_cost_eur: toDecimalString(p.annual_bank_cost_eur, 2, '0.00'),
      annual_market_cost_eur: toDecimalString(p.annual_market_cost_eur, 2, '0.00'),
      apply_ipc: Boolean(p.apply_ipc),
      annual_age_increase_pct: toDecimalString(p.annual_age_increase_pct, 2, '0.00'),
      payment_mode: mode,
      puf_amount_eur: pufAmountStr,
      puf_coverage_years: pufCovYears
    };
  };

  const termMonths = Math.max(12, Math.min(600, toSafeInt(raw.term_months, 360)));
  let fixedYears = Math.max(0, toSafeInt(raw.fixed_years, 0));
  if (raw.mortgage_type === 'MIXED') {
    const maxFixedYears = Math.max(1, Math.floor((termMonths - 12) / 12));
    fixedYears = Math.max(1, Math.min(maxFixedYears, fixedYears || 5));
  }

  return {
    offer_name: (raw.offer_name || 'Oferta Hipotecaria').trim(),
    bank_name: (raw.bank_name || 'Entidad Bancaria').trim(),
    principal_eur: toDecimalString(raw.principal_eur, 2, '200000.00'),
    term_months: termMonths,
    mortgage_type: raw.mortgage_type || 'FIXED',
    base_tin_pct: toDecimalString(raw.base_tin_pct, 2, '3.40'),
    fixed_years: fixedYears,
    euribor_pct: toDecimalString(raw.euribor_pct, 2, '2.50'),
    differential_pct: toDecimalString(raw.differential_pct, 2, '1.00'),
    min_tin_floor_pct: toDecimalString(raw.min_tin_floor_pct, 2, '0.00'),
    opening_commission_pct: toDecimalString(raw.opening_commission_pct, 2, '0.00'),
    appraisal_cost_eur: toDecimalString(raw.appraisal_cost_eur, 2, '450.00'),
    other_initial_expenses_eur: toDecimalString(raw.other_initial_expenses_eur, 2, '0.00'),
    estimated_ipc_pct: toDecimalString(raw.estimated_ipc_pct, 2, '2.00'),
    linked_products: (raw.linked_products || []).slice(0, 12).map(serializeProduct)
  };
}

/**
 * Sanitiza y serializa un `EarlyRepaymentConfig` garantizando campos Decimal como `string`.
 */
export function serializeEarlyRepaymentConfig(
  raw: EarlyRepaymentConfig
): EarlyRepaymentConfig {
  const startMonth = Math.max(1, toSafeInt(raw.start_month, 12));
  const rawEnd =
    raw.end_month !== null &&
    raw.end_month !== undefined &&
    String(raw.end_month).trim() !== ''
      ? toSafeInt(raw.end_month, startMonth)
      : null;

  return {
    amount_eur: toDecimalString(raw.amount_eur, 2, '10000.00'),
    frequency: raw.frequency || 'ONE_OFF',
    start_month: startMonth,
    end_month: rawEnd !== null ? Math.max(startMonth, rawEnd) : null,
    commission_pct: toDecimalString(raw.commission_pct, 2, '0.00')
  };
}

/**
 * Extrae un mensaje legible de cualquier respuesta de error HTTP de FastAPI / Pydantic v2
 * (incluyendo arrays `detail: [{ msg, loc }]` en respuestas HTTP 422), evitando `[object Object]`.
 */
export function extractApiError(
  err: unknown,
  fallbackMessage: string = 'No se pudo completar la operación.'
): string {
  const anyErr = err as {
    error?: { detail?: unknown; message?: string };
    message?: string;
  } | null;

  const detail = anyErr?.error?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail
      .map((item: unknown) => {
        if (typeof item === 'string') {
          return item;
        }
        const obj = item as { msg?: string; loc?: unknown[] } | null;
        if (obj && typeof obj.msg === 'string') {
          return obj.msg;
        }
        return '';
      })
      .filter((m) => m.length > 0);
    if (messages.length > 0) {
      return messages.join(' · ');
    }
  }
  if (typeof anyErr?.error?.message === 'string' && anyErr.error.message.trim()) {
    return anyErr.error.message.trim();
  }
  return fallbackMessage;
}
