import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthFeatureComponent } from './auth-feature.component';
import { TestingModule } from '../../../tests/test-utils';

describe('AuthFeatureComponent', () => {
  let component: AuthFeatureComponent;
  let fixture: ComponentFixture<AuthFeatureComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthFeatureComponent, TestingModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuthFeatureComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
