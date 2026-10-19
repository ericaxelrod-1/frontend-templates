import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

/**
 * Parses and executes third-party HTML snippets in a vendor-agnostic way.
 *
 * ## The ordering decision: Awaiting load events
 *
 * External tracking scripts (e.g. GA's gtag.js) define global variables and
 * functions upon which subsequent inline scripts rely. Browsers load dynamic
 * external scripts asynchronously by default; executing an inline script
 * immediately after injecting an external <script src> causes race conditions
 * where vendor globals are undefined at the moment the inline configuration runs.
 *
 * We resolve this by **awaiting the external script's `load` event** (and error
 * event) before executing any subsequent script element in document order. This
 * enforces strict sequential dependencies across both external and inline boundaries.
 *
 * ## DOMParser vs RegExp
 *
 * HTML snippets are parsed via `DOMParser.parseFromString(snippet, 'text/html')`
 * rather than regular expressions. HTML-compliant DOM parsing correctly handles
 * comments containing `</script>` or script elements containing strings with
 * `</script>`, preventing parser truncation or injection failures.
 */
@Injectable({ providedIn: 'root' })
export class SnippetInjector {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly doc = inject(DOCUMENT);

  /**
   * Injects and executes all <script> elements found in `snippet` in document order.
   * Client-only: returns immediately during SSR to avoid unguarded document access.
   */
  async inject(snippet: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !snippet.trim()) {
      return;
    }

    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(snippet, 'text/html');
    const scripts = Array.from(parsedDoc.querySelectorAll('script'));

    for (const original of scripts) {
      await this.executeScript(original);
    }
  }

  private executeScript(original: HTMLScriptElement): Promise<void> {
    return new Promise<void>((resolve) => {
      const script = this.doc.createElement('script');

      // Copy attributes exactly as provided (type, crossorigin, async, etc.)
      for (let i = 0; i < original.attributes.length; i++) {
        const attr = original.attributes[i];
        if (attr) {
          script.setAttribute(attr.name, attr.value);
        }
      }

      if (original.src) {
        script.onload = () => resolve();
        script.onerror = () => {
          // Resolve on error so a failed network request does not block downstream tags
          resolve();
        };
        this.doc.head.appendChild(script);
      } else {
        const body = original.textContent ?? '';
        script.textContent = body;
        this.doc.head.appendChild(script);
        if (body.trim()) {
          try {
            const globalEval = (
              this.doc.defaultView as unknown as {
                readonly eval: (code: string) => unknown;
              }
            ).eval;
            globalEval(body);
          } catch {
            // Vendor runtime errors do not halt remaining snippet execution
          }
        }
        resolve();
      }
    });
  }
}
