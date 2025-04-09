import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { ComponentPermissionsComponent } from './component-permissions/component-permissions.component';
import { RoutePermissionsComponent } from './route-permissions/route-permissions.component';
import { EndpointPermissionsComponent } from './endpoint-permissions/endpoint-permissions.component';
import { PermissionsDashboardComponent } from './permissions-dashboard/permissions-dashboard.component';

// Import Assignment Components
import {
  AssignComponentPermissionsComponent,
  AssignRoutePermissionsComponent,
  AssignEndpointPermissionsComponent
} from './assign-permissions';

// Angular Material Imports
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';

const routes: Routes = [
  {
    path: '',
    component: PermissionsDashboardComponent,
    children: [
      { path: '', redirectTo: 'components', pathMatch: 'full' },
      { path: 'components', component: ComponentPermissionsComponent },
      { path: 'routes', component: RoutePermissionsComponent },
      { path: 'endpoints', component: EndpointPermissionsComponent },
      { path: 'assign/component/:id', component: AssignComponentPermissionsComponent },
      { path: 'assign/route/:id', component: AssignRoutePermissionsComponent },
      { path: 'assign/endpoint/:id', component: AssignEndpointPermissionsComponent },
    ]
  }
];

@NgModule({
  declarations: [
    ComponentPermissionsComponent,
    RoutePermissionsComponent,
    EndpointPermissionsComponent,
    PermissionsDashboardComponent,
    AssignComponentPermissionsComponent,
    AssignRoutePermissionsComponent,
    AssignEndpointPermissionsComponent,
  ],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    ReactiveFormsModule,
    // Angular Material
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTabsModule,
    MatCardModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatDialogModule,
    MatDividerModule,
    MatListModule,
    MatSelectModule,
  ],
  exports: [
    PermissionsDashboardComponent
  ]
})
export class PermissionsManagementModule { } 