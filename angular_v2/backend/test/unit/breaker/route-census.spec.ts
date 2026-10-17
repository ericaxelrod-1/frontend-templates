import type { Type } from '@nestjs/common';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { Public } from '../../../src/auth/public.decorator.js';
import {
  NON_DISPATCHABLE_CONTROLLERS,
  RouteCensus,
  RouteCensusError,
  assertRouteCoverage,
  mountedRoutesOf,
} from '../../../src/breaker/route-census.js';

/**
 * The route census, and the shapes it exists to refuse.
 *
 * ## What is asserted
 *
 * The control is a boot-time throw, so every way it can be wrong is a way the
 * application starts and then behaves as if it had been classified:
 *
 *  1. **the enumeration is the container's** — `DiscoveryService.getControllers()`, the
 *     resolved module graph, read through the same `PATH_METADATA` / `METHOD_METADATA`
 *     the router explorer mounts from. A hand-maintained route list is the thing being
 *     removed, and nothing about one can report that it has been forgotten;
 *  2. **an empty enumeration is a refusal** — the `down-script.spec.ts` failure shape,
 *     where a read that found nothing made every assertion pass;
 *  3. **an unmapped route refuses the BOOT** — through `init()` with the real
 *     `RouteCensus` provider, because the claim is about a boot and not a function;
 *  4. **the declared exemption is a checked claim** — five refusals of its own;
 *  5. **the gate is registered** — a census nobody registers checks nothing.
 *
 * ## The exemption, and why the production graph never needs it
 *
 * `assertRouteCoverage` is called here with the real declarations, so the shipped
 * production graph must classify with **zero** exemptions: `AppModule` mounts
 * `AuthController` and nothing else, and every one of its routes is named. The
 * exemption exists for a fixture the e2e suite mounts beside `AppModule`, and the boot
 * refusal is proved on a controller that is *not* declared, which is the case that would
 * otherwise reach production.
 */

/**
 * Booting `AppModule` compiles and initialises the whole application graph, which on a
 * cold module registry is seconds — past vitest's 5s default, and a timeout here
 * reports as `STACK_TRACE_ERROR` rather than as a timeout, which is how the first
 * version of this file failed for no visible reason. Exactly one test pays it.
 */
const BOOT_TIMEOUT = 60_000;

/** Set before the `AppModule` import: both evaluate their configuration on load. */
const BREAKER_ENV: Record<string, string> = {
  BREAKER_MEMORY_GREEN: '60',
  BREAKER_MEMORY_YELLOW: '80',
  BREAKER_MEMORY_RED: '90',
  BREAKER_POLL_SECONDS: '30',
  BREAKER_COOLDOWN_SECONDS: '120',
  BREAKER_PROBE_TIMEOUT_SECONDS: '60',
  BREAKER_PROTECTED: 'auth.login,auth.refresh,auth.logout,auth.me,breaker.meter,breaker.gate',
};

for (const [key, value] of Object.entries(BREAKER_ENV)) {
  process.env[key] = value;
}

/**
 * The shape of `test/e2e/email.e2e-spec.ts`'s probe: a controller the global interceptor
 * really does run on, because the e2e suite mounts it beside `AppModule`.
 *
 * Declared under the SAME name on purpose. The gate matches a declaration by class name
 * and then checks that the named file really declares that class, so re-using the name
 * here exercises the shipped declaration rather than a convenient stand-in.
 */
@Controller('auth')
class EmailProbeController {
  @Public()
  @Post('email/verification')
  verification(): string {
    return 'sent';
  }
}

/** A route nothing names: the defect the census was written for. */
@Controller('reports')
class UnmappedProbeController {
  @Get('monthly')
  monthly(): string {
    return 'nope';
  }
}

/**
 * The census provider over a test-sized graph.
 *
 * The REAL `RouteCensus`, the REAL `DiscoveryModule` enumeration and the REAL Nest
 * lifecycle — with two fixture controllers in place of an application. That is what
 * makes the two boot claims below worth anything: they are about the control refusing a
 * boot, not about the function throwing.
 *
 * **Why not `AppModule`:** a full application boot is seconds on a cold registry, and
 * this file already pays one for the claim that actually needs it — that the shipped
 * production graph classifies with no exemption at all. Two more would make the unit
 * suite pay for the same graph twice.
 */
function censusOver(...controllers: Type[]): Promise<TestingModule> {
  @Module({ imports: [DiscoveryModule], providers: [RouteCensus], controllers })
  class CensusGraphModule {}

  return Test.createTestingModule({ imports: [CensusGraphModule] }).compile();
}

