import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('creates the shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeInstanceOf(App);
  });

  it('renders the shell markup', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('header.shell-header')).not.toBeNull();
    expect(element.querySelector('h1.shell-title')?.textContent).toBe('angular_v2');
    expect(element.querySelector('main.shell-main router-outlet')).not.toBeNull();
  });
});
