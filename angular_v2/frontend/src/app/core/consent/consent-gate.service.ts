import { isPlatformBrowser } from '@angular/common';
import {
  computed,
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
  }

  /** Ensures catalogue configuration is populated before evaluation. */
  async ensureConfiguration(): Promise<void> {
    if (this.configLoaded || this.purposes().length > 0) {
      return;
    }
    try {
      await firstValueFrom(this.loadConfiguration());
      this.configLoaded = true;
      this.handleAuthStateChange();
    } catch {
      // Graceful fallback
    }
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
   * 1. Path and auth check.
   * 2. Selects groups matching path and authenticated_only criteria.
   * 3. Collects candidate tags for matching groups.
   * 4. Applies subset test: tag loads only if every purpose is granted.
   * 5. Injects passing tags.
   */
  async evaluate(path?: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    await this.ensureConfiguration();

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

  private readFromStorage(key: string): Map<string, ConsentDecision> {
    if (!isPlatformBrowser(this.platformId)) {
      return new Map();
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return new Map();
      const list = JSON.parse(raw) as ConsentDecision[];
      if (!Array.isArray(list)) return new Map();
      return new Map(list.map((d) => [d.purposeKey, d]));
    } catch {
      return new Map();
    }
  }

  private writeToStorage(key: string, map: EffectiveConsentMap): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const list = Array.from(map.values());
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // Storage errors (e.g. quota exceeded) ignored safely
    }
  }
}
