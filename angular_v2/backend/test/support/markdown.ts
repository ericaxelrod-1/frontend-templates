import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS_ROOT, REPOSITORY_ROOT, relativeToRepository } from './paths.js';

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export type MarkdownLink = {
  readonly file: string;
  readonly line: number;
  readonly target: string;
};

export function isExternalTarget(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
}

export function targetPath(target: string): string {
  const withoutFragment = target.split('#', 1)[0] ?? '';
  const withoutQuery = withoutFragment.split('?', 1)[0] ?? '';
  return withoutQuery === '' ? '' : decodeURIComponent(withoutQuery);
}

export function extractLinks(source: string, file: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const target = match[1];
      if (target === undefined) {
        continue;
      }
      links.push({ file, line: index + 1, target });
    }
  });
  return links;
}

export function scannedMarkdownFiles(): string[] {
  const docs = readdirSync(DOCS_ROOT)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => join(DOCS_ROOT, entry));
  return [join(REPOSITORY_ROOT, 'AGENTS.md'), ...docs];
}

export function describeLink(link: MarkdownLink): string {
  return `${relativeToRepository(link.file)}:${link.line} -> ${link.target}`;
}
