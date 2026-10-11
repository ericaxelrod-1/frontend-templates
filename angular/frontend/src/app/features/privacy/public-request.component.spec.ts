import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicPrivacyComponent } from './public-request.component';
import { TestingModule } from '../../tests/test-utils';
import { PrivacyService } from './privacy.service';
import { of } from 'rxjs';

describe('PublicPrivacyComponent', () => {
  let component: PublicPrivacyComponent;
  let fixture: ComponentFixture<PublicPrivacyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicPrivacyComponent, TestingModule],
      providers: [
        {
          provide: PrivacyService,
          useValue: {
            createPublicTicket: () => of({ success: true })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PublicPrivacyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
