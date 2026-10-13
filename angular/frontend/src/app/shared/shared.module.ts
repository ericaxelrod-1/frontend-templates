import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PermissionsModule } from './modules/permissions.module';

/**
 * Shared module for common components, directives, and pipes.
 * This module can be imported by any feature module.
 *
 * AccessDeniedComponent was removed from `declarations`/`exports` when it became
 * standalone: Angular 18 rejects a standalone component inside an NgModule, and
 * the component has to be standalone for `app.routes.ts` to load it.
 */
@NgModule({
  declarations: [],
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
    PermissionsModule
  ]
})
export class SharedModule { } 