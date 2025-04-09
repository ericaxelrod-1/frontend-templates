import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { PermissionService } from '../../core/services/permission.service';
import { RequirePermissions } from '../../shared/decorators/require-permissions.decorator';

/**
 * Component description: This component demonstrates various permission checks.
 * It shows different sections based on user permissions.
 */
@Component({
  selector: 'app-restricted-section',
  template: `
    <div class="restricted-container">
      <h2>Restricted Content Section</h2>
      
      <div class="info-box">
        <p>This component demonstrates different ways to use the permission system.</p>
        <p>Your permissions are checked in real-time against the backend.</p>
      </div>
      
      <!-- Using the permission directive -->
      <div class="permission-section">
        <h3>Basic Content</h3>
        <div *hasPermission="'content:read'" class="content-box">
          <p>You have permission to read basic content.</p>
        </div>
        <div *hasPermission="'content:read'; else noAccess" class="content-box">
          <p>This is shown only if you have 'content:read' permission.</p>
        </div>
        <ng-template #noAccess>
          <div class="no-access">
            <p>You don't have permission to view this content.</p>
          </div>
        </ng-template>
      </div>
      
      <!-- Multiple permissions with AND logic -->
      <div class="permission-section">
        <h3>Advanced Content (requires multiple permissions)</h3>
        <div *hasPermission="['content:read', 'content:write']" class="content-box advanced">
          <p>You have both read AND write permissions for content.</p>
          <button>Edit Content</button>
        </div>
      </div>
      
      <!-- Multiple permissions with OR logic -->
      <div class="permission-section">
        <h3>Special Content (requires one of multiple permissions)</h3>
        <div 
          *hasPermission="['admin:access', 'content:manage']" 
          [hasPermissionOp]="'OR'" 
          class="content-box special"
        >
          <p>You have EITHER admin access OR content management permission.</p>
          <button>Special Actions</button>
        </div>
      </div>
      
      <!-- Using the service directly -->
      <div class="permission-section">
        <h3>Premium Content</h3>
        <ng-container *ngIf="hasPremiumAccess$ | async; else noPremium">
          <div class="content-box premium">
            <p>You have access to premium content.</p>
            <button>Download Premium Content</button>
          </div>
        </ng-container>
        <ng-template #noPremium>
          <div class="no-access">
            <p>Premium content requires a subscription.</p>
            <button>Upgrade Account</button>
          </div>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    .restricted-container {
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    
    .info-box {
      background-color: #e3f2fd;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    
    .permission-section {
      margin-bottom: 30px;
    }
    
    .content-box {
      background-color: #f1f8e9;
      padding: 15px;
      border-radius: 5px;
      border-left: 4px solid #8bc34a;
    }
    
    .content-box.advanced {
      background-color: #fff3e0;
      border-left-color: #ff9800;
    }
    
    .content-box.special {
      background-color: #e0f7fa;
      border-left-color: #00bcd4;
    }
    
    .content-box.premium {
      background-color: #fce4ec;
      border-left-color: #e91e63;
    }
    
    .no-access {
      background-color: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      border-left: 4px solid #9e9e9e;
      color: #757575;
    }
    
    button {
      padding: 8px 16px;
      background-color: #2196f3;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      margin-top: 10px;
    }
    
    button:hover {
      background-color: #1976d2;
    }
  `]
})
@RequirePermissions(['content:read', 'content:write'])
export class RestrictedSectionComponent implements OnInit {
  hasPremiumAccess$!: Observable<boolean>;
  
  constructor(private permissionService: PermissionService) {}
  
  ngOnInit() {
    // Using the service directly for complex permission checks
    this.hasPremiumAccess$ = this.permissionService.hasPermission('content:premium');
  }
} 