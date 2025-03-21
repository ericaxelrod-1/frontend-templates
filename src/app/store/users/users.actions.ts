import { User } from '../../models/user.model';
import { UserCreateRequest, UserUpdateRequest, UsersFilter } from '../../models/users.model';

export namespace UsersActions {
  export class LoadUsers {
    static readonly type = '[Users] Load Users';
    constructor(public payload?: UsersFilter) {}
  }

  export class LoadUser {
    static readonly type = '[Users] Load User';
    constructor(public id: number) {}
  }

  export class CreateUser {
    static readonly type = '[Users] Create User';
    constructor(public payload: UserCreateRequest) {}
  }

  export class UpdateUser {
    static readonly type = '[Users] Update User';
    constructor(public payload: UserUpdateRequest) {}
  }

  export class DeleteUser {
    static readonly type = '[Users] Delete User';
    constructor(public id: number) {}
  }

  export class SetSelectedUser {
    static readonly type = '[Users] Set Selected User';
    constructor(public payload: User | null) {}
  }
} 