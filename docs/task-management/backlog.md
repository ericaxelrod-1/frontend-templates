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
- **Status**: Phase 1 Complete ✅ - SecurityAlertsFiltersComponent implemented
- **Testing**: Build Successful ✅
- **Dependencies**: BUG-109 ✅
- **Added**: 2025-01-26 19:25:00
- **Phase 1 Completed**: 2025-01-27 21:15:00
- **Description**: Pattern Detection and Security Alerts tabs lack appropriate filtering capabilities. **Phase 1 COMPLETE**: SecurityAlertsFiltersComponent fully implemented with 5 filter types and backend integration.

#### Investigation Results (@999-bugfinder - Completed 2025-01-27)
**ROOT CAUSE IDENTIFIED**: Architecture gap where each tab requires specific filter components tailored to their data types, but currently only a generic login attempts filter exists.

**BACKEND ANALYSIS**:
- **✅ Pattern Detection**: Backend fully supports filtering via `getSecurityPatterns()` with parameters: `status`, `patternType`, `severity`, `ipAddress`, `sortBy`, `sortDirection`
- **✅ Security Alerts**: Backend fully supports filtering via `getSecurityAlerts()` with parameters: `status`, `severity`, `alertType`, `dateFrom`, `dateTo`, `search`, `sortBy`, `sortDirection`
- **❌ IP Reputation**: Only single IP lookup exists; no bulk dashboard endpoint for filtering

**FRONTEND GAPS**:
- **Missing**: PatternDetectionFiltersComponent with pattern-specific filters
- **Missing**: SecurityAlertsFiltersComponent with alert-specific filters
- **Missing**: IPReputationFiltersComponent with IP-specific filters
- **Service Updates Needed**: Frontend services don't pass filter parameters to backend

**TECHNICAL EVIDENCE**:
- Pattern Types Available: `brute_force`, `distributed_attack`, `credential_stuffing`, `rapid_account_switching`, `ip_hopping`, `suspicious_location`, `time_anomaly`
- Alert Types Available: `pattern_brute_force`, `pattern_credential_stuffing`, `auth_login`, `security_alert`, `test_alert`, `system_alert`
- Severity Options: `low`, `medium`, `high`, `critical`
- Status Options: Pattern (`active`, `resolved`), Alert (`active`, `acknowledged`, `resolved`, `dismissed`)

**COMPONENT REQUIREMENTS**:
1. **PatternDetectionFiltersComponent**: Pattern type dropdown, severity filter, status filter, IP input, date range
2. **SecurityAlertsFiltersComponent**: Status filter, severity filter, alert type dropdown, date range, search box
3. **IPReputationFiltersComponent**: Block status filter, reputation range, attempt count range (requires new backend endpoint)

#### Implementation Requirements
- Create PatternDetectionFiltersComponent with pattern-specific filters
- Create SecurityAlertsFiltersComponent with alert-specific filters  
- Create IPReputationFiltersComponent with IP-specific filters
- Update backend services to support new filter parameters
- Implement tab-specific filter logic in main component
- **Priority Order**: Security Alerts (backend ready) → Pattern Detection (backend ready) → IP Reputation (needs backend work)

es





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