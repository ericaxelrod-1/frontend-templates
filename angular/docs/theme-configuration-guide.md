# Theme and Branding Configuration Guide

This guide explains how to customize themes, stylesheets, and branding elements (such as logos) for your production deployment of the Angular Template Application.

## Branding Configuration

The application uses a centralized configuration for branding elements in the `app-config.ts` file located at `angular/frontend/src/environments/app-config.ts`.

### Application Name and Logos

1. Open the `app-config.ts` file:
   ```bash
   nano angular/frontend/src/environments/app-config.ts
   ```

2. Modify the name and logo paths to match your organization's branding:
   ```typescript
   export const appConfig = {
     // Application name displayed in various places
     appName: 'Your Company Name',
     
     // Logo paths
     logos: {
       // Large logo used on the landing page
       landingLogo: 'assets/logos/your-logo-large.svg',
       
       // Logo used in the header
       headerLogo: 'assets/logos/your-logo-header.svg',
       
       // Small logo used in the footer
       footerLogo: 'assets/logos/your-logo-small.svg',
       
       // Favicon
       favicon: 'assets/logos/your-favicon.svg'
     },
     
     // Theme colors - These should match the logo design
     theme: {
       primary: '#your-primary-color',
       secondary: '#your-secondary-color',
     }
   };
   ```

### Logo Assets

1. Place your custom logo files in the `angular/frontend/src/assets/logos/` directory:
   ```bash
   cp your-logo-files/* angular/frontend/src/assets/logos/
   ```

2. Ensure your logos meet these specifications:
   - **Landing Logo**: 200-300px wide, SVG or PNG with transparent background
   - **Header Logo**: 120-150px wide, SVG or PNG with transparent background
   - **Footer Logo**: 80-100px wide, SVG or PNG with transparent background
   - **Favicon**: 32x32px, available in SVG and ICO formats

## Theme Customization

The application uses Angular Material for its UI components, with customizable theming options.

### Changing the Material Theme

You can choose from several pre-built Material themes or create your own:

1. Open `angular/frontend/src/styles.scss`
2. Locate the import statement for the current theme:
   ```scss
   @import '@angular/material/prebuilt-themes/purple-green.css';
   ```
3. Change it to your desired theme:
   ```scss
   @import '@angular/material/prebuilt-themes/indigo-pink.css';
   ```

Available pre-built themes:
- `purple-green.css` - A dark theme with purple primary and green accent colors
- `indigo-pink.css` - A light theme with indigo primary and pink accent colors
- `pink-bluegrey.css` - A dark theme with pink primary and blue-grey accent colors
- `deeppurple-amber.css` - A light theme with deep purple primary and amber accent colors

### Customizing CSS Variables

After changing the theme, update the CSS variables in `styles.scss` to match your chosen theme:

```scss
/* CSS Variables for custom components */
:root {
  --primary-color: #your-primary-color;
  --primary-light: #your-primary-light;
  --primary-dark: #your-primary-dark;
  --accent-color: #your-accent-color;
  --text-on-primary: #ffffff; /* or #000000 for light themes */
  --text-primary: #e0e0e0; /* or darker for light themes */
  --text-secondary: #a0a0a0;
  --background-dark: #303030; /* or #fafafa for light themes */
  --background-card: #424242; /* or #ffffff for light themes */
  --surface: #484848; /* or #ffffff for light themes */
  --error: #f44336;
  --success: #4caf50;
  --warning: #ff9800;
  --info: #2196f3;
}
```

### Creating a Custom Theme

For more advanced customization, you can create a custom theme:

1. Create a new theme file at `angular/frontend/src/styles/themes/_custom-theme.scss`:
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

2. Import your custom theme in `styles.scss` instead of using a pre-built theme:
   ```scss
   @use 'styles/themes/custom-theme';
   // Remove the previous @import statement
   ```

## Favicon Configuration

To update the favicon for production:

1. Replace the favicon files in `angular/frontend/src/assets/icons/`:
   ```bash
   cp your-favicon.ico angular/frontend/src/favicon.ico
   cp your-favicon-files/* angular/frontend/src/assets/icons/
   ```

2. Ensure you have the following sizes for proper display across all devices:
   - 16x16
   - 32x32
   - 48x48
   - 192x192 (for Android)
   - 512x512 (for PWA)

3. Update the Web App Manifest at `angular/frontend/src/manifest.webmanifest` with your app colors and icons.

## Build with Custom Branding

After customizing your themes and branding, rebuild the application for production:

```bash
cd angular/frontend
npm run build:prod
```

## Testing Your Customizations

Before deploying to production, verify that your branding changes look correct:

1. Run the application locally with production settings:
   ```bash
   cd angular/frontend
   npm run start:prod
   ```

2. Check all key pages to ensure branding is consistent:
   - Login page
   - Registration page
   - Dashboard
   - Profile page
   - All authentication-related pages

3. Test on different devices and browsers to ensure responsive design works with your branding.

## Adding to Your Deployment Checklist

Add these items to your deployment checklist in the main deployment guide:

- [ ] Application branding is configured (name, logos, colors)
- [ ] Theme colors match company branding guidelines
- [ ] Favicon is updated and available in all required sizes
- [ ] CSS variables are updated to match the chosen theme
- [ ] All pages render correctly with the custom theme
- [ ] Logo assets are optimized for web (compressed, proper format)

## Additional Resources

- [Angular Material Theming Guide](https://material.angular.io/guide/theming)
- [Material Design Color System](https://material.io/design/color/the-color-system.html)
- [SVG Optimizer Tool](https://jakearchibald.github.io/svgomg/)
- [Favicon Generator](https://realfavicongenerator.net/) 