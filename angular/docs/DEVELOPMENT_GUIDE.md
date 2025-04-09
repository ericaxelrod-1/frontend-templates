# Angular Template Application - Development Guide

## Table of Contents
1. [Development Environment](#development-environment)
2. [Project Structure](#project-structure)
3. [Coding Standards](#coding-standards)
4. [Component Development](#component-development)
5. [Styling Guidelines](#styling-guidelines)
6. [State Management](#state-management)
7. [Application Branding](#application-branding)
8. [Email Verification](#email-verification)
9. [GDPR Compliance](#gdpr-compliance)
10. [Testing](#testing)
11. [Quality Verification Tools](#quality-verification-tools)
12. [Deployment](#deployment)
13. [Troubleshooting](#troubleshooting)

## Development Environment

### Required Tools
- Node.js (version 14 or higher)
- npm (version 6 or higher)
- Angular CLI (version 12 or higher)
- Git

### Editor Recommendations
- Visual Studio Code with the following extensions:
  - Angular Language Service
  - ESLint
  - Stylelint
  - Prettier
  - EditorConfig

### Setup Instructions
1. Clone the repository:
   ```bash
   git clone https://github.com/organization/angular-template.git
   cd angular-template
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Access the application at http://localhost:4200

## Project Structure

### Directory Organization
The project follows a feature-based organization:

```
/src/app/
├── core/            # Core functionality (services, guards, interceptors)
├── shared/          # Shared components, directives, pipes
├── features/        # Feature modules
│   ├── auth/        # Authentication related components
│   ├── dashboard/   # Dashboard feature
│   ├── users/       # User management
│   └── groups/      # Group management
├── layouts/         # Layout components
└── models/          # Data models/interfaces
```

### Module Organization
- **Core Module**: Contains singleton services and application-wide providers
- **Shared Module**: Contains reusable components, directives, and pipes
- **Feature Modules**: Contains feature-specific components and services
- **Layout Module**: Contains layout-related components

## Coding Standards

### General Guidelines
- Follow the [Angular Style Guide](https://angular.io/guide/styleguide)
- Use TypeScript's strict mode
- Implement proper error handling
- Use Angular's built-in security features
- Document complex logic with comments

### Naming Conventions
- **Files**: kebab-case (e.g., `user-profile.component.ts`)
- **Classes**: PascalCase (e.g., `UserProfileComponent`)
- **Methods and Properties**: camelCase (e.g., `getUserById()`)
- **Interfaces**: PascalCase with prefix I (e.g., `IUserProfile`)
- **Enums**: PascalCase (e.g., `UserRole`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_USERS`)

### Code Organization
- Limit files to 400 lines
- Limit functions to 75 lines
- Organize imports alphabetically
- Prefer composition over inheritance
- Follow the Single Responsibility Principle

## Component Development

### Component Structure
- Use the OnPush change detection strategy when possible
- Implement lifecycle hooks in the order they are called
- Keep components focused on a single responsibility
- Use @Input() and @Output() for component communication

### Template Guidelines
- Keep templates simple and readable
- Use structural directives sparingly
- Prefer ngFor with trackBy
- Use async pipe for observables
- Implement proper form validation

### Component Example
```typescript
@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserCardComponent implements OnInit, OnDestroy {
  @Input() user: IUser;
  @Output() userSelected = new EventEmitter<IUser>();
  
  private destroy$ = new Subject<void>();
  
  constructor(private userService: UserService) {}
  
  ngOnInit(): void {
    // Initialize component
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  selectUser(): void {
    this.userSelected.emit(this.user);
  }
}
```

## Styling Guidelines

### SCSS Structure
- Use SCSS for styling
- Organize styles in a component-specific manner
- Use BEM methodology for class naming
- Create reusable mixins and variables in the global styles directory

### Color Palette
- Use the defined color variables from `_variables.scss`
- Don't use hardcoded color values in component styles
- Refer to the theme configuration for Material components

### Typography
- Use the typography system defined in `_typography.scss`
- Stick to the predefined font sizes and weights
- Use rem units for font sizes to support accessibility

### Layout Practices
- Use CSS Grid and Flexbox for layouts
- Implement responsive designs using the defined breakpoints
- Avoid nested layout components (use the layout-nesting check tool)
- Prevent component styles from leaking with proper encapsulation

### Accessibility
- Ensure proper contrast ratios
- Use semantic HTML elements
- Include ARIA attributes when necessary
- Test with screen readers

## State Management

### NGXS Guidelines
- Organize states by feature
- Define clear actions for state changes
- Implement selectors for accessing state
- Document state interfaces
- Use action handlers for side effects

### State Organization
```typescript
export namespace UserState {
  export interface State {
    users: IUser[];
    selectedUser: IUser | null;
    loading: boolean;
    error: string | null;
  }
  
  export const initialState: State = {
    users: [],
    selectedUser: null,
    loading: false,
    error: null
  };
}
```

### Actions Example
```typescript
export class LoadUsers {
  static readonly type = '[User] Load Users';
}

export class LoadUsersSuccess {
  static readonly type = '[User] Load Users Success';
  constructor(public users: IUser[]) {}
}

export class LoadUsersFailure {
  static readonly type = '[User] Load Users Failure';
  constructor(public error: string) {}
}
```

## Application Branding

### Overview
The application includes a consistent branding system that can be easily customized. It uses the AppConfigService to provide dynamic branding elements across all components.

### Configuration
Branding is configured in the `app-config.ts` file in the environments directory:

```typescript
export const appConfig = {
  // Application name displayed in various places
  appName: 'My Custom App',
  
  // Logo paths
  logos: {
    // Large logo used on the landing page
    landingLogo: 'assets/logos/logo-large.svg',
    
    // Logo used in the header
    headerLogo: 'assets/logos/logo-header.svg',
    
    // Small logo used in the footer
    footerLogo: 'assets/logos/logo-small.svg',
    
    // Favicon
    favicon: 'assets/logos/favicon.svg'
  },
  
  // Theme colors - These should match the logo design
  theme: {
    primary: '#3f51b5',   // Primary color
    secondary: '#ff4081', // Secondary/accent color
  }
};
```

### Using Branding in Components
To include branding in a component:

1. Import the AppConfigService:
```typescript
import { AppConfigService } from '../../core/services';
```

2. Add properties for the branding elements:
```typescript
// App configuration properties
appName: string;
landingLogo: string;
```

3. Initialize in the constructor:
```typescript
constructor(private appConfig: AppConfigService) {
  this.appName = this.appConfig.appName;
  this.landingLogo = this.appConfig.landingLogo;
}
```

4. Use in the template:
```html
<div class="logo-container">
  <img *ngIf="landingLogo" [src]="landingLogo" alt="{{appName}} Logo" class="app-logo">
  <h1 *ngIf="!landingLogo">{{appName}}</h1>
</div>
```

5. Add appropriate styles:
```scss
.logo-container {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24px;

  h1 {
    margin: 0;
    color: var(--primary);
    font-size: 28px;
  }
  
  .app-logo {
    max-width: 180px;
    max-height: 70px;
    object-fit: contain;
  }
}
```

### Logo Standards
- **Landing Logo**: 180px × 70px (maximum dimensions)
- **Header Logo**: 40px height (width auto)
- **Footer Logo**: 30px height (width auto)
- All logos should be provided in SVG format for best quality
- Include fallback text display when logo is unavailable

## Email Verification

### Overview
The application includes an email verification system for new user registrations. This system helps confirm user identity and reduce spam accounts.

### Verification Flow
1. User registers a new account
2. System generates a verification token
3. Verification email is sent to the user's email address
4. User clicks the verification link
5. System validates the token
6. User account is marked as verified

### Configuration Options
Email verification is configured in the environment file:

```typescript
export const environment = {
  // ...other settings
  emailVerification: {
    required: true,                         // Whether email verification is required
    tokenExpiry: 24 * 60 * 60 * 1000,       // Token expiry time in milliseconds (24 hours)
    baseUrl: 'http://localhost:4200',       // Base URL for verification links
  }
};
```

### Implementing Verification Checks
To enforce email verification in protected routes:

```typescript
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): Observable<boolean> {
    return this.authService.currentUser$.pipe(
      map(user => {
        if (user && !user.emailVerified) {
          this.router.navigate(['/verify-email']);
          return false;
        }
        return true;
      })
    );
  }
}
```

### Customizing Email Templates
Email templates are located in the `server/email-service/templates` directory. The verification email template can be customized to match your application branding.

## GDPR Compliance

### Overview
The application includes features to ensure compliance with General Data Protection Regulation (GDPR). These features help protect user data and privacy rights.

### Key GDPR Features

#### User Data Export
Users can request a copy of their personal data:

```typescript
export class ExportUserData {
  static readonly type = '[User] Export User Data';
  constructor(public userId: string) {}
}
```

Implementation in the state:

```typescript
@Action(ExportUserData)
exportUserData(ctx: StateContext<UserStateModel>, action: ExportUserData) {
  return this.userService.exportUserData(action.userId).pipe(
    tap(userData => {
      // Generate downloadable file with user data
      const dataStr = JSON.stringify(userData);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      
      const exportFileDefaultName = 'user-data.json';
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    })
  );
}
```

#### Account Deletion
Users can request account deletion:

```typescript
export class DeleteAccount {
  static readonly type = '[User] Delete Account';
  constructor(public userId: string, public confirmationPassword: string) {}
}
```

Implementation in the state:

```typescript
@Action(DeleteAccount)
deleteAccount(ctx: StateContext<UserStateModel>, action: DeleteAccount) {
  return this.userService.deleteAccount(action.userId, action.confirmationPassword).pipe(
    tap(() => {
      // Clear user data and redirect to home
      ctx.dispatch(new Logout());
      this.router.navigate(['/']);
    })
  );
}
```

#### Privacy Policy
The application includes a privacy policy that clearly explains:
- What data is collected
- How data is used
- User rights regarding their data
- Data retention policies
- Contact information for data queries

#### Consent Management
Implement consent tracking for various features:

```typescript
export interface UserConsent {
  marketingEmails: boolean;
  dataAnalytics: boolean;
  thirdPartySharing: boolean;
  consentTimestamp: Date;
}
```

### GDPR Compliance Checklist
- [ ] Privacy policy is accessible and clear
- [ ] User consent is properly recorded
- [ ] Data export functionality works correctly
- [ ] Account deletion completely removes user data
- [ ] Data breach notification system is in place
- [ ] Data processing activities are documented

## Testing

### Unit Testing
- Write unit tests for all components and services
- Use TestBed for Angular-specific testing
- Mock dependencies when necessary
- Focus on behavior, not implementation details

### Component Testing Example
```typescript
describe('UserCardComponent', () => {
  let component: UserCardComponent;
  let fixture: ComponentFixture<UserCardComponent>;
  
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [UserCardComponent],
      providers: [
        { provide: UserService, useValue: mockUserService }
      ]
    }).compileComponents();
  });
  
  beforeEach(() => {
    fixture = TestBed.createComponent(UserCardComponent);
    component = fixture.componentInstance;
    component.user = mockUser;
    fixture.detectChanges();
  });
  
  it('should create', () => {
    expect(component).toBeTruthy();
  });
  
  it('should emit userSelected event when selectUser is called', () => {
    spyOn(component.userSelected, 'emit');
    component.selectUser();
    expect(component.userSelected.emit).toHaveBeenCalledWith(mockUser);
  });
});
```

### Directive Testing
Directives, especially structural directives like `*hasPermission`, require thorough testing to ensure they properly control UI elements based on permissions:

```typescript
describe('HasPermissionDirective', () => {
  let fixture: ComponentFixture<TestComponent>;
  let permissionService: jasmine.SpyObj<PermissionService>;
  
  // Create a test component that uses the directive
  @Component({
    template: `
      <div *hasPermission="'users:read'">Content for users:read</div>
      <div *hasPermission="'users:write'">Content for users:write</div>
      <div *hasPermission="'roles:read'; else noAccess">Content for roles:read</div>
      <ng-template #noAccess>No access template content</ng-template>
    `
  })
  class TestComponent {}
  
  beforeEach(() => {
    // Set up the testing module with mocked permission service
    permissionService = jasmine.createSpyObj('PermissionService', ['hasPermission', 'hasAnyPermission']);
    
    TestBed.configureTestingModule({
      declarations: [TestComponent, HasPermissionDirective],
      providers: [{ provide: PermissionService, useValue: permissionService }]
    });
    
    // Default to denying permissions
    permissionService.hasPermission.and.returnValue(of(false));
    permissionService.hasAnyPermission.and.returnValue(of(false));
  });
  
  it('should show content when permission is granted', () => {
    // Grant a specific permission
    permissionService.hasPermission.and.callFake((permission) => {
      return of(permission === 'users:read');
    });
    
    // Create component and detect changes
    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();
    
    // Verify only the permitted content is shown
    const elements = fixture.debugElement.queryAll(By.css('div'));
    expect(elements.length).toBe(1);
    expect(elements[0].nativeElement.textContent).toBe('Content for users:read');
  });
  
  it('should show else template when permission is denied', () => {
    // Deny all permissions
    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();
    
    // Verify the else template is shown
    expect(fixture.nativeElement.textContent).toContain('No access template content');
  });
});
```

To run directive tests specifically:

```bash
cd angular/frontend
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

This launches Karma test runner in Chrome, executing only the specified directive tests.

### E2E Testing
- Write E2E tests for critical user journeys
- Use Cypress for E2E testing
- Organize tests by feature
- Mock API responses when necessary

## Quality Verification Tools

### Available Tools
This project includes several tools to ensure code quality:

#### Style Validation
- **Stylelint**: Enforces SCSS coding standards
  ```bash
  npm run lint:styles
  ```

#### CSS Quality Checks
- **Duplicate CSS Checker**: Prevents duplicate CSS selectors
  ```bash
  npm run check:duplicate-css
  ```

#### Material Theme Validation
- **Material Theme Validator**: Ensures proper Angular Material theme configuration
  ```bash
  npm run check:material-theme
  ```

#### Layout Validation
- **Layout Nesting Checker**: Prevents layout component nesting issues
  ```bash
  npm run check:layout-nesting
  ```

### Comprehensive Verification
Run all verification tools at once:
```bash
npm run verify
```

### Adding New Tools
To add a new verification tool:
1. Create a new JavaScript file in the `tools/` directory
2. Implement the validation logic with clear console output
3. Add a script entry in `package.json`
4. Update the README in the tools directory
5. Document the tool in this guide

## Deployment

### Build Process
1. Build the application for production:
   ```bash
   npm run build
   ```

2. The built application will be in the `dist/` directory

### Deployment Environments
- **Development**: Used for ongoing development
- **Staging**: Used for testing before production
- **Production**: Live environment

### Environment Configuration
- Use environment-specific files in `src/environments/`
- Configure environment variables for backend APIs
- Set production mode accordingly

## Troubleshooting

### Common Issues
- **Module not found errors**: Check import paths and make sure the module exists
- **Dependency issues**: Run `npm install` to update dependencies
- **Style not applying**: Check component encapsulation and selector specificity
- **State management issues**: Check action dispatches and selectors

### Debug Tools
- Use Angular DevTools for component debugging
- Use Redux DevTools for state debugging
- Check browser console for errors

### Logging
- Use the logging service for application logging
- Configure log levels based on environment
- Include relevant context in log messages

## Additional Resources

### Angular Documentation
- [Angular Official Documentation](https://angular.io/docs)
- [Angular Material Documentation](https://material.angular.io/components/categories)
- [NGXS Documentation](https://www.ngxs.io/)

### Style Guides
- [Angular Style Guide](https://angular.io/guide/styleguide)
- [TypeScript Style Guide](https://github.com/basarat/typescript-book/blob/master/docs/styleguide/styleguide.md)
- [SCSS Style Guide](https://sass-guidelin.es/) 