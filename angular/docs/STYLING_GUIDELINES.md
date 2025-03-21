# Angular Template Application - Styling Guidelines

## Design Philosophy

The template follows a clean, modern, and minimalist design approach focusing on:
- **Usability**: Intuitive interface with clear navigation
- **Responsiveness**: Mobile-first approach ensuring compatibility across devices
- **Consistency**: Unified look and feel throughout the application
- **Accessibility**: Ensuring all users can interact with the application

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