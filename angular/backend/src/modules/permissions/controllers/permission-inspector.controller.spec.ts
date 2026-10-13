import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionInspectorController } from './permission-inspector.controller';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from '../guards/permission.guard';
import { PermissionsService } from '../services/permissions.service';
import { UsersService } from '../../users/users.service';
import { RolesService } from '../../roles/roles.service';
import { GroupsService } from '../../users/groups.service';
import { RolePermission } from '../entities/role-permission.entity';
import { GroupPermission } from '../entities/group-permission.entity';

/**
 * This controller is a disclosure surface. Every handler answers a question
 * about somebody other than the caller — see the exposure tests below, which
 * pin down exactly what leaves the process so the permission choice is argued
 * from evidence rather than from the route names.
 */
describe('PermissionInspectorController', () => {
  const CALLER = { id: 42, email: 'member@example.com' };

  const SUBJECT = {
    id: 7,
    email: 'victim@example.com',
    firstName: 'Vic',
    lastName: 'Tim',
    roles: [{ id: 1, name: 'User' }],
    groups: [{ id: 2, name: 'Support' }],
  };

  const ROLE = {
    id: 1,
    name: 'Administrator',
    description: 'Runs the place',
    isSystemRole: true,
    rolePermissions: [
      { permission: { name: 'users:delete' }, isGranted: true },
    ],
  };

  const GROUP = {
    id: 2,
    name: 'Support',
    description: 'Front line',
    isSystemGroup: false,
    users: [
      { id: 7, email: 'victim@example.com', firstName: 'Vic', lastName: 'Tim' },
      { id: 8, email: 'other@example.com', firstName: 'Oth', lastName: 'Er' },
    ],
  };

  async function appFor(held: string[]) {
    const checkUserPermission = jest.fn(
      async (_userId: number, resource: string, action: string) =>
        held.includes(`${resource}:${action}`),
    );

    const usersService = {
      findOne: jest.fn().mockResolvedValue(SUBJECT),
    };
    const rolesService = {
      findOne: jest.fn().mockResolvedValue(ROLE),
      getAncestors: jest.fn().mockResolvedValue([{ id: 9, name: 'Owner' }]),
      getDescendants: jest.fn().mockResolvedValue([{ id: 10, name: 'Support Lead' }]),
      getEffectivePermissions: jest.fn().mockResolvedValue([
        { permission: 'users:delete', isGranted: true, source: 'Role: Administrator' },
        { permission: 'roles:manage', isGranted: true, source: 'Inherited' },
      ]),
    };
    const groupsService = {
      findOne: jest.fn().mockResolvedValue(GROUP),
      getAncestors: jest.fn().mockResolvedValue([]),
      getDescendants: jest.fn().mockResolvedValue([]),
      getEffectiveMembers: jest
        .fn()
        .mockResolvedValue([{ id: 7 }, { id: 8 }, { id: 11 }]),
    };
    const rolePermissionRepository = {
      find: jest.fn().mockResolvedValue([
        {
          roleId: 7,
          isGranted: true,
          permission: { name: 'users:delete' },
          role: { name: 'Administrator' },
        },
      ]),
    };
    const groupPermissionRepository = {
      find: jest.fn().mockResolvedValue([
        {
          groupId: 7,
          isGranted: true,
          permission: { name: 'roles:manage' },
          group: { name: 'Support' },
        },
      ]),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PermissionInspectorController],
      providers: [
        PermissionGuard,
        Reflector,
        { provide: PermissionsService, useValue: { checkUserPermission } },
        { provide: UsersService, useValue: usersService },
        { provide: RolesService, useValue: rolesService },
        { provide: GroupsService, useValue: groupsService },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: rolePermissionRepository,
        },
        {
          provide: getRepositoryToken(GroupPermission),
          useValue: groupPermissionRepository,
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
      .compile();

    const app =
      moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return {
      app,
      moduleRef,
      checkUserPermission,
      usersService,
      rolesService,
      groupsService,
    };
  }

  let open: { app: NestFastifyApplication; moduleRef: TestingModule } | undefined;

  async function withApp<T>(
    held: string[],
    body: (h: Awaited<ReturnType<typeof appFor>>) => Promise<T>,
  ) {
    const h = await appFor(held);
    open = h;
    try {
      return await body(h);
    } finally {
      await h.app.close();
      open = undefined;
    }
  }

  afterEach(async () => {
    if (open) {
      await open.app.close();
      open = undefined;
    }
  });

  const ROUTES = [
    'GET /permissions-inspector/user/7',
    'GET /permissions-inspector/role/1',
    'GET /permissions-inspector/group/2',
  ] as const;

  describe('authorization', () => {
    it('REFUSES an ordinary member on every route', async () => {
      // This is the defect. Before the guard was wired, `@UseGuards(JwtAuthGuard)`
      // alone meant any authenticated user could read any of the below.
      await withApp(['users:view', 'dashboard:view'], async ({ app }) => {
        for (const route of ROUTES) {
          const [method, url] = route.split(' ') as [string, string];
          expect((await app.inject({ method: method as 'GET', url })).statusCode).toBe(
            403,
          );
        }
      });
    });

    it('REFUSES a member holding only users:view, which is what the user role actually grants', async () => {
      // `users:view` is granted to the plain `user` role by the permission
      // seeds, so it is not an acceptable substitute for the requirement here:
      // it would leave the disclosure fully open to every ordinary member.
      await withApp(['users:view'], async ({ app }) => {
        for (const route of ROUTES) {
          const [method, url] = route.split(' ') as [string, string];
          expect((await app.inject({ method: method as 'GET', url })).statusCode).toBe(
            403,
          );
        }
      });
    });

    it('ALLOWS a member holding permissions:view on every route', async () => {
      await withApp(['permissions:view'], async ({ app, checkUserPermission }) => {
        for (const route of ROUTES) {
          const [method, url] = route.split(' ') as [string, string];
          expect((await app.inject({ method: method as 'GET', url })).statusCode).toBe(
            200,
          );
        }

        expect(checkUserPermission).toHaveBeenCalledWith(
          CALLER.id,
          'permissions',
          'view',
        );
      });
    });

    it('asks about the caller’s own id, not the id in the path', async () => {
      // `inspectUser` takes `:id` from the URL. The guard must still evaluate
      // the caller, otherwise a member could be checked against someone else's
      // permissions.
      await withApp(['permissions:view'], async ({ app, checkUserPermission }) => {
        await app.inject({ method: 'GET', url: '/permissions-inspector/user/7' });

        expect(checkUserPermission).toHaveBeenCalledWith(
          CALLER.id,
          'permissions',
          'view',
        );
        expect(checkUserPermission).not.toHaveBeenCalledWith(
          7,
          'permissions',
          'view',
        );
      });
    });
  });

  describe('wiring', () => {
    const handlerNames = () =>
      Object.getOwnPropertyNames(PermissionInspectorController.prototype).filter(
        (name) => name !== 'constructor',
      );

    const handlerOf = (name: string) =>
      (
        PermissionInspectorController.prototype as unknown as Record<
          string,
          unknown
        >
      )[name];

    const handlerGuards = (name: string) =>
      (Reflect.getOwnMetadata('__guards__', handlerOf(name)) as
        | unknown[]
        | undefined) ?? [];

    it('wires both guards at class level', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PermissionInspectorController,
      ) as unknown[];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionGuard);
    });

    it('states the requirement at class level', () => {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, PermissionInspectorController),
      ).toBe('permissions:view');
    });

    it('lets no handler override the class requirement', () => {
      // `PermissionGuard.getRequiredPermissions` concatenates class and handler
      // metadata and evaluates the result with OR. A handler-level requirement
      // here would *widen* the surface, not narrow it, so none may exist.
      const overriding = handlerNames()
        .filter((name) => Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(name)))
        .map((name) => ({ handler: name }));

      expect(overriding).toEqual([]);
    });

    it('does not double-wire any handler', () => {
      const doubled = handlerNames()
        .map((name) => ({
          handler: name,
          occurrences: handlerGuards(name).filter(
            (guard) => guard === PermissionGuard,
          ).length,
        }))
        .filter((entry) => entry.occurrences !== 0);

      expect(doubled).toEqual([]);
    });
  });

  describe('what the surface discloses', () => {
    // Recorded so the requirement chosen above is justified by what actually
    // leaves the process, not by what the route names suggest.
    it('discloses another user’s identity and full effective permission set', async () => {
      await withApp(['permissions:view'], async ({ app }) => {
        const body = JSON.parse(
          (await app.inject({ method: 'GET', url: '/permissions-inspector/user/7' }))
            .payload,
        );

        expect(body.user).toEqual({
          id: 7,
          email: 'victim@example.com',
          firstName: 'Vic',
          lastName: 'Tim',
        });
        expect(body.directPermissions).toEqual([
          { permission: 'users:delete', isGranted: true, source: 'Role: Administrator' },
        ]);
        expect(body.effectivePermissions).toEqual([
          {
            permission: 'users:delete',
            isGranted: true,
            inheritedFrom: 'Role: Administrator',
          },
          {
            permission: 'roles:manage',
            isGranted: true,
            inheritedFrom: 'Inherited',
          },
        ]);
      });
    });

    it('discloses a role’s ancestors, descendants and effective permissions', async () => {
      await withApp(['permissions:view'], async ({ app }) => {
        const body = JSON.parse(
          (await app.inject({ method: 'GET', url: '/permissions-inspector/role/1' }))
            .payload,
        );

        expect(body.hierarchy).toEqual({
          ancestors: [{ id: 9, name: 'Owner' }],
          descendants: [{ id: 10, name: 'Support Lead' }],
        });
        expect(body.effectivePermissions).toHaveLength(2);
      });
    });

    it('discloses a group’s member list, including email addresses', async () => {
      await withApp(['permissions:view'], async ({ app }) => {
        const body = JSON.parse(
          (await app.inject({ method: 'GET', url: '/permissions-inspector/group/2' }))
            .payload,
        );

        expect(body.directMembers).toEqual([
          { id: 7, email: 'victim@example.com', firstName: 'Vic', lastName: 'Tim' },
          { id: 8, email: 'other@example.com', firstName: 'Oth', lastName: 'Er' },
        ]);
        expect(body.effectiveMemberCount).toBe(3);
      });
    });

    it('discloses nothing at all to a member without the capability', async () => {
      await withApp([], async ({ app, usersService, rolesService, groupsService }) => {
        for (const route of ROUTES) {
          const [method, url] = route.split(' ') as [string, string];
          const response = await app.inject({ method: method as 'GET', url });

          expect(response.statusCode).toBe(403);
          expect(response.payload).not.toContain('victim@example.com');
        }

        expect(usersService.findOne).not.toHaveBeenCalled();
        expect(rolesService.findOne).not.toHaveBeenCalled();
        expect(groupsService.findOne).not.toHaveBeenCalled();
      });
    });
  });

  describe('guard semantics', () => {
    it('throws Forbidden rather than returning false, so Nest emits 403', async () => {
      const checkUserPermission = jest.fn().mockResolvedValue(false);
      const moduleRef = await Test.createTestingModule({
        providers: [
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: { checkUserPermission } },
        ],
      }).compile();

      const guard = moduleRef.get(PermissionGuard);
      const context = {
        getHandler: () => PermissionInspectorController.prototype.inspectUser,
        getClass: () => PermissionInspectorController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 42 } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(checkUserPermission).toHaveBeenCalledWith(42, 'permissions', 'view');

      await moduleRef.close();
    });
  });
});