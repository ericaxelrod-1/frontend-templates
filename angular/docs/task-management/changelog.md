# Changelog
Last Updated: 2024-06-30

## In Progress
### [No items currently in progress]

## Completed Today (2024-06-30)
### BUG-006: Fix 401 Errors on Public Pages
- **Started**: 2024-06-30
- **Completed**: 2024-06-30
- **Implementation Notes**: Fixed 401 unauthorized errors occurring on public pages (login, register) by improving dynamic access control implementation:
  - Updated AuthInterceptor to correctly identify all public endpoints including forgot-password, reset-password, and verify-email
  - Modified bootstrap process to defer role initialization until after authentication
  - Enhanced roles service with better error handling and a reset method
  - Integrated role loading with auth state to only load after successful login/verification
- **Files Modified**:
  - `angular/frontend/src/app/core/interceptors/auth.interceptor.ts`:
    - Updated shouldSkipToken method to include all public endpoints
  - `angular/frontend/src/app/app.config.ts`:
    - Removed roles initialization from APP_INITIALIZER
  - `angular/frontend/src/app/core/constants/roles.ts`:
    - Added error handling to initialize method
    - Added reset method for logout scenarios
    - Improved initialization state tracking
  - `angular/frontend/src/app/store/auth/auth.state.ts`:
    - Added LoadRoles action and related handlers
    - Integrated role loading with authentication events
    - Updated state model to track roles loaded state
- **Testing Results**:
  - 401 errors on public pages: Fixed
  - Role initialization: Properly deferred until after authentication
  - Login/verification flow: Successfully loads roles when needed

### BUG-005: Angular Application Build Errors
- **Started**: 2024-06-30
- **Completed**: 2024-06-30
- **Implementation Notes**: Fixed multiple build errors in the Angular application that were preventing successful compilation. Added missing methods, fixed incorrect references, corrected type mismatches, and resolved syntax errors.
- **Files Modified**:
  - `angular/frontend/src/app/core/services/auth.service.ts`:
    - Added missing `register()` method implementation
    - Added missing `refreshAuthStateFromStorage()` method implementation
    - Fixed incorrect method reference from `loadAuthStateFromStorage()` to `readAuthStateFromStorage()`
  - `angular/frontend/src/app/features/auth/register/register.component.ts`:
    - Fixed type issues in parameters and return types
    - Corrected unterminated template literals
    - Added proper type annotations in callback functions
  - `angular/frontend/src/app/features/auth/verify-email/verify-email.component.ts`:
    - Fixed the verifyEmail method to accept the email parameter
    - Added missing methods required by interfaces
  - `angular/frontend/src/app/features/auth/forgot-password/forgot-password.component.ts`:
    - Fixed type issues in the forgotPassword API call
- **Testing Results**:
  - Build verification: Passed
  - Remaining warnings:
    - Bundle size warnings (initial bundle size of 1.12MB exceeds 1.00MB limit)
    - Register component stylesheet warnings (10.23KB exceeds 8.00KB limit)
    - API call issues during server-side rendering (expected due to absence of backend)
    - Non-ESM module warning for 'nodemailer' in email service

### BUG-003: AuthService Logout Method Implementation
- **Started**: 2023-05-10
- **Completed**: 2023-05-10
- **Implementation Notes**: Fixed missing logout method in AuthService that was causing linter errors in auth.interceptor.ts. Implemented proper logout functionality with token clearing and server-side logout.
- **Files Modified**:
  - `angular/frontend/src/app/core/services/auth.service.ts`:
    - Added public `logout()` method that calls private `clearAuthState()`
    - Implemented navigation to login page after logout
    - Added server-side logout API call with refresh token if available
    - Gracefully handles errors during logout process
  - `angular/frontend/src/app/core/interceptors/auth.interceptor.ts`:
    - Updated to call the new `logout()` method when token refresh fails
    - Fixed unused variable linter errors
    - Improved error handling during token refresh
- **Testing Results**:
  - Linter verification: Passed
  - Logout functionality: Passed
  - Token clearing: Passed

### BUG-004: ESLint Error Fixes
- **Started**: 2023-05-10
- **Completed**: 2023-05-10
- **Implementation Notes**: Fixed various ESLint errors throughout the codebase, focusing on unused variables and any type issues in authentication-related files.
- **Files Modified**:
  - `angular/frontend/src/app/core/interceptors/auth.interceptor.ts`:
    - Renamed unused `_error` variable to follow conventions
    - Fixed error handling in token refresh logic
  - `angular/frontend/src/app/core/services/auth.service.ts`:
    - Re-added `UserLogin` and `UserRegistration` imports that were incorrectly removed
    - Fixed unused variable warnings
    - Addressed unexpected `any` type warnings
- **Testing Results**:
  - ESLint validation: Improved (reduced error count)
  - Build verification: Passed

### TECH-003: Project Structure Cleanup for Dynamic Access Control
- **Started**: 2023-05-10
- **Completed**: 2023-05-10
- **Implementation Notes**: Cleaned up duplicate directories and relocated example files related to the dynamic access control system to maintain a consistent project structure.
- **Files Modified**:
  - Moved `angular/docs/examples/permission-example.component.ts` to `angular/frontend/src/app/examples/permission-example.component.ts`:
    - Relocated example component to proper location in the frontend source tree
    - Ensures example is available in the correct namespace
  - Moved `angular/docs/examples/permission-example.controller.ts` to `angular/frontend/src/app/examples/permission-example.controller.ts`:
    - Relocated example controller to proper location in the frontend source tree
    - Maintains consistent code organization
- **Directories Removed**:
  - `angular/docs/angular` - Removed duplicate documentation directory
  - `angular/docs/examples` - Removed after moving files to proper location
  - `angular/backend/angular` - Removed empty duplicate directory structure
- **Testing Results**:
  - Directory structure validation: Passed
  - File location verification: Passed

### FEAT-002: Example Completed Feature
- **Started**: 2023-05-09
- **Completed**: 2023-05-10
- **Implementation Notes**: Implemented the example feature with the following approach...
- **Files Modified**:
  - `src/app/example/example.component.ts`: 
    - Added new method for handling user input
    - Updated template binding
  - `src/app/example/example.service.ts`: 
    - Created new service method to process data
    - Added error handling
- **Testing Results**:
  - Unit Tests: Passed
  - Integration Tests: Passed
  - E2E Tests: Not Applicable
  - Coverage: 85%

## Recent Completions (Last 7 Days)
### [No items in recent completions] 