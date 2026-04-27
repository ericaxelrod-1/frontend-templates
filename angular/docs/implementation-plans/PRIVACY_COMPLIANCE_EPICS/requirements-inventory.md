# Requirements Inventory

### Functional Requirements

FR1-FR77: (See Inventory in Step 1) - All functional requirements including background processing, data rights, jurisdictional resolution, sentinel guarding, and HMAC audit logging.

### NonFunctional Requirements

NFR1: Privacy logic must be decoupled from the standard request pipeline.
NFR2: Isolated background jobs with sequential Cron processing.
NFR3: HMAC with rotating peppers and Key-ID tracking.
NFR4: Email verification and CAPTCHA for public requests.
NFR5: Resilient bootstrap with "Warn-and-Degrade" for missing keys.
NFR6: 100% WCAG 2.1 AA compliance for privacy UI.
NFR7: Infrastructure-lean, database-native queueing (Zero External MQ).

### Additional Requirements

- Discovery-based provider registration.
- Reactive resource thresholds (90/95/98%).
- Unified housekeeping Cron loop.
- NGXS Feature State hydration.
- Digital receipts for rights fulfillment.

### UX Design Requirements

UX-DR1: Dynamic Dashboard Widgets.
UX-DR2: System Health Sidebar Integration.
UX-DR3: Heartbeat Awareness (Next Run countdown).
UX-DR4: Actionable Recovery Toolkit.
UX-DR5: Material Table Persistence Pattern.
UX-DR6: Compliance Transparency Links.

### FR Coverage Map

- **Epic 1:** FR17, FR18, FR20, FR24, FR35, FR36, FR46, FR52, FR53, FR59, FR61, FR69, FR70, FR71, FR77.
- **Epic 2:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR22, FR25, FR33, FR65, FR75, UX-DR1, UX-DR3, UX-DR5.
- **Epic 3:** FR9, FR10, FR11, FR12, FR32, FR42, FR43, FR44, FR45, FR72, FR73.
- **Epic 4:** FR13, FR14, FR15, FR19, FR23, FR26, FR27, FR31, FR37, FR50, FR51, FR56, UX-DR2, UX-DR4, UX-DR6.
- **Epic 5:** FR16, FR21, FR28, FR29, FR30, FR34, FR38, FR41, FR74, FR76.
- **Epic 6:** FR8, FR39, FR40, FR47, FR48, FR49, FR54, FR55, FR57, FR58, FR60, FR62, FR63, FR64, FR66, FR67, FR68.
