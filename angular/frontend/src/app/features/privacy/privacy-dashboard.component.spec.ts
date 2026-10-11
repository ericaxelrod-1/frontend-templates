import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PrivacyDashboardComponent } from './privacy-dashboard.component';
import { TestingModule } from '../../tests/test-utils';
import { PrivacyService } from './privacy.service';
import { of } from 'rxjs';

describe('PrivacyDashboardComponent', () => {
  let component: PrivacyDashboardComponent;
  let fixture: ComponentFixture<PrivacyDashboardComponent>;
  let privacyService: PrivacyService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrivacyDashboardComponent, TestingModule],
      providers: [
        {
          provide: PrivacyService,
          useValue: {
            getExportPreview: () => of({}),
            getPreferences: () => of({}),
            updatePreferences: () => of({}),
            getTickets: () => of([])
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PrivacyDashboardComponent);
    component = fixture.componentInstance;
    privacyService = TestBed.inject(PrivacyService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
