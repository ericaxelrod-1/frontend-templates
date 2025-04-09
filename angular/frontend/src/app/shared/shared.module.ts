import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AccessDeniedComponent } from './components/access-denied/access-denied.component';
import { PermissionsModule } from './modules/permissions.module';

/**
 * Shared module for common components, directives, and pipes.
 * This module can be imported by any feature module.
 */
@NgModule({
  declarations: [
    AccessDeniedComponent
  ],
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    PermissionsModule
  ],
  exports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    PermissionsModule,
    AccessDeniedComponent
  ]
})
export class SharedModule { } 