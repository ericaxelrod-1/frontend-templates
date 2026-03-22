import { EventSubscriber, EntitySubscriberInterface, InsertEvent, DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Logger } from '@nestjs/common';

const RLS_SCOPED_ENTITIES = ['groupId', 'customer_id', 'tenantId', 'organizationId'];

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

    const activeGroupIds = this.cls.get('activeGroupIds');
    const primaryGroupId = this.cls.get('primaryGroupId');

    const effectiveGroupId = primaryGroupId ?? activeGroupIds?.[0];

    if (effectiveGroupId === undefined || effectiveGroupId === null) {
      const entity = event.entity;
      
      if (entity && this.isRlsScopedEntity(entity)) {
        throw new Error(
          `RLS: Cannot insert tenant-scoped entity without active group context. ` +
          `User must belong to a group or provide X-Active-Group-Id header.`
        );
      }
      return;
    }

    const entity = event.entity;
    if (entity) {
      if ('groupId' in entity && (entity.groupId === undefined || entity.groupId === null)) {
        entity.groupId = effectiveGroupId;
      }
      if ('customer_id' in entity && (entity.customer_id === undefined || entity.customer_id === null)) {
        entity.customer_id = effectiveGroupId;
      }
      if ('tenantId' in entity && (entity.tenantId === undefined || entity.tenantId === null)) {
        entity.tenantId = effectiveGroupId;
      }
      if ('organizationId' in entity && (entity.organizationId === undefined || entity.organizationId === null)) {
        entity.organizationId = effectiveGroupId;
      }
    }
  }

  private isRlsScopedEntity(entity: any): boolean {
    return RLS_SCOPED_ENTITIES.some(field => field in entity);
  }
}
