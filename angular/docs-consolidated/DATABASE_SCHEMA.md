# Database Schema Documentation

## Overview

This document outlines the database schema design for the Angular application with dynamic permissions. The schema is designed to support:

1. User authentication and authorization
2. Role-based access control
3. User groups for sharing data
4. Dynamic permission management for UI components, routes, and API endpoints
5. Login attempt tracking and security monitoring
6. Migration path from SQLite to PostgreSQL

## Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    User     │       │    Role     │       │    Group    │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id          │       │ id          │       │ id          │
│ username    │       │ name        │       │ name        │
│ email       │       │ description │       │ description │
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
       │           │ resourceName    │             │
       │           │ actionName      │             │
       │           │ name            │             │
       │           │ description     │             │
       │           │ createdAt       │             │
       │           │ updatedAt       │             │
       │           └─────┬───────────┘             │
       │                 │                         │
       │                 │                         │
       │                 ▼                         │
       │    ┌────────────┬────────────┐            │
       │    │            │            │            │
       │    ▼            ▼            ▼            ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│LoginAttempt │ │ UiComponent │ │FrontendRoute│ │ UserGroup   │
├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤
│ id          │ │ id          │ │ id          │ │ userId      │
│ ipAddress   │ │ selector    │ │ path        │ │ groupId     │
│ userAgent   │ │ description │ │ description │ │ isAdmin     │
│ email       │ │ filePath    │ │ component   │ │ joinedAt    │
│ status      │ │ overridePerms│ │ overridePerms│ └─────────────┘
│ userId      │ │ lastSynced   │ │ lastSynced   │ 
│ failureReason│ └─────┬───────┘ └─────┬────────┘
│ metadata     │       │               │
│ createdAt    │       │               │
└─────────────┘        │               │
                       │               │
                       ▼               ▼
               ┌─────────────┐ ┌─────────────────┐
               │ ApiEndpoint │ │ role_permissions │
               ├─────────────┤ ├─────────────────┤
               │ id          │ │ role_id         │
               │ method      │ │ permission_id   │
               │ path        │ └─────────────────┘
               │ description │
               │ controller  │ ┌─────────────────┐
               │ handler     │ │group_permissions│
               │ overridePerms│ ├─────────────────┤
               │ lastSynced   │ │ group_id        │
               └─────────────┘ │ permission_id    │
                               └─────────────────┘
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

Defines user roles for authorization.

| Column      | Type         | Constraints                | Description                        |
|-------------|--------------|----------------------------|------------------------------------|
| id          | UUID         | PRIMARY KEY                | Unique identifier                  |
| name        | VARCHAR(50)  | NOT NULL, UNIQUE           | Role name (e.g., USER, ADMIN, SUPERADMIN) |
| description | TEXT         | NULL                       | Role description                   |
| createdAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Creation timestamp                 |
| updatedAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Last update timestamp              |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (name)

### Group Table

Stores information about user groups.

| Column      | Type         | Constraints                | Description                        |
|-------------|--------------|----------------------------|------------------------------------|
| id          | UUID         | PRIMARY KEY                | Unique identifier                  |
| name        | VARCHAR(100) | NOT NULL, UNIQUE           | Group name                         |
| description | TEXT         | NULL                       | Group description                  |
| ownerId     | INTEGER      | FOREIGN KEY                | Reference to User who created group |
| createdAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Creation timestamp                 |
| updatedAt   | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Last update timestamp              |

Indexes:
- PRIMARY KEY (id)
- INDEX (ownerId)
- UNIQUE (name)

### UserGroup Table

Junction table for many-to-many relationship between users and groups.

| Column    | Type         | Constraints                           | Description                        |
|-----------|--------------|---------------------------------------|------------------------------------|
| userId    | INTEGER      | NOT NULL, FOREIGN KEY                 | Reference to User                  |
| groupId   | UUID         | NOT NULL, FOREIGN KEY                 | Reference to Group                 |
| isAdmin   | BOOLEAN      | NOT NULL, DEFAULT FALSE               | Whether user is admin in this group|
| joinedAt  | TIMESTAMP    | NOT NULL, DEFAULT NOW()               | When user joined the group         |

Indexes:
- PRIMARY KEY (userId, groupId)
- INDEX (userId)
- INDEX (groupId)

### Permission Table

Defines available permissions for the dynamic access control system.

