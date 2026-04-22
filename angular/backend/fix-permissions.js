const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('db.sqlite');

db.serialize(() => {
  console.log('Fixing RLS permissions...');
  
  const targetRoles = ['superuser', 'Super Administrator', 'admin', 'Administrator', 'superadmin'];
  const roleIds = [];
  
  db.all(`SELECT id, name FROM roles WHERE name IN (${targetRoles.map(() => '?').join(',')})`, targetRoles, (err, roles) => {
    if (err) throw err;
    console.log("Found roles:", roles);
    roles.forEach(r => roleIds.push(r.id));
    
    // Get 'read' and 'manage' action IDs
    db.all('SELECT id, name FROM actions', (err, actions) => {
      if (err) throw err;
      
      const readAction = actions.find(a => a.name === 'read')?.id;
      const manageAction = actions.find(a => a.name === 'manage')?.id;
      
      if (!readAction || !manageAction) {
          console.error("Could not find read or manage actions!");
          return;
      }
      
      const resources = ['rls_rules', 'rls_join_paths', 'rls_scope_templates'];
      
      resources.forEach(resource => {
        const perms = [
          { name: `${resource}:read`, actionId: readAction },
          { name: `${resource}:manage`, actionId: manageAction }
        ];
        
        perms.forEach(perm => {
          // Insert permission if it doesn't exist
          db.run(`INSERT OR IGNORE INTO permissions (name, resource_name, action_id, description, created_at, updated_at) 
                  VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`, 
            [perm.name, resource, perm.actionId, `Permission to ${perm.actionId === readAction ? 'read' : 'manage'} ${resource}`], 
            function(err) {
              if (err) console.error(err);
              
              // Get the permission ID
              db.get('SELECT id FROM permissions WHERE name = ?', [perm.name], (err, pRow) => {
                if (err || !pRow) return;
                
                // Assign to all admin roles
                roleIds.forEach(roleId => {
                  db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at) 
                          VALUES (?, ?, 1, datetime('now'), datetime('now'))`, 
                    [roleId, pRow.id], 
                    (err) => {
                      if (err) console.error(err);
                      else console.log(`Assigned ${perm.name} to role ${roleId}`);
                    });
                });
              });
            });
        });
      });
    });
  });
});

setTimeout(() => db.close(), 1000);
