import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { EmailTemplateError } from './email.template-error.js';
import type {
  EmailTemplateContextFor,
  EmailTemplateName,
} from './email.template-context.js';

/**
 * Templates live beside the module that reads them, so `import.meta.url`
 * resolves them in both runtimes: `src/email/templates/` under vitest and
 * `nest start`, `dist/email/templates/` in a built process. That second path is
 * the whole reason `nest-cli.json` needs an `assets` entry — see ADR-0024 and
 * `test/unit/email/email-assets.spec.ts`, which builds the project and renders
 * from the built copy.
 */
export const EMAIL_TEMPLATES_DIRECTORY = new URL('./templates/', import.meta.url);

/**
 * Handlebars compilation with auto-escaping left ON — `{{var}}` escapes and
 * `{{{var}}}` does not, and no shipped template uses the triple form. There is
 * no interpolation loop and no `RegExp` built from a context key, which is the
 * whole of the previous renderer (unescaped host interpolation, and an escape
 * set that covered `<`, `>` and `"` while omitting `&`).
 *
 * Compiled per call rather than cached: two transactional mails an hour do not
 * justify a cache, and an uncached compile means editing a template in
 * development takes effect on the next send rather than at the next restart.
 */
export class EmailRenderer {
  constructor(
    private readonly templatesDirectory: URL = EMAIL_TEMPLATES_DIRECTORY,
  ) {}

  render<K extends EmailTemplateName>(
    template: K,
    context: EmailTemplateContextFor<K>,
  ): string {
    const path = fileURLToPath(new URL(`${template}.html`, this.templatesDirectory));
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      throw new EmailTemplateError(template, describe(error), { cause: error });
    }
    let compiled: Handlebars.TemplateDelegate<EmailTemplateContextFor<K>>;
    try {
      compiled = Handlebars.compile<EmailTemplateContextFor<K>>(source);
    } catch (error) {
      throw new EmailTemplateError(
        template,
        `handlebars rejected it: ${describe(error)}`,
        { cause: error },
      );
    }
    try {
      return compiled(context);
    } catch (error) {
      throw new EmailTemplateError(
        template,
        `handlebars threw while rendering: ${describe(error)}`,
        { cause: error },
      );
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === undefined ? error.message : `${code}: ${error.message}`;
  }
  return String(error);
}