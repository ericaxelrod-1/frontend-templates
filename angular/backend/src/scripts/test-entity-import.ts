import 'reflect-metadata'; // Good practice, though maybe not needed if just testing imports

try {
  console.log('Attempting to import Permission...');
  const PermissionModule = require('../modules/permissions/entities/permission.entity');
  if (PermissionModule && PermissionModule.Permission) {
    console.log(
      'Successfully imported Permission entity class:',
      PermissionModule.Permission.name,
    );
  } else {
    console.error(
      'Failed to import Permission entity correctly or Permission class missing.',
    );
  }
} catch (e) {
  console.error('Error importing Permission:', e);
}

try {
  console.log('\nAttempting to import Action...');
  const ActionModule = require('../modules/permissions/entities/action.entity');
  if (ActionModule && ActionModule.Action) {
    console.log(
      'Successfully imported Action entity class:',
      ActionModule.Action.name,
    );
  } else {
    console.error(
      'Failed to import Action entity correctly or Action class missing.',
    );
  }
} catch (e) {
  console.error('Error importing Action:', e);
}

// Test import 'typeorm' from within a file that might be similar to an entity
try {
  console.log("\nAttempting to import 'typeorm' itself...");
  const typeorm = require('typeorm');
  if (typeorm && typeorm.Entity) {
    console.log("Successfully imported 'typeorm' and found Entity decorator.");
  } else {
    console.error(
      "Failed to import 'typeorm' correctly or Entity decorator missing.",
    );
  }
} catch (e) {
  console.error("Error importing 'typeorm':", e);
}
