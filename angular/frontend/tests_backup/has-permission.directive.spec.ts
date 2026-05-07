import { Component, TemplateRef, ViewContainerRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { PermissionService } from '../../core/services/permission.service';
import { HasPermissionDirective } from './has-permission.directive';

// Test component that uses the directive
@Component({
  template: `
    <div *hasPermission="'users:read'">Content for users:read</div>
    <div *hasPermission="'users:write'">Content for users:write</div>
    <div *hasPermission="'roles:read'; else noAccess">Content for roles:read</div>
    <ng-template #noAccess>No access template content</ng-template>
  `
})
class TestComponent {}

describe('HasPermissionDirective', () => {
  let fixture: ComponentFixture<TestComponent>;
  let permissionService: jasmine.SpyObj<PermissionService>;
  let permissionsLoaded: Subject<boolean>;

  beforeEach(() => {
    permissionsLoaded = new Subject<boolean>();
    permissionService = jasmine.createSpyObj<PermissionService>(
      'PermissionService', 
      ['hasPermission', 'hasAnyPermission']
    );
    
    // Mock the permissionsLoaded$ observable
    Object.defineProperty(permissionService, 'permissionsLoaded$', {
      get: () => permissionsLoaded.asObservable()
    });

    TestBed.configureTestingModule({
      declarations: [
        TestComponent,
        HasPermissionDirective
      ],
      providers: [
        { provide: PermissionService, useValue: permissionService }
      ]
    });

    // Default behavior for permission methods
    permissionService.hasPermission.and.returnValue(of(false));
    permissionService.hasAnyPermission.and.returnValue(of(false));
  });

  it('should create an instance', () => {
    const directive = new HasPermissionDirective(
      TestBed.inject(TemplateRef),
      TestBed.inject(ViewContainerRef),
      permissionService
    );
    expect(directive).toBeTruthy();
  });

  it('should show content when permission is granted', () => {
    // Arrange - set up the first permission to be granted
    permissionService.hasPermission.and.callFake((permission) => {
      if (permission === 'users:read') {
        return of(true);
      }
      return of(false);
    });

    // Act
    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    // Assert
    const elements = fixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(1);
    expect(elements[0].nativeElement.textContent).toBe('Content for users:read');
  });

  it('should handle object format permissions', () => {
    // Arrange - set up the second permission to be granted
    permissionService.hasPermission.and.callFake((permission) => {
      if (permission === 'users:write') {
        return of(true);
      }
      return of(false);
    });

    // Act
    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    // Assert
    const elements = fixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(1);
    expect(elements[0].nativeElement.textContent).toBe('Content for users:write');
  });

  it('should render else template when permission is denied', () => {
    // Arrange - all permissions denied
    permissionService.hasPermission.and.returnValue(of(false));

    // Act
    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    // Assert
    const content = fixture.nativeElement.textContent;
    expect(content).toContain('No access template content');
    expect(content).not.toContain('Content for roles:read');
  });

  it('should update view when permissions are refreshed', () => {
    // Arrange - initially all permissions denied
    permissionService.hasPermission.and.returnValue(of(false));
    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    // Initial assert - no content visible
    let elements = fixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No access template content');

    // Act - change permission and trigger permissions loaded
    permissionService.hasPermission.and.callFake((permission) => {
      if (permission === 'roles:read') {
        return of(true);
      }
      return of(false);
    });
    permissionsLoaded.next(true);
    fixture.detectChanges();

    // Assert - content now visible
    elements = fixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(1);
    expect(elements[0].nativeElement.textContent).toBe('Content for roles:read');
    expect(fixture.nativeElement.textContent).not.toContain('No access template content');
  });

  it('should handle array of permissions', () => {
    // Create a component with array of permissions
    @Component({
      template: `<div *hasPermission="['users:read', 'posts:read']">Content</div>`
    })
    class ArrayPermissionComponent {}

    TestBed.configureTestingModule({
      declarations: [ArrayPermissionComponent, HasPermissionDirective],
      providers: [{ provide: PermissionService, useValue: permissionService }]
    });

    // Set up the hasAnyPermission method to return true
    permissionService.hasAnyPermission.and.returnValue(of(true));
    
    const arrayFixture = TestBed.createComponent(ArrayPermissionComponent);
    arrayFixture.detectChanges();

    // Should show content when any permission is granted
    const elements = arrayFixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(1);
    expect(elements[0].nativeElement.textContent).toBe('Content');
    expect(permissionService.hasAnyPermission).toHaveBeenCalledWith(['users:read', 'posts:read']);
  });

  it('should handle empty permission value gracefully', () => {
    // Create a component with empty permission
    @Component({
      template: `<div *hasPermission="">Content</div>`
    })
    class EmptyPermissionComponent {}

    TestBed.configureTestingModule({
      declarations: [EmptyPermissionComponent, HasPermissionDirective],
      providers: [{ provide: PermissionService, useValue: permissionService }]
    });

    const emptyFixture = TestBed.createComponent(EmptyPermissionComponent);
    emptyFixture.detectChanges();

    // Should not show content when permission is empty
    const elements = emptyFixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(0);
  });
}); 