import { HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

import {
  DynamicUnlinkingStrategyResult,
  LinkedProduct,
  LinkedProductCategory,
  LinkedProductPaymentMode,
  MortgageAuditResult,
  MortgageOfferInput,
  MortgageType,
  PresetItemResponse
} from '../../core/models/mortgage.models';
import { ValuriqApiService } from '../../core/services/valuriq-api.service';
import {
  DEFAULT_VALURIQ_OFFER,
  ValuriqWorkspaceService
} from '../../core/services/valuriq-workspace.service';
import {
  extractApiError,
  formatCleanInput,
  formatDecimalEs,
  formatEurEs,
  formatPctEs,
  serializeOfferPayload,
  toNumber,
  toSafeInt
} from '../../core/utils/decimal-format';
import { AmortizationScheduleComponent } from './components/amortization-schedule/amortization-schedule.component';
import { CumulativeCostChartComponent } from './components/cumulative-cost-chart/cumulative-cost-chart.component';
import { ScenariosTableComponent } from './components/scenarios-table/scenarios-table.component';
import { StressTestCardComponent } from './components/stress-test-card/stress-test-card.component';
import { VerdictCardComponent } from './components/verdict-card/verdict-card.component';

type AnalyticalTab = 'verdict' | 'charts' | 'stress_schedule';

interface LinkedProductFormControls {
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

interface MortgageOfferFormControls {
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
  linked_products: FormArray<FormGroup<LinkedProductFormControls>>;
}

@Component({
  selector: 'app-auditor-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    VerdictCardComponent,
    ScenariosTableComponent,
    CumulativeCostChartComponent,
    StressTestCardComponent,
    AmortizationScheduleComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
      <!-- Sub-Barra de Acciones del Auditor: Presets + Saltos entre Herramientas + Compartir/PDF -->
      <section class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
        <!-- Selector Compacto de Presets en 1 Línea -->
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Presets:
          </span>
          @for (preset of presets(); track preset.id) {
            <button
              type="button"
              (click)="applyPreset(preset)"
              [class]="
                activePresetId() === preset.id
                  ? 'rounded-lg bg-[#0B1120] px-2.5 py-1 text-xs font-bold text-white shadow-2xs transition'
                  : 'rounded-lg bg-[#F6F7F9] px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200/70 hover:text-[#0B1120]'
              "
              [title]="preset.title + ' · ' + preset.subtitle"
            >
              {{ preset.badge }}
            </button>
          }

          @if (activeSlug(); as slug) {
            <span class="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#059669]">
              /{{ slug }}
            </span>
          }
        </div>

        <!-- Continuidad hacia Amortización / Batalla + Compartir / Exportar PDF -->
        <div class="flex flex-wrap items-center gap-2">
          @if (calculating()) {
            <span class="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              <span class="h-2 w-2 animate-ping rounded-full bg-[#059669]"></span>
              Actualizando...
            </span>
          }

          <button
            type="button"
            (click)="goToEarlyRepayment()"
            class="rounded-xl border border-slate-200/80 bg-[#F6F7F9] px-3 py-1.5 text-xs font-semibold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/60"
          >
            Simular amortización anticipada →
          </button>

          <button
            type="button"
            (click)="goToBankBattle()"
            class="rounded-xl border border-slate-200/80 bg-[#F6F7F9] px-3 py-1.5 text-xs font-semibold text-[#0B1120] transition hover:border-slate-300 hover:bg-slate-200/60"
          >
            Enfrentar con otro banco →
          </button>

          <button
            type="button"
            (click)="saveAndCopyShareLink()"
            [disabled]="savingSlug() || calculating()"
            class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-bold text-[#0B1120] transition hover:border-slate-300 hover:bg-[#F6F7F9] disabled:opacity-50"
          >
            <svg class="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            @if (savingSlug()) {
              <span>Guardando...</span>
            } @else {
              <span>Compartir</span>
            }
          </button>

          <button
            type="button"
            (click)="downloadPdfReport()"
            [disabled]="downloadingPdf() || calculating()"
            class="inline-flex items-center gap-1.5 rounded-xl bg-[#0B1120] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <svg class="h-3.5 w-3.5 text-[#10B981]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            @if (downloadingPdf()) {
              <span>Exportando...</span>
            } @else {
              <span>Exportar PDF</span>
            }
          </button>
        </div>
      </section>

      <!-- Banners de Notificación -->
      @if (shareMessage(); as msg) {
        <div class="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-950">
          <span>{{ msg }}</span>
          <button type="button" (click)="shareMessage.set(null)" class="ml-4 font-bold text-[#059669]">
            Cerrar
          </button>
        </div>
      }

      @if (errorBanner(); as err) {
        <div class="mb-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-950">
          <span>{{ err }}</span>
          <button type="button" (click)="errorBanner.set(null)" class="ml-4 font-bold text-[#E11D48]">
            Cerrar
          </button>
        </div>
      }

      <!-- LAYOUT DE DASHBOARD: PANEL IZQUIERDO STICKY + ÁREA ANALÍTICA DERECHA CON 3 PESTAÑAS -->
      <div class="grid grid-cols-1 items-start gap-6 pb-12 lg:grid-cols-12">
        <!-- PANEL IZQUIERDO STICKY CON SCROLL INDEPENDIENTE -->
        <aside
          class="lg:sticky lg:top-20 lg:col-span-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1"
        >
          <form
            [formGroup]="offerForm"
            (ngSubmit)="runAuditCalculation()"
            class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-5"
          >
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 class="font-display text-sm font-bold text-[#0B1120]">
                  Parámetros de la Oferta
                </h2>
                <p class="text-[11px] text-slate-500">
                  Recálculo automático en tiempo real
                </p>
              </div>

              <button
                type="submit"
                [disabled]="calculating()"
                class="rounded-lg border border-slate-200/80 bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200/70"
              >
                Recalcular
              </button>
            </div>

            <!-- Modalidad: Fija | Mixta | Variable -->
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-slate-700">
                Modalidad Hipotecaria
              </label>
              <div class="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-1">
                <button
                  type="button"
                  (click)="setMortgageType('FIXED')"
                  [class]="
                    selectedMortgageType() === 'FIXED'
                      ? 'rounded-lg bg-white py-1.5 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                      : 'rounded-lg py-1.5 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
                  "
                >
                  Fija
                </button>
                <button
                  type="button"
                  (click)="setMortgageType('MIXED')"
                  [class]="
                    selectedMortgageType() === 'MIXED'
                      ? 'rounded-lg bg-white py-1.5 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                      : 'rounded-lg py-1.5 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
                  "
                >
                  Mixta
                </button>
                <button
                  type="button"
                  (click)="setMortgageType('VARIABLE')"
                  [class]="
                    selectedMortgageType() === 'VARIABLE'
                      ? 'rounded-lg bg-white py-1.5 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                      : 'rounded-lg py-1.5 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
                  "
                >
                  Variable
                </button>
              </div>
            </div>

            <!-- Importe del Préstamo + Slider + Botones Rápidos -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-slate-700">Importe del Préstamo</label>
                <div class="flex gap-1">
                  @for (presetCap of ['150000', '220000', '300000']; track presetCap) {
                    <button
                      type="button"
                      (click)="setQuickPrincipal(presetCap)"
                      [class]="
                        offerForm.controls.principal_eur.value === presetCap
                          ? 'rounded-md bg-[#0B1120] px-2 py-0.5 font-mono text-[10px] font-bold text-white'
                          : 'rounded-md bg-[#F6F7F9] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 hover:bg-slate-200/70'
                      "
                    >
                      {{ +presetCap / 1000 }}k
                    </button>
                  }
                </div>
              </div>

              <div class="relative">
                <input
                  type="text"
                  formControlName="principal_eur"
                  class="w-full rounded-xl border border-slate-200/90 bg-[#F6F7F9]/60 py-2 pl-3 pr-9 font-mono text-sm font-bold tabular-nums text-[#0B1120] transition focus:border-[#0B1120] focus:bg-white focus:outline-none"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">
                  €
                </span>
              </div>

              <input
                type="range"
                min="50000"
                max="800000"
                step="5000"
                [value]="principalSliderValue()"
                (input)="onPrincipalSliderInput($event)"
                class="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200"
              />
            </div>

            <!-- Plazo en AÑOS (No en meses) + Slider + Botones 15 / 20 / 25 / 30 -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-slate-700">
                  Plazo de Amortización
                  <span class="font-normal text-slate-400">
                    ({{ (offerForm.controls.term_years.value || 30) * 12 }} meses)
                  </span>
                </label>
                <div class="flex gap-1">
                  @for (yr of [15, 20, 25, 30]; track yr) {
                    <button
                      type="button"
                      (click)="setQuickTermYears(yr)"
                      [class]="
                        offerForm.controls.term_years.value === yr
                          ? 'rounded-md bg-[#0B1120] px-2 py-0.5 font-mono text-[10px] font-bold text-white'
                          : 'rounded-md bg-[#F6F7F9] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 hover:bg-slate-200/70'
                      "
                    >
                      {{ yr }}a
                    </button>
                  }
                </div>
              </div>

              <div class="relative">
                <input
                  type="number"
                  formControlName="term_years"
                  min="1"
                  max="40"
                  class="w-full rounded-xl border border-slate-200/90 bg-[#F6F7F9]/60 py-2 pl-3 pr-14 font-mono text-sm font-bold tabular-nums text-[#0B1120] transition focus:border-[#0B1120] focus:bg-white focus:outline-none"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-slate-400">
                  años
                </span>
              </div>

              <input
                type="range"
                min="5"
                max="40"
                step="1"
                formControlName="term_years"
                class="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200"
              />
            </div>

            <!-- Tipos de Interés (TIN Base e IPC) -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-700">TIN Base (Sin Bonif.)</label>
                <div class="relative mt-1">
                  <input
                    type="text"
                    formControlName="base_tin_pct"
                    class="w-full rounded-xl border border-slate-200/90 bg-[#F6F7F9]/60 py-2 pl-3 pr-7 font-mono text-sm font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                  />
                  <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-bold text-slate-400">
                    %
                  </span>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-700">IPC Anual Estimado</label>
                <div class="relative mt-1">
                  <input
                    type="text"
                    formControlName="estimated_ipc_pct"
                    class="w-full rounded-xl border border-slate-200/90 bg-[#F6F7F9]/60 py-2 pl-3 pr-7 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                  />
                  <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-bold text-slate-400">
                    %
                  </span>
                </div>
              </div>
            </div>

            @if (selectedMortgageType() !== 'FIXED') {
              <div class="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-3">
                @if (selectedMortgageType() === 'MIXED') {
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-600">Tramo Fijo</label>
                    <div class="relative mt-1">
                      <input
                        type="number"
                        formControlName="fixed_years"
                        min="1"
                        max="35"
                        class="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-8 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                      />
                      <span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-400">
                        años
                      </span>
                    </div>
                  </div>
                }
                <div>
                  <label class="block text-[11px] font-semibold text-slate-600">Euríbor Est.</label>
                  <div class="relative mt-1">
                    <input
                      type="text"
                      formControlName="euribor_pct"
                      class="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-5 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                    />
                    <span class="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px] text-slate-400">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-600">Diferencial</label>
                  <div class="relative mt-1">
                    <input
                      type="text"
                      formControlName="differential_pct"
                      class="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-5 font-mono text-xs font-bold tabular-nums text-[#0B1120]"
                    />
                    <span class="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px] text-slate-400">
                      %
                    </span>
                  </div>
                </div>
              </div>
            }

            <!-- Gastos Iniciales y Entidad -->
            <div class="space-y-2.5 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-3">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500">Entidad Bancaria</label>
                  <input
                    type="text"
                    formControlName="bank_name"
                    class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1120]"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500">Nombre Oferta</label>
                  <input
                    type="text"
                    formControlName="offer_name"
                    class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-[#0B1120]"
                  />
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500">Apertura (%)</label>
                  <input
                    type="text"
                    formControlName="opening_commission_pct"
                    class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0B1120]"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500">Tasación (€)</label>
                  <input
                    type="text"
                    formControlName="appraisal_cost_eur"
                    class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0B1120]"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500">Otros (€)</label>
                  <input
                    type="text"
                    formControlName="other_initial_expenses_eur"
                    class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0B1120]"
                  />
                </div>
              </div>
            </div>

            <!-- VINCULACIONES EN ACORDEÓN COLAPSABLE -->
            <div class="border-t border-slate-100 pt-4">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-display text-xs font-bold uppercase tracking-wider text-[#0B1120]">
                    Vinculaciones ({{ linkedProductsArray.length }}/12)
                  </h3>
                  <p class="text-[11px] text-slate-500">
                    Haz clic en una fila para desplegar y editar
                  </p>
                </div>

                <button
                  type="button"
                  (click)="addLinkedProduct()"
                  [disabled]="linkedProductsArray.length >= 12"
                  class="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-[#059669] transition hover:bg-emerald-100 disabled:opacity-40"
                >
                  + Añadir
                </button>
              </div>

              <div formArrayName="linked_products" class="mt-3 space-y-2">
                @for (prodCtrl of linkedProductsArray.controls; track $index; let i = $index) {
                  @let isOpen = expandedProductIndex() === i;
                  @let isAccepted = isProductAcceptedInOptimal(prodCtrl.controls.id.value);
                  @let isPuf = prodCtrl.controls.payment_mode.value === 'PUF_FINANCED';
                  @let pufExtraInt = getProductPufExtraInterest(prodCtrl.controls.id.value);
                  @let surcharge = getProductAnnualSurcharge(prodCtrl);

                  <div
                    [formGroupName]="i"
                    class="overflow-hidden rounded-xl border border-slate-200/90 bg-white transition"
                  >
                    <button
                      type="button"
                      (click)="toggleProductAccordion(i)"
                      class="flex w-full items-center justify-between gap-2 bg-[#F6F7F9]/60 px-3 py-2.5 text-left transition hover:bg-slate-100/80"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="truncate font-display text-xs font-bold text-[#0B1120]">
                            {{ prodCtrl.controls.name.value || 'Vinculación' }}
                          </span>
                          @if (isPuf) {
                            <span class="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#E11D48]">
                              PUF
                            </span>
                          }
                        </div>
                        <div class="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums text-slate-500">
                          <span class="font-semibold text-[#0B1120]">
                            -{{ fmtDecimal(prodCtrl.controls.bonus_pct.value) }} %
                          </span>
                          <span>·</span>
                          @if (isPuf) {
                            <span class="font-semibold text-[#E11D48]">
                              PUF {{ fmtDecimal(prodCtrl.controls.puf_amount_eur.value, 0) }} € ({{ prodCtrl.controls.puf_coverage_years.value }}a)
                            </span>
                          } @else {
                            <span [class]="surcharge <= 0 ? 'text-[#059669]' : 'text-[#E11D48]'">
                              +{{ fmtDecimal(surcharge, 0) }} €/año
                            </span>
                          }
                        </div>
                      </div>

                      <div class="flex shrink-0 items-center gap-2">
                        <span
                          [class]="
                            isAccepted
                              ? 'rounded-md bg-emerald-100/90 px-2 py-0.5 text-[10px] font-bold text-[#059669]'
                              : 'rounded-md bg-rose-100/90 px-2 py-0.5 text-[10px] font-bold text-[#E11D48]'
                          "
                        >
                          @if (isAccepted) {
                            Aceptar
                          } @else {
                            Rechazar
                          }
                        </span>

                        <svg
                          class="h-4 w-4 text-slate-400 transition-transform duration-200"
                          [class.rotate-180]="isOpen"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    @if (isOpen) {
                      <div class="space-y-3 border-t border-slate-200/70 bg-white p-3.5">
                        <div>
                          <label class="block text-[11px] font-semibold text-slate-600">
                            Nombre del Producto Vinculado
                          </label>
                          <input
                            type="text"
                            formControlName="name"
                            class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="mb-1 block text-[11px] font-semibold text-slate-600">
                            Modalidad de Cobro del Seguro
                          </label>
                          <div class="grid grid-cols-2 gap-1 rounded-lg border border-slate-200/80 bg-[#F6F7F9] p-1">
                            <button
                              type="button"
                              (click)="setProductPaymentMode(i, 'ANNUAL')"
                              [class]="
                                !isPuf
                                  ? 'rounded-md bg-white py-1 text-[11px] font-bold text-[#0B1120] shadow-2xs transition'
                                  : 'rounded-md py-1 text-[11px] font-semibold text-slate-500 transition hover:text-[#0B1120]'
                              "
                            >
                              Pago Anual
                            </button>
                            <button
                              type="button"
                              (click)="setProductPaymentMode(i, 'PUF_FINANCED')"
                              [class]="
                                isPuf
                                  ? 'rounded-md bg-[#E11D48] py-1 text-[11px] font-bold text-white shadow-2xs transition'
                                  : 'rounded-md py-1 text-[11px] font-semibold text-slate-500 transition hover:text-[#0B1120]'
                              "
                            >
                              Prima Única Financiada (PUF)
                            </button>
                          </div>
                        </div>

                        @if (isPuf) {
                          <div class="space-y-2.5 rounded-xl border border-rose-200/80 bg-rose-50/40 p-3">
                            @if (pufExtraInt > 0) {
                              <div class="rounded-lg bg-rose-100/90 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-[#E11D48]">
                                PUF · Genera +{{ fmtEur(pufExtraInt) }} en intereses ocultos
                              </div>
                            }

                            <div class="grid grid-cols-2 gap-2.5">
                              <div>
                                <label class="block text-[11px] font-semibold text-slate-700">
                                  Importe PUF (€)
                                </label>
                                <input
                                  type="text"
                                  formControlName="puf_amount_eur"
                                  class="mt-1 w-full rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums text-[#E11D48] focus:border-[#E11D48] focus:outline-none"
                                />
                              </div>

                              <div>
                                <label class="block text-[11px] font-semibold text-slate-700">
                                  Años de cobertura
                                </label>
                                <input
                                  type="number"
                                  formControlName="puf_coverage_years"
                                  min="1"
                                  max="40"
                                  class="mt-1 w-full rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
                                />
                              </div>
                            </div>

                            <div class="grid grid-cols-2 gap-2.5">
                              <div>
                                <label class="block text-[11px] font-semibold text-slate-600">
                                  Bonif. TIN (-%)
                                </label>
                                <input
                                  type="text"
                                  formControlName="bonus_pct"
                                  class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums text-[#059669]"
                                />
                              </div>

                              <div>
                                <label class="block text-[11px] font-semibold text-slate-600">
                                  Equiv. Libre (€/año)
                                </label>
                                <input
                                  type="text"
                                  formControlName="annual_market_cost_eur"
                                  class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums text-slate-700"
                                />
                              </div>
                            </div>
                          </div>
                        } @else {
                          <div class="grid grid-cols-3 gap-2.5">
                            <div>
                              <label class="block text-[11px] font-semibold text-slate-600">
                                Bonif. TIN (-%)
                              </label>
                              <input
                                type="text"
                                formControlName="bonus_pct"
                                class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums text-[#059669] focus:border-[#0B1120] focus:outline-none"
                              />
                            </div>

                            <div>
                              <label class="block text-[11px] font-semibold text-slate-600">
                                Banco (€/año)
                              </label>
                              <input
                                type="text"
                                formControlName="annual_bank_cost_eur"
                                class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:outline-none"
                              />
                            </div>

                            <div>
                              <label class="block text-[11px] font-semibold text-slate-600">
                                Libre (€/año)
                              </label>
                              <input
                                type="text"
                                formControlName="annual_market_cost_eur"
                                class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums text-slate-700 focus:border-[#0B1120] focus:outline-none"
                              />
                            </div>
                          </div>
                        }

                        <div class="grid grid-cols-2 items-center gap-2.5 pt-1">
                          <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              formControlName="apply_ipc"
                              class="h-3.5 w-3.5 rounded border-slate-300 text-[#0B1120]"
                            />
                            <span class="font-medium">Indexado a IPC</span>
                          </label>

                          <div class="flex items-center justify-end gap-1.5">
                            <label class="text-[11px] font-medium text-slate-500">
                              Subida edad (%/a):
                            </label>
                            <input
                              type="text"
                              formControlName="annual_age_increase_pct"
                              class="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-mono text-xs font-semibold tabular-nums text-[#0B1120]"
                            />
                          </div>
                        </div>

                        <div class="flex justify-end border-t border-slate-100 pt-2">
                          <button
                            type="button"
                            (click)="removeLinkedProduct(i)"
                            class="text-[11px] font-semibold text-[#E11D48] hover:underline"
                          >
                            Eliminar vinculación
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          </form>
        </aside>

        <!-- ÁREA ANALÍTICA DERECHA CON 3 PESTAÑAS LIMPIAS -->
        <section class="space-y-5 lg:col-span-8">
          <nav
            class="sticky top-[57px] z-30 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 backdrop-blur-md"
            aria-label="Pestañas del auditor hipotecario"
          >
            <div class="flex flex-wrap items-center gap-1">
              <button
                type="button"
                (click)="setActiveTab('verdict')"
                [class]="
                  activeTab() === 'verdict'
                    ? 'inline-flex items-center gap-2 rounded-xl bg-[#0B1120] px-4 py-2 text-xs font-bold text-white shadow-2xs transition'
                    : 'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[#F6F7F9] hover:text-[#0B1120]'
                "
              >
                <span>1. Veredicto y Plan por Años</span>
                @if (auditResult(); as res) {
                  <span
                    [class]="
                      activeTab() === 'verdict'
                        ? 'rounded-md bg-[#10B981]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#10B981]'
                        : 'rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#059669]'
                    "
                  >
                    +{{ fmtDecimal(toNum(res.verdict.net_savings_vs_all_bonified_eur) / 1000, 1) }}k €
                  </span>
                }
              </button>

              <button
                type="button"
                (click)="setActiveTab('charts')"
                [class]="
                  activeTab() === 'charts'
                    ? 'inline-flex items-center gap-2 rounded-xl bg-[#0B1120] px-4 py-2 text-xs font-bold text-white shadow-2xs transition'
                    : 'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[#F6F7F9] hover:text-[#0B1120]'
                "
              >
                <span>2. Gráficas y Comparativa</span>
                <span
                  [class]="
                    activeTab() === 'charts'
                      ? 'rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white'
                      : 'rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600'
                  "
                >
                  {{ combinationsCount() }} comb.
                </span>
              </button>

              <button
                type="button"
                (click)="setActiveTab('stress_schedule')"
                [class]="
                  activeTab() === 'stress_schedule'
                    ? 'inline-flex items-center gap-2 rounded-xl bg-[#0B1120] px-4 py-2 text-xs font-bold text-white shadow-2xs transition'
                    : 'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[#F6F7F9] hover:text-[#0B1120]'
                "
              >
                <span>3. Esfuerzo 35 % y Cuadro Completo</span>
                @if (auditResult(); as res) {
                  <span
                    [class]="
                      activeTab() === 'stress_schedule'
                        ? 'rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white'
                        : 'rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600'
                    "
                  >
                    {{ res.offer.term_months / 12 }}a / {{ res.offer.term_months }}m
                  </span>
                }
              </button>
            </div>
          </nav>

          @if (auditResult(); as res) {
            @if (activeTab() === 'verdict') {
              <app-verdict-card
                [auditResult]="res"
                [dynamicStrategy]="dynamicStrategy()"
              />
            }

            @if (activeTab() === 'charts') {
              <div class="space-y-5">
                <app-cumulative-cost-chart [auditResult]="res" />
                <app-scenarios-table [auditResult]="res" />
              </div>
            }

            @if (activeTab() === 'stress_schedule') {
              <div class="space-y-5">
                <app-stress-test-card [auditResult]="res" />
                <app-amortization-schedule [auditResult]="res" />
              </div>
            }
          } @else {
            <div
              class="flex h-96 flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-8 text-center"
            >
              <div class="h-7 w-7 animate-spin rounded-full border-2 border-[#0B1120] border-t-transparent"></div>
              <p class="mt-3 text-xs font-semibold text-slate-600">
                Ejecutando motor financiero Valuriq en aritmética Decimal...
              </p>
            </div>
          }
        </section>
      </div>
    </main>
  `
})
export class AuditorPageComponent implements OnInit {
  private readonly api = inject(ValuriqApiService);
  private readonly workspace = inject(ValuriqWorkspaceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly calculateTrigger$ = new Subject<MortgageOfferInput>();

  readonly presets = this.workspace.presetsCatalog;
  readonly activePresetId = this.workspace.activePresetId;
  readonly activeSlug = this.workspace.activeSlug;
  readonly activeTab = signal<AnalyticalTab>('verdict');

  readonly expandedProductIndex = signal<number | null>(null);

  readonly auditResult = this.workspace.lastAuditResult;
  readonly dynamicStrategy = this.workspace.lastDynamicStrategy;

  readonly calculating = signal<boolean>(false);
  readonly savingSlug = signal<boolean>(false);
  readonly downloadingPdf = signal<boolean>(false);

  readonly shareMessage = signal<string | null>(null);
  readonly errorBanner = signal<string | null>(null);

  readonly selectedMortgageType = signal<MortgageType>('FIXED');
  readonly productCountSignal = signal<number>(0);

  readonly combinationsCount = computed<number>(() =>
    Math.pow(2, this.productCountSignal())
  );

  readonly offerForm = new FormGroup<MortgageOfferFormControls>({
    offer_name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    bank_name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    principal_eur: new FormControl<string>('220000', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    term_years: new FormControl<number>(30, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(40)]
    }),
    mortgage_type: new FormControl<MortgageType>('FIXED', {
      nonNullable: true
    }),
    base_tin_pct: new FormControl<string>('3.40', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    fixed_years: new FormControl<number>(0, { nonNullable: true }),
    euribor_pct: new FormControl<string>('2.50', { nonNullable: true }),
    differential_pct: new FormControl<string>('1.00', { nonNullable: true }),
    min_tin_floor_pct: new FormControl<string>('0', { nonNullable: true }),
    opening_commission_pct: new FormControl<string>('0', { nonNullable: true }),
    appraisal_cost_eur: new FormControl<string>('450', { nonNullable: true }),
    other_initial_expenses_eur: new FormControl<string>('0', {
      nonNullable: true
    }),
    estimated_ipc_pct: new FormControl<string>('2.00', { nonNullable: true }),
    linked_products: new FormArray<FormGroup<LinkedProductFormControls>>([])
  });

  get linkedProductsArray(): FormArray<FormGroup<LinkedProductFormControls>> {
    return this.offerForm.controls.linked_products;
  }

  ngOnInit(): void {
    this.calculateTrigger$
      .pipe(
        switchMap((offer) =>
          this.api
            .calculateAudit(offer, this.workspace.activeEarlyRepaymentConfig())
            .pipe(
              catchError((err) => {
                this.calculating.set(false);
                this.errorBanner.set(
                  extractApiError(
                    err,
                    'Error al calcular la auditoría hipotecaria. Verifique que el backend FastAPI esté activo.'
                  )
                );
                return EMPTY;
              })
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.auditResult.set(res.audit_result);
        this.dynamicStrategy.set(res.dynamic_strategy ?? null);
        if (res.early_repayment_result) {
          this.workspace.lastEarlyRepaymentResult.set(res.early_repayment_result);
        }
        this.calculating.set(false);
      });

    this.offerForm.valueChanges
      .pipe(
        debounceTime(350),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.selectedMortgageType.set(this.offerForm.controls.mortgage_type.value);
        this.productCountSignal.set(this.linkedProductsArray.length);
        this.runAuditCalculation();
      });

    const slugFromRoute = this.route.snapshot.paramMap.get('slug');
    this.loadPresetsCatalog(slugFromRoute);
  }

  setActiveTab(tab: AnalyticalTab): void {
    this.activeTab.set(tab);
  }

  toggleProductAccordion(index: number): void {
    this.expandedProductIndex.update((curr) => (curr === index ? null : index));
  }

  isProductAcceptedInOptimal(productId: string): boolean {
    const res = this.auditResult();
    if (!res) {
      return false;
    }
    return res.scenario_c_optimal.accepted_product_ids.includes(productId);
  }

  getProductAnnualSurcharge(ctrl: FormGroup<LinkedProductFormControls>): number {
    if (ctrl.controls.payment_mode.value === 'PUF_FINANCED') {
      const cov = Math.max(1, toSafeInt(ctrl.controls.puf_coverage_years.value, 10));
      return (
        toNumber(ctrl.controls.puf_amount_eur.value) / cov -
        toNumber(ctrl.controls.annual_market_cost_eur.value)
      );
    }
    return (
      toNumber(ctrl.controls.annual_bank_cost_eur.value) -
      toNumber(ctrl.controls.annual_market_cost_eur.value)
    );
  }

  getProductPufExtraInterest(productId: string): number {
    const dyn = this.dynamicStrategy();
    const strat = dyn?.product_strategies.find((s) => s.product_id === productId);
    if (strat && toNumber(strat.puf_extra_interest_eur) > 0) {
      return toNumber(strat.puf_extra_interest_eur);
    }
    const res = this.auditResult();
    if (res) {
      return toNumber(res.scenario_a_all_bonified.puf_extra_interest_eur);
    }
    return 0;
  }

  setProductPaymentMode(index: number, mode: LinkedProductPaymentMode): void {
    const grp = this.linkedProductsArray.at(index);
    if (!grp) {
      return;
    }
    grp.controls.payment_mode.setValue(mode);
    if (mode === 'PUF_FINANCED' && toNumber(grp.controls.puf_amount_eur.value) <= 0) {
      grp.controls.puf_amount_eur.setValue('12000');
      grp.controls.puf_coverage_years.setValue(10);
    }
  }

  principalSliderValue(): number {
    const val = toNumber(this.offerForm.controls.principal_eur.value);
    return Math.max(50000, Math.min(800000, val || 220000));
  }

  onPrincipalSliderInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.offerForm.controls.principal_eur.setValue(target.value);
  }

  goToEarlyRepayment(): void {
    this.workspace.updateActiveOffer(this.extractCurrentOfferPayload());
    this.router.navigate(['/amortizacion']);
  }

  goToBankBattle(): void {
    this.workspace.updateActiveOffer(this.extractCurrentOfferPayload());
    this.workspace.promoteActiveOfferToBattle();
    this.router.navigate(['/comparar']);
  }

  private loadPresetsCatalog(slugToLoad: string | null): void {
    this.api.getPresets().subscribe({
      next: (items) => {
        this.presets.set(items);
        if (slugToLoad) {
          this.loadSavedAuditBySlug(slugToLoad);
        } else if (this.workspace.hasCustomAuditorContext()) {
          this.populateFormFromOffer(this.workspace.activeOffer());
          this.runAuditCalculation();
        } else {
          const targetId = this.activePresetId() || 'fija_tipica_trampa';
          const defaultPreset =
            items.find((p) => p.id === targetId) ?? items[0];
          if (defaultPreset) {
            this.applyPreset(defaultPreset);
          } else {
            this.populateFormFromOffer(DEFAULT_VALURIQ_OFFER);
            this.runAuditCalculation();
          }
        }
      },
      error: () => {
        this.populateFormFromOffer(this.workspace.activeOffer());
        if (slugToLoad) {
          this.loadSavedAuditBySlug(slugToLoad);
        } else {
          this.runAuditCalculation();
        }
      }
    });
  }

  private loadSavedAuditBySlug(slug: string): void {
    this.calculating.set(true);
    this.errorBanner.set(null);

    this.api.getAuditBySlug(slug).subscribe({
      next: (saved) => {
        this.activeSlug.set(saved.slug);
        this.activePresetId.set(null);
        this.populateFormFromOffer(saved.audit_result.offer);
        this.auditResult.set(saved.audit_result);
        this.dynamicStrategy.set(saved.dynamic_strategy ?? null);
        this.workspace.activeOffer.set(saved.audit_result.offer);
        this.calculating.set(false);
      },
      error: (err) => {
        this.calculating.set(false);
        this.errorBanner.set(
          extractApiError(
            err,
            `No se encontró la auditoría compartida '${slug}'. Cargando oferta por defecto.`
          )
        );
        this.populateFormFromOffer(DEFAULT_VALURIQ_OFFER);
        this.runAuditCalculation();
      }
    });
  }

  applyPreset(preset: PresetItemResponse): void {
    this.activePresetId.set(preset.id);
    this.activeSlug.set(null);
    this.workspace.hasCustomAuditorContext.set(false);
    this.expandedProductIndex.set(null);
    this.populateFormFromOffer(preset.offer);
    this.runAuditCalculation();
  }

  setMortgageType(type: MortgageType): void {
    this.selectedMortgageType.set(type);
    this.offerForm.controls.mortgage_type.setValue(type);
    if (type === 'MIXED' && this.offerForm.controls.fixed_years.value <= 0) {
      this.offerForm.controls.fixed_years.setValue(5);
    }
  }

  setQuickPrincipal(principal: string): void {
    this.offerForm.controls.principal_eur.setValue(principal);
  }

  setQuickTermYears(years: number): void {
    this.offerForm.controls.term_years.setValue(years);
  }

  private createProductFormGroup(
    prod: LinkedProduct
  ): FormGroup<LinkedProductFormControls> {
    return new FormGroup<LinkedProductFormControls>({
      id: new FormControl<string>(prod.id, { nonNullable: true }),
      name: new FormControl<string>(prod.name, {
        nonNullable: true,
        validators: [Validators.required]
      }),
      category: new FormControl<LinkedProductCategory>(prod.category, {
        nonNullable: true
      }),
      bonus_pct: new FormControl<string>(
        formatCleanInput(Math.abs(toNumber(prod.bonus_pct)), true),
        { nonNullable: true }
      ),
      annual_bank_cost_eur: new FormControl<string>(
        formatCleanInput(prod.annual_bank_cost_eur),
        { nonNullable: true }
      ),
      annual_market_cost_eur: new FormControl<string>(
        formatCleanInput(prod.annual_market_cost_eur),
        { nonNullable: true }
      ),
      apply_ipc: new FormControl<boolean>(prod.apply_ipc, {
        nonNullable: true
      }),
      annual_age_increase_pct: new FormControl<string>(
        formatCleanInput(prod.annual_age_increase_pct),
        { nonNullable: true }
      ),
      payment_mode: new FormControl<LinkedProductPaymentMode>(
        prod.payment_mode || 'ANNUAL',
        { nonNullable: true }
      ),
      puf_amount_eur: new FormControl<string>(
        formatCleanInput(prod.puf_amount_eur ?? '0'),
        { nonNullable: true }
      ),
      puf_coverage_years: new FormControl<number>(
        prod.puf_coverage_years ?? 10,
        { nonNullable: true }
      )
    });
  }

  private populateFormFromOffer(offer: MortgageOfferInput): void {
    this.linkedProductsArray.clear({ emitEvent: false });
    for (const prod of offer.linked_products.slice(0, 12)) {
      this.linkedProductsArray.push(this.createProductFormGroup(prod), {
        emitEvent: false
      });
    }
    this.productCountSignal.set(this.linkedProductsArray.length);
    this.selectedMortgageType.set(offer.mortgage_type);

    const years = Math.max(1, Math.round((offer.term_months || 360) / 12));

    this.offerForm.patchValue(
      {
        offer_name: offer.offer_name,
        bank_name: offer.bank_name,
        principal_eur: formatCleanInput(offer.principal_eur),
        term_years: years,
        mortgage_type: offer.mortgage_type,
        base_tin_pct: formatCleanInput(offer.base_tin_pct, true),
        fixed_years: offer.fixed_years,
        euribor_pct: formatCleanInput(offer.euribor_pct, true),
        differential_pct: formatCleanInput(offer.differential_pct, true),
        min_tin_floor_pct: formatCleanInput(offer.min_tin_floor_pct),
        opening_commission_pct: formatCleanInput(offer.opening_commission_pct),
        appraisal_cost_eur: formatCleanInput(offer.appraisal_cost_eur),
        other_initial_expenses_eur: formatCleanInput(offer.other_initial_expenses_eur),
        estimated_ipc_pct: formatCleanInput(offer.estimated_ipc_pct, true)
      },
      { emitEvent: false }
    );
  }

  addLinkedProduct(): void {
    if (this.linkedProductsArray.length >= 12) {
      return;
    }
    const idx = this.linkedProductsArray.length + 1;
    this.linkedProductsArray.push(
      this.createProductFormGroup({
        id: `vinc_${Date.now()}_${idx}`,
        name: `Producto Vinculado ${idx}`,
        category: 'OTHER',
        bonus_pct: '0.10',
        annual_bank_cost_eur: '250',
        annual_market_cost_eur: '0',
        apply_ipc: true,
        annual_age_increase_pct: '0'
      })
    );
    this.productCountSignal.set(this.linkedProductsArray.length);
    this.expandedProductIndex.set(this.linkedProductsArray.length - 1);
  }

  removeLinkedProduct(index: number): void {
    this.linkedProductsArray.removeAt(index);
    this.productCountSignal.set(this.linkedProductsArray.length);
    this.expandedProductIndex.set(null);
  }

  private extractCurrentOfferPayload(): MortgageOfferInput {
    const raw = this.offerForm.getRawValue();
    const termYears = Math.max(1, Math.min(50, toSafeInt(raw.term_years, 30)));
    const termMonths = termYears * 12;

    return serializeOfferPayload({
      offer_name: raw.offer_name,
      bank_name: raw.bank_name,
      principal_eur: raw.principal_eur,
      term_months: termMonths,
      mortgage_type: raw.mortgage_type,
      base_tin_pct: raw.base_tin_pct,
      fixed_years: raw.fixed_years,
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

  runAuditCalculation(): void {
    const offer = this.extractCurrentOfferPayload();
    this.workspace.activeOffer.set(offer);
    this.calculating.set(true);
    this.errorBanner.set(null);
    this.calculateTrigger$.next(offer);
  }

  saveAndCopyShareLink(): void {
    const offer = this.extractCurrentOfferPayload();
    this.savingSlug.set(true);
    this.errorBanner.set(null);
    this.shareMessage.set(null);

    this.api.saveAudit(offer, this.workspace.activeEarlyRepaymentConfig()).subscribe({
      next: (saved) => {
        this.savingSlug.set(false);
        this.activeSlug.set(saved.slug);
        this.auditResult.set(saved.audit_result);
        this.dynamicStrategy.set(saved.dynamic_strategy ?? null);

        this.router.navigate(['/audit', saved.slug], { replaceUrl: true });
        const shareUrl = `${window.location.origin}/audit/${saved.slug}`;
        if (navigator?.clipboard?.writeText) {
          navigator.clipboard.writeText(shareUrl).catch(() => null);
        }
        this.shareMessage.set(
          `Auditoría guardada en Valuriq. Enlace copiado al portapapeles: ${shareUrl}`
        );
      },
      error: (err) => {
        this.savingSlug.set(false);
        this.errorBanner.set(
          extractApiError(err, 'No se pudo guardar la auditoría en base de datos.')
        );
      }
    });
  }

  downloadPdfReport(): void {
    this.downloadingPdf.set(true);
    this.errorBanner.set(null);

    const slug = this.activeSlug();
    const request$ = slug
      ? this.api.downloadSavedAuditPdf(slug)
      : this.api.downloadDirectPdf(
          this.extractCurrentOfferPayload(),
          this.workspace.activeEarlyRepaymentConfig()
        );

    request$.subscribe({
      next: (response: HttpResponse<Blob>) => {
        this.downloadingPdf.set(false);
        const blob = response.body;
        if (!blob) {
          return;
        }
        const filename = `valuriq-auditoria-${slug || 'informe'}.pdf`;

        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloadingPdf.set(false);
        this.errorBanner.set('No se pudo generar el informe PDF.');
      }
    });
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  fmtPct(value: string | number | null | undefined): string {
    return formatPctEs(value, 2);
  }

  fmtDecimal(value: string | number | null | undefined, digits: number = 2): string {
    return formatDecimalEs(value, digits);
  }

  toNum(value: string | number | null | undefined): number {
    return toNumber(value);
  }
}
