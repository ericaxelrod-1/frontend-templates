import { EventSubscriber, EntitySubscriberInterface, InsertEvent, DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Logger } from '@nestjs/common';

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

    if (effectiveGroupId !== undefined) {
      const entity = event.entity;
      if (entity) {
        if ('groupId' in entity && (entity.groupId === undefined || entity.groupId === null)) {
          entity.groupId = effectiveGroupId;
        }
        if ('customer_id' in entity && (entity.customer_id === undefined || entity.customer_id === null)) {
          entity.customer_id = effectiveGroupId;
        }
      }
    }
  }
}
