# Testing Documentation

## Running Tests

Tests are run using the `npm test` command in the backend directory. This command executes Jest, our testing framework.

### Reading Test Results

The test output follows this format:
```
PASS/FAIL  src/path/to/test.spec.ts
  ● Test Suite Name
    ✓ Test case description (time)
    ✕ Failed test case description
      Error details...
```

- `PASS` indicates all tests in a file passed
- `FAIL` indicates one or more tests failed
- Green ✓ marks passed tests
- Red ✕ marks failed tests
- Test execution time is shown in parentheses
- For failed tests, error details and stack traces are provided

### Debugging Guidelines

1. **Isolate the failing test**:
   - Run a specific test file: `npm test path/to/file.spec.ts`
   - Run a specific test: `npm test -t "test description"`

2. **Common Issues**:
   - Missing mock implementations
   - Incorrect mock return values
   - Missing dependencies in TestingModule
   - Incorrect assertions
   - Async/await issues

3. **Debug Strategies**:
   - Check mock implementations and return values
   - Verify TestingModule configuration
   - Use console.log for debugging
   - Check async/await usage
   - Verify test data matches service requirements

## Test Inventory

### App Controller Tests (`src/app.controller.spec.ts`)
- **getHello**
  - Purpose: Verifies basic controller functionality
  - Expected: Returns "Hello World!"

### Roles Service Tests (`src/modules/users/roles.service.spec.ts`)
1. **findAll**
   - Purpose: Tests retrieval of all roles
   - Expected: Returns array of roles
   - Verifies: Repository call and data structure

2. **findOne**
   - Purpose: Tests role retrieval by ID
   - Expected: Returns specific role or throws NotFoundException
   - Verifies: Repository call with correct parameters and error handling

3. **updateRolePermissions**
   - Purpose: Tests role permission updates
   - Expected: Updates permissions for Superadmin users, throws ForbiddenException for others
   - Verifies: Permission checks and data updates

4. **assignRoleToUser**
   - Purpose: Tests role assignment functionality
   - Expected: Assigns role to user with proper permissions
   - Verifies: Permission checks and role assignment

### Groups Service Tests (`src/modules/users/groups.service.spec.ts`)
1. **create**
   - Purpose: Tests group creation
   - Expected: Creates new group with specified settings
   - Verifies: Permission checks and group creation

2. **findAll**
   - Purpose: Tests retrieval of accessible groups
   - Expected: Returns groups based on user access
   - Verifies: Access control and data retrieval

3. **findOne**
   - Purpose: Tests single group retrieval
   - Expected: Returns group if accessible
   - Verifies: Access control and error handling

4. **addMember**
   - Purpose: Tests adding members to groups
   - Expected: Adds member with proper permissions
   - Verifies: Permission checks and member addition

5. **removeMember**
   - Purpose: Tests member removal
   - Expected: Removes member with proper permissions
   - Verifies: Permission checks and member removal

6. **delete**
   - Purpose: Tests group deletion
   - Expected: Deletes group with proper permissions
   - Verifies: Permission checks and group removal

### Test Coverage

Each test suite includes both positive and negative test cases:
- Successful operations with proper permissions
- Failed operations due to insufficient permissions
- Error cases (not found, forbidden, etc.)
- Edge cases and validation 