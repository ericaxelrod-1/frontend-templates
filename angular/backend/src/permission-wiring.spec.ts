import { readFileSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';
import { METHOD_METADATA } from '@nestjs/common/constants';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from './modules/permissions/guards/permission.guard';

/**
 * Backend-wide permission wiring — PREVENTION, NOT A BUG REPORT.
 *
 * Every assertion in this file passes against the tree as it stands today. That
 * is the point: this file exists so that the *next* handler to be added without
 * a requirement, or with a requirement nothing enforces, fails here rather than
 * shipping. Nothing in this file is evidence that a defect was found and fixed;
 * reading it that way is a misreading.
 *
 * It is one shared file rather than a copy per controller on purpose. A copy per
 * controller is a copy that only the next controller author remembers to write,
 * and the class of defect it guards against — a requirement that nothing
 * enforces — is invisible precisely because the route is new and nobody is
 * looking at it yet.
 *
 * ---------------------------------------------------------------------------
 * NECESSARY BUT NOT SUFFICIENT.
 *
 * This test reads decorator metadata and `__guards__` arrays. It can prove that
 * `PermissionGuard` is *referenced* next to a requirement. It cannot prove that
 * the requirement is *evaluated* as intended, and three specific shapes defeat
 * it while it stays green:
 *
 *   1. A `@RequireAllPermissions` whose list OR-merges when it should AND-merge
 *      (or the reverse) — the wiring is correct and the evaluation is wrong.
 *   2. A `PermissionGuard` imported from a different module instance, so
 *      `guards.includes(PermissionGuard)` compares two distinct class objects
 *      that are not the guard Nest actually runs.
 *   3. An `APP_GUARD` interaction — a global guard that re-enters, short-circuits
 *      or is ordered ahead of the per-route guard is invisible here.
 *
 * The per-controller HTTP specs are what prove an actual 403. They stand up the
 * real Fastify pipeline and let Nest resolve the guard chain itself, and they
 * turn red when the wiring is reverted. This file is the cheap net underneath
 * them, not a replacement.
 */

type ControllerClass = abstract new (...args: never[]) => object;

interface ControllerUnderTest {
  file: string;
  name: string;
  controller: ControllerClass;
}

/**
 * Loaded from the filesystem rather than from a hand-written import list, so a
 * controller added after this file was written is covered without anyone
 * remembering to register it here. The `every` assertion below fails if the glob
 * stops finding controllers at all, so an empty result cannot read as a pass.
 */
function loadControllers(): ControllerUnderTest[] {
  const files = globSync('**/*.controller.ts', {
    cwd: __dirname,
    ignore: ['**/*.spec.ts'],
  }).sort();

  return files.map((file) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require(join(__dirname, file)) as Record<string, unknown>;
    const exported = Object.values(module).filter(
      (value): value is ControllerClass =>
        typeof value === 'function' && /Controller$/.test(value.name),
    );

    if (exported.length !== 1) {
      throw new Error(
        `${file} must export exactly one class named *Controller; found ` +
          `${exported.length}. A controller with no exported class would be ` +
          `silently skipped by this test.`,
      );
    }

    return { file, name: exported[0].name, controller: exported[0] };
  });
}

const CONTROLLERS = loadControllers();

/**
 * Handlers that deliberately carry NO permission requirement, with the reason
 * each one is safe open.
 *
 * This is the assertion that does the most work. A handler with no requirement
 * is, to `PermissionGuard`, a handler with no requirement AND nothing to
 * enforce — it returns `true` on line 39 of permission.guard.ts before it ever
 * looks at the caller. So "no requirement" and "open to every authenticated
 * user" are the same state, and only a human decision distinguishes them.
 * Enumerating them forces that decision. Adding a route without adding it here
 * fails this test, which is the moment somebody has to answer the question.
 *
 * Every entry must be justified in its own words. A reason that could be
 * copy-pasted onto an unrelated handler is not a reason.
 *
 * Keyed `ControllerName.handlerName` so a same-named handler on two controllers
 * cannot be excused by the other.
 */
