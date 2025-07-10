# Project Backlog

Last Updated: 2025-07-09 13:35:00

## Critical Priority

### BUG-124.9: Login Monitoring Filters Not Applying User-Selected Date Range
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: BUG-124.8
- **Added**: 2025-07-10 14:30:00
- **Completed**: 2025-07-10 15:29:48
- **Description**: Login monitoring page shows only 9 login attempts (default 7-day filter) even when user changes date range to broader range. Database contains 225 total attempts, but UI doesn't update when filters are applied.

#### Investigation Results (@999-bugfinder)
- **Root Cause**: Filter component emits default 7-day date range on initialization, and the parent component doesn't properly handle subsequent filter updates
- **Database Verification**:
  - Total login attempts in database: 225
  - Attempts in user-selected range (6/3/2025 - 7/10/2025): 225
  - Attempts in default 7-day range: 9 (correctly displayed)
- **Issue**: The `onFiltersChanged` event handler in login-monitoring component doesn't trigger data reload

#### Implementation Notes
- **Fixed**: Added ViewChild reference to login-attempts-table component and updated filter event handlers
- **Solution**: 
  - Fixed `onFiltersChanged()` method to call child component's `applyFilters()` method
  - Updated `onFiltersReset()` method to properly handle filter resets
  - Fixed TypeScript any type usage for better type safety
- **Testing**: Build successful (295.206 seconds), ESLint passed, filter updates now trigger data reload
- **Impact**: Users can now successfully apply custom date ranges and see the full dataset (225 attempts) instead of being stuck with default 7-day filter (9 attempts)

- **Files Modified**:
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Added ViewChild reference and fixed filter update handling

### BUG-124.8: Login Monitoring Page Functionality Broken After Template Reconstruction
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-07-09 16:30:00
- **Description**: Multiple critical functionality issues in login-monitoring page introduced during BUG-124.7 template reconstruction. Pattern tiles no longer navigate, filters are disabled, and test pattern generation appears on wrong tabs.

#### Investigation Results (@999-bugfinder)
- **Root Cause**: Template reconstruction in BUG-124.7 missed critical component wiring and placement
- **Specific Issues Identified**:
  1. **Pattern Detection Tiles**: Click handlers only log to console, no navigation or filtering
  2. **Login Attempts Filters**: Missing `<app-filters>` component from Login Attempts tab
  3. **Pattern Detection Filters**: Missing `[hasPermission]` input, causing disabled state
  4. **Security Alerts Filters**: Missing `[hasPermission]` input, causing disabled state
  5. **Test Pattern Generation**: Placed globally instead of within Pattern Detection tab only

#### Implementation Requirements
- **Issues**: 
  - Fix `onPatternTileClick()` to navigate to Pattern Detection tab with applied filter
  - Add missing `<app-filters>` component to Login Attempts tab
  - Add `[hasPermission]="hasPermission"` input to all filter components
  - Move Test Pattern Generation section inside Pattern Detection tab only
  - Ensure proper component imports and wiring

