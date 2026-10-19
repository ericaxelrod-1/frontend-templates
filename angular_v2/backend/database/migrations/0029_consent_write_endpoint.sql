-- =============================================================================
-- 0029: the consent WRITE, exposed as exactly one RPC
-- =============================================================================
--
-- WHAT THIS FILE IS
--
-- `0028` built the consent model and its write seam, `authz.record_consent_decision`.
-- The seam works — it is the ONLY writer of `consent_records` and it does its own
-- authorization — but it is INVISIBLE to the API layer, and the consequence is a
-- feature that looks finished and does nothing:
--
--   * `0028` creates the function in the `authz` schema.
--   * `postgrest.conf` declares `db-schemas = "public"`, so PostgREST serves ONLY
--     the `public` schema.
--   * Therefore `POST /rpc/record_consent_decision` is a 404, while the committed
--     `openapi.json` — which is generated from the live catalog — contains no
--     `record_consent_decision` at all.
--
-- The frontend POSTed to that URL and caught the 404 with
-- `catchError(() => of(null))`, which turned a failed write into a value the caller
-- could not tell from a successful one. A person who clicked "accept" got a
-- success-shaped answer and no row. That is `AGENTS.md` §2.3: silently returning a
-- success-shaped value is a bug.
--
-- This file closes the gap by exposing ONE function, and nothing else.
--
-- -----------------------------------------------------------------------------
-- WHY THIS IS A WRAPPER AND NOT `db-schemas = "public", "authz"`
-- -----------------------------------------------------------------------------
--
-- The obvious fix is to add `authz` to `db-schemas`. It is refused, and the reason
-- is the blast radius: `db-schemas` is a SCHEMA-WIDE switch, and `authz` is not a
-- bag of helpers — it holds `authz.actor()`, `authz.serving_role()`,
-- `authz.has_permission`-adjacent seams, `authz.purge_expired_consent_records()`,
-- `authz.append_privacy_request_audit()` and the retention/anonymisation helpers.
-- Serving it would publish every one of them as an RPC, and the exposure would be
-- the whole authorization surface rather than one write.
--
-- **THE EXPOSURE MUST BE ONE FUNCTION, NOT ONE SCHEMA.** So `authz` stays out of
-- `db-schemas`, and the one function the frontend needs is re-declared in `public`,
-- which is where PostgREST can address it and where the generated contract can name
-- it (§B3/§B4: the client is generated from the live catalog, so a function that is
-- not in a served schema is a URL the frontend would have to hand-write).
--
-- -----------------------------------------------------------------------------
-- WHY THE WRAPPER IS `SECURITY INVOKER` AND NOT `SECURITY DEFINER`
-- -----------------------------------------------------------------------------
--
-- `SECURITY INVOKER` is the default and it is stated explicitly here because the
-- default is the safe one and the whole point of this file is that it must not be
-- changed by accident.
--
-- As INVOKER the wrapper runs with the CALLER's privileges, so the caller's
-- privileges are the ones in force and the wrapper adds no authority of its own: a
-- caller can reach exactly what the inner function lets it reach, and nothing more.
--
-- As DEFINER it would run as the migration/owner role — the role that OWNS
-- `consent_records` — and a table's owner bypasses its own RLS policies, silently
-- and without error (§B2). `consent_records` is `ENABLE ROW LEVEL SECURITY` and
-- deliberately NOT `FORCE` (`0028`), precisely because the only writer is a
-- `SECURITY DEFINER` seam that runs as that owner. A second DEFINER layer would
-- widen the owner-bypass window to the whole wrapper and would make the "the only
-- writer authorizes itself" property of `0028` untrue.
--
-- **ONE PRIVILEGED LAYER IS ENOUGH.** `authz.record_consent_decision` is already
-- `SECURITY DEFINER` and already does the whole of the authorization for this
-- write:
--
--   * `authz.serving_role()` must be `app_member` or `app_admin`, so an anonymous
--     caller is refused by name (`42501`);
--   * the SUBJECT is `authz.actor()` — the `sub` claim — and there is no
--     `p_user_id` parameter anywhere in the signature, so a caller cannot record a
--     decision for somebody else. The wrapper adds no subject parameter either,
--     for the same reason: the subject is derived from the claims, and that is the
--     whole authorization for the write.
--
-- So the wrapper is a NAME, not a privilege. It says "this one function is the one
-- the API layer may address", and it delegates.
--
-- -----------------------------------------------------------------------------
-- WHY `app_member` NEEDS `EXECUTE` ON THE INNER FUNCTION — AND WHY THAT IS SAFE
-- -----------------------------------------------------------------------------
--
-- The wrapper is INVOKER, so the call it makes into `authz` is checked against the
-- CALLER's privileges: without `EXECUTE` on `authz.record_consent_decision`, every
-- member's call would be refused with `42501` at the grant layer. The grant is
-- therefore re-affirmed below.
--
-- **IT IS SAFE ONLY BECAUSE `authz` IS NOT IN `db-schemas`.** PostgREST cannot
-- address a schema it does not serve, so `app_member` cannot reach the inner
-- function over HTTP by naming it; the ONLY route from the API layer to the seam is
-- the public wrapper this file creates, and the wrapper takes no subject parameter
-- and performs no authorization of its own. A member with a `pg` connection can
-- still call `authz.record_consent_decision` directly, and it will still refuse
-- everything the wrapper refuses.
--
-- **THIS IS THE REASON `db-schemas` MUST NOT BE "TIDIED UP" TO INCLUDE `authz`.**
-- If `authz` were served, this grant would become a directly reachable RPC, and
-- with it every other function in that schema. The grant below and the shape of
-- `postgrest.conf` are one decision, and this comment is the half of it that lives
-- next to the SQL.
--
-- -----------------------------------------------------------------------------
-- WHAT IS NOT HERE
-- -----------------------------------------------------------------------------
--
--   * `authz.effective_consent()` is NOT exposed. The frontend reads the series
--     through the `consent_records` TABLE, which RLS already scopes to the subject
--     and to administrators, so the derived state needs no RPC. This file exposes
--     the write and only the write.
--   * No table grant changed. `consent_records` still has `SELECT` for
--     `app_member` and `app_admin` and no other verb for anybody, and `INSERT`
--     for nobody — the wrapper is not a second writer, it is the same writer.
--   * No policy changed. `0028`'s policies and `0028`'s append-only guard are
--     untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- THE WRAPPER
-- -----------------------------------------------------------------------------
--
-- `LANGUAGE sql` and a single `SELECT`: the body has no branch, so there is
-- nothing here that could disagree with the inner function about what a decision
-- is. Every question — which purposes exist, whether the caller may record, who
-- the subject is, what the mechanism may be — is answered in one place, by the
-- seam `0028` already wrote and already proved.
--
-- `SET search_path` IS PINNED, because a schema searched later must not be able to
-- shadow a name this body resolves. The one name the body uses is schema-qualified
-- (`authz.record_consent_decision`) and the pin is the second, independent defence
-- — the same pairing `0013` uses for `public.ccpa_applicable()`.
CREATE OR REPLACE FUNCTION public.record_consent_decision(
  p_purpose_key text,
  p_granted     boolean,
  p_mechanism   text,
  p_source      text DEFAULT 'app'
) RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT authz.record_consent_decision($1, $2, $3, $4) $$;

