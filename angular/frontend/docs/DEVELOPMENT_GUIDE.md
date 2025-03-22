# Angular Template Application - Development Guide

## Table of Contents
1. [Development Environment](#development-environment)
2. [Project Structure](#project-structure)
3. [Coding Standards](#coding-standards)
4. [Component Development](#component-development)
5. [Styling Guidelines](#styling-guidelines)
6. [State Management](#state-management)
7. [Testing](#testing)
8. [Quality Verification Tools](#quality-verification-tools)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

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