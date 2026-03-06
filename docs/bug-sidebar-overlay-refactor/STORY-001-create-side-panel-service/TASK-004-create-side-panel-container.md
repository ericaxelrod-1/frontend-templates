# TASK-004: Create Side Panel Global Styles

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-004 |
| **Status** | Open |
| **Story** | STORY-001: Create SidePanelService Infrastructure |
| **Description** | Add global CSS styles for the CDK overlay panel and backdrop |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | None (can be done in parallel with other tasks) |

---

## Context

CDK Overlay renders content into a global overlay container (`<div class="cdk-overlay-container">`). The panel and backdrop classes referenced in `SidePanelService` (`side-panel-overlay`, `side-panel-backdrop`) must be defined in the **global** stylesheet because they are applied outside any component's view encapsulation.

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/styles.scss`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/styles.scss`

### Add the following at the end of the file

```scss
// ============================================
// Side Panel Overlay Styles (CDK Overlay)
// ============================================
// These styles are global because CDK Overlay
// renders content outside component boundaries.

.side-panel-backdrop {
  background-color: rgba(0, 0, 0, 0.5);
}

.side-panel-overlay {
  background-color: var(--mdc-theme-surface, #ffffff);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
```

---

## How to Verify

1. Open `styles.scss` and confirm the styles were added at the end
2. No other existing styles were modified

---

## Acceptance Criteria

- [ ] `.side-panel-backdrop` style is defined in `styles.scss`
- [ ] `.side-panel-overlay` style is defined in `styles.scss`
- [ ] No existing styles were modified
- [ ] No compilation errors
