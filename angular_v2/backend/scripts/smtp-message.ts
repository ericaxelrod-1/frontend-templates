/**
 * Reading what the local SMTP sink received.
 *
 * The sink captures the `DATA` payload verbatim, so anything that wants the link
 * out of it has to read real MIME: both parts are quoted-printable encoded, so
 * `?token=` arrives as `?token=3D…` and a naive `toContain` on the raw bytes
 * would be asserting against an encoding artefact rather than against the link.
 *
 * Two consumers, one implementation: `scripts/dev.mjs` uses it to print a
 * human-readable copy of what arrived, and the suites use it to assert on the
 * same bytes. A reader that each of them grew its own copy of is how the two
 * would disagree about what a message said.
 *
 * This is a reader, not a mock: it decodes what arrived. An encoding it does not
 * implement makes it **throw** rather than return a plausible-looking string,
 * because a test that silently reads the wrong bytes is the false green
 * `AGENTS.md` §2.2 is about.
 */

export type SmtpMessagePart = {
  readonly contentType: string;
  readonly body: string;
};

export type ParsedSmtpMessage = {
  readonly headers: Readonly<Record<string, string>>;
  readonly parts: readonly SmtpMessagePart[];
  /** The first `text/plain` part, or `''` when the message carries none. */
  readonly text: string;
  /** The first `text/html` part, or `''` when the message carries none. */
  readonly html: string;
};

/** RFC 2045 §6.7 quoted-printable, including the `=` soft line break. */
export function decodeQuotedPrintable(input: string): string {
  const joined = input.replace(/=\r\n/g, '').replace(/=\n/g, '');
  const bytes: number[] = [];
  let literal = '';
  const flush = (): void => {
    if (literal !== '') {
      bytes.push(...Buffer.from(literal, 'utf8'));
      literal = '';
    }
  };
  for (let index = 0; index < joined.length; index += 1) {
    const character = joined[index];
    if (character !== '=') {
      literal += character;
      continue;
    }
    const hex = joined.slice(index + 1, index + 3);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
      literal += '=';
      continue;
    }
    flush();
    bytes.push(Number.parseInt(hex, 16));
    index += 2;
  }
  flush();
  return Buffer.from(bytes).toString('utf8');
}

function decodeBody(body: string, encoding: string): string {
  switch (encoding) {
    case '':
    case '7bit':
    case '8bit':
    case 'binary':
      return body;
    case 'quoted-printable':
      return decodeQuotedPrintable(body);
    default:
      throw new Error(
        `the sink received a '${encoding}' body and this reader only decodes 7bit/8bit/quoted-printable. ` +
          'Decoding nothing here would make the assertion read the encoded bytes, not the message.',
      );
  }
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let name: string | undefined;
  for (const line of block.split('\r\n')) {
    if (line === '') {
      continue;
    }
    // RFC 5322 §2.2.3 folding: a line beginning with space or tab continues the
    // previous header. Nodemailer folds `Content-Type` at the semicolon, so
    // without this the multipart boundary is never found.
    if (name !== undefined && /^[ \t]/.test(line)) {
      headers[name] = `${headers[name] ?? ''} ${line.trim()}`;
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      name = undefined;
      continue;
    }
    name = line.slice(0, separator).trim().toLowerCase();
    headers[name] = line.slice(separator + 1).trim();
  }
  return headers;
}

function splitBody(raw: string): { readonly headerBlock: string; readonly body: string } {
  const separator = raw.indexOf('\r\n\r\n');
  if (separator === -1) {
    // Not multipart and not even header/body separated: return it whole so the
    // caller's content assertions still see the bytes.
    return { headerBlock: '', body: raw };
  }
  return { headerBlock: raw.slice(0, separator), body: raw.slice(separator + 4) };
}

/** Nodemailer's own `Date`, `Message-Id` and boundaries are irrelevant here. */
export function parseSmtpMessage(raw: string): ParsedSmtpMessage {
  const { headerBlock, body } = splitBody(raw);
  const headers = parseHeaders(headerBlock);
  // Nodemailer writes its boundary parameter with the leading `--` already
  // attached (`boundary="----_NmP-…"`) and then uses it verbatim as the
  // delimiter, which is one dash-pair more than RFC 2046 describes. Stripping
  // the pair before prefixing it again makes this reader right for both
  // conventions instead of only for the one nodemailer happens to emit.
  const declaredBoundary = /boundary="?([^";\r\n]+)"?/i.exec(headers['content-type'] ?? '')?.[1];
  const boundary = declaredBoundary?.replace(/^--/, '');
  if (boundary === undefined) {
    // A single-part message — which is what a caller that sets only `text`
    // produces. Returning it with an empty `text` would make every assertion
    // about a text-only message read as an empty one.
    const only = {
      contentType: headers['content-type'] ?? 'text/plain',
      body: decodeBody(body, headers['content-transfer-encoding'] ?? ''),
    };
    return {
      headers,
      parts: [only],
      text: only.contentType.startsWith('text/plain') ? only.body : '',
      html: only.contentType.startsWith('text/html') ? only.body : '',
    };
  }

  const delimiter = `--${boundary}`;
  const chunks = body.split(delimiter).slice(1, -1);
  const parts: SmtpMessagePart[] = chunks.map((chunk) => {
    const separator = chunk.indexOf('\r\n\r\n');
    const partHeaders = parseHeaders(separator === -1 ? chunk : chunk.slice(0, separator));
    const partBody = (separator === -1 ? '' : chunk.slice(separator + 4)).replace(/\r\n$/, '');
    return {
      contentType: partHeaders['content-type'] ?? 'text/plain',
      body: decodeBody(partBody, partHeaders['content-transfer-encoding'] ?? ''),
    };
  });

  return {
    headers,
    parts,
    text: parts.find((part) => part.contentType.startsWith('text/plain'))?.body ?? '',
    html: parts.find((part) => part.contentType.startsWith('text/html'))?.body ?? '',
  };
}

/**
 * Handlebars escapes `=` to `&#x3D;` alongside the five HTML-significant
 * characters, so the encoded body is decoded before a URL is compared. That is
 * correct HTML — a browser decodes it back to the same address — so the
 * assertion is about the link, not about its encoding.
 */
export function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x60;/g, '`')
    .replace(/&#x3[dD];/g, '=')
    .replace(/&amp;/g, '&');
}