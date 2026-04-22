/**
 * This file is a compatibility layer for existing code that imports Role from the users module.
 * It re-exports the Role entity from the roles module.
 *
 * @deprecated Import Role from the roles module instead
 */

export {
  Role,
  SystemRoles,
  SystemRoleType,
  UserRole,
} from '../../roles/entities/role.entity';
