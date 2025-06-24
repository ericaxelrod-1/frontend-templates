import { Directive, Input, OnInit, OnDestroy, TemplateRef, ViewContainerRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { PermissionService } from '../../core/services/permission.service';

/**
 * Directive for conditionally rendering a template based on user permissions.
 * 
 * Usage:
 * <div *hasPermission="'users:view'">Only shown to users with 'users:view' permission</div>
 * <div *hasPermission="['users:create', 'users:update']">Shown if user has any of these permissions</div>
 * <div *hasPermission="'users:delete'; else unauthorized">Shown to users with delete permission</div>
 * <ng-template #unauthorized>Access denied message</ng-template>
 */
@Directive({
  selector: '[hasPermission]'
})
export class HasPermissionDirective implements OnInit, OnDestroy {
  private hasView = false;
  private permissionValue: string | string[] = '';
  private subscription = new Subscription();

  @Input() set hasPermission(val: string | string[]) {
    this.permissionValue = val;
    this.updateView();
  }
  
  @Input() hasPermissionElse?: TemplateRef<any>;

  constructor(
    private templateRef: TemplateRef<any>,
    private viewContainer: ViewContainerRef,
    private permissionService: PermissionService
  ) {}

  ngOnInit(): void {
    this.updateView();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  private updateView(): void {
    if (!this.permissionValue) {
      this.viewContainer.clear();
      this.hasView = false;
      return;
    }

    this.subscription.unsubscribe();
    this.subscription = new Subscription();

    if (Array.isArray(this.permissionValue)) {
      // Handle array of permissions (any match)
      this.subscription.add(
        this.permissionService.hasAnyPermission(this.permissionValue).subscribe(hasPermission => {
          this.setView(hasPermission);
        })
      );
    } else {
      // Handle single permission
      this.subscription.add(
        this.permissionService.hasPermission(this.permissionValue).subscribe(hasPermission => {
          this.setView(hasPermission);
        })
      );
    }
  }

  private setView(hasPermission: boolean): void {
    if (hasPermission && !this.hasView) {
      this.viewContainer.clear();
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!hasPermission && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
      
      if (this.hasPermissionElse) {
        this.viewContainer.createEmbeddedView(this.hasPermissionElse);
      }
    } else if (!hasPermission && !this.hasView && this.hasPermissionElse) {
      this.viewContainer.clear();
      this.viewContainer.createEmbeddedView(this.hasPermissionElse);
    }
  }
} 