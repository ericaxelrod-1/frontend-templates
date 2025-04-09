import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('../auth/profile/profile.component').then(c => c.ProfileComponent),
  }
]; 