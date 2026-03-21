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
    if (activeGroupIds && activeGroupIds.length > 0) {
      // Very basic auto-assignment logic.
      // In a real app, you might want to look up the specific column name
      // or rely on the developer to assign it explicitly.
      // If the entity has a groupId, group_id, or customer_id, we can auto-populate it.
      const entity = event.entity;
      if (entity) {
         if ('groupId' in entity && !entity.groupId) entity.groupId = activeGroupIds[0];
         if ('customer_id' in entity && !entity.customer_id) entity.customer_id = activeGroupIds[0];
      }
    }
  }
}
