# TASK-003: Create Side Panel Animations

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-003 |
| **Status** | Open |
| **Story** | STORY-001: Create SidePanelService Infrastructure |
| **Description** | Create the slide-in/slide-out animation trigger for side panel components |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | None (can be done in parallel with other tasks) |

---

## Context

Side panel components need a slide-in animation (from right edge) when opening and a slide-out animation when closing. This animation trigger is defined once and reused by all panel components.

---

## Instructions

### File to Create

**File**: `angular/frontend/src/app/shared/components/side-panel/side-panel-animations.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/shared/components/side-panel/side-panel-animations.ts`

### Complete File Contents

```typescript
import {
  animate,
  state,
  style,
  transition,
  trigger,
  AnimationTriggerMetadata
} from '@angular/animations';

/**
 * Animation for side panel slide-in/slide-out.
 *
 * Usage in a component:
 * @Component({
 *   animations: [sidePanelAnimations.sidePanelSlide],
 *   template: `<div [@sidePanelSlide]="animationState">...</div>`
 * })
 */
export const sidePanelAnimations: {
  readonly sidePanelSlide: AnimationTriggerMetadata;
} = {
  sidePanelSlide: trigger('sidePanelSlide', [
    state('void', style({ transform: 'translateX(100%)' })),
    state('enter', style({ transform: 'translateX(0)' })),
    state('exit', style({ transform: 'translateX(100%)' })),
    transition('void => enter', animate('300ms ease-out')),
    transition('enter => exit', animate('200ms ease-in')),
    transition('enter => void', animate('200ms ease-in'))
  ])
};
```

---

## Acceptance Criteria

- [ ] File exists at `shared/components/side-panel/side-panel-animations.ts`
- [ ] `sidePanelAnimations.sidePanelSlide` is exported
- [ ] Animation transitions from off-screen right (`translateX(100%)`) to on-screen (`translateX(0)`)
- [ ] No compilation errors
