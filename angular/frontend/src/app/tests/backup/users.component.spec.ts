import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsersComponent } from './users.component';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { setupHttpTesting } from '../../tests/test-utils';
import { UserService } from '../../services/user.service';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { PermissionService } from '../../core/services/permission.service';
import { NotificationService } from '../../core/services/notification.service';
import { CommonModule } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBarModule } from '@angular/material/snack-bar';

describe('UsersComponent', () => {
  let component: UsersComponent;
  let fixture: ComponentFixture<UsersComponent>;
  let httpMock: HttpTestingController;
  let permissionService: jasmine.SpyObj<PermissionService>;

  beforeEach(async () => {
    // Create spies for services
    permissionService = jasmine.createSpyObj('PermissionService', {
      'loadUserPermissions': of(['user:read', 'user:update']),
      'hasPermission': of(true),
      'hasAnyPermission': of(true),
      'hasAllPermissions': of(true),
      'refreshPermissions': of(['user:read', 'user:update'])
    });

    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        HttpClientTestingModule,
        BrowserAnimationsModule,
        MatSnackBarModule,
        UsersComponent
      ],
      providers: [
        UserService,
        { provide: PermissionService, useValue: permissionService },
        { provide: NotificationService, useClass: NotificationService },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ id: '123' }),
            snapshot: {
              paramMap: {
                get: () => '123'
              }
            }
          }
        }
      ]
    }).compileComponents();

    httpMock = setupHttpTesting();
    fixture = TestBed.createComponent(UsersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify(); // Verifies that no requests are outstanding
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more test cases here
}); 