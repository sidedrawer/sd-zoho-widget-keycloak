# Local Keycloak for the SideDrawer Zoho bridge (Keycloak edition)

A throwaway realm for exercising the widget's Keycloak OIDC flow end to end without touching a
real SideDrawer environment.

## Start it

```
cd keycloak
docker compose up -d
```

Admin console (plain HTTP, no cert warning): http://localhost:8080/admin (`admin` / `admin`).
Discovery document (HTTPS — what the widget actually uses):
https://localhost:8443/realms/sidedrawer-dev/.well-known/openid-configuration

Seed user: `dev@sidedrawer.test` / `dev`.

The widget's `local` preset (see `KC_PRESETS` in `app/widget.html`) already points at
`https://localhost:8443`, realm `sidedrawer-dev`, client `zoho-widget` — no extra config needed
to test against it. Run the widget with `npm start` (port 5011, HTTPS) and load
`https://127.0.0.1:5011/app/widget.html?preset=local`.

**Keycloak is served over HTTPS here on port 8443 (in addition to plain HTTP on 8080), reusing
this repo's existing self-signed `cert.pem`/`key.pem`** — not the more common HTTP-only
`start-dev` default. This is intentional, not incidental: the widget's own dev server
(`server/index.js`) only ever serves HTTPS, and an HTTPS page cannot `fetch()` an HTTP endpoint
(mixed content blocks the actual token exchange — the OAuth *redirects* would still work, since
browsers exempt top-level navigation from that rule, which is what makes this easy to miss until
the token POST itself fails). The first time you use it, accept the certificate warning for
`https://localhost:8443` in your browser too, the same way you already do for the widget itself.

## What's in `realm-export.json`, and why

- **`redirectUris` lists both `https://127.0.0.1:5011/...*` and `https://localhost:5011/...*`.**
  `server/index.js` binds all interfaces, so the widget is reachable at either hostname — the
  cert covers both (see its Subject Alternative Names) — and Keycloak's redirect-URI matching is
  exact, so both hostnames need their own entry; one won't cover the other. Each ends in a
  trailing `*`, not a bare path: Keycloak matches the redirect URI *including the query string*,
  and the widget always appends `?client_id=...` when it falls back to a default client id (see
  `widget.html`'s redirect-uri construction). A bare `.../widget.html` entry — no trailing `*` —
  will **not** match `.../widget.html?client_id=zoho-widget`; you'll get `invalid_redirect_uri`
  on Keycloak's own error page, not inside the app. This is the most likely first thing to break
  if you copy this file and drop the `*`.
- **`webOrigins` lists the browser origins (`https://127.0.0.1:5011`, `https://localhost:5011`)
  — no path, no trailing slash.** Keycloak only emits CORS headers on the token/logout/revoke
  endpoints for origins listed here. `https://sidedrawer.github.io/SideDrawer-keycloak/` (with a
  path) will never match; `https://sidedrawer.github.io` will.
- **`attributes."pkce.code.challenge.method": "S256"`** makes PKCE *required*, not just
  accepted — without it a downgrade to `plain`/no challenge is silently possible.
- **`attributes."post.logout.redirect.uris": "+"`** inherits the same list as `redirectUris`,
  so the RP-initiated logout redirect doesn't need its own separate registration.
- **No `clientScopes` at the realm level, and no `defaultClientScopes`/`optionalClientScopes`
  on the client.** This is deliberate: a *complete* realm export always spells out the full
  built-in scope set (`profile`, `email`, `roles`, `web-origins`, `offline_access`, etc.) with
  every protocol mapper, because a full export is meant to fully reproduce a realm standalone.
  This file isn't that — it's a minimal seed, and Keycloak's own realm-creation bootstrap
  populates those built-ins (and assigns the standard default/optional split to any client that
  doesn't override it) exactly as it would for a realm created by hand in the admin console.
  If you later export this realm from a running instance to promote it somewhere else, the
  export *will* include the full set — that's expected and fine.
- **The `sidedrawer-api-audience` protocol mapper lives directly on the client**, not on a
  shared client scope. For a single-client local realm this is simplest and behaves
  identically; if you're hand-rolling a realm with multiple clients that need the same
  audience, move it to a shared client scope instead (see the main plan's audience-mapper
  section) so you don't have to repeat it per client.
- **`included.custom.audience: "sidedrawer-api-local"`** is a placeholder. Nothing in this
  local setup validates it against a real API — set it to whatever value the backend you're
  actually testing against expects (see the migration plan's open question about backend
  `aud` validation), or leave it as-is if you're only exercising the OIDC flow itself.
- **`accessTokenLifespan: 1800`** (30 min), not Keycloak's 300s default. The widget's
  `isTokenExpired` buffer is capped at `min(5min, lifetime/4)` specifically so it doesn't
  collide with a short-lived token — but there's no reason to fight that in local testing when
  every real SideDrawer environment will also want a token that survives more than 5 minutes.
- **`offline_access` needs no explicit wiring here** — it's one of the built-in optional scopes
  Keycloak assigns automatically (see above), and the seed user gets it through the
  `default-roles-sidedrawer-dev` composite role listed on it.

## Resetting

The container has no persistent volume, so `docker compose down` (or `up -d` again) wipes all
runtime state (sessions, revoked tokens) and re-imports the realm from scratch on next start.
