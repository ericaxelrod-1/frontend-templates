import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { UsersService } from '../../users/users.service';

@Injectable()
export class RlsContextGuard implements CanActivate {
  private readonly logger = new Logger(RlsContextGuard.name);

  constructor(
    private readonly cls: ClsService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      return true;
    }

    try {
      const groupIds = await this.usersService.getUserGroupIds(user.id);
      
      this.cls.set('activeGroupIds', groupIds);
      
      if (groupIds.length > 0) {
        this.cls.set('primaryGroupId', groupIds[0]);
      }

      this.logger.debug(`Set RLS context for user ${user.id}: groups=${groupIds.join(',')}`);
    } catch (error) {
      this.logger.error(`Failed to set RLS context: ${error.message}`);
    }

    return true;
  }
}
