import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable, Logger, OnApplicationBootstrap, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService } from '@nestjs/core';
import type { DispatchToken } from './dispatch-token.js';
import { dispatchTokenForRoute } from './dispatch-token.js';

/**
 * The route census: **a route this build cannot name is a boot error.**
 *
 * ## The claim this file replaces, and what it actually claimed
 *
 * `dispatch-token.ts` used to assert that "a route added without a line here fails
 * the boot, which is the intended moment to decide whether it is breakable". Nothing
 * implemented it. The claim was deleted and replaced with an honest description of the
 * gap, which is the right thing to do and is not the same as closing the gap: an
 * unmapped route stayed silently **unnamed**, and unnamed means unprotected, which
 * means sheddable — admitted at `202` and not dispatched the moment the breaker opens,
 * with nothing anywhere recording that nobody ever classified it.
 *
 * So the control is here, and it is a boot-time throw rather than a comment. The
 * deleted comment's sentence is now true, which is the only way a comment becomes
 * worth anything.
 *
 * ## Why the enumeration is the CONTAINER's and not a list
 *
 * `DiscoveryService.getControllers()` walks the resolved module graph and returns the
 * controller classes Nest actually mounted — the same list the router explorer mounts
 * routes from. The alternative, a hand-maintained route list, is the thing this file
 * exists to remove: it is correct until the day somebody forgets it, and nothing about
 * it can tell you it has been forgotten.
 *
 * ## Why it fails CLOSED, and the specific shape that would have been a false green
 *
 * `assertRouteCoverage` refuses an **empty** enumeration. An empty census is not "no
 * routes, everything is covered"; it is "this build cannot see its own routes", and
 * reporting the second as the first is a gate that passes exactly when it has stopped
 * working. The same bug shipped in this repository as
 * `test/unit/down-script.spec.ts`, where a directory read that returned nothing made
 * every down-script assertion pass — so the guard is the first statement in the
 * function, before any route is classified.
 *
 * The three refusals, in order:
 *
 *  1. **no routes enumerated** — the census is broken, and it says so;
 *  2. **a route no token names** — the omission this file was written for;
 *  3. **a malformed exemption** — see `NON_DISPATCHABLE_CONTROLLERS`.
 *
 * ## The test-fixture exemption, and the two answers this refuses
 *
 * `test/e2e/email.e2e-spec.ts` declares `EmailProbeController` and mounts it beside
 * `AppModule`. The global interceptor genuinely runs on its routes, so by the same
 * construction that makes them a dispatch site — and shedding a route no deployment
 * exposes is the *correct* behaviour, not a gap. Two easy ways to make that go away
 * are refused, and both are refusals of the symptom:
 *
 *  - **Refused: add `emailprobe.*` to `BREAKER_PROTECTED`.** That names a fixture as
 *    production traffic. It leaves "no route is ever checked" exactly where it was, and
 *    it fights the `.env` block's existing assertion that the list holds request-path
 *    work only (`test/unit/purge/purge-enqueuer-scheduling.spec.ts`).
 *  - **Refused: skip the census when `NODE_ENV === 'test'`.** That is a `NODE_ENV`
 *    branch around a security control — the shape `AGENTS.md` §2.3 calls a silent
 *    weakening — and it would buy nothing, because the fixture is mounted by the
 *    application graph in **every** mode.
 *
 *  What is used instead is a **declared exemption with a required, verified reason**:
 *  a closed list, on the side of the vocabulary rather than on the side of the gate,
 *  where every entry must name the controller, the file that declares it, and why. The
 *  reason is enforced rather than advisory — TypeScript makes the field required, the
 *  gate rejects a blank one, and the gate **reads the named file** and refuses unless
 *  it actually declares that class. So an exemption is a checked claim about a
 *  verifiable fact, not a comment.
 *
 * **The one thing that cannot be exempted is production code.** `declaredIn` must be
 * under `test/`, which is what stops a controller moving into `src/` from inheriting a
 * fixture's exemption silently: the declaration stops matching and the boot stops.
 */

/** Backend root, for reading a declaration's `declaredIn`. `src/breaker/…` → two up. */
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Thrown for every refusal, so a boot failure names the census rather than the gate. */
export class RouteCensusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteCensusError';
  }
}

/**
 * One mounted route, as the census sees it.
 *
 * `requestMethod` and `path` decide nothing — the decision is the `(controller, handler)`
 * pair, which is exactly the pair `dispatchTokenForRoute(controller.name, handler.name)`
 * takes at request time. They are carried so a refusal names a route a human can go and
 * look at.
 */
export interface MountedRoute {
  readonly controllerName: string;
  readonly handlerName: string;
  readonly requestMethod: string;
  readonly path: string;
}

/**
 * What the census needs from a container entry: the controller class, or nothing.
 *
 * Structural rather than `InstanceWrapper`, so every refusal above is exercisable from a
 * plain object. `metatype` is `unknown` because that is what a factory-provided
 * controller leaves behind and the census skips it rather than inventing a route.
 */
export interface ControllerWrapper {
  readonly metatype: unknown;
}

