import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RbacFeatureComponent } from './rbac-feature.component';
import { TestingModule } from '../../../tests/test-utils';

describe('RbacFeatureComponent', () => {
  let component: RbacFeatureComponent;
  let fixture: ComponentFixture<RbacFeatureComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RbacFeatureComponent, TestingModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RbacFeatureComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
