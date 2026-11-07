# Plans

Plans are per company (team). The Team Leader activates them; everyone in the team gets the plan.

| Plan | Price | Locations | Accounts per role* | Extras |
|---|---|---|---|---|
| **Free** | $0 | 1 | 1 | — |
| **Pro Monthly** | $1 / month | many | up to 20 | — |
| **Pro Lifetime** | $10 once | many | up to 20 | — |
| **Supporter** | $20 once | many | up to 20 | feature / utility requests (answered first), Supporter badge |

\* Roles: Oversee, Staff, Onlooker. The Team Leader is always one, on top.

## When Pro Monthly ends

Nothing is deleted. Only the first location (the warehouse when made together) and the first account
of each role keep working. The others are **locked** until Pro is renewed:

- locked locations: stock can be looked at, but no In / Out / Transfer / count there
- locked accounts: can sign in and look (like an Onlooker), but cannot change anything

## Activation codes (now)

- **Developer** (More → Plan → Developer tools → Codes): pick Pro Monthly (1, 3, 6 or 12 months),
  Pro Lifetime or Supporter, how many, a note → **Make codes**. Codes look like `FQG8-D2KT-4N78` and
  are shown only once (only a fingerprint is kept), so share them right away.
- Set **How to buy** (e.g. a WhatsApp number): it is shown on every team's Plans screen.
- **Team Leader** (More → Plans & activation code): types the code → the plan starts at once.
  Monthly codes add their months after the current Pro month. A code works once. 10 wrong codes an
  hour are allowed per team.
- **Teams** tab: see every company's plan and set one by hand (e.g. a free month).
- **Requests** tab: feature requests from Supporter teams first; set New / Planned / Done / Not planned
  and reply; the team sees the answer.

PT. Pratama Steel is on **Supporter** (set by the developer, free).

## Google Play purchase (later, with the Play Store version)

Play Store rules require paying for app features through Google Play Billing (Google keeps 15%).
Steps when the Play Console account is ready:

1. Create the app in Play Console and upload a signed **AAB** (the build will be switched from APK).
2. Create the products:
   - subscription `pro_monthly` — $1 / month
   - one-time products `pro_lifetime` — $10, and `supporter` — $20
3. Add a service account for purchase checks, then the app gets a "Buy" button per plan and a
   server function that verifies the purchase and sets the team's plan (`plan_source = google_play`).
4. Codes keep working for promotions.

## Technical

- `teams.plan`, `plan_until` (null = for life), `plan_source`; `team_plan()` treats an ended month as Free.
- Limits are checked by the database (triggers on locations, profiles, movements), so no app version
  can go past them. `my_role()` returns Onlooker for a locked account.
- Migrations: `20261107020000_plans.sql`, `20261107030000_plans_tighten.sql`. Tests cover limits,
  locking after Pro ends, codes, requests and permissions.