- **Files To Modify**:
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`: Template fixes
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Navigation logic
  - Verify all filter components have proper input bindings

### BUG-111: IP Reputation Tab Shows "No IP Selected" with No Selection Interface
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-01-26 19:30:00
- **Description**: IP Reputation tab shows "No IP Selected" message with no way to select IPs. User expects vertical bar chart of IPs ranked by recent attempts with block/unblock status, but current implementation requires clicking IPs in login attempts table.

#### Investigation Results (@999-bugfinder)
- **Current Architecture**: Click-based IP selection from login attempts table to view individual IP reputation
- **User Expectation**: Dashboard/overview approach with bar chart showing IP rankings and block status
- **Backend Support**: `/api/login-monitoring/ip/:ipAddress` endpoint exists for individual IP lookup
- **Missing**: Overview/dashboard endpoint for all IPs with statistics and ranking

#### Implementation Requirements
- **Issues**: 
  - Create dashboard view of all IPs with attempt counts
  - Implement bar chart visualization (suggested: vertical bars)
  - Add bulk IP management with block/unblock capabilities
  - Design IP ranking algorithm based on recent attempts
  - Add filtering for IP reputation dashboard

- **Files To Modify**:
  - `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`
  - `angular/frontend/src/app/modules/admin/login-monitoring/ip-reputation/`
  - IP reputation dashboard components

## High Priority

### BUG-125: Angular SSR Build Not Generating Server Bundle
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-01-28 10:30:00
- **Description**: Angular SSR (Server-Side Rendering) build process is not generating server bundle despite having correct source files (server.ts and main.server.ts). This causes `npm run serve:ssr:frontend` to fail with missing server.mjs error.

#### Investigation Results (@999-bugfinder)
- **Current State**: 
  - Both `server.ts` and `main.server.ts` exist with correct content
  - `@angular/ssr` package installed (version 18.2.13)
  - Angular.json has `server: "src/main.server.ts"` configuration
  - Running `npm run build` only generates browser files in `dist/frontend/browser/`
  - No server directory or server.mjs file created in dist

- **Root Cause**: Angular 18's application builder (`@angular-devkit/build-angular:application`) requires additional SSR configuration beyond just having `server: "src/main.server.ts"` in angular.json

- **Missing Configuration**:
  - `tsconfig.server.json` file not found
  - No specific SSR build script in package.json
  - Application builder not configured to generate server-side bundles

#### Proposed Resolution
1. **Create `tsconfig.server.json`** with proper server-side TypeScript configuration
2. **Update angular.json** to include full SSR configuration for the application builder
3. **Add SSR build scripts** to package.json:
   - `build:ssr`: Build both browser and server bundles
   - `serve:ssr`: Serve the SSR application
4. **Verify server bundle generation** in `dist/frontend/server/`
5. **Test SSR functionality** to ensure hydration works correctly

#### Implementation Requirements
- **Files To Create**:
  - `angular/frontend/tsconfig.server.json`

- **Files To Modify**:
  - `angular/frontend/angular.json` - Add complete SSR configuration
  - `angular/frontend/package.json` - Add SSR-specific build scripts
  - `angular/frontend/src/app/app.config.ts` - Verify SSR providers configuration

- **Expected Outcome**:
  - Build process generates both browser and server bundles
  - `dist/frontend/server/server.mjs` file created
  - `npm run serve:ssr:frontend` runs successfully
  - Angular hydration (NG0505) warning resolved when running with SSR

### FEAT-122: Global Time Filter for Summary Tiles
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: FEAT-121
- **Added**: 2025-07-01 17:05:10
- **Description**: Add time filter component for summary tiles that operates independently from tab-specific filters. Follow existing design patterns from filter components.

#### Implementation Requirements
- **Issues**: 
  - Time filter options needed (24h, 7d, 30d, 90d, Custom, All)
  - Follow existing filter component patterns
  - Position above summary tiles grid, separate from tab-specific filters
  - Backend integration with time filter parameters

- **Files To Modify**:
  - `angular/frontend/src/app/modules/admin/login-monitoring/components/time-filter/`
  - `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`
  - `angular/backend/src/modules/auth/services/pattern-detection.service.ts`

## Medium Priority

### TECH-004.1: Continuous Integration Setup
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.2, TECH-001.3
- **Added**: 2025-07-07
- **Description**: Set up automated testing and continuous integration for the project.

#### Implementation Notes
- **Issues**: 
  - GitHub Actions configuration needed
  - Test coverage reporting missing
  - Linting checks not automated

- **Files To Modify**:
  - `.github/workflows/` directory
  - CI/CD configuration files
  - Test coverage tools

### TECH-004.2: Deployment Pipeline
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-004.1
- **Added**: 2025-07-07
- **Description**: Create a deployment pipeline for the tools and applications.

#### Implementation Notes
- **Issues**: 
  - Docker container build needed
  - Kubernetes deployment configuration missing
  - Versioning strategy not implemented

- **Files To Modify**:
  - Dockerfile
  - Kubernetes manifests
  - Deployment scripts

### FEAT-001: Role Hierarchy Management
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.3
- **Added**: 2025-07-07
- **Description**: Implement a role hierarchy management system.

#### Implementation Notes
- **Issues**: 
  - Role inheritance model needed
  - UI for managing hierarchies missing
  - Permission propagation logic required

- **Files To Modify**:
  - Role management components
  - Backend role services
  - Database schema updates

### FEAT-002: Permission Auditing
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.3, FEAT-001
- **Added**: 2025-07-07
- **Description**: Add permission auditing capabilities to track changes to permissions.

#### Implementation Notes
- **Issues**: 
  - Audit log schema needed
  - Audit log viewers missing
  - Export functionality required

- **Files To Modify**:
  - Audit log entities
  - Audit log services
  - Export utilities

### TASK-003: Cache Tables Implementation
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TASK-002
- **Added**: 2025-07-07
- **Description**: Create migration for cache tables following established patterns.

#### Implementation Notes
- **Issues**: 
  - Need migration for cache_components, cache_routes, cache_endpoints
  - Should follow established patterns for column names and constraints

- **Files To Modify**:
  - Migration files for cache tables
  - Cache entity definitions

### BUG-025: Review and Fix Nullability Mismatches
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: BUG-021, BUG-022, BUG-023
- **Added**: 2025-05-23
- **Description**: Investigate and resolve nullability mismatches between database schema and entity definitions, particularly for ID columns that show as nullable in database but non-nullable in entities.

#### Implementation Notes
- **Issues**: 
  - All primary key `id` columns show as nullable in database but non-nullable in entities (19 total mismatches)
  - Likely SQLite introspection issue rather than actual nullability problems
  - Need to investigate if SQLite schema introspection is causing false positives

- **Files To Modify**:
  - Database entity definitions
  - Schema validation scripts
  - SQLite introspection tools

### TECH-002.5: Database Tools Enhancement
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-002.3
- **Added**: 2025-05-06
- **Description**: Enhance database tooling with improved validation, management, and logging capabilities.

#### Implementation Requirements
- **Issues**: 
  - Enhance fix-database.js to create complete schema
  - Improve check-db.js with detailed validation
  - Create configuration system for database tools
  - Add comprehensive logging with timestamps

- **Files To Modify**:
  - Database management scripts
  - Validation and logging tools
  - Database backup mechanisms

## Low Priority

### FEAT-007: Create API Status/Health Endpoint
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-07-07
- **Description**: Create a comprehensive API status/health endpoint for system monitoring and debugging.

#### Implementation Notes
- **Issues**: 
  - Health endpoint controller needed
  - Database connectivity checks missing
  - System metrics not available

- **Files To Modify**:
  - Health controller
  - Service availability checks
  - System metrics collection

## Notes

Backlog updated on 2025-07-07 to reflect current project priorities. Multiple completed tasks moved to changelog including FEAT-123 (completed 7/4) and 12 other tasks (completed 6/1). Continuing search for additional Angular Material implementation issues. All remaining tasks are actively needed for project completion.