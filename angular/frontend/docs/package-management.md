# Package Management Documentation

This document tracks all third-party dependencies used in the project, following the package management guidelines.

## Angular Core Packages

### @angular/core

- **Version**: 19.2.3
- **Purpose**: Core functionality of Angular framework
- **Alternatives Considered**: 
  - Maintaining v16: Not selected due to compatibility issues with other packages already at v19
  - React: Not selected as project is specifically designed for Angular architecture
- **Documentation**: https://angular.dev/
- **License**: MIT
- **Research Findings**: 
  - Released on March 20, 2025 as part of the Angular 19.2.x minor update
  - Primarily contains bug fixes and performance improvements
  - No critical issues reported in GitHub repository
  - Active development with regular commits
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

### @angular/material

- **Version**: 19.2.6
- **Purpose**: Material Design component library for Angular, providing pre-built UI components
- **Alternatives Considered**: 
  - PrimeNG: Not selected as Material Design is the preferred design system for this project
  - NgBootstrap: Not selected as we needed more comprehensive component library with consistent design patterns
- **Documentation**: https://v19.material.angular.io/
- **License**: MIT
- **Research Findings**:
  - Latest patch release for Angular Material 19
  - Compatible with Angular 19.2.x core packages
  - Includes all Material Design components needed for the project
  - GitHub repository shows active maintenance and quick resolution of bugs
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

### @angular/cdk

- **Version**: 19.2.6
- **Purpose**: Component Development Kit, provides tools for building custom Angular components
- **Alternatives Considered**: 
  - No viable alternatives for Angular Material CDK as it's tightly coupled with Material
- **Documentation**: https://v19.material.angular.io/cdk/
- **License**: MIT
- **Research Findings**:
  - Latest version that matches Angular Material
  - Essential component for Material Design implementation
  - Stable APIs with good documentation
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

## State Management

### @ngxs/store

- **Version**: 19.0.0
- **Purpose**: State management pattern and library for Angular applications
- **Alternatives Considered**: 
  - NgRx: Not selected as NGXS provides a simpler API with less boilerplate
  - Akita: Not selected due to smaller community and less integration with Angular ecosystem
- **Documentation**: https://www.ngxs.io/
- **License**: MIT
- **Research Findings**:
  - Latest version compatible with Angular 19
  - Preferred over older 3.8.1 version for better compatibility with other NGXS plugins
  - Good community support and documentation
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

## Server Packages

### express

- **Version**: 4.21.2
- **Purpose**: Web application framework for Node.js, used for server-side rendering
- **Alternatives Considered**: 
  - Koa: Not selected as Express has better integration with Angular Universal
  - Fastify: Not selected as Express is more widely used and documented
- **Documentation**: https://expressjs.com/
- **License**: MIT
- **Research Findings**:
  - Latest security-patched version
  - Resolved critical vulnerabilities in earlier versions
  - Widely used and stable web framework
- **Security Status**: 
  - Initially had 6 vulnerabilities (3 low, 3 high) in version 4.18.2
  - Updated to 4.21.2 to fix all security issues
  - npm audit now shows 0 vulnerabilities
- **Last Verified**: 2025-03-22

## Utility Libraries

### zone.js

- **Version**: 0.15.0
- **Purpose**: Required by Angular to provide change detection
- **Alternatives Considered**: 
  - None - this is a core Angular dependency
- **Documentation**: https://github.com/angular/angular/tree/main/packages/zone.js
- **License**: MIT
- **Research Findings**:
  - Required version for Angular 19.2.x
  - Essential for Angular's change detection mechanism
  - Stable with no reported issues for this version
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

### rxjs

- **Version**: 7.8.1
- **Purpose**: Reactive programming library for handling asynchronous operations
- **Alternatives Considered**: 
  - None - core requirement for Angular applications
- **Documentation**: https://rxjs.dev/
- **License**: Apache-2.0
- **Research Findings**:
  - Latest stable version compatible with Angular 19
  - Well-maintained with active community
  - No significant issues reported
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

## Version Considerations

The project uses Angular v19 across all Angular packages to ensure compatibility. We specifically resolved the Material theme error by:

1. Upgrading all Angular packages to v19.2.3
2. Updating Material to v19.2.6
3. Using a prebuilt Material theme (purple-green) to avoid SCSS compilation issues
4. Updating zone.js to 0.15.0 to match peer dependency requirements
5. Updating TypeScript to 5.5.2 for compatibility with Angular v19
6. Upgrading @ngxs/store to 19.0.0 to match other NGXS plugins and fix peer dependency conflicts

## Security Audit Status

Security was verified via npm audit, with the following results:

1. **Initial Scan (2025-03-22)**: 
   - 6 vulnerabilities identified (3 low, 3 high)
   - Issues found in express@4.18.2 and related dependencies:
     - body-parser: High severity DoS vulnerability
     - cookie: Low severity out-of-bounds character issue
     - path-to-regexp: High severity ReDoS vulnerability
     - send: Low severity template injection issue

2. **Resolution (2025-03-22)**:
   - Updated express to 4.21.2
   - All vulnerabilities fixed (verified with npm audit)
   - Package.json updated to reflect the secure versions

## Regular Audit Plan

To maintain package security and stability:

1. **Weekly Security Scans**:
   - Run `npm audit` every Friday
   - Address any identified vulnerabilities immediately
   - Document all findings and resolutions

2. **Monthly Dependency Review**:
   - Review all dependencies for updates on the first Monday of each month
   - Prioritize security updates over feature updates
   - Test thoroughly before committing any package upgrades

3. **Quarterly Major Version Evaluation**:
   - Evaluate major version upgrades every quarter
   - Research breaking changes and migration paths
   - Create upgrade plan for major version transitions

4. **Documentation Updates**:
   - Update this document after any package changes
   - Include detailed research findings and security status
   - Maintain exact version pinning

The next scheduled audit will be on 2025-03-29.
