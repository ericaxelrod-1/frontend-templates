import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule, MatSortable } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { Group, Permission, GROUP_PERMISSION_SETS } from '../../models/group.model';
import { User } from '../../models/user.model';
import { UserSelectorSidebarComponent } from './user-selector-sidebar/user-selector-sidebar.component';
import { MemberActionsSidebarComponent, MemberAction } from './member-actions-sidebar/member-actions-sidebar.component';
import { GroupCreationSidebarComponent } from './group-creation-sidebar/group-creation-sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { PermissionService } from '../../core/services/permission.service';
import { SidePanelService } from '../../shared/components/side-panel';
import { PageTitleService } from '../../core/services/page-title.service';
import { merge, startWith, switchMap, debounceTime, tap, catchError, of } from 'rxjs';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatListModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="groups-container">
      <div *ngIf="!hasPermission" class="permission-error">
        <p>You do not have permission to view this page.</p>
        <button mat-raised-button color="primary" (click)="goToDashboard()">Go to Dashboard</button>
      </div>
      
      <ng-container *ngIf="hasPermission">
        <div class="actions-bar">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Search groups</mat-label>
            <mat-icon matPrefix>search</mat-icon>
            <input matInput [formControl]="searchControl" placeholder="Search by name or description">
          </mat-form-field>

          <button mat-raised-button color="primary" (click)="createGroup()">
            <mat-icon>add</mat-icon> Create Group
          </button>
        </div>
        
        <div *ngIf="loading" class="loading-overlay">
          <mat-spinner diameter="40"></mat-spinner>
          <span>Loading groups...</span>
        </div>
        
        <div class="table-container mat-elevation-z8">
          <table mat-table [dataSource]="dataSource" matSort matSortActive="name" matSortDirection="asc" class="groups-table">
            <!-- Name Column -->
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Name</th>
              <td mat-cell *matCellDef="let group">{{ group.name }}</td>
            </ng-container>

            <!-- Owner Column -->
            <ng-container matColumnDef="owner">
              <th mat-header-cell *matHeaderCellDef>Owner</th>
              <td mat-cell *matCellDef="let group">{{ group.owner?.firstName }} {{ group.owner?.lastName }}</td>
            </ng-container>

            <!-- Description Column -->
            <ng-container matColumnDef="description">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Description</th>
              <td mat-cell *matCellDef="let group">{{ group.description }}</td>
            </ng-container>

            <!-- Members Column -->
            <ng-container matColumnDef="members">
              <th mat-header-cell *matHeaderCellDef>Members</th>
              <td mat-cell *matCellDef="let group">
                <mat-chip-set>
                  <mat-chip *ngFor="let user of ($any(group.users) | slice:0:3)">
                    {{ ($any(user).firstName || '') + ' ' + ($any(user).lastName || '') || $any(user).email }}
                  </mat-chip>
                  <mat-chip *ngIf="($any(group.users)?.length || 0) > 3">
                    +{{ $any(group.users).length - 3 }} more
                  </mat-chip>
                </mat-chip-set>
                <div *ngIf="!group.users || group.users.length === 0" class="no-members-text">
                  No members
                </div>
              </td>
            </ng-container>

            <!-- Actions Column -->
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef>Actions</th>
              <td mat-cell *matCellDef="let group">
                <button mat-icon-button color="primary" (click)="editGroup(group)" matTooltip="Edit Group">
                  <mat-icon>edit</mat-icon>
                </button>
                <button mat-icon-button (click)="addMember(group)" matTooltip="Add Member">
                  <mat-icon>person_add</mat-icon>
                </button>
                <button mat-icon-button color="warn" (click)="deleteGroup(group)" matTooltip="Delete Group">
                  <mat-icon>delete</mat-icon>
                </button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>

            <!-- Row shown when there is no matching data. -->
            <tr class="mat-row" *matNoDataRow>
              <td class="mat-cell" colspan="5" *ngIf="!loading">
                No groups found matching the filter "{{searchControl.value}}"
              </td>
            </tr>
          </table>

          <mat-paginator 
            [length]="totalCount" 
            [pageSize]="pageSize" 
            [pageSizeOptions]="[5, 10, 25, 100]"
            aria-label="Select page of groups">
          </mat-paginator>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .groups-container {
      padding: 20px;
    }
    
    .actions-bar {
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .search-field {
      width: 300px;
    }
    
    .table-container {
      position: relative;
      background: white;
      border-radius: 4px;
      overflow: hidden;
    }
    
    .groups-table {
      width: 100%;
    }

    .groups-table .mat-cell,
    .groups-table .mat-header-cell {
      padding-top: 16px;
      padding-bottom: 16px;
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.7);
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 16px;
    }
    
    .permission-error {
      text-align: center;
      padding: 20px;
      background-color: #f5f5f5;
      border-radius: 4px;
      margin: 20px 0;
    }
    
    .no-members-text {
      font-style: italic;
      color: #757575;
      font-size: 12px;
    }

    mat-chip {
      --mdc-chip-label-text-size: 11px;
    }
  `]
})
export class GroupsComponent implements OnInit, AfterViewInit {
  displayedColumns: string[] = ['name', 'owner', 'description', 'members', 'actions'];
  dataSource: Group[] = [];
  totalCount = 0;
  pageSize = 10;

  hasPermission = false;
  loading = true;

  searchControl = new FormControl('');

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private reactivePatternInitialized = false;
  private shouldInitializeReactivePattern = false;

  constructor(
    private groupService: GroupService,
    private userService: UserService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private router: Router,
    private permissionService: PermissionService,
    private sidePanelService: SidePanelService,
    private pageTitleService: PageTitleService
  ) { }

  ngOnInit(): void {
    this.pageTitleService.setTitle('Groups');

    // Check permission to view groups using resource:action format
    this.permissionService.hasPermission('groups:view').subscribe(hasPermission => {
      console.log('[GroupsComponent] Permission check result:', hasPermission);
      this.hasPermission = hasPermission;

      if (hasPermission) {
        this.shouldInitializeReactivePattern = true;
        // If ViewChild is already available (shouldn't happen in ngOnInit but good practice)
        if (this.sort && this.paginator) {
          this.initializeReactivePattern();
        }
      } else {
        this.loading = false;
        this.snackBar.open('You do not have permission to access this page', 'Close', { duration: 5000 });
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.shouldInitializeReactivePattern && !this.reactivePatternInitialized) {
      this.initializeReactivePattern();
    }
  }

  private initializeReactivePattern(): void {
    if (this.reactivePatternInitialized || !this.sort || !this.paginator || !this.hasPermission) {
      return;
    }

    this.reactivePatternInitialized = true;

    // Use setTimeout to avoid NG0100 error with default sort
    setTimeout(() => {
      this.sort.sort({
        id: 'name',
        start: 'asc',
        disableClear: false
      } as MatSortable);
    }, 0);

    // Combine all user interaction streams
    merge(
      this.sort.sortChange.pipe(tap(() => this.paginator.pageIndex = 0)),
      this.paginator.page,
      this.searchControl.valueChanges.pipe(
        debounceTime(300),
        tap(() => this.paginator.pageIndex = 0)
      )
    )
      .pipe(
        startWith({}),
        switchMap(() => {
          this.loading = true;
          return this.groupService.getGroups({
            page: this.paginator.pageIndex,
            pageSize: this.paginator.pageSize,
            sortBy: this.sort.active,
            sortDirection: this.sort.direction.toUpperCase(),
            search: this.searchControl.value || ''
          }).pipe(
            catchError((error) => {
              console.error('Error loading groups:', error);
              this.snackBar.open('Error loading groups', 'Close', { duration: 3000 });
              return of(null);
            })
          );
        })
      )
      .subscribe({
        next: (response) => {
          if (response) {
            this.dataSource = response.items;
            this.totalCount = response.total;
          }
          this.loading = false;
        }
      });
  }

  loadGroups(): void {
    // Manually trigger a reload by clearing page index if needed
    // In our reactive pattern, we can just trigger a dummy event or let switchMap handle it
    // For simplicity, we just trigger the paginator's page event or similar
    if (this.paginator) {
      this.paginator.page.emit();
    }
  }

  createGroup(): void {
    this.openGroupPanel(null);
  }

  editGroup(group: Group): void {
    this.openGroupPanel(group);
  }

  private openGroupPanel(groupData: Group | null): void {
    const ref = this.sidePanelService.open(GroupCreationSidebarComponent, {
      data: { groupData },
      width: '400px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.onGroupSaved(result, groupData);
      }
    });
  }

  onGroupSaved(groupData: Partial<Group>, originalGroup: Group | null): void {
    if (originalGroup) {
      // Edit mode
      this.groupService.updateGroup(originalGroup.id, groupData).subscribe({
        next: () => {
          Object.assign(originalGroup, groupData);
          this.snackBar.open('Group updated successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error updating group:', error);
          this.snackBar.open('Error updating group', 'Close', { duration: 3000 });
        }
      });
    } else {
      // Create mode
      this.groupService.createGroup(groupData).subscribe({
        next: (group) => {
          if (!group.users) {
            group.users = [];
          }
          // With reactive loading, we reload the entire list to keep pagination/sorting correct
          this.loadGroups();
          this.snackBar.open('Group created successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error creating group:', error);
          this.snackBar.open('Error creating group', 'Close', { duration: 3000 });
        }
      });
    }
  }

  deleteGroup(group: Group): void {
    if (confirm(`Are you sure you want to delete the group "${group.name}"?`)) {
      this.groupService.deleteGroup(group.id).subscribe({
        next: () => {
          this.loadGroups();
          this.snackBar.open('Group deleted successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error deleting group:', error);
          if (error.status === 403) {
            this.snackBar.open('You do not have permission to delete groups', 'Close', { duration: 5000 });
          } else {
            this.snackBar.open('Error deleting group', 'Close', { duration: 3000 });
          }
        }
      });
    }
  }

  addMember(group: Group): void {
    // Load available users, then open the panel
    this.userService.getUsers().subscribe({
      next: (users) => {
        const memberIds = group.users?.map(user => user.id) || [];
        const availableUsers = users.filter(user => !memberIds.includes(user.id));

        const ref = this.sidePanelService.open(UserSelectorSidebarComponent, {
          data: { group, availableUsers },
          width: '400px'
        });
        ref.afterClosed().subscribe(result => {
          if (result) {
            this.onUserSelected(result);
          }
        });
      },
      error: (error) => {
        console.error('Error loading available users:', error);
        this.snackBar.open('Error loading available users', 'Close', { duration: 3000 });
      }
    });
  }


  onUserSelected(event: { user: User; group: Group }): void {
    const { user, group } = event;

    // Use non-deprecated method with default member permissions
    const defaultPermissions: Permission[] = GROUP_PERMISSION_SETS['MEMBER'];
    this.groupService.addMemberWithPermissions(group.id, user.id, defaultPermissions).subscribe({
      next: () => {
        this.loadGroups(); // Reload to get updated member list
        this.snackBar.open(`${user.firstName} ${user.lastName} added to ${group.name} successfully`, 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error adding member:', error);
        this.snackBar.open('Error adding member to group', 'Close', { duration: 3000 });
      }
    });
  }

  removeMember(group: Group, member: User): void {
    if (confirm(`Are you sure you want to remove ${(member.firstName || '') + ' ' + (member.lastName || '') || member.email} from the group?`)) {
      this.groupService.removeMember(group.id, member.id).subscribe({
        next: () => {
          if (group.users) {
            group.users = group.users.filter(u => u.id !== member.id);
          }
          this.snackBar.open('Member removed successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error removing member:', error);
          this.snackBar.open('Error removing member', 'Close', { duration: 3000 });
        }
      });
    }
  }

  makeAdmin(group: Group, member: User): void {
    // Use non-deprecated method with admin permissions
    const adminPermissions: Permission[] = GROUP_PERMISSION_SETS['ADMIN'];
    this.groupService.updateMemberPermissions(group.id, member.id, adminPermissions).subscribe({
      next: () => {
        // Update the user's role in the local data
        if (member.roles && member.roles.length > 0) {
          member.roles[0].name = 'Admin';
        }
        this.snackBar.open('Member role updated successfully', 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error updating member permissions:', error);
        this.snackBar.open('Error updating member permissions', 'Close', { duration: 3000 });
      }
    });
  }

  openMemberActions(group: Group, member: User): void {
    const ref = this.sidePanelService.open(MemberActionsSidebarComponent, {
      data: { member, group },
      width: '400px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.onMemberActionSelected(result);
      }
    });
  }


  onMemberActionSelected(event: { action: MemberAction; member: User; group: Group }): void {
    console.log('[GroupsComponent] Member action selected:', event.action.id, 'for member:', (event.member.firstName || '') + ' ' + (event.member.lastName || '') || event.member.email);

    switch (event.action.id) {
      case 'make-admin':
        this.makeAdmin(event.group, event.member);
        break;
      case 'remove-member':
        this.removeMember(event.group, event.member);
        break;
      default:
        console.warn('[GroupsComponent] Unknown action:', event.action.id);
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/app/dashboard']);
  }
}
