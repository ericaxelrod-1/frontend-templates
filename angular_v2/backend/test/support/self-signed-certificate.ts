import { generate } from 'selfsigned';
import type { SmtpSinkTls } from '../../scripts/smtp-sink.js';

/**
 * A self-signed certificate for the local SMTP sink, generated at run time.
 *
 * The sink is a loopback listener, so its key material is not a secret worth
 * storing, rotating or committing — it is generated per process. Generating it
 * rather than committing a PEM is what keeps `backend/.env*` (§2.5: only
 * `*.example` files are committed) free of anything that looks like a key.
 *
 * The SAN carries the IP literal, not only the common name, so the certificate
 * is a *correct* certificate for `127.0.0.1` and the client has to opt out of
 * verification deliberately. That is the honest shape of the thing
 * `EMAIL_TLS_REJECT_UNAUTHORIZED=false` exists for.
 *
 * `keySize: 2048` rather than something smaller: OpenSSL 3 will refuse a
 * handshake with a key below its default security level, and a sink that cannot
 * complete TLS tests nothing. The validity window is stated rather than left to
 * a default, and is a day long because this certificate is a test fixture.
 */
let cached: SmtpSinkTls | undefined;

export async function selfSignedSmtpSinkTls(): Promise<SmtpSinkTls> {
  cached ??= await build();
  return cached;
}

async function build(): Promise<SmtpSinkTls> {
  const notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const generated = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    notBeforeDate: new Date(Date.now() - 60 * 1000),
    notAfterDate: notAfter,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' },
        ],
      },
    ],
  });
  return { key: generated.private, cert: generated.cert };
}