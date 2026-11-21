import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  MortgageAuditResult,
  StressTestResult
} from '../../../../core/models/mortgage.models';
import { ValuriqApiService } from '../../../../core/services/valuriq-api.service';
import { ValuriqWorkspaceService } from '../../../../core/services/valuriq-workspace.service';
import {
  extractApiError,
  formatDecimalEs,
  formatEurEs,
  formatPctEs,
  toNumber
} from '../../../../core/utils/decimal-format';

@Component({
  selector: 'app-stress-test-card',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
      <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <span class="text-[11px] font-bold uppercase tracking-wider text-[#059669]">
            Criterio de Solvencia · Banco de España (Límite 35 %)
          </span>
          <h3 class="mt-0.5 font-display text-base font-bold text-[#0B1120]">
            Tasa de Esfuerzo del Hogar y Test de Estrés de Euríbor
          </h3>
        </div>

        <!-- Input de Ingresos Netos Mensuales del Hogar -->
        <div class="flex items-center gap-2">
          <label class="text-xs font-semibold text-slate-600">
            Ingresos netos hogar:
          </label>
          <div class="relative w-36">
            <input
              type="text"
              [ngModel]="incomeInput()"
              (ngModelChange)="onIncomeChange($event)"
              (keyup.enter)="runTest()"
              class="w-full rounded-xl border border-slate-200 bg-[#F6F7F9]/70 py-1.5 pl-3 pr-12 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
            />
            <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] font-semibold text-slate-400">
              €/mes
            </span>
          </div>
          <button
            type="button"
            (click)="runTest()"
            [disabled]="loading()"
            class="rounded-xl bg-[#0B1120] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {{ loading() ? 'Calculando...' : 'Calcular' }}
          </button>
        </div>
      </div>

      @if (errorMsg()) {
        <div class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-[#E11D48]">
          {{ errorMsg() }}
        </div>
      }

      @if (stressResult(); as st) {
        <!-- Semáforo de Tasa de Esfuerzo Actual -->
        <div class="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-4 lg:grid-cols-12 lg:items-center">
          <div class="lg:col-span-7">
            <div class="flex flex-wrap items-center gap-2">
              <span
                [class]="
                  st.initial_risk_level === 'HEALTHY'
                    ? 'rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-[#059669]'
                    : st.initial_risk_level === 'TIGHT'
                      ? 'rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800'
                      : 'rounded-md bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-[#E11D48]'
                "
              >
                @if (st.initial_risk_level === 'HEALTHY') {
                  ✓ Saludable (≤ 30 %)
                } @else if (st.initial_risk_level === 'TIGHT') {
                  ⚠ Ajustada (30 % – 35 %)
                } @else {
                  ✕ Riesgo BdE (> 35 %)
                }
              </span>
              <span class="font-display text-sm font-bold text-[#0B1120]">
                {{ st.verdict_headline }}
              </span>
            </div>
            <p class="mt-1.5 text-xs leading-relaxed text-slate-600">
              {{ st.verdict_explanation }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2.5 text-xs lg:col-span-5">
            <div class="rounded-xl border border-slate-200/80 bg-white p-3">
              <span class="block text-[10px] font-semibold uppercase text-slate-400">
                Desembolso Mes 1
              </span>
              <span class="mt-0.5 block font-mono text-base font-extrabold tabular-nums text-[#0B1120]">
                {{ fmtEur(st.initial_total_monthly_outflow_eur) }}
              </span>
              <span class="text-[11px] text-slate-500">
                Esfuerzo: {{ fmtPct(st.initial_effort_ratio_pct) }}
              </span>
            </div>

            <div class="rounded-xl border border-slate-200/80 bg-white p-3">
              <span class="block text-[10px] font-semibold uppercase text-slate-400">
                Tope 35 % Banco España
              </span>
              <span class="mt-0.5 block font-mono text-base font-extrabold tabular-nums text-[#059669]">
                {{ fmtEur(st.max_recommended_monthly_outflow_35_pct_eur) }}
              </span>
              <span class="text-[11px] text-slate-500">
                30 % prudente: {{ fmtEur(st.max_prudent_monthly_outflow_30_pct_eur) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Tabla de Escenarios de Estrés de Euríbor (2%, 3%, 4%, 5%) -->
        <div class="mt-4 overflow-x-auto rounded-xl border border-slate-200/80">
          <table class="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 bg-[#F6F7F9] text-[11px] font-bold uppercase text-slate-500">
                <th class="px-3.5 py-2.5">Escenario Euríbor</th>
                <th class="whitespace-nowrap px-3.5 py-2.5 text-right">TIN Efectivo</th>
                <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Cuota Hipoteca</th>
                <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Total con Seguros</th>
                <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Variación Mes</th>
                <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Tasa Esfuerzo</th>
                <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Estado BdE</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono tabular-nums">
              @for (s of st.scenarios; track s.euribor_pct) {
                <tr class="hover:bg-slate-50">
                  <td class="whitespace-nowrap px-3.5 py-2.5 font-sans font-bold text-[#0B1120]">
                    Euríbor al {{ fmtPct(s.euribor_pct) }}
                  </td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-600">
                    {{ fmtPct(s.effective_tin_pct) }}
                  </td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-800">
                    {{ fmtEur(s.monthly_mortgage_payment_eur) }}
                  </td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-bold text-[#0B1120]">
                    {{ fmtEur(s.total_monthly_outflow_eur) }}
                  </td>
                  <td
                    [class]="
                      toNum(s.delta_vs_initial_outflow_eur) > 0
                        ? 'whitespace-nowrap px-3.5 py-2.5 text-right font-semibold text-[#E11D48]'
                        : 'whitespace-nowrap px-3.5 py-2.5 text-right text-slate-500'
                    "
                  >
                    @if (toNum(s.delta_vs_initial_outflow_eur) > 0) {
                      +{{ fmtEur(s.delta_vs_initial_outflow_eur) }}
                    } @else {
                      {{ fmtEur(s.delta_vs_initial_outflow_eur) }}
                    }
                  </td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-bold text-[#0B1120]">
                    {{ fmtPct(s.effort_ratio_pct) }}
                  </td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-sans">
                    <span
                      [class]="
                        s.risk_level === 'HEALTHY'
                          ? 'rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-[#059669]'
                          : s.risk_level === 'TIGHT'
                            ? 'rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800'
                            : 'rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-[#E11D48]'
                      "
                    >
                      @if (s.risk_level === 'HEALTHY') {
                        Saludable
                      } @else if (s.risk_level === 'TIGHT') {
                        Ajustado
                      } @else {
                        Supera 35 %
                      }
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `
})
export class StressTestCardComponent {
  private readonly api = inject(ValuriqApiService);
  private readonly workspace = inject(ValuriqWorkspaceService);

  readonly auditResult = input.required<MortgageAuditResult>();
  readonly incomeInput = signal<string>(this.workspace.monthlyNetHouseholdIncomeEur());
  readonly stressResult = signal<StressTestResult | null>(null);
  readonly loading = signal<boolean>(false);
  readonly errorMsg = signal<string | null>(null);

  constructor() {
    effect(() => {
      const res = this.auditResult();
      if (res) {
        untracked(() => this.runTest());
      }
    });
  }

  onIncomeChange(val: string): void {
    this.incomeInput.set(val);
    this.workspace.monthlyNetHouseholdIncomeEur.set(val);
  }

  runTest(): void {
    const res = this.auditResult();
    const incomeVal = Math.max(500, toNumber(this.incomeInput()) || 3500);
    this.loading.set(true);
    this.errorMsg.set(null);

    this.api
      .runStressTest(
        res.offer,
        incomeVal,
        res.scenario_c_optimal.accepted_product_ids
      )
      .subscribe({
        next: (st) => {
          this.stressResult.set(st);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMsg.set(
            extractApiError(err, 'No se pudo ejecutar el test de estrés de Euríbor.')
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

  toNum(value: string | number | null | undefined): number {
    return toNumber(value);
  }
}
