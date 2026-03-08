import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecurityFeatureComponent } from './security-feature.component';

describe('SecurityFeatureComponent', () => {
  let component: SecurityFeatureComponent;
  let fixture: ComponentFixture<SecurityFeatureComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecurityFeatureComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecurityFeatureComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
