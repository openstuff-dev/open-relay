import { type Routes } from '@angular/router';
import { Home } from './home';

export const routes: Routes = [
  { path: '', component: Home, title: 'Open Relay' },
  { path: '**', redirectTo: '' },
];
