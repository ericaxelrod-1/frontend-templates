---
alwaysApply: true
---

# CRITICAL MANDATE: Project Quality Gate

You MUST read [LLM_RULES.md](./LLM_RULES.md) in the root directory before proceeding with any task.

### Terminal & Execution Rules:
- You are strictly FORBIDDEN from using `bash` for any terminal operations.
- You MUST use `execute_secure_command` for all terminal tasks as mandated in the security rules.

### File Reading & Exploration Rules:
- You are **strictly FORBIDDEN** from using `cat` for initial exploration or large-scale file ingestion. 
- You MUST follow the sequential "Surgical Approach" workflow in the [Token Optimization](./LLM_RULES.md#token-optimization) section of `LLM_RULES.md`. 
- `cat` should ONLY be used for **surgical read operations** (targeting specific line ranges or sections) AFTER the other Transmutation tools (`query_recon`, `query_discovery`, `query_impact`) have been used to identify the precise point of interest.
