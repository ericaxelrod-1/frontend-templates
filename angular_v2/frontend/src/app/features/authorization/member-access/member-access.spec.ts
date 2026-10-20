import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MemberAccess } from './member-access';

/**
 * The effective-access panel, asserted on what it says.
 *
 * The property that matters is that the two axes are shown SEPARATELY, and that
 * an axis which could not be read says so rather than reading as an empty one.
 */
describe('MemberAccess', () => {
  let fixture: ComponentFixture<MemberAccess>;

  async function render(
    scope: { readonly groups: readonly string[]; readonly reachable: readonly string[] } | null,
    capabilities: readonly string[] | null,
  ): Promise<void> {
    await TestBed.configureTestingModule({ imports: [MemberAccess] }).compileComponents();
    fixture = TestBed.createComponent(MemberAccess);
    fixture.componentRef.setInput('memberLabel', 'alice');
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('shows the two axes as two columns, and states the join above them', async () => {
    await render({ groups: ['EU'], reachable: ['EU', 'FR'] }, ['project:read']);

    expect(text()).toContain('Scope — which rows');
    expect(text()).toContain('Capability — which objects');
    expect(text()).toContain('the JOIN of the two columns below');
    expect(text()).toContain('a role grants capability and never scope');
  });

  it('names the groups a person is in and the groups whose rows they may read', async () => {
    await render({ groups: ['EU'], reachable: ['EU', 'FR'] }, ['project:read']);

    expect(text()).toContain('Groups they are in');
    expect(text()).toContain('Groups whose rows they may read');
    expect(text()).toContain('FR');
  });

  /**
   * An axis that could not be READ is not an axis with nothing in it. "not
   * readable for this role" is a claim about the request; "none" would be a claim
   * about the person.
   */
  it('says an unreadable axis is unreadable, and never that it is empty', async () => {
    await render(null, null);

    expect(text()).toContain('not readable for this role');
    expect(text()).not.toContain('none');
  });

  it('says an axis with nothing in it is empty', async () => {
    await render({ groups: [], reachable: [] }, []);

    expect(text()).toContain('none');
    expect(text()).not.toContain('not readable for this role');
  });
});
