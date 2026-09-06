# SideDrawer Integration for Zoho CRM (Keycloak Edition)

This widget provides a secure OAuth2 integration between Zoho CRM and SideDrawer, similar to the HeyAdvisor integration with Cloven.

**This is the Keycloak fork** of the original Auth0-based `SideDrawer` widget. It speaks
Keycloak's OIDC endpoints directly (`/realms/<realm>/protocol/openid-connect/*`) instead of
Auth0's, and needs a **realm** in addition to a client id — see the Configuration section below.
For how this repoints an existing `SidedrawerRelated` deployment, see **Cutover** near the end.

## 🚀 Features

- **OAuth2 Authorization Code Flow with PKCE**: Secure authentication using industry-standard OAuth2
- **Automatic Token Management**: Handles access token refresh automatically
- **Connection Status**: Visual indicators showing connection status
- **Modern UI**: Clean, professional interface with status indicators
- **Error Handling**: Comprehensive error handling and user feedback
- **Multi-Deployment**: Works with both local development and GitHub Pages hosting

## 📋 Prerequisites

Before using this integration, ensure you have:

1. **SideDrawer Account**: Access to SideDrawer sandbox or production environment
2. **Zoho CRM Access**: Permissions to add web tab widgets
3. **Keycloak realm + public client**: a realm, and a **public** client in it configured for
   Authorization Code + PKCE (no client secret — see Configure the Keycloak Client below)

## 🔧 Setup Instructions

### Option 1: GitHub Pages Deployment (Recommended for Production)

**This is the working solution for multi-tenant deployments.**

#### 1. Deploy to GitHub Pages

Deploy this fork to its own GitHub Pages path — e.g.
`https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html` — distinct from the original
Auth0 widget's URL, so the two can be deployed and tested side by side.

#### 2. Configure the Keycloak Client

In the target Keycloak realm's admin console (**Clients** → **Create client**):

1. **Client authentication**: OFF (this makes it a public client — no client secret, required
   for a browser-only PKCE flow)
2. **Standard flow**: ON; **Direct access grants**: OFF; **Service accounts roles**: OFF
3. **Valid redirect URIs**: `https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html*`
   — the **trailing `*` matters**: the widget appends `?client_id=...` to its own redirect URI
   whenever it falls back to a default client id, and Keycloak matches the full URI *including*
   the query string. A bare URI with no wildcard will reject that with `invalid_redirect_uri`.
4. **Web origins**: `https://sidedrawer.github.io` — origin only, no path, no trailing slash.
   Keycloak only emits CORS headers on the token/logout/revoke endpoints for origins listed
   here; get this wrong and the token exchange fails with what looks like a generic CORS error.
5. Under **Advanced** → **Proof Key for Code Exchange Code Challenge Method**: `S256` (required,
   not just allowed — otherwise a downgrade to no PKCE is silently possible).
6. **Advanced** → **Logout** → **Post logout redirect URIs**: `+` (reuse the redirect URIs above).
7. Copy the **Client ID**, note the **realm name**, and the Keycloak **base URL**
   (`https://<host>`, without `/realms/...`).

If the SideDrawer APIs this widget calls validate the access token's `aud` claim, also add an
**Audience** protocol mapper (client scope or per-client mapper) set to the value those APIs
expect — see `keycloak/README.md` in this repo for a worked local example.

#### 3. Add Widget to Zoho CRM

1. In Zoho CRM, go to **Setup** → **Customization** → **Modules and Fields**
2. Select a module or create a **Custom Tab**
3. Add a **Web Tab** widget
4. Set the URL with your credentials:

```
https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html?client_id=YOUR_CLIENT_ID&keycloak_url=https://YOUR_KEYCLOAK_HOST&realm=YOUR_REALM&redirect_uri=https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html
```

**Replace:**
- `YOUR_CLIENT_ID` → Your Keycloak public client's Client ID
- `YOUR_KEYCLOAK_HOST` → The Keycloak base URL (e.g. `auth.example.com`), no `/realms/...` suffix
- `YOUR_REALM` → The realm name

Alternatively, once you know your real environments' hosts/realms, add them as named presets to
`KC_PRESETS` in `app/widget.html` (only `local`, the bundled docker-compose realm, ships by
default) and pass e.g. `preset=production` instead of `keycloak_url`+`realm`.

#### 4. Test the Integration

1. Open the widget in Zoho CRM
2. Click **Connect to SideDrawer**
3. A popup opens for authentication
4. Log in and authorize
5. Widget shows **Connected** status ✅

### Option 2: Local Development

1. Run the development server:
   ```bash
   npm install
   npm start
   ```

