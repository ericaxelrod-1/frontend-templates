# Project Backlog

Last Updated: 2025-01-26

## Critical Priority

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
- Create dashboard view of all IPs with attempt counts
- Implement bar chart visualization (suggested: vertical bars)
- Add bulk IP management with block/unblock capabilities
- Design IP ranking algorithm based on recent attempts
- Add filtering for IP reputation dashboard

### BUG-110: Missing Specific Filters for Pattern Detection and Security Alerts Tabs
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: BUG-109
- **Added**: 2025-01-26 19:25:00
- **Description**: Pattern Detection and Security Alerts tabs lack appropriate filtering capabilities. Pattern Detection needs date range, pattern type, and affected IPs filters. Security Alerts needs status, severity, and alert type filters.

#### Investigation Results (@999-bugfinder)
- **Current State**: Only generic filters component exists (email, IP, status, date range)
- **Pattern Detection Needs**: Date range, pattern type (brute_force, credential_stuffing, etc.), affected IPs, severity
- **Security Alerts Needs**: Status (active, acknowledged, resolved), severity, alert type, date range
- **IP Reputation Needs**: Block status, reputation score range, attempt count filters
- **Architecture Gap**: Each tab requires specific filter components for their data types

#### Implementation Requirements
- Create PatternDetectionFiltersComponent with pattern-specific filters
- Create SecurityAlertsFiltersComponent with alert-specific filters  
- Create IPReputationFiltersComponent with IP-specific filters
- Update backend services to support new filter parameters
- Implement tab-specific filter logic in main component

### BUG-109: Filter Box Doesn't Work At All - No Connection Between Filters and Table
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-01-26 20:20:00
- **Description**: The filter box doesn't apply to any tabs and doesn't work at all. While backend supports filtering, there's no trigger mechanism connecting filter changes to table refresh. Also needs to be nested within Recent Login Attempts tab only.

#### Investigation Results (@999-bugfinder)
- **Backend Support**: ✅ `/api/login-monitoring/attempts/recent` endpoint supports `email`, `ipAddress`, `status`, `dateFrom`, `dateTo`, `sortBy`, `sortDirection` parameters
- **Service Implementation**: ✅ `LoginAttemptService.getRecentAttemptsForDashboard()` implements proper LIKE queries and date range filtering
- **Frontend Issue**: ❌ Filter component captures changes via `onFiltersChanged()` but NEVER triggers table refresh
- **Missing Connection**: ❌ Main component `onFiltersChanged()` method doesn't call table's `applyFilters()` method
- **Template Structure**: ❌ Filters rendered globally above tabs instead of inside Recent Login Attempts tab

#### Implementation Requirements
- Connect filter changes to table refresh by calling `applyFilters()` on table component
- Move filters component inside Recent Login Attempts tab content
- Add "Apply Filters" button behavior to actually trigger filtering
- Test that backend filtering parameters work correctly
- Implement reactive filtering or manual apply button pattern







## High Priority

## Medium Priority

### TASK-102.3: Data Structure Standardization
- **Status**: Not Started
- **Testing**: Not Started
- **Priority**: Medium
- **Dependencies**: TASK-102.1
- **Added**: 2025-01-23 12:15:00
- **Description**: Align alert data structures between AlertService and SecurityAlertService for consistency.

#### Standardization Requirements
- Standardize severity enum values between services
- Align alert type classifications
- Ensure consistent timestamp handling
- Standardize optional field handling (email, userId, ipAddress)
- Create shared interfaces for common alert data

#### Files to Modify
- `angular/backend/src/modules/auth/services/alert.service.ts`: Update AlertPayload interface
- `angular/backend/src/modules/auth/entities/security-alert.entity.ts`: Align with AlertPayload
- Create shared alert interfaces in common module

### BUG-022: Create Missing TypeORM Entities for Database Tables
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: BUG-021
- **Added**: 2025-05-23
- **Description**: Create TypeORM entities for database tables that exist but have no corresponding entity definitions.

#### Implementation Notes
- **Missing Entities**:
  - `resources` table → Create `Resource` entity
  - `cache_components` table → Create `CacheComponent` entity
  - `cache_routes` table → Create `CacheRoute` entity
  - `cache_endpoints` table → Create `CacheEndpoint` entity

- **Files to Create**:
  - `angular/backend/src/modules/permissions/entities/resource.entity.ts`
  - `angular/backend/src/modules/permissions/cache-entities/cache-component.entity.ts`
  - `angular/backend/src/modules/permissions/cache-entities/cache-route.entity.ts`
  - `angular/backend/src/modules/permissions/cache-entities/cache-endpoint.entity.ts`

### BUG-025: Review and Fix Nullability Mismatches
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: BUG-021, BUG-022, BUG-023
- **Added**: 2025-05-23
- **Description**: Investigate and resolve nullability mismatches between database schema and entity definitions, particularly for ID columns that show as nullable in database but non-nullable in entities.

#### Implementation Notes
- **Primary Issue**: All primary key `id` columns show as nullable in database but non-nullable in entities (19 total mismatches)
- **Root Cause**: Likely SQLite introspection issue rather than actual nullability problems
- **Action**: Investigate if SQLite schema introspection is causing false positives
- **Priority**: Low - Most mismatches are likely false positives

## Low Priority

## On Hold / Future Consideration 