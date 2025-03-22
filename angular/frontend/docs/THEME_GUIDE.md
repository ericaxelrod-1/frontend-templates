# Angular Material Theme Switching Guide

This guide explains how to change the Material Design theme in our Angular application and customize components to match your chosen theme.

## Available Pre-built Themes

Angular Material comes with several pre-built themes that you can use right away:

1. **purple-green.css** - A dark theme with purple primary and green accent colors (currently used)
2. **indigo-pink.css** - A light theme with indigo primary and pink accent colors
3. **pink-bluegrey.css** - A dark theme with pink primary and blue-grey accent colors
4. **deeppurple-amber.css** - A light theme with deep purple primary and amber accent colors

## How to Switch Themes

### 1. Using Pre-built Themes

To switch to a different pre-built theme:

1. Open `src/styles.scss`
2. Locate the import statement for the current theme:
   ```scss
   @import '@angular/material/prebuilt-themes/purple-green.css';
   ```
3. Change it to your desired theme:
   ```scss
   @import '@angular/material/prebuilt-themes/indigo-pink.css';
   ```

### 2. Updating CSS Variables

After changing the theme, you'll need to update the CSS variables to match the new theme's color palette:

```scss
/* CSS Variables for custom components */
:root {
  /* For indigo-pink theme */
  --primary-color: #3f51b5;
  --primary-light: #757de8;
  --primary-dark: #002984;
  --accent-color: #ff4081;
  --text-on-primary: #ffffff;
  --text-primary: #000000;
  --text-secondary: #757575;
  --background-dark: #fafafa;
  --background-card: #ffffff;
  --surface: #ffffff;
  --error: #f44336;
  --success: #4caf50;
  --warning: #ff9800;
  --info: #2196f3;
}
```

## Creating Custom Themes

For more advanced customization, you can create your own theme:

1. Create a new theme file (e.g., `src/styles/themes/_custom-theme.scss`):

```scss
@use '@angular/material' as mat;

// Define your custom palette
$my-primary: mat.define-palette(mat.$blue-palette, 700);
$my-accent: mat.define-palette(mat.$amber-palette, A200, A100, A400);
$my-warn: mat.define-palette(mat.$red-palette);

// Create the theme
$my-theme: mat.define-light-theme((
  color: (
    primary: $my-primary,
    accent: $my-accent,
    warn: $my-warn,
  ),
  typography: mat.define-typography-config(),
  density: 0,
));

// Apply the theme to components
@include mat.all-component-themes($my-theme);
```

2. Import your theme in `styles.scss`:
```scss
@use 'styles/themes/custom-theme';
```

## Full List of Available Color Palettes

For a complete list of available palettes, refer to:

- [Material Design Color System](https://material.io/design/color/the-color-system.html)
- [Angular Material Theming Guide](https://material.angular.io/guide/theming)
- [Material Design Palette Generator](https://material.io/resources/color/)

You can also explore the Angular Material source code to see all available palettes:
- `node_modules/@angular/material/core/theming/_palette.scss`

## Customizing Individual Components

### 1. Overriding Component Styles

To customize specific Material components, you can add styles in your component's SCSS file:

```scss
// In your component's SCSS file
::ng-deep {
  .mat-button {
    background-color: var(--primary-color);
    color: var(--text-on-primary);
  }
  
  .mat-form-field-outline {
    color: var(--primary-light);
  }
}
```

### 2. Component-Specific Themes

For advanced scenarios, you can create component-specific themes:

```scss
// Import Angular Material theming functions
@use '@angular/material' as mat;

// Import your theme definition
@use 'src/styles/themes/theme' as theme;

// Define a mixin for your component theme
@mixin my-component-theme($theme) {
  $primary: map-get($theme, primary);
  $accent: map-get($theme, accent);
  
  .my-component {
    background-color: mat.get-color-from-palette($primary);
    color: mat.get-color-from-palette($primary, default-contrast);
  }
}

// Include the theme mixin
@include my-component-theme(theme.$my-theme);
```

## Theme Switching at Runtime

To implement dynamic theme switching:

1. Create a theme service:

```typescript
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private isDarkTheme = new BehaviorSubject<boolean>(true);
  isDarkTheme$ = this.isDarkTheme.asObservable();

  toggleTheme(): void {
    this.isDarkTheme.next(!this.isDarkTheme.value);
    
    // Update CSS variables for custom components
    if (this.isDarkTheme.value) {
      document.documentElement.style.setProperty('--primary-color', '#7b1fa2');
      document.documentElement.style.setProperty('--background-dark', '#303030');
      // Add more variable updates as needed
    } else {
      document.documentElement.style.setProperty('--primary-color', '#3f51b5');
      document.documentElement.style.setProperty('--background-dark', '#fafafa');
      // Add more variable updates as needed
    }
    
    // Toggle the class on the body for theme switching
    document.body.classList.toggle('dark-theme');
    document.body.classList.toggle('light-theme');
  }
}
```

2. Use the service in your components:

```typescript
import { Component } from '@angular/core';
import { ThemeService } from './theme.service';

@Component({
  selector: 'app-header',
  template: `
    <button (click)="toggleTheme()">
      {{(isDarkTheme$ | async) ? 'Light Mode' : 'Dark Mode'}}
    </button>
  `
})
export class HeaderComponent {
  isDarkTheme$ = this.themeService.isDarkTheme$;
  
  constructor(private themeService: ThemeService) {}
  
  toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
```

## Additional Resources

- [Angular Material Documentation](https://material.angular.io/)
- [Material Design Guidelines](https://material.io/design)
- [Material Theme Builder](https://material-foundation.github.io/material-theme-builder/)
- [Material Design Palette Generator](https://materialpalettes.com/) 