2. The server will start at `https://127.0.0.1:5011` (this fork uses ports 5011-5019, so it can
   run alongside the original Auth0 widget on 5001-5009)

3. Open the URL in your browser and authorize the self-signed certificate:
   - Click "Advanced" → "Proceed to 127.0.0.1 (unsafe)"

4. Access the widget with URL parameters — or, against the bundled local Keycloak (see
   `keycloak/README.md`), simply:
   ```
   https://127.0.0.1:5011/app/widget.html?preset=local
   ```
   The bundled local Keycloak is served over **HTTPS** (`https://localhost:8443`, reusing this
   repo's existing self-signed `cert.pem`/`key.pem`), not the more common HTTP `start-dev`
   default — a plain-HTTP Keycloak would break the token exchange, because the widget itself is
   always HTTPS here and an HTTPS page cannot `fetch()` an HTTP endpoint (mixed content; the
   OAuth *redirects* would still work, since browsers exempt top-level navigation from that
   rule, but the actual token POST would silently fail). You'll need to click through the
   certificate warning for `https://localhost:8443` too, the first time. Against a real
   Keycloak realm instead:
   ```
   https://127.0.0.1:5011/app/widget.html?client_id=YOUR_CLIENT_ID&keycloak_url=https://YOUR_KEYCLOAK_HOST&realm=YOUR_REALM&redirect_uri=https://127.0.0.1:5011/app/widget.html
   ```

## 🎯 How It Works

### URL Parameter Configuration

The widget uses URL parameters to configure OAuth credentials for each Zoho CRM installation:

**Required Parameters:**
- `client_id` - Your Keycloak public client's Client ID
- `redirect_uri` - The widget URL (usually the same URL without parameters)
- Either `keycloak_url` + `realm` (an explicit realm), or `preset` (a named entry in
  `KC_PRESETS` — only `local` ships by default)

**Optional Parameters:**
- `idp_hint` - passed through as `kc_idp_hint` to skip straight to a specific identity provider
- `environment` - only used to route SideDrawer API hosts (`window.sdHosts()`); has no bearing
  on which Keycloak realm is used

**How Configuration Persists:**
1. On first load, the widget reads URL parameters
2. Credentials are stored in browser `localStorage`
3. After OAuth redirect, credentials are retrieved from `localStorage`
4. This allows the widget to work across popup windows and redirects

### OAuth2 Flow

1. **User Clicks "Connect to SideDrawer"**
   - Widget generates a PKCE code verifier and challenge
   - Opens popup window to SideDrawer authorization page
   - Passes credentials in OAuth state parameter

2. **User Authorizes in Popup**
   - User logs into SideDrawer and grants permissions
   - SideDrawer redirects back with authorization code

3. **Token Exchange (in Popup)**
   - Popup receives authorization code
   - Exchanges code for access token using PKCE
   - Sends tokens to parent window via `postMessage`

4. **Parent Window Receives Tokens**
   - Stores access token in `localStorage`
   - Stores refresh token in `localStorage`
   - Closes popup and shows connected status

5. **Automatic Refresh**
   - Widget automatically refreshes expired tokens
   - Maintains persistent connection

### Security Features

- **PKCE (Proof Key for Code Exchange)**: Protects against authorization code interception
- **Popup-based OAuth**: Bypasses iframe restrictions (X-Frame-Options)
- **Secure Token Storage**: Tokens stored in browser localStorage
- **Automatic Token Refresh**: Prevents expired token errors
- **CSP Headers**: Content Security Policy restricts allowed domains
- **State Parameter**: Prevents CSRF attacks and carries credentials securely

## 🔑 Configuration

### URL Parameter Format

**Explicit realm:**
```
https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html?client_id=YOUR_CLIENT_ID&keycloak_url=https://YOUR_KEYCLOAK_HOST&realm=YOUR_REALM&redirect_uri=https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html
```

**Named preset** (once you've added your own to `KC_PRESETS` in `app/widget.html` — see
Configure the Keycloak Client above):
```
https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html?client_id=YOUR_CLIENT_ID&preset=production&redirect_uri=https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html
```

### Keycloak OIDC Endpoints

Given a base URL and realm, every endpoint is a fixed suffix of the issuer
(`{base}/realms/{realm}`) — there is no separate per-environment endpoint table the way Auth0's
tenant-per-environment model had one, because `keycloak_url`+`realm` (or a preset) already fully
determines all of them:

- Authorization: `{issuer}/protocol/openid-connect/auth`
- Token: `{issuer}/protocol/openid-connect/token`
- Logout: `{issuer}/protocol/openid-connect/logout`
- Revoke: `{issuer}/protocol/openid-connect/revoke`

There is no `audience` request parameter — Keycloak has none. If the SideDrawer APIs this widget
calls validate the access token's `aud` claim, that comes from an audience protocol mapper
configured on the Keycloak client/realm side instead (see Configure the Keycloak Client above),
not from anything this widget sends.

## 🧪 Testing the Connection

1. Click "Connect to SideDrawer"
2. Complete the OAuth authorization
3. Once connected, click "Test Connection"
4. Verify the connection is working

## 🛠️ Troubleshooting

### "Client ID not configured" Error

**Problem**: Widget shows "Client ID not configured"

**Solution**: 
1. Ensure your widget URL includes `client_id` and either (`keycloak_url` + `realm`) or `preset`
2. Check for typos in parameter names (case-sensitive)
3. Clear browser localStorage and reload with correct URL

### "Invalid redirect URI" Error

**Problem**: Keycloak rejects the redirect URI (its own error page, not this widget's UI)

**Solution**: 
1. Keycloak matches the redirect URI **including the query string** — the widget appends
   `?client_id=...` whenever it falls back to a default client id, so a registered URI needs a
   trailing `*` to match that: e.g. `https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html*`
2. Ensure no trailing slashes or extra parameters that the registered URI doesn't also cover

### Popup Blocked

**Problem**: OAuth popup doesn't open

**Solution**: 
- Allow popups for your Zoho CRM domain
- Chrome: Click popup icon in address bar → "Always allow"
- Firefox: Click "Preferences" → "Allow popups from this site"

### Token Exchange Fails, or Looks Like a CORS Error

**Problem**: The token POST fails, and the browser console shows a CORS error even though the
request reached the server (visible in Network tab with a response body).

**Cause**: Keycloak only emits `Access-Control-Allow-Origin` on the token/logout/revoke
endpoints for origins listed in the client's **Web Origins** — everything else looks like a
generic, unhelpful CORS failure, masking the real cause.

**Solution**:
1. Verify `client_id`, `keycloak_url` and `realm` are all correct
2. Check that **Standard flow** is enabled and **PKCE Code Challenge Method** is `S256` on the
   Keycloak client
3. Add the widget's exact origin (no path, no trailing slash — e.g.
   `https://sidedrawer.github.io`) to **Web Origins** on the Keycloak client

### Widget Stuck on "Initializing..."

**Problem**: Widget doesn't load past initialization

**Solution**:
1. Check browser console (F12) for errors
2. Verify all URL parameters are present
3. Clear `localStorage` and reload: `localStorage.clear()`
4. Ensure popup blockers are disabled

### Credentials Lost After OAuth Redirect

**Problem**: Widget asks for credentials again after OAuth

**Cause**: `localStorage` is being cleared or blocked

**Solution**:
1. Ensure cookies/localStorage are enabled for the domain
2. Check browser privacy settings (not in incognito/private mode)
3. Verify no browser extensions are clearing storage

### CSP (Content Security Policy) Errors

**Problem**: Browser blocks connections to SideDrawer

**Solution**: Ensure `plugin-manifest.json`'s `cspDomains.connect-src` includes your Keycloak
host (not just the SideDrawer API hosts):
```json
{
  "cspDomains": {
    "connect-src": [
      "https://YOUR_KEYCLOAK_HOST",
      "https://user-api-sbx.sidedrawersbx.com",
      "https://tenants-gateway-api-sbx.sidedrawersbx.com"
    ]
  }
}
```
This file ships with a `CHANGE-ME` placeholder in place of a real Keycloak host — replace it
before deploying.

## 📱 Usage Example (Similar to HeyAdvisor/Cloven)

Once connected, you can:

1. **Share Documents**: Access SideDrawer documents from within Zoho CRM
2. **Client Communication**: Send secure document links to clients
3. **Track Interactions**: Monitor when clients access shared documents
4. **Automated Workflows**: Trigger actions based on document status

## 🔐 Security Considerations

### URL Parameters

**Required Parameters:**
- `client_id` — Your Keycloak public client's Client ID (public identifier, safe in URLs)
- `redirect_uri` — The widget URL
- `keycloak_url` + `realm`, or `preset` — which Keycloak realm to authenticate against

This widget uses PKCE (Proof Key for Code Exchange), which is a public-client OAuth flow that does **not** require a `client_secret`. No secret should ever be passed in a URL.

**Security Measures in Place:**
- PKCE (Proof Key for Code Exchange) protects the authorization code exchange without needing a client secret
- Tokens are short-lived and automatically refreshed
- All OAuth communication uses HTTPS
- Credentials are stored in browser localStorage (not cookies)

### Best Practices

1. **Use HTTPS**: Always use HTTPS in production (GitHub Pages provides this)
2. **Unique Credentials**: Use different OAuth apps for each customer/organization
3. **Token Storage**: Tokens stored in localStorage are encrypted by the browser
4. **Scope Limitation**: Only request necessary OAuth scopes
5. **Audit Access**: Regularly review which organizations have access to your SideDrawer data

## 📚 Additional Resources

- [SideDrawer API Documentation](https://sidedrawer.com/developers)
- [OAuth2 Authorization Code Flow](https://oauth.net/2/grant-types/authorization-code/)
- [PKCE Specification](https://oauth.net/2/pkce/)
- [Zoho CRM Extensions](https://www.zoho.com/creator/help/extensions/)

## 🤝 Support

For issues or questions:
1. Check browser console for error messages
2. Verify OAuth credentials are correct
3. Ensure redirect URI matches exactly
4. Test in different browsers

## 📝 Key Conclusions

### The Working Solution

After extensive testing and iteration, here's what works:

**✅ GitHub Pages Deployment with URL Parameters**

```
https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html?client_id=YOUR_CLIENT_ID&keycloak_url=https://YOUR_KEYCLOAK_HOST&realm=YOUR_REALM&redirect_uri=https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html
```

### What We Learned

1. **URL Parameters Are the CORRECT Approach**
   - For externally-hosted widgets (GitHub Pages, custom servers), URL parameters are the **only** way to pass configuration to Zoho CRM
   - This is the industry standard used by other Zoho integrations (HeyAdvisor, Cloven, etc.)
   - The `variables` in `plugin-manifest.json` do NOT work for external hosting

2. **Popup-Based OAuth Flow**
   - Direct redirects don't work due to iframe restrictions (X-Frame-Options)
   - Popup window handles the OAuth flow independently
   - Tokens are passed back to parent via `postMessage` API

3. **Credential Persistence via localStorage**
   - URL parameters are read on first load and stored in `localStorage`
   - After OAuth redirect, credentials are retrieved from `localStorage`
   - This allows the widget to work across popup windows and redirects

4. **State Parameter Strategy**
   - OAuth `state` parameter carries the PKCE code_verifier
   - State also carries `clientId` and `redirectUri` for popup context
   - This ensures popup can complete token exchange independently

5. **Security**
   - PKCE (Proof Key for Code Exchange) is used — no `client_secret` required or sent
   - Same approach as other production Zoho integrations
   - Not publicly exposed

### Deployment Options

| Option | Use Case | Pros | Cons |
|--------|----------|------|------|
| **GitHub Pages** | Production, multi-tenant | No server needed, always available, free hosting | Credentials in URL |
| **Local Dev** | Development, testing | Full control, easy debugging | Requires running server, certificate warnings |
| **Zoho Hosting** | Enterprise deployments | Zoho manages hosting, `variables` work | More complex packaging, harder to debug |

### What Doesn't Work

❌ **Zoho `variables` for External Hosting** - Variables in `plugin-manifest.json` only work for Zoho-hosted widgets, not external URLs

❌ **Direct OAuth Redirects** - Blocked by X-Frame-Options when widget is in an iframe

❌ **sessionStorage for Credentials** - Lost across popup windows; must use `localStorage`

❌ **Parent Window Token Exchange** - Only popup should exchange authorization code to avoid duplicates

## 🔀 Cutover — repointing an existing `SidedrawerRelated` tenant

`SidedrawerRelated` gets its session from this widget via a hidden bridge iframe
(`app/js/core/session.js`'s `createSessionBridge`), not by talking to Auth0/Keycloak directly.
That means a single Zoho tenant can be switched to this Keycloak widget through **Zoho
configuration alone** — no code change to `SidedrawerRelated` — using the `bridge_url`
config variable it now supports:

1. Deploy this fork (e.g. to its own GitHub Pages path) and confirm it works standalone first —
   run through Test the Integration above against the real target realm.
2. In the `SidedrawerRelated` widget's Zoho configuration for the tenant you're migrating, set
   **Session Bridge URL** (`bridge_url`) to this fork's deployed URL, and set this fork's own
   `client_id`/`keycloak_url`/`realm` (or `preset`) via its own Zoho web-tab configuration exactly
   as described above.
3. Reload the `SidedrawerRelated` panel for that tenant and confirm the session bridge round-trips
   (`REQUEST_SIDEDRAWER_SESSION` / `REFRESH_SIDEDRAWER_TOKEN` in the browser console).
4. **Rollback**: clear `bridge_url` back to empty. `SidedrawerRelated` falls back to its original
   default bridge (the Auth0 widget) immediately, with no other change needed.

Every other tenant is unaffected the whole time — `bridge_url` defaults to empty, which preserves
the exact current behavior.

## 📝 License

Copyright (c) 2025. All rights reserved.

