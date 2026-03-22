import { EventSubscriber, EntitySubscriberInterface, InsertEvent, DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Logger } from '@nestjs/common';
import { RlsSecurityViolationError } from './errors';

const RLS_SCOPED_ENTITIES = ['groupId', 'customer_id', 'tenantId', 'organizationId'];

export { RlsSecurityViolationError };

export class RlsInsertSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger('RlsInsertSubscriber');
  private cls!: ClsService;

  setCls(cls: ClsService) {
    this.cls = cls;
  }

  register(dataSource: DataSource) {
    dataSource.subscribers.push(this);
    this.logger.log('RLS Insert Subscriber registered');
  }

  beforeInsert(event: InsertEvent<any>) {
    if (this.cls.get('__rlsBypass')) {
      return;
    }

    const activeGroupIds = this.cls.get('activeGroupIds') || [];
    const primaryGroupId = this.cls.get('primaryGroupId');

    const effectiveGroupId = primaryGroupId ?? activeGroupIds?.[0];

    if (effectiveGroupId === undefined || effectiveGroupId === null) {
      const entity = event.entity;
      
      if (entity && this.isRlsScopedEntity(entity)) {
        throw new RlsSecurityViolationError(
          `RLS: Cannot insert tenant-scoped entity without active group context. ` +
          `User must belong to a group or provide X-Active-Group-Id header.`
        );
      }
      return;
    }

    const entity = event.entity;
    if (entity) {
      // SECURITY: Force-authoritative assignment of tenant columns
      // This prevents tenant spoofing - user cannot inject a different groupId
      
      // Check for tenant spoofing attempt
      if ('groupId' in entity && entity.groupId !== undefined && entity.groupId !== null) {
        if (!activeGroupIds.includes(entity.groupId)) {
          throw new RlsSecurityViolationError(
            `RLS: Tenant spoofing detected. User does not belong to group ${entity.groupId}. ` +
            `User's groups: [${activeGroupIds.join(', ')}]`
          );
        }
        // User passed a valid groupId they belong to - use it
        // (This is legitimate multi-group context switching)
      }
      
      // Force-assign tenant columns with user's active context
      if ('groupId' in entity) {
        entity.groupId = effectiveGroupId;
      }
      if ('customer_id' in entity) {
        // Check for spoofing on customer_id
        if (entity.customer_id !== undefined && entity.customer_id !== null) {
          if (entity.customer_id !== effectiveGroupId) {
            throw new RlsSecurityViolationError(
              `RLS: Tenant spoofing detected on customer_id. ` +
              `Attempted: ${entity.customer_id}, User's group: ${effectiveGroupId}`
            );
          }
        }
        entity.customer_id = effectiveGroupId;
      }
      if ('tenantId' in entity) {
        // Check for spoofing on tenantId
        if (entity.tenantId !== undefined && entity.tenantId !== null) {
          if (entity.tenantId !== effectiveGroupId) {
            throw new RlsSecurityViolationError(
              `RLS: Tenant spoofing detected on tenantId. ` +
              `Attempted: ${entity.tenantId}, User's group: ${effectiveGroupId}`
            );
          }
        }
        entity.tenantId = effectiveGroupId;
      }
      if ('organizationId' in entity) {
        // Check for spoofing on organizationId
        if (entity.organizationId !== undefined && entity.organizationId !== null) {
          if (entity.organizationId !== effectiveGroupId) {
            throw new RlsSecurityViolationError(
              `RLS: Tenant spoofing detected on organizationId. ` +
              `Attempted: ${entity.organizationId}, User's group: ${effectiveGroupId}`
            );
          }
        }
        entity.organizationId = effectiveGroupId;
      }
    }
  }

  private isRlsScopedEntity(entity: any): boolean {
    return RLS_SCOPED_ENTITIES.some(field => field in entity);
  }
}
