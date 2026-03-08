import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RbacFeatureComponent } from './rbac-feature.component';

describe('RbacFeatureComponent', () => {
  let component: RbacFeatureComponent;
  let fixture: ComponentFixture<RbacFeatureComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RbacFeatureComponent]
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