-- `EXECUTE` IS GRANTED TO `PUBLIC` ON EVERY NEW FUNCTION BY DEFAULT, so the revoke
-- is not optional — and it is written WITH THE SIGNATURE (types, not parameter
-- names), because a revoke spelled with parameter names matches no function and
-- fails silently.
--
-- This revoke is also what keeps `app_anon` out. `app_anon` is NOT granted below,
-- deliberately: an anonymous decision belongs in the BROWSER (a person who has not
-- signed in has no identity to attach a record to, and `0028` makes
-- `consent_records.user_id` nullable for exactly that reason), and the inner
-- function refuses an anonymous caller by name anyway. Revoke and grant, always
-- together: revoking from `PUBLIC` while granting to nobody would be strictly
-- worse than doing nothing, because every call would become a `42501`.
REVOKE EXECUTE ON FUNCTION public.record_consent_decision(text, boolean, text, text) FROM PUBLIC;

-- The two authenticated serving roles, and no others. `app_admin` is the superset
-- principal and not a bypass (§B2): it may record its OWN decision through the
-- same seam, and it still cannot record one for anybody else, because the subject
-- comes from the claims.
GRANT EXECUTE ON FUNCTION public.record_consent_decision(text, boolean, text, text) TO app_member, app_admin;

-- -----------------------------------------------------------------------------
-- THE INNER GRANT, RE-AFFIRMED — AND THE REASON IT IS ACCEPTABLE
-- -----------------------------------------------------------------------------
--
-- The wrapper is INVOKER, so the call into `authz` is checked against the
-- CALLER's privileges and `app_member` needs `EXECUTE` on the inner function.
-- `0028` already granted it; re-affirming it here makes the dependency explicit
-- next to the thing that depends on it, and makes the file self-contained if a
-- future migration revokes it by accident.
--
-- **IT IS SAFE ONLY BECAUSE `authz` IS NOT IN `db-schemas`.** PostgREST serves
-- `public` alone, so the inner function is not addressable over HTTP and the only
-- route from the API layer to the seam is the wrapper above. If somebody adds
-- `authz` to `db-schemas`, this grant becomes a directly reachable RPC and every
-- other function in that schema becomes reachable with it. Do not "tidy up"
-- `postgrest.conf`.
GRANT EXECUTE ON FUNCTION authz.record_consent_decision(text, boolean, text, text) TO app_member, app_admin;

-- The schema the wrapper lives in has to be usable by the serving roles, which
-- `0001` already established (`GRANT USAGE ON SCHEMA public TO app_anon,
-- app_member, app_admin`).
--
-- NO `REVOKE EXECUTE … FROM PUBLIC` IS NEEDED ON THE INNER FUNCTION HERE: `0028`
-- already revoked it, and a revoke that is repeated in every migration is a second
-- copy of a decision that has one owner.

NOTIFY pgrst, 'reload schema';

-- DOWN
-- See database/migrations/0029_consent_write_endpoint.down.sql. Kept separate: a
-- second copy of one down script is the drift `test/unit/down-script.spec.ts` exists
-- to prevent.
