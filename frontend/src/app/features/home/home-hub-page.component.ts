import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ValuriqWorkspaceService } from '../../core/services/valuriq-workspace.service';

@Component({
  selector: 'app-home-hub-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:py-16">
      <!-- Hero Editorial Despejado -->
      <section class="mx-auto max-w-3xl text-center">
        <span
          class="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white px-3.5 py-1 text-xs font-bold text-[#0B1120]"
        >
          <span class="h-2 w-2 rounded-full bg-[#059669]"></span>
          Motor Financiero en Aritmética Decimal Exacta · Ley 5/2019 LCCI
        </span>

        <h1 class="mt-5 font-display text-3xl font-extrabold tracking-tight text-[#0B1120] sm:text-5xl">
          Descubre el coste real de tu hipoteca antes de firmar
        </h1>

        <p class="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
          Los simuladores bancarios solo te enseñan la cuota mensual bonificada.
          <strong class="font-semibold text-[#0B1120]">Valuriq</strong> audita la TAE Real Oculta, las Primas Únicas Financiadas (PUF), el año exacto en que debes cancelar cada seguro y el efectivo real que necesitas en cuenta el Día 1.
        </p>
      </section>

      <!-- 4 Tarjetas Accionables Formuladas como Preguntas Reales del Comprador -->
      <section class="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
        <!-- Tarjeta 1: Gastos Día 1 -->
        <a
          routerLink="/gastos-compra"
          class="group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition hover:border-[#0B1120]"
        >
          <div>
            <div class="flex items-center justify-between">
              <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F6F7F9] text-[#0B1120] transition group-hover:bg-[#0B1120] group-hover:text-white">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              </div>
              <span class="rounded-md bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-bold text-slate-600">
                17 CCAA + Ceuta y Melilla
              </span>
            </div>

            <h2 class="mt-4 font-display text-xl font-bold text-[#0B1120] group-hover:text-[#059669]">
              ¿Cuánto dinero necesito ahorrado el día 1?
            </h2>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-600">
              Calcula la entrada, el ITP o IVA+AJD exacto de tu Comunidad Autónoma (incluyendo tipo reducido joven) y los gastos de notaría, registro y tasación.
            </p>
          </div>

          <div class="mt-6 flex items-center gap-2 text-xs font-bold text-[#0B1120] group-hover:text-[#059669]">
            <span>Calcular efectivo para la firma</span>
            <svg class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>

        <!-- Tarjeta 2: Auditor de Vinculaciones -->
        <a
          routerLink="/auditor"
          class="group flex flex-col justify-between rounded-2xl border-2 border-[#059669] bg-white p-6 transition hover:bg-emerald-50/15"
        >
          <div>
            <div class="flex items-center justify-between">
              <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#059669] text-white">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <span class="rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-[#059669] ring-1 ring-emerald-200/80">
                Herramienta Principal · PUF + Plan por Años
              </span>
            </div>

            <h2 class="mt-4 font-display text-xl font-bold text-[#0B1120] group-hover:text-[#059669]">
              ¿Me compensan los seguros y vinculaciones del banco?
            </h2>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-600">
              Audita todas las combinaciones posibles de productos vinculados, destapa la TAE Real Oculta y descubre en qué año exacto debes cancelar cada seguro.
            </p>
          </div>

          <div class="mt-6 flex items-center gap-2 text-xs font-bold text-[#059669]">
            <span>Abrir Auditor de Vinculaciones</span>
            <svg class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>

        <!-- Tarjeta 3: Batalla de Bancos -->
        <a
          routerLink="/comparar"
          class="group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition hover:border-[#0B1120]"
        >
          <div>
            <div class="flex items-center justify-between">
              <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F6F7F9] text-[#0B1120] transition group-hover:bg-[#0B1120] group-hover:text-white">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <span class="rounded-md bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-bold text-slate-600">
                Comparador Cara a Cara
              </span>
            </div>

            <h2 class="mt-4 font-display text-xl font-bold text-[#0B1120] group-hover:text-[#059669]">
              Tengo 2 o 3 ofertas: ¿qué banco es mejor de verdad?
            </h2>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-600">
              Enfrenta hasta 3 propuestas (Fija bonificada vs. Fija digital sin vinculaciones vs. Mixta) comparando el Escenario Óptimo real de cada entidad.
            </p>
          </div>

          <div class="mt-6 flex items-center gap-2 text-xs font-bold text-[#0B1120] group-hover:text-[#059669]">
            <span>Iniciar Batalla de Bancos</span>
            <svg class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>

        <!-- Tarjeta 4: Amortización Anticipada -->
        <a
          routerLink="/amortizacion"
          class="group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition hover:border-[#0B1120]"
        >
          <div>
            <div class="flex items-center justify-between">
              <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F6F7F9] text-[#0B1120] transition group-hover:bg-[#0B1120] group-hover:text-white">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span class="rounded-md bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-bold text-slate-600">
                Ahorro de Intereses
              </span>
            </div>

            <h2 class="mt-4 font-display text-xl font-bold text-[#0B1120] group-hover:text-[#059669]">
              Ya tengo hipoteca: ¿reduzco plazo o cuota?
            </h2>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-600">
              Simula aportaciones puntuales, mensuales o anuales descontando comisiones legales y comprueba cuántos años e intereses recortas.
            </p>
          </div>

          <div class="mt-6 flex items-center gap-2 text-xs font-bold text-[#0B1120] group-hover:text-[#059669]">
            <span>Simular amortización anticipada</span>
            <svg class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>
      </section>

      <!-- Banner Discreto Inferior de Acceso Instantáneo a Casos de Trampa Real -->
      <section class="mt-10 rounded-2xl border border-slate-200/90 bg-[#0B1120] p-6 text-white">
        <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <span class="text-[11px] font-bold uppercase tracking-wider text-[#10B981]">
              Demostración Instantánea
            </span>
            <h3 class="mt-1 font-display text-base font-bold text-white sm:text-lg">
              ¿Solo quieres ver cómo funciona? Prueba un caso real de trampa bancaria en 1 clic
            </h3>
            <p class="mt-0.5 text-xs text-slate-300">
              Carga directamente en el auditor una oferta real con Seguro de Vida PUF de 12.000 € financiado o una hipoteca fija con 4 vinculaciones.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              (click)="launchPresetInAuditor('fija_trampa_puf')"
              class="rounded-xl bg-[#E11D48] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-rose-700"
            >
              Probar Trampa Seguro PUF (12.000 €) →
            </button>
            <button
              type="button"
              (click)="launchPresetInAuditor('fija_tipica_trampa')"
              class="rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-white ring-1 ring-white/20 transition hover:bg-white/20"
            >
              Probar Fija 2,60 % vs. 3,40 % →
            </button>
          </div>
        </div>
      </section>
    </main>
  `
})
export class HomeHubPageComponent {
  private readonly router = inject(Router);
  private readonly workspace = inject(ValuriqWorkspaceService);

  launchPresetInAuditor(presetId: string): void {
    this.workspace.activePresetId.set(presetId);
    this.workspace.activeSlug.set(null);
    this.workspace.hasCustomAuditorContext.set(false);
    void this.router.navigate(['/auditor']);
  }
}
