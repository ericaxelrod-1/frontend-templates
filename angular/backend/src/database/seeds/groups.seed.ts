import { DataSource } from 'typeorm';
import { Group } from '../../modules/permissions/entities/group.entity';
import { User } from '../../modules/users/entities/user.entity';

export async function seedGroups(dataSource: DataSource) {
  const groupRepository = dataSource.getRepository(Group);
  const userRepository = dataSource.getRepository(User);

  // Get existing users
  const admin = await userRepository.findOne({
    where: { email: 'admin@example.com' },
  });
  const manager = await userRepository.findOne({
    where: { email: 'manager@example.com' },
  });
  const regularUser = await userRepository.findOne({
    where: { email: 'user@example.com' },
  });

  if (!admin || !manager || !regularUser) {
    console.error('Required users not found. Please run user seeding first.');
    return;
  }

  // Define default groups
  const defaultGroups = [
    {
      name: 'Administrators',
      description: 'Group for system administrators',
      owner: admin,
      settings: JSON.stringify({
        canShareData: true,
        canShareAssets: true,
        maxMembers: 10,
      }),
    },
    {
      name: 'Project Managers',
      description: 'Group for project managers',
      owner: manager,
      settings: JSON.stringify({
        canShareData: true,
        canShareAssets: true,
        maxMembers: 20,
      }),
    },
    {
      name: 'Regular Users',
      description: 'Group for regular users',
      owner: manager,
      settings: JSON.stringify({
        canShareData: false,
        canShareAssets: true,
        maxMembers: 50,
      }),
    },
  ];

  // Seed groups
  for (const groupData of defaultGroups) {
    const existingGroup = await groupRepository.findOne({
      where: { name: groupData.name },
    });

    let group: Group;
    if (!existingGroup) {
      group = groupRepository.create(groupData);
      await groupRepository.save(group);
      console.log(`Created group: ${groupData.name}`);
    } else {
      group = existingGroup;
      console.log(`Group already exists: ${groupData.name}`);
    }

    // Create user-group relationships using many-to-many
    if (groupData.name === 'Administrators') {
      // Add admin to Administrators group
      await addUserToGroupIfNotExists(userRepository, admin, group);

      // Add manager to Administrators group
      await addUserToGroupIfNotExists(userRepository, manager, group);
    } else if (groupData.name === 'Project Managers') {
      // Add manager to Project Managers group
      await addUserToGroupIfNotExists(userRepository, manager, group);

      // Add regular user to Project Managers group
      await addUserToGroupIfNotExists(userRepository, regularUser, group);
    } else if (groupData.name === 'Regular Users') {
      // Add regular user to Regular Users group
      await addUserToGroupIfNotExists(userRepository, regularUser, group);
    }
  }
}

async function addUserToGroupIfNotExists(
  userRepository: any,
  user: User,
  group: Group,
) {
  // Load user with groups to check if already a member
  const userWithGroups = await userRepository.findOne({
    where: { id: user.id },
    relations: ['groups'],
  });

  if (!userWithGroups) {
    console.error(`User ${user.email} not found`);
    return;
  }

  // Check if user is already in the group
  const isAlreadyMember = userWithGroups.groups.some((g) => g.id === group.id);

  if (!isAlreadyMember) {
    // Add group to user's groups
    userWithGroups.groups.push(group);
    await userRepository.save(userWithGroups);
    console.log(`Added user ${user.email} to group ${group.name}`);
  } else {
    console.log(`User ${user.email} already in group ${group.name}`);
  }
}
