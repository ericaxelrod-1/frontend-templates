import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PermissionInspectorService, PermissionInspection } from '../../../services/permission-inspector.service';
import { UserService } from '../../../services/user.service';
import { RoleService, Role } from '../../../services/role.service';
import { GroupService } from '../../../services/group.service';
import { User } from '../../../models/user.model';
import { Group } from '../../../models/group.model';

@Component({
  selector: 'app-permission-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="inspector">
      <header class="inspector-header">
        <h1>Permission Inspector</h1>
        <p class="subtitle">Debug permission inheritance and effective permissions</p>
      </header>

      <div class="inspector-tabs">
        <button 
          [class.active]="activeTab === 'user'" 
          (click)="activeTab = 'user'">
          User Inspector
        </button>
        <button 
          [class.active]="activeTab === 'role'" 
          (click)="activeTab = 'role'">
          Role Inspector
        </button>
        <button 
          [class.active]="activeTab === 'group'" 
          (click)="activeTab = 'group'">
          Group Inspector
        </button>
      </div>

      <div class="inspector-content">
        @if (activeTab === 'user') {
          <div class="inspector-form">
            <label>Select User:</label>
            <div class="form-row">
              <select [(ngModel)]="selectedUserId">
                <option [ngValue]="undefined">Select a user...</option>
                @for (user of users; track user.id) {
                  <option [value]="user.id">
                    {{ user.firstName }} {{ user.lastName }} ({{ user.email }})
                  </option>
                }
              </select>
              <button class="btn-primary" (click)="inspectUser()">Inspect User</button>
              <button class="btn-secondary" (click)="loadAllUsers()">Load All</button>
            </div>
          </div>
        }

        @if (activeTab === 'role') {
          <div class="inspector-form">
            <label>Select Role:</label>
            <div class="form-row">
              <select [(ngModel)]="selectedRoleId">
                <option [ngValue]="undefined">Select a role...</option>
                @for (role of roles; track role.id) {
                  <option [value]="role.id">{{ role.name }}</option>
                }
              </select>
              <button class="btn-primary" (click)="inspectRole()">Inspect Role</button>
              <button class="btn-secondary" (click)="loadAllRoles()">Load All</button>
            </div>
          </div>
        }

        @if (activeTab === 'group') {
          <div class="inspector-form">
            <label>Select Group:</label>
            <div class="form-row">
              <select [(ngModel)]="selectedGroupId">
                <option [ngValue]="undefined">Select a group...</option>
                @for (group of groups; track group.id) {
                  <option [value]="group.id">{{ group.name }}</option>
                }
              </select>
              <button class="btn-primary" (click)="inspectGroup()">Inspect Group</button>
              <button class="btn-secondary" (click)="loadAllGroups()">Load All</button>
            </div>
          </div>
        }

        @if (inspection) {
          <div class="inspection-results">
            <div class="result-section">
              <h3>Direct Assignments</h3>
              
              @if (inspection.directRoles?.length) {
                <div class="assignment-group">
                  <h4>Roles</h4>
                  <ul>
                    @for (role of inspection.directRoles; track role.id) {
                      <li>{{ role.name }}</li>
                    }
                  </ul>
                </div>
              }

              @if (inspection.directGroups?.length) {
                <div class="assignment-group">
                  <h4>Groups</h4>
                  <ul>
                    @for (group of inspection.directGroups; track group.id) {
                      <li>{{ group.name }}</li>
                    }
                  </ul>
                </div>
              }
            </div>

            @if (inspection.hierarchy) {
              <div class="result-section">
                <h3>Hierarchy</h3>
                
                @if (inspection.hierarchy.ancestors?.length) {
                  <div class="hierarchy-column">
                    <h4>Ancestors</h4>
                    <ul class="ancestor-list">
                      @for (item of inspection.hierarchy.ancestors; track item.id) {
                        <li class="ancestor">{{ item.name }}</li>
                      }
                    </ul>
                  </div>
                }

                <div class="hierarchy-column current">
                  <h4>Current</h4>
                  <div class="current-item">
                    {{ inspection.role?.name || inspection.group?.name || 'Selected' }}
                  </div>
                </div>

                @if (inspection.hierarchy.descendants?.length) {
                  <div class="hierarchy-column">
                    <h4>Descendants</h4>
                    <ul class="descendant-list">
                      @for (item of inspection.hierarchy.descendants; track item.id) {
                        <li class="descendant">{{ item.name }}</li>
                      }
                    </ul>
                  </div>
                }
              </div>
            }

            @if (inspection.directPermissions?.length || inspection.effectivePermissions?.length) {
              <div class="result-section">
                <h3>Permissions</h3>
                
                @if (inspection.directPermissions?.length) {
                  <div class="permissions-block">
                    <h4>Direct Permissions</h4>
                    <table class="permissions-table">
                      <thead>
                        <tr>
                          <th>Permission</th>
                          <th>Value</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (perm of inspection.directPermissions; track perm.permission) {
                          <tr>
                            <td><code>{{ perm.permission }}</code></td>
                            <td>
                              <span [class.granted]="perm.isGranted" [class.denied]="!perm.isGranted">
                                {{ perm.isGranted ? 'Granted' : 'Denied' }}
                              </span>
                            </td>
                            <td>{{ perm.source }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }

                @if (inspection.effectivePermissions?.length) {
                  <div class="permissions-block">
                    <h4>Effective Permissions (after inheritance)</h4>
                    <table class="permissions-table">
                      <thead>
                        <tr>
                          <th>Permission</th>
                          <th>Effective Value</th>
                          <th>Inherited From</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (perm of inspection.effectivePermissions; track perm.permission) {
                          <tr>
                            <td><code>{{ perm.permission }}</code></td>
                            <td>
                              <span [class.granted]="perm.isGranted" [class.denied]="!perm.isGranted">
                                {{ perm.isGranted ? 'Granted' : 'Denied' }}
                              </span>
                            </td>
                            <td>{{ perm.inheritedFrom || 'Direct' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .inspector {
      padding: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
    }
    .inspector-header {
      margin-bottom: 1.5rem;
    }
    .inspector-header h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.75rem;
    }
    .subtitle {
      color: #64748b;
      margin: 0;
    }
    .inspector-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 0.5rem;
    }
    .inspector-tabs button {
      padding: 0.5rem 1rem;
      border: none;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      border-radius: 0.375rem 0.375rem 0 0;
    }
    .inspector-tabs button.active {
      background: #3b82f6;
      color: white;
    }
    .inspector-form {
      margin-bottom: 1.5rem;
    }
    .inspector-form label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    .inspector-form select {
      flex: 1;
      padding: 0.5rem;
      border: 1px solid #cbd5e1;
      border-radius: 0.375rem;
    }
    .form-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .btn-primary {
      padding: 0.5rem 1rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-weight: 500;
    }
    .btn-primary:hover {
      background: #2563eb;
    }
    .btn-secondary {
      padding: 0.5rem 1rem;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
      border-radius: 0.375rem;
      cursor: pointer;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
    }
    .inspection-results {
      display: grid;
      gap: 1.5rem;
    }
    .result-section {
      background: white;
      border-radius: 0.5rem;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .result-section h3 {
      margin: 0 0 1rem 0;
      font-size: 1.125rem;
      color: #1e293b;
    }
    .assignment-group {
      margin-bottom: 1rem;
    }
    .assignment-group h4 {
      margin: 0 0 0.5rem 0;
      font-size: 0.875rem;
      color: #64748b;
      text-transform: uppercase;
    }
    .assignment-group ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .assignment-group li {
      background: #f1f5f9;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
    }
    .hierarchy-column {
      margin-bottom: 1rem;
    }
    .hierarchy-column h4 {
      margin: 0 0 0.5rem 0;
      font-size: 0.875rem;
      color: #64748b;
    }
    .ancestor-list, .descendant-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .ancestor-list li, .descendant-list li {
      padding: 0.25rem 0;
      font-size: 0.875rem;
    }
    .ancestor { color: #64748b; }
    .descendant { color: #94a3b8; }
    .current-item {
      font-weight: 600;
      color: #3b82f6;
      padding: 0.25rem 0;
    }
    .permissions-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    .permissions-table th, .permissions-table td {
      padding: 0.5rem;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    .permissions-table th {
      font-weight: 600;
      color: #64748b;
    }
    .granted {
      color: #10b981;
      font-weight: 500;
    }
    .denied {
      color: #ef4444;
      font-weight: 500;
    }
  `]
})
export class PermissionInspectorComponent implements OnInit {
  activeTab: 'user' | 'role' | 'group' = 'user';
  
  users: User[] = [];
  roles: Role[] = [];
  groups: Group[] = [];
  
  selectedUserId?: number;
  selectedRoleId?: number;
  selectedGroupId?: number;
  
  inspection?: PermissionInspection;

  constructor(
    private inspectorService: PermissionInspectorService,
    private userService: UserService,
    private roleService: RoleService,
    private groupService: GroupService
  ) {}

  ngOnInit(): void {
    this.loadUsers();
    this.loadRoles();
    this.loadGroups();
  }

  loadUsers(): void {
    this.userService.getUsers().subscribe({
      next: (res: any) => this.users = Array.isArray(res) ? res : (res.items || []),
      error: (err: any) => console.error('Failed to load users:', err)
    });
  }

  loadRoles(): void {
    this.roleService.getRoles({}).subscribe({
      next: (res: any) => this.roles = Array.isArray(res) ? res : (res.items || []),
      error: (err: any) => console.error('Failed to load roles:', err)
    });
  }

  loadGroups(): void {
    this.groupService.getGroups({}).subscribe({
      next: (res: any) => this.groups = res.items || [],
      error: (err: any) => console.error('Failed to load groups:', err)
    });
  }

  inspectUser(): void {
    if (!this.selectedUserId) return;
    this.inspection = undefined;
    this.inspectorService.inspectUser(this.selectedUserId).subscribe({
      next: (result: PermissionInspection) => this.inspection = result,
      error: (err: any) => console.error('Failed to inspect user:', err)
    });
  }

  inspectRole(): void {
    if (!this.selectedRoleId) return;
    this.inspection = undefined;
    this.inspectorService.inspectRole(this.selectedRoleId).subscribe({
      next: (result: PermissionInspection) => this.inspection = result,
      error: (err: any) => console.error('Failed to inspect role:', err)
    });
  }

  inspectGroup(): void {
    if (!this.selectedGroupId) return;
    this.inspection = undefined;
    this.inspectorService.inspectGroup(this.selectedGroupId).subscribe({
      next: (result: PermissionInspection) => this.inspection = result,
      error: (err: any) => console.error('Failed to inspect group:', err)
    });
  }

  loadAllUsers(): void {
    this.inspection = undefined;
    this.inspectorService.loadAllUsers().subscribe({
      next: (result: PermissionInspection) => this.inspection = result,
      error: (err: any) => console.error('Failed to load all users:', err)
    });
  }

  loadAllRoles(): void {
    this.inspection = undefined;
    this.inspectorService.loadAllRoles().subscribe({
      next: (result: PermissionInspection) => this.inspection = result,
      error: (err: any) => console.error('Failed to load all roles:', err)
    });
  }

  loadAllGroups(): void {
    this.inspection = undefined;
    this.inspectorService.loadAllGroups().subscribe({
      next: (result: PermissionInspection) => this.inspection = result,
      error: (err: any) => console.error('Failed to load all groups:', err)
    });
  }
}
