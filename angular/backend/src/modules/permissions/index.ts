// Export entities
export { Permission } from './entities/permission.entity';
export { UiComponent } from './entities/ui-component.entity';
export { FrontendRoute } from './entities/frontend-route.entity';
export { ApiEndpoint } from './entities/api-endpoint.entity';
export { GroupPermission } from './entities/group-permission.entity';
export { UserPermission } from './entities/user-permission.entity';
export { RolePermission } from './entities/role-permission.entity';

// Export services
export { PermissionsService } from './services/permissions.service';
export { CacheSyncService } from './cache-sync.service';

// Export guards
export { PermissionGuard } from './guards/permission.guard';

// Export decorators - rename to avoid namespace collision
export {
  RequirePermission as RequirePermissionDecorator,
  RequireAllPermissions as RequireAllPermissionsDecorator,
} from './decorators/require-permission.decorator';

// Export module
export { PermissionsModule } from './permissions.module';
