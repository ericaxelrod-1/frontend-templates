import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificationDropdownComponent } from './notification-dropdown.component';
import { TestingModule } from '../../../tests/test-utils';
import { NotificationCenterService } from '../../../core/services/notification-center.service';
import { of } from 'rxjs';

describe('NotificationDropdownComponent', () => {
  let component: NotificationDropdownComponent;
  let fixture: ComponentFixture<NotificationDropdownComponent>;
  let notificationService: jasmine.SpyObj<NotificationCenterService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('NotificationCenterService', ['getNotifications', 'markAllAsRead', 'fetchNotifications'], {
      notifications$: of([]),
      unreadCount$: of(0)
    });
    spy.getNotifications.and.returnValue(of([]));
    spy.fetchNotifications.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [NotificationDropdownComponent, TestingModule],
      providers: [
        { provide: NotificationCenterService, useValue: spy }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NotificationDropdownComponent);
    component = fixture.componentInstance;
    notificationService = TestBed.inject(NotificationCenterService) as jasmine.SpyObj<NotificationCenterService>;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show empty message when no notifications', () => {
    const emptyMsg = fixture.nativeElement.querySelector('.empty-state p');
    expect(emptyMsg.textContent).toContain('You have no notifications');
  });
});
