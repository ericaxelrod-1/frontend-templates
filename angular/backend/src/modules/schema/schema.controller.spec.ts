import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SchemaController } from './schema.controller';
import { SchemaService } from './schema.service';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from '../permissions/guards/permission.guard';
import { PermissionsService } from '../permissions/services/permissions.service';

/**
 * `SchemaController` exposes the live database shape: every table, every column
 * and its type, the primary keys, and the foreign-key graph between tables. It
 * carried no `@UseGuards` at all — not on the class, not on any handler — so
 * `/schema/tables` and `/schema/tables/:table/columns` answered anonymous
 * callers with a map of the entire system, including the names of the tables
 * that hold credentials.
 *
 * It was also once misreported as dead code. `SchemaController` appears in no
 * `*.module.ts` outside its own, which is true and proves nothing: `SchemaModule`
 * is imported at app.module.ts:38 and registered at app.module.ts:101, Nest
 * instantiates the controllers of every imported module, and four frontend
 * callers read this controller's response shape. The tests below are HTTP-level
 * so they would have caught the "it answers" claim directly — an unreachable
 * route returns 404, not 200.
 */
describe('SchemaController', () => {
  describe('authorization', () => {
    interface Harness {
      app: NestFastifyApplication;
      checkUserPermission: jest.Mock;
      schemaService: Record<string, jest.Mock>;
    }

    const CALLER = { id: 42, email: 'member@example.com' };

    async function appFor(held: string[]): Promise<Harness> {
      const checkUserPermission = jest.fn(
        async (_userId: number, resource: string, action: string) =>
          held.includes(`${resource}:${action}`),
      );

      const schemaService: Record<string, jest.Mock> = {
        getAllTables: jest
          .fn()
          .mockResolvedValue({ items: [{ name: 'users', columns: [] }], total: 1 }),
        getTableColumns: jest.fn().mockResolvedValue([{ name: 'id', type: 'int' }]),
        getTableMetadata: jest
          .fn()
          .mockResolvedValue({ name: 'users', columns: [] }),
        getPrimaryKeyColumns: jest.fn().mockResolvedValue(['id']),
        getRelationColumns: jest
          .fn()
          .mockResolvedValue([{ name: 'userId', targetTable: 'users' }]),
        getReferencedTables: jest
          .fn()
          .mockResolvedValue([{ tableName: 'users', columnName: 'userId' }]),
        getReferencingTables: jest
          .fn()
          .mockResolvedValue([{ tableName: 'sessions', columnName: 'userId' }]),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [SchemaController],
        providers: [
          PermissionGuard,
          Reflector,
          { provide: SchemaService, useValue: schemaService },
          { provide: PermissionsService, useValue: { checkUserPermission } },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = CALLER;
            return true;
          },
        })
        .compile();

      const app =
        moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      return { app, checkUserPermission, schemaService };
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

    const ROUTES: Array<[string, string]> = [
      ['GET', '/schema/tables'],
      ['GET', '/schema/tables/users/columns'],
      ['GET', '/schema/tables/users/metadata'],
      ['GET', '/schema/tables/users/primary-keys'],
      ['GET', '/schema/tables/users/relations'],
      ['GET', '/schema/tables/users/references'],
      ['GET', '/schema/tables/users/referencing'],
    ];

    describe('the defect this file exists for', () => {
      it('REFUSES a plain member on all eight disclosure routes with 403', async () => {
        await withApp(
          ['users:view', 'groups:read', 'dashboard:view'],
          async ({ app }) => {
            for (const [method, url] of ROUTES) {
              expect([url, (await app.inject({ method: method as 'GET', url })).statusCode]).toEqual([
                url,
                403,
              ]);
            }
          },
        );
      });

      it('never reaches the schema service on a refusal', async () => {
        // If the service were consulted before the guard, the disclosure would
        // already have happened regardless of the status code returned.
        await withApp(['users:view'], async ({ app, schemaService }) => {
          for (const [method, url] of ROUTES) {
            await app.inject({ method: method as 'GET', url });
          }

          for (const spy of Object.values(schemaService)) {
            expect(spy).not.toHaveBeenCalled();
          }
        });
      });

      it('asks the permission service about rls_rules:manage specifically', async () => {
        // Proof the refusal came from the requirement on these handlers and not
        // from some unrelated failure. `rls_rules:manage` is an existing
        // capability row, granted to Administrator / Super Administrator /
        // superuser and to nobody else.
        await withApp(['users:view'], async ({ app, checkUserPermission }) => {
          await app.inject({ method: 'GET', url: '/schema/tables' });

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'rls_rules',
            'manage',
          );
        });
      });

      it('does not let the read capability stand in for the manage one', async () => {
        // `rls_rules:read` is granted to the same three administrative roles as
        // `rls_rules:manage` in the seed data, so it is the most likely thing
        // to be mistaken for sufficient. Reading the schema and managing the RLS
        // rules built on it are one capability here, not two.
        await withApp(['rls_rules:read'], async ({ app }) => {
          expect(
            (await app.inject({ method: 'GET', url: '/schema/tables' }))
              .statusCode,
          ).toBe(403);
        });
      });
    });

    describe('ALLOWS an RLS administrator', () => {
      it.each(ROUTES)('allows %s %s for a holder of rls_rules:manage', async (method, url) => {
        await withApp(['rls_rules:manage'], async ({ app }) => {
          expect(
            (await app.inject({ method: method as 'GET', url })).statusCode,
          ).toBe(200);
        });
      });

      it('still answers, so the RLS admin screens keep working', async () => {
        // Regression guard in the other direction: guarding a live controller
        // that four frontend callers depend on must not turn into a denial of
        // service. `join-path-diagram`, `scope-builder`, `rls-editor-dialog`,
        // `scope-templates-admin` and `join-paths-admin` all read this shape.
        await withApp(['rls_rules:manage'], async ({ app }) => {
          const tables = await app.inject({
            method: 'GET',
            url: '/schema/tables',
          });

          expect(tables.statusCode).toBe(200);
          expect(JSON.parse(tables.payload).total).toBe(1);
        });
      });
    });

    describe('wiring', () => {
      const handlerNames = () =>
        Object.getOwnPropertyNames(SchemaController.prototype).filter(
          (name) => name !== 'constructor',
        );

      const handlerOf = (name: string) =>
        (
          SchemaController.prototype as unknown as Record<string, unknown>
        )[name];

      const requirementOf = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(name));

      it('states a requirement on every handler', () => {
        expect(
          handlerNames().filter((name) => requirementOf(name) === undefined),
        ).toEqual([]);
      });

      it('wires PermissionGuard and JwtAuthGuard on the class', () => {
        const guards = Reflect.getMetadata(
          '__guards__',
          SchemaController,
        ) as unknown[];

        expect(guards).toContain(PermissionGuard);
        expect(guards).toContain(JwtAuthGuard);
      });

      it('wires PermissionGuard exactly once', () => {
        const occurrences = (
          (Reflect.getMetadata('__guards__', SchemaController) as
            | unknown[]
            | undefined) ?? []
        ).filter((guard) => guard === PermissionGuard).length;

        expect(occurrences).toBe(1);
      });

      it('carries no class-level permission, because the guard OR-merges it', () => {
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, SchemaController),
        ).toBeUndefined();
      });

      it('exposes no route that skips the requirement', () => {
        // Every handler is a GET here, so this is the whole attack surface.
        expect(handlerNames().length).toBe(ROUTES.length);
      });
    });

    describe('the reachability claim, proved rather than assumed', () => {
      it('is registered: SchemaModule is imported by the module graph', () => {
        // The prior report concluded this controller was dead code because
        // `SchemaController` appears in no module outside its own. This asserts
        // the thing that actually decides reachability — the module import —
        // so a future refactor that drops it fails here rather than silently
        // turning the guard below into decoration.
        const { readFileSync: read } = require('fs') as typeof import('fs');
        const { join: joinPath } = require('path') as typeof import('path');

        const appModule = read(
          joinPath(__dirname, '../../app.module.ts'),
          'utf8',
        );

        expect(appModule).toContain(
          "import { SchemaModule } from './modules/schema/schema.module'",
        );
        // Registered in `imports`, not merely mentioned: the module list is the
        // one array beginning `imports: [` and containing AuthModule.
        const importsList = appModule.slice(
          appModule.indexOf('imports: ['),
          appModule.indexOf('controllers: [AppController]'),
        );

        expect(importsList).toContain('SchemaModule,');
      });

      it('has frontend callers, so it is not an orphan', () => {
        const { readFileSync: read } = require('fs') as typeof import('fs');
        const { join: joinPath } = require('path') as typeof import('path');

        const rlsService = read(
          joinPath(
            __dirname,
            '../../../../frontend/src/app/services/rls.service.ts',
          ),
          'utf8',
        );

        expect(rlsService).toContain('/schema/tables');
      });
    });
  });
});
