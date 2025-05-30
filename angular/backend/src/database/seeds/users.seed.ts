import { DataSource } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { Role, SystemRoles } from '../../modules/users/entities/role.entity';
import * as bcrypt from 'bcrypt';

export async function seedUsers(dataSource: DataSource) {
  const userRepository = dataSource.getRepository(User);
  const roleRepository = dataSource.getRepository(Role);

  // Get existing roles
  const regularRole = await roleRepository.findOne({
    where: { name: SystemRoles.USER },
  });
  const superuserRole = await roleRepository.findOne({
    where: { name: SystemRoles.SUPERUSER },
  });
  const superadminRole = await roleRepository.findOne({
    where: { name: SystemRoles.SUPERADMIN },
  });

  if (!regularRole || !superuserRole || !superadminRole) {
    console.error('Required roles not found. Please run role seeding first.');
    return;
  }

  // Define default users
  const defaultUsers = [
    {
      username: 'admin',
      email: 'admin@example.com',
      password: await bcrypt.hash('Admin123!', 10),
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
      isEmailVerified: true,
      roles: [superadminRole],
      preferences: {
        theme: 'dark',
        language: 'en',
        notifications: {
          email: true,
          push: true,
        },
      },
    },
    {
      username: 'manager',
      email: 'manager@example.com',
      password: await bcrypt.hash('Manager123!', 10),
      firstName: 'Super',
      lastName: 'User',
      isActive: true,
      isEmailVerified: true,
      roles: [superuserRole],
      preferences: {
        theme: 'light',
        language: 'en',
        notifications: {
          email: true,
          push: false,
        },
      },
    },
    {
      username: 'user',
      email: 'user@example.com',
      password: await bcrypt.hash('User123!', 10),
      firstName: 'Regular',
      lastName: 'User',
      isActive: true,
      isEmailVerified: true,
      roles: [regularRole],
      preferences: {
        theme: 'system',
        language: 'en',
        notifications: {
          email: false,
          push: true,
        },
      },
    },
  ];

  // Seed users
  for (const userData of defaultUsers) {
    const existingUser = await userRepository.findOne({
      where: { email: userData.email },
      relations: ['roles'],
    });

    if (!existingUser) {
      const user = userRepository.create(userData);
      await userRepository.save(user);
      console.log(`Created user: ${userData.email}`);
    } else {
      // Ensure the user has the correct role
      const hasCorrectRole =
        Array.isArray(existingUser.roles) &&
        existingUser.roles.length === 1 &&
        existingUser.roles[0].id === userData.roles[0].id;
      if (!hasCorrectRole) {
        existingUser.roles = userData.roles;
        await userRepository.save(existingUser);
        console.log(`Updated roles for user: ${userData.email}`);
      } else {
        console.log(`User already exists: ${userData.email}`);
      }
    }
  }
}
