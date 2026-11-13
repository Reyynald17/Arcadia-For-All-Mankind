# AFM — Design Document

**Project:** Arcadia: For All Mankind (AFM)
**Type:** Space agency management and roleplay simulation (MVP)
**Status:** As-built documentation of the current MVP
**Last updated:** 2026-11-13
**Audience:** Maintainers and contributors

This document describes how AFM is designed and how the current implementation actually behaves. Where the README, QUICKSTART, or ROADMAP disagree with the code, the code is authoritative and the discrepancy is listed in [§8](#8-known-deviations-docs-vs-code). Decisions that still need to be made are collected in [§9](#9-open-decisions).

Status legend used throughout:

| Tag | Meaning |
|-----|---------|
| **I** | Implemented and reachable |
| **P** | Partially implemented |
| **D** | Designed / documented but not implemented |
| **X** | Implemented but not reachable from the UI |

---

## 1. Purpose and scope

AFM is a single-player-vs-NPC simulation in which a player registers a space agency, spends limited resources on research, vehicle production, and missions, and climbs a global ranking. Outcomes are resolved by a rules engine called the **Automated Game Master (AGM)**. The MVP deliberately avoids LLM calls.

### 1.1 Goals

- Zero AI token usage; all outcomes come from explicit formulas.
- Zero-cost hosting: Vercel frontend, Railway/Render backend, Supabase free tier.
- A complete playable loop: register -> dashboard -> research -> produce -> launch -> rank.
- Deterministic-enough outcomes for debugging and fairness.

### 1.2 Non-goals for the MVP

- Real-time multiplayer, WebSockets, or live matchmaking.
- AI-generated narrative.
- Facility building, personnel, diplomacy, alliances.
- Mobile clients.
- Payment, moderation, or admin tooling.

---

## 2. Game design

### 2.1 Actors

| Actor | Responsibility |
|-------|----------------|
| Player agency | Issues commands, owns one agency row |
| NPC agency | Autonomous simulated competitor in the `npcs` table |
| AGM | Validates commands, computes costs, resolves missions |
| Supabase | Authoritative store for auth users and game data |

### 2.2 Core loop (as built)

1. Player registers an agency; defaults are provisioned.
2. Player spends **AP** and **Budget** on research, production, or launch commands.
3. AGM validates resources, resolves the action, and mutates agency stats.
4. Logs are written for research, production, and missions.
5. RP determines the global ranking.
6. AP is intended to refill periodically; no scheduler exists yet.

Today steps 1, 3, 4, and 5 work through the API. Step 2 has no UI entry point (the command form is not mounted), and step 6 is not implemented.

### 2.3 Resources and statistics

Defaults are hardcoded in the register route and duplicated in the schema and in `backend/src/utils/constants.js`.

| Stat | Range | Default | Direction | Notes |
|------|-------|---------|-----------|-------|
| AP (Action Points) | 0–50 | 25 | Spent | Max 50; expected +25 on distribution days (`D`) |
| Budget | >= 0 | 50 | Spent | No income source in MVP |
| RP (Ranking Points) | >= 0 | 0 | Gained | Ranking is `ORDER BY rp DESC`; also grants `floor(rp / 20)` mission bonus |
| SI (Stability Index) | 0–100 | 70 | Volatile | Clamped on launch |
| IPI (International Prestige Index) | 0–100 | 60 | Volatile | Clamped on launch |
| SLR (Successful Launch Rate) | 0–100 | 0 | Derived | `round(successful / total * 100)` for player agencies |
| Total / successful launches | >= 0 | 0 | Derived | Incremented on each launch |

Database columns have no `CHECK` constraints, so these ranges are conventions enforced only by route code (and only partially).

### 2.4 Command catalog

#### Research — `POST /api/research/start`

- Input: `agencyId`, `technologyName`.
- Validation: technology exists by exact `name`; agency has `research_cost_ap` and `research_cost_budget`.
- Effect: deducts AP and budget, inserts a `RESEARCH_STARTED` log.
- Not implemented: completion timer, unlocked-tech storage, prerequisite enforcement, duplicate-research prevention. `duration_days` is recorded only in the log payload.

#### Production — `POST /api/production/vehicle`

- Input: `agencyId`, `vehicleName`, `vehicleType`.
- Costs (AGM defaults; unknown types silently use the sounding-rocket cost):

| Vehicle type | AP | Budget |
|---|---|---|
| `sounding-rocket` | 5 | 10 |
| `orbital-rocket` | 8 | 20 |
| `satellite` | 6 | 15 |
| `capsule` | 10 | 30 |
| `probe` | 7 | 18 |
| `lander` | 12 | 40 |

- Effect: validates resources, inserts a vehicle with `reliability = 70`, `status = 'testing'`, deducts AP and budget, writes a `PRODUCTION_COMPLETED` log.
- Ordering issue: the vehicle row is inserted before resources are deducted, and the sequence is not transactional.

#### Launch — `POST /api/launch/mission`

- Input: `agencyId`, `missionName`, `vehicleId`, `missionType`.
- Costs (unknown types silently use the test-flight cost):

| Mission type | AP | Budget | Difficulty |
|---|---|---|---|
| `test` | 3 | 5 | -5 |
| `scientific` | 5 | 15 | -10 |
| `manned` | 8 | 30 | -20 |
| `colonial` | 15 | 50 | -30 |

- Not implemented: vehicle ownership check, vehicle stat/status updates after flight, mission duration, deferred completion.

### 2.5 Mission resolution

Implemented in `backend/src/services/agm.js`.

```
raw       = vehicle.reliability
          + floor(agency.rp / 20)      // tech bonus
          + 5                         // crew bonus (placeholder constant)
          + difficulty[missionType]
          + uniform(-5, +5)           // random variance
finalScore = clamp(raw, 0, 100)

success = finalScore >= 50      // uses the unrounded, clamped score
```

Outcome bands:

| Score | Result | RP | IPI | SI | Crew deaths |
|-------|--------|----|-----|----|-------------|
| 80–100 | Complete success | +10 | +5 | +5 | 0 |
| 50–79 | Partial success | +5 | +2 | +2 | 0 |
| 30–49 | Failure | 0 | -10 | -5 | 0 |
| 0–29 | Catastrophic | 0 | -20 | -15 | 1 if `manned`, else 0 |

On launch the route:

1. Loads agency and vehicle.
2. Computes cost and simulation.
3. Rejects if AP or budget is insufficient.
4. Updates agency AP, budget, RP, IPI, SI, launch counters, and SLR.
5. Inserts a `missions` row with `result` = `success` or `failure`.
6. Inserts a `MISSION_COMPLETED` log containing the numeric score.

The numeric score is stored only in `logs.data`; the `missions` row records the boolean result. The random variance means outcomes are **not deterministic**, contrary to the README.

### 2.6 NPC autopilot

Implemented in `backend/src/services/npc.js`, but never invoked by any route or scheduler.

| Roll | Action | Behavior |
|------|--------|----------|
| < 0.4 | Research | Picks the first technology row, deducts AP from `npcs` |
| 0.4–0.7 | Production | Picks a random type, deducts AP and budget from `npcs`; no vehicle row created |
| >= 0.7 | Launch | Uses a mock vehicle with reliability 75, updates NPC stats and SLR (float), no mission or log rows |

NPCs live in a separate `npcs` table and therefore never appear in the global ranking, which queries `agencies`.

### 2.7 Progression and eras (intended)

- Eras: `1969-1975`, `1975-1985`, `1985-1995`, `1995+`.
- Technologies carry `era`, `prerequisite text[]`, and `duration_days`.
- Intended gating: research completes after `duration_days`, prerequisites must be unlocked first, and unlocked tech raises vehicle reliability or unlocks vehicle types.
- None of the gating is implemented; `GET /api/research/available/:agencyId` returns every technology regardless of agency.

---

## 3. Technical design

### 3.1 System architecture

```
Browser — React 18 + Vite (dev :5173)
  |
  |  fetch JSON, optional Authorization: Bearer <supabase access token>
  v
Express API (dev :8787, prefix /api)
  |  @supabase/supabase-js using the SERVICE ROLE key
  v
Supabase
  |- auth.users          (Supabase Auth)
  |- public.agencies     (players)
  |- public.technologies
  |- public.vehicles
  |- public.missions
  |- public.logs
  |- public.npcs
```

The backend is a single Express process with routers injected with one Supabase client. The service-role client bypasses Row Level Security.

### 3.2 Backend components

| File | Responsibility | Status |
|------|----------------|--------|
| `backend/src/index.js` | App bootstrap, CORS, JSON, route mounting, health, error handler | I |
| `backend/src/config/supabase.js` | Second Supabase client instance | Unused |
| `backend/src/middleware/auth.js` | `validateToken` | Stub, unused |
| `backend/src/routes/auth.js` | Register and login | I |
| `backend/src/routes/agency.js` | Agency read, ranking, stat update | I |
| `backend/src/routes/research.js` | Start research, list tech | I / P |
| `backend/src/routes/production.js` | Produce vehicle | I |
| `backend/src/routes/launch.js` | Resolve and record mission | I |
| `backend/src/routes/dashboard.js` | Aggregated dashboard and ranking | I |
| `backend/src/services/agm.js` | Costs, validation, simulation | I |
| `backend/src/services/npc.js` | NPC autopilot | X |
| `backend/src/utils/constants.js` | Game constants | Mostly unused |
| `backend/src/utils/validators.js` | Field-presence helper | Unused |

### 3.3 Frontend components

| File | Responsibility | Status |
|------|----------------|--------|
| `frontend/src/main.jsx` | React root, `BrowserRouter` | I |
| `frontend/src/App.jsx` | Routes and localStorage-based guard | I |
| `frontend/src/pages/Login.jsx` | Login form, stores user + session | I |
| `frontend/src/pages/Register.jsx` | Agency registration, stores user + agency | I |
| `frontend/src/pages/Dashboard.jsx` | Agency overview, resources, stats | I |
| `frontend/src/components/CommandForm.jsx` | Research / production / launch form | X |
| `frontend/src/components/StatsCard.jsx` | Stat display card | Unused |
| `frontend/src/components/Navbar.jsx` | Static nav links | Unused |
| `frontend/src/hooks/useAuth.js` | Supabase client-side auth hook | Unused |
| `frontend/src/utils/api.js` | Fetch wrapper | Unused |
| `frontend/src/utils/supabase.js` | Supabase browser client | Unused |
| `frontend/src/lib/supabaseClient.js` | Supabase browser client | Used only by unused hook |

### 3.4 Request flows

#### Registration

```
POST /api/auth/register {email, password, agencyName, country, culture, history, targets}
  -> supabase.auth.admin.createUser({email, password, email_confirm: true})
  -> INSERT agencies {user_id, name, country, culture, history, targets, defaults}
  -> 201 {message, agency, user}
```

Failure mode: if the agency insert fails after the auth user is created, an orphaned auth user remains. `targets` is submitted by the UI as a string while the column is `text[]`, so the insert can fail on that field.

#### Login

```
POST /api/auth/login {email, password}
  -> supabase.auth.signInWithPassword
  -> 200 {message, session, user}
```

The frontend stores `afm_user` and `afm_session` in `localStorage`.

#### Dashboard load

```
GET /api/agency/:userId
  -> agencies WHERE user_id = :userId LIMIT 1
  -> 200 agency row
```

The client sends `Authorization: Bearer <access_token>`, but the server never inspects it.

#### Command execution (intended, not reachable)

```
POST /api/<research|production|launch>/...
  -> load agency (and vehicle)
  -> AGM validate / cost / simulate
  -> update agencies
  -> insert activity row(s)
  -> 201 with new state
```

`CommandForm` targets `${VITE_API_URL}/api/...` while `VITE_API_URL` already ends in `/api`, producing `/api/api/...`. It is currently dead code.

### 3.5 Authentication and authorization

**As built**

- Credentials are managed by Supabase Auth; the backend signs users in server-side.
- The browser holds the Supabase session and sends the access token.
- `validateToken` in `backend/src/middleware/auth.js` only checks for a `Bearer ` prefix and then calls `next()`; it verifies nothing and no route registers it.
- All gameplay routes accept `agencyId` / `userId` from the request body or path.
- The API uses the service-role key, so RLS cannot compensate.
- The frontend route guard is a `localStorage` check only.

**Normative design**

1. Every non-auth route must run JWT verification.
2. `agencyId` must be derived from the verified `sub`, never from the request body.
3. The service-role key stays server-side only; direct client access uses the anon key plus RLS.
4. An `agencyId` vs `auth.uid()` ownership check must gate all mutations.

### 3.6 API contract

All routes are mounted under `/api`.

| Method | Path | Input | Output | Status | Auth required (design) |
|--------|------|-------|--------|--------|------------------------|
| POST | `/auth/register` | email, password, agencyName, country, culture, history, targets | agency, user | I | No |
| POST | `/auth/login` | email, password | session, user | I | No |
| GET | `/agency` | — | top 50 agencies by RP | I | Yes |
| GET | `/agency/:userId` | userId | agency row | I | Yes |
| POST | `/agency/:agencyId/update-stats` | ap, budget, rp, si, ipi, slr | updated agency | I | Yes (admin) |
| POST | `/research/start` | agencyId, technologyName | new AP/budget, duration | I | Yes |
| GET | `/research/available/:agencyId` | agencyId | all technologies | P | Yes |
| POST | `/production/vehicle` | agencyId, vehicleName, vehicleType | vehicle, new AP/budget | I | Yes |
| POST | `/launch/mission` | agencyId, missionName, vehicleId, missionType | mission, simulation, new stats | I | Yes |
| GET | `/dashboard/:agencyId` | agencyId | agency, rank, logs, vehicles, missions | I | Yes |
| GET | `/dashboard/ranking/global` | — | top 50 with rank | I | Yes |
| GET | `/health` | — | status, timestamp | I | No |

Responses are JSON. Errors use `{ "error": "<message>" }`; the register route may also include raw `details`.

### 3.7 Data model

`supabase/schema.sql` is the canonical schema. `database/schema.sql` describes a different, unused application model (`users`, `rockets`, `research_projects`, `game_events`) and should not be applied.

```
agencies (1) ──< vehicles
agencies (1) ──< missions >── (0..1) vehicles
agencies (1) ──< logs

technologies (independent; referenced only by name)
npcs         (independent; not linked to agencies)
```

| Table | Key columns | Notes |
|-------|-------------|-------|
| `agencies` | `id` uuid PK, `user_id` uuid, `name`, `country`, `culture`, `history`, `targets text[]`, stats, counters, `created_at` | `user_id` has no FK and no unique constraint; one agency per user is not enforced |
| `technologies` | `id`, `name text`, `era`, `research_cost_ap`, `research_cost_budget`, `duration_days`, `prerequisite text[]` | `name` is not unique, but research looks it up with `.single()` |
| `vehicles` | `id`, `agency_id` FK SET NULL, `name`, `type`, `reliability`, `status`, counters | `reliability` and counters are never updated after creation |
| `missions` | `id`, `agency_id`, `name`, `vehicle_id`, `type`, `result`, `ap_cost`, `budget_cost`, `crew_deaths`, `launched_at`, `completed_at` | No score column; `launched_at == completed_at` |
| `logs` | `id`, `agency_id`, `event_type`, `description`, `data jsonb`, `created_at` | Stores mission score and cost breakdowns |
| `npcs` | `id`, `name`, `archetype`, stats, `strategy jsonb`, `created_at` | Separate from `agencies`, so NPCs are not ranked |

Deleting an agency leaves dependent rows with `agency_id = NULL` (no cascade), producing orphaned records.

### 3.8 State transitions and invariants

Intended invariants:

1. `0 <= ap <= 50`, `budget >= 0`, `rp >= 0`, `0 <= si <= 100`, `0 <= ipi <= 100`.
2. `slr == round(successful_launches / total_launches * 100)` when `total_launches > 0`, else 0.
3. Every resource spend is accompanied by exactly one activity log.
4. A mission's reported result matches its score band.
5. A vehicle used in a mission belongs to the launching agency.
6. Each auth user owns at most one agency.
7. Multi-row mutations (deduct + insert + log) are atomic.

Current enforcement: only rules 2 and 4 hold for player agencies. Rules 1, 3, 5, 6, and 7 are not enforced. No database constraints or transactions back them.

### 3.9 Error handling

- `400` missing fields, unknown technology, insufficient resources, DB write errors.
- `401` missing bearer token (only if middleware were applied).
- `404` agency, vehicle, or technology not found.
- `500` unexpected exceptions; includes `err.message`.
- No central async wrapper, no retry, no structured logging, no request IDs.

### 3.10 Scheduling

None. AP distribution, NPC turns, research completion, and world events all require a scheduler, which does not exist. `AGMEngine.distributeAP` is implemented but never called.

### 3.11 Configuration

| Variable | Read by | Notes |
|----------|---------|-------|
| `SUPABASE_URL` | Backend, `database/init.js` | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Required; must never reach the browser |
| `SUPABASE_ANON_KEY` | Backend | Read but unused |
| `SUPABASE_KEY` | `database/init.js` | Different name for the same concept |
| `PORT` | Backend | Defaults to 8787 |
| `NODE_ENV` | Backend | Logged only |
| `VITE_API_URL` | Frontend | Expected to include the `/api` suffix |
| `VITE_SUPABASE_URL` | Frontend | Used only by unused Supabase clients |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Used only by unused Supabase clients |

The Vite dev server proxies `/api` to `http://localhost:8787`, but the frontend uses absolute `VITE_API_URL` URLs, so the proxy is normally bypassed.

CORS is currently `cors()` with no origin allowlist.

---

## 4. Frontend design

### 4.1 Routes

| Path | Component | Guard |
|------|-----------|-------|
| `/login` | `Login` | Public |
| `/register` | `Register` | Public |
| `/dashboard` | `Dashboard` | `afm_user` in localStorage |
| `/` | redirect | To dashboard or login |

### 4.2 Screens

- **Login:** email/password form; on success stores `afm_user` and `afm_session`.
- **Register:** multi-field agency intake; on success stores `afm_user` and `afm_agency` but no session.
- **Dashboard:** agency header, overview (culture, launches, success rate, history), resources (AP, budget, RP with progress bars), key statistics (SI, IPI, SLR), and quick-action buttons that have no handlers.

Documented but missing screens: Commands, Missions, Vehicles, Ranking (`QUICKSTART.md`).

### 4.3 Client state and API conventions

- Auth state is `localStorage` only; no context, no token refresh, no expiry handling.
- Pages call `fetch` directly; `utils/api.js` is unused.
- The API base convention is ambiguous: pages assume `VITE_API_URL` includes `/api`, while the unused `CommandForm` appends `/api` again.
- Dashboard progress bars divide AP and RP by 100 even though AP caps at 50 and RP is unbounded; bars can exceed 100% width.

### 4.4 Styling

- Base reset and form/error styles in `index.css`.
- Screen styles in `pages/Auth.css` and `pages/Dashboard.css` (the files actually imported).
- `styles/Auth.css`, `styles/Dashboard.css`, and `styles.css` are unused duplicates or orphans; most `App.css` classes are unused.
- Visual direction: dark navy space theme with blue accents; minimal responsive rules.

---

## 5. Deployment topology

Per `DEPLOYMENT.md`, the target topology is:

```
Vercel (static frontend) -> Railway/Render (Express API) -> Supabase
```

Configuration does not fully match:

- Root `vercel.json` describes a single project that builds only the backend function while routing everything else to `frontend/dist/index.html`.
- `backend/vercel.json` describes an API-only Vercel project.
- The root `.env.example` uses `VITE_API_BASE_URL`, `PORT=3000`, and `CORSAlLOW_ORIGINS`, none of which the code reads.
- `frontend/.env.example` omits the `VITE_` prefixes and `VITE_API_URL`, so copying it produces `undefined` API URLs.

---

## 6. Constraints

- No AI calls.
- Free-tier infrastructure only.
- Node.js 18+ (project is developed on Node 24).
- Supabase is the only datastore; there is no local database for development.
- The MVP runs one game world; there is no world/season identifier.

---

## 7. Security model and known threats

| Threat | Current state | Required mitigation |
|--------|---------------|---------------------|
| Credential leakage | `.env` files and `node_modules` are tracked in git | Rotate keys, untrack, purge history |
| Agency impersonation | No JWT verification; IDs come from the client | Verify JWT, derive agency from `sub` |
| Direct database access | No RLS on the canonical schema; anon key is public | Enable RLS with ownership policies |
| Cross-origin abuse | `cors()` allows every origin | Allowlist configured origins |
| Client-side auth bypass | Route guard reads localStorage | Treat the guard as UX only; enforce server-side |
| Token theft via XSS | Tokens in localStorage | Prefer httpOnly cookies or short-lived tokens |
| Information leakage | `err.message` returned on 500 | Log internally, return generic errors |
| Brute force | No rate limiting | Add per-IP and per-account limits |
| Admin endpoint exposure | `update-stats` is public | Require admin authentication or remove |

---

## 8. Known deviations (docs vs code)

| Claim | Reality |
|-------|---------|
| "Deterministic simulation" | `simulateMission` adds `Math.random()` variance |
| `npm test` exists | No test script or test files in any package |
| Commands reachable from the UI | `CommandForm` is never mounted; dashboard buttons are inert |
| Dashboard shows missions/vehicles/rankings | Only summary stats are shown |
| AP is distributed on schedule | No scheduler; `distributeAP` is unused |
| NPCs compete globally | NPC rows are not included in ranking queries |
| RLS protects data | The canonical schema has no RLS; the backend uses the service role |
| `frontend/.env.example` is usable | It lacks `VITE_API_URL` and `VITE_` prefixes |
| Two schema directories are interchangeable | They model different applications; only `supabase/schema.sql` matches the code |

---

## 9. Open decisions

Each item needs an explicit choice before the next phase.

1. **Authorization model.** Verify Supabase JWTs in Express and derive the agency from `auth.uid()`, or move all mutations into Supabase RPCs with RLS. Recommendation: verify JWTs and add RLS; keep the service role out of request paths.
2. **Determinism.** Keep random variance (better replay variety) or use a seeded PRNG per mission (reproducible). Recommendation: seeded PRNG with the seed stored in `logs.data`.
3. **Canonical schema.** Adopt `supabase/schema.sql`, delete `database/schema.sql`, or merge the richer model (`users`, `agency_members`, `research_projects`, achievements). Recommendation: adopt the code-backed schema and delete the other.
4. **API base convention.** Decide whether `VITE_API_URL` is an origin (`http://host`) or includes `/api`. Recommendation: origin only, with `/api` centralized in one client module.
5. **Research completion.** Instant unlock, duration-based completion via scheduler, or spend-to-complete. Recommendation: duration-based with a `research_projects` table and a scheduler.
6. **Mission timing.** Instant resolution (current) or launch -> pending -> completed. Recommendation: pending/completed to enable narrative and scheduling.
7. **NPC representation.** Keep `npcs` separate (simple) or model NPCs as non-human `agencies` so they compete in ranking. Recommendation: unify into `agencies` with an `is_npc` flag.
8. **Vehicle progression.** Should launches change reliability/status/counters, and should failures reduce reliability. Recommendation: yes; update vehicle stats on every launch.
9. **Resource economy.** Add budget income sources and AP distribution, or keep a fixed pool per session. Recommendation: AP on a cron and budget tied to IPI.
10. **Dead code and duplication.** Remove unused components, unused Supabase clients, duplicate CSS, and the stub middleware. Recommendation: remove now; keep the command form and wire it up.
11. **Ranking scope.** Top 50 by RP only, or ranking by a composite score. Recommendation: keep RP for MVP, revisit with seasons.

---

## 10. Roadmap alignment

`ROADMAP.md` phases map onto this design as follows:

- **Phase 2 (automation):** open decisions 5, 6, 7, 9; requires a scheduler and a canonical research model.
- **Phase 3 (narrative/UI):** depends on mission timing (decision 6), vehicle/mission/ranking screens, and the command form.
- **Phase 4 (full game):** dependent on the authorization model and a merged data model.

---

## Appendix A: Constants reference

| Constant | Value | Source |
|----------|-------|--------|
| AP maximum | 50 | `constants.js`, `agm.distributeAP` |
| AP per distribution | 25 | `constants.js`, `agm.distributeAP` |
| Distribution days | Tue, Thu, Sat, Sun | `constants.js` (unused) |
| Mission types | test, scientific, manned, colonial | `constants.js`, `agm.js` |
| Vehicle types | sounding-rocket, orbital-rocket, satellite, capsule, probe, lander | `constants.js`, `agm.js` |
| Default vehicle reliability | 70 | register/production routes |
| Crew bonus | 5 | `agm.js` |
| Tech bonus | `floor(rp / 20)` | `agm.js` |
| Random variance | `uniform(-5, +5)` | `agm.js` |
| SI crisis threshold | 30 | `constants.js` (unused) |
| IPI low threshold | 40 | `constants.js` (unused) |

## Appendix B: Glossary

- **AGM** — Automated Game Master; the deterministic rules engine.
- **AP** — Action Points; the per-turn action budget.
- **RP** — Ranking Points; the leaderboard metric.
- **SI** — Stability Index; internal stability, 0–100.
- **IPI** — International Prestige Index; public support, 0–100.
- **SLR** — Successful Launch Rate; percentage of successful launches.
- **NPC** — Non-player agency simulated by autopilot logic.
- **Canonical schema** — `supabase/schema.sql`, the schema the code depends on.
