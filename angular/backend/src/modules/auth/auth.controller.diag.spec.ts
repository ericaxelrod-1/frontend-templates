import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from '../permissions/guards/permission.guard';
import { PermissionsService } from '../permissions/services/permissions.service';

/**
 * `POST /auth/diag/db-check` is a diagnostic that answers with the user count,
 * whether the seeded `admin@example.com` account exists, the role count, the
 * permission count and the database driver's own error text.
 *
 * `AuthController` is declared with `@Controller('auth')` and no class-level
 * guard, and this handler had no guard of its own either, so it answered
 * unauthenticated callers. Beyond the counts, `adminExists` is pre-reconnaissance
 * for the seeded administrator account on any deployment that ran the seed.
 *
 * It is a POST purely for historical reasons — it reads, it never writes — so
 * the fix is a requirement on the handler, not a change of verb. Rewriting the
 * route shape would break any caller that already has the URL.
 */
describe('AuthController POST /auth/diag/db-check', () => {
  describe('authorization', () => {
    interface Harness {
      app: NestFastifyApplication;
      checkUserPermission: jest.Mock;
      usersService: Record<string, jest.Mock>;
    }

    const CALLER = { id: 42, email: 'member@example.com' };

    async function appFor(held: string[]): Promise<Harness> {
      const checkUserPermission = jest.fn(
        async (_userId: number, resource: string, action: string) =>
          held.includes(`${resource}:${action}`),
      );

      const usersService: Record<string, jest.Mock> = {
        count: jest.fn().mockResolvedValue(3),
        findByEmail: jest.fn().mockResolvedValue(null),
        userExistsCheck: jest.fn().mockResolvedValue(true),
      };

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          PermissionGuard,
          Reflector,
          {
            provide: PermissionsService,
            useValue: {
              checkUserPermission,
              seedDefaultPermissions: jest.fn(),
            },
          },
          {
            provide: UsersService,
            useValue: usersService,
          },
          {
            provide: AuthService,
            useValue: {
              login: jest.fn(),
              register: jest.fn(),
              refreshToken: jest.fn(),
            },
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = CALLER;
            return true;
          },
        })
        .overrideGuard(LocalAuthGuard)
        .useValue({ canActivate: () => true })
        .compile();

      const app =
        moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      return { app, checkUserPermission, usersService };
    }

    let harness: Harness | undefined;

    async function withApp<T>(
      held: string[],
      body: (h: Harness) => Promise<T>,
    ): Promise<T> {
      harness = await appFor(held);
      try {
        return await body(harness);
      } finally {
        await harness.app.close();
        harness = undefined;
      }
    }

    afterEach(async () => {
      if (harness) {
        await harness.app.close();
        harness = undefined;
      }
    });

    describe('the defect this file exists for', () => {
      it('REFUSES a plain member with 403', async () => {
        await withApp(
          ['users:view', 'groups:read', 'dashboard:view'],
          async ({ app }) => {
            const response = await app.inject({
              method: 'POST',
              url: '/auth/diag/db-check',
            });

            expect(response.statusCode).toBe(403);
          },
        );
      });

      it('never reaches the user service on a refusal', async () => {
        // The disclosure here IS the service result, so a 403 raised after the
        // fact would still have leaked the counts.
        await withApp(['users:view'], async ({ app, usersService }) => {
          await app.inject({ method: 'POST', url: '/auth/diag/db-check' });

          expect(usersService.count).not.toHaveBeenCalled();
          expect(usersService.userExistsCheck).not.toHaveBeenCalled();
        });
      });

      it('leaks nothing about the admin account to a refused caller', async () => {
        await withApp(['users:view'], async ({ app }) => {
          const response = await app.inject({
            method: 'POST',
            url: '/auth/diag/db-check',
          });

          expect(response.payload).not.toContain('adminExists');
          expect(response.payload).not.toContain('userCount');
          expect(response.payload).not.toContain('admin@example.com');
        });
      });

      it('asks the permission service about system:health specifically', async () => {
        // `system:health` is an existing row — "View system health and resource
        // stats" — granted to Administrator and Super Administrator. Nothing
        // new was minted for this route.
        await withApp(['users:view'], async ({ app, checkUserPermission }) => {
          await app.inject({ method: 'POST', url: '/auth/diag/db-check' });

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'system',
            'health',
          );
        });
      });

      it('does not let the general system capability stand in for it', async () => {
        // `system:manage` and `system:admin` are granted to broader sets than
        // `system:health`; neither implies a right to enumerate the user table.
        await withApp(['system:manage', 'system:admin'], async ({ app }) => {
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/auth/diag/db-check',
              })
            ).statusCode,
          ).toBe(403);
        });
      });
    });

    describe('ALLOWS an operator', () => {
      it('ALLOWS a holder of system:health, and the diagnostic runs', async () => {
        await withApp(['system:health'], async ({ app, usersService }) => {
          const response = await app.inject({
            method: 'POST',
            url: '/auth/diag/db-check',
          });

          // `@HttpCode(200)`, not Nest's default 201 for POST.
          expect(response.statusCode).toBe(200);
          expect(usersService.count).toHaveBeenCalled();
          expect(usersService.userExistsCheck).toHaveBeenCalledWith(
            'admin@example.com',
          );
        });
      });
    });

    describe('wiring', () => {
      const handler = (
        AuthController.prototype as unknown as Record<string, object>
      ).checkDatabaseHealth;

      it('states the requirement on the handler', () => {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBe(
          'system:health',
        );
      });

      it('wires both guards on the handler', () => {
        const guards = Reflect.getOwnMetadata('__guards__', handler) as
          | unknown[]
          | undefined;

        expect(guards).toContain(PermissionGuard);
        expect(guards).toContain(JwtAuthGuard);
      });

      it('wires PermissionGuard exactly once', () => {
        const occurrences = (
          (Reflect.getOwnMetadata('__guards__', handler) as
            | unknown[]
            | undefined) ?? []
        ).filter((guard) => guard === PermissionGuard).length;

        expect(occurrences).toBe(1);
      });

      it('leaves no class-level permission, because the guard OR-merges it', () => {
        // A class-level requirement here would OR with every handler's and widen
        // the auth surface of login, register and refresh with it.
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, AuthController),
        ).toBeUndefined();
      });

      it('does not authenticate every route on this controller as a side effect', async () => {
        // `login`, `register` and `refresh` must stay reachable: putting the
        // guard on the class to "be safe" would lock every new user out of
        // creating an account.
        expect(
          Reflect.getOwnMetadata('__guards__', handler),
        ).not.toBe(
          Reflect.getMetadata('__guards__', AuthController),
        );
      });
    });
  });
});
