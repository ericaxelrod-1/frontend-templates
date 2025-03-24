# Angular Template Application - Styling Guidelines

## Design Philosophy

The template follows a clean, modern, and minimalist design approach focusing on:
- **Usability**: Intuitive interface with clear navigation
- **Responsiveness**: Mobile-first approach ensuring compatibility across devices
- **Consistency**: Unified look and feel throughout the application
- **Accessibility**: Ensuring all users can interact with the application
- **Branding**: Consistent application of logo and brand identity

## Application Branding

The application provides a flexible branding system through the `AppConfigService`, allowing for easy customization of:
- Application name
- Logo images (landing, header, footer)
- Theme colors

### Logo Implementation Guidelines

#### Logo Placement
- **Authentication Pages**: Centered at the top of the auth card
- **Dashboard**: Left-aligned in the header
- **Footer**: Small logo version

#### Logo Dimensions
- **Landing/Auth Pages Logo**: Maximum dimensions of 180px × 70px
- **Header Logo**: 40px height (width auto)
- **Footer Logo**: 30px height (width auto)

#### Logo HTML Structure
Use the following standard structure for logo containers:
```html
<div class="logo-container">
  <img *ngIf="logoPath" [src]="logoPath" alt="{{appName}} Logo" class="app-logo">
  <h1 *ngIf="!logoPath">{{appName}}</h1>
</div>
```

#### Logo Styling Standards
```scss
.logo-container {
  display: flex;
  justify-content: center; // or flex-start for left alignment
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

### Branding Configuration
Application branding is configured in `app-config.ts`:
```typescript
export const appConfig = {
  appName: 'My Custom App',
  logos: {
    landingLogo: 'assets/logos/logo-large.svg',
    headerLogo: 'assets/logos/logo-header.svg',
    footerLogo: 'assets/logos/logo-small.svg',
    favicon: 'assets/logos/favicon.svg'
  },
  theme: {
    primary: '#3f51b5',
    secondary: '#ff4081',
  }
};
```

## Color Palette

The template uses a flexible color system with:

### Base Colors
```scss
// Primary colors
$primary: #3f51b5;
$primary-light: #757de8;
$primary-dark: #002984;

// Secondary colors
$secondary: #ff4081;
$secondary-light: #ff79b0;
$secondary-dark: #c60055;

// Neutral colors
$neutral-100: #ffffff;
$neutral-200: #f5f5f5;
$neutral-300: #e0e0e0;
$neutral-400: #bdbdbd;
$neutral-500: #9e9e9e;
$neutral-600: #757575;
$neutral-700: #616161;
$neutral-800: #424242;
$neutral-900: #212121;
```

### Functional Colors
```scss
// Status colors
$success: #4caf50;
$warning: #ff9800;
$error: #f44336;
$info: #2196f3;

// Background colors
$background-primary: $neutral-100;
$background-secondary: $neutral-200;
$background-tertiary: $neutral-300;

// Text colors
$text-primary: $neutral-900;
$text-secondary: $neutral-700;
$text-tertiary: $neutral-500;
$text-inverted: $neutral-100;
```

## Typography

### Font Family
```scss
$font-family-primary: 'Roboto', 'Segoe UI', sans-serif;
$font-family-secondary: 'Roboto Condensed', 'Arial Narrow', sans-serif;
$font-family-monospace: 'Roboto Mono', 'Consolas', monospace;
```

### Font Sizes
```scss
$font-size-xs: 0.75rem;    // 12px
$font-size-sm: 0.875rem;   // 14px
$font-size-md: 1rem;       // 16px
$font-size-lg: 1.25rem;    // 20px
$font-size-xl: 1.5rem;     // 24px
$font-size-xxl: 2rem;      // 32px
$font-size-xxxl: 2.5rem;   // 40px
```

### Font Weights
```scss
$font-weight-light: 300;
$font-weight-regular: 400;
$font-weight-medium: 500;
$font-weight-bold: 700;
```

### Line Heights
```scss
$line-height-tight: 1.2;
$line-height-normal: 1.5;
$line-height-loose: 1.8;
```

## Spacing

```scss
$spacing-xxs: 0.25rem;  // 4px
$spacing-xs: 0.5rem;    // 8px
$spacing-sm: 0.75rem;   // 12px
$spacing-md: 1rem;      // 16px
$spacing-lg: 1.5rem;    // 24px
$spacing-xl: 2rem;      // 32px
$spacing-xxl: 3rem;     // 48px
$spacing-xxxl: 4rem;    // 64px
```

## Border Radius

```scss
$border-radius-sm: 0.25rem;  // 4px
$border-radius-md: 0.5rem;   // 8px
$border-radius-lg: 1rem;     // 16px
$border-radius-pill: 9999px;
```

## Shadows

```scss
$shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
$shadow-md: 0 3px 6px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.12);
$shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.15), 0 5px 10px rgba(0, 0, 0, 0.05);
$shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.2);
```

## Breakpoints

```scss
$breakpoint-xs: 0;
$breakpoint-sm: 576px;
$breakpoint-md: 768px;
$breakpoint-lg: 992px;
$breakpoint-xl: 1200px;
$breakpoint-xxl: 1400px;
```

## Components Styling

### Buttons

```scss
// Primary button
.btn-primary {
  background-color: $primary;
  color: $text-inverted;
  border-radius: $border-radius-md;
  padding: $spacing-xs $spacing-lg;
  font-weight: $font-weight-medium;
  transition: background-color 0.2s ease-in-out;
  
  &:hover {
    background-color: $primary-dark;
  }
  
  &:disabled {
    background-color: $neutral-400;
    cursor: not-allowed;
  }
}