/**
 * A controller that is deliberately outside the dispatch vocabulary.
 *
 * `reason` is required by the type, rejected when blank by the gate, and the other two
 * fields are facts the gate checks rather than claims it trusts.
 */
export interface NonDispatchableDeclaration {
  /** The controller class name, exactly as declared. */
  readonly controller: string;
  /** Repository-relative path of the file that declares it. Must be under `test/`. */
  readonly declaredIn: string;
  /** Why this controller is not a dispatch site. Required, non-blank, and read. */
  readonly reason: string;
}

/**
 * The closed list of controllers the census will not demand a token for.
 *
 * **Adding an entry is a decision, and this is where it is recorded.** The three fields
 * are checked, not trusted: the reason must be non-blank, the declaring file must be
 * under `test/`, and that file must actually declare the class. A stale or invented
 * entry therefore fails the boot rather than quietly widening the exemption.
 */
export const NON_DISPATCHABLE_CONTROLLERS: readonly NonDispatchableDeclaration[] = Object.freeze([
  {
    controller: 'EmailProbeController',
    declaredIn: 'test/e2e/email.e2e-spec.ts',
    reason:
      'Declared inside a spec and imported by nothing in src/: it stands in for the registration and ' +
      'password-reset routes a later slice will own, and this repository ships neither. The global ' +
      'interceptor does run on it, so it really is a dispatch site, and shedding a route no deployment ' +
      'exposes is correct behaviour rather than a gap. It is recorded here rather than skipped silently ' +
      'so that moving it into src/ stops the boot instead of inheriting a test-only exemption.',
  },
]);

/** What the census concluded, for the boot log and for the tests. */
export interface RouteCensusVerdict {
  /** One token per mounted route, in census order. Every route is named or exempt. */
  readonly tokens: readonly DispatchToken[];
  /** Controller name → the reason it is exempt. Empty when nothing needed exempting. */
  readonly exemptions: ReadonlyMap<string, string>;
}

/**
 * `Reflect.getMetadata` is typed `any`; this narrows it before anything touches it.
 *
 * **The target matters and is not the prototype.** `@Controller` writes `PATH_METADATA`
 * onto the CLASS, and `@Get`/`@Post`/… write `PATH_METADATA` and `METHOD_METADATA` onto
 * the HANDLER FUNCTION (`descriptor.value`), which is what `router-explorer.ts` reads.
 * Reading method metadata off the prototype instead finds nothing at all — so the
 * census enumerated zero routes for a fully-mounted application, and the fail-closed
 * refusal below is what caught it rather than a green "all routes are known".
 */
function metadata(key: string, target: object): unknown {
  return Reflect.getMetadata(key, target) as unknown;
}

/**
 * Handler names, up the prototype chain.
 *
 * A controller may extend a base controller, and a route the router explorer mounts is
 * a route whether or not the method was declared on the subclass itself.
 */
function handlerNames(prototype: object): readonly string[] {
  const names: string[] = [];
  let current: object | null = prototype;
  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== 'constructor' && !names.includes(name)) {
        names.push(name);
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return names;
}

/** `/auth` + `login` → `/auth/login`, and `/auth` + `` → `/auth`. */
function routePath(controllerPath: string, methodPath: string): string {
  const joined = `${controllerPath}/${methodPath}`.replaceAll(/\/{2,}/g, '/').replace(/^\/|\/$/g, '');
  return `/${joined}`;
}

/**
 * The mounted routes, read from the container's controllers and the metadata the router
 * explorer itself mounts from. **Pure**: it takes the controller wrappers, so the
 * refusals below are testable without an application.
 *
 * A controller class with no request-mapped method contributes nothing — a helper
 * controller, or one whose handlers are mounted by something other than a route
 * decorator, is not a dispatch site and is not invented into one.
 */
export function mountedRoutesOf(controllers: readonly ControllerWrapper[]): readonly MountedRoute[] {
  const routes: MountedRoute[] = [];
  for (const controller of controllers) {
    const metatype = controller.metatype;
    if (typeof metatype !== 'function') {
      continue;
    }
    const prototype = metatype.prototype as unknown;
    if (typeof prototype !== 'object' || prototype === null) {
      continue;
    }
    const controllerName: string = metatype.name;
    const rawControllerPath = metadata(PATH_METADATA, metatype);
    const controllerPath = typeof rawControllerPath === 'string' ? rawControllerPath : '';

    for (const handlerName of handlerNames(prototype)) {
      const handler: unknown = (prototype as Record<string, unknown>)[handlerName];
      if (typeof handler !== 'function') {
        continue;
      }
      const rawMethod = metadata(METHOD_METADATA, handler);
      if (typeof rawMethod !== 'number') {
        continue;
      }
      const rawMethodPath = metadata(PATH_METADATA, handler);
      const methodPath = typeof rawMethodPath === 'string' ? rawMethodPath : '';
      routes.push({
        controllerName,
        handlerName,
        requestMethod: RequestMethod[rawMethod] ?? String(rawMethod),
        path: routePath(controllerPath, methodPath),
      });
    }
  }
  return routes;
}

