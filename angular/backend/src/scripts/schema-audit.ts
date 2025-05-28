import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { verbose } from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Import ALL related entities for Permission
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Action } from '../modules/permissions/entities/action.entity';
import { UiComponent } from '../modules/permissions/entities/ui-component.entity';
import { FrontendRoute } from '../modules/permissions/entities/frontend-route.entity';
import { ApiEndpoint } from '../modules/permissions/entities/api-endpoint.entity';
// Add other entities to audit here
// import { User } from '../modules/users/entities/user.entity';

interface DbColumnInfo {
  name: string;
  type: string;
  notnull: number; // 0 or 1
  pk: number; // 0 or 1
}

interface EntityColumnInfo {
  databaseName: string;
  propertyName: string;
  type: string;
  isNullable: boolean;
  isPrimary: boolean;
  length?: number;
}

async function runSchemaAudit() {
  console.log('Starting Schema Audit (TypeORM Metadata Method)...');

  // --- Database Connection (SQLite) ---
  const dbPath = path.resolve(__dirname, '..', '..', 'db.sqlite'); // Use canonical db path
  console.log(`Connecting to DB: ${dbPath}`);
  if (!fs.existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`);
    process.exit(1);
  }
  const sqlite3 = verbose();
  const db = new sqlite3.Database(dbPath);

  // --- TypeORM Connection (for metadata) ---
  const AppDataSource = new DataSource({
    type: 'sqlite',
    database: dbPath,
    // Include Permission and ALL related entities it imports/references
    entities: [Permission, Action, UiComponent, FrontendRoute, ApiEndpoint /*, User, ... other entities */],
    synchronize: false, // Crucial: Never synchronize in audit script!
    logging: false,
  });

  try {
    await AppDataSource.initialize();
    console.log('TypeORM connection initialized for metadata.');

    const entitiesToAudit = [Permission /*, User, ... */]; // Focus on Permission for now

    for (const entity of entitiesToAudit) {
      const entityMetadata = AppDataSource.getMetadata(entity);
      const tableName = entityMetadata.tableName;
      console.log(`\nAuditing Table: ${tableName} (Entity: ${entityMetadata.name})`);

      // 1. Get Database Schema Info
      const dbColumns: DbColumnInfo[] = await new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, rows: DbColumnInfo[]) => {
          if (err) {
            console.error(`Error getting DB schema for ${tableName}:`, err.message);
            reject(err);
          }
           else if (!rows || rows.length === 0){
             console.warn(`Table ${tableName} not found or has no columns in the database.`);
             resolve([]);
           }
          else {
            resolve(rows);
          }
        });
      });

      if (dbColumns.length === 0 && (!await AppDataSource.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`))) {
          continue; // Skip if table doesn't exist
      }

      const dbColumnMap = new Map<string, DbColumnInfo>(dbColumns.map(c => [c.name, c]));

      // 2. Get Entity Metadata Info
      const entityColumns: EntityColumnInfo[] = entityMetadata.columns.map(col => ({
        databaseName: col.databaseName,
        propertyName: col.propertyName,
        type: typeof col.type === 'string' ? col.type : (col.type as Function)?.name,
        isNullable: col.isNullable,
        isPrimary: col.isPrimary,
        length: col.length ? parseInt(col.length, 10) : undefined, // Ensure length is number
      }));
      const entityColumnMap = new Map<string, EntityColumnInfo>(entityColumns.map(c => [c.databaseName, c]));

      // 3. Compare Schemas (Database as Source of Truth)
      let mismatchesFound = false;
      console.log('\n--- Comparison Results --- ');

      // Check columns present in DB but not in Entity
      for (const [dbColName, dbColInfo] of dbColumnMap.entries()) {
        if (!entityColumnMap.has(dbColName)) {
          console.warn(`  [DB->ENTITY MISMATCH] DB column "${dbColName}" exists in DB but not mapped in Entity "${entityMetadata.name}".`);
          mismatchesFound = true;
        }
      }

      // Check columns present in Entity but potentially not in DB or with different properties
      for (const [entityDbName, entityColInfo] of entityColumnMap.entries()) {
        const dbColInfo = dbColumnMap.get(entityDbName);

        if (!dbColInfo) {
          // Exception: Ignore join columns automatically created by TypeORM for relations if they don't exist explicitly in DB schema
          // This happens with ManyToMany if the junction table is implicitly managed.
          // A more robust check would verify the junction table itself.
          const relation = entityMetadata.relations.find(r => r.joinColumns.some(jc => jc.databaseName === entityDbName));
          if (relation && (relation.isManyToMany || relation.isOneToMany || relation.isManyToOne)) {
              // console.log(`  [INFO] Ignoring join column "${entityDbName}" for relation "${entityColInfo.propertyName}" as it might be implicitly handled.`);
          } else {
              console.warn(`  [ENTITY->DB MISMATCH] Entity column "${entityColInfo.propertyName}" (DB: "${entityDbName}") mapped in Entity but NOT FOUND in DB table "${tableName}".`);
              mismatchesFound = true;
          }
          continue; // Skip further checks for this column if not found or it's a relation column
        }

        // Compare Nullability (DB is source of truth)
        const dbIsNullable = dbColInfo.notnull === 0;
        if (dbIsNullable !== entityColInfo.isNullable) {
          console.warn(`  [NULLABILITY MISMATCH] For "${entityDbName}": DB is ${dbIsNullable ? 'NULLABLE' : 'NOT NULL'}, Entity has nullable: ${entityColInfo.isNullable}. (Entity should match DB)`);
          mismatchesFound = true;
        }

        // Compare Primary Key Status (DB is source of truth)
        const dbIsPrimary = dbColInfo.pk > 0;
        if (dbIsPrimary !== entityColInfo.isPrimary) {
          console.warn(`  [PRIMARY KEY MISMATCH] For "${entityDbName}": DB is ${dbIsPrimary ? 'PRIMARY KEY' : 'NOT PK'}, Entity has isPrimary: ${entityColInfo.isPrimary}. (Entity should match DB)`);
          mismatchesFound = true;
        }
      }

      if (!mismatchesFound) {
        console.log(`  ✅ Schema for table "${tableName}" and entity "${entityMetadata.name}" seems aligned (checked name, nullability, PK).`);
      } else {
        console.log(`\nFound one or more mismatches for ${tableName}. Please review warnings.`);
      }
    }

  } catch (error) {
    console.error('Error during schema audit:', error);
  } finally {
    // Close connections
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log('\nTypeORM connection closed.');
    }
    db.close((err) => {
      if (err) console.error('Error closing SQLite DB:', err.message);
      else console.log('SQLite DB connection closed.');
    });
  }
}

runSchemaAudit(); 