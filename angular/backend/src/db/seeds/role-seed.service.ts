import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, SystemRoles } from '../../modules/users/entities/role.entity';
import { Logger } from '@nestjs/common';

@Injectable()
export class RoleSeedService {
  private readonly logger = new Logger(RoleSeedService.name);

  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  async seed() {
    this.logger.log('Starting role seed...');

    // Remove redundant roles (case-insensitive, ignoring spaces)
    const canonicalNames = Object.values(SystemRoles).map((n) =>
      n.toLowerCase().replace(/\s+/g, ''),
    );
    const redundantNames = ['user', 'admin', 'superuser', 'superadmin'];
    const roles = await this.roleRepository.find();
    for (const role of roles) {
      const normalized = role.name.toLowerCase().replace(/\s+/g, '');
      if (
        redundantNames.includes(normalized) &&
        !canonicalNames.includes(role.name.toLowerCase().replace(/\s+/g, ''))
      ) {
        await this.roleRepository.remove(role);
        this.logger.log(`Deleted redundant role: ${role.name}`);
      }
    }

    // Create system roles
    await this.createSystemRole(
      SystemRoles.SUPERADMIN,
      'Super Admin with full system access',
      100,
      true,
    );
    await this.createSystemRole(
      SystemRoles.ADMIN,
      'Administrator with management access',
      50,
    );
    await this.createSystemRole(
      SystemRoles.USER,
      'Regular user with standard access',
      10,
      false,
      true,
    );

    this.logger.log('Role seed completed successfully');
  }

  private async createSystemRole(
    name: string,
    description: string,
    priority: number,
    isSystemRole = true,
    isDefault = false,
  ): Promise<Role> {
    // Check if role already exists
    let role = await this.roleRepository.findOne({ where: { name } });

    if (!role) {
      role = this.roleRepository.create({
        name,
        description,
        isSystemRole,
        isDefault,
        priority,
      });

      role = await this.roleRepository.save(role);
      this.logger.log(`Created role: ${role.name}`);
    } else {
      this.logger.log(`Role already exists: ${role.name}`);
    }

    return role;
  }
}
