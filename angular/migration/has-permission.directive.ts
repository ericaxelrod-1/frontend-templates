import { Directive, Input, OnDestroy, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { PermissionService } from '../services/permission.service';

/**
 * Structural directive for conditionally showing elements based on user permissions
 * 
 * Usage examples:
 * 
 * Single permission check:
 * <div *hasPermission="{ resource: 'user', action: 'create' }">...</div>
 * 
 * With else template:
 * <div *hasPermission="{ resource: 'user', action: 'create' }; else noAccess">...</div>
 * <ng-template #noAccess>You don't have access to create users</ng-template>
 * 
 * Check multiple permissions (ANY):
 * <div *hasPermission="[
 *   { resource: 'user', action: 'create' },
 *   { resource: 'user', action: 'update' }
 * ]; mode: 'any'">
 *   You can create OR update users
 * </div>
 * 
 * Check multiple permissions (ALL):
 * <div *hasPermission="[
 *   { resource: 'user', action: 'create' },
 *   { resource: 'user', action: 'update' }
 * ]; mode: 'all'">
 *   You can create AND update users
 * </div>
 */
@Directive({
  selector: '[hasPermission]'
})
export class HasPermissionDirective implements OnInit, OnDestroy {
  private subscription: Subscription | null = null;
  private hasView = false;
  
  // Single permission or array of permissions
  @Input() set hasPermission(val: { resource: string; action: string } | Array<{ resource: string; action: string }>) {
    this.permissionValue = val;
    this.updateView();
  }
  
  // Check mode: 'all' requires all permissions, 'any' requires any permission
  @Input() mode: 'all' | 'any' = 'any';
  
  // Template reference for the else condition
  @Input() hasPermissionElse: TemplateRef<any> | null = null;
  
  private permissionValue: { resource: string; action: string } | Array<{ resource: string; action: string }> | null = null;

  constructor(
    private templateRef: TemplateRef<any>,
    private viewContainer: ViewContainerRef,
    private permissionService: PermissionService
  ) {}

  ngOnInit(): void {
    this.updateView();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private updateView(): void {
    if (!this.permissionValue) {
      this.showErrorState();
      return;
    }

    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    // Check if it's a single permission or an array
    if (Array.isArray(this.permissionValue)) {
      // Handle multiple permissions
      if (this.permissionValue.length === 0) {
        this.showErrorState();
        return;
      }

      this.subscription = (
        this.mode === 'all'
          ? this.permissionService.hasAllPermissions(this.permissionValue)
          : this.permissionService.hasAnyPermission(this.permissionValue)
      ).subscribe(hasPermission => {
        this.showHideView(hasPermission);
      });
    } else {
      // Handle single permission
      const { resource, action } = this.permissionValue;
      this.subscription = this.permissionService
        .hasPermission(resource, action)
        .subscribe(hasPermission => {
          this.showHideView(hasPermission);
        });
    }
  }

  private showHideView(hasPermission: boolean): void {
    if (hasPermission && !this.hasView) {
      // Show the original template
      this.viewContainer.clear();
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!hasPermission && this.hasView) {
      // Clear the view
      this.viewContainer.clear();
      
      // Show the else template if provided
      if (this.hasPermissionElse) {
        this.viewContainer.createEmbeddedView(this.hasPermissionElse);
      }
      
      this.hasView = false;
    } else if (!hasPermission && !this.hasView && this.hasPermissionElse) {
      // Initially show the else template
      this.viewContainer.clear();
      this.viewContainer.createEmbeddedView(this.hasPermissionElse);
    }
  }

  private showErrorState(): void {
    console.error('HasPermissionDirective: Invalid permission input');
    this.viewContainer.clear();
    
    if (this.hasPermissionElse) {
      this.viewContainer.createEmbeddedView(this.hasPermissionElse);
    }
    
    this.hasView = false;
  }
} 