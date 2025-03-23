const routes: Routes = [
  {
    path: 'verify-email',
    component: () => import('./features/auth/verify-email/verify-email.component').then(m => m.VerifyEmailComponent),
    title: 'Verify Email'
  },
]; 