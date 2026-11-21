import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal
} from '@angular/core';

import { MortgageAuditResult } from '../../../../core/models/mortgage.models';
import {
  formatEurEs,
  formatPctEs
} from '../../../../core/utils/decimal-format';

@Component({
  selector: 'app-scenarios-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let res = auditResult();
    @let sa = res.scenario_a_all_bonified;
    @let sb = res.scenario_b_unbonified;
    @let sc = res.scenario_c_optimal;

    <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
      <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 class="font-display text-base font-bold text-[#0B1120]">
            Matriz Financiera Detallada de los 3 Escenarios
          </h3>
          <p class="text-xs text-slate-500">
            Cifras exactas en aritmética Decimal (ROUND_HALF_UP) con partidas desglosadas
          </p>
        </div>

        <button
          type="button"
          (click)="toggleRanking()"
          class="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200/80 bg-[#F6F7F9] px-3.5 py-2 text-xs font-semibold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/60"
        >
          @if (showFullRanking()) {
            Ocultar ranking de combinaciones ({{ res.ranking.length }})
          } @else {
            Ver ranking completo ({{ res.ranking.length }} combinaciones)
          }
        </button>
      </div>

      <!-- Matriz Financiera sin saltos de línea en importes -->
      <div class="mt-4 overflow-x-auto rounded-xl border border-slate-200/80">
        <table class="w-full min-w-[680px] border-collapse text-left text-xs sm:text-sm">
          <thead>
            <tr class="border-b border-slate-200/80 bg-[#F6F7F9] text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th class="px-4 py-3">Partida Financiera</th>
              <th class="whitespace-nowrap px-4 py-3 text-right text-[#E11D48]">
                Escenario A · 100 % Banco
              </th>
              <th class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                Escenario B · 0 % Banco
              </th>
              <th class="whitespace-nowrap bg-emerald-50/60 px-4 py-3 text-right text-[#059669]">
                Escenario C · Óptimo Valuriq
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-slate-200/60 font-mono text-xs tabular-nums">
            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Vinculaciones Aceptadas
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right font-sans text-slate-600">
                {{ sa.accepted_product_ids.length }} de {{ res.offer.linked_products.length }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right font-sans text-slate-600">
                0 de {{ res.offer.linked_products.length }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-sans font-bold text-[#059669]">
                {{ sc.accepted_product_ids.length }} de {{ res.offer.linked_products.length }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                TIN Nominal Aplicado
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-800">
                {{ fmtPct(sa.effective_initial_tin_pct) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-800">
                {{ fmtPct(sb.effective_initial_tin_pct) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-bold text-[#059669]">
                {{ fmtPct(sc.effective_initial_tin_pct) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Cuota Mensual Hipotecaria (Solo Préstamo)
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-800">
                {{ fmtEur(sa.initial_monthly_payment_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-800">
                {{ fmtEur(sb.initial_monthly_payment_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-semibold text-[#0B1120]">
                {{ fmtEur(sc.initial_monthly_payment_eur) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Desembolso Mensual Real (Año 1 con Seguros)
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-[#E11D48]">
                {{ fmtEur(sa.initial_total_monthly_outflow_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-800">
                {{ fmtEur(sb.initial_total_monthly_outflow_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-bold text-[#059669]">
                {{ fmtEur(sc.initial_total_monthly_outflow_eur) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Capital Principal Amortizado
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">
                {{ fmtEur(sa.principal_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">
                {{ fmtEur(sb.principal_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right text-slate-800">
                {{ fmtEur(sc.principal_eur) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Gastos Iniciales (Apertura + Tasación + Otros)
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">
                {{ fmtEur(sa.initial_expenses_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">
                {{ fmtEur(sb.initial_expenses_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right text-slate-800">
                {{ fmtEur(sc.initial_expenses_eur) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Intereses Hipotecarios Totales
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-700">
                {{ fmtEur(sa.total_interest_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-700">
                {{ fmtEur(sb.total_interest_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-semibold text-[#0B1120]">
                {{ fmtEur(sc.total_interest_eur) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Coste Total en Seguros y Vinculaciones
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-[#E11D48]">
                {{ fmtEur(sa.total_linked_cost_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-700">
                {{ fmtEur(sb.total_linked_cost_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-semibold text-[#059669]">
                {{ fmtEur(sc.total_linked_cost_eur) }}
              </td>
            </tr>

            <tr class="hover:bg-slate-50/70">
              <td class="px-4 py-2.5 font-sans font-medium text-slate-700">
                Sobrecoste Vinculaciones vs. Mercado Libre
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right font-bold text-[#E11D48]">
                +{{ fmtEur(sa.total_linked_overcost_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-slate-500">
                0,00 €
              </td>
              <td class="whitespace-nowrap bg-emerald-50/25 px-4 py-2.5 text-right font-semibold text-slate-800">
                +{{ fmtEur(sc.total_linked_overcost_eur) }}
              </td>
            </tr>

            <tr class="bg-[#F6F7F9] font-bold">
              <td class="px-4 py-3 font-sans text-[#0B1120]">
                TAE REAL OCULTA (TIR Anualizada)
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-[#E11D48]">
                {{ fmtPct(sa.tae_real_pct) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-[#0B1120]">
                {{ fmtPct(sb.tae_real_pct) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-100/60 px-4 py-3 text-right font-extrabold text-[#059669]">
                {{ fmtPct(sc.tae_real_pct) }}
              </td>
            </tr>

            <tr class="bg-[#0B1120] text-white">
              <td class="px-4 py-3.5 font-sans font-bold">
                DESEMBOLSO TOTAL REAL
              </td>
              <td class="whitespace-nowrap px-4 py-3.5 text-right font-bold text-rose-300">
                {{ fmtEur(sa.total_cost_eur) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3.5 text-right font-bold text-slate-200">
                {{ fmtEur(sb.total_cost_eur) }}
              </td>
              <td class="whitespace-nowrap bg-[#059669] px-4 py-3.5 text-right text-sm font-extrabold text-white">
                {{ fmtEur(sc.total_cost_eur) }}
              </td>
            </tr>

            <tr class="bg-emerald-50/60 font-bold">
              <td class="px-4 py-3 font-sans text-[#0B1120]">
                Ahorro Neto vs. Escenario A (100 % Banco)
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-slate-400">
                0,00 €
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-[#0B1120]">
                +{{ fmtEur(sb.savings_vs_all_bonified_eur) }}
              </td>
              <td class="whitespace-nowrap bg-emerald-100/80 px-4 py-3 text-right font-extrabold text-[#059669]">
                +{{ fmtEur(sc.savings_vs_all_bonified_eur) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Ranking Completo de las Combinaciones Auditadas -->
      @if (showFullRanking()) {
        <div class="mt-5 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-4">
          <h4 class="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
            Ranking de las {{ res.ranking.length }} Combinaciones Auditadas (Ordenadas de Menor a Mayor Coste Real)
          </h4>
          <div class="max-h-80 overflow-y-auto rounded-lg border border-slate-200/80 bg-white">
            <table class="w-full min-w-[650px] border-collapse text-left text-xs">
              <thead class="sticky top-0 border-b border-slate-200 bg-[#F6F7F9] text-[11px] font-bold uppercase text-slate-600">
                <tr>
                  <th class="px-3.5 py-2.5">Pos.</th>
                  <th class="px-3.5 py-2.5">Combinación de Vinculaciones</th>
                  <th class="whitespace-nowrap px-3.5 py-2.5 text-right">TIN</th>
                  <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Cuota Mes</th>
                  <th class="whitespace-nowrap px-3.5 py-2.5 text-right">TAE Real</th>
                  <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Desembolso Total</th>
                  <th class="whitespace-nowrap px-3.5 py-2.5 text-right">Ahorro vs. Banco</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 font-mono tabular-nums">
                @for (combo of res.ranking; track combo.combination_id) {
                  <tr
                    [class]="
                      combo.rank === 1
                        ? 'bg-emerald-50/70 font-semibold hover:bg-emerald-100/50'
                        : 'hover:bg-slate-50'
                    "
                  >
                    <td class="whitespace-nowrap px-3.5 py-2 font-bold text-slate-700">#{{ combo.rank }}</td>
                    <td class="px-3.5 py-2 font-sans text-[#0B1120]">
                      @if (combo.accepted_product_names.length > 0) {
                        {{ combo.accepted_product_names.join(' + ') }}
                      } @else {
                        <span class="italic text-slate-400">Ninguna (0 % vinculación)</span>
                      }
                    </td>
                    <td class="whitespace-nowrap px-3.5 py-2 text-right text-slate-600">
                      {{ fmtPct(combo.effective_initial_tin_pct) }}
                    </td>
                    <td class="whitespace-nowrap px-3.5 py-2 text-right text-slate-700">
                      {{ fmtEur(combo.initial_monthly_payment_eur) }}
                    </td>
                    <td class="whitespace-nowrap px-3.5 py-2 text-right font-semibold text-[#0B1120]">
                      {{ fmtPct(combo.tae_real_pct) }}
                    </td>
                    <td class="whitespace-nowrap px-3.5 py-2 text-right font-bold text-[#0B1120]">
                      {{ fmtEur(combo.total_cost_eur) }}
                    </td>
                    <td
                      [class]="
                        combo.rank === 1
                          ? 'whitespace-nowrap px-3.5 py-2 text-right font-extrabold text-[#059669]'
                          : 'whitespace-nowrap px-3.5 py-2 text-right font-semibold text-slate-600'
                      "
                    >
                      {{ fmtEur(combo.savings_vs_all_bonified_eur) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `
})
export class ScenariosTableComponent {
  readonly auditResult = input.required<MortgageAuditResult>();
  readonly showFullRanking = signal<boolean>(true);

  toggleRanking(): void {
    this.showFullRanking.update((v) => !v);
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  fmtPct(value: string | number | null | undefined): string {
    return formatPctEs(value, 2);
  }
}