describe('the census enumerates the routes Nest actually mounted', () => {
  it('reads the resolved module graph, and classifies the production graph with NO exemption', async () => {
    // One boot, two claims, because each boot of `AppModule` costs seconds and the two
    // assertions are about the same census: what it found, and what it concluded.
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      await moduleRef.init();
      const discovery = moduleRef.get(DiscoveryService, { strict: false });
      const routes = mountedRoutesOf(discovery.getControllers());

      // Declaration order in the class, which is the order `handlerNames()` reads
      // it from the prototype. The four one-time-token routes sit between `logout`
      // and `me` because that is where they are declared in `AuthController`.
      //
      // Pinned as an exact list on purpose: `verdict.tokens` below already asserts
      // that every one of these is NAMEABLE, and a list of eight entries compared
      // for equality is also the assertion that none of them is quietly un-named by
      // being spelled differently — `dispatchTokenForRoute` returns `undefined` for a
      // near-miss, so `auth.passwordResetRequest` would fail the boot rather than
      // pass this one.
      expect(routes.map((route) => `${route.requestMethod} ${route.path}`)).toEqual([
        'POST /auth/login',
        'POST /auth/refresh',
        'POST /auth/logout',
        'POST /auth/password-reset/request',
        'POST /auth/password-reset/confirm',
        'POST /auth/email-verification/request',
        'POST /auth/email-verification/confirm',
        'GET /auth/me',
        'POST /privacy/erase',
      ]);

      const verdict = assertRouteCoverage(routes);
      expect(verdict.tokens).toEqual([
        'auth.login',
        'auth.refresh',
        'auth.logout',
        'auth.password_reset_request',
        'auth.password_reset_confirm',
        'auth.email_verification_request',
        'auth.email_verification_confirm',
        'auth.me',
        'privacy.erase',
      ]);
      // The graph mounts no fixture, so nothing is exempt — and a gate that only passed
      // because of its exemption table would pass here while the table covered a route
      // it had no business covering.
      expect([...verdict.exemptions]).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  }, BOOT_TIMEOUT);
});