| Column        | Type         | Constraints                | Description                            |
|---------------|--------------|----------------------------|----------------------------------------|
| id            | UUID         | PRIMARY KEY                | Unique identifier                      |
| resourceName  | VARCHAR(50)  | NOT NULL                   | Name of resource (users, dashboard, etc.) |
| actionName    | VARCHAR(50)  | NOT NULL                   | Name of action (view, edit, etc.)      |
| name          | VARCHAR(100) | NOT NULL, UNIQUE           | Combined resource:action format        |
| description   | TEXT         | NULL                       | Permission description                 |
| createdAt     | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Creation timestamp                     |
| updatedAt     | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | Last update timestamp                  |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (resourceName, actionName)
- UNIQUE (name)

### Role Permissions Table

Junction table for many-to-many relationship between roles and permissions.

| Column        | Type         | Constraints                 | Description                        |
|---------------|--------------|-----------------------------|------------------------------------|
| role_id       | UUID         | NOT NULL, FOREIGN KEY       | Reference to Role                  |
| permission_id | UUID         | NOT NULL, FOREIGN KEY       | Reference to Permission            |

Indexes:
- PRIMARY KEY (role_id, permission_id)
- INDEX (role_id)
- INDEX (permission_id)

### Group Permissions Table

Junction table for many-to-many relationship between groups and permissions.

| Column        | Type         | Constraints                 | Description                        |
|---------------|--------------|-----------------------------|------------------------------------|
| group_id      | UUID         | NOT NULL, FOREIGN KEY       | Reference to Group                 |
| permission_id | UUID         | NOT NULL, FOREIGN KEY       | Reference to Permission            |

Indexes:
- PRIMARY KEY (group_id, permission_id)
- INDEX (group_id)
- INDEX (permission_id)

### UI Component Table

Stores information about UI components that require permissions.

| Column             | Type         | Constraints                 | Description                                 |
|--------------------|--------------|------------------------------|---------------------------------------------|
| id                 | UUID         | PRIMARY KEY                  | Unique identifier                           |
| selector           | VARCHAR(100) | NOT NULL, UNIQUE             | Component selector/name                     |
| description        | TEXT         | NULL                         | Component description                       |
| filePath           | VARCHAR(255) | NULL                         | Location in the codebase                    |
| overridePermissions| BOOLEAN      | NOT NULL, DEFAULT FALSE      | Flag to override inherited permissions      |
| lastSynced         | TIMESTAMP    | NULL                         | Timestamp of last component scan            |
| createdAt          | TIMESTAMP    | NOT NULL, DEFAULT NOW()      | Creation timestamp                          |
| updatedAt          | TIMESTAMP    | NOT NULL, DEFAULT NOW()      | Last update timestamp                       |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (selector)

### UI Component Permissions Table

Junction table for many-to-many relationship between UI components and permissions.

| Column        | Type         | Constraints                 | Description                        |
|---------------|--------------|-----------------------------|------------------------------------|
| component_id  | UUID         | NOT NULL, FOREIGN KEY       | Reference to UI Component          |
| permission_id | UUID         | NOT NULL, FOREIGN KEY       | Reference to Permission            |

Indexes:
- PRIMARY KEY (component_id, permission_id)
- INDEX (component_id)
- INDEX (permission_id)

### Frontend Route Table

Stores information about frontend routes that require permissions.

| Column             | Type         | Constraints                 | Description                               |
|--------------------|--------------|------------------------------|-------------------------------------------|
| id                 | UUID         | PRIMARY KEY                  | Unique identifier                         |
| path               | VARCHAR(255) | NOT NULL, UNIQUE             | Route path                                |
| description        | TEXT         | NULL                         | Route description                         |
| component          | VARCHAR(100) | NULL                         | Associated component name                 |
| overridePermissions| BOOLEAN      | NOT NULL, DEFAULT FALSE      | Flag to override inherited permissions    |
| lastSynced         | TIMESTAMP    | NULL                         | Timestamp of last route scan              |
| createdAt          | TIMESTAMP    | NOT NULL, DEFAULT NOW()      | Creation timestamp                        |
| updatedAt          | TIMESTAMP    | NOT NULL, DEFAULT NOW()      | Last update timestamp                     |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (path)

### Frontend Route Permissions Table

Junction table for many-to-many relationship between frontend routes and permissions.

| Column        | Type         | Constraints                 | Description                        |
|---------------|--------------|-----------------------------|------------------------------------|
| route_id      | UUID         | NOT NULL, FOREIGN KEY       | Reference to Frontend Route        |
| permission_id | UUID         | NOT NULL, FOREIGN KEY       | Reference to Permission            |

