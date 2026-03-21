import { EventSubscriber, EntitySubscriberInterface, InsertEvent, DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Injectable } from '@nestjs/common';

@Injectable()
@EventSubscriber()
export class RlsInsertSubscriber implements EntitySubscriberInterface {
  constructor(
    private readonly cls: ClsService,
    dataSource: DataSource
  ) {
    dataSource.subscribers.push(this);
  }

  beforeInsert(event: InsertEvent<any>) {
    if (this.cls.get('__rlsBypass')) {
      return;
    }

    const activeGroupIds = this.cls.get('activeGroupIds');
    const primaryGroupId = this.cls.get('primaryGroupId');

    // Use primaryGroupId if set, otherwise fall back to first activeGroupId
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
