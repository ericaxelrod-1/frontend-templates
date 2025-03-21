import { Group } from '../../models/group.model';
import { GroupCreateRequest, GroupMembershipRequest, GroupsFilter, GroupUpdateRequest } from '../../models/groups.model';

export namespace GroupsActions {
  export class LoadGroups {
    static readonly type = '[Groups] Load Groups';
    constructor(public payload?: GroupsFilter) {}
  }

  export class LoadGroup {
    static readonly type = '[Groups] Load Group';
    constructor(public id: number) {}
  }

  export class CreateGroup {
    static readonly type = '[Groups] Create Group';
    constructor(public payload: GroupCreateRequest) {}
  }

  export class UpdateGroup {
    static readonly type = '[Groups] Update Group';
    constructor(public payload: GroupUpdateRequest) {}
  }

  export class DeleteGroup {
    static readonly type = '[Groups] Delete Group';
    constructor(public id: number) {}
  }

  export class AddMember {
    static readonly type = '[Groups] Add Member';
    constructor(public payload: GroupMembershipRequest) {}
  }

  export class RemoveMember {
    static readonly type = '[Groups] Remove Member';
    constructor(public groupId: number, public userId: number) {}
  }

  export class SetSelectedGroup {
    static readonly type = '[Groups] Set Selected Group';
    constructor(public payload: Group | null) {}
  }
} 