# InspectVoice — Security Headers Configuration

## Overview

These headers must be set at the hosting/edge layer (Railway or Cloudflare).
They are **not** set by the React app — they come from the server response.

---

## Required Headers

### Content Security Policy (CSP)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com;
  connect-src 'self' https://api.inspectvoice.com https://api.mapbox.com https://*.clerk.accounts.dev https://*.sentry.io https://api.deepgram.com;
  media-src 'self' blob:;
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
```

**Notes:**
- `media-src blob:` — required for voice recording playback
- `worker-src blob:` — required for service worker and Web Speech API
- `img-src data: blob:` — required for offline-cached photos and camera capture
- `connect-src` — lock down to only the APIs we use
- `frame-ancestors 'none'` — prevents clickjacking (equivalent to X-Frame-Options: DENY)
- `unsafe-inline` on style-src only — required by Tailwind CSS runtime. No inline scripts.

### Other Security Headers

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(self), geolocation=(self), payment=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

**Notes:**
- `Permissions-Policy` — explicitly allows camera (photos), microphone (voice), geolocation (site GPS) for our origin only. Blocks payment API.
- `X-XSS-Protection: 0` — disabled because CSP is the proper XSS mitigation. The legacy XSS filter can introduce vulnerabilities.
- `HSTS preload` — requires HTTPS everywhere. Submit to hstspreload.org after deployment.

---

## Railway Implementation

### Option A: Caddy (if using Caddyfile on Railway)

```caddy
:8080 {
    root * /srv
    file_server

    # SPA routing
    try_files {path} /index.html

    header {
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com; connect-src 'self' https://api.inspectvoice.com https://api.mapbox.com https://*.clerk.accounts.dev https://*.sentry.io https://api.deepgram.com; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        X-XSS-Protection "0"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(self), microphone=(self), geolocation=(self), payment=()"
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Resource-Policy "same-origin"

        # Remove server identification
        -Server
    }

    # Cache static assets aggressively
    @static {
        path *.js *.css *.png *.jpg *.jpeg *.svg *.woff2 *.ico
    }
    header @static Cache-Control "public, max-age=31536000, immutable"

    # No cache for HTML (SPA entry point)
    @html {
        path *.html /
    }
    header @html Cache-Control "no-cache, no-store, must-revalidate"
}
```

### Option B: Cloudflare Workers (if fronting Railway with CF)

Set headers in the Worker before returning the response. This is the preferred approach if using Cloudflare for CDN.

---

## Verification

After deployment, test with:

1. **securityheaders.com** — should score A+
2. **Mozilla Observatory** — should score A+
3. **Browser DevTools → Network tab** — verify all headers present on document response
4. **CSP violations** — check browser console for any `Content-Security-Policy` violation reports during normal app usage

---

## Maintenance

When adding new third-party services:
1. Add their domain to the appropriate CSP directive
2. Test in browser console for CSP violations
3. Update this document
