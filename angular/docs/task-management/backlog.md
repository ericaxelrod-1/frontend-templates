# Project Backlog

Last Updated: 2025-07-17 19:50:00

## Critical Priority

*No critical priority items at this time*

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

### FEAT-127.1: Fix Toggle Button Contrast Issues
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: FEAT-127 (Parent task - Complete)
- **Added**: 2025-07-17 18:20:00
- **Priority**: High
- **Description**: The new Simple/Enhanced toggle button has contrast issues that may affect accessibility and visibility. Need to improve the contrast ratios to meet WCAG guidelines.

#### Problem Analysis
- **Current Issue**: Toggle button contrast may not meet accessibility standards
- **Impact**: Users may have difficulty distinguishing between selected/unselected states
- **Requirements**: Must meet WCAG AA contrast ratio standards (minimum 4.5:1 for normal text)

#### Implementation Requirements
- **Accessibility Compliance**: Ensure toggle states meet WCAG AA contrast ratios
- **Visual Clarity**: Improve distinction between Simple and Enhanced modes
- **Theme Consistency**: Maintain consistency with existing Angular Material theme
- **Cross-Browser Testing**: Verify contrast works across different browsers and displays

#### Files To Modify
- `angular/frontend/src/app/modules/admin/pattern-detection/pattern-detection.component.scss`
- Potentially: Material Design theme overrides

#### Acceptance Criteria
- [ ] Toggle button meets WCAG AA contrast ratio requirements (4.5:1 minimum)
- [ ] Clear visual distinction between selected and unselected states
- [ ] Consistent with application's Material Design theme
- [ ] Tested on multiple browsers and screen settings
- [ ] Maintains existing functionality and responsive behavior

#### Technical Implementation Notes
- **Current Toggle CSS**: Located in pattern-detection.component.scss under `.test-mode-toggle`
- **Material Theme**: Uses Angular Material's button-toggle component
- **Accessibility Tools**: Use browser dev tools or accessibility checkers to verify contrast ratios
- **Testing**: Verify contrast in both light and dark themes if applicable

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