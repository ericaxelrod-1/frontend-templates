/**
 * Angular Material Theme Validator
 * 
 * This script validates Angular Material theme configuration to ensure:
 * - Proper color palette definition
 * - Complete theme definition (primary, accent, warn)
 * - Correct typography configuration
 * - Appropriate theme mixins usage
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Configuration
const STYLES_DIR = path.join(__dirname, '..', 'src', 'styles');
const COMPONENTS_DIR = path.join(__dirname, '..', 'src', 'app');

// Required theme components
const REQUIRED_THEME_PARTS = ['primary', 'accent', 'warn'];
const REQUIRED_TYPOGRAPHY_LEVELS = ['headline', 'title', 'subheading', 'body', 'button', 'caption'];

// Log helpers
const logError = (message) => console.error('\x1b[31m%s\x1b[0m', `[ERROR] ${message}`);
const logWarning = (message) => console.warn('\x1b[33m%s\x1b[0m', `[WARNING] ${message}`);
const logSuccess = (message) => console.log('\x1b[32m%s\x1b[0m', `[SUCCESS] ${message}`);
const logInfo = (message) => console.log('\x1b[36m%s\x1b[0m', `[INFO] ${message}`);

// Main validation function
async function validateMaterialTheme() {
  logInfo('Starting Angular Material theme validation...');
  
  let errors = 0;
  let warnings = 0;

  // Find theme files
  const themeFiles = glob.sync('**/*.scss', { cwd: STYLES_DIR, absolute: true });
  
  if (themeFiles.length === 0) {
    logWarning('No SCSS files found in styles directory.');
    warnings++;
  } else {
    logInfo(`Found ${themeFiles.length} SCSS files in styles directory.`);
  }

  // Check for main theme file
  const mainThemeFile = themeFiles.find(file => 
    file.includes('theme') || file.includes('material') || file.includes('palette')
  );

  if (!mainThemeFile) {
    logWarning('Could not identify a main theme file. Looking for files containing "theme", "material", or "palette".');
    warnings++;
  } else {
    logInfo(`Identified main theme file: ${path.basename(mainThemeFile)}`);
    
    // Check theme file content
    const themeContent = fs.readFileSync(mainThemeFile, 'utf8');
    
    // Check for Angular Material imports
    if (!themeContent.includes('@angular/material')) {
      logError('Angular Material imports not found in theme file.');
      errors++;
    } else {
      logSuccess('Angular Material imports found.');
    }
    
    // Check for theme definition
    const hasThemeMixin = themeContent.includes('mat.define-') || 
                           themeContent.includes('mat-light-theme') || 
                           themeContent.includes('mat-dark-theme');
    
    if (!hasThemeMixin) {
      logError('Material theme definition not found. Expected usage of mat.define-light-theme, mat.define-dark-theme, or similar mixins.');
      errors++;
    } else {
      logSuccess('Material theme definition found.');
      
      // Check for required theme parts
      let missingParts = [];
      for (const part of REQUIRED_THEME_PARTS) {
        if (!themeContent.includes(`$${part}`) && !themeContent.includes(`${part}:`)) {
          missingParts.push(part);
        }
      }
      
      if (missingParts.length > 0) {
        logWarning(`Theme definition may be missing required parts: ${missingParts.join(', ')}`);
        warnings++;
      } else {
        logSuccess('All required theme parts (primary, accent, warn) appear to be defined.');
      }
    }
    
    // Check for typography
    const hasTypography = themeContent.includes('typography') || 
                          themeContent.includes('mat.define-typography');
    
    if (!hasTypography) {
      logWarning('Material typography configuration not found. Consider defining a custom typography configuration.');
      warnings++;
    } else {
      logSuccess('Material typography configuration found.');
    }
    
    // Check for all-component theme
    const hasAllComponentTheme = themeContent.includes('all-component-themes') || 
                                themeContent.includes('all-component-typographies');
    
    if (!hasAllComponentTheme) {
      logWarning('all-component-themes or all-component-typographies mixin not found. Make sure all Material components are themed.');
      warnings++;
    } else {
      logSuccess('all-component-themes or all-component-typographies mixin found.');
    }
  }

  // Check component themes
  const componentFiles = glob.sync('**/*.scss', { cwd: COMPONENTS_DIR, absolute: true });
  
  if (componentFiles.length > 0) {
    logInfo(`Checking ${componentFiles.length} component SCSS files for theme usage...`);
    
    let componentsWithThemeImports = 0;
    
    for (const file of componentFiles) {
      const content = fs.readFileSync(file, 'utf8');
      
      if (content.includes('@angular/material') || 
          content.includes('$theme') || 
          content.includes('mat-color')) {
        componentsWithThemeImports++;
      }
    }
    
    if (componentsWithThemeImports > 0) {
      logInfo(`Found ${componentsWithThemeImports} components with Material theme usage.`);
      
      // Check for theme file
      const hasThemeFile = themeFiles.some(file => file.includes('theme'));
      
      if (!hasThemeFile) {
        logWarning('Components use Material theming but no central theme file was found.');
        warnings++;
      }
    }
  }

  // Report results
  console.log('\n--- Material Theme Validation Summary ---');
  
  if (errors === 0 && warnings === 0) {
    logSuccess('All checks passed! Angular Material theme configuration looks good.');
    return 0;
  } else {
    console.log(`Found ${errors} errors and ${warnings} warnings.`);
    
    if (errors > 0) {
      logError('Please fix the reported errors to ensure proper Material theming.');
      return 1;
    } else {
      logWarning('Consider addressing the warnings for optimal Material theming.');
      return 0;
    }
  }
}

// Run validation
validateMaterialTheme()
  .then(code => process.exit(code))
  .catch(err => {
    logError(`Unexpected error: ${err.message}`);
    process.exit(1);
  }); 