Indexes:
- PRIMARY KEY (route_id, permission_id)
- INDEX (route_id)
- INDEX (permission_id)

### API Endpoint Table

Stores information about API endpoints that require permissions.

| Column             | Type         | Constraints                 | Description                               |
|--------------------|--------------|------------------------------|-------------------------------------------|
| id                 | UUID         | PRIMARY KEY                  | Unique identifier                         |
| method             | VARCHAR(20)  | NOT NULL                     | HTTP method (GET, POST, etc.)             |
| path               | VARCHAR(255) | NOT NULL                     | API endpoint path                         |
| description        | TEXT         | NULL                         | Endpoint description                      |
| controllerName     | VARCHAR(100) | NULL                         | Controller class name                     |
| handlerName        | VARCHAR(100) | NULL                         | Handler method name                       |
| overridePermissions| BOOLEAN      | NOT NULL, DEFAULT FALSE      | Flag to override inherited permissions    |
| lastSynced         | TIMESTAMP    | NULL                         | Timestamp of last endpoint scan           |
| createdAt          | TIMESTAMP    | NOT NULL, DEFAULT NOW()      | Creation timestamp                        |
| updatedAt          | TIMESTAMP    | NOT NULL, DEFAULT NOW()      | Last update timestamp                     |

Indexes:
- PRIMARY KEY (id)
- UNIQUE (method, path)

### API Endpoint Permissions Table

Junction table for many-to-many relationship between API endpoints and permissions.

| Column        | Type         | Constraints                 | Description                        |
|---------------|--------------|-----------------------------|------------------------------------|
| endpoint_id   | UUID         | NOT NULL, FOREIGN KEY       | Reference to API Endpoint          |
| permission_id | UUID         | NOT NULL, FOREIGN KEY       | Reference to Permission            |

Indexes:
- PRIMARY KEY (endpoint_id, permission_id)
- INDEX (endpoint_id)
- INDEX (permission_id)

### Login Attempt Table

Stores information about login attempts for security monitoring.

| Column        | Type         | Constraints                | Description                          |
|---------------|--------------|----------------------------|--------------------------------------|
| id            | INTEGER      | PRIMARY KEY, AUTOINCREMENT | Unique identifier                    |
| ipAddress     | TEXT         | NOT NULL                   | IP address of the login attempt      |
| userAgent     | TEXT         | NOT NULL                   | Browser/client user agent            |
| email         | TEXT         | NULL                       | Email used in the login attempt      |
| status        | TEXT         | NOT NULL, DEFAULT 'failed' | Status: success, failed, blocked, etc.|
| userId        | INTEGER      | NULL                       | Associated user ID (if valid user)   |
| failureReason | TEXT         | NULL                       | Reason for failed login              |
| metadata      | TEXT         | NULL                       | Additional JSON metadata             |
| createdAt     | TIMESTAMP    | NOT NULL, DEFAULT NOW()    | When the login attempt occurred      |

Indexes:
- PRIMARY KEY (id)
- INDEX (ipAddress)
- INDEX (email)
- INDEX (status)
- INDEX (createdAt)

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

For more detailed entity definitions and database configuration, see the [Architecture Documentation](ARCHITECTURE.md#database-architecture).

## Migration Path from SQLite to PostgreSQL

### SQLite Configuration (Development)

```typescript
// src/config/database.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User, Role, Group, UserGroup, Permission, UiComponent, FrontendRoute, ApiEndpoint, LoginAttempt } from '../database/entities';

export const sqliteConfig: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: 'database.sqlite',
  entities: [User, Role, Group, UserGroup, Permission, UiComponent, FrontendRoute, ApiEndpoint, LoginAttempt],
  synchronize: true, // Set to false in production
  logging: true,
};
```

### PostgreSQL Configuration (Production)

```typescript
// src/config/database.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User, Role, Group, UserGroup, Permission, UiComponent, FrontendRoute, ApiEndpoint, LoginAttempt } from '../database/entities';

export const postgresConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'angular_template',
  entities: [User, Role, Group, UserGroup, Permission, UiComponent, FrontendRoute, ApiEndpoint, LoginAttempt],
  synchronize: false, // Always false in production
  migrationsRun: true,
  migrations: ['dist/migrations/*.js'],
  logging: ['error'],
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
};
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

For more information about working with the database, see the [Database Management section](DEVELOPMENT.md#database-management) in the Development Guide.
