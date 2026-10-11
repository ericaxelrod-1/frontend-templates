# LLM_RULES.md - Project Instructional Context

## Project Overview
This project is a high-performance, full-stack boilerplate featuring an **Angular 18 frontend** and a **NestJS 11 backend**. Its primary distinguishing feature is a **comprehensive, fully dynamic, database-driven access control system** that manages permissions for UI components, frontend routes, and API endpoints without hardcoded logic.

### Main Technologies
- **Frontend:** Angular 18.2.13, Angular Material 3 (`azure-blue` theme), NGXS (State Management), RxJS.
- **Backend:** NestJS 11, Fastify, TypeORM 0.3.23, SQLite 3 (Development), PostgreSQL (Production).
- **Security:** JWT Authentication, Passport, HMAC with rotating peppers, `geoip-lite` for jurisdictional resolution.
- **Infrastructure:** Unified housekeeping worker via `@nestjs/schedule` (Cron), "Sentinel" global system health monitoring.

---

## Building and Running

### Backend (NestJS)
```bash
cd angular/backend
npm install
npm run migration:run
npm run start:dev     # Development with hot reload
npm run start:prod    # Production mode (optimized memory)
```

### Frontend (Angular)
```bash
cd angular/frontend
npm install
npm run start         # Dev server at http://localhost:4200
npm run build         # Production build
npm run serve:ssr:frontend # Production run (SSR at http://localhost:4000)
```

---

## Development Conventions

### Code Integrity
- **Zero Placeholder Policy:** You are STRICTLY FORBIDDEN from creating or committing placeholder code (e.g., `// ...`, `TODO`, or empty function stubs for "later implementation"). 
- **Blocker Escalation:** If a feature or logic branch is underspecified or undefined, you MUST STOP and request guidance from the Senior Dev (Charlie) or Product Owner (Alice) before proceeding. Never guess or omit logic to meet a "completion" goal.
- **Verification Requirement:** A task is not "Done" until it passes `npm run build` without errors. Success claims MUST be backed by actual terminal output evidence.

### Coding Style
- **TypeScript:** Strict type safety required. Prefer `unknown` over `any`. Enable strict mode in `tsconfig.json`.
- **Naming:** Classes (`PascalCase`), Variables (`camelCase`), Files (`kebab-case`).
- **Database:** All tables and columns must follow `snake_case` strictly.
- **Imports Order:** 1. Angular Core -> 2. Third-party -> 3. App Core -> 4. Relative paths.

### Angular Best Practices
- **Template Singularity:** Either `template` (inline) or `templateUrl` (external), never both.
- **MDC Styling:** Avoid custom CSS for `mat-chips`; use div/span indicators.
- **Fluid Design:** Use `clamp()` and `auto-fit` grid patterns; remove fixed `max-width`.
- **ViewChild Safety:** Never use `*ngIf` on tables; render the structure for `ViewChild` availability.

---

## Security & Terminal Safety

**CRITICAL MANDATE:** You are FORBIDDEN from using your harness's default shell execution tool or native shell for terminal tasks (build, test, migration, file deletion). You MUST use the **secure execution tool** provided in the Transmutation toolset for all terminal operations. This ensures that every command is processed through a security firewall to prevent destructive actions and provides a secure, audited trail for project integrity.

---

## Token Optimization


### **The "Surgical Approach" Toolset**
You MUST use these tools to minimize context usage and maximize semantic signal. These tools are intended to be a **replacement for `read_file` or `cat`** in most cases and should be used **before (and often, instead of)** reading the full file:
- `query_recon`: Cluster mapping (replaces recursive `ls -R`).
- `query_discovery <file>`: Structural skeleton (replaces full `read_file` for understanding signatures).
- `query_impact <symbol>`: Blast radius (replaces noisy `grep` for dependency tracing).
- `query_toon <file>`: Context crushing (replaces `read_file` for massive JSON/log files).
- `execute_secure_command`: Secure terminal execution (NFA firewall).

### **Workflow: Adding New Features**
1.  **Map (`query_recon`)**: Identify the clusters for the new logic and relevant models.
2.  **Understand (`query_discovery`)**: Retrieve signatures for the interfaces you need to implement or extend.
3.  **Trace (`query_impact`)**: Map where those interfaces are used to ensure contract consistency.
4.  **Execute (`execute_secure_command`)**: Build and run tests frequently during implementation.

### **Workflow: Debugging**
1.  **Reproduce (`execute_secure_command`)**: Run the failing test or build to capture the raw error.
2.  **Crush (`query_toon`)**: If logs are large, extract only the nodes related to the stack trace.
3.  **Analyze (`query_impact`)**: Find all files consuming the failing symbol to identify "Shadow Dependencies."
4.  **Inspect (`query_discovery`)**: Review signatures of component dependencies to find interface mismatches.
5.  **Verify (`execute_secure_command`)**: Run the specific test suite to confirm the fix.

### **Command Prefixing**
- **Always prefix standard shell commands with `rtk`** (e.g., `rtk git status`). This reduces context usage by 60-90%.

---

## Documentation Registry
- [Angular README](angular/README.md)
- [Permission System](angular/docs/permissions-system.md)
- [Security Guide](angular/docs/security.md)