const NO_PERMISSION_REQUIREMENT: Record<string, string> = {
  // ---- no authentication at all, and deliberately so ----
  'AppController.redirect': 'a 302 to /api; carries no data',
  'AppController.healthCheck': (
    'liveness probe: process status, uptime and a timestamp only'
  ),
  'CaptchaController.generateCaptcha': (
    'a captcha has to be issuable before anyone is logged in — gating it ' +
    'would be circular. The control is the server-side challenge, not the ' +
    'route (§B6)'
  ),
  'CaptchaController.verifyCaptcha': (
    'the answer check itself, and the thing that makes issuing the ' +
    'challenge above safe'
  ),
  'PrivacyPublicController.createPublicTicket': (
    'the submission path: the ticket verification code in the body IS the ' +
    'credential under test'
  ),
  'PrivacyPublicController.getTicketStatus': 'same code-gated proof',
  'PrivacyPublicController.verifyTicket': (
    'the code check itself — gating it would be circular'
  ),

  // ---- authenticated, and the subject is forced to the caller ----
  //
  // For these the open surface is bounded by construction: the row they can
  // reach is the caller's own row, because the id is `req.user.id` and never a
  // parameter. That is a claim about the code, so each one names the scoping.
  'AuthController.login': 'the credential exchange itself',
  'AuthController.register': 'account creation precedes any grant',
  'AuthController.refresh': (
    'the caller proves identity with the very refresh token being exchanged'
  ),
  'AuthController.logout': 'revokes the caller’s own refresh token',
  'AuthController.forgotPassword': (
    'unauthenticated by necessity and rate-limited per §B6; it answers ' +
    'identically for known and unknown addresses, so it is not an oracle'
  ),
  'AuthController.verifyEmail': 'the activation link carries its own token',
  'AuthController.resetPassword': 'the reset link carries its own token',
  'AuthController.getProfile': 'reads only the authenticated req.user record',
  'AuthController.validateCsrf': 'reports the caller’s own CSRF state',
  'LoginMonitoringController.generateCaptcha': (
    'a test-harness wrapper over the public captcha issue path'
  ),
  'LoginMonitoringController.verifyCaptcha': (
    'a test-harness wrapper over the public captcha verify path'
  ),
  'UsersController.getProfile': 'reads only the authenticated req.user record',
  'PermissionsController.getUserPermissions': 'reads only req.user.id',
  'PermissionsController.checkPermission': (
    'reads only req.user.id: the caller-supplied userId was removed, so ' +
    'this is a self-check and cannot enumerate another user'
  ),
  'PermissionsController.testRouteAccess': (
    'scoped to req.user.id by canUserAccessRoute; :id names a route, not a user'
  ),
  'PermissionsController.testEndpointAccess': (
    'scoped to req.user.id by canUserAccessEndpoint; :id names an endpoint'
  ),
  'PrivacyController.getProviders': (
    'a static registry of configured processors, byte-identical for everyone'
  ),
  'PrivacyController.getPreferences': 'reads only the authenticated caller',
  'PrivacyController.getExportPreview': 'reads only the authenticated caller',
  'PrivacyController.exportData': 'produces an export of req.user’s own data',
  'PrivacyController.downloadData': (
    'downloads the export token belongs to; the token is the credential'
  ),
  'PrivacyController.deleteAccount': 'deletes only req.user’s own account',
  'PrivacyController.updateRestrictions': 'writes only req.user’s own record',
  'PrivacyController.submitObjection': 'writes only req.user’s own record',
  'PrivacyController.removeObjection': 'writes only req.user’s own record',
  'PrivacyController.updateMarketingConsent': 'writes only req.user’s own',
  'PrivacyController.updateDoNotSell': 'writes only req.user’s own',
  'PrivacyTicketController.createTicket': 'writes only req.user’s own ticket',
  'PrivacyTicketController.getTickets': 'reads only req.user’s own tickets',
  'PrivacyTicketController.getTicket': 'reads only req.user’s own ticket',
  'NotificationsController.getNotifications': (
    'self-scoped in the service: findAllForUser filters where { userId }'
  ),
  'NotificationsController.getUnreadCount': (
    'self-scoped in the service: counts where { userId }'
  ),
  'NotificationsController.markAsRead': (
    'self-scoped in the service: finds where { id, userId } and 404s otherwise'
  ),
  'NotificationsController.markAllAsRead': 'self-scoped: where { userId }',
  'NotificationsController.deleteNotification': (
    'self-scoped in the service: finds where { id, userId }; it archives'
  ),
  'NotificationsController.getPreferences': 'self-scoped in the service',
  'NotificationsController.updatePreferences': 'self-scoped in the service',

  // ---- KNOWN GAPS ----
  //
  // Below this line the "open surface is bounded by construction" argument
  // does NOT hold. These are live holes in the legacy tree. They are listed
  // because the enumeration is the deliverable — an unlisted handler fails the
  // test, a listed one is at least a recorded decision — not because they are
  // acceptable. The pinned count below makes adding or removing one a
  // deliberate edit rather than a silent drift.
  //
  // As of this pass the count is ZERO. Every KNOWN GAP below this comment has
  // been closed and removed, not reworded:
  //
  //   GroupsController (13)  all 13 handlers now carry a per-handler
  //     @RequirePermission with @UseGuards(PermissionGuard). Vocabulary taken
  //     from the rows that already exist: groups:view for the read handlers,
  //     groups:create / groups:update / groups:delete for CRUD, groups:manage
  //     for addMember, removeMember, updateSettings and setParent — the four
  //     that move a user's scope.
  //
  //   SchemaController (7)  was recorded here as UNSCOPED AND
  //     UNAUTHENTICATED. It was NOT dead code, despite a report that said so:
  //     SchemaModule is imported at app.module.ts:38 and registered at
  //     app.module.ts:101, and four frontend callers read its response shape.
  //     Kept and guarded — JwtAuthGuard + PermissionGuard + a per-handler
  //     @RequirePermission('rls_rules:manage'), an existing capability granted
  //     to exactly the administrative roles whose RLS screens call it.
  //
  //   AuthController.checkDatabaseHealth (1)  POST /auth/diag/db-check had no
  //     guard at all, on the handler or the class. Now requires the existing
  //     `system:health`.
  //
  // A note for whoever adds the next gap: SchemaController is the cautionary
  // tale. It was classified as dead code because its class name appeared in no
  // module outside its own, which is true, and which says nothing about whether
  // its module is imported. Reachability follows the module graph, so grep the
  // module, not the class.
};

