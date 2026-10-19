import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SnippetInjector } from './snippet-injector.service';

describe('SnippetInjector', () => {
  let injector: SnippetInjector;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SnippetInjector,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    injector = TestBed.inject(SnippetInjector);
    doc = TestBed.inject(DOCUMENT);
  });

  afterEach(() => {
    // Clean up injected test scripts from head
    const scripts = doc.head.querySelectorAll('script[data-test]');
    scripts.forEach((s) => s.remove());
    delete (window as unknown as Record<string, unknown>)['__inline_ran'];
    delete (window as unknown as Record<string, unknown>)['__comment_test'];
    delete (window as unknown as Record<string, unknown>)['__execution_order'];
  });

  it('parses a real GA-shaped snippet and produces external script and inline body in order, with inline waiting for external', async () => {
    const events: string[] = [];
    const win = (doc.defaultView ?? window) as unknown as Record<string, unknown>;
    win['__execution_order'] = events;
    (window as unknown as Record<string, unknown>)['__execution_order'] = events;
    (globalThis as unknown as Record<string, unknown>)['__execution_order'] = events;

    const realGaSnippet = `
      <script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST" data-test="ga-external"></script>
      <script data-test="ga-inline">
        var target = window.__execution_order || (typeof globalThis !== 'undefined' ? globalThis.__execution_order : null);
        if (target) {
          target.push('inline-body-executed');
        }
      </script>
    `;

    // Intercept document.head.appendChild to observe the sequencing
    const originalAppendChild = doc.head.appendChild.bind(doc.head);
    let capturedExternal: HTMLScriptElement | undefined;
    let inlineRanBeforeLoad = false;

    vi.spyOn(doc.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement && node.src.includes('googletagmanager')) {
        capturedExternal = node;
        events.push('external-script-injected');
        return node;
      }
      if (node instanceof HTMLScriptElement && node.getAttribute('data-test') === 'ga-inline') {
        if (!events.includes('external-script-loaded')) {
          inlineRanBeforeLoad = true;
        }
        return originalAppendChild(node);
      }
      return originalAppendChild(node);
    });

    const injectPromise = injector.inject(realGaSnippet);

    // Give microtasks a turn: external script should be appended, but inline should NOT have run yet
    await Promise.resolve();
    expect(events).toEqual(['external-script-injected']);
    expect(capturedExternal).toBeDefined();
    expect(inlineRanBeforeLoad).toBe(false);

    // Simulate external script completing load
    events.push('external-script-loaded');
    if (capturedExternal?.onload) {
      capturedExternal.onload(new Event('load'));
    }

    // Wait for injector promise to resolve
    await injectPromise;

    expect(inlineRanBeforeLoad).toBe(false);
    expect(events).toEqual([
      'external-script-injected',
      'external-script-loaded',
      'inline-body-executed',
    ]);
  });

  it('does not break when a snippet contains a comment containing </script> inside a string', async () => {
    const trickySnippet = `
      <!-- A comment containing "</script>" inside a string -->
      <script data-test="tricky">
        /* comment containing "<\\/script>" inside a string */
        const safeString = "<\\/script>";
        window.__comment_test = "parsed-correctly";
      </script>
    `;

    await injector.inject(trickySnippet);

    expect((window as unknown as Record<string, unknown>)['__comment_test']).toBe('parsed-correctly');
  });

  it('is a no-op during SSR to avoid accessing DOM on the server', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SnippetInjector,
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    const serverInjector = TestBed.inject(SnippetInjector);

    const appendSpy = vi.spyOn(doc.head, 'appendChild');
    await serverInjector.inject('<script src="https://example.com/test.js"></script>');

    expect(appendSpy).not.toHaveBeenCalled();
  });
});
