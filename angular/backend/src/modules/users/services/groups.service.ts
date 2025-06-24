import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../../permissions/services/permissions.service';
import { User } from '../entities/user.entity';
import { Group } from '../../permissions/entities/group.entity';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    private readonly permissionsService: PermissionsService,
  ) {}

  async delete(id: number, user: User): Promise<void> {
    const group = await this.findById(id);

    // Check if user has permission to delete groups
    const hasPermission = await this.permissionsService.checkUserPermission(
      user.id,
      'groups',
      'delete',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to delete groups',
      );
    }

    await this.groupRepository.remove(group);
  }

  async updateSettings(id: number, settings: any, user: User): Promise<Group> {
    const group = await this.findById(id);

    // Check if user has permission to update group settings
    const hasPermission = await this.permissionsService.checkUserPermission(
      user.id,
      'groups',
      'update',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to update group settings',
      );
    }

    group.settings = settings;
    return this.groupRepository.save(group);
  }

  async findById(id: number): Promise<Group> {
    const group = await this.groupRepository.findOne({
      where: { id },
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }

    return group;
  }
}
