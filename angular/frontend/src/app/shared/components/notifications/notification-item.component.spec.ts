import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificationItemComponent } from './notification-item.component';
import { TestingModule } from '../../../tests/test-utils';
import { NotificationCenterService } from '../../../core/services/notification-center.service';
import { NotificationType } from '../../../models/notification.model';

describe('NotificationItemComponent', () => {
  let component: NotificationItemComponent;
  let fixture: ComponentFixture<NotificationItemComponent>;
  let notificationService: jasmine.SpyObj<NotificationCenterService>;

  const mockNotification = {
    id: 1,
    title: 'Test Title',
    message: 'Test Message',
    type: NotificationType.INFO,
    isRead: false,
    createdAt: new Date(),
    link: '/test'
  };

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('NotificationCenterService', ['markAsRead', 'deleteNotification']);

    await TestBed.configureTestingModule({
      imports: [NotificationItemComponent, TestingModule],
      providers: [
        { provide: NotificationCenterService, useValue: spy }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NotificationItemComponent);
    component = fixture.componentInstance;
    component.notification = mockNotification as any;
    notificationService = TestBed.inject(NotificationCenterService) as jasmine.SpyObj<NotificationCenterService>;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display notification details', () => {
    const title = fixture.nativeElement.querySelector('.notification-title');
    const message = fixture.nativeElement.querySelector('.notification-message');
    expect(title.textContent).toContain('Test Title');
    expect(message.textContent).toContain('Test Message');
  });
});
