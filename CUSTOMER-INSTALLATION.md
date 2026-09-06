# SideDrawer Integration - Customer Installation Guide

## Prerequisites

- Zoho CRM account with admin access
- A Keycloak realm this integration should authenticate against
- Access to create clients in that Keycloak realm's admin console

## Installation Steps

### 1. Create a Keycloak Client

1. Log into the Keycloak admin console for the target realm

2. Navigate to **Clients** → **Create client**

3. Fill in the form:
   - **Client ID**: `zoho-crm-[your-company-name]` (or your own naming convention)
   - **Client authentication**: OFF — this must be a **public** client; the widget has no
     client secret and cannot use one (PKCE, browser-only flow)
   - **Standard flow**: ✓ Enabled
   - **Direct access grants** / **Service accounts roles**: OFF

4. On the **Login settings** step:
   - **Valid redirect URIs**: `https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html*`
     — the trailing `*` is required (the widget appends `?client_id=...` to its own redirect
     URI, and Keycloak matches the full URI including the query string)
   - **Web origins**: `https://sidedrawer.github.io` (origin only — no path, no trailing slash)

5. Under **Advanced** → **Advanced settings**:
   - **Proof Key for Code Exchange Code Challenge Method**: `S256` (required, not just allowed)
   - **Post logout redirect URIs**: `+` (reuses the redirect URIs above)

6. Click **Save**

7. **Copy and save**:
   - **Client ID** (example: `YOUR_CLIENT_ID`)
   - The realm name and the Keycloak base URL (`https://<host>`, no `/realms/...` suffix)

### 2. Add Widget to Zoho CRM

1. In Zoho CRM, go to **Setup** → **Customization** → **Modules and Fields**

2. Select the module where you want the widget (or create a custom tab)

3. Click **Web Tab** to add a new web tab widget

4. Configure the web tab:
   - **Name**: `SideDrawer`
   - **URL**: Build your URL using this template:

```
https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html?client_id=YOUR_CLIENT_ID&keycloak_url=https://YOUR_KEYCLOAK_HOST&realm=YOUR_REALM&redirect_uri=https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html
```

Replace `YOUR_CLIENT_ID`, `YOUR_KEYCLOAK_HOST` and `YOUR_REALM` with the values from step 1.

5. Click **Save**

### 3. Test the Integration

1. Open the SideDrawer widget tab in Zoho CRM

2. You should see the widget interface with a **"Connect to SideDrawer"** button

3. Click **Connect to SideDrawer**

4. A popup window opens with the SideDrawer login page

5. Log in with your SideDrawer credentials

6. Click **Authorize** to grant permissions

7. The popup closes automatically

8. The widget now shows **"Connected to SideDrawer"** ✅

### 4. Verify Connection

After connecting, the widget should display:
- ✅ **Connected to SideDrawer**
- Your tenant information (Tenant ID, Brand Code, Region)
- Token expiry time
- **Test Connection** button

Click **Test Connection** to verify the integration is working properly.

## Understanding the URL Parameters

The widget URL includes these configuration parameters:

| Parameter | Description | Required |
|-----------|-------------|----------|
| `client_id` | Your SideDrawer OAuth Client ID | ✓ Yes |
| `redirect_uri` | Where OAuth redirects after login | ✓ Yes |
| `environment` | `sandbox` or `production` | ✓ Yes |

**Why URL parameters?**

For externally-hosted widgets (like this one on GitHub Pages), URL parameters are the **only** way to configure credentials in Zoho CRM. This is the standard approach used by other Zoho integrations (HeyAdvisor, Cloven, etc.).

## Troubleshooting

### "Client ID not configured" Error

**Cause**: URL parameters are missing or incorrect

**Solution**:
1. Verify your widget URL includes all required parameters: `client_id`, `redirect_uri`, `environment`
2. Check for typos (parameter names are case-sensitive)
3. Ensure there are no line breaks in the URL
4. Try copying the example URL and replacing just the credentials

### "Popup blocked" Error

**Cause**: Browser is blocking the OAuth popup

