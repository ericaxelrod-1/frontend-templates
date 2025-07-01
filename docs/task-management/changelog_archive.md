# Project Changelog Archive

Last Updated: 2025-01-27

## January 2025

### BUG-109: Filter Box Doesn't Work At All - No Connection Between Filters and Table ✅
- **Started**: 2025-01-26 20:20:00
- **Completed**: 2025-01-27 18:30:00
- **Status**: Complete ✅
- **Testing**: Build Successful ✅
- **Priority**: Critical (Filter Functionality + Sort Direction)
- **Dependencies**: None
- **Description**: Fixed completely non-functional filter system by connecting filter changes to table refresh, moving filters to appropriate tab location, adding default date range (last 7 days), and fixing sort initialization race condition causing ascending sort despite descending configuration.

#### Implementation Summary
**BROKEN FILTER CHAIN COMPLETELY RESTORED + DEFAULT DATE RANGE + SORT FIX**:
- **Root Cause**: Filter component captured changes but main component never triggered table refresh
- **Critical Missing Link**: Main component `onFiltersChanged()` method only stored filterForm but never called `applyFilters()`
- **Sort Race Condition**: MatSort programmatic initialization conflicted with template initialization causing wrong sort direction
- **Solution**: Added ViewChild reference and proper trigger mechanism to connect filter events to table refresh
- **Sort Fix**: Removed conflicting programmatic sort initialization, rely on template-based initialization for proper descending order
- **UX Enhancement**: Added default date range (last 7 days) that auto-populates on initial page load

#### Technical Fixes Applied

**Phase 1: Component Communication Fix**
- **Added**: `@ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!` reference in main component
- **Updated**: `onFiltersChanged()` method to call `this.loginAttemptsTable?.applyFilters()` after storing filterForm
- **Enhanced**: `onFiltersReset()` method to also trigger table refresh for consistent behavior

**Phase 2: Template Structure Correction**
- **Moved**: Filters component from global placement above all tabs to inside Recent Login Attempts tab only
- **Rationale**: Filters only apply to login attempts table, not to Pattern Detection, Security Alerts, or IP Reputation tabs
- **User Experience**: Clear visual indication that filters apply specifically to login attempts data

**Phase 3: Event Chain Validation**
- **Verified**: FiltersComponent properly emits `filtersChanged` event with FormGroup on Apply button click
- **Confirmed**: LoginAttemptsTableComponent `applyFilters()` method resets pagination and calls `loadRecentAttempts()`
- **Validated**: Backend endpoint `/api/login-monitoring/attempts/recent` supports all filter parameters
- **Tested**: Service properly encodes and transmits filter values in HTTP GET request

