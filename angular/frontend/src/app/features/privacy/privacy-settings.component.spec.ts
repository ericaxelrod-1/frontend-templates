import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PrivacySettingsComponent } from './privacy-settings.component';
import { TestingModule } from '../../tests/test-utils';
import { PrivacyService } from './privacy.service';
import { of } from 'rxjs';

describe('PrivacySettingsComponent', () => {
  let component: PrivacySettingsComponent;
  let fixture: ComponentFixture<PrivacySettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrivacySettingsComponent, TestingModule],
      providers: [
        {
          provide: PrivacyService,
          useValue: {
            getPreferences: () => of({}),
            updatePreferences: () => of({})
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PrivacySettingsComponent);
    component = fixture.componentInstance;
    
    // Mock selector properties BEFORE detectChanges triggers ngOnInit
    component.preferences$ = of({ 
      marketingConsent: false, 
      doNotSell: false,
      privacyRestrictions: {},
      processingObjections: {}
    } as any);
    component.loading$ = of(false);
    
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
