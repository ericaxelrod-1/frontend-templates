import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TELEMETRY_ALERT_THRESHOLD,
  DEFAULT_TELEMETRY_FLUSH_SECONDS,
  DEFAULT_TELEMETRY_WINDOW_SECONDS,
  TelemetryEnvironmentError,
  loadTelemetryEnvironment,
} from '../../../src/security/telemetry-environment.js';

/**
 * The `SECURITY_TELEMETRY_*` namespace, read once and asserted at boot.
 *
 * **The cases that matter are the ones where a number means something different
 * from what it looks like.** A threshold of zero would raise an alert for every
 * matching request; an inverted pair of bands would make a host's status
 * arbitrary; a malformed value would degrade into a number nobody chose. §2.3 is
 * the rule these are here for.
 */
describe('the security-telemetry configuration', () => {
  it('has a default for every key, because none of them decides whose data ends', () => {
    const environment = loadTelemetryEnvironment({});
    expect(environment.windowSeconds).toBe(DEFAULT_TELEMETRY_WINDOW_SECONDS);
    expect(environment.alertThreshold).toBe(DEFAULT_TELEMETRY_ALERT_THRESHOLD);
    expect(environment.flushSeconds).toBe(DEFAULT_TELEMETRY_FLUSH_SECONDS);
  });

  it('refuses a malformed value at boot, naming the key and the value', () => {
    expect(() => loadTelemetryEnvironment({ SECURITY_TELEMETRY_ALERT_THRESHOLD: 'ten' })).toThrow(
      TelemetryEnvironmentError,
    );
    expect(() => loadTelemetryEnvironment({ SECURITY_TELEMETRY_WINDOW_SECONDS: '1h' })).toThrow(
      TelemetryEnvironmentError,
    );
  });

  it('refuses a threshold of zero, which would raise an alert for every match', () => {
    expect(() => loadTelemetryEnvironment({ SECURITY_TELEMETRY_ALERT_THRESHOLD: '0' })).toThrow(
      TelemetryEnvironmentError,
    );
  });

  it('refuses an inverted pair of score bands, which would make a status arbitrary', () => {
    expect(() =>
      loadTelemetryEnvironment({
        SECURITY_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE: '40',
        SECURITY_TELEMETRY_REPUTATION_BAD_SCORE: '80',
      }),
    ).toThrow(TelemetryEnvironmentError);
  });

  it('refuses a band above the scale, which no host could ever reach', () => {
    expect(() =>
      loadTelemetryEnvironment({
        SECURITY_TELEMETRY_REPUTATION_BASE_SCORE: '50',
        SECURITY_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE: '80',
      }),
    ).toThrow(TelemetryEnvironmentError);
  });

  it('names every problem in one error, so a boot is fixed in one pass', () => {
    try {
      loadTelemetryEnvironment({
        SECURITY_TELEMETRY_ALERT_THRESHOLD: 'ten',
        SECURITY_TELEMETRY_FLUSH_SECONDS: 'soon',
      });
      expect.unreachable('the loader should have refused the configuration');
    } catch (error) {
      expect(error).toBeInstanceOf(TelemetryEnvironmentError);
      const problems = (error as TelemetryEnvironmentError).problems;
      expect(problems.length).toBe(2);
      expect(problems.join('\n')).toContain('SECURITY_TELEMETRY_ALERT_THRESHOLD');
      expect(problems.join('\n')).toContain('SECURITY_TELEMETRY_FLUSH_SECONDS');
    }
  });
});
