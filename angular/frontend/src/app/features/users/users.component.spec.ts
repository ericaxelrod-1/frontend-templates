import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsersComponent } from './users.component';
import { TestingModule, mockUser, setupTestConfiguration } from '../../tests/test-utils';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { UserService } from '../../services/user.service';
import { of } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { Group } from '../../models/group.model';

describe('UsersComponent', () => {
  let component: UsersComponent;
  let fixture: ComponentFixture<UsersComponent>;
  let authService: AuthService;
  let permissionService: PermissionService;
  let userService: jasmine.SpyObj<UserService>;

  const mockGroup: Group = {
    id: 1,
    name: 'Test Group',
    description: 'Test Group Description',
    owner: 'test@example.com',
    members: [],
    permissions: []
  };

  beforeEach(async () => {
    const userServiceSpy = jasmine.createSpyObj('UserService', ['getUsers', 'deleteUser', 'addUserToGroup', 'removeUserFromGroup']);
    userServiceSpy.getUsers.and.returnValue(of([mockUser]));
    userServiceSpy.deleteUser.and.returnValue(of(void 0));
    userServiceSpy.addUserToGroup.and.returnValue(of(void 0));
    userServiceSpy.removeUserFromGroup.and.returnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [
        TestingModule,
        UsersComponent,
        MatTableModule,
        MatPaginatorModule,
        MatSortModule
      ],
      providers: [
        { provide: UserService, useValue: userServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UsersComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService);
    permissionService = TestBed.inject(PermissionService);
    userService = TestBed.inject(UserService) as jasmine.SpyObj<UserService>;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load users on init', () => {
    expect(userService.getUsers).toHaveBeenCalled();
    expect(component.users.length).toBe(1);
    expect(component.users[0]).toEqual(mockUser);
  });

  it('should check user management permissions', () => {
    expect(component.canEditUsers()).toBeDefined();
  });

  it('should handle user deletion', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    component.deleteUser(mockUser);
    expect(userService.deleteUser).toHaveBeenCalledWith(mockUser.id);
  });

  it('should not delete user if confirmation is cancelled', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    component.deleteUser(mockUser);
    expect(userService.deleteUser).not.toHaveBeenCalled();
  });

  it('should handle adding user to group', () => {
    component.addToGroup(mockUser, mockGroup);
    expect(userService.addUserToGroup).toHaveBeenCalledWith(mockUser.id, mockGroup.id);
  });

  it('should handle removing user from group', () => {
    component.removeFromGroup(mockUser, mockGroup);
    expect(userService.removeUserFromGroup).toHaveBeenCalledWith(mockUser.id, mockGroup.id);
  });

  it('should filter available groups for user', () => {
    const mockGroups: Group[] = [
      {
        id: 1,
        name: 'Group 1',
        description: 'Group 1 Description',
        owner: 'test@example.com',
        members: [],
        permissions: []
      },
      {
        id: 2,
        name: 'Group 2',
        description: 'Group 2 Description',
        owner: 'test@example.com',
        members: [],
        permissions: []
      }
    ];
    const userWithGroups = {
      ...mockUser,
      groups: [mockGroups[0]]
    };
    component.availableGroups = mockGroups;
    const availableGroups = component.getAvailableGroupsForUser(userWithGroups);
    expect(availableGroups.length).toBe(1);
    expect(availableGroups[0]).toEqual(mockGroups[1]);
  });
});
