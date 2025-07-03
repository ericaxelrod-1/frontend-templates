/**
 * This file is a compatibility layer for existing code that imports RolePermission from the permissions module.
 * It re-exports the RolePermission entity from the roles module.
 *
 * @deprecated Import RolePermission from the roles module instead
 */

export { RolePermission } from '../../roles/entities/role-permission.entity';
