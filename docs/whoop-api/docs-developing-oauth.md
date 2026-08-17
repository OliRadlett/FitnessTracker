# OAuth 2.0

> Source: https://developer.whoop.com/docs/developing/oauth

---

# OAuth 2.0

All endpoints for retrieving a WHOOP user's data require successful authorization via
the [OAuth 2.0](https://oauth.net/2/) protocol.
[IETF RFC-6749](https://tools.ietf.org/html/rfc6749) documents the full standard. While we will not explain OAuth 2.0
generally in this section, we will demonstrate how to use it to authorize an app's access to a WHOOP user's data after
the user grants consent.

Any subsequent references to *OAuth* in this documentation will be
referring to *OAuth 2.0*.

We recommend you use a library to manage the details of the OAuth flow. You can find recommended libraries in a variety
of programming languages
[here](https://oauth.net/code/).

## Pre-requisite[â](#pre-requisite "Direct link to Pre-requisite")

Before starting, you must create an App in the WHOOP Developer Dashboard. You can follow
the [getting started](/docs/developing/getting-started) to learn how if you have not already.

## Required Information for OAuth[â](#required-information-for-oauth "Direct link to Required Information for OAuth")

### Client ID[â](#client-id "Direct link to Client ID")

The `Client ID` can be found after creating a client in the WHOOP Developer Dashboard.

### Client Secret[â](#client-secret "Direct link to Client Secret")

You can find the `Client Secret` after creating a Client in the WHOOP Developer Dashboard.

### Authorization URL[â](#authorization-url "Direct link to Authorization URL")

This WHOOP URL prompts a user to authorize your app to access the WHOOP user's data. After
the user grants authorization, WHOOP will respond with an authorization code.

```text
https://api.prod.whoop.com/oauth/oauth2/auth
```

### Token URL[â](#token-url "Direct link to Token URL")

This WHOOP URL provides your app with the authorization code from
the [authorization URL](#authorization-url) after the WHOOP user authorizes your app to access their WHOOP data. This
endpoint provides an access token in exchange for the authorization code.

```text
https://api.prod.whoop.com/oauth/oauth2/token
```

### Redirect URL[â](#redirect-url "Direct link to Redirect URL")

WHOOP will redirect the user to the [Redirect URL](https://www.oauth.com/oauth2-servers/redirect-uris/) after they
authorize your App to access the request scopes. You must register the Redirect URL in the WHOOP Developer Dashboard.

A valid URL will take the form of `https://whoop.com/example/redirect` or `whoop://example/redirect`.

**Note:** Your OAuth library may reference `Redirect URL` as a `Callback URL`.

### State[â](#state "Direct link to State")

The [state parameter](https://auth0.com/docs/protocols/state-parameters) is a security measure to prevent
against [CSRF attacks](https://owasp.org/www-community/attacks/csrf). It's a generated random string
that you provide to WHOOP's server. Upon successful authorization by the user, WHOOP will respond with this same state
value.

Your OAuth 2.0 library may handle this functionality for you; however, you may be responsible for explicitly using it by
setting the option to true.

The state parameter must be eight characters long if you need to generate it yourself.

### Scope[â](#scope "Direct link to Scope")

The [scope parameter](https://oauth.net/2/scope/) is how your application declares which data and what level of access
is being requested.

When the OAuth flow prompts a WHOOP user to authorize access to your app, the user will see the list of scopes your
app requested. The user must authorize access to them before WHOOP grants your app a token.

You can learn more about what scopes are available in [the API Docs](/api#section/Authentication).

## Request An Access Token[â](#request-an-access-token "Direct link to Request An Access Token")

We highly recommend using a library to manage the flow. There are available libraries in
many [programming languages](https://oauth.net/code/).

The steps that the library will follow are:

1. Your application will send a request to the Authorization URL for an
   [authorization code](https://www.oauth.com/oauth2-servers/access-tokens/authorization-code-request/).
2. WHOOP prompts the user to log in with their WHOOP credentials.
3. The user will confirm they authorize access to your app.
4. WHOOP will respond to the Redirect URL with an authorization code.
5. Your application will send a request to the Token URL, exchanging the
   authorization code for an access token (and optionally a refresh token if your app requested the `offline` scope).

### Access Token Request Examples[â](#access-token-request-examples "Direct link to Access Token Request Examples")

* [Javascript and Passport](/docs/tutorials/access-token-passport)

## Using An Access Token[â](#using-an-access-token "Direct link to Using An Access Token")

After receiving an access token, all requests must include the access token. Your app should pass the access token as
a `Bearer` token in the `Authorization` header.

WHOOP will return the requested data if the access token is successfully verified. However, if the token is invalid,
WHOOP returns a `401 - Unauthorized` response.

## Access Token Expiration[â](#access-token-expiration "Direct link to Access Token Expiration")

Access tokens are only valid for a short time. WHOOP provides the token expiry in the `expires_in` parameter (in
seconds). After the token expires, your app must
[refresh the token](#refreshing-an-access-token).

### Refreshing an Access Token[â](#refreshing-an-access-token "Direct link to Refreshing an Access Token")

Access tokens are short-lived, depending on
the `expires_in` value. WHOOP will respond with a (401 -
Unauthorized) [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401) if your app sends a
request with an expired access token.

When the access token is expired, you can no longer use it and must refresh the token. If you do not want to wait
for the token to expire before refreshing, you can refresh the complete set of access tokens regularly. One
strategy is to execute refreshing access tokens using a background cron job.

Existing access tokens are invalidated once your app uses the refresh token to generate a new access token. The access
token from the refresh response is now the valid access token, and your app can use the new access token for future
requests.
Similarly, the refresh token from the refresh response is now the valid refresh token, and your app must use the new
refresh token on the subsequent refresh request.

Another advantage to refreshing tokens in a recurring job is that it limits the likelihood of issues occurring with
multiple
concurrent requests attempting to refresh an expired token. When your app makes simultaneous refresh token requests, the
first refresh request that reaches WHOOP will succeed. The second request would fail because the first request
invalidates the refresh
token.

### Receiving a Refresh Token[â](#receiving-a-refresh-token "Direct link to Receiving a Refresh Token")

WHOOP provides your app with a refresh token after completing the OAuth 2.0 flow *if* the `offline` scope is
included in the authorization request. You *must* request the `offline` scope to receive a refresh token.

### Required Information To Refresh[â](#required-information-to-refresh "Direct link to Required Information To Refresh")

#### Refresh Token Endpoint[â](#refresh-token-endpoint "Direct link to Refresh Token Endpoint")

The WHOOP URL where your app sends a POST request including the refresh token in exchange for a new access token.

```text
https://api.prod.whoop.com/oauth/oauth2/token
```

#### Refresh Token[â](#refresh-token "Direct link to Refresh Token")

If your app requests the `offline` scope during the OAuth authorization flow, WHOOP returns a refresh token that your
app uses to refresh expired access tokens.

#### Client ID[â](#client-id-1 "Direct link to Client ID")

The Client ID is a unique identifier for your Client app. Your app uses this ID to authenticate with WHOOP.
You can create and manage this ID in the WHOOP Developer Dashboard.

#### Client Secret[â](#client-secret-1 "Direct link to Client Secret")

The Client Secret is a secret value that accompanies a Client ID. You can view the Client Secret in
the WHOOP Developer Dashboard.

### Sample POST Request Payload[â](#sample-post-request-payload "Direct link to Sample POST Request Payload")

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "{{RefreshToken}}",
  "client_id": "{{ClientID}}",
  "client_secret": "{{ClientSecret}}",
  "scope": "offline"
}
```

The payload above uses [Postman variables](https://learning.postman.com/docs/sending-requests/variables/), rather than
actual data. The variables represent:

* RefreshToken - the value of the refresh token you receive along with
  an access token.
* ClientID - the client identifier created in the WHOOP Developer Dashboard.
* ClientSecret - the secret that accompanies the Client ID in the WHOOP Developer Dashboard.

### Sample POST Response Payload[â](#sample-post-response-payload "Direct link to Sample POST Response Payload")

```json
{
  "access_token": "the-value-of-the-new-access-token",
  "expires_in": 3600,
  "refresh_token": "the-value-of-the-new-refresh-token",
  "scope": "offline other-scopes-requested",
  "token_type": "bearer"
}
```

### Token Refresh Examples[â](#token-refresh-examples "Direct link to Token Refresh Examples")

* [Postman](/docs/tutorials/refresh-token-postman)
* [Javascript](/docs/tutorials/refresh-token-javascript)

## Revoking an Access Token[â](#revoking-an-access-token "Direct link to Revoking an Access Token")

When a user disables your integration, you should revoke their access token from your application to respect their privacy. If you have adopted [webhooks](/docs/developing/webhooks), revoking an access token will ensure that you no longer receive webhooks for this user.

To revoke an access token, you can use the [revokeUserOauthAccess](https://developer.whoop.com/api/#tag/User/operation/revokeUserOAuthAccess) API endpoint.