#### Files Modified
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Added ViewChild import, ViewChild reference, and trigger calls in filter event handlers
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`: Moved filters component inside Recent Login Attempts tab
- `angular/frontend/src/app/modules/admin/login-monitoring/filters/filters.component.ts`: Added default date range calculation (last 7 days) for auto-population
- `angular/frontend/src/app/modules/admin/login-monitoring/login-attempts-table/login-attempts-table.component.ts`: Fixed sort initialization race condition by removing conflicting programmatic initialization

#### Filter Chain Architecture Restored
**Before (Broken)**:
```
FiltersComponent → (emit) → LoginMonitoringComponent → (BROKEN CHAIN) → LoginAttemptsTableComponent
```

**After (Fixed)**:
```
FiltersComponent → (emit) → LoginMonitoringComponent → (applyFilters()) → LoginAttemptsTableComponent → (loadRecentAttempts()) → Backend Query
```

#### Filter Parameters Confirmed Working
- **Email Filter**: LIKE query on `attempt.emailAttempted` field
- **IP Address Filter**: LIKE query on `attempt.ipAddress` field  
- **Status Filter**: Exact match on `attempt.status` field
- **Date Range**: `attempt.attemptedAt >= dateFrom AND attempt.attemptedAt <= dateTo`
- **Sorting**: Server-side ORDER BY with field mapping and direction validation

#### User Experience Improvements
- **Functional Filtering**: Apply Filters button now actually applies filters to table data
- **Reset Functionality**: Reset button clears filters and refreshes table to show all data
- **Contextual Placement**: Filters clearly associated with login attempts table only
- **Immediate Feedback**: Table refreshes immediately when filters are applied or reset
- **Pagination Reset**: Filter application resets to first page for consistent navigation
- **Smart Date Defaults**: Last 7 days auto-populated for immediate usability without manual date entry
- **Correct Sort Order**: Most recent login attempts now appear first (descending order) as expected
- **Default Date Range**: Date filters auto-populate with last 7 days on initial load for immediate useful data
- **Smart Reset**: Reset button restores default 7-day range instead of clearing to empty dates

**OUTCOME**: Completely restored filter functionality that was previously non-functional. Users can now filter login attempts by email, IP address, status, and date range with immediate table updates reflecting the filtered results.

### BUG-077: Meaningful API Responses for Group Assignment Operations ✅
- **Started**: 2025-01-28
- **Completed**: 2025-01-28
- **Status**: Complete ✅
- **Implementation Notes**: Implemented meaningful API responses for group assignment operations to resolve null reference errors and provide better user feedback.
- **Root Cause**: Backend `addMember()` and `removeMember()` methods returned `void`, causing frontend null reference errors
- **Solution**: Created `GroupMembershipResult` DTO with comprehensive operation details, updated controller return types
- **Files Modified**: 
  - `angular/backend/src/modules/users/dto/group-membership-result.dto.ts` (NEW)
  - `angular/backend/src/modules/users/groups.service.ts` (UPDATED)
  - `angular/backend/src/modules/users/groups.controller.ts` (UPDATED)
  - `angular/frontend/src/app/models/group-membership-result.interface.ts` (NEW)
  - `angular/frontend/src/app/services/user.service.ts` (UPDATED)
  - `angular/frontend/src/app/features/users/users.component.ts` (UPDATED)
- **Testing Results**: ✅ All builds successful, null reference errors eliminated

### BUG-078: Implement Role Management with Dedicated API Endpoints (Like Groups) ✅
- **Started**: 2025-01-28
- **Completed**: 2025-01-28
- **Status**: Complete ✅
- **Implementation Notes**: Successfully implemented role management using the same pattern as the working group management system
- **Solution**: Created dedicated `addUserToRole()` and `removeUserFromRole()` service methods with REST endpoints
- **Files Modified**: 
  - `angular/backend/src/modules/users/dto/role-membership-result.dto.ts` (Created)
  - `angular/frontend/src/app/models/role-membership-result.interface.ts` (Created)
  - `angular/backend/src/modules/users/users.service.ts` (Added role methods)
  - `angular/backend/src/modules/users/users.controller.ts` (Added POST/DELETE role endpoints)
  - `angular/frontend/src/app/services/user.service.ts` (Added role methods)
  - `angular/frontend/src/app/features/users/users.component.ts` (Updated role handling)
- **Testing Results**: ✅ Backend and frontend compilation passed, API endpoints working correctly

### BUG-080: Groups Page Shows No Members Despite Correct Backend Data ✅
- **Started**: 2025-01-28
- **Completed**: 2025-01-28
- **Status**: Complete ✅
- **Implementation Notes**: Fixed property mapping issue in frontend GroupService where it was looking for non-existent `userGroups` instead of `users` property
- **Root Cause**: Frontend GroupService mapped `group.userGroups` (non-existent) instead of `group.users` (actual backend property)
- **Solution**: Updated mapping to use `group.users` to match backend Group entity structure
- **Files Modified**: 
  - `angular/frontend/src/app/services/group.service.ts` (Fixed property mapping)
- **Testing Results**: ✅ Frontend compilation passed, Groups page now correctly displays group members

## June 2025

### BUG-092: Create Server-Side Sorting Rules File - Knowledge Preservation ✅
- **Started**: 2025-06-19
- **Completed**: 2025-06-19
- **Status**: Complete ✅
- **Priority**: Medium (Knowledge Management)
- **Implementation Notes**: 
  - **Purpose**: Preserve all lessons learned from BUG-088 through BUG-091 implementation
  - **File Created**: `.cursor/rules/150-angular-server-side-sorting.mdc`
  - **Knowledge Preserved**: ViewChild chicken-and-egg problem, lifecycle coordination, reactive patterns
- **Files Modified**: `.cursor/rules/150-angular-server-side-sorting.mdc`
- **Testing Results**: ✅ Complete rules file with all lessons learned

### BUG-091: Fix ViewChild Chicken-and-Egg Problem - Always Render Table Structure ✅
- **Started**: 2025-06-19
- **Completed**: 2025-06-19
- **Status**: Complete ✅
- **Priority**: High (Critical Bug Fix)
- **Implementation Notes**: 
  - **Root Cause**: Chicken-and-egg problem with conditional table rendering
  - **Solution**: Always render table structure to ensure ViewChild availability
  - **Architecture**: Table structure always exists → ViewChild always available → Reactive pattern always initializes
- **Files Modified**: `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`
- **Testing Results**: ✅ ViewChild availability resolved

### BUG-090: Fix Infinite Loop in ViewChild Initialization - Remove Recursive Retry Logic ✅
- **Started**: 2025-06-19
- **Completed**: 2025-06-19
- **Status**: Complete ✅
- **Priority**: High (Critical Bug Fix)
- **Implementation Notes**: 
  - **Root Cause**: Flawed recursive retry logic with `setTimeout()` that never resolved
  - **Solution**: Proper Angular lifecycle coordination between ngOnInit and ngAfterViewInit
  - **Architecture**: Clean Angular lifecycle management without recursive hacks
- **Files Modified**: `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`
- **Testing Results**: ✅ Infinite loop resolved, clean console output

### BUG-086: Login Monitoring Table Sorting Not Working - Missing MatTableDataSource Implementation ✅
- **Started**: 2025-06-18
- **Completed**: 2025-06-18
- **Status**: Complete ✅
- **Priority**: High (Core Functionality Broken)
- **Implementation Notes**: 
  - **Root Cause**: MatSort was not properly connected to the data source
  - **Solution**: Implemented MatTableDataSource and connected sort to dataSource
  - **Architecture**: Proper MatTableDataSource integration with MatSort
- **Files Modified**: 
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`
- **Testing Results**: ✅ Table sorting now works correctly

