import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Store, NgxsModule } from '@ngxs/store';
import { SystemHealthComponent } from './system-health.component';
import { SystemHealthState } from '../../../store/system-health/system-health.state';
import { SystemHealth } from '../../../core/services/system-health.service';
import { TestingModule } from '../../../tests/test-utils';

const HEALTH: SystemHealth = {
  status: 'Critical',
  disk: { total: 1000, used: 960, free: 40, percentage: 96 },
  memory: { total: 800, used: 400, free: 400, percentage: 50 },
  process: { rss: 120, heapTotal: 90, heapUsed: 60 },
  activeJobs: 7,
  pendingTickets: 3,
  lastCheck: '2026-10-12T00:00:00.000Z',
  lastError: null,
  guardDisabled: false,
  thresholds: { warningPercent: 90, criticalPercent: 95, panicPercent: 98 },
};

describe('SystemHealthComponent', () => {
  let fixture: ComponentFixture<SystemHealthComponent>;
  let httpMock: HttpTestingController;
  let store: Store;

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SystemHealthComponent,
        NgxsModule.forRoot([SystemHealthState]),
        TestingModule,
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(Store);
    fixture = TestBed.createComponent(SystemHealthComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches the snapshot on init rather than holding stale component state', () => {
    const request = httpMock.expectOne('/api/admin/system-health');

    expect(request.request.method).toBe('GET');
    request.flush(HEALTH);
  });

  it('renders the measured disk figures, not zeros', fakeAsync(() => {
    httpMock.expectOne('/api/admin/system-health').flush(HEALTH);
    tick();
    fixture.detectChanges();

    expect(text()).toContain('960 Bytes');
    expect(text()).toContain('1000 Bytes');
    expect(text()).toContain('96%');
  }));

  it('renders the real job count', fakeAsync(() => {
    httpMock.expectOne('/api/admin/system-health').flush(HEALTH);
    tick();
    fixture.detectChanges();

    expect(text()).toContain('7');
    expect(text()).toContain('3 open tickets');
  }));

  it('shows the maintenance toolkit and the real purge result', fakeAsync(() => {
    httpMock.expectOne('/api/admin/system-health').flush(HEALTH);
    tick();
    fixture.detectChanges();

    component().clearTempFiles();
    const request = httpMock.expectOne('/api/admin/system-health/clear-temp');
    expect(request.request.method).toBe('POST');
    request.flush({
      message: 'Cleanup complete',
      scannedFiles: 5,
      removedFiles: 2,
      freedBytes: 4096,
      errors: [],
    });
    tick();
    fixture.detectChanges();

    expect(text()).toContain('Removed 2 of 5 expired export files');
  }));

  it('surfaces a failed health check instead of showing a healthy system', fakeAsync(() => {
    httpMock
      .expectOne('/api/admin/system-health')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    tick();
    fixture.detectChanges();

    expect(text()).toContain('Health check failed');
  }));

  it('warns when DISABLE_SENTINEL_GUARD is set, because an open gate must be visible', fakeAsync(() => {
    httpMock
      .expectOne('/api/admin/system-health')
      .flush({ ...HEALTH, guardDisabled: true });
    tick();
    fixture.detectChanges();

    expect(text()).toContain('DISABLE_SENTINEL_GUARD');
  }));

  it('does not claim to be Healthy when the measurement failed', fakeAsync(() => {
    httpMock.expectOne('/api/admin/system-health').flush({
      ...HEALTH,
      status: 'Unknown',
      lastError: 'Disk check failed: EIO',
    });
    tick();
    fixture.detectChanges();

    expect(text()).toContain('Unknown');
    expect(text()).toContain('EIO');
  }));

  it('stops polling once destroyed', fakeAsync(() => {
    httpMock.expectOne('/api/admin/system-health').flush(HEALTH);
    tick();
    fixture.destroy();
    tick(30000);

    httpMock.expectNone('/api/admin/system-health');
  }));

  function component(): SystemHealthComponent {
    return fixture.componentInstance;
  }
});