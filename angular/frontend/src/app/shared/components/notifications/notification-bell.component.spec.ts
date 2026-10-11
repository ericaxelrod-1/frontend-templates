import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificationBellComponent } from './notification-bell.component';
import { TestingModule } from '../../../tests/test-utils';
import { NotificationCenterService } from '../../../core/services/notification-center.service';
import { of } from 'rxjs';

describe('NotificationBellComponent', () => {
  let component: NotificationBellComponent;
  let fixture: ComponentFixture<NotificationBellComponent>;
  let notificationService: jasmine.SpyObj<NotificationCenterService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('NotificationCenterService', ['getUnreadCount', 'fetchNotifications'], {
      unreadCount$: of(5)
    });
    spy.getUnreadCount.and.returnValue(of(5));
    spy.fetchNotifications.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [NotificationBellComponent, TestingModule],
      providers: [
        { provide: NotificationCenterService, useValue: spy }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NotificationBellComponent);
    component = fixture.componentInstance;
    notificationService = TestBed.inject(NotificationCenterService) as jasmine.SpyObj<NotificationCenterService>;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display unread count badge', (done) => {
    component.unreadCount$.subscribe(count => {
      expect(count).toBe(5);
      done();
    });
  });
});
