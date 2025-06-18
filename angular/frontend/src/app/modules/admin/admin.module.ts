import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { PermissionGuard } from '../../core/guards/permission.guard';
import { LoginMonitoringComponent } from './login-monitoring/login-monitoring.component';
import { HttpClientModule } from '@angular/common/http';

// Material Modules
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';

// Routes
const routes: Routes = [
  {
    path: '',
    redirectTo: 'login-monitoring',
    pathMatch: 'full'
  },
  {
    path: 'login-monitoring',
    component: LoginMonitoringComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: 'system:admin'
    }
  }
];

@NgModule({
  declarations: [
    LoginMonitoringComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HttpClientModule,
    RouterModule.forChild(routes),
    
    // Material Modules
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatTabsModule
  ],
  exports: [
    RouterModule
  ]
})
export class AdminModule { } 