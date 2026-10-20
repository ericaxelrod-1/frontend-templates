import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { LegalPage } from './legal-page';

describe('LegalPage', () => {
  let fixture: ComponentFixture<LegalPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LegalPage],
    }).compileComponents();

    fixture = TestBed.createComponent(LegalPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders the mandatory replacement notice plainly stating the document must be replaced', () => {
    const root = fixture.nativeElement as HTMLElement;
    const notice = root.querySelector('.legal-notice');

    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('Legal Placeholder');
    expect(notice?.textContent).toContain('must be replaced');
    expect(notice?.textContent).toContain('before this site goes live in production');
  });

  it('explains why a boilerplate policy cannot represent the operator legal position', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('cannot represent your organization');
    expect(root.textContent).toContain('statutory obligations');
  });

  it('outlines specific requirements for privacy policy and terms of service', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Privacy Policy Requirements');
    expect(root.textContent).toContain('Terms of Service Requirements');
    expect(root.textContent).toContain('Data Controller Identification');
  });
});