describe('the census refuses what it cannot speak about', () => {
  it('refuses an empty enumeration, because zero routes found is not zero routes unmapped', () => {
    // THE failure shape this file exists to keep out: a census that found nothing must
    // not report full coverage. `test/unit/down-script.spec.ts` shipped the same bug as
    // a passing suite, and the fix there was the assertion that the list is non-empty.
    const failure = (() => {
      try {
        assertRouteCoverage([]);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('enumerated 0 routes');
    // …and it says the direction, because "0 routes" read on its own is a shrug.
    expect((failure as Error).message).toContain('NOT that every route is named');
  });

  it('refuses a route no token names, and names the route rather than saying "unmapped"', () => {
    const failure = (() => {
      try {
        assertRouteCoverage(
          [
            { controllerName: 'AuthController', handlerName: 'login', requestMethod: 'POST', path: '/auth/login' },
            { controllerName: 'ReportsController', handlerName: 'monthly', requestMethod: 'GET', path: '/reports/monthly' },
          ],
          [],
        );
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('1 mounted route(s) name no dispatch token');
    // A report a human can act on: the HTTP route, the class and the handler.
    expect((failure as Error).message).toContain('GET /reports/monthly → ReportsController.monthly()');
    expect((failure as Error).message).not.toContain('AuthController.login');
  });

  it('refuses the BOOT when a mounted route names no dispatch token', async () => {
    // Through `init()` on a real Nest graph, because the claim is about a boot and not
    // about a function: the same `RouteCensus` provider, the same `DiscoveryModule`
    // enumeration, the same `onApplicationBootstrap` moment `AppModule` uses.
    const moduleRef = await censusOver(UnmappedProbeController);

    // Captured rather than `rejects.toThrow(...)`: `init()` rejects while the gate's own
    // hook promise is still settling, and `close()` on a module that never finished
    // initialising rejects with the same error a second time. Both copies are the same
    // refusal; one of them is a leak from the test, not from the control.
    const failure = await moduleRef.init().then(
      () => null,
      (error: unknown) => error,
    );
    await moduleRef.close().catch(() => undefined);

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('GET /reports/monthly → UnmappedProbeController.monthly()');
  });

  it('boots the graph that mounts the DECLARED fixture, because a recorded decision is a decision', async () => {
    const moduleRef = await censusOver(EmailProbeController);
    try {
      // No throw: the boot completed. That IS the assertion, and it is the whole of the
      // claim — a controller the census cannot name no longer stops the application.
      await moduleRef.init();

      const discovery = moduleRef.get(DiscoveryService, { strict: false });
      const verdict = assertRouteCoverage(mountedRoutesOf(discovery.getControllers()));
      // The reason travels with the exemption, so a reader of the boot log learns WHY the
      // route was not named rather than only that it was not.
      expect(verdict.exemptions.get('EmailProbeController')).toContain('Declared inside a spec');
      // …and it was consumed, not merely present: the table was not reached for.
      expect(verdict.tokens).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });
});

describe('a declared exemption is a checked claim, not a comment', () => {
  const probes = mountedRoutesOf([
    { metatype: EmailProbeController },
    { metatype: UnmappedProbeController },
  ]);

  it('refuses a declaration with no reason', () => {
    const failure = (() => {
      try {
        assertRouteCoverage(probes, [
          { controller: 'EmailProbeController', declaredIn: 'test/e2e/email.e2e-spec.ts', reason: '   ' },
        ]);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('blank reason');
  });

  it('refuses to exempt production code, which is the whole direction the table protects', () => {
    // The one thing that cannot be bought with a sentence. A controller that moves into
    // `src/` inherits nothing: the declaration stops applying and the next boot refuses.
    const failure = (() => {
      try {
        assertRouteCoverage(probes, [
          {
            controller: 'UnmappedProbeController',
            declaredIn: 'src/breaker/route-census.ts',
            reason: 'it is a fixture',
          },
        ]);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('is not under test/');
    expect((failure as Error).message).toContain('production code cannot be exempted');
  });

  it('refuses a declaration whose file does not declare the controller', () => {
    // The reason is only as good as the fact beside it, so the gate READS the file. A
    // declaration pointing at a real file that never declared the class is a claim that
    // costs one line to write and would otherwise be permanent.
    const failure = (() => {
      try {
        assertRouteCoverage(probes, [
          { controller: 'UnmappedProbeController', declaredIn: 'test/e2e/email.e2e-spec.ts', reason: 'a fixture' },
        ]);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('which does not declare it');
  });

  it('refuses a declaration naming a file that does not exist', () => {
    const failure = (() => {
      try {
        assertRouteCoverage(probes, [
          {
            controller: 'EmailProbeController',
            declaredIn: 'test/e2e/email-probe-e2e-spec.ts',
            reason: 'a fixture',
          },
        ]);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('does not exist');
  });

  it('refuses the same controller twice, because the second entry hides the first', () => {
    const declaration = NON_DISPATCHABLE_CONTROLLERS[0];
    const failure = (() => {
      try {
        assertRouteCoverage(probes, [declaration, declaration]);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RouteCensusError);
    expect((failure as Error).message).toContain('more than once');
  });

  it('carries a reason long enough to explain itself, since a blank one is refused', () => {
    // Not a length rule for its own sake: it is the reason the refusal above exists, and
    // it fails the build of a table whose entries have stopped being explanations.
    for (const declaration of NON_DISPATCHABLE_CONTROLLERS) {
      expect(declaration.reason.trim().length).toBeGreaterThan(80);
      expect(declaration.declaredIn.startsWith('test/')).toBe(true);
    }
  });
});

describe('the gate is registered where the thing it gates is registered', () => {
  it('is a provider of BreakerModule, beside the APP_INTERCEPTOR it protects', async () => {
    // The hole this closes: a census nobody registers checks nothing and reports
    // nothing. `Reflect.getMetadata('providers', BreakerModule)` is the module's own
    // declaration, which is the only place the registration can be lost.
    //
    // Imported DYNAMICALLY for the same reason `breaker-wiring.spec.ts` imports
    // `AppModule` dynamically: `breaker.module.ts` validates its configuration at
    // module-evaluation time, and a static import would run that before the `BREAKER_*`
    // keys above are set.
    const { BreakerModule } = await import('../../../src/breaker/breaker.module.js');
    const providers = Reflect.getMetadata('providers', BreakerModule) as readonly unknown[];

    expect(providers).toContain(RouteCensus);
    // …and it is beside the interceptor, in the same declaration. The two are one
    // decision: an interceptor with no census sheddably, and a census with no
    // interceptor has nothing to shed.
    expect(providers.filter(isInterceptorProvider)).toHaveLength(1);
  }, BOOT_TIMEOUT);
});

/** The `APP_INTERCEPTOR` provider, read structurally rather than with `expect.any`. */
function isInterceptorProvider(provider: unknown): boolean {
  if (typeof provider !== 'object' || provider === null) {
    return false;
  }
  const candidate = provider as { readonly provide?: unknown; readonly useClass?: unknown };
  return candidate.provide === APP_INTERCEPTOR && typeof candidate.useClass === 'function';
}