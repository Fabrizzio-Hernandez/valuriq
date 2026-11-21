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
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import {
  DayOneCostsResult,
  PropertyTaxRegime,
  RegionTaxRule
} from '../../core/models/mortgage.models';
import { ValuriqApiService } from '../../core/services/valuriq-api.service';
import { ValuriqWorkspaceService } from '../../core/services/valuriq-workspace.service';
import {
  extractApiError,
  formatDecimalEs,
  formatEurEs,
  formatPctEs,
  toNumber
} from '../../core/utils/decimal-format';

interface DayOneFormControls {
  property_price_eur: FormControl<string>;
  financing_pct: FormControl<number>;
  region_code: FormControl<string>;
  property_regime: FormControl<PropertyTaxRegime>;
  apply_young_buyer_reduction: FormControl<boolean>;
  gestoria_cost_eur: FormControl<string>;
  appraisal_cost_eur: FormControl<string>;
  real_estate_agency_fee_eur: FormControl<string>;
}

@Component({
  selector: 'app-day-one-costs-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-[1360px] px-4 py-6 sm:px-6">
      <div class="mb-6">
        <span class="text-xs font-bold uppercase tracking-wider text-[#059669]">
          Paso 1 · Liquidez Inicial de Compraventa
        </span>
        <h1 class="mt-1 font-display text-2xl font-extrabold tracking-tight text-[#0B1120] sm:text-3xl">
          Calculadora de Dinero Real en Cuenta el Día 1
        </h1>
        <p class="mt-1 text-xs text-slate-600 sm:text-sm">
          Calcula la entrada no financiada, el ITP o IVA+AJD exacto de tu Comunidad Autónoma y los gastos de escritura para saber cuánto efectivo necesitas el día de la firma.
        </p>
      </div>

      <!-- Layout Limpio de 2 Columnas -->
      <div class="grid grid-cols-1 items-start gap-6 pb-12 lg:grid-cols-12">
        <!-- Columna Izquierda (5 cols): Configuración -->
        <section class="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 lg:col-span-5">
          <form [formGroup]="form" (ngSubmit)="calculate()" class="space-y-5">
            <!-- Comunidad Autónoma -->
            <div>
              <label class="block text-xs font-semibold text-slate-700">
                Comunidad Autónoma del Inmueble
              </label>
              <select
                formControlName="region_code"
                class="mt-1.5 w-full rounded-xl border border-slate-200 bg-[#F6F7F9]/70 px-3 py-2.5 text-sm font-semibold text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
              >
                @for (reg of regions(); track reg.code) {
                  <option [value]="reg.code">
                    {{ reg.name }} (ITP {{ fmtDecimal(reg.itp_general_pct, 1) }} % / Joven {{ fmtDecimal(reg.itp_young_pct, 1) }} %)
                  </option>
                }
              </select>
            </div>

            <!-- Segunda Mano vs Obra Nueva vs VPO -->
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-slate-700">
                Tipo de Vivienda
              </label>
              <div class="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-1">
                <button
                  type="button"
                  (click)="setRegime('SECOND_HAND')"
                  [class]="
                    form.controls.property_regime.value === 'SECOND_HAND'
                      ? 'rounded-lg bg-white py-2 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                      : 'rounded-lg py-2 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
                  "
                >
                  Segunda Mano
                </button>
                <button
                  type="button"
                  (click)="setRegime('NEW_BUILD')"
                  [class]="
                    form.controls.property_regime.value === 'NEW_BUILD'
                      ? 'rounded-lg bg-white py-2 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                      : 'rounded-lg py-2 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
                  "
                >
                  Obra Nueva
                </button>
                <button
                  type="button"
                  (click)="setRegime('NEW_BUILD_VPO')"
                  [class]="
                    form.controls.property_regime.value === 'NEW_BUILD_VPO'
                      ? 'rounded-lg bg-white py-2 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                      : 'rounded-lg py-2 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
                  "
                >
                  Obra Nueva VPO
                </button>
              </div>
            </div>

            <!-- Toggle Menor de 35/36 años (Tipo Reducido Joven) -->
            <div class="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3.5">
              <label class="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <span class="block text-xs font-bold text-[#0B1120]">
                    Aplicar bonificación de comprador joven (≤ {{ activeRegionMaxAge() }} años)
                  </span>
                  <span class="block text-[11px] text-slate-600">
                    Reduce el ITP o el AJD en primera vivienda habitual según normativa autonómica
                  </span>
                </div>
                <input
                  type="checkbox"
                  formControlName="apply_young_buyer_reduction"
                  class="h-4 w-4 rounded border-slate-300 text-[#059669]"
                />
              </label>
            </div>

            <!-- Precio de la Vivienda + Slider -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-slate-700">Precio de la Vivienda</label>
                <div class="flex gap-1">
                  @for (p of ['180000', '275000', '380000']; track p) {
                    <button
                      type="button"
                      (click)="setQuickPrice(p)"
                      class="rounded-md bg-[#F6F7F9] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 hover:bg-slate-200/70"
                    >
                      {{ +p / 1000 }}k €
                    </button>
                  }
                </div>
              </div>

              <div class="relative">
                <input
                  type="text"
                  formControlName="property_price_eur"
                  class="w-full rounded-xl border border-slate-200 bg-[#F6F7F9]/60 py-2 pl-3 pr-9 font-mono text-sm font-bold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">
                  €
                </span>
              </div>

              <input
                type="range"
                min="60000"
                max="1000000"
                step="5000"
                [value]="priceSliderValue()"
                (input)="onPriceSliderInput($event)"
                class="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200"
              />
            </div>

            <!-- Porcentaje de Financiación (Slider 50% a 100%, por defecto 80%) -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-slate-700">
                  Porcentaje Financiado por el Banco
                </label>
                <span class="rounded-md bg-[#0B1120] px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-white">
                  {{ form.controls.financing_pct.value }} %
                </span>
              </div>

              <input
                type="range"
                min="50"
                max="100"
                step="5"
                formControlName="financing_pct"
                class="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200"
              />

              <div class="flex justify-between font-mono text-[11px] text-slate-400">
                <span>50 %</span>
                <span>70 %</span>
                <span class="font-bold text-[#0B1120]">80 % (Estándar)</span>
                <span>90 %</span>
                <span>100 %</span>
              </div>
            </div>

            <!-- Gastos Editables (Gestoría, Tasación, Inmobiliaria) -->
            <div class="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200/80 bg-[#F6F7F9]/70 p-3">
              <div>
                <label class="block text-[11px] font-semibold text-slate-500">Tasación (€)</label>
                <input
                  type="text"
                  formControlName="appraisal_cost_eur"
                  class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0B1120]"
                />
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-slate-500">Gestoría (€)</label>
                <input
                  type="text"
                  formControlName="gestoria_cost_eur"
                  class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0B1120]"
                />
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-slate-500">Com. Agencia (€)</label>
                <input
                  type="text"
                  formControlName="real_estate_agency_fee_eur"
                  class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0B1120]"
                />
              </div>
            </div>
          </form>
        </section>

        <!-- Columna Derecha (7 cols): Desglose Visual y CTA hacia el Auditor -->
        <section class="space-y-5 lg:col-span-7">
          @if (errorMsg()) {
            <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-[#E11D48]">
              {{ errorMsg() }}
            </div>
          }
          @if (result(); as res) {
            <!-- Hero Card Obsidiana: Efectivo Total Necesario en Cuenta -->
            <div class="rounded-2xl bg-[#0B1120] p-6 text-white">
              <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <span class="text-xs font-bold uppercase tracking-wider text-[#10B981]">
                    Efectivo Total Necesario en Cuenta el Día 1
                  </span>
                  <div class="mt-2 font-display text-4xl font-extrabold tracking-tight tabular-nums text-white sm:text-5xl">
                    {{ fmtEur(res.total_cash_needed_day_one_eur) }}
                  </div>
                  <p class="mt-1.5 text-xs text-slate-300">
                    Incluye la entrada no financiada ({{ fmtDecimal(100 - toNum(res.financing_pct), 0) }} %) más un
                    <strong class="text-white">{{ fmtPct(res.taxes_and_expenses_over_price_pct) }}</strong>
                    adicional sobre el precio en impuestos y gastos de compraventa.
                  </p>
                </div>

                @if (toNum(res.young_buyer_tax_savings_eur) > 0) {
                  <div class="shrink-0 rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 py-3 text-right">
                    <span class="block text-[10px] font-bold uppercase tracking-wider text-[#10B981]">
                      Ahorro Fiscal Tipo Joven
                    </span>
                    <span class="font-mono text-xl font-extrabold tabular-nums text-[#10B981]">
                      -{{ fmtEur(res.young_buyer_tax_savings_eur) }}
                    </span>
                  </div>
                }
              </div>

              <!-- Barra Horizontal Apilada Proporcional (Entrada + Impuestos + Gastos) -->
              <div class="mt-6">
                <div class="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    class="bg-[#10B981] transition-all duration-300"
                    [style.width.%]="downPaymentSharePct()"
                    title="Entrada no financiada"
                  ></div>
                  <div
                    class="bg-[#E11D48] transition-all duration-300"
                    [style.width.%]="taxesSharePct()"
                    title="Impuestos Autonómicos"
                  ></div>
                  <div
                    class="bg-sky-400 transition-all duration-300"
                    [style.width.%]="expensesSharePct()"
                    title="Notaría, Registro, Gestoría y Tasación"
                  ></div>
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <div class="flex items-center gap-2">
                    <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-[#10B981]"></span>
                    <span class="text-slate-300">Entrada:</span>
                    <strong class="whitespace-nowrap font-mono tabular-nums text-white">
                      {{ fmtEur(res.down_payment_eur) }}
                    </strong>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-[#E11D48]"></span>
                    <span class="text-slate-300">Impuestos:</span>
                    <strong class="whitespace-nowrap font-mono tabular-nums text-white">
                      {{ fmtEur(res.total_taxes_eur) }}
                    </strong>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-400"></span>
                    <span class="text-slate-300">Gastos Escritura:</span>
                    <strong class="whitespace-nowrap font-mono tabular-nums text-white">
                      {{ fmtEur(res.total_formalization_expenses_eur) }}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <!-- Desglose Partida a Partida -->
            <div class="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h3 class="font-display text-base font-bold text-[#0B1120]">
                  Desglose Contable en {{ res.region.name }}
                </h3>
                <span class="rounded-md bg-[#F6F7F9] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-slate-700">
                  Hipoteca resultante: {{ fmtEur(res.mortgage_principal_eur) }}
                </span>
              </div>

              <p class="mt-2.5 rounded-xl bg-[#F6F7F9] px-3.5 py-2 text-xs text-slate-600">
                {{ res.region.notes }}
              </p>

              @if (res.young_buyer_price_cap_warning) {
                <div class="mt-2.5 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2 text-xs font-medium text-amber-900">
                  ⚠ {{ res.young_buyer_price_cap_warning }}
                </div>
              }

              <div class="mt-4 divide-y divide-slate-100 text-xs sm:text-sm">
                <div class="flex items-center justify-between py-2.5">
                  <span class="font-medium text-slate-700">
                    Entrada aportada ({{ fmtDecimal(100 - toNum(res.financing_pct), 0) }} % del precio de {{ fmtEur(res.property_price_eur) }})
                  </span>
                  <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#0B1120]">
                    {{ fmtEur(res.down_payment_eur) }}
                  </span>
                </div>

                @if (res.property_regime === 'SECOND_HAND') {
                  <div class="flex items-center justify-between py-2.5">
                    <span class="font-medium text-slate-700">
                      Impuesto de Transmisiones Patrimoniales (ITP · {{ fmtPct(res.applied_itp_pct) }})
                    </span>
                    <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#E11D48]">
                      {{ fmtEur(res.itp_amount_eur) }}
                    </span>
                  </div>
                } @else {
                  <div class="flex items-center justify-between py-2.5">
                    <span class="font-medium text-slate-700">
                      {{ res.indirect_tax_name }} Obra Nueva ({{ fmtPct(res.applied_iva_pct) }})
                    </span>
                    <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#E11D48]">
                      {{ fmtEur(res.iva_amount_eur) }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-2.5">
                    <span class="font-medium text-slate-700">
                      Actos Jurídicos Documentados Compraventa (AJD · {{ fmtPct(res.applied_ajd_pct) }})
                    </span>
                    <span class="whitespace-nowrap font-mono font-bold tabular-nums text-[#E11D48]">
                      {{ fmtEur(res.ajd_amount_eur) }}
                    </span>
                  </div>
                }

                <div class="flex items-center justify-between py-2.5">
                  <span class="text-slate-600">Arancel de Notaría (Escritura de Compraventa)</span>
                  <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-800">
                    {{ fmtEur(res.notary_cost_eur) }}
                  </span>
                </div>

                <div class="flex items-center justify-between py-2.5">
                  <span class="text-slate-600">Arancel de Registro de la Propiedad</span>
                  <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-800">
                    {{ fmtEur(res.registry_cost_eur) }}
                  </span>
                </div>

                <div class="flex items-center justify-between py-2.5">
                  <span class="text-slate-600">Gestoría y Tramitación Liquidación Impuestos</span>
                  <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-800">
                    {{ fmtEur(res.gestoria_cost_eur) }}
                  </span>
                </div>

                <div class="flex items-center justify-between py-2.5">
                  <span class="text-slate-600">Tasación Oficial Homologada (Banco de España)</span>
                  <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-800">
                    {{ fmtEur(res.appraisal_cost_eur) }}
                  </span>
                </div>

                @if (toNum(res.real_estate_agency_fee_eur) > 0) {
                  <div class="flex items-center justify-between py-2.5">
                    <span class="text-slate-600">Honorarios Agencia Inmobiliaria</span>
                    <span class="whitespace-nowrap font-mono font-semibold tabular-nums text-slate-800">
                      {{ fmtEur(res.real_estate_agency_fee_eur) }}
                    </span>
                  </div>
                }
              </div>

              <!-- CTA Directo Conectado al Store -->
              <div class="mt-6 flex flex-col items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 sm:flex-row">
                <div>
                  <span class="block text-xs font-bold text-[#0B1120]">
                    Capital de hipoteca a solicitar: {{ fmtEur(res.mortgage_principal_eur) }}
                  </span>
                  <span class="block text-[11px] text-slate-600">
                    Continúa al auditor con este capital y tasación precargados sin volver a escribirlos
                  </span>
                </div>

                <button
                  type="button"
                  (click)="sendToAuditor(res)"
                  class="w-full shrink-0 rounded-xl bg-[#059669] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 sm:w-auto"
                >
                  Auditar hipoteca por {{ fmtEur(res.mortgage_principal_eur) }} →
                </button>
              </div>
            </div>
          }
        </section>
      </div>
    </main>
  `
})
export class DayOneCostsPageComponent implements OnInit {
  private readonly api = inject(ValuriqApiService);
  private readonly workspace = inject(ValuriqWorkspaceService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly regions = signal<RegionTaxRule[]>([]);
  readonly selectedRegionCode = signal<string>('MADRID');
  readonly result = signal<DayOneCostsResult | null>(null);
  readonly errorMsg = signal<string | null>(null);

  readonly form = new FormGroup<DayOneFormControls>({
    property_price_eur: new FormControl<string>('275000', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    financing_pct: new FormControl<number>(80, {
      nonNullable: true,
      validators: [Validators.required]
    }),
    region_code: new FormControl<string>('MADRID', {
      nonNullable: true
    }),
    property_regime: new FormControl<PropertyTaxRegime>('SECOND_HAND', {
      nonNullable: true
    }),
    apply_young_buyer_reduction: new FormControl<boolean>(false, {
      nonNullable: true
    }),
    gestoria_cost_eur: new FormControl<string>('400', { nonNullable: true }),
    appraisal_cost_eur: new FormControl<string>('450', { nonNullable: true }),
    real_estate_agency_fee_eur: new FormControl<string>('0', {
      nonNullable: true
    })
  });

  readonly activeRegionMaxAge = computed<number>(() => {
    const code = this.selectedRegionCode();
    const found = this.regions().find((r) => r.code === code);
    if (found) {
      return found.young_max_age;
    }
    return this.result()?.region.young_max_age ?? 35;
  });

  readonly downPaymentSharePct = computed<number>(() => {
    const res = this.result();
    if (!res) return 70;
    const tot = Math.max(1, toNumber(res.total_cash_needed_day_one_eur));
    return Math.round((toNumber(res.down_payment_eur) / tot) * 100);
  });

  readonly taxesSharePct = computed<number>(() => {
    const res = this.result();
    if (!res) return 20;
    const tot = Math.max(1, toNumber(res.total_cash_needed_day_one_eur));
    return Math.round((toNumber(res.total_taxes_eur) / tot) * 100);
  });

  readonly expensesSharePct = computed<number>(() => {
    return Math.max(3, 100 - this.downPaymentSharePct() - this.taxesSharePct());
  });

  ngOnInit(): void {
    this.api.getSpanishTaxRegions().subscribe({
      next: (items) => {
        this.regions.set(items);
      }
    });

    this.form.controls.region_code.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => {
        this.selectedRegionCode.set(code);
      });

    this.form.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.calculate();
      });

    this.calculate();
  }

  setRegime(regime: PropertyTaxRegime): void {
    this.form.controls.property_regime.setValue(regime);
  }

  setQuickPrice(price: string): void {
    this.form.controls.property_price_eur.setValue(price);
  }

  priceSliderValue(): number {
    return Math.max(60000, Math.min(1000000, toNumber(this.form.controls.property_price_eur.value) || 275000));
  }

  onPriceSliderInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.form.controls.property_price_eur.setValue(target.value);
  }

  calculate(): void {
    const raw = this.form.getRawValue();
    this.selectedRegionCode.set(raw.region_code);
    this.errorMsg.set(null);
    this.api
      .calculateDayOneCosts({
        property_price_eur: raw.property_price_eur,
        financing_pct: String(raw.financing_pct),
        region_code: raw.region_code,
        property_regime: raw.property_regime,
        apply_young_buyer_reduction: raw.apply_young_buyer_reduction,
        gestoria_cost_eur: raw.gestoria_cost_eur,
        appraisal_cost_eur: raw.appraisal_cost_eur,
        real_estate_agency_fee_eur: raw.real_estate_agency_fee_eur
      })
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.workspace.lastDayOneResult.set(res);
        },
        error: (err) => {
          this.errorMsg.set(
            extractApiError(err, 'No se pudo calcular los gastos de compraventa.')
          );
        }
      });
  }

  sendToAuditor(res: DayOneCostsResult): void {
    this.workspace.applyDayOneResultToActiveOffer(res);
    this.router.navigate(['/auditor']);
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