// Secondary button
.btn-secondary {
  background-color: transparent;
  color: $primary;
  border: 1px solid $primary;
  border-radius: $border-radius-md;
  padding: $spacing-xs $spacing-lg;
  font-weight: $font-weight-medium;
  transition: all 0.2s ease-in-out;
  
  &:hover {
    background-color: rgba($primary, 0.1);
  }
  
  &:disabled {
    color: $neutral-500;
    border-color: $neutral-400;
    cursor: not-allowed;
  }
}
```

### Form Controls

```scss
// Input fields
.form-control {
  width: 100%;
  padding: $spacing-xs $spacing-sm;
  border: 1px solid $neutral-400;
  border-radius: $border-radius-sm;
  font-size: $font-size-md;
  transition: border-color 0.2s ease-in-out;
  
  &:focus {
    outline: none;
    border-color: $primary;
    box-shadow: 0 0 0 2px rgba($primary, 0.2);
  }
  
  &.is-invalid {
    border-color: $error;
    
    &:focus {
      box-shadow: 0 0 0 2px rgba($error, 0.2);
    }
  }
}

// Form label
.form-label {
  display: block;
  margin-bottom: $spacing-xs;
  font-weight: $font-weight-medium;
  color: $text-secondary;
}

// Error message
.form-error {
  color: $error;
  font-size: $font-size-sm;
  margin-top: $spacing-xxs;
}
```

### Cards

```scss
.card {
  background-color: $background-primary;
  border-radius: $border-radius-md;
  box-shadow: $shadow-sm;
  overflow: hidden;
  transition: box-shadow 0.2s ease-in-out;
  
  &:hover {
    box-shadow: $shadow-md;
  }
  
  .card-header {
    padding: $spacing-md;
    border-bottom: 1px solid $neutral-300;
    font-weight: $font-weight-medium;
  }
  
  .card-body {
    padding: $spacing-md;
  }
  
  .card-footer {
    padding: $spacing-md;
    border-top: 1px solid $neutral-300;
  }
}
```

### Navigation

```scss
// Top navbar
.navbar {
  background-color: $primary;
  color: $text-inverted;
  padding: $spacing-sm $spacing-md;
  box-shadow: $shadow-sm;
  
  .navbar-brand {
    font-size: $font-size-lg;
    font-weight: $font-weight-bold;
  }
  
  .navbar-nav {
    display: flex;
    align-items: center;
    
    .nav-item {
      margin-left: $spacing-md;
      
      .nav-link {
        color: $neutral-200;
        transition: color 0.2s ease-in-out;
        
        &:hover, &.active {
          color: $neutral-100;
        }
      }
    }
  }
}

// Sidebar
.sidebar {
  width: 250px;
  background-color: $background-primary;
  height: 100%;
  box-shadow: $shadow-sm;
  
  .sidebar-header {
    padding: $spacing-md;
    border-bottom: 1px solid $neutral-300;
  }
  
  .sidebar-nav {
    .nav-item {
      .nav-link {
        padding: $spacing-sm $spacing-md;
        color: $text-secondary;
        display: flex;
        align-items: center;
        
        .icon {
          margin-right: $spacing-sm;
        }
        
        &:hover, &.active {
          background-color: $neutral-200;
          color: $primary;
        }
      }
    }
  }
}
```

## Layout Guidelines

### Container

```scss
.container {
  width: 100%;
  padding-right: $spacing-md;
  padding-left: $spacing-md;
  margin-right: auto;
  margin-left: auto;
  
  @media (min-width: $breakpoint-sm) {
    max-width: 540px;
  }
  
  @media (min-width: $breakpoint-md) {
    max-width: 720px;
  }
  
  @media (min-width: $breakpoint-lg) {
    max-width: 960px;
  }
  
  @media (min-width: $breakpoint-xl) {
    max-width: 1140px;
  }
}

