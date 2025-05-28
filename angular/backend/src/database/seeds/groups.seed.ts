import { DataSource } from 'typeorm';
import { Group } from '../../modules/users/entities/group.entity';
import { User } from '../../modules/users/entities/user.entity';
import { UserGroup } from '../../modules/users/entities/user-group.entity';

export async function seedGroups(dataSource: DataSource) {
  const groupRepository = dataSource.getRepository(Group);
  const userRepository = dataSource.getRepository(User);
  const userGroupRepository = dataSource.getRepository(UserGroup);

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

    // Create user-group relationships
    if (groupData.name === 'Administrators') {
      // Add admin to Administrators group
      await createUserGroupIfNotExists(userGroupRepository, admin, group, true);

      // Add manager to Administrators group (not as admin)
      await createUserGroupIfNotExists(
        userGroupRepository,
        manager,
        group,
        false,
      );
    } else if (groupData.name === 'Project Managers') {
      // Add manager to Project Managers group as admin
      await createUserGroupIfNotExists(
        userGroupRepository,
        manager,
        group,
        true,
      );

      // Add regular user to Project Managers group
      await createUserGroupIfNotExists(
        userGroupRepository,
        regularUser,
        group,
        false,
      );
    } else if (groupData.name === 'Regular Users') {
      // Add regular user to Regular Users group
      await createUserGroupIfNotExists(
        userGroupRepository,
        regularUser,
        group,
        false,
      );
    }
  }
}

async function createUserGroupIfNotExists(
  repository: any,
  user: User,
  group: Group,
  isAdmin: boolean,
) {
  const existingUserGroup = await repository.findOne({
    where: {
      user: { id: user.id },
      group: { id: group.id },
    },
  });

  if (!existingUserGroup) {
    const userGroup = repository.create({
      user,
      group,
      isAdmin,
    });
    await repository.save(userGroup);
    console.log(
      `Added user ${user.email} to group ${group.name} (${isAdmin ? 'admin' : 'member'})`,
    );
  } else {
    console.log(`User ${user.email} already in group ${group.name}`);
  }
}
