import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';

import {
  DynamicUnlinkingStrategyResult,
  LinkedProduct,
  MortgageAuditResult
} from '../../../../core/models/mortgage.models';
import {
  formatDecimalEs,
  formatEurEs,
  formatPctEs,
  toNumber
} from '../../../../core/utils/decimal-format';

interface ProductDecisionView {
  product: LinkedProduct;
  accepted: boolean;
  isPuf: boolean;
  pufExtraInterestEur: number;
  bankCost: number;
  marketCost: number;
  annualOvercostEur: number;
  bankBarPct: number;
  marketBarPct: number;
}

@Component({
  selector: 'app-verdict-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let res = auditResult();
    @let sa = res.scenario_a_all_bonified;
    @let sb = res.scenario_b_unbonified;
    @let sc = res.scenario_c_optimal;
    @let dyn = dynamicStrategy();

    <div class="space-y-5">
      <!-- 1. HERO BENTO COMPACTO -->
      <section class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
        <!-- Franja Superior Limpia -->
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-[#F6F7F9]/70 px-5 py-3">
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span class="inline-flex h-2 w-2 rounded-full bg-[#059669]"></span>
            <span class="font-semibold text-[#0B1120]">
              {{ res.total_combinations_evaluated }} escenarios auditados
            </span>
            <span class="text-slate-300">·</span>
            <span>{{ res.offer.bank_name }}</span>
            <span class="text-slate-300">·</span>
            <span class="text-slate-500">{{ res.offer.offer_name }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            @if (totalPufExtraInterestEur() > 0) {
              <span
                class="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-[#E11D48]"
              >
                PUF detectada: +{{ fmtEur(totalPufExtraInterestEur()) }} en intereses ocultos
              </span>
            }

            @if (res.verdict.break_even_year !== null) {
              <span
                class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2.5 py-0.5 text-[11px] font-semibold text-[#059669]"
              >
                @if (res.verdict.break_even_year === 1) {
                  Punto de equilibrio: Rentable desde el 1.er año
                } @else {
                  Punto de equilibrio: Cruce en el Año {{ res.verdict.break_even_year }}
                }
              </span>
            }
          </div>
        </div>

        <!-- Bloque Dividido en Dos: Decisión Escaneable (Izquierda) + Ahorro Neto Obsidiana (Derecha) -->
        <div class="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-12 lg:items-stretch">
          <!-- Izquierda (7 cols): Decisión en 2 segundos + Índice de Trampa Bancaria -->
          <div class="flex flex-col justify-between space-y-5 lg:col-span-7">
            <div class="space-y-3.5">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Decisión Óptima de Contratación
                </span>
                <span class="font-mono text-xs font-semibold tabular-nums text-[#059669]">
                  TIN Óptimo {{ fmtPct(sc.effective_initial_tin_pct) }} · TAE Real {{ fmtPct(sc.tae_real_pct) }}
                </span>
              </div>

              <!-- Chips grandes: Aceptar vs Rechazar -->
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <!-- Bloque Aceptar -->
                <div class="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3.5">
                  <div class="flex items-center gap-1.5 text-xs font-bold text-[#059669]">
                    <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fill-rule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    <span>Aceptar con el banco ({{ sc.accepted_product_names.length }})</span>
                  </div>
                  <div class="mt-2.5 flex flex-wrap gap-1.5">
                    @if (sc.accepted_product_names.length > 0) {
                      @for (name of sc.accepted_product_names; track name) {
                        <span
                          class="inline-flex items-center rounded-lg border border-emerald-300/70 bg-white px-2.5 py-1 text-xs font-semibold text-[#0B1120]"
                        >
                          {{ name }}
                        </span>
                      }
                    } @else {
                      <span class="text-xs italic text-slate-500">
                        Ninguna (Hipoteca 100 % sin vincular)
                      </span>
                    }
                  </div>
                </div>

                <!-- Bloque Rechazar -->
                <div class="rounded-xl border border-rose-200/80 bg-rose-50/40 p-3.5">
                  <div class="flex items-center gap-1.5 text-xs font-bold text-[#E11D48]">
                    <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                      />
                    </svg>
                    <span>Rechazar del banco ({{ sc.rejected_product_names.length }})</span>
                  </div>
                  <div class="mt-2.5 flex flex-wrap gap-1.5">
                    @if (sc.rejected_product_names.length > 0) {
                      @for (name of sc.rejected_product_names; track name) {
                        <span
                          class="inline-flex items-center rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                        >
                          {{ name }}
                        </span>
                      }
                    } @else {
                      <span class="text-xs italic text-slate-500">
                        Ninguna (Todas las vinculaciones compensan)
                      </span>
                    }
                  </div>
                </div>
              </div>
            </div>

            <!-- Barra Visual de "Índice de Trampa Bancaria" -->
            <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/80 p-4">
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span class="font-bold text-[#0B1120]">
                  Índice de Trampa Bancaria (TIN Publicitado vs. TAE Real Oculta)
                </span>
                <span
                  class="whitespace-nowrap rounded-md bg-rose-100 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-[#E11D48]"
                >
                  +{{ fmtDecimal(res.verdict.hidden_tae_spread_pct) }} pp ocultos
                </span>
              </div>

              <div class="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  class="bg-[#0B1120] transition-all duration-300"
                  [style.width.%]="tinBarSharePct()"
                  title="TIN Gancho Publicitado"
                ></div>
                <div
                  class="bg-[#E11D48] transition-all duration-300"
                  [style.width.%]="100 - tinBarSharePct()"
                  title="Sobrecoste Oculto de Vinculaciones y Gastos"
                ></div>
              </div>

              <div class="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span class="inline-block h-2 w-2 rounded-full bg-[#0B1120]"></span>
                  <span class="ml-1 text-slate-500">TIN Gancho:</span>
                  <strong class="ml-1 whitespace-nowrap font-mono tabular-nums text-[#0B1120]">
                    {{ fmtPct(sa.effective_initial_tin_pct) }}
                  </strong>
                </div>
                <div class="text-center">
                  <span class="inline-block h-2 w-2 rounded-full bg-[#E11D48]"></span>
                  <span class="ml-1 text-slate-500">TAE Real Banco:</span>
                  <strong class="ml-1 whitespace-nowrap font-mono tabular-nums text-[#E11D48]">
                    {{ fmtPct(sa.tae_real_pct) }}
                  </strong>
                </div>
                <div class="text-right">
                  <span class="inline-block h-2 w-2 rounded-full bg-[#059669]"></span>
                  <span class="ml-1 text-slate-500">TAE Óptima:</span>
                  <strong class="ml-1 whitespace-nowrap font-mono tabular-nums text-[#059669]">
                    {{ fmtPct(sc.tae_real_pct) }}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          <!-- Derecha (5 cols): Tarjeta Obsidiana #0B1120 de Ahorro Neto Total -->
          <div class="lg:col-span-5">
            <div
              class="flex h-full flex-col justify-between rounded-2xl bg-[#0B1120] p-5 text-white sm:p-6"
            >
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-[#10B981]">
                    Ahorro Neto Total Auditado
                  </span>
                  <span class="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] tabular-nums text-slate-300">
                    {{ res.offer.term_months / 12 }} años
                  </span>
                </div>

                <div class="mt-2 font-display text-3xl font-extrabold tracking-tight tabular-nums text-white sm:text-4xl">
                  {{ fmtEur(res.verdict.net_savings_vs_all_bonified_eur) }}
                </div>
                <p class="mt-1 text-xs text-slate-400">
                  Ahorro real frente a la hipoteca 100 % bonificada del banco
                </p>
              </div>

              <div class="mt-5 space-y-2.5 border-t border-slate-800 pt-4 text-xs">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-slate-400">Ahorro vs. sin vincular (B):</span>
                  <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#10B981]">
                    +{{ fmtEur(res.verdict.net_savings_vs_unbonified_eur) }}
                  </span>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-slate-400">Sobrecoste en seguros evitado:</span>
                  <span class="whitespace-nowrap font-mono font-bold tabular-nums text-white">
                    {{ fmtEur(avoidedOvercostEur()) }}
                  </span>
                </div>
                @if (dyn && toNum(dyn.extra_savings_vs_static_optimum_eur) > 0) {
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-emerald-300">Ahorro extra cancelando por años:</span>
                    <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#10B981]">
                      +{{ fmtEur(dyn.extra_savings_vs_static_optimum_eur) }}
                    </span>
                  </div>
                } @else {
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-slate-400">Desembolso real Mes 1 (con seguros):</span>
                    <span class="whitespace-nowrap font-mono font-bold tabular-nums text-white">
                      {{ fmtEur(sc.initial_total_monthly_outflow_eur) }}/mes
                    </span>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. PLAN ÓPTIMO POR AÑOS (DESVINCULACIÓN DINÁMICA: ¿CUÁNDO CANCELAR TUS SEGUROS?) -->
      @if (dyn && dyn.product_strategies.length > 0) {
        <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
          <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div class="flex items-center gap-2">
                <span class="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#059669] ring-1 ring-emerald-200/80">
                  Desvinculación Dinámica
                </span>
                <h3 class="font-display text-sm font-bold text-[#0B1120] sm:text-base">
                  Plan Óptimo por Años (¿En qué año exacto cancelar cada seguro?)
                </h3>
              </div>
              <p class="mt-1 text-xs text-slate-500">
                A medida que baja el saldo pendiente de tu hipoteca, la bonificación del TIN ahorra menos intereses mientras la prima anual del seguro sube.
              </p>
            </div>

            <div class="shrink-0 rounded-xl border border-emerald-200/80 bg-emerald-50/50 px-4 py-2.5 text-right">
              <span class="block text-[10px] font-bold uppercase tracking-wider text-[#059669]">
                @if (toNum(dyn.extra_savings_vs_static_optimum_eur) > 0) {
                  Ahorro Extra vs. Óptimo Estático
                } @else {
                  Ahorro Total Plan por Años
                }
              </span>
              <span class="font-mono text-lg font-extrabold tabular-nums text-[#059669]">
                @if (toNum(dyn.extra_savings_vs_static_optimum_eur) > 0) {
                  +{{ fmtEur(dyn.extra_savings_vs_static_optimum_eur) }}
                } @else {
                  {{ fmtEur(dyn.total_savings_vs_all_bonified_eur) }}
                }
              </span>
            </div>
          </div>

          <!-- Línea de Tiempo Visual por Producto Vinculado -->
          <div class="mt-4 space-y-3">
            @for (strat of dyn.product_strategies; track strat.product_id) {
              @let keepPct = Math.round((strat.keep_years / strat.total_years) * 100);

              <div class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/60 p-3.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-display text-xs font-bold text-[#0B1120] sm:text-sm">
                      {{ strat.product_name }}
                    </span>
                    <span class="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-slate-600">
                      -{{ fmtPct(strat.bonus_pct) }} TIN
                    </span>
                    @if (strat.payment_mode === 'PUF_FINANCED' && toNum(strat.puf_extra_interest_eur) > 0) {
                      <span class="rounded-md bg-rose-100 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-[#E11D48]">
                        PUF · Genera +{{ fmtEur(strat.puf_extra_interest_eur) }} en intereses ocultos
                      </span>
                    }
                  </div>

                  <!-- Recomendación Exacta -->
                  <span
                    [class]="
                      strat.keep_years === 0
                        ? 'rounded-lg bg-rose-100/90 px-2.5 py-1 text-xs font-bold text-[#E11D48]'
                        : strat.keep_years === strat.total_years
                          ? 'rounded-lg bg-emerald-100/90 px-2.5 py-1 text-xs font-bold text-[#059669]'
                          : 'rounded-lg bg-[#0B1120] px-2.5 py-1 text-xs font-bold text-white'
                    "
                  >
                    {{ strat.recommendation }}
                  </span>
                </div>

                <!-- Barra de Línea de Tiempo Visual (Años 1 a Total) -->
                <div class="mt-3">
                  @if (strat.keep_years === strat.total_years) {
                    <div class="flex h-6 w-full items-center justify-between rounded-lg bg-[#059669] px-3 text-[11px] font-bold text-white">
                      <span>Años 1–{{ strat.total_years }}: Mantener con el banco toda la hipoteca</span>
                      <span class="font-mono tabular-nums">100 % del plazo</span>
                    </div>
                  } @else if (strat.keep_years === 0) {
                    <div class="flex h-6 w-full items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-bold text-[#E11D48]">
                      <span>Años 1–{{ strat.total_years }}: Rechazar desde el día 1 (Contratar en mercado libre / prescindir)</span>
                      <span class="font-mono tabular-nums">0 años en banco</span>
                    </div>
                  } @else {
                    <!-- Línea de tiempo dividida con punto de corte exacto -->
                    <div class="flex h-7 w-full items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-200/70 text-[11px] font-bold">
                      <div
                        class="flex h-full items-center justify-center truncate bg-[#059669] px-2.5 text-white"
                        [style.width.%]="Math.max(18, keepPct)"
                      >
                        Años 1–{{ strat.keep_years }}: Con el banco
                      </div>
                      <div class="flex h-full shrink-0 items-center bg-[#0B1120] px-2.5 font-mono text-[10px] text-[#10B981]">
                        ✂ Año {{ strat.cancel_at_year }}: Cancelar
                      </div>
                      <div class="flex h-full flex-1 items-center justify-center truncate bg-white px-2.5 text-slate-600">
                        Años {{ strat.cancel_at_year }}–{{ strat.total_years }}: Seguro libre
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }

      <!-- 3. DESGLOSE DE VINCULACIONES CON MINI BARRA PROPORCIONAL (BANCO VS MERCADO LIBRE) -->
      @if (productDecisions().length > 0) {
        <section class="rounded-2xl border border-slate-200/80 bg-white p-5">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="font-display text-sm font-bold text-[#0B1120]">
                Auditoría Individual de Productos Vinculados (Coste Banco vs. Mercado Libre)
              </h3>
              <p class="text-xs text-slate-500">
                Comparación de prima anual o Prima Única Financiada (PUF) y sobrecoste por vinculación
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            @for (item of productDecisions(); track item.product.id) {
              <div
                [class]="
                  item.accepted
                    ? 'flex flex-col justify-between rounded-xl border border-emerald-200/90 bg-emerald-50/20 p-4'
                    : 'flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4'
                "
              >
                <div>
                  <div class="flex items-center justify-between gap-2">
                    <span
                      [class]="
                        item.accepted
                          ? 'inline-flex items-center gap-1 rounded-md bg-emerald-100/90 px-2 py-0.5 text-[11px] font-bold text-[#059669]'
                          : 'inline-flex items-center gap-1 rounded-md bg-rose-100/90 px-2 py-0.5 text-[11px] font-bold text-[#E11D48]'
                      "
                    >
                      @if (item.accepted) {
                        ✓ Aceptar
                      } @else {
                        ✕ Rechazar
                      }
                    </span>
                    <span class="whitespace-nowrap rounded-md border border-slate-200/80 bg-[#F6F7F9] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-[#0B1120]">
                      -{{ fmtPct(item.product.bonus_pct) }}
                    </span>
                  </div>

                  <p class="mt-2.5 font-display text-sm font-bold text-[#0B1120]">
                    {{ item.product.name }}
                  </p>

                  @if (item.isPuf) {
                    <span class="mt-1.5 inline-block rounded-md bg-rose-100 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-[#E11D48]">
                      PUF {{ fmtEur(item.product.puf_amount_eur) }} · +{{ fmtEur(item.pufExtraInterestEur) }} intereses ocultos
                    </span>
                  }
                </div>

                <!-- Mini Barras Proporcionales: Banco vs Mercado Libre -->
                <div class="mt-3.5 space-y-2 border-t border-slate-100 pt-3 text-xs">
                  <div>
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="text-slate-500">
                        @if (item.isPuf) {
                          PUF anualizada ({{ item.product.puf_coverage_years || 10 }}a)
                        } @else {
                          Banco
                        }
                      </span>
                      <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-[#0B1120]">
                        {{ fmtEur(item.bankCost) }}/año
                      </span>
                    </div>
                    <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        [class]="item.accepted ? 'h-full rounded-full bg-[#059669]' : 'h-full rounded-full bg-[#E11D48]'"
                        [style.width.%]="item.bankBarPct"
                      ></div>
                    </div>
                  </div>

                  <div>
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="text-slate-500">Mercado libre</span>
                      <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-600">
                        {{ fmtEur(item.marketCost) }}/año
                      </span>
                    </div>
                    <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        class="h-full rounded-full bg-slate-400"
                        [style.width.%]="item.marketBarPct"
                      ></div>
                    </div>
                  </div>

                  <div class="flex items-center justify-between pt-1 text-[11px]">
                    <span class="font-medium text-slate-500">Sobrecoste Año 1:</span>
                    <span
                      [class]="
                        item.annualOvercostEur <= 0
                          ? 'whitespace-nowrap font-mono font-bold tabular-nums text-[#059669]'
                          : 'whitespace-nowrap font-mono font-bold tabular-nums text-[#E11D48]'
                      "
                    >
                      {{ item.annualOvercostEur > 0 ? '+' : '' }}{{ fmtEur(item.annualOvercostEur) }}/año
                    </span>
                  </div>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <!-- 4. RESUMEN DE LOS 3 ESCENARIOS (A / B / C) EN FORMATO LIMPIO SIN TABLA DUPLICADA -->
      <section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <!-- Escenario A: 100% Bonificada Banco -->
        <div class="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5">
          <div>
            <div class="flex items-center justify-between">
              <span class="rounded-md bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-[#E11D48] ring-1 ring-rose-200/70">
                Escenario A · 100 % Banco
              </span>
              <span class="font-mono text-xs tabular-nums text-slate-400">
                {{ sa.accepted_product_ids.length }}/{{ res.offer.linked_products.length }} vinc.
              </span>
            </div>

            <div class="mt-4 flex items-baseline justify-between rounded-xl bg-rose-50/50 p-3 ring-1 ring-rose-100">
              <div>
                <span class="block text-[10px] font-bold uppercase tracking-wider text-[#E11D48]">
                  TAE Real Oculta
                </span>
                <span class="font-mono text-2xl font-extrabold tabular-nums text-[#E11D48]">
                  {{ fmtPct(sa.tae_real_pct) }}
                </span>
              </div>
              <div class="text-right">
                <span class="block text-[10px] uppercase text-slate-500">TIN Publicitado</span>
                <span class="font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                  {{ fmtPct(sa.effective_initial_tin_pct) }}
                </span>
              </div>
            </div>

            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Cuota hipotecaria:</span>
                <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-[#0B1120]">
                  {{ fmtEur(sa.initial_monthly_payment_eur) }}/mes
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Cuota real Mes 1 (con seguros):</span>
                <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#E11D48]">
                  {{ fmtEur(sa.initial_total_monthly_outflow_eur) }}/mes
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Total en vinculaciones:</span>
                <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-[#E11D48]">
                  {{ fmtEur(sa.total_linked_cost_eur) }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-4 border-t border-slate-100 pt-3">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-xs font-semibold text-slate-500">Desembolso Total</span>
              <span class="whitespace-nowrap font-mono text-base font-extrabold tabular-nums text-[#0B1120]">
                {{ fmtEur(sa.total_cost_eur) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Escenario B: Sin Vinculaciones -->
        <div class="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5">
          <div>
            <div class="flex items-center justify-between">
              <span class="rounded-md bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                Escenario B · 0 % Banco
              </span>
              <span class="font-mono text-xs tabular-nums text-slate-400">
                0/{{ res.offer.linked_products.length }} vinc.
              </span>
            </div>

            <div class="mt-4 flex items-baseline justify-between rounded-xl bg-[#F6F7F9] p-3 ring-1 ring-slate-200/70">
              <div>
                <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  TAE Real Libre
                </span>
                <span class="font-mono text-2xl font-extrabold tabular-nums text-[#0B1120]">
                  {{ fmtPct(sb.tae_real_pct) }}
                </span>
              </div>
              <div class="text-right">
                <span class="block text-[10px] uppercase text-slate-500">TIN Base</span>
                <span class="font-mono text-sm font-bold tabular-nums text-slate-700">
                  {{ fmtPct(sb.effective_initial_tin_pct) }}
                </span>
              </div>
            </div>

            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Cuota hipotecaria:</span>
                <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-[#0B1120]">
                  {{ fmtEur(sb.initial_monthly_payment_eur) }}/mes
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Cuota real Mes 1 (con seguros):</span>
                <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#0B1120]">
                  {{ fmtEur(sb.initial_total_monthly_outflow_eur) }}/mes
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Seguros mercado libre:</span>
                <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-700">
                  {{ fmtEur(sb.total_linked_cost_eur) }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-4 border-t border-slate-100 pt-3">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-xs font-semibold text-slate-500">Desembolso Total</span>
              <span class="whitespace-nowrap font-mono text-base font-extrabold tabular-nums text-[#0B1120]">
                {{ fmtEur(sb.total_cost_eur) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Escenario C: Óptimo Matemático Valuriq -->
        <div class="flex flex-col justify-between rounded-2xl border-2 border-[#059669] bg-white p-5">
          <div>
            <div class="flex items-center justify-between">
              <span class="inline-flex items-center gap-1 rounded-md bg-[#059669] px-2.5 py-0.5 text-[11px] font-bold text-white">
                ✓ Escenario C · Óptimo Valuriq
              </span>
              <span class="font-mono text-xs font-semibold tabular-nums text-[#059669]">
                {{ sc.accepted_product_ids.length }}/{{ res.offer.linked_products.length }} vinc.
              </span>
            </div>

            <div class="mt-4 flex items-baseline justify-between rounded-xl bg-emerald-50/70 p-3 ring-1 ring-emerald-200/80">
              <div>
                <span class="block text-[10px] font-bold uppercase tracking-wider text-[#059669]">
                  TAE Real Mínima
                </span>
                <span class="font-mono text-2xl font-extrabold tabular-nums text-[#059669]">
                  {{ fmtPct(sc.tae_real_pct) }}
                </span>
              </div>
              <div class="text-right">
                <span class="block text-[10px] uppercase text-emerald-800/70">TIN Efectivo</span>
                <span class="font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                  {{ fmtPct(sc.effective_initial_tin_pct) }}
                </span>
              </div>
            </div>

            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Cuota hipotecaria:</span>
                <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-[#0B1120]">
                  {{ fmtEur(sc.initial_monthly_payment_eur) }}/mes
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Cuota real Mes 1 (con seguros):</span>
                <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#059669]">
                  {{ fmtEur(sc.initial_total_monthly_outflow_eur) }}/mes
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 text-slate-600">
                <span>Seguros optimizados:</span>
                <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-[#059669]">
                  {{ fmtEur(sc.total_linked_cost_eur) }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-4 border-t border-emerald-100 pt-3">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-xs font-bold text-[#059669]">Desembolso Total</span>
              <span class="whitespace-nowrap font-mono text-base font-extrabold tabular-nums text-[#059669]">
                {{ fmtEur(sc.total_cost_eur) }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  `
})
export class VerdictCardComponent {
  protected readonly Math = Math;

  readonly auditResult = input.required<MortgageAuditResult>();
  readonly dynamicStrategy = input<DynamicUnlinkingStrategyResult | null>(null);

  readonly totalPufExtraInterestEur = computed<number>(() => {
    const res = this.auditResult();
    return toNumber(res.scenario_a_all_bonified.puf_extra_interest_eur);
  });

  readonly tinBarSharePct = computed<number>(() => {
    const res = this.auditResult();
    const tin = Math.max(0, toNumber(res.scenario_a_all_bonified.effective_initial_tin_pct));
    const tae = Math.max(0.01, toNumber(res.scenario_a_all_bonified.tae_real_pct));
    const pct = Math.round((tin / tae) * 100);
    return Math.max(15, Math.min(95, pct));
  });

  readonly productDecisions = computed<ProductDecisionView[]>(() => {
    const res = this.auditResult();
    const dyn = this.dynamicStrategy();
    const acceptedSet = new Set(res.scenario_c_optimal.accepted_product_ids);

    const effectiveAnnualBankCost = (p: LinkedProduct): number => {
      if (p.payment_mode === 'PUF_FINANCED') {
        const cov = Math.max(1, p.puf_coverage_years || 10);
        return toNumber(p.puf_amount_eur) / cov;
      }
      return toNumber(p.annual_bank_cost_eur);
    };

    const maxAnnualCost = Math.max(
      1,
      ...res.offer.linked_products.map((p) =>
        Math.max(effectiveAnnualBankCost(p), toNumber(p.annual_market_cost_eur))
      )
    );

    return res.offer.linked_products.map((product) => {
      const isPuf = product.payment_mode === 'PUF_FINANCED';
      const bankCost = effectiveAnnualBankCost(product);
      const marketCost = toNumber(product.annual_market_cost_eur);
      const stratItem = dyn?.product_strategies.find((s) => s.product_id === product.id);
      const pufExtra = stratItem
        ? toNumber(stratItem.puf_extra_interest_eur)
        : isPuf
          ? toNumber(res.scenario_a_all_bonified.puf_extra_interest_eur)
          : 0;

      return {
        product,
        accepted: acceptedSet.has(product.id),
        isPuf,
        pufExtraInterestEur: pufExtra,
        bankCost,
        marketCost,
        annualOvercostEur: bankCost - marketCost,
        bankBarPct: bankCost > 0 ? Math.max(6, Math.round((bankCost / maxAnnualCost) * 100)) : 0,
        marketBarPct: marketCost > 0 ? Math.max(6, Math.round((marketCost / maxAnnualCost) * 100)) : 0
      };
    });
  });

  readonly avoidedOvercostEur = computed<number>(() => {
    const res = this.auditResult();
    return (
      toNumber(res.scenario_a_all_bonified.total_linked_overcost_eur) -
      toNumber(res.scenario_c_optimal.total_linked_overcost_eur)
    );
  });

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
