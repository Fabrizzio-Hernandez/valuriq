import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  Legend,
  LinearScale,
  Tooltip
} from 'chart.js';

import {
  BankBattleComparisonResult,
  BankBattleEntry,
  LinkedProduct,
  LinkedProductCategory,
  LinkedProductPaymentMode,
  MortgageOfferInput,
  MortgageType
} from '../../core/models/mortgage.models';
import { ValuriqApiService } from '../../core/services/valuriq-api.service';
import {
  DEFAULT_VALURIQ_OFFER,
  ValuriqWorkspaceService
} from '../../core/services/valuriq-workspace.service';
import {
  extractApiError,
  formatCleanInput,
  formatEurEs,
  formatPctEs,
  serializeOfferPayload,
  toNumber,
  toSafeInt
} from '../../core/utils/decimal-format';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface DrawerLinkedProductControls {
  id: FormControl<string>;
  name: FormControl<string>;
  category: FormControl<LinkedProductCategory>;
  bonus_pct: FormControl<string>;
  annual_bank_cost_eur: FormControl<string>;
  annual_market_cost_eur: FormControl<string>;
  apply_ipc: FormControl<boolean>;
  annual_age_increase_pct: FormControl<string>;
  payment_mode: FormControl<LinkedProductPaymentMode>;
  puf_amount_eur: FormControl<string>;
  puf_coverage_years: FormControl<number>;
}

interface DrawerOfferFormControls {
  offer_name: FormControl<string>;
  bank_name: FormControl<string>;
  principal_eur: FormControl<string>;
  term_years: FormControl<number>;
  mortgage_type: FormControl<MortgageType>;
  base_tin_pct: FormControl<string>;
  fixed_years: FormControl<number>;
  euribor_pct: FormControl<string>;
  differential_pct: FormControl<string>;
  min_tin_floor_pct: FormControl<string>;
  opening_commission_pct: FormControl<string>;
  appraisal_cost_eur: FormControl<string>;
  other_initial_expenses_eur: FormControl<string>;
  estimated_ipc_pct: FormControl<string>;
  linked_products: FormArray<FormGroup<DrawerLinkedProductControls>>;
}

