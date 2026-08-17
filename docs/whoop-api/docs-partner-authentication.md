# Authentication

> Source: https://developer.whoop.com/docs/partner/authentication

---

# Authentication

The Partner API uses a **Trusted Partner** OAuth 2.0 client credentials flow. This is a server-to-server flowâno user login or redirect is involved.

## How It Differs from Standard User OAuth[â](#how-it-differs-from-standard-user-oauth "Direct link to How It Differs from Standard User OAuth")

Standard WHOOP OAuth requires a user to log in and grant consent. Partner authentication does not involve end users. Instead, your server authenticates directly with WHOOP using your partner client credentials.

See [OAuth 2.0](/docs/developing/oauth) for the standard user flow by comparison.

## Token Endpoint[â](#token-endpoint "Direct link to Token Endpoint")

```text
POST https://api.prod.whoop.com/developer/v2/partner/token
```

## Requesting a Token[â](#requesting-a-token "Direct link to Requesting a Token")

Send a POST request with your partner `client_id`, `scope`, and `client_secret` using the `client_credentials` grant type.

```javascript
const getPartnerToken = async (clientId, clientSecret) => {
    const response = await fetch(
        'https://api.prod.whoop.com/developer/v2/partner/token',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'whoop-partner/token'
            }),
        }
    )

    if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`)
    }

    return response.json()
}
```

### Response[â](#response "Direct link to Response")

```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

## Using the Token[â](#using-the-token "Direct link to Using the Token")

Include the access token as a `Bearer` token in the `Authorization` header of every Partner API request:

```text
Authorization: Bearer <access_token>
```

## Token Expiration[â](#token-expiration "Direct link to Token Expiration")

Access tokens are only valid for a short time. WHOOP provides the token expiry in the `expires_in` parameter (in seconds). WHOOP will return a `401 Unauthorized` response if your server makes a request with an expired or invalid token. When this happens, request a new token and retry the request.

## Webhook Signing Secret[â](#webhook-signing-secret "Direct link to Webhook Signing Secret")

In addition to your client credentials, WHOOP provides a **signing secret** used to verify that incoming webhooks are genuinely sent by WHOOP. You should store this secret securely on your server and use it to validate the `WHOOP-Signed` header on every webhook request.

See [Handle Partner Webhooks](/docs/partner/tutorials/handle-webhooks) for how to use it.