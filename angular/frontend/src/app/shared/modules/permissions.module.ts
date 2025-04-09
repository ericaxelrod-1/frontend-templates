import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HasPermissionDirective } from '../directives/has-permission.directive';

/**
 * Shared module for permission-related components, directives, and pipes.
 * This module can be imported by any feature module that needs permission functionality.
 */
@NgModule({
  declarations: [
    HasPermissionDirective
  ],
  imports: [
    CommonModule
  ],
  exports: [
    HasPermissionDirective
  ]
})
export class PermissionsModule { } 