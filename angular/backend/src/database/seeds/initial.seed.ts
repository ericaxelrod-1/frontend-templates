import { DataSource } from 'typeorm';
import { Role, SystemRoles } from '../../modules/users/entities/role.entity';

export async function seedDatabase(dataSource: DataSource) {
  const roleRepository = dataSource.getRepository(Role);

  // Remove redundant roles (case-insensitive, ignoring spaces)
  const canonicalNames = Object.values(SystemRoles).map(n => n.toLowerCase().replace(/\s+/g, ''));
  const redundantNames = ['user', 'admin', 'superuser', 'superadmin'];
  const allRoles = await roleRepository.find();
  for (const role of allRoles) {
    const normalized = role.name.toLowerCase().replace(/\s+/g, '');
    if (
      redundantNames.includes(normalized) &&
      !canonicalNames.includes(role.name.toLowerCase().replace(/\s+/g, ''))
    ) {
      await roleRepository.remove(role);
      console.log(`Deleted redundant role: ${role.name}`);
    }
  }

  // Create default roles if they don't exist
  const roles = [
    {
      name: SystemRoles.USER,
      isSystemRole: true,
      description: 'Regular user with basic permissions',
      permissions: ['users:view:self', 'groups:view', 'content:view'],
    },
    {
      name: SystemRoles.ADMIN,
      isSystemRole: true,
      description: 'Administrator with elevated permissions',
      permissions: [
        'users:create',
        'users:delete',
        'users:edit',
        'users:view:all',
        'groups:manage',
        'content:manage',
      ],
    },
    {
      name: SystemRoles.SUPERUSER,
      isSystemRole: true,
      description: 'Superuser with advanced permissions',
      permissions: [
        'users:create',
        'users:delete',
        'users:edit',
        'users:view:all',
        'users:emulate',
        'groups:manage',
        'content:manage',
        'system:manage',
      ],
    },
    {
      name: SystemRoles.SUPERADMIN,
      isSystemRole: true,
      description: 'Superadmin with full system access',
      permissions: [
        'users:create',
        'users:delete',
        'users:edit',
        'users:view:all',
        'users:emulate',
        'groups:manage',
        'roles:manage',
        'content:manage',
        'system:manage',
        'system:admin',
      ],
    },
  ];

  for (const roleData of roles) {
    const existingRole = await roleRepository.findOne({
      where: { name: roleData.name },
    });

    if (!existingRole) {
      const role = roleRepository.create(roleData);
      await roleRepository.save(role);
      console.log(`Created role: ${roleData.name}`);
    } else {
      // Update system role flag if needed
      if (existingRole.isSystemRole !== true) {
        existingRole.isSystemRole = true;
        await roleRepository.save(existingRole);
        console.log(`Updated role ${roleData.name} to system role`);
      }
    }
  }
}
