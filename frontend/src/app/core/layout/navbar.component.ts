import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div class="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-2.5 sm:px-6">
        <!-- Logotipo SVG Geométrico Valuriq (Clic vuelve a /) -->
        <a
          routerLink="/"
          (click)="closeMobileMenu()"
          class="group flex items-center gap-3 focus:outline-none"
        >
          <svg class="h-9 w-9 shrink-0 transition-transform group-hover:scale-[1.03]" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="36" height="36" rx="9" fill="#0B1120" />
            <path
              d="M9.5 10.5H14.2L18 21.8L21.8 10.5H26.5L20.1 26.5H15.9L9.5 10.5Z"
              fill="#FFFFFF"
            />
            <circle cx="26.5" cy="24.5" r="2.6" fill="#10B981" />
          </svg>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-display text-lg font-extrabold tracking-tight text-[#0B1120]">
                Valuriq
              </span>
              <span class="hidden rounded-md border border-slate-200/80 bg-[#F6F7F9] px-2 py-0.5 text-[11px] font-semibold text-slate-600 lg:inline-block">
                Auditoría Hipotecaria y TAE Real
              </span>
            </div>
          </div>
        </a>

        <!-- Navegación Desktop de las 4 Herramientas -->
        <nav class="hidden items-center gap-1 rounded-xl border border-slate-200/80 bg-[#F6F7F9] p-1 md:flex">
          <a
            routerLink="/gastos-compra"
            routerLinkActive="bg-[#0B1120] text-white shadow-2xs"
            class="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:text-[#0B1120]"
          >
            Gastos Día 1
          </a>
          <a
            routerLink="/auditor"
            routerLinkActive="bg-[#0B1120] text-white shadow-2xs"
            class="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:text-[#0B1120]"
          >
            Auditor
          </a>
          <a
            routerLink="/comparar"
            routerLinkActive="bg-[#0B1120] text-white shadow-2xs"
            class="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:text-[#0B1120]"
          >
            Batalla de Bancos
          </a>
          <a
            routerLink="/amortizacion"
            routerLinkActive="bg-[#0B1120] text-white shadow-2xs"
            class="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:text-[#0B1120]"
          >
            Amortización
          </a>
        </nav>

        <!-- Acceso rápido Desktop / Botón Menú Móvil -->
        <div class="flex items-center gap-2">
          <a
            routerLink="/auditor"
            class="hidden items-center gap-1.5 rounded-xl bg-[#059669] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 md:inline-flex"
          >
            <span>Auditar oferta</span>
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>

          <button
            type="button"
            (click)="toggleMobileMenu()"
            class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-700 md:hidden"
            aria-label="Abrir menú de navegación"
          >
            @if (mobileMenuOpen()) {
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            } @else {
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            }
          </button>
        </div>
      </div>

      <!-- Menú Desplegable Móvil -->
      @if (mobileMenuOpen()) {
        <nav class="border-t border-slate-200/80 bg-white px-4 py-3 md:hidden">
          <div class="flex flex-col gap-1.5">
            <a
              routerLink="/gastos-compra"
              routerLinkActive="bg-[#0B1120] text-white"
              (click)="closeMobileMenu()"
              class="rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700"
            >
              1. Gastos Día 1 (ITP / IVA+AJD por CCAA)
            </a>
            <a
              routerLink="/auditor"
              routerLinkActive="bg-[#0B1120] text-white"
              (click)="closeMobileMenu()"
              class="rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700"
            >
              2. Auditor de Vinculaciones y TAE Real
            </a>
            <a
              routerLink="/comparar"
              routerLinkActive="bg-[#0B1120] text-white"
              (click)="closeMobileMenu()"
              class="rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700"
            >
              3. Batalla de Bancos (2 a 3 Ofertas)
            </a>
            <a
              routerLink="/amortizacion"
              routerLinkActive="bg-[#0B1120] text-white"
              (click)="closeMobileMenu()"
              class="rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700"
            >
              4. Simulador de Amortización Anticipada
            </a>
          </div>
        </nav>
      }
    </header>
  `
})
export class NavbarComponent {
  readonly mobileMenuOpen = signal<boolean>(false);

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
