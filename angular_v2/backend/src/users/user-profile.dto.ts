import { ApiProperty } from '@nestjs/swagger';

/**
 * `GET /api/users/me`, and the body of `PATCH /api/users/me`'s `200`.
 *
 * ## THE TWELVE FIELDS ARE THE GRANT, AND THE GRANT IS THE CONTRACT
 *
 * These are exactly the twelve columns `app_member` may `SELECT` on `users`:
 *
 *     id, username, email, created_at,
 *     country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at,
 *     first_name, last_name
 *
 * (`0023_user_profile_and_disable.sql:687-692`). Not an approximation of them and not
 * a superset — the list, exactly, in the order the grant writes it.
 *
 * Two consequences, and the second is the one that bites:
 *
 *  1. Everything a member may know about their own account is here. Nothing else in
 *     `users` is theirs to see.
 *  2. **Adding a field to this class does not add a column to the page — it breaks
 *     the page.** The read behind this route names its columns and runs under the
 *     caller's OWN database role, so a field that is not in the member's column list
 *     makes the whole read fail (`403` for a column-restricted role on any column it
 *     cannot read, and `0008:475-481` refuses `select=*` outright for the same
 *     reason). A field here that is not in the grant is not a wider response, it is a
 *     `403` for every member.
 *
 * That is why `last_login_at`, `last_activity_at`, `email_verified_at`,
 * `deleted_at`, `email_anonymized` and the four `disabled_*` columns are absent,
 * and why the frontend's `profile-page.ts` says out loud that it cannot show them
 * rather than omitting them silently. The member genuinely cannot know whether their
 * address is verified, and a locally-derived "verified" badge would be a claim this
 * response cannot support.
 *
 * ## `id` IS A `uuid` AND THE REST OF THE IDENTIFIERS ARE `text`, AND THAT IS THE SCHEMA
 *
 * `id` is `uuid`; `username`/`email` are `text` (`0002_refresh_tokens.sql:29-35`);
 * `geo_accuracy_km` is `integer` and every other geographic column is `text`
 * (`0012_user_geo.sql:127-132`). The frontend's generated type
 * (`components['schemas']['users']`) says the same, and `ProfileMe` is a `Pick` of it —
 * so a widened type here would compile and then contradict the generated one.
 *
 * ## THE WIRE IS snake_case AND THERE IS NO KEY TRANSFORM
 *
 * AGENTS.md §B1: columns, wire and generated types are all snake_case, and a runtime
 * transform is forbidden because it rewrites keys inside `jsonb`. So these are the
 * property names, and there is no `class-transformer` naming strategy behind them.
 */
export class UserProfileDto {
  @ApiProperty({ format: 'uuid', description: "The caller's own `users.id`, from the verified token." })
  id: string;

  @ApiProperty({ description: 'Login name. Immutable: a BEFORE trigger refuses to rewrite it.' })
  username: string;

  @ApiProperty({ description: 'The address mail is delivered to. Only an email change moves it.' })
  email: string;

  @ApiProperty({ description: 'When the account row was created.' })
  created_at: string;

  @ApiProperty({ nullable: true, description: 'ISO 3166-1 alpha-2 country code, or NULL when unknown.' })
  country_code: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 3166-2 region code, or NULL when unknown.' })
  region_code: string | null;

  @ApiProperty({ nullable: true, description: 'City, or NULL when unknown.' })
  city: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Where the geography came from (`manual`, `geoip`, …), or NULL when there is none.',
  })
  geo_source: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Accuracy of the geography in kilometres. Never negative (0012 constraint).',
  })
  geo_accuracy_km: number | null;

  @ApiProperty({ nullable: true, description: 'When the geography was last established.' })
  geo_updated_at: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Given name as the member states it. NULL means nobody has stated one.',
  })
  first_name: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Family name as the member states it. NULL means nobody has stated one.',
  })
  last_name: string | null;
}
