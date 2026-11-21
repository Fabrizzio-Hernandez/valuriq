import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';

import {
  EarlyRepaymentComparisonResult,
  EarlyRepaymentConfig,
  EarlyRepaymentFrequency,
  MortgageAuditResult
} from '../../../../core/models/mortgage.models';
import { ValuriqApiService } from '../../../../core/services/valuriq-api.service';
import {
  extractApiError,
  formatCleanInput,
  formatDecimalEs,
  formatEurEs,
  formatPctEs,
  serializeEarlyRepaymentConfig,
  toNumber
} from '../../../../core/utils/decimal-format';

interface EarlyRepaymentFormControls {
  amount_eur: FormControl<string>;
  frequency: FormControl<EarlyRepaymentFrequency>;
  start_month: FormControl<number>;
  end_month: FormControl<number | null>;
  commission_pct: FormControl<string>;
}

@Component({
  selector: 'app-early-repayment-simulator',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
      <!-- Cabecera y Fila Única Limpia de Presets Rápidos -->
      <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <span class="text-[11px] font-bold uppercase tracking-wider text-[#059669]">
            Simulador de Amortización Anticipada · Ley 5/2019 LCCI
          </span>
          <h3 class="mt-0.5 font-display text-base font-bold text-[#0B1120]">
            Comparativa Matemática: Reducir Plazo vs. Reducir Cuota
          </h3>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            (click)="applyQuickPreset('15000', 'ONE_OFF', 24, null, '0')"
            class="whitespace-nowrap rounded-lg border border-slate-200/80 bg-[#F6F7F9] px-3 py-1.5 text-xs font-semibold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/60"
          >
            Puntual 15.000 € (Mes 24)
          </button>
          <button
            type="button"
            (click)="applyQuickPreset('4000', 'ANNUAL', 12, 120, '0.15')"
            class="whitespace-nowrap rounded-lg border border-slate-200/80 bg-[#F6F7F9] px-3 py-1.5 text-xs font-semibold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/60"
          >
            4.000 €/año (10 años)
          </button>
          <button
            type="button"
            (click)="applyQuickPreset('200', 'MONTHLY', 13, 180, '0')"
            class="whitespace-nowrap rounded-lg border border-slate-200/80 bg-[#F6F7F9] px-3 py-1.5 text-xs font-semibold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/60"
          >
            200 €/mes
          </button>
        </div>
      </div>

      <!-- Formulario con Grid Amplio (Cero Recorte en Periodicidad y Mes Fin) -->
      <form
        [formGroup]="form"
        (ngSubmit)="runSimulation()"
        class="mt-4 grid grid-cols-1 gap-3.5 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-4 sm:grid-cols-2 lg:grid-cols-12"
      >
        <div class="lg:col-span-3">
          <label class="block text-xs font-semibold text-slate-600">Importe Aportación</label>
          <div class="relative mt-1">
            <input
              type="text"
              formControlName="amount_eur"
              class="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
            />
            <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-slate-400">
              €
            </span>
          </div>
        </div>

        <div class="lg:col-span-3">
          <label class="block text-xs font-semibold text-slate-600">Periodicidad</label>
          <select
            formControlName="frequency"
            class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
          >
            <option value="ONE_OFF">Puntual (una sola vez)</option>
            <option value="ANNUAL">Periódica anual</option>
            <option value="MONTHLY">Periódica mensual</option>
          </select>
        </div>

        <div class="lg:col-span-2">
          <label class="block text-xs font-semibold text-slate-600">Mes Inicio</label>
          <input
            type="number"
            formControlName="start_month"
            min="1"
            max="600"
            class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
          />
        </div>

        <div class="lg:col-span-2">
          <label class="block text-xs font-semibold text-slate-600">Mes Fin (Opcional)</label>
          <input
            type="number"
            formControlName="end_month"
            min="1"
            max="600"
            placeholder="Sin límite"
            class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm tabular-nums text-[#0B1120] placeholder:font-sans placeholder:text-slate-400 focus:border-[#0B1120] focus:outline-none"
          />
        </div>

        <div class="lg:col-span-2">
          <label class="block text-xs font-semibold text-slate-600">Comisión Banco</label>
          <div class="relative mt-1">
            <input
              type="text"
              formControlName="commission_pct"
              class="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-7 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
            />
            <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-semibold text-slate-400">
              %
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-slate-200/70 pt-3 sm:col-span-2 lg:col-span-12">
          <span class="text-xs text-slate-500">
            Calculado sobre el Escenario C (Óptimo Valuriq · TIN {{ fmtPct(auditResult().scenario_c_optimal.effective_initial_tin_pct) }})
          </span>
          <button
            type="submit"
            [disabled]="loading()"
            class="rounded-xl bg-[#0B1120] px-5 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            @if (loading()) {
              Simulando...
            } @else {
              Recalcular Amortización
            }
          </button>
        </div>
      </form>

      @if (errorMsg()) {
        <div class="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-[#E11D48]">
          {{ errorMsg() }}
        </div>
      }

      @if (comparisonResult(); as comp) {
        <div class="mt-5 space-y-5">
          <!-- Barra Comparativa Visual de Intereses Ahorrados -->
          <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span class="font-bold text-[#0B1120]">
                Comparativa de Intereses Ahorrados (Reducir Plazo vs. Reducir Cuota)
              </span>
              <span class="whitespace-nowrap rounded-md bg-emerald-100 px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-[#059669]">
                Reducir Plazo ahorra +{{ fmtEur(comp.extra_savings_reducing_term_eur) }} adicionales
              </span>
            </div>

            <div class="mt-3 space-y-2.5 text-xs">
              <div>
                <div class="flex justify-between font-medium">
                  <span class="text-[#0B1120]">Reducir Plazo (Recomendado)</span>
                  <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#059669]">
                    {{ fmtEur(comp.reduce_term.net_savings_eur) }}
                  </span>
                </div>
                <div class="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div class="h-full rounded-full bg-[#059669]" [style.width.%]="100"></div>
                </div>
              </div>

              <div>
                <div class="flex justify-between font-medium">
                  <span class="text-slate-600">Reducir Cuota</span>
                  <span class="whitespace-nowrap font-mono font-bold tabular-nums text-slate-700">
                    {{ fmtEur(comp.reduce_payment.net_savings_eur) }}
                  </span>
                </div>
                <div class="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    class="h-full rounded-full bg-[#0B1120]"
                    [style.width.%]="reducePaymentSavingsRatioPct()"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tarjetas Lado a Lado con Formato Español (Coma Decimal) -->
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <!-- Opción 1: Reducir Plazo -->
            <div class="rounded-2xl border-2 border-[#059669] bg-emerald-50/20 p-5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-display text-sm font-extrabold text-[#0B1120]">
                  Opción 1 · Reducir Plazo (Mantiene Cuota)
                </span>
                @if (comp.recommended_strategy === 'REDUCE_TERM') {
                  <span class="rounded-md bg-[#059669] px-2.5 py-0.5 text-[11px] font-bold text-white">
                    ✓ Óptimo Financiero
                  </span>
                }
              </div>

              <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div class="rounded-xl border border-emerald-200/80 bg-white p-3.5">
                  <span class="text-slate-500">Ahorro Neto en Intereses</span>
                  <p class="mt-1 whitespace-nowrap font-mono text-xl font-extrabold tabular-nums text-[#059669]">
                    {{ fmtEur(comp.reduce_term.net_savings_eur) }}
                  </p>
                </div>
                <div class="rounded-xl border border-emerald-200/80 bg-white p-3.5">
                  <span class="text-slate-500">Tiempo Recortado</span>
                  <p class="mt-1 whitespace-nowrap font-mono text-xl font-extrabold tabular-nums text-[#0B1120]">
                    -{{ comp.reduce_term.months_saved }} meses
                  </p>
                  <span class="text-[11px] font-medium text-slate-500">
                    ({{ fmtDecimal(comp.reduce_term.years_saved) }} años menos)
                  </span>
                </div>
                <div class="rounded-xl border border-slate-200/80 bg-white p-3">
                  <span class="text-slate-500">Cuota Mensual</span>
                  <p class="mt-0.5 whitespace-nowrap font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                    {{ fmtEur(comp.reduce_term.monthly_payment_after_first_repayment_eur) }}
                  </p>
                </div>
                <div class="rounded-xl border border-slate-200/80 bg-white p-3">
                  <span class="text-slate-500">Nuevo Plazo Total</span>
                  <p class="mt-0.5 whitespace-nowrap font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                    {{ comp.reduce_term.new_term_months }} de {{ comp.reduce_term.original_term_months }} meses
                  </p>
                </div>
              </div>
            </div>

            <!-- Opción 2: Reducir Cuota -->
            <div class="rounded-2xl border border-slate-200/80 bg-white p-5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-display text-sm font-bold text-[#0B1120]">
                  Opción 2 · Reducir Cuota (Mantiene Plazo)
                </span>
                <span class="rounded-md bg-[#F6F7F9] px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                  Mayor liquidez mensual
                </span>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/60 p-3.5">
                  <span class="text-slate-500">Ahorro Neto en Intereses</span>
                  <p class="mt-1 whitespace-nowrap font-mono text-xl font-extrabold tabular-nums text-[#0B1120]">
                    {{ fmtEur(comp.reduce_payment.net_savings_eur) }}
                  </p>
                </div>
                <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/60 p-3.5">
                  <span class="text-slate-500">Nueva Cuota Mensual</span>
                  <p class="mt-1 whitespace-nowrap font-mono text-xl font-extrabold tabular-nums text-[#0B1120]">
                    {{ fmtEur(comp.reduce_payment.monthly_payment_after_first_repayment_eur) }}
                  </p>
                  <span class="text-[11px] text-slate-500">
                    Antes: {{ fmtEur(comp.reduce_payment.initial_monthly_payment_eur) }}
                  </span>
                </div>
                <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/60 p-3">
                  <span class="text-slate-500">Capital Extra Amortizado</span>
                  <p class="mt-0.5 whitespace-nowrap font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                    {{ fmtEur(comp.reduce_payment.total_early_repaid_eur) }}
                  </p>
                </div>
                <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/60 p-3">
                  <span class="text-slate-500">Comisión Pagada</span>
                  <p class="mt-0.5 whitespace-nowrap font-mono text-sm font-bold tabular-nums text-slate-700">
                    {{ fmtEur(comp.reduce_payment.total_commission_paid_eur) }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p class="rounded-xl border border-slate-200/70 bg-[#F6F7F9] px-4 py-3 text-xs leading-relaxed text-slate-600">
            {{ spanishFormattedVerdictSummary() }}
          </p>
        </div>
      }
    </section>
  `
})
export class EarlyRepaymentSimulatorComponent implements OnInit {
  private readonly api = inject(ValuriqApiService);
  private lastEvaluatedAuditRef: MortgageAuditResult | null = null;

  readonly auditResult = input.required<MortgageAuditResult>();
  readonly initialComparison = input<EarlyRepaymentComparisonResult | null>(null);
  readonly configChange = output<EarlyRepaymentConfig>();
  readonly resultChange = output<EarlyRepaymentComparisonResult>();

  readonly comparisonResult = signal<EarlyRepaymentComparisonResult | null>(null);
  readonly loading = signal<boolean>(false);
  readonly errorMsg = signal<string | null>(null);

  readonly reducePaymentSavingsRatioPct = computed<number>(() => {
    const comp = this.comparisonResult();
    if (!comp) {
      return 40;
    }
    const termSav = Math.max(1, toNumber(comp.reduce_term.net_savings_eur));
    const paySav = Math.max(0, toNumber(comp.reduce_payment.net_savings_eur));
    return Math.max(5, Math.min(100, Math.round((paySav / termSav) * 100)));
  });

  readonly spanishFormattedVerdictSummary = computed<string>(() => {
    const comp = this.comparisonResult();
    if (!comp) {
      return '';
    }
    // Asegurar que cualquier número decimal tipo "2.92 años" del resumen use coma española "2,92 años"
    return comp.verdict_summary.replace(/(\d+)\.(\d+)\s+años/g, '$1,$2 años');
  });

  readonly form = new FormGroup<EarlyRepaymentFormControls>({
    amount_eur: new FormControl<string>('15000', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    frequency: new FormControl<EarlyRepaymentFrequency>('ONE_OFF', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    start_month: new FormControl<number>(24, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(600)]
    }),
    end_month: new FormControl<number | null>(null),
    commission_pct: new FormControl<string>('0', {
      nonNullable: true,
      validators: [Validators.required]
    })
  });

  constructor() {
    effect(() => {
      const currentAudit = this.auditResult();
      const incoming = this.initialComparison();
      if (incoming) {
        this.lastEvaluatedAuditRef = currentAudit;
        this.comparisonResult.set(incoming);
        this.form.patchValue(
          {
            amount_eur: formatCleanInput(incoming.config.amount_eur),
            frequency: incoming.config.frequency,
            start_month: incoming.config.start_month,
            end_month: incoming.config.end_month,
            commission_pct: formatCleanInput(incoming.config.commission_pct)
          },
          { emitEvent: false }
        );
      } else if (currentAudit && this.lastEvaluatedAuditRef !== currentAudit) {
        this.lastEvaluatedAuditRef = currentAudit;
        queueMicrotask(() => this.runSimulation());
      }
    });
  }

  ngOnInit(): void {
    if (!this.initialComparison() && !this.lastEvaluatedAuditRef) {
      this.lastEvaluatedAuditRef = this.auditResult();
      this.runSimulation();
    }
  }

  applyQuickPreset(
    amount: string,
    frequency: EarlyRepaymentFrequency,
    startMonth: number,
    endMonth: number | null,
    commissionPct: string
  ): void {
    this.form.patchValue({
      amount_eur: amount,
      frequency,
      start_month: startMonth,
      end_month: endMonth,
      commission_pct: commissionPct
    });
    this.runSimulation();
  }

  runSimulation(): void {
    const raw = this.form.getRawValue();
    const config = serializeEarlyRepaymentConfig({
      amount_eur: raw.amount_eur,
      frequency: raw.frequency,
      start_month: raw.start_month,
      end_month: raw.end_month,
      commission_pct: raw.commission_pct
    });

    this.loading.set(true);
    this.errorMsg.set(null);
    this.configChange.emit(config);

    const res = this.auditResult();
    const acceptedIds = res.scenario_c_optimal.accepted_product_ids;

    this.api.simulateEarlyRepayment(res.offer, config, acceptedIds).subscribe({
      next: (comparison) => {
        this.comparisonResult.set(comparison);
        this.resultChange.emit(comparison);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          extractApiError(err, 'No se pudo simular la amortización anticipada.')
        );
        this.loading.set(false);
      }
    });
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  fmtPct(value: string | number | null | undefined): string {
    return formatPctEs(value, 2);
  }

  fmtDecimal(value: string | number | null | undefined): string {
    return formatDecimalEs(value, 2);
  }
}
