/**
 * Layout Nesting Checker
 * 
 * This tool detects potential layout nesting issues in Angular templates
 * by scanning for instances of layouts used within other layouts.
 * 
 * Usage: node tools/check-layout-nesting.js
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Configuration
const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const COMPONENT_GLOB = '**/*.component.ts';
const TEMPLATE_GLOB = '**/*.component.html';
const LAYOUTS_DIR = path.join(APP_DIR, 'layouts');

// Log helpers
const logError = (message) => console.error('\x1b[31m%s\x1b[0m', `[ERROR] ${message}`);
const logWarning = (message) => console.warn('\x1b[33m%s\x1b[0m', `[WARNING] ${message}`);
const logSuccess = (message) => console.log('\x1b[32m%s\x1b[0m', `[SUCCESS] ${message}`);
const logInfo = (message) => console.log('\x1b[36m%s\x1b[0m', `[INFO] ${message}`);

// Read app component to check for direct layout usage
function checkAppComponent() {
  const appComponentPath = path.join(APP_DIR, 'app.component.ts');
  
  if (!fs.existsSync(appComponentPath)) {
    logWarning('App component not found at expected location.');
    return { hasDirectLayoutUsage: false, layoutComponents: [] };
  }
  
  const appComponent = fs.readFileSync(appComponentPath, 'utf8');
  const appTemplate = getInlineTemplate(appComponent);
  
  // Check if app component uses any layout components directly
  const layoutComponents = getLayoutComponents();
  const usedLayouts = [];
  
  for (const layout of layoutComponents) {
    const selector = layout.selector;
    if (appTemplate && appTemplate.includes(selector)) {
      usedLayouts.push(layout);
    }
  }
  
  return {
    hasDirectLayoutUsage: usedLayouts.length > 0,
    layoutComponents,
    usedLayouts
  };
}

// Read routing configuration to identify layout components in routes
function checkRoutingConfiguration() {
  const routesPath = path.join(APP_DIR, 'app.routes.ts');
  
  if (!fs.existsSync(routesPath)) {
    logWarning('Routes file not found at expected location.');
    return { layoutsInRoutes: [] };
  }
  
  const routesContent = fs.readFileSync(routesPath, 'utf8');
  
  // Find all component references in the routes
  const componentMatches = routesContent.match(/component\s*:\s*(\w+Component)/g) || [];
  const componentNames = componentMatches.map(match => {
    const nameMatch = match.match(/component\s*:\s*(\w+Component)/);
    return nameMatch ? nameMatch[1] : null;
  }).filter(Boolean);
  
  // Check if any of these are layout components
  const layoutComponents = getLayoutComponents();
  const layoutsInRoutes = layoutComponents.filter(layout => 
    componentNames.includes(layout.className)
  );
  
  return { layoutsInRoutes };
}

// Get all layout components
function getLayoutComponents() {
  if (!fs.existsSync(LAYOUTS_DIR)) {
    logWarning('Layouts directory not found.');
    return [];
  }
  
  const layoutFiles = glob.sync(COMPONENT_GLOB, { cwd: LAYOUTS_DIR, absolute: true });
  
  return layoutFiles.map(file => {
    const content = fs.readFileSync(file, 'utf8');
    const className = getComponentClassName(content);
    const selector = getComponentSelector(content);
    return {
      path: file,
      className,
      selector,
      name: path.basename(file, '.component.ts')
    };
  }).filter(layout => layout.selector && layout.className);
}

// Extract component class name from component file
function getComponentClassName(content) {
  const match = content.match(/export\s+class\s+(\w+Component)/);
  return match ? match[1] : null;
}

// Extract component selector from component file
function getComponentSelector(content) {
  const match = content.match(/selector\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

// Get inline template from component if present
function getInlineTemplate(content) {
  const match = content.match(/template\s*:\s*`([^`]+)`/);
  return match ? match[1] : null;
}

// Check all component templates for layout nesting
function checkComponentTemplates(layoutComponents) {
  const templateFiles = glob.sync(TEMPLATE_GLOB, { cwd: APP_DIR, absolute: true });
  const nestingIssues = [];
  
  for (const templateFile of templateFiles) {
    const templateContent = fs.readFileSync(templateFile, 'utf8');
    
    // Skip layout templates themselves to avoid false positives
    if (templateFile.includes(path.sep + 'layouts' + path.sep)) {
      continue;
    }
    
    // Check if this template contains any layout selectors
    const usedLayouts = [];
    
    for (const layout of layoutComponents) {
      if (layout.selector && templateContent.includes(layout.selector)) {
        usedLayouts.push(layout);
      }
    }
    
    if (usedLayouts.length > 0) {
      nestingIssues.push({
        template: templateFile,
        layouts: usedLayouts
      });
    }
  }
  
  return nestingIssues;
}

// Main function
async function checkLayoutNesting() {
  logInfo('Starting layout nesting check...');
  
  // Check if app.component uses layout components directly
  const { hasDirectLayoutUsage, layoutComponents, usedLayouts } = checkAppComponent();
  
  // Check routes for layout components
  const { layoutsInRoutes } = checkRoutingConfiguration();
  
  // Check component templates for layout nesting
  const nestingIssues = checkComponentTemplates(layoutComponents);
  
  // Report results
  console.log('\n--- Layout Nesting Check Results ---\n');
  
  // Report on app component
  if (hasDirectLayoutUsage) {
    logWarning('App component directly uses layout components:');
    usedLayouts.forEach(layout => {
      console.log(`  - ${layout.name} (${layout.selector})`);
    });
    console.log('Recommendation: Consider using routing with layouts instead of direct nesting.');
  } else {
    logSuccess('App component does not directly use layout components. Good!');
  }
  
  // Report on routes
  if (layoutsInRoutes.length > 0) {
    logSuccess(`Found ${layoutsInRoutes.length} layout components used in routes:`);
    layoutsInRoutes.forEach(layout => {
      console.log(`  - ${layout.name} (${layout.className})`);
    });
  } else {
    logWarning('No layout components found in routes. Consider using layouts for route structuring.');
  }
  
  // Report on nesting issues
  if (nestingIssues.length > 0) {
    logError(`Found ${nestingIssues.length} potential layout nesting issues:`);
    
    nestingIssues.forEach(issue => {
      const relativeTemplatePath = path.relative(APP_DIR, issue.template);
      logWarning(`Template: ${relativeTemplatePath} uses layout components:`);
      
      issue.layouts.forEach(layout => {
        console.log(`  - ${layout.name} (${layout.selector})`);
      });
      
      console.log('');
    });
    
    console.log('Recommendations:');
    console.log('1. Avoid using layout components inside other components');
    console.log('2. Use routing with layouts as containers instead');
    console.log('3. Create child routes within existing layout routes when possible');
    console.log('4. Use content projection (<ng-content>) for flexible component composition');
    
    return 1;
  } else {
    logSuccess('No layout nesting issues detected! Good architecture.');
    return 0;
  }
}

// Run the check
checkLayoutNesting()
  .then(code => process.exit(code))
  .catch(err => {
    logError(`Unexpected error: ${err.message}`);
    process.exit(1);
  }); 