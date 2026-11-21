import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal
} from '@angular/core';

import {
  CombinationEvaluation,
  MortgageAuditResult
} from '../../../../core/models/mortgage.models';
import {
  formatEurEs,
  formatPctEs
} from '../../../../core/utils/decimal-format';

type ScenarioKey = 'C' | 'A' | 'B';
type ScheduleGranularity = 'yearly' | 'monthly';

@Component({
  selector: 'app-amortization-schedule',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let res = auditResult();
    @let activeScenario = selectedScenario();

    <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
      <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 class="font-display text-base font-bold text-[#0B1120]">
            Cuadro de Amortización Francés Completo
          </h3>
          <p class="text-xs text-slate-500">
            Desglose período a período con ajuste exacto de céntimos en la última cuota a saldo 0,00 €
          </p>
        </div>

        <!-- Toggle Vista Anual / Vista Mensual -->
        <div class="inline-flex rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-1">
          <button
            type="button"
            (click)="setGranularity('yearly')"
            [class]="
              granularity() === 'yearly'
                ? 'rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#0B1120] shadow-2xs'
                : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-[#0B1120]'
            "
          >
            Vista Anual ({{ activeScenario.yearly_summary.length }} años)
          </button>
          <button
            type="button"
            (click)="setGranularity('monthly')"
            [class]="
              granularity() === 'monthly'
                ? 'rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#0B1120] shadow-2xs'
                : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-[#0B1120]'
            "
          >
            Vista Mensual ({{ activeScenario.monthly_schedule.length }} meses)
          </button>
        </div>
      </div>

      <!-- Selector de Escenario (C / A / B) -->
      <div class="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-2.5">
        <button
          type="button"
          (click)="selectScenario('C')"
          [class]="
            scenarioKey() === 'C'
              ? 'rounded-lg bg-[#059669] px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition'
              : 'rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80 transition hover:text-[#0B1120]'
          "
        >
          Escenario C · Óptimo Valuriq ({{ fmtPct(res.scenario_c_optimal.effective_initial_tin_pct) }})
        </button>
        <button
          type="button"
          (click)="selectScenario('A')"
          [class]="
            scenarioKey() === 'A'
              ? 'rounded-lg bg-[#E11D48] px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition'
              : 'rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80 transition hover:text-[#0B1120]'
          "
        >
          Escenario A · 100 % Banco ({{ fmtPct(res.scenario_a_all_bonified.effective_initial_tin_pct) }})
        </button>
        <button
          type="button"
          (click)="selectScenario('B')"
          [class]="
            scenarioKey() === 'B'
              ? 'rounded-lg bg-[#0B1120] px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition'
              : 'rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80 transition hover:text-[#0B1120]'
          "
        >
          Escenario B · 0 % Banco ({{ fmtPct(res.scenario_b_unbonified.effective_initial_tin_pct) }})
        </button>
      </div>

      <!-- Tabla con cabecera fija y cifras tabulares -->
      <div class="mt-4 max-h-[520px] overflow-y-auto rounded-xl border border-slate-200/80">
        @if (granularity() === 'yearly') {
          <table class="w-full min-w-[740px] border-collapse text-left text-xs">
            <thead class="sticky top-0 z-10 border-b border-slate-200 bg-[#F6F7F9] text-[11px] font-bold uppercase text-slate-600">
              <tr>
                <th class="px-3.5 py-3">Año</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">TIN</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Cuotas Año</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Intereses</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Capital Amort.</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Seguros/Vinc.</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Total Acumulado</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Saldo Vivo</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono tabular-nums">
              @for (row of activeScenario.yearly_summary; track row.year) {
                <tr class="hover:bg-slate-50">
                  <td class="whitespace-nowrap px-3.5 py-2.5 font-bold text-[#0B1120]">Año {{ row.year }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-600">{{ fmtPct(row.applied_tin_pct) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-700">{{ fmtEur(row.mortgage_payments_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-600">{{ fmtEur(row.interest_paid_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-semibold text-[#059669]">{{ fmtEur(row.principal_paid_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-[#E11D48]">{{ fmtEur(row.linked_total_cost_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-bold text-[#0B1120]">{{ fmtEur(row.cumulative_total_outflow_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-700">{{ fmtEur(row.ending_balance_eur) }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <table class="w-full min-w-[740px] border-collapse text-left text-xs">
            <thead class="sticky top-0 z-10 border-b border-slate-200 bg-[#F6F7F9] text-[11px] font-bold uppercase text-slate-600">
              <tr>
                <th class="px-3.5 py-3">Mes (Año)</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">TIN</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Cuota</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Intereses</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Capital</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Seguros/Vinc.</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Desembolso Mes</th>
                <th class="whitespace-nowrap px-3.5 py-3 text-right">Saldo Vivo</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono tabular-nums">
              @for (row of activeScenario.monthly_schedule; track row.month) {
                <tr class="hover:bg-slate-50">
                  <td class="whitespace-nowrap px-3.5 py-2.5 font-bold text-[#0B1120]">
                    Mes {{ row.month }} <span class="font-normal text-slate-400">(A{{ row.year }})</span>
                  </td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-600">{{ fmtPct(row.applied_tin_pct) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-700">{{ fmtEur(row.monthly_payment_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-600">{{ fmtEur(row.interest_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-semibold text-[#059669]">{{ fmtEur(row.principal_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-[#E11D48]">{{ fmtEur(row.linked_total_cost_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right font-bold text-[#0B1120]">{{ fmtEur(row.total_monthly_outflow_eur) }}</td>
                  <td class="whitespace-nowrap px-3.5 py-2.5 text-right text-slate-700">{{ fmtEur(row.remaining_balance_eur) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </section>
  `
})
export class AmortizationScheduleComponent {
  readonly auditResult = input.required<MortgageAuditResult>();

  readonly scenarioKey = signal<ScenarioKey>('C');
  readonly granularity = signal<ScheduleGranularity>('yearly');

  readonly selectedScenario = computed<CombinationEvaluation>(() => {
    const res = this.auditResult();
    const key = this.scenarioKey();
    if (key === 'A') {
      return res.scenario_a_all_bonified;
    }
    if (key === 'B') {
      return res.scenario_b_unbonified;
    }
    return res.scenario_c_optimal;
  });

  selectScenario(key: ScenarioKey): void {
    this.scenarioKey.set(key);
  }

  setGranularity(g: ScheduleGranularity): void {
    this.granularity.set(g);
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  fmtPct(value: string | number | null | undefined): string {
    return formatPctEs(value, 2);
  }
}
