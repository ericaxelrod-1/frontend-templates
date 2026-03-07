# TASK-001: Restructure HTML Container

## Objective
Reorganize the internal layout of the `login-card` in `login.component.html` to clearly group priority items and separate the CAPTCHA.

## Execution Steps

1. In `features/auth/login/login.component.html`, wrap the logo, email, password, sign-in button, and help links (forgot password, register) in a new `div` with the class `login-main-section`.
2. Move the CAPTCHA container out of the main form grouping flow and wrap it in a new `div` with the class `login-security-section`.
3. Ensure these two new wrapper sections sit as siblings inside the `login-card` or an inner content wrapper.
4. Verify uniform HTML structure and ARIA compliance. 
