# TASK-003: Desktop Layout Enhancements

## Objective
Utilize the "dead space" on desktop screens by implementing a wider, multi-column layout that positions all primary elements above the fold. 

## Execution Steps

1. In `features/auth/login/login.component.scss`, target the new `.login-main-section` and `.login-security-section` classes.
2. Inside `.login-card`, increase the `max-width` (e.g., `1000px`) for tablet/desktop breakpoints.
3. Apply `display: grid` or `display: flex` to the `.login-card` inner content.
4. Set up a side-by-side columns ratio (e.g., 50/50 or 60/40) for screens `> 992px`.
   - Place `.login-main-section` on the left.
   - Place `.login-security-section` on the right.
5. Create distinct visual separation for the secondary CAPTCHA section (e.g., an internal border, slightly darker transparent background, or specific padding).
6. Adjust vertical spacing (margins/padding) for desktop views to bring elements tighter together, ensuring everything is strictly above the fold on a `1920x1080` screen.