/** Does this file actually declare this class? The reason is only as good as this. */
function declaresController(path: string, controller: string): boolean {
  return new RegExp(`\\bclass\\s+${controller}\\b`).test(readFileSync(path, 'utf8'));
}

/**
 * Checks every declaration against the file it names.
 *
 * Refuses a blank reason, a declaration that does not live under `test/`, a file that
 * does not exist, a file that does not declare the class, and a duplicate. A declared
 * controller that happens not to be mounted is **not** a refusal: the production graph
 * mounts no fixture, and an entry is a claim about the repository rather than about one
 * application graph.
 */
function checkDeclarations(declarations: readonly NonDispatchableDeclaration[]): Map<string, string> {
  const reasons = new Map<string, string>();
  const problems: string[] = [];

  for (const declaration of declarations) {
    const { controller, declaredIn, reason } = declaration;
    if (reason.trim() === '') {
      problems.push(
        `${controller} is declared non-dispatchable with a blank reason; an exemption nobody can read ` +
          'is the silent skip this list exists to replace',
      );
    }
    if (reasons.has(controller)) {
      problems.push(`${controller} is declared non-dispatchable more than once`);
    }
    if (!declaredIn.startsWith('test/')) {
      problems.push(
        `${controller} is declared non-dispatchable from ${declaredIn}, which is not under test/: ` +
          'production code cannot be exempted from the dispatch vocabulary, because an unnamed ' +
          'production route is sheddable for every caller',
      );
    } else {
      const path = join(BACKEND_ROOT, declaredIn);
      if (!existsSync(path)) {
        problems.push(`${controller} is declared non-dispatchable in ${declaredIn}, which does not exist`);
      } else if (!declaresController(path, controller)) {
        problems.push(`${controller} is declared non-dispatchable in ${declaredIn}, which does not declare it`);
      }
    }
    reasons.set(controller, reason);
  }

  if (problems.length > 0) {
    throw new RouteCensusError(`the non-dispatchable declarations are not usable:\n  - ${problems.join('\n  - ')}`);
  }
  return reasons;
}

/**
 * The gate. Every mounted route is either named by the dispatch vocabulary or exempt
 * by a declaration, and anything else stops the boot.
 *
 * @throws RouteCensusError on an empty enumeration, an unmapped route, or a declaration
 *   that does not hold up.
 */
export function assertRouteCoverage(
  routes: readonly MountedRoute[],
  declarations: readonly NonDispatchableDeclaration[] = NON_DISPATCHABLE_CONTROLLERS,
): RouteCensusVerdict {
  if (routes.length === 0) {
    throw new RouteCensusError(
      'the route census enumerated 0 routes, so it cannot say anything about coverage. ' +
        'This is the gate reporting that it cannot see its own routes — NOT that every route is ' +
        'named. An empty enumeration that passes is a gate that has stopped working.',
    );
  }

  const exemptions = checkDeclarations(declarations);

  const tokens: DispatchToken[] = [];
  const unmapped: string[] = [];
  for (const route of routes) {
    const token = dispatchTokenForRoute(route.controllerName, route.handlerName);
    if (token !== undefined) {
      tokens.push(token);
    } else if (!exemptions.has(route.controllerName)) {
      unmapped.push(`${route.requestMethod} ${route.path} → ${route.controllerName}.${route.handlerName}()`);
    }
  }

  if (unmapped.length > 0) {
    throw new RouteCensusError(
      `${String(unmapped.length)} mounted route(s) name no dispatch token, so the gate cannot decide ` +
        'whether they are breakable and would shed them while the breaker is open:\n  - ' +
        `${unmapped.join('\n  - ')}\n\n` +
        'Either add the token to KNOWN_DISPATCH_TOKENS (dispatch-token.ts) — which is the decision to ' +
        'name the site — or, if the route genuinely is not dispatchable, declare it in ' +
        'NON_DISPATCHABLE_CONTROLLERS with the file that declares it and why.',
    );
  }

  const used = new Map<string, string>();
  for (const route of routes) {
    const reason = exemptions.get(route.controllerName);
    if (reason !== undefined) {
      used.set(route.controllerName, reason);
    }
  }

  return { tokens, exemptions: used };
}

/**
 * The boot-time control. Registered on the module that owns the interceptor, so the
 * thing being asserted and the thing doing the asserting cannot drift apart.
 *
 * `onApplicationBootstrap` rather than `onModuleInit` because this is the last moment
 * every provider is resolved: the census is only meaningful over a complete graph.
 */
@Injectable()
export class RouteCensus implements OnApplicationBootstrap {
  private readonly logger = new Logger(RouteCensus.name);

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    const verdict = assertRouteCoverage(mountedRoutesOf(this.discovery.getControllers()));
    const exempt =
      verdict.exemptions.size === 0
        ? ''
        : `; ${String(verdict.exemptions.size)} declared non-dispatchable (${[...verdict.exemptions.keys()].join(', ')})`;
    this.logger.log(`route census: ${String(verdict.tokens.length)} mounted route(s), all named — ${verdict.tokens.join(', ')}${exempt}`);
  }
}