### BUG-085: Login Monitoring Table Sort Toggle Works But Data Doesn't Sort - MatSort Initialization Issue ✅
- **Started**: 2025-06-18
- **Completed**: 2025-06-18
- **Status**: Complete ✅
- **Priority**: High (User Functionality Blocking)
- **Implementation Notes**: 
  - **Root Cause**: `@ViewChild(MatSort) sort!: MatSort;` was `undefined` due to conditional table rendering
  - **Solution**: Added null checks and deferred setup after data loading
  - **Architecture**: Conditional setup with proper timing coordination
- **Files Modified**: 
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`
  - `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`
  - `angular/backend/src/modules/auth/services/login-attempt.service.ts`
- **Testing Results**: ✅ MatSort initialization handled gracefully

### BUG-084: Login Attempts Not Rendering After Sorting Implementation - Database Query Issue ✅
- **Started**: 2025-06-18
- **Completed**: 2025-06-18
- **Status**: Complete ✅
- **Priority**: Critical (Complete Data Loss)
- **Implementation Notes**: 
  - **Root Cause**: Unnecessary user join causing query failures and null value handling issues
  - **Solution**: Removed user join and added proper null handling
  - **Architecture**: Simplified query with graceful null value handling
- **Files Modified**: 
  - `angular/backend/src/modules/auth/services/login-attempt.service.ts`
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`
- **Testing Results**: ✅ Login attempts now display correctly

### BUG-061: Login-Monitoring Routes Return 401 Unauthorized - Permission Mismatch ✅
- **Started**: 2025-01-08
- **Completed**: 2025-01-08
- **Status**: Complete ✅
- **Priority**: High (User Functionality Blocking)
- **Implementation Notes**: 
  - **Root Cause**: Backend expected `login-monitoring:view` but database had `login-monitoring:read`
  - **Solution**: Updated backend controller to use `login-monitoring:read`
  - **Investigation**: Used @999-bugfinder methodology for systematic comparison
- **Files Modified**: `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`
- **Testing Results**: ✅ Permission requirements now match database permissions

### BUG-060: Role Deletion Fails Due to Foreign Key Constraint - Permission Assignments Not Cascaded ✅
- **Started**: 2025-06-18
- **Completed**: 2025-06-18
- **Status**: Complete ✅
- **Priority**: High (User Functionality Blocking)
- **Implementation Notes**: 
  - **Root Cause**: `RolesService.remove()` didn't handle cascade deletion of role permissions
  - **Solution**: Implemented transaction-based two-phase deletion process
  - **Architecture**: Uses QueryRunner for atomic operations with proper rollback
- **Files Modified**: `angular/backend/src/modules/users/roles.service.ts`
- **Testing Results**: ✅ Role deletion functionality now works end-to-end

### BUG-059: Role Delete Endpoint Missing - 404 Error on DELETE /api/roles/:id ✅
- **Started**: 2025-06-18
- **Completed**: 2025-06-18
- **Status**: Complete ✅
- **Priority**: High (User Functionality Blocking)
- **Implementation Notes**: 
  - **Root Cause**: Active RolesController missing DELETE endpoint
  - **Solution**: Added `@Delete(':id')` endpoint with proper guards and permissions
  - **Security**: Includes permission checking, system role protection, user assignment validation
- **Files Modified**: `angular/backend/src/modules/users/roles.controller.ts`
- **Testing Results**: ✅ DELETE endpoint properly validates permissions

### BUG-058: Role Edit Mode Not Connected - Permissions Not Populated in Edit Sidebar ✅
- **Started**: 2025-06-18
- **Completed**: 2025-06-18
- **Status**: Complete ✅
- **Priority**: High (User Functionality Blocking)
- **Implementation Notes**: 
  - **Root Cause**: Missing `this.editMode = !!this.roleData;` in ngOnChanges method
  - **Solution**: Added editMode detection following group-creation-sidebar pattern
  - **UI Fix**: Form now populates with existing role data and permissions
- **Files Modified**: Role-creation-sidebar component
- **Testing Results**: ✅ Edit mode now works correctly with pre-populated data

## April 2025

No completed tasks archived yet.

## March 2025

No completed tasks archived yet. 