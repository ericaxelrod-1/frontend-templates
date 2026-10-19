import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  ErrorHandler,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, forkJoin, tap, type Observable } from 'rxjs';
import { Session } from '../auth/session.service';
import { ConsentApi } from './consent-api.service';
import type {
  ConsentDecision,
  ConsentPageGroup,
  ConsentPurpose,
  ConsentRecord,
  ConsentTag,
  ConsentTagGroup,
  EffectiveConsentMap,
} from './consent.types';
import { SnippetInjector } from './snippet-injector.service';

const ANON_STORAGE_KEY = 'angular_v2.consent.anon.v1';
const USER_STORAGE_KEY = 'angular_v2.consent.user.v1';

/** What the visitor is told when the stored decisions cannot be read. */
const STORAGE_READ_FAILURE =
  'Your saved privacy choices could not be read from this browser, so you will be asked again.';

/** What the visitor is told when a decision cannot be written down. */
const STORAGE_WRITE_FAILURE =
  'Your privacy choice could not be saved in this browser, so it will not be remembered on this device.';

/**
 * Matches a URL path against a glob pattern.
 *
 * Supports exact paths (`/pricing`), wildcards (`/*`, `*`, `/**`),
 * and directory prefixes (`/admin/*`).
 */
export function matchPathGlob(glob: string, path: string): boolean {
  if (glob === '*' || glob === '/*' || glob === '/**') {
    return true;
  }
  const normPath = path === '/' ? '/' : path.replace(/\/+$/, '');
  const normGlob = glob === '/' ? '/' : glob.replace(/\/+$/, '');
  if (normGlob === normPath) {
    return true;
  }
  const pattern = normGlob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`).test(normPath);
}

/**
 * The single authority for tag injection and consent gating.
 *
 * All third-party tags must route through this service. Direct creation of
 * `<script>` tags for tracking vendors or calls to vendor globals elsewhere
 * in the application is prohibited by ESLint.
 *
 * ## The Purpose Check: A strict subset test
 *
 * A tag is injected only if EVERY ONE of its required purposes is granted.
 * - Necessary purposes (`requires_consent = false`) are granted implicitly.
 * - Consent-required purposes (`requires_consent = true`) require an explicit
 *   affirmative decision in the granted set.
 * If even one required purpose is ungranted, the tag does not load.
 *
 * ## Storage and Identity Transitions
 *
 * - Anonymous decisions are kept in `localStorage` under `ANON_STORAGE_KEY`.
 * - Signed-in decisions are retrieved from the server (`consent_records`).
 *   Server records override browser state.
 * - On sign-in: if the server holds no records for this user, the browser's
 *   anonymous decision is synced to the server. Otherwise server wins.
 * - On sign-out: nothing is written to the server; effective state cleanly
 *   reverts to the browser's anonymous decisions so private user choices
 *   are not left behind on a shared terminal.
 * - Passive reads or page renders NEVER write to storage or the server.
 */
@Injectable({ providedIn: 'root' })
export class ConsentGate {
  private readonly injector = inject(SnippetInjector);
  private readonly api = inject(ConsentApi);
  private readonly session = inject(Session);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router, { optional: true });
  private readonly errorHandler = inject(ErrorHandler);

  /** Catalogue of processing purposes. */
  readonly purposes = signal<readonly ConsentPurpose[]>([]);
  /** Configured page groups. */
  readonly pageGroups = signal<readonly ConsentPageGroup[]>([]);
  /** Configured tracking tags. */
  readonly tags = signal<readonly ConsentTag[]>([]);
  /** Mapping between tags and page groups. */
  readonly tagGroups = signal<readonly ConsentTagGroup[]>([]);

  /** Effective decisions mapped by purpose key. */
  readonly decisions = signal<EffectiveConsentMap>(new Map());

  /**
   * The last failed write, or `null` when the last one succeeded.
   *
   * A decision that was not recorded is not a decision, so the failure has to
   * reach the person who made it. The write used to fail silently — the API
   * service turned the error into `null` and the gate discarded it — so the UI
   * reported a choice as saved when no row existed (AGENTS.md §2.3).
   */
  readonly writeFailure = signal<string | null>(null);

  /**
   * The last failure to load the consent catalogue, or `null` when the last
   * load succeeded.
   *
   * A catalogue that cannot be fetched is a MISCONFIGURATION OF THE DEPLOYMENT,
   * not of the visitor: the gate then has no purposes, no groups and no tags,
   * so no tag can ever load, and the application behaves exactly as it would
   * with a correctly configured and correctly consented tag — which is
   * indistinguishable from "this deployment has no analytics", the one state
   * an operator needs to distinguish (AGENTS.md §2.3).
   *
   * The `admin_notifications` panel cannot carry this failure. The consent
   * config materialiser reads the catalogue from the DATABASE, and a browser
   * that cannot reach it is invisible to it — the server can read the same
   * rows while every visitor's fetch fails. See `reportConfigurationFailure`.
   */
  readonly configFailure = signal<string | null>(null);

  /**
   * The last failure to read or write the browser's copy of the decisions, or
   * `null`.
   *
   * A stored decision that cannot be read is not "no decision": it is a
   * decision the application failed to honour, and the person who made it has
   * to be told, because the alternative is to ask again as if nothing had been
   * decided.
   */
  readonly storageFailure = signal<string | null>(null);

  /** Current active route path. */
  readonly currentPath = signal<string>('/');

  /** Track already injected tag keys to prevent duplicate execution across navigations. */
  private readonly injectedTags = new Set<string>();

  /** Purposes requiring consent, ordered for display. */
  readonly consentRequiredPurposes = computed(() =>
    this.purposes().filter((p) => p.requires_consent),
  );

  /**
   * Purposes that require a user decision because:
   * 1. The user has never made a decision for them, or
   * 2. The catalogue's `policy_version` is newer than the version in the recorded decision.
   */
  readonly repromptPurposes = computed<readonly ConsentPurpose[]>(() => {
    const required = this.consentRequiredPurposes();
    const currentDecisions = this.decisions();

    return required.filter((p) => {
      const decision = currentDecisions.get(p.key);
      if (!decision) {
        return true;
      }
      return p.policy_version > decision.policyVersion;
    });
  });

  /** Whether the visitor needs to be re-prompted for any purpose. */
  readonly needsReprompt = computed(() => this.repromptPurposes().length > 0);

  private configLoaded = false;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.init();
    }
  }

  private init(): void {
    // 1. Initial read of stored anonymous decisions (passive read: does NOT write)
    this.restoreStoredDecisions();

    // 2. Re-evaluate on router navigations
    this.router?.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const navEvent = event;
        const path = navEvent.urlAfterRedirects || navEvent.url;
        this.currentPath.set(path);
        void this.evaluate(path);
      });

    // 3. Evaluate the page the visitor LANDED on — see `evaluateLandingRoute`.
    this.evaluateLandingRoute();
  }

  /**
   * Evaluates the route the visitor landed on, without waiting for a navigation.
   *
   * ## THE REGRESSION THIS EXISTS FOR
   *
   * `ConsentGate` is `providedIn: 'root'`, so it is constructed on FIRST
   * INJECTION — which happens while a component renders. When that render
   * happens after the router has already emitted `NavigationEnd` for the route
   * that brought the visitor here, the subscription in `init()` only ever sees
   * FUTURE navigations, and the landing page — the page view analytics exists
   * to record — is never evaluated. The tag appears only after the visitor
   * clicks something.
   *
   * ## WHY `Router.navigated` IS THE CONDITION
   *
   * `Router.navigated` is true once a navigation has COMPLETED, and the
   * router sets it when it emits `NavigationEnd`. While it is false the
   * initial navigation is still pending: `router.url` is not yet the page the
   * visitor is on, and evaluating it would attribute a tag to a path the
   * visitor is about to leave. In that case the pending navigation's
   * `NavigationEnd` arrives through the subscription in `init()` and the page
   * is evaluated there.
   *
   * ## THE SERVER DOES NOT RUN THIS
   *
   * `init()` is called from the constructor behind `isPlatformBrowser`, so the
   * SSR server constructs this service, evaluates no route, fetches no
   * catalogue and touches no browser global.
   */
  private evaluateLandingRoute(): void {
    const router = this.router;
    if (!router?.navigated) {
      return;
    }
    const path = router.url;
    this.currentPath.set(path);
    void this.evaluate(path);
  }

  /**
   * Ensures catalogue configuration is populated before evaluation.
   *
   * ## THE FAILURE IS NOT SWALLOWED
   *
   * This used to end in `catch { }` — a comment calling it a "graceful
   * fallback" — which resolved as if the catalogue had loaded. The gate then
   * had no purposes, no groups and no tags, so NO TAG COULD EVER LOAD, and
   * nothing said so. The deployment looked exactly like a deployment with no
   * analytics, which is the one state an operator needs to distinguish
   * (AGENTS.md §2.3).
   *
   * The error now propagates to the caller, which is `evaluate()`: it records
   * the failure in `configFailure`, reports it through the framework's error
   * channel, and continues with an empty catalogue — which injects nothing,
   * because a gate with no catalogue must inject nothing.
   */
  async ensureConfiguration(): Promise<void> {
    if (this.configLoaded || this.purposes().length > 0) {
      return;
    }
    await firstValueFrom(this.loadConfiguration());
    this.configLoaded = true;
    this.configFailure.set(null);
    this.handleAuthStateChange();
  }

  /**
   * Records a catalogue that could not be fetched, and reports it.
   *
   * ## WHY THIS IS NOT AN `admin_notifications` ROW
   *
   * The repository has exactly one mechanism for telling an operator that a
   * deployment is misconfigured: `0027`'s `admin_notifications`, fed by the
   * materialisers in `backend/src/notifications/`. The consent config
   * materialiser is the one for this concern, and it CANNOT know about this
   * failure: it reads `consent_tags` from the DATABASE through `pg`, and a
   * catalogue that a BROWSER cannot fetch is invisible to it. The server can
   * read every row while every visitor's fetch fails — an ad blocker, a
   * proxy, a CORS failure, an offline device. The browser also has no write
   * path into `admin_notifications`: `0027` grants `SELECT` to `app_member`
   * and `INSERT` only to `app_admin`, so an anonymous visitor cannot publish
   * anything, and a second write path would be the duplicate mechanism
   * §2.4 forbids.
   *
   * So the honest alternative is used: the failure is reported through the
   * framework's error channel — the one channel an operator's browser
   * console and the application's own error reporting can both see — and
   * `configFailure` holds a sentence a UI can show.
   */
  private reportConfigurationFailure(error: unknown): void {
    this.configFailure.set(
      'The consent configuration could not be loaded, so no tracking tag can run on this page.',
    );
    this.reportFailure('the consent catalogue could not be loaded', error);
  }

  /**
   * Records a stored decision that could not be read or written, and reports it.
   */
  private reportStorageFailure(message: string, error: unknown): void {
    this.storageFailure.set(message);
    this.reportFailure('the stored consent decisions could not be read or written', error);
  }

  /**
   * Reports a failure the application cannot recover from on its own.
   *
   * ## WHY THE ERROR HANDLER AND NOT A LOGGER
   *
   * The brief for this unit asks for "a `Logger` line at `error` level", and
   * `@angular/core` 22 — the version this repository builds against — exports
   * no `Logger` at all. What it does export is `ErrorHandler`, the framework's
   * own error channel: `provideBrowserGlobalErrorListeners()` routes uncaught
   * errors to it, and a fork that installs its own `ErrorHandler` receives
   * these too. `no-console` is an error in this project (`eslint.config.js`),
   * so the error channel is the only place a line an operator can read may
   * come from.
   */
  private reportFailure(context: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.errorHandler.handleError(new Error(`${context}: ${detail}`));
  }

  /**
   * Loads the consent catalogue, page groups, tags, and joins.
   */
  loadConfiguration(): Observable<{
    purposes: readonly ConsentPurpose[];
    pageGroups: readonly ConsentPageGroup[];
    tags: readonly ConsentTag[];
    tagGroups: readonly ConsentTagGroup[];
  }> {
    return forkJoin({
      purposes: this.api.purposes(),
      pageGroups: this.api.pageGroups(),
      tags: this.api.tags(),
      tagGroups: this.api.tagGroups(),
    }).pipe(
      tap((res) => {
        this.purposes.set(res.purposes);
        this.pageGroups.set(res.pageGroups);
        this.tags.set(res.tags);
        this.tagGroups.set(res.tagGroups);
      }),
    );
  }

  /**
   * Sets manual configuration for unit testing without live network calls.
   */
  setMockConfig(config: {
    purposes?: readonly ConsentPurpose[];
    pageGroups?: readonly ConsentPageGroup[];
    tags?: readonly ConsentTag[];
    tagGroups?: readonly ConsentTagGroup[];
  }): void {
    this.configLoaded = true;
    if (config.purposes) this.purposes.set(config.purposes);
    if (config.pageGroups) this.pageGroups.set(config.pageGroups);
    if (config.tags) this.tags.set(config.tags);
    if (config.tagGroups) this.tagGroups.set(config.tagGroups);
  }

  /**
   * Evaluates the current page and injects tags that match and pass purpose checks.
   *
   * ## THIS NEVER THROWS
   *
   * Every caller of this method calls it fire-and-forget — the constructor
   * cannot await it, the router subscription cannot await it, and `setDecision`
   * must not fail because a tag did not load. A rejection here would become an
   * unhandled rejection, which is a silent failure of a different kind: the
   * page stops being evaluated and nothing says so.
   *
   * So the two things that can go wrong are handled here rather than
   * propagated: a catalogue that cannot be fetched is reported and the
   * evaluation stops (there is nothing to evaluate against), and a failure
   * while evaluating is reported and the remaining tags are still considered.
   */
  async evaluate(path?: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await this.ensureConfiguration();
    } catch (error) {
      // A misconfiguration of the DEPLOYMENT: no catalogue, no groups, no
      // tags, and therefore nothing injected. The failure is reported rather
      // than swallowed — see `reportConfigurationFailure`.
      this.reportConfigurationFailure(error);
      return;
    }

    try {
      await this.evaluatePage(path);
    } catch (error) {
      this.reportFailure('the consent gate could not evaluate this page', error);
    }
  }

  /**
   * The evaluation itself.
   *
   * 1. Path and auth check.
   * 2. Selects groups matching path and authenticated_only criteria.
   * 3. Collects candidate tags for matching groups.
   * 4. Applies subset test: tag loads only if every purpose is granted.
   * 5. Injects passing tags.
   */
  private async evaluatePage(path?: string): Promise<void> {
    const currentPath = path ?? this.currentPath();
    const isAuthenticated = this.session.isAuthenticated();
    const allGroups = this.pageGroups();
    const allTags = this.tags();
    const allTagGroups = this.tagGroups();

    // 1. Select matching groups
    const matchingGroups = allGroups.filter((group) => {
      // A group with authenticated_only does NOT match an unauthenticated visitor
      if (group.authenticated_only && !isAuthenticated) {
        return false;
      }
      const globs = Array.isArray(group.path_globs)
        ? (group.path_globs as readonly string[])
        : [];
      return globs.some((g) => matchPathGlob(g, currentPath));
    });

    // A page with no matching group injects nothing (safe default)
    if (matchingGroups.length === 0) {
      return;
    }

    const matchingGroupIds = new Set(matchingGroups.map((g) => g.id));

    // 2. Collect candidate tags associated with any matching group
    const candidateTagIds = new Set(
      allTagGroups
        .filter((tg) => matchingGroupIds.has(tg.group_id))
        .map((tg) => tg.tag_id),
    );

    const candidateTags = allTags.filter(
      (tag) => tag.enabled && candidateTagIds.has(tag.id),
    );

    // 3. Check purposes: SUBSET test
    const purposesMap = new Map(this.purposes().map((p) => [p.key, p]));
    const currentDecisions = this.decisions();

    for (const tag of candidateTags) {
      if (this.injectedTags.has(tag.key)) {
        continue;
      }

      const requiredPurposes = Array.isArray(tag.purposes)
        ? (tag.purposes as readonly string[])
        : [];

      const allGranted = requiredPurposes.every((purposeKey) => {
        const purpose = purposesMap.get(purposeKey);
        // Necessary purposes (requires_consent = false) are granted implicitly
        if (purpose && !purpose.requires_consent) {
          return true;
        }
        const decision = currentDecisions.get(purposeKey);
        return decision !== undefined && decision.granted === true;
      });

      if (allGranted && tag.snippet) {
        this.injectedTags.add(tag.key);
        await this.injector.inject(tag.snippet);
      }
    }
  }

  /**
   * Explicitly records a decision for one purpose.
   *
   * Only explicit user actions write to storage or the server.
   */
  setDecision(
    purposeKey: string,
    granted: boolean,
    mechanism = 'consent_control',
  ): void {
    const purpose = this.purposes().find((p) => p.key === purposeKey);
    const policyVersion = purpose?.policy_version ?? 1;
    const now = new Date().toISOString();

    const decision: ConsentDecision = {
      purposeKey,
      granted,
      policyVersion,
      mechanism,
      recordedAt: now,
    };

    const nextMap = new Map(this.decisions());
    nextMap.set(purposeKey, decision);
    this.decisions.set(nextMap);

    if (this.session.isAuthenticated()) {
      // Signed in: save to server and update local cache
      this.recordOnServer(purposeKey, granted, mechanism);
      this.writeToStorage(USER_STORAGE_KEY, nextMap);
    } else {
      // Anonymous: save to browser storage
      this.writeToStorage(ANON_STORAGE_KEY, nextMap);
    }

    // Re-evaluate page tags with the newly granted/withdrawn decision
    void this.evaluate();
  }

  /**
   * Records one decision on the server, and keeps the outcome visible.
   *
   * One place, so the failure is handled the same way wherever the write was
   * issued from — the control, the profile form, or the sign-in sync — and so
   * there is no path left that subscribes to the write and forgets the error.
   */
  private recordOnServer(purposeKey: string, granted: boolean, mechanism: string): void {
    this.api
      .recordConsentDecision(purposeKey, granted, mechanism)
      .subscribe({
        next: () => this.writeFailure.set(null),
        error: () =>
          this.writeFailure.set(
            'Your choice was not recorded. Please try again — nothing has been saved.',
          ),
      });
  }

  /**
   * Sets explicit decisions for multiple purposes at once.
   */
  setDecisions(
    decisionsList: ReadonlyArray<{ purposeKey: string; granted: boolean }>,
    mechanism = 'consent_control',
  ): void {
    for (const item of decisionsList) {
      this.setDecision(item.purposeKey, item.granted, mechanism);
    }
  }

  /**
   * Synchronises decisions on sign-in or sign-out.
   */
  private handleAuthStateChange(): void {
    const isAuthenticated = this.session.isAuthenticated();
    const userId = this.session.userId();

    if (isAuthenticated && userId) {
      // Signed in: server record wins.
      this.api.effectiveConsent(userId).subscribe((records) => {
        if (records.length === 0) {
          // Server has no records: migrate browser's anonymous decision to server
          const anonDecisions = this.readFromStorage(ANON_STORAGE_KEY);
          if (anonDecisions.size > 0) {
            anonDecisions.forEach((decision) => {
              this.recordOnServer(decision.purposeKey, decision.granted, decision.mechanism);
            });
            this.decisions.set(anonDecisions);
            this.writeToStorage(USER_STORAGE_KEY, anonDecisions);
          }
        } else {
          // Server records exist: derive effective consent from server records
          const serverMap = this.recordsToDecisionMap(records);
          this.decisions.set(serverMap);
          this.writeToStorage(USER_STORAGE_KEY, serverMap);
        }
        void this.evaluate();
      });
    } else {
      // Signed out: fall back to browser's anonymous decisions. Do NOT write to server.
      const anonMap = this.readFromStorage(ANON_STORAGE_KEY);
      this.decisions.set(anonMap);
      void this.evaluate();
    }
  }

  /**
   * Explicitly triggered when user signs out, ensuring no personal state remains on a shared browser.
   */
  onSignOut(): void {
    // Revert decisions to anonymous storage without writing to server
    const anonMap = this.readFromStorage(ANON_STORAGE_KEY);
    this.decisions.set(anonMap);
    // Clear user cached copy
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
    void this.evaluate();
  }

  /**
   * Explicitly triggered when user signs in.
   */
  onSignIn(userId: string): void {
    this.api.effectiveConsent(userId).subscribe((records) => {
      if (records.length === 0) {
        // Server has no records: write browser anonymous decision to server
        const anonDecisions = this.readFromStorage(ANON_STORAGE_KEY);
        if (anonDecisions.size > 0) {
          anonDecisions.forEach((decision) => {
            this.recordOnServer(decision.purposeKey, decision.granted, decision.mechanism);
          });
          this.decisions.set(anonDecisions);
          this.writeToStorage(USER_STORAGE_KEY, anonDecisions);
        }
      } else {
        const serverMap = this.recordsToDecisionMap(records);
        this.decisions.set(serverMap);
        this.writeToStorage(USER_STORAGE_KEY, serverMap);
      }
      void this.evaluate();
    });
  }

  /**
   * Passive initial restore: reads localStorage without writing anything.
   */
  private restoreStoredDecisions(): void {
    const key = this.session.isAuthenticated() ? USER_STORAGE_KEY : ANON_STORAGE_KEY;
    const restored = this.readFromStorage(key);
    this.decisions.set(restored);
  }

  private recordsToDecisionMap(records: readonly ConsentRecord[]): EffectiveConsentMap {
    // Distinct on purpose_key, keeping first (newest)
    const map = new Map<string, ConsentDecision>();
    for (const rec of records) {
      if (!map.has(rec.purpose_key)) {
        map.set(rec.purpose_key, {
          purposeKey: rec.purpose_key,
          granted: rec.granted,
          policyVersion: rec.policy_version,
          mechanism: rec.mechanism,
          recordedAt: rec.recorded_at,
        });
      }
    }
    return map;
  }

  /**
   * Reads the decisions stored under one key.
   *
   * ## A FAILED READ IS NOT "NO DECISIONS"
   *
   * A read that throws — corrupt JSON, storage disabled by the browser, a
   * quota error — used to be answered with an empty map, which is
   * indistinguishable from "this visitor never decided anything". The
   * consequence is that a recorded consent is DISCARDED: the gate asks again,
   * and the tags the person had agreed to stop running. The empty map is also
   * the SAFE direction — no readable decision means no consent-required tag
   * loads — so the fix is not to fail open, it is to stop degrading
   * SILENTLY.
   *
   * The failure is reported (`storageFailure`, and the framework's error
   * channel), and the stored value is left untouched: overwriting it would
   * destroy the only copy of the decision.
   */
  private readFromStorage(key: string): Map<string, ConsentDecision> {
    if (!isPlatformBrowser(this.platformId)) {
      return new Map();
    }

    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch (error) {
      this.reportStorageFailure(STORAGE_READ_FAILURE, error);
      return new Map();
    }
    if (!raw) {
      return new Map();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.reportStorageFailure(STORAGE_READ_FAILURE, error);
      return new Map();
    }
    if (!Array.isArray(parsed)) {
      this.reportStorageFailure(
        STORAGE_READ_FAILURE,
        new Error('the stored value is not a list of decisions'),
      );
      return new Map();
    }

    // The stored value is written by a previous version of this application and
    // read back from a store the visitor can edit, so it is untrusted input: an
    // entry that is not a decision is dropped and reported, not cast into one.
    const entries: readonly unknown[] = parsed;
    const decisions = new Map<string, ConsentDecision>();
    let malformed = 0;
    for (const entry of entries) {
      if (isStoredDecision(entry)) {
        decisions.set(entry.purposeKey, entry);
      } else {
        malformed += 1;
      }
    }
    if (malformed > 0) {
      this.reportStorageFailure(
        STORAGE_READ_FAILURE,
        new Error(`${String(malformed)} stored decision(s) are not readable`),
      );
    }
    return decisions;
  }

  /**
   * Writes the decisions under one key.
   *
   * A decision that was not stored is not a decision — the same argument the
   * server write makes in `recordOnServer`. For an anonymous visitor this
   * browser copy IS the record, so a failure has to reach them rather than
   * disappear into an empty `catch`.
   */
  private writeToStorage(key: string, map: EffectiveConsentMap): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const list = Array.from(map.values());
      localStorage.setItem(key, JSON.stringify(list));
    } catch (error) {
      this.reportStorageFailure(STORAGE_WRITE_FAILURE, error);
    }
  }
}

/**
 * Narrows one entry of the stored decision list.
 *
 * The value under the storage key is untrusted input — it was written by a
 * previous version of this application and it lives in a store the visitor
 * can edit — so it is narrowed rather than cast.
 */
function isStoredDecision(value: unknown): value is ConsentDecision {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ConsentDecision>;
  return (
    typeof candidate.purposeKey === 'string' &&
    typeof candidate.granted === 'boolean' &&
    typeof candidate.policyVersion === 'number' &&
    typeof candidate.mechanism === 'string' &&
    typeof candidate.recordedAt === 'string'
  );
}
