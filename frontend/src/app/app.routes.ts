import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Valuriq — Auditoría Hipotecaria y TAE Real',
    loadComponent: () =>
      import('./features/home/home-hub-page.component').then(
        (m) => m.HomeHubPageComponent
      )
  },
  {
    path: 'gastos-compra',
    title: 'Valuriq | Gastos de Compra Día 1',
    loadComponent: () =>
      import('./features/day-one/day-one-costs-page.component').then(
        (m) => m.DayOneCostsPageComponent
      )
  },
  {
    path: 'auditor',
    title: 'Valuriq | Auditor Hipotecario',
    loadComponent: () =>
      import('./features/auditor/auditor-page.component').then(
        (m) => m.AuditorPageComponent
      )
  },
  {
    path: 'audit/:slug',
    title: 'Valuriq | Auditor Hipotecario',
    loadComponent: () =>
      import('./features/auditor/auditor-page.component').then(
        (m) => m.AuditorPageComponent
      )
  },
  {
    path: 'comparar',
    title: 'Valuriq | Batalla de Bancos',
    loadComponent: () =>
      import('./features/battle/bank-battle-page.component').then(
        (m) => m.BankBattlePageComponent
      )
  },
  {
    path: 'amortizacion',
    title: 'Valuriq | Amortización Anticipada',
    loadComponent: () =>
      import('./features/amortization/early-repayment-page.component').then(
        (m) => m.EarlyRepaymentPageComponent
      )
  },
  {
    path: '**',
    redirectTo: ''
  }
];
