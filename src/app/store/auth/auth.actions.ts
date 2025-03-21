import { LoginRequest, RegisterRequest } from '../../models/auth.model';

export namespace AuthActions {
  export class Login {
    static readonly type = '[Auth] Login';
    constructor(public payload: LoginRequest) {}
  }

  export class Register {
    static readonly type = '[Auth] Register';
    constructor(public payload: RegisterRequest) {}
  }

  export class Logout {
    static readonly type = '[Auth] Logout';
  }

  export class LoadUser {
    static readonly type = '[Auth] Load User';
  }
} 