/**
 * This file is a compatibility layer for existing code that imports Group from the users module.
 * It re-exports the Group entity from the permissions module.
 * 
 * @deprecated Import Group from the permissions module instead
 */

export { Group } from '../../permissions/entities/group.entity';
