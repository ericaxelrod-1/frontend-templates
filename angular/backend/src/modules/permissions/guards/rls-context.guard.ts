import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  BadRequestException,
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

      const activeGroupIdHeader = request.headers['x-active-group-id'];
      const method = request.method?.toUpperCase();
      const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(method);

      if (activeGroupIdHeader !== undefined) {
        const activeGroupId = parseInt(activeGroupIdHeader, 10);

        if (isNaN(activeGroupId)) {
          throw new BadRequestException(
            'X-Active-Group-Id header must be a valid number',
          );
        }

        if (!groupIds.includes(activeGroupId)) {
          throw new BadRequestException(
            `X-Active-Group-Id ${activeGroupId} is not one of the user's groups: [${groupIds.join(', ')}]`,
          );
        }

        this.cls.set('primaryGroupId', activeGroupId);
        this.logger.debug(
          `Set RLS context for user ${user.id}: activeGroupId=${activeGroupId} from header`,
        );
      } else if (groupIds.length > 1 && !isReadOnly) {
        throw new BadRequestException(
          `User belongs to multiple groups [${groupIds.join(', ')}]. ` +
            `X-Active-Group-Id header is required to specify the active context for write operations.`,
        );
      } else if (groupIds.length === 1) {
        this.cls.set('primaryGroupId', groupIds[0]);
        this.logger.debug(
          `Set RLS context for user ${user.id}: single group=${groupIds[0]}`,
        );
      } else {
        this.cls.set('primaryGroupId', null);
        this.logger.debug(`Set RLS context for user ${user.id}: no groups`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to set RLS context: ${error.message}`);
    }

    return true;
  }
}