/**
 * Only real routes. A controller's prototype also holds private helpers
 * (`RlsRulesController.saveConditionsFromScope` is one), which are not
 * reachable over HTTP and therefore cannot be "unguarded". Nest tags every
 * route handler with METHOD_METADATA; `RequestMethod.GET` is 0, so this uses
 * `hasMetadata` rather than a truthiness check, or every GET would vanish.
 */
const isRouteHandler = (target: object): boolean =>
  Reflect.hasMetadata(METHOD_METADATA, target);

const handlersOf = (controller: ControllerClass): string[] =>
  Object.getOwnPropertyNames(controller.prototype).filter(
    (name) => name !== 'constructor',
  );

const handlerOf = (controller: ControllerClass, name: string): object =>
  (controller.prototype as unknown as Record<string, object>)[name];

const guardsOf = (target: object): unknown[] =>
  (Reflect.getMetadata('__guards__', target) as unknown[] | undefined) ?? [];

const requirementOf = (controller: ControllerClass, name: string) =>
  Reflect.getMetadata(
    PERMISSIONS_KEY,
    handlerOf(controller, name),
  ) ??
  Reflect.getMetadata(PERMISSIONS_KEY, controller);

/** `ControllerName.handlerName` for every ROUTE of every controller. */
const allHandlers = CONTROLLERS.flatMap(({ name, controller }) =>
  handlersOf(controller)
    .filter((handler) => isRouteHandler(handlerOf(controller, handler)))
    .map((handler) => ({
      key: `${name}.${handler}`,
      name,
      handler,
      controller,
    })),
);

const requirementless = allHandlers.filter(
  ({ controller, handler }) => requirementOf(controller, handler) === undefined,
);

