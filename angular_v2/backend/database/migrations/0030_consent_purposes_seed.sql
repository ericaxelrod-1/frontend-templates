-- =============================================================================
-- 0030: the consent CATALOGUE — the purposes this template ships with
-- =============================================================================
--
-- WHAT THIS FILE IS, AND WHY IT IS A MIGRATION
--
-- `0028` created `consent_purposes` and left it EMPTY. An empty catalogue is not
-- a neutral state: the consent widget asks about the purposes the catalogue
-- holds, so an empty one means the widget has nothing to ask, the settings
-- surface renders nothing, and **no decision can be stored** — the feature is
-- inert until somebody runs SQL by hand.
--
-- The catalogue is APPLICATION CONFIGURATION: the kinds of processing this
-- application does, shared by every visitor, with no foreign key to `users`
-- (`0028`'s decision). It is not data a user owns and not data a user creates,
-- so it belongs in a migration and not in `database/seed.ts` — the same
-- distinction `0028` draws when it says `consent_purposes` is "a catalogue a
-- fork fills in".
--
-- -----------------------------------------------------------------------------
-- WHICH PURPOSES THIS TEMPLATE SHIPS, AND WHY EACH ONE IS HERE
-- =============================================================================
--
-- TWO purposes, and BOTH of them have `requires_consent = false`. That is the
-- decision, and the rest of this file is the argument for it.
--
--   necessary        the account, the session and the messages the account
--                    needs. `legal_basis = 'contract'`: it is the processing
--                    the service cannot be provided without, so it is never a
--                    question. This is the column the gate reads — a purpose
--                    with `requires_consent = false` is granted implicitly —
--                    and it is why the catalogue is a MODEL and not a list of
--                    trackers.
--
--   consent_record   the record of the choices made here, kept so the site can
--                    show what somebody agreed to, and when. `legal_basis =
--                    'legitimate_interests'`: it is not consented to, because
--                    asking for consent to keep the record of a consent would be
--                    circular, and it is not part of the contract, because the
--                    contract is the account and not the evidence for it.
--
-- **TWO AND NOT ONE, because the model has a `legal_basis` column and a gate
-- that branches on it.** Merging them would force one legal basis onto two
-- activities that answer different questions — "what is the service?" and "what
-- do we keep to prove what you said?" — and the column would be decorative for
-- every row this template ships.
--
-- -----------------------------------------------------------------------------
-- NO PURPOSE THAT REQUIRES CONSENT, AND THE RULE THAT FOLLOWS FROM THAT
-- =============================================================================
--
-- **The template ships NO tracker.** `consent_tags` is empty, `consent_page_groups`
-- is empty, and no third-party script is loaded by anything in this repository.
--
-- So a purpose with `requires_consent = true` would make the widget ask EVERYBODY
-- a question about a tracker this template does not load — a question with no
-- meaning, asked to every visitor on the first visit, about nothing. That is
-- worse than an empty widget: it teaches people that this banner is noise, and
-- it is noise the moment a real tracker is added and they have learned to
-- dismiss it.
--
-- **SO A FORK THAT ADDS A TAG MUST ADD A PURPOSE IN THE SAME CHANGE.** That is
-- the rule this file's absence of `requires_consent = true` implies, and it is
-- stated here because the failure it prevents is silent:
--
--   * `consent_tags.purposes` is an array of purpose KEYS, not a foreign key —
--     a jsonb array cannot be one. So a tag naming a purpose nobody declared is
--     STORABLE, and a storable misconfiguration nothing reports is the silent
--     kind. `consent-config-materializer.ts` reports it ("no consent_purposes
--     row has key …"), but only once a pass of that materialiser has run.
--   * Until the purpose exists, the tag CANNOT LOAD AT ALL. The gate's subset
--     test looks each required purpose up in the catalogue; a purpose it cannot
--     find is not a "necessary" purpose, so it falls through to the decision
--     check, finds no decision for that key, and refuses the tag. The tag is
--     present, enabled, attached to a page group, and does nothing.
--   * And once the purpose DOES exist, the widget asks about it — which is the
--     correct behaviour, and the reason the purpose has to be added at the same
--     time as the tag rather than afterwards.
--
-- The shape a fork adds, in one line, is:
--
--     INSERT INTO public.consent_purposes
--            (key, label, description, legal_basis, requires_consent, policy_version)
--     VALUES ('analytics', 'Analytics', 'What the analytics tag measures.',
--             'consent', true, 1);
--
-- …and then `consent_tags.purposes` names `'analytics'`. `policy_version` is
-- bumped when the MEANING of an existing purpose changes, because that is what
-- makes a re-prompt detectable (`0028`'s decision 2): a decision taken under
-- version 1 does not silently extend to a version 2 that says something else.
--
-- -----------------------------------------------------------------------------
-- IDEMPOTENCE
-- =============================================================================
--
-- `ON CONFLICT (key) DO NOTHING`, and not `DO UPDATE`.
--
-- The seed must be safe to apply twice — the proof databases apply every
-- migration twice on purpose, because "applies cleanly" and "is idempotent" are
-- different claims — and `DO NOTHING` is the version of that which does not
-- OVERWRITE an operator's own edit. A fork that has rewritten the label of
-- `necessary` to match its own voice, or has raised its `policy_version` after
-- a tracker arrived, must not have that silently reverted by a re-applied
-- migration. The row is present after the migration, and applying the migration
-- again changes nothing.
--
-- =============================================================================

INSERT INTO public.consent_purposes
       (key, label, description, legal_basis, requires_consent, policy_version, sort_order)
VALUES
  (
    'necessary',
    'Essential processing',
    'Signing in, staying signed in, and sending the messages your account needs. ' ||
      'This is what the site cannot operate without, so it is not a choice and is not asked about.',
    'contract',
    false,
    1,
    0
  ),
  (
    'consent_record',
    'Record of your choices',
    'Keeping what you agreed to, and when you agreed to it, so the site can show you your own ' ||
      'choices and can show that they were made. It is kept without asking, because a record nobody ' ||
      'kept proves nothing.',
    'legitimate_interests',
    false,
    1,
    1
  )
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- DOWN
-- See database/migrations/0030_consent_purposes_seed.down.sql. Kept separate: a second
-- copy of one down script is the drift `test/unit/down-script.spec.ts` exists to prevent.
