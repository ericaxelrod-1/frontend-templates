# TASK-002: Apply Glassmorphism & Fix Scroll

## Objective
Apply the glassmorphism aesthetic to the container and card, and resolve the scrollbar issue preventing interaction on short viewports.

## Execution Steps

1. Open `features/auth/login/login.component.scss`.
2. **Fix Scrollbar:** Update `.login-container` to use `position: relative` (or add `overflow-y: auto`). Add `margin: auto` to `.login-card` so that scrolling naturally accommodates tall content lengths.
3. **Glassmorphism Aesthetic:**
   - Update `.login-container` with a rich, vibrant abstract background (e.g., an animated CSS mesh gradient or a colorful image).
   - Update `.login-card` to use a semi-transparent surface background (`background: rgba(var(--mdc-theme-surface-rgb), 0.7)`).
   - Apply `backdrop-filter: blur(16px)` to `.login-card`.
   - Add a subtle white/light border to enhance the glass edge effect (`border: 1px solid rgba(255, 255, 255, 0.2)`).
4. **Uniformity:** Update form control backgrounds to match the aesthetic (slightly more transparent or darker to contrast with the glass card) and ensure borders and hover states are universally consistent.