describe('permission wiring across the whole backend', () => {
  describe('the loader', () => {
    it('finds every controller, so an empty result cannot read as a pass', () => {
      // Without this, a bad glob path yields zero controllers and every
      // assertion below passes vacuously on an empty array.
      expect(CONTROLLERS.length).toBeGreaterThan(20);
    });

    it('covers every *.controller.ts on disk', () => {
      const onDisk = globSync('**/*.controller.ts', {
        cwd: __dirname,
        ignore: ['**/*.spec.ts'],
      });
      const loaded = CONTROLLERS.map(({ file }) => file);

      expect(loaded.sort()).toEqual(onDisk.sort());
    });

    it('finds handlers to assert on', () => {
      expect(allHandlers.length).toBeGreaterThan(100);
    });
  });

  describe('a requirement nothing enforces', () => {
    it('covers every handler carrying permission metadata with a PermissionGuard', () => {
      // The defect this whole file exists for: `@RequirePermission` writes
      // metadata, `PermissionGuard` reads it, and nothing connects the two
      // unless a guard is actually wired. A handler can carry a correct,
      // present, inert requirement and be reachable by any authenticated user.
      const unguarded = allHandlers
        .filter(
          ({ controller, handler }) =>
            requirementOf(controller, handler) !== undefined,
        )
        .filter(
          ({ controller, handler }) =>
            !guardsOf(handlerOf(controller, handler)).includes(PermissionGuard) &&
            !guardsOf(controller).includes(PermissionGuard),
        )
        .map(({ key, controller, handler }) => ({
          handler: key,
          requirement: requirementOf(controller, handler),
          handlerGuards: guardsOf(handlerOf(controller, handler)),
          classGuards: guardsOf(controller),
        }));

      expect(unguarded).toEqual([]);
    });

    it('names the handlers that carry a requirement', () => {
      // So the guard above cannot pass by finding no requirements at all.
      expect(
        allHandlers.filter(
          ({ controller, handler }) =>
            requirementOf(controller, handler) !== undefined,
        ).length,
      ).toBeGreaterThan(50);
    });
  });

  describe('double wiring', () => {
    it('wires PermissionGuard exactly once per handler that needs it', () => {
      // Once on the handler and once on the class is two executions of the
      // same check — correct today, but it doubles the permission lookups and
      // it is the shape that breaks when one of the two is later edited.
      const doubled = allHandlers
        .filter(
          ({ controller, handler }) =>
            requirementOf(controller, handler) !== undefined,
        )
        .map(({ controller, handler }) => {
          const occurrences = [
            ...guardsOf(handlerOf(controller, handler)),
            ...guardsOf(controller),
          ].filter((guard) => guard === PermissionGuard).length;

          return { handler: `${controller.name}.${handler}`, occurrences };
        })
        .filter((entry) => entry.occurrences !== 1);

      expect(doubled).toEqual([]);
    });
  });

  describe('no requirement at all', () => {
    it('gives every requirementless handler an enumerated, justified entry', () => {
      // The assertion that does the most work. "No requirement" and "open to
      // every authenticated user" are the same state to PermissionGuard, which
      // returns true before it looks at the caller. This list is the record of
      // a human having decided that, one handler at a time.
      const unjustified = requirementless
        .map(({ key }) => key)
        .filter((key) => !(key in NO_PERMISSION_REQUIREMENT))
        .sort();

      expect(unjustified).toEqual([]);
    });

    it('has no entry for a handler that now carries a requirement', () => {
      // The mirror image: a stale entry would let a handler quietly become
      // exempt from the enumeration above the moment it is given a guard.
      const stale = Object.keys(NO_PERMISSION_REQUIREMENT)
        .filter((key) => {
          const [controllerName, handlerName] = key.split('.');
          const found = allHandlers.find(
            ({ name, handler }) =>
              name === controllerName && handler === handlerName,
          );

          return (
            !found ||
            requirementOf(found.controller, found.handler) !== undefined
          );
        })
        .sort();

      expect(stale).toEqual([]);
    });

    it('gives every entry a reason, and not the empty one', () => {
      const unreasoned = Object.entries(NO_PERMISSION_REQUIREMENT)
        .filter(([, reason]) => reason.trim().length < 20)
        .map(([key]) => key)
        .sort();

      expect(unreasoned).toEqual([]);
    });

    it('records, rather than hides, the handlers that are known gaps', () => {
      // Every entry below this line is a live hole in the legacy tree. The
      // count is pinned so that fixing one is a deliberate edit to this number
      // and an explicit re-worded reason, not a silent disappearance — and so
      // that a new gap cannot be added without someone counting it.
      //
      // This is ZERO as of this pass: all 21 (13 GroupsController, 7
      // SchemaController, 1 AuthController.checkDatabaseHealth) were closed and
      // removed from the map above rather than reworded. The assertion is kept
      // rather than deleted because a count of 0 is itself the finding: the
      // next gap re-arms it.
      const marked = Object.entries(NO_PERMISSION_REQUIREMENT)
        .filter(([, reason]) => reason.includes('KNOWN GAP'))
        .map(([key]) => key);

      expect(marked).toEqual([]);
    });
  });

  describe('the deprecated spelling', () => {
    it('uses @RequirePermission everywhere and never @RequirePermissions', () => {
      // `@RequirePermissions` (plural) writes the same PERMISSIONS_KEY and is
      // marked @deprecated in require-permissions.decorator.ts. Two spellings
      // for one concept drift apart, and a grep for one of them misses the
      // other. Nothing in the backend imports the deprecated file today.
      const offenders = CONTROLLERS.filter(({ file }) =>
        readFileSync(join(__dirname, file), 'utf8').includes(
          'require-permissions.decorator',
        ),
      ).map(({ file }) => file);

      expect(offenders).toEqual([]);
    });

    it('does not import the plural decorator under any module path', () => {
      // The check above matches the one path the deprecated file is reachable
      // by. This one reads the sources rather than resolving the import, so a
      // re-export under a different path is still caught.
      const offenders = CONTROLLERS.filter(({ file }) =>
        /\bRequirePermissions\b/.test(
          readFileSync(join(__dirname, file), 'utf8'),
        ),
      ).map(({ file }) => file);

      expect(offenders).toEqual([]);
    });
  });
});
