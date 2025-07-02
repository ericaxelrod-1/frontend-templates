# Project Backlog

Last Updated: 2025-07-02 14:48:19

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

## High Priority

### FEAT-121: Pattern Type Summary Dashboard Tiles
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: FEAT-120 ✅, BUG-112 ✅
- **Added**: 2025-07-01 17:05:10
- **Description**: Add summary tiles for each of the 7 detected pattern types with click-to-filter navigation to Pattern Detection tab. Follow existing design patterns from statistics cards.

#### Implementation Requirements
**Pattern Types to Display** (7 total):
1. `brute_force` - Brute Force Attacks
2. `distributed_attack` - Distributed Attacks  
3. `credential_stuffing` - Credential Stuffing
4. `rapid_account_switching` - Account Switching
5. `ip_hopping` - IP Hopping
6. `suspicious_location` - Suspicious Locations
7. `time_anomaly` - Time Anomalies

**Backend Requirements**:
- Create new endpoint `/api/login-monitoring/patterns/summary` returning pattern type counts
- Support time filter parameter for summary data (separate from tab-specific filters)
- Return format: `{ patternType: string, count: number, severity: 'high' | 'medium' | 'low', lastDetected: Date }[]`
- Implement efficient aggregation queries with proper time filtering

**Frontend Requirements**:
- Follow existing statistics card design pattern from login monitoring dashboard
- Create summary tiles grid similar to "Total Attempts", "Successful", "Failed", etc.
- Implement click handler to navigate to Pattern Detection tab with pre-applied filter
- Use consistent styling and layout with existing dashboard elements
- Add loading states and error handling for summary data

**Navigation Behavior**:
- Click tile → Navigate to Pattern Detection tab
- Auto-apply filter for selected pattern type
- Maintain other active filters (time range, severity, etc.)
- Update URL to reflect filtered state for bookmarking/sharing

**Design Pattern Reference**:
- Follow existing `.stats-grid` layout and `.stat-card` styling
- Use pattern-specific icons and colors for visual distinction
- Include severity-based color coding (red/orange/yellow)
- Show count, pattern type name, and last detected timestamp

**Files to Create/Modify**:
- `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`: Add summary endpoint
- `angular/backend/src/modules/auth/services/pattern-detection.service.ts`: Add getPatternSummary() method
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`: Add summary tiles section
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Add summary data loading and click handlers
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.scss`: Add tile-specific styling

### FEAT-122: Global Time Filter for Summary Tiles
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: FEAT-121
- **Added**: 2025-07-01 17:05:10
- **Description**: Add time filter component for summary tiles that operates independently from tab-specific filters. Follow existing design patterns from filter components.

#### Implementation Requirements
**Time Filter Options**:
- Last 24 Hours
- Last 7 Days  
- Last 30 Days
- Last 90 Days
- Custom Date Range
- All Time

**Design Pattern Reference**:
- Follow existing filter component patterns from PatternDetectionFiltersComponent and SecurityAlertsFiltersComponent
- Use mat-select for predefined time ranges and mat-date-range-picker for custom ranges
- Position above summary tiles grid, separate from tab-specific filters
- Include clear visual separation from tab content

**Backend Integration**:
- Pass time filter parameters to `/api/login-monitoring/patterns/summary` endpoint
- Support both predefined ranges and custom date ranges
- Implement efficient time-based queries with proper indexing considerations
- Return empty results gracefully for periods with no data

**Frontend Requirements**:
- Create reusable time filter component following existing patterns
- Implement proper form validation for custom date ranges
- Add loading states during filter changes
- Persist selected time filter in component state (not URL since it's global)
- Auto-refresh summary data when time filter changes

**User Experience**:
- Default to "Last 30 Days" for reasonable initial view
- Provide immediate visual feedback when changing filters
- Show "No data for selected period" message when appropriate
- Maintain filter selection during tab navigation

**Files to Create/Modify**:
- `angular/frontend/src/app/modules/admin/login-monitoring/components/time-filter/time-filter.component.ts`: Create reusable time filter component
- `angular/frontend/src/app/modules/admin/login-monitoring/components/time-filter/time-filter.component.html`: Time filter template
- `angular/frontend/src/app/modules/admin/login-monitoring/components/time-filter/time-filter.component.scss`: Time filter styling
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`: Integrate time filter above summary tiles
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Handle time filter events and data refresh
- `angular/backend/src/modules/auth/services/pattern-detection.service.ts`: Update getPatternSummary() to support time filtering

### FEAT-123: Severity Indicator Color Coding for Pattern Detection Results
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: FEAT-120 ✅
- **Added**: 2025-07-01 17:05:10
- **Description**: Add color coding to severity indicators in Pattern Detection results table following existing design patterns. Implement yellow/orange/red color scheme for low/medium/high severity levels.

#### Implementation Requirements
**Color Scheme** (following existing patterns):
- **Low Severity**: Yellow (`$warning-color` or `--mat-sys-warning`)
- **Medium Severity**: Orange (`$warning-color` darker variant)
- **High Severity**: Red (`--mat-sys-error`)
- **Critical Severity**: Dark Red (`--mat-sys-error` darker variant)

**Design Pattern Reference**:
- Follow existing severity styling from `.severity-high`, `.severity-medium`, `.severity-low` classes
- Use consistent color variables from `abstracts/_colors.scss`
- Apply to mat-chip components in pattern results table
- Ensure accessibility compliance with sufficient contrast ratios

**Implementation Approach**:
- Extend existing `getSeverityClass()` method to handle all severity levels
- Update severity chip styling in pattern results table
- Add hover effects and proper focus states for accessibility
- Include severity color coding in summary tiles as well

**Template Updates**:
```html
<mat-chip [class]="getSeverityClass(pattern.severity)">
  {{ pattern.severity | uppercase }}
</mat-chip>
```

**SCSS Requirements**:
- Extend existing severity classes to include critical level
- Use CSS custom properties for theme consistency
- Add transition effects for smooth color changes
- Ensure proper contrast for text readability

**Files to Modify**:
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.scss`: Add/update severity color classes
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Update getSeverityClass() method if needed
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`: Ensure proper class application to severity indicators

**Testing Requirements**:
- Verify color coding works for all severity levels (low, medium, high, critical)
- Test accessibility with screen readers and high contrast modes
- Validate color consistency across different browsers
- Ensure color coding appears in both pattern results table and summary tiles

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