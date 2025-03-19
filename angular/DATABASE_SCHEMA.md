# Angular Template Application - Database Schema Design

## Overview

This document outlines the database schema design for the Angular Template Application. The schema is designed to support:

1. User authentication and authorization
2. Role-based access control
3. User groups for sharing data
4. Migration path from SQLite to PostgreSQL

## Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    User     │       │    Role     │       │    Group    │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id          │       │ id          │       │ id          │
│ username    │       │ name        │       │ name        │
│ email       │       │ permissions │       │ description │
│ password    │       │ createdAt   │       │ createdBy   │
│ firstName   │       │ updatedAt   │       │ createdAt   │
│ lastName    │       └──────┬──────┘       │ updatedAt   │
│ roleId      │◄──────┘      │              └──────┬──────┘
│ createdAt   │              │                     │
│ updatedAt   │              │                     │
│ lastLogin   │              │                     │
└──────┬──────┘              │                     │
       │                     │                     │
       │                     │                     │
       │                     ▼                     │
       │           ┌─────────────────┐             │
       │           │   Permission    │             │
       │           ├─────────────────┤             │
       │           │ id              │             │
       │           │ name            │             │
       │           │ description     │             │
       │           │ createdAt       │             │
       │           │ updatedAt       │             │
       │           └─────────────────┘             │
       │                                           │
       ▼                                           ▼
┌─────────────────────────────────────────────────────┐
│                    UserGroup                        │
├─────────────────────────────────────────────────────┤
│ userId                                              │
│ groupId                                             │
│ isAdmin                                             │
│ joinedAt                                            │
└─────────────────────────────────────────────────────┘
```

## Tables Specification

### User Table

Stores user account information.

| Column     | Type         | Constraints                 | Description                        |
|------------|--------------|-----------------------------|------------------------------------|
| id         | INTEGER      | PRIMARY KEY, AUTOINCREMENT  | Unique identifier                  |
| username   | VARCHAR(50)  | NOT NULL, UNIQUE            | Username for login                 |
| email      | VARCHAR(100) | NOT NULL, UNIQUE            | Email address                      |
| password   | VARCHAR(255) | NOT NULL                    | Hashed password                    |
| firstName  | VARCHAR(50)  | NULL                        | User's first name                  |
| lastName   | VARCHAR(50)  | NULL                        | User's last name                   |
| roleId     | INTEGER      | NOT NULL, FOREIGN KEY       | Reference to Role                  |
| createdAt  | TIMESTAMP    | NOT NULL, DEFAULT NOW()     | Account creation timestamp         |
| updatedAt  | TIMESTAMP    | NOT NULL, DEFAULT NOW()     | Last update timestamp              |
| lastLogin  | TIMESTAMP    | NULL                        | Last login timestamp               |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (username)
- UNIQUE (email)
- INDEX (roleId)

### Role Table

Defines user roles and permissions.

| Column      | Type         | Constraints                | Description                        |
|-------------|--------------|----------------------------|------------------------------------|
| id          | INTEGER      | PRIMARY KEY, AUTOINCREMENT | Unique identifier                  |
| name        | VARCHAR(50)  | NOT NULL, UNIQUE           | Role name (e.g., Regular, Superuser, Superadmin) |
| permissions | JSON         | NOT NULL                   | Stored as JSON object with permissions |
| createdAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Creation timestamp                 |
| updatedAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Last update timestamp              |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (name)

### Group Table

Stores information about user groups.

| Column      | Type         | Constraints                | Description                        |
|-------------|--------------|----------------------------|------------------------------------|
| id          | INTEGER      | PRIMARY KEY, AUTOINCREMENT | Unique identifier                  |
| name        | VARCHAR(100) | NOT NULL                   | Group name                         |
| description | TEXT         | NULL                       | Group description                  |
| createdBy   | INTEGER      | NOT NULL, FOREIGN KEY      | Reference to User who created group |
| createdAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Creation timestamp                 |
| updatedAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Last update timestamp              |

Indexes:
- PRIMARY KEY (id)
- INDEX (createdBy)
- INDEX (name)

### UserGroup Table

Junction table for many-to-many relationship between users and groups.

| Column    | Type         | Constraints                           | Description                        |
|-----------|--------------|---------------------------------------|------------------------------------|
| userId    | INTEGER      | NOT NULL, FOREIGN KEY                 | Reference to User                  |
| groupId   | INTEGER      | NOT NULL, FOREIGN KEY                 | Reference to Group                 |
| isAdmin   | BOOLEAN      | NOT NULL, DEFAULT FALSE               | Whether user is admin in this group|
| joinedAt  | TIMESTAMP    | NOT NULL, DEFAULT NOW()               | When user joined the group         |

Indexes:
- PRIMARY KEY (userId, groupId)
- INDEX (userId)
- INDEX (groupId)

### Permission Table

Defines individual permissions that can be assigned to roles.

| Column      | Type         | Constraints                | Description                        |
|-------------|--------------|----------------------------|------------------------------------|
| id          | INTEGER      | PRIMARY KEY, AUTOINCREMENT | Unique identifier                  |
| name        | VARCHAR(50)  | NOT NULL, UNIQUE           | Permission name                    |
| description | TEXT         | NULL                       | Permission description             |
| createdAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Creation timestamp                 |
| updatedAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Last update timestamp              |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (name)

## Default Data

### Roles

```sql
INSERT INTO Role (name, permissions, createdAt, updatedAt) VALUES
('Regular', '{"canViewOwnProfile": true, "canJoinGroups": true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('Superuser', '{"canViewOwnProfile": true, "canJoinGroups": true, "canManageUsers": true, "canCreateGroups": true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('Superadmin', '{"canViewOwnProfile": true, "canJoinGroups": true, "canManageUsers": true, "canManageSuperusers": true, "canManageSuperadmins": true, "canCreateGroups": true, "canDeleteGroups": true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

### Permissions

```sql
INSERT INTO Permission (name, description, createdAt, updatedAt) VALUES
('canViewOwnProfile', 'Can view own profile', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('canJoinGroups', 'Can join groups', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('canManageUsers', 'Can manage regular users', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('canManageSuperusers', 'Can manage superusers', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('canManageSuperadmins', 'Can manage superadmins', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('canCreateGroups', 'Can create new groups', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('canDeleteGroups', 'Can delete groups', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

## TypeORM Entity Definitions

### User Entity

```typescript
// src/database/entities/user.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Role } from './role.entity';
import { UserGroup } from './user-group.entity';
import { Group } from './group.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true, length: 100 })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true, length: 50 })
  firstName: string;

  @Column({ nullable: true, length: 50 })
  lastName: string;

  @ManyToOne(() => Role, { eager: true })
  @JoinColumn({ name: 'roleId' })
  role: Role;

  @Column()
  roleId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true, type: 'datetime' })
  lastLogin: Date;

  @OneToMany(() => UserGroup, userGroup => userGroup.user)
  userGroups: UserGroup[];

  @OneToMany(() => Group, group => group.createdBy)
  createdGroups: Group[];
}
```

### Role Entity

```typescript
// src/database/entities/role.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  name: string;

  @Column({ type: 'simple-json' })
  permissions: {
    [key: string]: boolean;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => User, user => user.role)
  users: User[];
}
```

### Group Entity

```typescript
// src/database/entities/group.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';
import { UserGroup } from './user-group.entity';

