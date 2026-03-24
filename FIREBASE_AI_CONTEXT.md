# Firebase AI Logic Context: Admin UI Refactor

## Current Component Code

### 1. HTML (admin-feature.component.html)
```html
<div class="admin-container">
  <div class="stats-row">
    <!-- Stat Cards currently go here -->
  </div>
  <div class="user-table-container">
    <!-- MatTable currently goes here -->
  </div>
</div>
```

### 2. SCSS (admin-feature.component.scss)
```scss
// Currently using custom styles that need refactoring to Material 3 tokens
.admin-container {
  padding: 24px;
}
```

### 3. TS (admin-feature.component.ts)
```typescript
@Component({
  selector: 'app-admin-feature',
  standalone: true,
  templateUrl: './admin-feature.component.html',
  styleUrls: ['./admin-feature.component.scss']
})
export class AdminFeatureComponent {
  // Logic for stats and user data
}
```

## Refactor Requirements
- **Theme:** Material 3 'azure-blue' (#6750a4).
- **Goal:** Replace custom styles with standard Material 3 components and tokens.
- **Specifics:** Clean up the stat cards and the user table to feel native to a professional Angular Material 3 app.
