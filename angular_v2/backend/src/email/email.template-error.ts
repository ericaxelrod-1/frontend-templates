/**
 * A template that could not be read, compiled, or rendered.
 *
 * This is the type the previous tree did not have. Its renderer caught every
 * failure and returned `<p>Email template error: …</p>`, which the provider
 * then reported as a **successful** send: every built message in the old tree
 * shipped that string, and nothing anywhere said so. A template that is missing
 * from `dist/` is a build-configuration defect, and it has to be able to stop a
 * request rather than mail the user a paragraph about it.
 */
export class EmailTemplateError extends Error {
  readonly template: string;

  constructor(template: string, detail: string, options?: { cause?: unknown }) {
    super(
      `Email template '${template}' could not be rendered: ${detail}. ` +
        `If this is 'ENOENT', check the "assets" entry in backend/nest-cli.json — ` +
        `without it the .html files never reach dist/ and every built message is broken.`,
      options,
    );
    this.name = 'EmailTemplateError';
    this.template = template;
  }
}