@Entity()
export class Group {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdBy' })
  createdBy: User;

  @Column()
  createdById: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => UserGroup, userGroup => userGroup.group)
  userGroups: UserGroup[];
}
```

### UserGroup Entity

```typescript
// src/database/entities/user-group.entity.ts
import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';
import { Group } from './group.entity';

@Entity()
export class UserGroup {
  @PrimaryColumn()
  userId: number;

  @PrimaryColumn()
  groupId: number;

  @ManyToOne(() => User, user => user.userGroups)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Group, group => group.userGroups)
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column({ default: false })
  isAdmin: boolean;

  @CreateDateColumn()
  joinedAt: Date;
}
```

### Permission Entity

```typescript
// src/database/entities/permission.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

## Migration Path from SQLite to PostgreSQL

### SQLite Configuration (Development)

```typescript
// src/config/database.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User, Role, Group, UserGroup, Permission } from '../database/entities';

export const sqliteConfig: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: 'database.sqlite',
  entities: [User, Role, Group, UserGroup, Permission],
  synchronize: true, // Set to false in production
  logging: true,
};
```

### PostgreSQL Configuration (Production)

```typescript
// src/config/database.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User, Role, Group, UserGroup, Permission } from '../database/entities';

export const postgresConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'angular_template',
  entities: [User, Role, Group, UserGroup, Permission],
  synchronize: false, // Always false in production
  migrationsRun: true,
  migrations: ['dist/migrations/*.js'],
  logging: ['error'],
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
};
```

### Database Configuration Factory

```typescript
// src/config/database.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { sqliteConfig } from './sqlite.config';
import { postgresConfig } from './postgres.config';

export function getDatabaseConfig(): TypeOrmModuleOptions {
  const dbType = process.env.DB_TYPE || 'sqlite';
  
  switch (dbType) {
    case 'postgres':
      return postgresConfig;
    case 'sqlite':
    default:
      return sqliteConfig;
  }
}
```

### Migration Generation

To generate migrations when switching from SQLite to PostgreSQL:

```bash
# Generate a migration file
npm run typeorm migration:generate -- -n MigrateToPostgres

# Run the migration
npm run typeorm migration:run
```

## Best Practices

1. **Use UUID for Primary Keys in Production**
   - More secure and allows for distributed ID generation
   - Use `@Column({ type: 'uuid', primary: true, generated: 'uuid' })` in PostgreSQL

2. **Soft Deletes**
   - Add `isDeleted` and `deletedAt` columns to entities
   - Filter deleted records in queries

3. **Indexes for Performance**
   - Create indexes on columns frequently used in WHERE clauses
   - Add indexes on foreign keys

4. **Transactions for Data Integrity**
   - Use TypeORM transactions when performing multiple related operations

5. **Data Validation**
   - Use class-validator for input validation
   - Add constraints at the database level

6. **Optimistic Locking**
   - Add version column to prevent concurrent updates
   - `@VersionColumn() version: number;`

7. **Audit Trails**
   - Track who created/updated records
   - Consider a separate audit log table for sensitive operations 