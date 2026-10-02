import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeLink, extractLinks, isExternalTarget, scannedMarkdownFiles, targetPath } from '../../support/markdown.js';
import { REPOSITORY_ROOT, relativeToRepository } from '../../support/paths.js';

const scannedFiles = scannedMarkdownFiles();
const allLinks = scannedFiles.flatMap((file) => extractLinks(readFileSync(file, 'utf8'), file));

function resolvedPath(link: (typeof allLinks)[number]): string | undefined {
  const path = targetPath(link.target);
  if (path === '') {
    return undefined;
  }
  return isAbsolute(path) ? path : resolve(dirname(link.file), path);
}

const relativeLinks = allLinks.filter((link) => !isExternalTarget(link.target) && targetPath(link.target) !== '');

describe('markdown links in docs/ and AGENTS.md', () => {
  it('scans AGENTS.md and every markdown file in docs/', () => {
    expect(scannedFiles.length).toBeGreaterThan(1);
    expect(scannedFiles.map(relativeToRepository)).toContain('AGENTS.md');
    expect(scannedFiles.every((file) => file.endsWith('.md'))).toBe(true);
  });

  it('finds relative links, so the checks below are not vacuous', () => {
    expect(relativeLinks.length).toBeGreaterThan(0);
  });

  it('resolves every relative link to an existing path', () => {
    const broken = relativeLinks
      .map((link) => ({ link, resolved: resolvedPath(link) }))
      .filter((entry) => entry.resolved === undefined || !existsSync(entry.resolved))
      .map((entry) => describeLink(entry.link));

    expect(broken).toEqual([]);
  });

  it('keeps every relative link inside angular_v2/', () => {
    const escaping = relativeLinks
      .map((link) => ({ link, resolved: resolvedPath(link) }))
      .filter((entry) => entry.resolved !== undefined)
      .filter((entry) => {
        const inside = relative(REPOSITORY_ROOT, entry.resolved ?? '');
        return inside === '..' || inside.startsWith(`..${sep}`);
      })
      .map((entry) => describeLink(entry.link));

    expect(escaping).toEqual([]);
  });

  it('recognises external and pure-anchor targets as out of scope', () => {
    expect(isExternalTarget('https://example.test/a')).toBe(true);
    expect(isExternalTarget('mailto:someone@example.test')).toBe(true);
    expect(isExternalTarget('#adr-0004')).toBe(true);
    expect(isExternalTarget('./adr.md')).toBe(false);
  });
});