@Component({
  selector: 'app-bank-battle-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <!-- Cabecera Ejecutiva -->
      <div class="mb-7 flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 lg:flex-row lg:items-end">
        <div>
          <div class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#059669]">
            Paso 3 · Batalla de Bancos (2 a 3 Ofertas)
          </div>
          <h1 class="mt-2 font-display text-2xl font-extrabold tracking-tight text-[#0B1120] sm:text-3xl">
            Comparador Multi-Oferta por Escenario Óptimo (C)
          </h1>
          <p class="mt-1 text-sm text-slate-600">
            Valuriq optimiza primero cada banco con su algoritmo 2<sup>N</sup> y enfrenta sus mejores estrategias (desembolso neto total y TAE Real Oculta).
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            (click)="loadThreeBanksPreset()"
            [disabled]="loading()"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-bold text-[#0B1120] shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            <svg class="h-3.5 w-3.5 text-[#059669]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Cargar preset de 3 bancos (Fija PUF vs. Fija Digital 2,85 % vs. Mixta 5 años)
          </button>

          @if (offers().length < 3) {
            <button
              type="button"
              (click)="openNewOfferDrawer()"
              [disabled]="loading()"
              class="inline-flex items-center gap-1.5 rounded-xl bg-[#0B1120] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              <span>+ Añadir oferta ({{ offers().length }}/3)</span>
            </button>
          }
        </div>
      </div>

      @if (errorMsg()) {
        <div class="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-[#E11D48]">
          {{ errorMsg() }}
        </div>
      }

      @if (battleResult(); as battle) {
        <div class="space-y-6">
          <!-- 1. TARJETA DEL BANCO GANADOR -->
          <section class="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#0B1120] p-6 text-white shadow-sm sm:p-7">
            <div class="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#10B981]/10 blur-3xl"></div>

            <div class="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
              <div class="max-w-3xl">
                <div class="flex flex-wrap items-center gap-2.5">
                  <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-[#10B981]">
                    🏆 Banco Ganador · #1 {{ battle.winner_bank_name }}
                  </span>
                  <span class="rounded-lg border border-slate-700/80 bg-slate-800/90 px-2.5 py-1 text-xs font-medium text-slate-300">
                    {{ battle.winner_offer_name }}
                  </span>
                </div>

                <h2 class="mt-3 font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
                  {{ battle.battle_verdict_headline }}
                </h2>
                <p class="mt-1.5 text-xs leading-relaxed text-slate-300">
                  {{ battle.battle_verdict_explanation }}
                </p>
              </div>

              <div class="flex shrink-0 flex-col items-start rounded-2xl border border-emerald-500/30 bg-emerald-950/35 px-5 py-4 lg:items-end">
                <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">
                  Ahorro vs. Peor Oferta
                </span>
                <p class="mt-1 whitespace-nowrap font-mono text-2xl font-extrabold tracking-tight tabular-nums text-[#10B981] sm:text-3xl">
                  {{ fmtEur(battle.savings_vs_last_eur) }}
                </p>
                <span class="mt-0.5 text-xs font-medium text-slate-300">
                  Ventaja frente al 2.º banco: <strong class="font-mono font-bold tabular-nums text-white">{{ fmtEur(battle.savings_vs_second_eur) }}</strong>
                </span>
              </div>
            </div>
          </section>

          <!-- 2. TARJETAS HEAD-TO-HEAD DE CADA BANCO (Escenario Óptimo C) -->
          <section
            [class]="
              battle.entries.length === 3
                ? 'grid grid-cols-1 gap-5 lg:grid-cols-3'
                : 'grid grid-cols-1 gap-5 lg:grid-cols-2'
            "
          >
            @for (entry of battle.entries; track entry.rank) {
              <article
                [class]="
                  entry.is_winner
                    ? 'flex flex-col justify-between rounded-2xl border-2 border-[#059669] bg-white p-6 shadow-md ring-4 ring-emerald-500/10'
                    : 'flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm'
                "
              >
                <div>
                  <!-- Cabecera Ranking + Acciones Editar / Eliminar -->
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <span
                        [class]="
                          entry.is_winner
                            ? 'inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#059669] font-mono text-xs font-extrabold text-white'
                            : 'inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-extrabold text-slate-700'
                        "
                      >
                        #{{ entry.rank }}
                      </span>
                      <div>
                        <span class="block font-display text-base font-extrabold text-[#0B1120]">
                          {{ entry.offer.bank_name }}
                        </span>
                        <span class="block text-xs text-slate-500">
                          {{ entry.offer.offer_name }}
                        </span>
                      </div>
                    </div>

                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        (click)="openEditOfferDrawer(findOfferIndex(entry))"
                        class="rounded-lg border border-slate-200/90 bg-[#F6F7F9] px-2.5 py-1.5 text-xs font-bold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/70"
                      >
                        Editar oferta
                      </button>
                      @if (offers().length > 2) {
                        <button
                          type="button"
                          (click)="removeOffer(findOfferIndex(entry))"
                          class="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-[#E11D48]"
                          title="Eliminar oferta de la comparativa"
                        >
                          ✕
                        </button>
                      }
                    </div>
                  </div>

                  <!-- Badge Diferencia vs Ganador -->
                  <div class="mt-3">
                    @if (entry.is_winner) {
                      <span class="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-bold text-[#059669]">
                        ✓ Mejor Opción Matemática (Escenario C Óptimo)
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-[#E11D48]">
                        +{{ fmtEur(entry.diff_vs_winner_eur) }} más cara que #1 {{ battle.winner_bank_name }}
                      </span>
                    }
                  </div>

                  <!-- KPI Principal: Desembolso Neto Total (Escenario C) -->
                  <div class="mt-4 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/80 p-4">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Desembolso Neto Total (Escenario Óptimo C)
                    </span>
                    <p
                      [class]="
                        entry.is_winner
                          ? 'mt-1 whitespace-nowrap font-mono text-2xl font-extrabold tabular-nums text-[#059669]'
                          : 'mt-1 whitespace-nowrap font-mono text-2xl font-extrabold tabular-nums text-[#0B1120]'
                      "
                    >
                      {{ fmtEur(entry.optimal_scenario.total_cost_eur) }}
                    </p>
                    <div class="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>Capital: {{ fmtEur(entry.offer.principal_eur) }}</span>
                      <span>{{ entry.offer.term_months / 12 }} años · {{ translateType(entry.offer.mortgage_type) }}</span>
                    </div>
                  </div>

                  <!-- Métricas Clave Head-to-Head -->
                  <dl class="mt-4 space-y-2.5 text-xs">
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                      <dt class="text-slate-500">Cuota Hipoteca (Mes 1)</dt>
                      <dd class="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                        {{ fmtEur(entry.optimal_scenario.initial_monthly_payment_eur) }}/mes
                      </dd>
                    </div>
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                      <dt class="text-slate-500">Cuota Real Mes 1 (con seguros)</dt>
                      <dd class="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-[#0B1120]">
                        {{ fmtEur(getMonth1RealOutflow(entry)) }}/mes
                      </dd>
                    </div>
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                      <dt class="text-slate-500">TIN Efectivo Óptimo</dt>
                      <dd class="whitespace-nowrap font-mono font-bold tabular-nums text-slate-800">
                        {{ fmtPct(entry.optimal_scenario.effective_initial_tin_pct) }}
                      </dd>
                    </div>
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                      <dt class="font-semibold text-[#0B1120]">TAE Real Oculta</dt>
                      <dd
                        [class]="
                          entry.is_winner
                            ? 'whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-[#059669]'
                            : 'whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-[#0B1120]'
                        "
                      >
                        {{ fmtPct(entry.optimal_scenario.tae_real_pct) }}
                      </dd>
                    </div>
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                      <dt class="text-slate-500">Intereses Totales</dt>
                      <dd class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-700">
                        {{ fmtEur(entry.optimal_scenario.total_interest_eur) }}
                      </dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="text-slate-500">Vinculaciones + Mercado Libre</dt>
                      <dd class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-700">
                        {{ fmtEur(sumInsurances(entry)) }}
                      </dd>
                    </div>
                  </dl>

                  <!-- Estrategia Óptima de Vinculaciones -->
                  <div class="mt-4 space-y-2 border-t border-slate-200/80 pt-3.5 text-xs">
                    <div>
                      <span class="text-[11px] font-bold uppercase tracking-wider text-[#059669]">
                        ✓ Aceptar en Banco ({{ getAcceptedNames(entry).length }})
                      </span>
                      <div class="mt-1.5 flex flex-wrap gap-1.5">
                        @if (getAcceptedNames(entry).length === 0) {
                          <span class="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            0 vinculaciones (100% libre)
                          </span>
                        } @else {
                          @for (prod of getAcceptedNames(entry); track prod) {
                            <span class="rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                              ✓ {{ prod }}
                            </span>
                          }
                        }
                      </div>
                    </div>

                    @if (getRejectedNames(entry).length > 0) {
                      <div>
                        <span class="text-[11px] font-bold uppercase tracking-wider text-[#E11D48]">
                          ✗ Rechazar / Contratar Fuera ({{ getRejectedNames(entry).length }})
                        </span>
                        <div class="mt-1.5 flex flex-wrap gap-1.5">
                          @for (prod of getRejectedNames(entry); track prod) {
                            <span class="rounded-md border border-rose-200 bg-rose-50/70 px-2 py-0.5 text-[11px] font-semibold text-rose-900">
                              ✗ {{ prod }}
                            </span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                </div>

                <!-- Botón inferior: Auditar este banco en profundidad -->
                <div class="mt-5 border-t border-slate-200/70 pt-3.5">
                  <button
                    type="button"
                    (click)="sendBankToAuditor(entry)"
                    class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/90 bg-[#F6F7F9] px-3 py-2 text-xs font-bold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/70"
                  >
                    <span>Auditar {{ entry.offer.bank_name }} a fondo</span>
                    <span>→</span>
                  </button>
                </div>
              </article>
            }
          </section>

          <!-- 3. GRÁFICA COMPARATIVA CHART.JS DE DESEMBOLSO TOTAL -->
          <section class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Desglose Visual Comparativo
                </span>
                <h3 class="mt-0.5 font-display text-base font-bold text-[#0B1120]">
                  Desembolso Neto Total por Banco (Capital + Intereses + Seguros y Gastos)
                </h3>
              </div>

              <a
                routerLink="/amortizacion"
                class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-[#F6F7F9] px-3.5 py-2 text-xs font-bold text-[#0B1120] transition hover:bg-slate-200/70"
              >
                <span>Simular Amortización Anticipada</span>
                <span>→</span>
              </a>
            </div>

            <div class="mt-4 h-[280px] w-full">
              <canvas #battleChartCanvas></canvas>
            </div>
          </section>
        </div>
      }

      <!-- DRAWER LATERAL (SLIDE-OVER) BAJO DEMANDA PARA EDITAR UN BANCO CONCRETO -->
      @if (editingOfferIndex() !== null) {
        <div class="fixed inset-0 z-50 flex justify-end">
          <!-- Backdrop -->
          <div
            class="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            (click)="closeDrawer()"
          ></div>

          <!-- Panel Lateral -->
          <div class="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-[#F6F7F9] p-5 shadow-2xl sm:p-6">
            <div class="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span class="text-[11px] font-bold uppercase tracking-wider text-[#059669]">
                  Configuración Individual de Oferta
                </span>
                <h3 class="font-display text-lg font-extrabold text-[#0B1120]">
                  @if (isCreatingNewOffer()) {
                    Añadir Oferta #{{ (editingOfferIndex() ?? 0) + 1 }} a la Batalla
                  } @else {
                    Editar Oferta · {{ drawerForm.controls.bank_name.value }}
                  }
                </h3>
              </div>
              <button
                type="button"
                (click)="closeDrawer()"
                class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
              >
                Cerrar ✕
              </button>
            </div>

            <form
              [formGroup]="drawerForm"
              (ngSubmit)="onSaveDrawerOffer()"
              class="space-y-4"
            >
              <!-- Datos Principales del Banco -->
              <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                  1. Condiciones del Banco
                </h4>

                <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label class="block text-xs font-semibold text-slate-600">Entidad Bancaria</label>
                    <input
                      type="text"
                      formControlName="bank_name"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 text-xs font-semibold text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600">Nombre de Oferta</label>
                    <input
                      type="text"
                      formControlName="offer_name"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 text-xs font-medium text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-600">Capital (€)</label>
                    <input
                      type="text"
                      formControlName="principal_eur"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600">Plazo (años)</label>
                    <input
                      type="number"
                      formControlName="term_years"
                      min="1"
                      max="40"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div class="col-span-2 sm:col-span-1">
                    <label class="block text-xs font-semibold text-slate-600">Modalidad</label>
                    <select
                      formControlName="mortgage_type"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-2.5 py-2 text-xs font-semibold text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                    >
                      <option value="FIXED">Fija</option>
                      <option value="MIXED">Mixta</option>
                      <option value="VARIABLE">Variable</option>
                    </select>
                  </div>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  @if (drawerForm.controls.mortgage_type.value !== 'VARIABLE') {
                    <div>
                      <label class="block text-xs font-semibold text-slate-600">TIN Base Sin Bonif. (%)</label>
                      <input
                        type="text"
                        formControlName="base_tin_pct"
                        class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                      />
                    </div>
                  }
                  @if (drawerForm.controls.mortgage_type.value === 'MIXED') {
                    <div>
                      <label class="block text-xs font-semibold text-slate-600">Años Tramo Fijo</label>
                      <input
                        type="number"
                        formControlName="fixed_years"
                        min="1"
                        max="39"
                        class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                      />
                    </div>
                  }
                  @if (drawerForm.controls.mortgage_type.value !== 'FIXED') {
                    <div>
                      <label class="block text-xs font-semibold text-slate-600">Euríbor Est. (%)</label>
                      <input
                        type="text"
                        formControlName="euribor_pct"
                        class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-600">Diferencial Base (%)</label>
                      <input
                        type="text"
                        formControlName="differential_pct"
                        class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                      />
                    </div>
                  }
                  <div>
                    <label class="block text-xs font-semibold text-slate-600">Tasación (€)</label>
                    <input
                      type="text"
                      formControlName="appraisal_cost_eur"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-[#F6F7F9] px-3 py-2 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <!-- Productos Vinculados (Acordeones Compactos) -->
              <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                    2. Vinculaciones ({{ linkedProductsArray.length }}/12)
                  </h4>
                  @if (linkedProductsArray.length < 12) {
                    <button
                      type="button"
                      (click)="addDrawerLinkedProduct()"
                      class="rounded-lg border border-slate-200 bg-[#F6F7F9] px-2.5 py-1 text-xs font-bold text-[#059669] transition hover:bg-emerald-50"
                    >
                      + Añadir vinculación
                    </button>
                  }
                </div>

                <div class="mt-3 space-y-2.5" formArrayName="linked_products">
                  @for (prodCtrl of linkedProductsArray.controls; track $index; let idx = $index) {
                    <div
                      [formGroupName]="idx"
                      class="rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-3"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          formControlName="name"
                          class="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-[#0B1120]"
                        />
                        <select
                          formControlName="payment_mode"
                          class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#0B1120]"
                        >
                          <option value="ANNUAL">Pago Anual</option>
                          <option value="PUF_FINANCED">PUF Financiada</option>
                        </select>
                        <button
                          type="button"
                          (click)="removeDrawerLinkedProduct(idx)"
                          class="rounded-md px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-rose-50 hover:text-[#E11D48]"
                        >
                          ✕
                        </button>
                      </div>

                      <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <label class="block text-[11px] text-slate-500">Bonif. (-%)</label>
                          <input
                            type="text"
                            formControlName="bonus_pct"
                            class="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-bold tabular-nums text-[#059669]"
                          />
                        </div>
                        @if (prodCtrl.controls.payment_mode.value === 'PUF_FINANCED') {
                          <div>
                            <label class="block text-[11px] font-semibold text-[#E11D48]">Importe PUF (€)</label>
                            <input
                              type="text"
                              formControlName="puf_amount_eur"
                              class="mt-0.5 w-full rounded-md border border-rose-200 bg-white px-2 py-1 font-mono text-xs font-bold tabular-nums text-[#E11D48]"
                            />
                          </div>
                          <div>
                            <label class="block text-[11px] font-semibold text-[#E11D48]">Años cobertura</label>
                            <input
                              type="number"
                              formControlName="puf_coverage_years"
                              min="1"
                              max="40"
                              class="mt-0.5 w-full rounded-md border border-rose-200 bg-white px-2 py-1 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                            />
                          </div>
                        } @else {
                          <div>
                            <label class="block text-[11px] text-slate-500">Banco (€/año)</label>
                            <input
                              type="text"
                              formControlName="annual_bank_cost_eur"
                              class="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                            />
                          </div>
                          <div>
                            <label class="block text-[11px] text-slate-500">Mercado (€/año)</label>
                            <input
                              type="text"
                              formControlName="annual_market_cost_eur"
                              class="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                            />
                          </div>
                        }
                      </div>

                      <div class="mt-2 grid grid-cols-3 items-center gap-2 border-t border-slate-200/60 pt-2 text-xs">
                        @if (prodCtrl.controls.payment_mode.value === 'PUF_FINANCED') {
                          <div>
                            <label class="block text-[11px] text-slate-500">Mercado (€/año)</label>
                            <input
                              type="text"
                              formControlName="annual_market_cost_eur"
                              class="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                            />
                          </div>
                        }
                        <label class="flex items-center gap-1.5 pt-2 text-[11px] font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            formControlName="apply_ipc"
                            class="h-3.5 w-3.5 rounded border-slate-300 text-[#059669]"
                          />
                          <span>Indexado a IPC</span>
                        </label>
                        <div>
                          <label class="block text-[11px] text-slate-500">Subida edad (%/a)</label>
                          <input
                            type="text"
                            formControlName="annual_age_increase_pct"
                            class="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs tabular-nums text-[#0B1120]"
                          />
                        </div>
                      </div>
                    </div>
                  }
                </div>
              </div>

              <div class="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  (click)="closeDrawer()"
                  class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  class="rounded-xl bg-[#0B1120] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800"
                >
                  Guardar y Recalcular Batalla
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    </main>
  `
})
export class BankBattlePageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(ValuriqApiService);
  private readonly router = inject(Router);
  readonly workspace = inject(ValuriqWorkspaceService);

  @ViewChild('battleChartCanvas')
  private battleChartCanvas?: ElementRef<HTMLCanvasElement>;
  private chartInstance: Chart | null = null;

  readonly offers = signal<MortgageOfferInput[]>([]);
  readonly battleResult = signal<BankBattleComparisonResult | null>(
    this.workspace.lastBattleResult()
  );
  readonly loading = signal<boolean>(false);
  readonly errorMsg = signal<string | null>(null);

  readonly editingOfferIndex = signal<number | null>(null);
  readonly isCreatingNewOffer = signal<boolean>(false);

  readonly drawerForm = new FormGroup<DrawerOfferFormControls>({
    offer_name: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    bank_name: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    principal_eur: new FormControl<string>('220000', { nonNullable: true, validators: [Validators.required] }),
    term_years: new FormControl<number>(30, { nonNullable: true, validators: [Validators.required] }),
    mortgage_type: new FormControl<MortgageType>('FIXED', { nonNullable: true }),
    base_tin_pct: new FormControl<string>('3.30', { nonNullable: true }),
    fixed_years: new FormControl<number>(5, { nonNullable: true }),
    euribor_pct: new FormControl<string>('2.50', { nonNullable: true }),
    differential_pct: new FormControl<string>('0.90', { nonNullable: true }),
    min_tin_floor_pct: new FormControl<string>('0.00', { nonNullable: true }),
    opening_commission_pct: new FormControl<string>('0.00', { nonNullable: true }),
    appraisal_cost_eur: new FormControl<string>('450.00', { nonNullable: true }),
    other_initial_expenses_eur: new FormControl<string>('0.00', { nonNullable: true }),
    estimated_ipc_pct: new FormControl<string>('2.00', { nonNullable: true }),
    linked_products: new FormArray<FormGroup<DrawerLinkedProductControls>>([])
  });

  get linkedProductsArray(): FormArray<FormGroup<DrawerLinkedProductControls>> {
    return this.drawerForm.controls.linked_products;
  }

  constructor() {
    effect(() => {
      const result = this.battleResult();
      if (result) {
        queueMicrotask(() => this.renderChart(result));
      }
    });
  }

  ngOnInit(): void {
    const existingOffers = this.workspace.battleOffers();
    if (existingOffers.length >= 2) {
      this.offers.set(structuredClone(existingOffers));
      this.runComparison(existingOffers);
      return;
    }

    if (existingOffers.length === 1) {
      const userOffer = structuredClone(existingOffers[0]);
      this.loading.set(true);
      this.api.getBattlePresets().subscribe({
        next: (presetList) => {
          const combined = [
            userOffer,
            ...presetList.slice(1, 3)
          ];
          this.offers.set(combined);
          this.workspace.battleOffers.set(combined);
          this.runComparison(combined);
        },
        error: () => {
          this.loadThreeBanksPreset();
        }
      });
      return;
    }

    this.loadThreeBanksPreset();
  }

  ngAfterViewInit(): void {
    const current = this.battleResult();
    if (current) {
      this.renderChart(current);
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  loadThreeBanksPreset(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.api.getBattlePresets().subscribe({
      next: (presetList) => {
        const list = structuredClone(presetList);
        this.offers.set(list);
        this.workspace.battleOffers.set(list);
        this.runComparison(list);
      },
      error: (err) => {
        this.errorMsg.set(
          extractApiError(err, 'No se pudo cargar el preset de Batalla de Bancos.')
        );
        this.loading.set(false);
      }
    });
  }

  runComparison(offerList: MortgageOfferInput[]): void {
    const serialized = offerList.map((o) => serializeOfferPayload(o));
    this.loading.set(true);
    this.errorMsg.set(null);

    this.api.compareBankOffers(serialized).subscribe({
      next: (res) => {
        this.battleResult.set(res);
        this.workspace.lastBattleResult.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          extractApiError(err, 'Error al comparar las ofertas bancarias.')
        );
        this.loading.set(false);
      }
    });
  }

  findOfferIndex(entry: BankBattleEntry): number {
    const idx = this.offers().findIndex(
      (o) =>
        o.bank_name === entry.offer.bank_name &&
        o.offer_name === entry.offer.offer_name
    );
    return idx >= 0 ? idx : Math.max(0, entry.rank - 1);
  }

  openEditOfferDrawer(offerIndex: number): void {
    const target = this.offers()[offerIndex];
    if (!target) {
      return;
    }
    this.isCreatingNewOffer.set(false);
    this.editingOfferIndex.set(offerIndex);
    this.populateDrawerForm(target);
  }

  openNewOfferDrawer(): void {
    const currentList = this.offers();
    if (currentList.length >= 3) {
      return;
    }
    const baseTemplate = structuredClone(
      currentList[0] ?? DEFAULT_VALURIQ_OFFER
    );
    baseTemplate.bank_name = `Banco Comparado #${currentList.length + 1}`;
    baseTemplate.offer_name = `Oferta Alternativa #${currentList.length + 1}`;

    this.isCreatingNewOffer.set(true);
    this.editingOfferIndex.set(currentList.length);
    this.populateDrawerForm(baseTemplate);
  }

  closeDrawer(): void {
    this.editingOfferIndex.set(null);
    this.isCreatingNewOffer.set(false);
  }

  addDrawerLinkedProduct(): void {
    if (this.linkedProductsArray.length >= 12) {
      return;
    }
    const idx = this.linkedProductsArray.length + 1;
    this.linkedProductsArray.push(
      this.createLinkedProductGroup({
        id: `vinc_${Date.now()}_${idx}`,
        name: `Vinculación #${idx}`,
        category: 'OTHER',
        bonus_pct: '0.10',
        annual_bank_cost_eur: '250.00',
        annual_market_cost_eur: '120.00',
        apply_ipc: true,
        annual_age_increase_pct: '0.00',
        payment_mode: 'ANNUAL',
        puf_amount_eur: '0.00',
        puf_coverage_years: 10
      })
    );
  }

  removeDrawerLinkedProduct(index: number): void {
    this.linkedProductsArray.removeAt(index);
  }

  onSaveDrawerOffer(): void {
    const idx = this.editingOfferIndex();
    if (idx === null) {
      return;
    }
    const updatedOffer = this.extractDrawerOffer();
    const nextList = [...this.offers()];
    if (idx >= nextList.length) {
      nextList.push(updatedOffer);
    } else {
      nextList[idx] = updatedOffer;
    }
    this.offers.set(nextList);
    this.workspace.battleOffers.set(nextList);
    this.closeDrawer();
    this.runComparison(nextList);
  }

  removeOffer(offerIndex: number): void {
    const currentList = this.offers();
    if (currentList.length <= 2) {
      return;
    }
    const nextList = currentList.filter((_, idx) => idx !== offerIndex);
    this.offers.set(nextList);
    this.workspace.battleOffers.set(nextList);
    this.runComparison(nextList);
  }

  sendBankToAuditor(entry: BankBattleEntry): void {
    this.workspace.updateActiveOffer(entry.offer);
    this.workspace.activePresetId.set(null);
    this.workspace.activeSlug.set(null);
    void this.router.navigate(['/auditor']);
  }

  getMonth1RealOutflow(entry: BankBattleEntry): string {
    return (
      entry.optimal_scenario.initial_total_monthly_outflow_eur ||
      entry.optimal_scenario.initial_monthly_payment_eur
    );
  }

  getAcceptedNames(entry: BankBattleEntry): string[] {
    if (entry.optimal_scenario.accepted_product_names?.length) {
      return entry.optimal_scenario.accepted_product_names;
    }
    const acceptedSet = new Set(entry.optimal_scenario.accepted_product_ids);
    return entry.offer.linked_products
      .filter((p) => acceptedSet.has(p.id))
      .map((p) => p.name);
  }

  getRejectedNames(entry: BankBattleEntry): string[] {
    if (entry.optimal_scenario.rejected_product_names?.length) {
      return entry.optimal_scenario.rejected_product_names;
    }
    const rejectedSet = new Set(entry.optimal_scenario.rejected_product_ids);
    return entry.offer.linked_products
      .filter((p) => rejectedSet.has(p.id))
      .map((p) => p.name);
  }

  sumInsurances(entry: BankBattleEntry): number {
    return toNumber(entry.optimal_scenario.total_linked_cost_eur);
  }

  translateType(type: string): string {
    if (type === 'FIXED') {
      return 'Fija';
    }
    if (type === 'MIXED') {
      return 'Mixta';
    }
    return 'Variable';
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  fmtPct(value: string | number | null | undefined): string {
    return formatPctEs(value, 2);
  }

  private populateDrawerForm(offer: MortgageOfferInput): void {
    this.drawerForm.patchValue({
      offer_name: offer.offer_name,
      bank_name: offer.bank_name,
      principal_eur: formatCleanInput(offer.principal_eur),
      term_years: Math.max(1, Math.round(offer.term_months / 12)),
      mortgage_type: offer.mortgage_type,
      base_tin_pct: formatCleanInput(offer.base_tin_pct),
      fixed_years: offer.fixed_years || 5,
      euribor_pct: formatCleanInput(offer.euribor_pct),
      differential_pct: formatCleanInput(offer.differential_pct),
      min_tin_floor_pct: formatCleanInput(offer.min_tin_floor_pct),
      opening_commission_pct: formatCleanInput(offer.opening_commission_pct),
      appraisal_cost_eur: formatCleanInput(offer.appraisal_cost_eur),
      other_initial_expenses_eur: formatCleanInput(offer.other_initial_expenses_eur),
      estimated_ipc_pct: formatCleanInput(offer.estimated_ipc_pct)
    });

    this.linkedProductsArray.clear();
    for (const prod of offer.linked_products) {
      this.linkedProductsArray.push(this.createLinkedProductGroup(prod));
    }
  }

  private createLinkedProductGroup(
    prod: LinkedProduct
  ): FormGroup<DrawerLinkedProductControls> {
    return new FormGroup<DrawerLinkedProductControls>({
      id: new FormControl<string>(prod.id, { nonNullable: true }),
      name: new FormControl<string>(prod.name, { nonNullable: true }),
      category: new FormControl<LinkedProductCategory>(prod.category, {
        nonNullable: true
      }),
      bonus_pct: new FormControl<string>(formatCleanInput(prod.bonus_pct), {
        nonNullable: true
      }),
      annual_bank_cost_eur: new FormControl<string>(
        formatCleanInput(prod.annual_bank_cost_eur),
        { nonNullable: true }
      ),
      annual_market_cost_eur: new FormControl<string>(
        formatCleanInput(prod.annual_market_cost_eur),
        { nonNullable: true }
      ),
      apply_ipc: new FormControl<boolean>(prod.apply_ipc, { nonNullable: true }),
      annual_age_increase_pct: new FormControl<string>(
        formatCleanInput(prod.annual_age_increase_pct),
        { nonNullable: true }
      ),
      payment_mode: new FormControl<LinkedProductPaymentMode>(
        prod.payment_mode ?? 'ANNUAL',
        { nonNullable: true }
      ),
      puf_amount_eur: new FormControl<string>(
        formatCleanInput(prod.puf_amount_eur ?? '0.00'),
        { nonNullable: true }
      ),
      puf_coverage_years: new FormControl<number>(
        prod.puf_coverage_years ?? 10,
        { nonNullable: true }
      )
    });
  }

  private extractDrawerOffer(): MortgageOfferInput {
    const raw = this.drawerForm.getRawValue();
    return serializeOfferPayload({
      offer_name: raw.offer_name,
      bank_name: raw.bank_name,
      principal_eur: raw.principal_eur,
      term_months: Math.max(1, Math.min(40, toSafeInt(raw.term_years, 30))) * 12,
      mortgage_type: raw.mortgage_type,
      base_tin_pct: raw.base_tin_pct,
      fixed_years:
        raw.mortgage_type === 'MIXED'
          ? Math.max(1, Math.min(39, toSafeInt(raw.fixed_years, 5)))
          : 0,
      euribor_pct: raw.euribor_pct,
      differential_pct: raw.differential_pct,
      min_tin_floor_pct: raw.min_tin_floor_pct,
      opening_commission_pct: raw.opening_commission_pct,
      appraisal_cost_eur: raw.appraisal_cost_eur,
      other_initial_expenses_eur: raw.other_initial_expenses_eur,
      estimated_ipc_pct: raw.estimated_ipc_pct,
      linked_products: raw.linked_products
    });
  }

  private renderChart(result: BankBattleComparisonResult): void {
    const canvas = this.battleChartCanvas?.nativeElement;
    if (!canvas) {
      return;
    }
    this.destroyChart();

    const labels = result.entries.map(
      (e: BankBattleEntry) => `#${e.rank} ${e.offer.bank_name}`
    );
    const principalData = result.entries.map(
      (e: BankBattleEntry) =>
        toNumber(e.offer.principal_eur) +
        toNumber(e.optimal_scenario.initial_expenses_eur)
    );
    const interestData = result.entries.map((e: BankBattleEntry) =>
      toNumber(e.optimal_scenario.total_interest_eur)
    );
    const linkedAndMarketData = result.entries.map((e: BankBattleEntry) =>
      toNumber(e.optimal_scenario.total_linked_cost_eur)
    );

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Capital + Gastos Iniciales',
            data: principalData,
            backgroundColor: '#0B1120',
            borderRadius: 6
          },
          {
            label: 'Intereses Hipotecarios (Escenario C)',
            data: interestData,
            backgroundColor: '#059669',
            borderRadius: 6
          },
          {
            label: 'Seguros (Banco + Mercado Libre)',
            data: linkedAndMarketData,
            backgroundColor: '#F59E0B',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { size: 11, weight: 'bold' }
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${formatEurEs(ctx.parsed.y ?? 0)}`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false }
          },
          y: {
            stacked: true,
            ticks: {
              callback: (val) => `${Math.round(Number(val) / 1000)}k €`
            }
          }
        }
      }
    };

    this.chartInstance = new Chart(canvas, config);
  }

  private destroyChart(): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }
}
