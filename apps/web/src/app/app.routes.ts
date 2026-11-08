import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';
import { Session } from './core/session';
import { SignIn } from './pages/sign-in';
import { Start } from './pages/start';
import { Shell } from './shell';

const signedIn: CanActivateFn = async (_route, state) => {
  const session = inject(Session);
  const me = session.me() ?? (await session.load());
  return me ? true : inject(Router).createUrlTree(['/sign-in'], { queryParams: { next: state.url } });
};

const page = (path: string, title: string, load: Routes[number]['loadComponent']) => ({
  path,
  loadComponent: load,
  title: `${title} · OpenRelay`,
});

export const routes: Routes = [
  { path: 'sign-in', component: SignIn, title: 'Sign in · OpenRelay' },
  // The customer's page: no account, no shell.
  page('t/:token', 'Your parcel', () => import('./pages/tracking').then((m) => m.Tracking)),
  {
    path: '',
    component: Shell,
    canActivate: [signedIn],
    children: [
      { path: '', component: Start, title: 'OpenRelay' },
      // A label's QR code: the scan page of the network this person works in.
      page('s/:code', 'Scan', () => import('./pages/scan').then((m) => m.Scan)),
      // Old address: Networks moved into Settings.
      { path: 'networks', redirectTo: 'settings/networks', pathMatch: 'full' },
      { path: 'settings', redirectTo: 'settings/account', pathMatch: 'full' },
      page('settings/:tab', 'Settings', () =>
        import('./pages/settings/settings').then((m) => m.SettingsPage),
      ),
      {
        path: 'n/:network',
        children: [
          { path: '', pathMatch: 'full', component: Start },
          page('scan', 'Scan', () => import('./pages/scan').then((m) => m.Scan)),
          page('parcels', 'Parcels', () => import('./pages/parcels').then((m) => m.Parcels)),
          page('parcels/new', 'New parcel', () => import('./pages/new-parcel').then((m) => m.NewParcel)),
          page('parcels/:id', 'Parcel', () => import('./pages/parcel').then((m) => m.ParcelPage)),
          page('pickups', 'Pickups', () => import('./pages/pickups').then((m) => m.Pickups)),
          page('points', 'Pick-up points', () => import('./pages/points').then((m) => m.Points)),
          page('merchants', 'Shops', () => import('./pages/merchants').then((m) => m.Merchants)),
          // Old addresses: these moved into Settings.
          { path: 'members', redirectTo: 'settings/members', pathMatch: 'full' },
          { path: 'api-keys', redirectTo: 'settings/api-keys', pathMatch: 'full' },
          { path: 'data', redirectTo: 'settings/data', pathMatch: 'full' },
          { path: 'settings', redirectTo: 'settings/account', pathMatch: 'full' },
          page('settings/:tab', 'Settings', () =>
            import('./pages/settings/settings').then((m) => m.SettingsPage),
          ),
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
