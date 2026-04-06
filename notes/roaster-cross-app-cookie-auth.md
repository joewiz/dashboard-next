# Cross-App Cookie Auth: Dashboard → exist-api

Hi Juri,

I'm working on eXist-db's new Dashboard app, which needs to call exist-api endpoints after the user logs in. Both apps use roaster — Dashboard for login/logout, exist-api for its REST API. I've hit an issue with cross-app cookie authentication that I'd appreciate your input on.

## Setup

- **Dashboard** (`/exist/apps/dashboard/`) uses roaster 1.12.0 for login/logout
- **exist-api** (`/exist/apps/exist-api/`) uses roaster 1.12.0 for its API routes
- Both declare `cookieAuth` with cookie name `org.exist.login.user`
- Cookie path is `/exist` (covers both apps)

## What works

1. Dashboard's login handler calls `auth:login-user()` successfully
2. The `org.exist.login.user` cookie is set with path `/exist`, `HttpOnly`, `SameSite=Lax`
3. Dashboard's own endpoints work — the controller uses `login:set-user("org.exist.login.user", ...)` which reads the cookie and authenticates the user
4. The token in the cookie is valid: calling `plogin:login(token, callback)` directly returns `"admin"`

## What doesn't work

When the browser sends the same cookie to exist-api's endpoints (e.g., `GET /exist/apps/exist-api/api/users/whoami`), roaster's `auth:use-cookie-auth` processes the request but the user comes back as `guest`.

## Debugging details

I confirmed:
- The cookie IS sent to exist-api (verified via `curl -v`)
- `request:get-cookie-value("org.exist.login.user")` returns the token
- `plogin:login(token, callback)` validates the token and returns `"admin"`
- But `rutil:getDBUser()` (called after `plogin:login` in `auth:use-cookie-auth`) returns `guest`

This suggests the callback's `xmldb:login("/db", $user, $password, $options?jsession)` call isn't establishing the DB session in exist-api's request context, even though `plogin:login` successfully decrypts the token.

## Questions

1. Is there a known limitation with cross-app cookie auth in roaster 1.12.0? (i.e., cookie created by one app's roaster instance, validated by another app's roaster instance)

2. Could the issue be related to the JSESSIONID? Dashboard's login sets the `org.exist.login.user` cookie but I don't see a JSESSIONID being created alongside it. The `$auth:DEFAULT_LOGIN_OPTIONS` has `"jsession": true()` — is this supposed to create a JSESSIONID via `xmldb:login`?

3. Should we be doing anything differently to enable cross-app cookie sharing? For example, should exist-api's controller also call `login:set-user("org.exist.login.user", ...)` before forwarding to roaster?

## Reference

- Dashboard login handler: `~/workspace/dashboard-next/modules/login-api.xq`
- Dashboard OpenAPI spec: `~/workspace/dashboard-next/modules/login-api.json`
- exist-api OpenAPI spec: `~/workspace/exist-api/modules/api.json`
- oad-demo reference: https://github.com/line-o/oad-demo
- Roaster PR #76: https://github.com/eeditiones/roaster/pull/76

Thanks!
Joe