.container-fluid {
  width: 100%;
  padding-right: $spacing-md;
  padding-left: $spacing-md;
  margin-right: auto;
  margin-left: auto;
}
```

### Grid System

```scss
.row {
  display: flex;
  flex-wrap: wrap;
  margin-right: -$spacing-md;
  margin-left: -$spacing-md;
}

.col {
  flex-basis: 0;
  flex-grow: 1;
  max-width: 100%;
  padding-right: $spacing-md;
  padding-left: $spacing-md;
}

@for $i from 1 through 12 {
  .col-#{$i} {
    flex: 0 0 percentage($i / 12);
    max-width: percentage($i / 12);
    padding-right: $spacing-md;
    padding-left: $spacing-md;
  }
}
```

## Responsive Design Guidelines

### Mobile-First Approach

Always design for mobile first, then enhance for larger screens:

```scss
// Base styles are for mobile
.element {
  width: 100%;
}

// Then add styles for larger screens
@media (min-width: $breakpoint-md) {
  .element {
    width: 50%;
  }
}

@media (min-width: $breakpoint-lg) {
  .element {
    width: 33.333%;
  }
}
```

### Hamburger Menu

```scss
.navbar {
  .navbar-toggler {
    display: block;
    
    @media (min-width: $breakpoint-md) {
      display: none;
    }
  }
  
  .navbar-collapse {
    display: none;
    
    &.show {
      display: block;
    }
    
    @media (min-width: $breakpoint-md) {
      display: flex;
    }
  }
}
```

## Implementation Guidelines

### SCSS Architecture

Organize your styles using the 7-1 pattern:

```
styles/
|-- abstracts/         # Variables, mixins, functions
|-- base/              # Base styles, typography, reset
|-- components/        # Individual components
|-- layout/            # Layout components
|-- pages/             # Page-specific styles
|-- themes/            # Different themes
|-- vendors/           # External libraries
`-- main.scss          # Main file imports all others
```

### Component-Specific Styles

Use Angular's encapsulation for component-specific styles:

```typescript
@Component({
  selector: 'app-button',
  templateUrl: './button.component.html',
  styleUrls: ['./button.component.scss'],
  encapsulation: ViewEncapsulation.Emulated
})
```

### Global Styles

For global styles, use the styles.scss file in the src folder:

```scss
// Import the abstracts first (variables, mixins, etc.)
@import 'abstracts/variables';
@import 'abstracts/mixins';

// Then base styles
@import 'base/reset';
@import 'base/typography';

// Then the rest of the styles...
```

### Best Practices

1. Use variables for consistent values (colors, spacing, etc.)
2. Create mixins for repetitive style patterns
3. Use BEM (Block Element Modifier) naming convention
4. Avoid deep nesting in SCSS (maximum 3 levels)
5. Prioritize classes over element selectors
6. Write mobile-first media queries
7. Comment complex style blocks 

## Angular Material Theme Implementation

### Theme Structure and Organization

The application uses Angular Material's theming system, which provides a flexible way to customize the look and feel of Material components. The theme is structured as follows:

```
styles/
|-- abstracts/
|   |-- _variables.scss    # Global SCSS variables
|   |-- _mixins.scss       # Global mixins
|   |-- _functions.scss    # Global functions
|   |-- _colors.scss       # Color definitions
|   `-- _theme.scss        # Theme configuration
|-- themes/
|   |-- _material-theme.scss  # Material theme configuration
|   |-- _light-theme.scss     # Light theme variant
|   `-- _dark-theme.scss      # Dark theme variant
```

### Core Variables and Theme Configuration

All theme variables should be defined in the abstracts directory and imported into component SCSS files as needed:

```scss
// _variables.scss
$primary-palette: mat-palette($mat-indigo);
$accent-palette: mat-palette($mat-pink, A200, A100, A400);
$warn-palette: mat-palette($mat-red);

// Derived semantic variables
$background-card: mat-color($primary-palette, 50);
$spacing-sm: 0.75rem;   // 12px
$spacing-md: 1rem;      // 16px

// Export theme for components
$theme: mat-light-theme($primary-palette, $accent-palette, $warn-palette);
```

### Component Import Pattern

Every component SCSS file that uses theme variables MUST follow this import pattern:

```scss
// First import Angular Material theming
@use '@angular/material' as mat;

// Then import our theme abstracts
@import 'src/styles/abstracts/variables';
@import 'src/styles/abstracts/mixins';

// Component styling using theme variables
.my-component {
  background-color: $background-card;
  color: mat.get-color-from-palette($primary-palette, 500);
  padding: $spacing-md;
}
```

