import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
  signal
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

import { MortgageAuditResult } from '../../../../core/models/mortgage.models';
import {
  formatEurEs,
  toNumber
} from '../../../../core/utils/decimal-format';

Chart.register(...registerables);

@Component({
  selector: 'app-cumulative-cost-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let res = auditResult();

    <div class="space-y-5">
      <!-- GRÁFICA 1: BARRAS HORIZONTALES APILADAS (COMPOSICIÓN DEL COSTE TOTAL) -->
      <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
        <div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 class="font-display text-base font-bold text-[#0B1120]">
              Composición del Desembolso Total (Capital + Intereses + Vinculaciones)
            </h3>
            <p class="text-xs text-slate-500">
              Peso relativo de los seguros y productos vinculados en el coste real de cada escenario
            </p>
          </div>
          <span class="rounded-md bg-[#F6F7F9] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-slate-600">
            Sobrecoste banco en seguros: {{ fmtEur(res.scenario_a_all_bonified.total_linked_overcost_eur) }}
          </span>
        </div>

        <div class="mt-4 h-52 w-full">
          <canvas #stackedBarCanvas></canvas>
        </div>
      </section>

      <!-- GRÁFICA 2: EVOLUCIÓN ACUMULADA / CURVA DE AHORRO NETO (SIN CÍRCULOS FIJOS) -->
      <section class="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
        <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 class="font-display text-base font-bold text-[#0B1120]">
              Evolución Temporal Acumulada y Punto de Equilibrio
            </h3>
            <p class="mt-0.5 text-xs text-slate-500">
              @if (res.verdict.break_even_year === 1) {
                El Escenario C (Óptimo Valuriq) ahorra dinero desde el primer año hasta el año {{ res.scenario_c_optimal.yearly_summary.length }}.
              } @else if (res.verdict.break_even_year !== null) {
                Las curvas de coste acumulado se cruzan en el Año {{ res.verdict.break_even_year }}.
              } @else {
                Proyección anual durante los {{ res.scenario_c_optimal.yearly_summary.length }} años del préstamo.
              }
            </p>
          </div>

          <div class="inline-flex rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-1">
            <button
              type="button"
              (click)="setMode('cumulative')"
              [class]="
                chartMode() === 'cumulative'
                  ? 'rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#0B1120] shadow-2xs transition'
                  : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
              "
            >
              Coste Acumulado
            </button>
            <button
              type="button"
              (click)="setMode('savings')"
              [class]="
                chartMode() === 'savings'
                  ? 'rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#059669] shadow-2xs transition'
                  : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-[#0B1120]'
              "
            >
              Curva de Ahorro Neto
            </button>
          </div>
        </div>

        <div class="mt-4 h-80 w-full">
          <canvas #lineChartCanvas></canvas>
        </div>
      </section>
    </div>
  `
})
export class CumulativeCostChartComponent implements AfterViewInit, OnDestroy {
  readonly auditResult = input.required<MortgageAuditResult>();
  readonly chartMode = signal<'cumulative' | 'savings'>('cumulative');

  @ViewChild('stackedBarCanvas', { static: true })
  private stackedCanvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('lineChartCanvas', { static: true })
  private lineCanvasRef!: ElementRef<HTMLCanvasElement>;

  private stackedChart: Chart | null = null;
  private lineChart: Chart | null = null;
  private viewInitialized = false;

  constructor() {
    effect(() => {
      const result = this.auditResult();
      const mode = this.chartMode();
      if (this.viewInitialized && result) {
        this.renderStackedChart(result);
        this.renderLineChart(result, mode);
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    const res = this.auditResult();
    this.renderStackedChart(res);
    this.renderLineChart(res, this.chartMode());
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  setMode(mode: 'cumulative' | 'savings'): void {
    this.chartMode.set(mode);
  }

  fmtEur(value: string | number | null | undefined): string {
    return formatEurEs(value);
  }

  private destroyCharts(): void {
    if (this.stackedChart) {
      this.stackedChart.destroy();
      this.stackedChart = null;
    }
    if (this.lineChart) {
      this.lineChart.destroy();
      this.lineChart = null;
    }
  }

  private renderStackedChart(result: MortgageAuditResult): void {
    if (this.stackedChart) {
      this.stackedChart.destroy();
      this.stackedChart = null;
    }

    const canvas = this.stackedCanvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    const sa = result.scenario_a_all_bonified;
    const sb = result.scenario_b_unbonified;
    const sc = result.scenario_c_optimal;

    const labels = [
      'Escenario A (100 % Banco)',
      'Escenario B (0 % Banco)',
      'Escenario C (Óptimo Valuriq)'
    ];

    const capitalPlusFees = [
      toNumber(sa.principal_eur) + toNumber(sa.initial_expenses_eur),
      toNumber(sb.principal_eur) + toNumber(sb.initial_expenses_eur),
      toNumber(sc.principal_eur) + toNumber(sc.initial_expenses_eur)
    ];

    const interests = [
      toNumber(sa.total_interest_eur),
      toNumber(sb.total_interest_eur),
      toNumber(sc.total_interest_eur)
    ];

    const linkedCosts = [
      toNumber(sa.total_linked_cost_eur),
      toNumber(sb.total_linked_cost_eur),
      toNumber(sc.total_linked_cost_eur)
    ];

    this.stackedChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Capital + Gastos Iniciales',
            data: capitalPlusFees,
            backgroundColor: '#0B1120',
            borderRadius: 4,
            barThickness: 26
          },
          {
            label: 'Intereses Hipotecarios',
            data: interests,
            backgroundColor: '#64748B',
            borderRadius: 4,
            barThickness: 26
          },
          {
            label: 'Seguros y Vinculaciones',
            data: linkedCosts,
            backgroundColor: ['#E11D48', '#94A3B8', '#059669'],
            borderRadius: 4,
            barThickness: 26
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#334155',
              font: {
                family: 'Inter, system-ui, sans-serif',
                size: 11,
                weight: 'bold'
              },
              usePointStyle: true,
              padding: 14
            }
          },
          tooltip: {
            backgroundColor: '#0B1120',
            titleColor: '#F8FAFC',
            bodyColor: '#E2E8F0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatEurEs(ctx.parsed.x ?? 0)}`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              color: '#64748B',
              font: { size: 11 },
              callback: (val) =>
                new Intl.NumberFormat('es-ES', {
                  notation: 'compact',
                  compactDisplay: 'short'
                }).format(Number(val)) + ' €'
            },
            grid: {
              color: '#E2E8F0'
            }
          },
          y: {
            stacked: true,
            ticks: {
              color: '#0B1120',
              font: {
                family: 'Inter, system-ui, sans-serif',
                size: 11,
                weight: 'bold'
              }
            },
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  private renderLineChart(
    result: MortgageAuditResult,
    mode: 'cumulative' | 'savings'
  ): void {
    if (this.lineChart) {
      this.lineChart.destroy();
      this.lineChart = null;
    }

    const canvas = this.lineCanvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    const saYears = result.scenario_a_all_bonified.yearly_summary;
    const sbYears = result.scenario_b_unbonified.yearly_summary;
    const scYears = result.scenario_c_optimal.yearly_summary;

    const labels = scYears.map((row) => `Año ${row.year}`);

    let datasets: ChartConfiguration<'line'>['data']['datasets'];

    if (mode === 'cumulative') {
      const dataA = saYears.map((r) => toNumber(r.cumulative_total_outflow_eur));
      const dataB = sbYears.map((r) => toNumber(r.cumulative_total_outflow_eur));
      const dataC = scYears.map((r) => toNumber(r.cumulative_total_outflow_eur));

      datasets = [
        {
          label: 'Escenario A · 100 % Banco',
          data: dataA,
          borderColor: '#E11D48',
          backgroundColor: 'rgba(225, 29, 72, 0.04)',
          borderWidth: 2.2,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          tension: 0.3
        },
        {
          label: 'Escenario B · 0 % Banco',
          data: dataB,
          borderColor: '#64748B',
          backgroundColor: 'rgba(100, 116, 139, 0.03)',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          tension: 0.3
        },
        {
          label: 'Escenario C · Óptimo Valuriq',
          data: dataC,
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.09)',
          borderWidth: 2.8,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          pointBackgroundColor: '#059669',
          tension: 0.3
        }
      ];
    } else {
      const savingsCvsA = scYears.map((r, idx) =>
        toNumber(saYears[idx]?.cumulative_total_outflow_eur) -
        toNumber(r.cumulative_total_outflow_eur)
      );
      const savingsBvsA = sbYears.map((r, idx) =>
        toNumber(saYears[idx]?.cumulative_total_outflow_eur) -
        toNumber(r.cumulative_total_outflow_eur)
      );

      datasets = [
        {
          label: 'Ahorro Acumulado Escenario C (Óptimo) vs. Banco (A)',
          data: savingsCvsA,
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.10)',
          borderWidth: 2.8,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          tension: 0.3
        },
        {
          label: 'Ahorro Acumulado Escenario B (0 % Banco) vs. Banco (A)',
          data: savingsBvsA,
          borderColor: '#0B1120',
          backgroundColor: 'rgba(11, 17, 32, 0.04)',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          tension: 0.3
        }
      ];
    }

    this.lineChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#334155',
              font: {
                family: 'Inter, system-ui, sans-serif',
                size: 11,
                weight: 'bold'
              },
              usePointStyle: true,
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: '#0B1120',
            titleColor: '#F8FAFC',
            bodyColor: '#E2E8F0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 11,
            cornerRadius: 8,
            callbacks: {
              label: (context) => {
                const val = context.parsed.y ?? 0;
                return `${context.dataset.label}: ${formatEurEs(val)}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#64748B',
              maxTicksLimit: 15,
              font: { size: 11 }
            },
            grid: {
              color: '#F1F5F9'
            }
          },
          y: {
            ticks: {
              color: '#64748B',
              font: { size: 11 },
              callback: (value) => {
                const n = Number(value);
                return (
                  new Intl.NumberFormat('es-ES', {
                    notation: 'compact',
                    compactDisplay: 'short'
                  }).format(n) + ' €'
                );
              }
            },
            grid: {
              color: '#E2E8F0'
            }
          }
        }
      }
    });
  }
}