**Solution**: Allow popups for your Zoho CRM domain
- **Chrome**: Click the popup icon in the address bar → "Always allow popups from crm.zohocloud.ca"
- **Firefox**: Click "Preferences" → "Allow popups from this site"
- **Safari**: Safari → Preferences → Websites → Pop-up Windows → Allow for Zoho CRM

### "Invalid Redirect URI" Error (Keycloak's own error page)

**Cause**: The redirect URI registered on the Keycloak client doesn't match the widget URL

**Solution**:
1. The registered redirect URI must end in a trailing `*`:
   `https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html*` — Keycloak matches the
   full URI *including* the query string, and the widget appends `?client_id=...` whenever it
   falls back to a default client id
2. Case-sensitive match on everything before the `*`

### Token Exchange Fails, or Looks Like a CORS Error

**Cause**: Wrong Client ID/realm, or the widget's origin is missing from the Keycloak client's
**Web Origins** — Keycloak only emits CORS headers on the token endpoint for origins listed
there, so this failure mode looks like a generic CORS error rather than naming the real cause

**Solution**:
1. Verify you copied `client_id`, `keycloak_url` and `realm` correctly (copy-paste to avoid
   typos)
2. Ensure no extra spaces or line breaks in the URL
3. Verify **Proof Key for Code Exchange Code Challenge Method** is `S256` on the Keycloak client
4. Add `https://sidedrawer.github.io` (origin only) to **Web Origins** on the Keycloak client

### Widget Stuck on "Initializing..."

**Cause**: Configuration not loaded properly

**Solution**:
1. Open browser console (F12) and check for errors
2. Verify the widget URL is correct and complete
3. Clear browser storage:
   - Open browser console (F12)
   - Type: `localStorage.clear()`
   - Reload the page
4. Verify all URL parameters are present

### Credentials Lost After Reconnecting

**Cause**: Browser localStorage is being cleared

**Solution**:
1. Don't use Incognito/Private browsing mode
2. Check browser privacy settings allow localStorage
3. Disable browser extensions that clear storage
4. Verify cookies are enabled for the domain

## Support

For technical support, contact:
- **Email**: support@yourcompany.com
- **Phone**: +1-XXX-XXX-XXXX

## Security Notes

### URL Parameters and Security

This widget uses PKCE (Proof Key for Code Exchange), which is a public-client OAuth 2.0 flow. It does **not** require or use a `client_secret`. Only `client_id` is needed in the URL — this is a public identifier and is safe to include in URLs.

**Security measures in place:**
1. **PKCE**: Protects the authorization code exchange without a client secret
2. **HTTPS**: All communication is encrypted
3. **Short-lived Tokens**: Access tokens expire automatically and are silently refreshed

### What Gets Stored Where

- **URL Parameters**: Client ID is read once and stored in browser localStorage
- **Access Tokens**: Stored in browser localStorage (automatically encrypted by browser)
- **Refresh Tokens**: Stored in browser localStorage for silent re-authentication
- **OAuth Communication**: All requests use HTTPS with PKCE

### Best Practices

1. **Unique Credentials**: Use different OAuth applications for each customer/organization
2. **Environment Separation**: Never use production credentials in sandbox, or vice versa
3. **Regular Audits**: Periodically review which organizations have access to your SideDrawer data
4. **Revoke Access**: If an employee leaves, you can revoke their SideDrawer access without affecting the integration

## Multi-Organization Deployment

### Can I use the same OAuth app for multiple Zoho organizations?

**Yes!** Unlike some integrations, this widget uses the same redirect URI for all installations:
- `https://sidedrawer.github.io/SideDrawer-keycloak/app/widget.html`

This means:
- ✅ **You can use the same Keycloak client** for multiple Zoho CRM organizations
- ✅ **Simpler management** - one client, multiple deployments
- ✅ **Each organization still isolated** - tokens are stored per-browser, per-user

### Recommended Deployment Strategies

**Option 1: Single OAuth App (Simpler)**
- Create one OAuth app in SideDrawer
- Use the same `client_id` for all Zoho organizations
- Easier to manage, single point of configuration

**Option 2: Per-Customer OAuth Apps (More Secure)**
- Create separate OAuth app for each customer/organization
- Different credentials for each deployment
- Better isolation, easier to revoke access for specific customers
- Recommended for white-label or multi-tenant SaaS