### Common Theming Mixins

The application provides several mixins to ensure consistent styling across components:

```scss
// _mixins.scss
@mixin auth-card() {
  background-color: $background-card;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: $spacing-md;
}

@mixin flex-center() {
  display: flex;
  justify-content: center;
  align-items: center;
}
```

### Material Component Theming

When customizing Material components, always use the theme mixins provided by Angular Material:

```scss
// Custom Material button styling
@include mat.button-theme($theme);

// Typography
@include mat.typography-hierarchy($theme);
```

### Common Theme Issues and Solutions

#### Missing Variable Errors

If you see errors like `Undefined variable $background-card`:

✓ **Correct approach**:
```scss
@import 'src/styles/abstracts/variables';

.login-card {
  background-color: $background-card;
}
```

✗ **Incorrect approach**:
```scss
// Missing import
.login-card {
  background-color: $background-card; // Error: Undefined variable
}
```

#### Material Function Usage

If using Material color functions:

✓ **Correct approach**:
```scss
@use '@angular/material' as mat;
@import 'src/styles/abstracts/variables';

.my-element {
  color: mat.get-color-from-palette($primary-palette, 500);
}
```

✗ **Incorrect approach**:
```scss
// Missing @use directive
.my-element {
  color: mat.get-color-from-palette($primary-palette, 500); // Error: Unknown function
}
```

### Theme Validation and Testing

All components should pass the theme validation checks:

1. Run the validation with:
   ```bash
   npm run check:material-theme
   ```

2. Common validation failures:
   - Hardcoded color values instead of theme variables
   - Missing imports for theme variables
   - Incorrect usage of Material theme functions
   - Inconsistent spacing values

### Theme Maintenance Guidelines

1. **Add New Variables Centrally**
   - Always add new theme variables to the central `_variables.scss` file
   - Document the purpose of each variable with comments

2. **Test Component Theming**
   - When creating or modifying a component, test with both light and dark themes
   - Verify all colors and styles adapt properly to theme changes

3. **Theme Debugging**
   - Use browser dev tools to inspect computed styles
   - Verify that color values match expected theme values
   - Check for any hardcoded values that should use theme variables

### Theme Migration Guidelines

When migrating existing components to use the theme system:

1. Replace all hardcoded colors with theme variables
2. Replace all hardcoded spacing with spacing variables
3. Add proper imports at the top of the file
4. Use mixins for common component patterns
5. Run theme validation to verify changes

## Best Practices Summary

1. **Single Source of Truth**
   - Define all theme variables in central files
   - Never duplicate variable definitions across files

2. **Consistent Imports**
   - Always use the same import pattern in every SCSS file
   - Start with Material imports, then application abstracts

3. **Use Mixins for Common Patterns**
   - Create and use mixins for repeated style patterns
   - Document mixin parameters and usage

4. **Validate Regularly**
   - Run theme validation checks before committing code
   - Address theme issues immediately when detected

5. **Document Theme Usage**
   - Keep this guide updated with new theme patterns
   - Document component-specific theme usage 

## CSS Variables and SCSS Color Functions

### The Challenge with CSS Variables and SCSS Functions

CSS variables (custom properties) cannot be directly used with SCSS color functions like `darken()`, `lighten()`, or `mix()`. This is because SCSS processes at compile time, while CSS variables are resolved at runtime.

### Using Color Functions with Our Theme

The application provides utility functions to work with our theme colors when color manipulation is needed:

```scss
// Instead of this (will fail):
color: darken($warning, 20%);

// Use this:
color: abstracts.darken-color('warning', 20%);

// For lightening colors:
color: abstracts.lighten-color('primary', 10%);

// To just get the HEX value of a color:
color: abstracts.get-color('accent');
```

### Implementation Details

These functions use a color map that mirrors our CSS variables, allowing SCSS to apply color transformations at compile time:

```scss
$color-map: (
  'primary': #7b1fa2,
  'primary-light': #ae52d4,
  'primary-dark': #4a0072,
  'accent': #69f0ae,
  // etc.
);
```

### When to Use

Use these functions when you need to:
- Darken a theme color for hover states
- Lighten a theme color for backgrounds
- Mix colors together
- Apply any SCSS color transformation to theme colors

### Example Usage

```scss
.button {
  background-color: $primary; // Use CSS variable directly
  
  &:hover {
    // Use the color function for transformations
    background-color: abstracts.darken-color('primary', 10%);
  }
  
  &.subtle {
    // Use the color function for transformations
    background-color: abstracts.lighten-color('primary', 40%);
  }
}
``` 