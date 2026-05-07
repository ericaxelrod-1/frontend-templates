import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoggingFeatureComponent } from './logging-feature.component';
import { TestingModule } from '../../../tests/test-utils';

describe('LoggingFeatureComponent', () => {
  let component: LoggingFeatureComponent;
  let fixture: ComponentFixture<LoggingFeatureComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoggingFeatureComponent, TestingModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoggingFeatureComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
