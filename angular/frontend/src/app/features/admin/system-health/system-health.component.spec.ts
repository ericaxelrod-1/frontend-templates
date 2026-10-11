import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SystemHealthComponent } from './system-health.component';
import { TestingModule } from '../../../tests/test-utils';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';

describe('SystemHealthComponent', () => {
  let component: SystemHealthComponent;
  let fixture: ComponentFixture<SystemHealthComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemHealthComponent, TestingModule],
      providers: [
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ status: 'Healthy', disk: {}, memory: {}, activeJobs: 0, lastCheck: new Date().toISOString() }),
            post: () => of({})
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SystemHealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
