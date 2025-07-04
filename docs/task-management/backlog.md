# Project Backlog

Last Updated: 2025-07-03 10:33:38

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
- **Status**: Dev-Complete ✅ - Ready for Production Testing
- **Testing**: Build Successful ✅ - Backend and Frontend compilation verified
- **Dependencies**: FEAT-120 ✅, BUG-112 ✅
- **Added**: 2025-07-01 17:05:10
- **Started**: 2025-07-03 10:39:51
- **Dev-Complete**: 2025-07-03 11:45:00
- **Description**: ✅ DEV-COMPLETE - Successfully implemented pattern type summary dashboard tiles with click-to-filter navigation following existing statistics card design patterns. All phases complete and builds successful.

#### Complete Implementation Plan
**Executive Summary**: Implement pattern type summary dashboard tiles that provide an overview of the 7 detected pattern types with click-to-filter navigation. This follows the existing statistics card design pattern and enhances the login monitoring dashboard with actionable insights.

**Pattern Types to Display** (7 total):
1. `brute_force` - Brute Force Attacks
2. `distributed_attack` - Distributed Attacks  
3. `credential_stuffing` - Credential Stuffing
4. `rapid_account_switching` - Account Switching
5. `ip_hopping` - IP Hopping
6. `suspicious_location` - Suspicious Locations
7. `time_anomaly` - Time Anomalies

#### Phase 1: Backend Implementation
**1.1 New Endpoint Creation**:
- File: `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`
- Endpoint: `@Get('patterns/summary')` with time filter support
- Return: `PatternSummaryDto[]` with counts, severity, and timestamps

**1.2 Service Layer Enhancement**:
- File: `angular/backend/src/modules/auth/services/pattern-detection.service.ts`
- Method: `getPatternSummary(timeFilter?: TimeFilterDto)`
- Features: Efficient aggregation queries, severity distribution, recent timestamps

**1.3 DTOs Creation**:
- `angular/backend/src/modules/auth/dto/pattern-summary.dto.ts`
- `angular/backend/src/modules/auth/dto/pattern-summary-query.dto.ts`
- Structure: `{ patternType, count, severity, lastDetected, displayName }`

#### Phase 2: Frontend Infrastructure
**2.1 Time Filter Component**:
- Files: `time-filter.component.ts/html/scss`
- Features: Predefined ranges (24h, 7d, 30d, 90d, All), custom date picker
- Default: "Last 30 Days" for reasonable initial view

**2.2 Service Integration**:
- File: `angular/frontend/src/app/core/services/login-monitoring.service.ts`
- Method: `getPatternSummary(timeFilter?: TimeFilter)`
- Interface: `pattern-summary.interface.ts`

#### Phase 3: Dashboard Integration
**3.1 Summary Tiles Grid**:
- File: `login-monitoring.component.html`
- Layout: Follow existing `.stats-grid` pattern above tabs
- Design: 7 tiles with pattern-specific icons and colors

**3.2 Component Logic**:
- File: `login-monitoring.component.ts`
- Methods: `loadPatternSummary()`, `onTimeFilterChange()`, `onPatternTileClick()`
- Navigation: Click tile → Pattern Detection tab with filter applied

**3.3 Styling**:
- File: `login-monitoring.component.scss`
- Features: Consistent `.stat-card` styling, severity-based colors, hover effects

#### Phase 4: User Experience Features
**4.1 Visual Design**: Pattern-specific icons, severity-based colors, responsive grid
**4.2 Interactive Behaviors**: Loading states, error handling, click feedback
**4.3 Accessibility**: ARIA labels, keyboard navigation, WCAG AA compliance

#### Phase 5: Integration Testing
**5.1 Component Testing**: Time filter validation, tile navigation, API integration
**5.2 User Experience**: Navigation flow, performance, responsive design
**5.3 Build Verification**: Frontend compilation, backend tests, bundle size

#### Implementation Sequence
- **Day 1**: Backend endpoint and service layer (Phase 1)
- **Day 2**: Frontend infrastructure and service integration (Phase 2)
- **Day 3**: Dashboard UI implementation (Phase 3)
- **Day 4**: User experience polish and testing (Phase 4-5)

#### Success Criteria
1. **Functional**: 7 pattern type tiles displaying accurate counts
2. **Interactive**: Click navigation to filtered Pattern Detection tab
3. **Performant**: Sub-second loading with time filter changes
4. **Accessible**: WCAG AA compliance and keyboard navigation
5. **Maintainable**: Follows existing design patterns and architecture

#### Files to Create/Modify
**Backend**:
- `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`: Add summary endpoint
- `angular/backend/src/modules/auth/services/pattern-detection.service.ts`: Add getPatternSummary() method
- `angular/backend/src/modules/auth/dto/pattern-summary.dto.ts`: New DTO
- `angular/backend/src/modules/auth/dto/pattern-summary-query.dto.ts`: New query DTO

**Frontend**:
- `angular/frontend/src/app/modules/admin/login-monitoring/components/time-filter/`: New time filter component
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.html`: Add summary tiles section
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.ts`: Add summary data loading and click handlers
- `angular/frontend/src/app/modules/admin/login-monitoring/login-monitoring.component.scss`: Add tile-specific styling
- `angular/frontend/src/app/core/services/login-monitoring.service.ts`: Add getPatternSummary() method
- `angular/frontend/src/app/models/pattern-summary.interface.ts`: New interface

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

## Medium Priority



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