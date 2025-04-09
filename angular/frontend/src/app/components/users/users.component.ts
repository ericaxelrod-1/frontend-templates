import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil, lastValueFrom } from 'rxjs';
import { User } from '../../models/user.model';
import { UserService } from '../../services/user.service';
import { PermissionService } from '../../core/services/permission.service';
import { NotificationService } from '../../core/services/notification.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss'],
  imports: [CommonModule],
  standalone: true
})
export class UsersComponent implements OnInit, OnDestroy {
  users: User[] = [];
  selectedUser: User | null = null;
  loading = false;
  error: string | null = null;
  private destroy$ = new Subject<void>();
  hasViewPermission = false;
  hasEditPermission = false;
  hasDeletePermission = false;

  constructor(
    private userService: UserService,
    private permissionService: PermissionService,
    private notificationService: NotificationService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadPermissions();
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadPermissions(): Promise<void> {
    try {
      // Load permissions first
      await lastValueFrom(this.permissionService.loadUserPermissions());
      
      // Then check specific permissions
      this.hasViewPermission = await lastValueFrom(this.permissionService.hasPermission('user', 'read'));
      this.hasEditPermission = await lastValueFrom(this.permissionService.hasPermission('user', 'update'));
      this.hasDeletePermission = await lastValueFrom(this.permissionService.hasPermission('user', 'delete'));
    } catch (error) {
      console.error('Error loading permissions:', error);
      this.notificationService.showError('Failed to load permissions');
    }
  }

  loadUsers(): void {
    this.loading = true;
    this.error = null;

    this.userService.getUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (users: User[]) => {
          this.users = users;
          this.loading = false;
        },
        error: (err: Error) => {
          console.error('Error loading users:', err);
          this.error = 'Failed to load users. Please try again.';
          this.loading = false;
          this.notificationService.showError('Failed to load users');
        }
      });
  }

  loadUser(userId: number): void {
    this.loading = true;
    this.error = null;

    this.userService.getUser(userId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (user: User) => {
          this.selectedUser = user;
          this.loading = false;
        },
        error: (err: Error) => {
          console.error('Error loading user:', err);
          this.error = 'Failed to load user details. Please try again.';
          this.loading = false;
          this.notificationService.showError('Failed to load user details');
        }
      });
  }

  selectUser(user: User): void {
    this.selectedUser = user;
  }

  canViewUserDetails(): boolean {
    return this.hasViewPermission;
  }

  canEditUser(): boolean {
    return this.hasEditPermission;
  }

  canDeleteUser(): boolean {
    return this.hasDeletePermission;
  }

  deleteUser(user: User): void {
    if (!this.canDeleteUser()) {
      this.notificationService.showError('You do not have permission to delete users');
      return;
    }

    if (confirm(`Are you sure you want to delete user ${user.firstName} ${user.lastName}?`)) {
      this.userService.deleteUser(user.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.users = this.users.filter(u => u.id !== user.id);
            if (this.selectedUser?.id === user.id) {
              this.selectedUser = null;
            }
            this.notificationService.showSuccess('User deleted successfully');
          },
          error: (err: Error) => {
            console.error('Error deleting user:', err);
            this.notificationService.showError('Failed to delete user');
          }
        });
    }
  }

  getRoleNames(user: User): string {
    return user.roles?.join(', ') || 'No roles assigned';
  }

  refreshUsers(): void {
    this.loadUsers();
  }
} 