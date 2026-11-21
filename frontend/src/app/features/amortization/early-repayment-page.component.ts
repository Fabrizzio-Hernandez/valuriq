import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  EarlyRepaymentComparisonResult,
  EarlyRepaymentConfig,
  MortgageAuditResult
} from '../../core/models/mortgage.models';
import { ValuriqApiService } from '../../core/services/valuriq-api.service';
import { ValuriqWorkspaceService } from '../../core/services/valuriq-workspace.service';
import {
  extractApiError,
  formatCleanInput,
  formatEurEs,
  formatPctEs,
  serializeOfferPayload,
  toDecimalString
} from '../../core/utils/decimal-format';
import { EarlyRepaymentSimulatorComponent } from '../auditor/components/early-repayment-simulator/early-repayment-simulator.component';

interface BaseLoanQuickFormControls {
  principal_eur: FormControl<string>;
  term_years: FormControl<number>;
  tin_pct: FormControl<string>;
}

@Component({
  selector: 'app-early-repayment-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, EarlyRepaymentSimulatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <!-- Cabecera Ejecutiva -->
      <div class="mb-6 flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-end">
        <div>
          <div class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#059669]">
            Paso 4 · Simulador de Amortización Anticipada (Ley 5/2019 LCCI)
          </div>
          <h1 class="mt-2 font-display text-2xl font-extrabold tracking-tight text-[#0B1120] sm:text-3xl">
            ¿Reducir Plazo o Reducir Cuota?
          </h1>
          <p class="mt-1 text-sm text-slate-600">
            Calcula al céntimo cuántos intereses y años te ahorras al realizar amortizaciones parciales puntuales o periódicas.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <a
            routerLink="/auditor"
            class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-bold text-[#0B1120] shadow-xs transition hover:bg-slate-50"
          >
            <span>← Volver al Auditor de Hipoteca</span>
          </a>
        </div>
      </div>

      <!-- Barra Discreta de Contexto Heredado + Edición Rápida en 3 Campos (Estado Local No Destructivo) -->
      <section class="mb-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:px-5">
        <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span class="inline-flex h-2 w-2 rounded-full bg-[#10B981]"></span>
            <span>
              {{ usingLocalQuickLoan() ? 'Simulando préstamo personalizado:' : 'Usando datos de tu hipoteca actual:' }}
            </span>
            <strong class="font-mono font-bold tabular-nums text-[#0B1120]">
              {{ fmtEur(displayPrincipal()) }} · {{ displayYears() }} años · TIN {{ fmtPct(displayTin()) }}
            </strong>
            @if (auditResult(); as res) {
              <span class="rounded-md bg-[#F6F7F9] px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {{ res.offer.bank_name }}
              </span>
            }
          </div>

          <div class="flex flex-wrap items-center gap-2">
            @if (usingLocalQuickLoan()) {
              <button
                type="button"
                (click)="restoreWorkspaceLoan()"
                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                <span>Restaurar hipoteca del Auditor</span>
              </button>
            }
            <button
              type="button"
              (click)="toggleQuickEdit()"
              class="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200/90 bg-[#F6F7F9] px-3 py-1.5 text-xs font-bold text-[#059669] transition hover:border-emerald-300 hover:bg-emerald-50/50 sm:self-auto"
            >
              <span>{{ showQuickEdit() ? 'Ocultar edición rápida ▲' : 'Editar préstamo base ▼' }}</span>
            </button>
          </div>
        </div>

        @if (showQuickEdit()) {
          <form
            [formGroup]="baseLoanForm"
            (ngSubmit)="applyBaseLoanEdit()"
            class="mt-4 grid grid-cols-1 gap-3.5 border-t border-slate-200/80 pt-4 sm:grid-cols-4"
          >
            <div>
              <label class="block text-xs font-semibold text-slate-600">
                Capital Pendiente (€)
              </label>
              <div class="relative mt-1">
                <input
                  type="text"
                  formControlName="principal_eur"
                  class="w-full rounded-lg border border-slate-200 bg-[#F6F7F9] py-2 pl-3 pr-8 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-slate-400">
                  €
                </span>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600">
                Años Pendientes
              </label>
              <div class="relative mt-1">
                <input
                  type="number"
                  formControlName="term_years"
                  min="1"
                  max="40"
                  class="w-full rounded-lg border border-slate-200 bg-[#F6F7F9] py-2 pl-3 pr-12 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-slate-400">
                  años
                </span>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600">
                TIN Efectivo Actual (%)
              </label>
              <div class="relative mt-1">
                <input
                  type="text"
                  formControlName="tin_pct"
                  class="w-full rounded-lg border border-slate-200 bg-[#F6F7F9] py-2 pl-3 pr-8 font-mono text-sm font-semibold tabular-nums text-[#0B1120] focus:border-[#0B1120] focus:bg-white focus:outline-none"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-slate-400">
                  %
                </span>
              </div>
            </div>

            <div class="flex items-end">
              <button
                type="submit"
                [disabled]="loadingBase()"
                class="w-full rounded-xl bg-[#0B1120] px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                @if (loadingBase()) {
                  Actualizando...
                } @else {
                  Aplicar Préstamo Base
                }
              </button>
            </div>
          </form>
        }
      </section>

      @if (errorMsg()) {
        <div class="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-[#E11D48]">
          {{ errorMsg() }}
        </div>
      }

      @if (auditResult(); as res) {
        <app-early-repayment-simulator
          [auditResult]="res"
          [initialComparison]="usingLocalQuickLoan() ? null : workspace.lastEarlyRepaymentResult()"
          (configChange)="onConfigChange($event)"
          (resultChange)="onResultChange($event)"
        />
      } @else {
        <div class="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-500">
          Cargando contexto hipotecario...
        </div>
      }
    </main>
  `
})
export class EarlyRepaymentPageComponent implements OnInit {
  private readonly api = inject(ValuriqApiService);
  readonly workspace = inject(ValuriqWorkspaceService);

  readonly auditResult = signal<MortgageAuditResult | null>(
    this.workspace.lastAuditResult()
  );
  readonly usingLocalQuickLoan = signal<boolean>(false);
  readonly showQuickEdit = signal<boolean>(false);
  readonly loadingBase = signal<boolean>(false);
  readonly errorMsg = signal<string | null>(null);

  readonly displayPrincipal = computed<string>(() => {
    const res = this.auditResult();
    return res
      ? res.offer.principal_eur
      : this.workspace.activeOffer().principal_eur;
  });

  readonly displayYears = computed<number>(() => {
    const res = this.auditResult();
    const months = res
      ? res.offer.term_months
      : this.workspace.activeOffer().term_months;
    return Math.round(months / 12);
  });

  readonly displayTin = computed<string>(() => {
    const res = this.auditResult();
    return res
      ? res.scenario_c_optimal.effective_initial_tin_pct
      : this.workspace.activeOffer().base_tin_pct;
  });

  readonly baseLoanForm = new FormGroup<BaseLoanQuickFormControls>({
    principal_eur: new FormControl<string>('220000', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    term_years: new FormControl<number>(30, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(40)]
    }),
    tin_pct: new FormControl<string>('2.95', {
      nonNullable: true,
      validators: [Validators.required]
    })
  });

  ngOnInit(): void {
    const currentAudit = this.workspace.lastAuditResult();
    if (currentAudit) {
      this.auditResult.set(currentAudit);
      this.syncFormWithAudit(currentAudit);
      return;
    }

    this.evaluateCurrentWorkspaceOffer();
  }

  toggleQuickEdit(): void {
    this.showQuickEdit.set(!this.showQuickEdit());
  }

  /**
   * Simula un préstamo base personalizado únicamente en el estado local de `/amortizacion`,
   * conservando intacta `workspace.activeOffer()` (sus vinculaciones y modalidad en `/auditor`).
   */
  applyBaseLoanEdit(): void {
    const raw = this.baseLoanForm.getRawValue();
    const localOffer = structuredClone(this.workspace.activeOffer());
    localOffer.principal_eur = toDecimalString(raw.principal_eur, 2, '220000.00');
    localOffer.term_months = Math.max(
      12,
      Math.min(480, Math.round(Number(raw.term_years) * 12))
    );
    localOffer.mortgage_type = 'FIXED';
    localOffer.base_tin_pct = toDecimalString(raw.tin_pct, 2, '2.95');
    localOffer.linked_products = [];
    localOffer.offer_name = `Préstamo Base (${raw.term_years} años · TIN ${raw.tin_pct}%)`;

    this.loadingBase.set(true);
    this.errorMsg.set(null);

    this.api.calculateAudit(serializeOfferPayload(localOffer)).subscribe({
      next: (res) => {
        this.usingLocalQuickLoan.set(true);
        this.auditResult.set(res.audit_result);
        this.syncFormWithAudit(res.audit_result);
        this.loadingBase.set(false);
        this.showQuickEdit.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          extractApiError(err, 'No se pudo simular el préstamo base personalizado.')
        );
        this.loadingBase.set(false);
      }
    });
  }

  restoreWorkspaceLoan(): void {
    this.usingLocalQuickLoan.set(false);
    const existing = this.workspace.lastAuditResult();
    if (existing) {
      this.auditResult.set(existing);
      this.syncFormWithAudit(existing);
      return;
    }
    this.evaluateCurrentWorkspaceOffer();
  }

  onConfigChange(config: EarlyRepaymentConfig): void {
    this.workspace.activeEarlyRepaymentConfig.set(config);
  }

  onResultChange(result: EarlyRepaymentComparisonResult): void {
    if (!this.usingLocalQuickLoan()) {
      this.workspace.lastEarlyRepaymentResult.set(result);
    }
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  fmtPct(value: string | number | null | undefined): string {
    return formatPctEs(value, 2);
  }

  private evaluateCurrentWorkspaceOffer(): void {
    const offer = serializeOfferPayload(this.workspace.activeOffer());
    this.loadingBase.set(true);
    this.errorMsg.set(null);

    this.api.calculateAudit(offer).subscribe({
      next: (res) => {
        this.usingLocalQuickLoan.set(false);
        this.auditResult.set(res.audit_result);
        this.workspace.lastAuditResult.set(res.audit_result);
        if (res.dynamic_strategy) {
          this.workspace.lastDynamicStrategy.set(res.dynamic_strategy);
        }
        this.syncFormWithAudit(res.audit_result);
        this.loadingBase.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          extractApiError(err, 'No se pudo cargar el préstamo base.')
        );
        this.loadingBase.set(false);
      }
    });
  }

  private syncFormWithAudit(audit: MortgageAuditResult): void {
    this.baseLoanForm.patchValue(
      {
        principal_eur: formatCleanInput(audit.offer.principal_eur),
        term_years: Math.round(audit.offer.term_months / 12),
        tin_pct: formatCleanInput(
          audit.scenario_c_optimal.effective_initial_tin_pct
        )
      },
      { emitEvent: false }
    );
  }
}
