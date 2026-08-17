# Refreshing Access Tokens

> Source: https://developer.whoop.com/docs/tutorials/refresh-token-javascript

---

# Refreshing Access Tokens

This example will use the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
to make an HTTP request to WHOOP's server.

## Prerequisites[â](#prerequisites "Direct link to Prerequisites")

* Refresh Token: A refresh token is received along with an access token when
  completing the initial [OAuth 2.0 flow](/docs/developing/oauth#request-an-access-token), when the auth request
  includes the
  `offline` [scope](/docs/developing/oauth#scope). [Learn
  more](/docs/developing/oauth#refresh-the-token)
* Client Id: A unique identifier for your client. [Learn more](/docs/developing/oauth#client-id)
* Client Secret: A secret value that accompanies your client
  identifier. [Learn more](/docs/developing/oauth#client-secret)
* Refresh Token Endpoint: `https://api.prod.whoop.com/oauth/oauth2/token`
  . [Learn more](/docs/developing/oauth#refresh-token-endpoint)

## Making the Request[â](#making-the-request "Direct link to Making the Request")

We first need to assemble the parameters to provide to WHOOP's server in order
to retrieve new access and refresh tokens.

```javascript
const refreshParams = {
    grant_type: 'refresh_token',
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope: 'offline',
    refresh_token: refresh_token,
}
```

These fields represent:

* **grant\_type**: `refresh_token`. This [grant type](https://oauth.net/2/grant-types/refresh-token/)
  explicitly tells an OAuth provider you're asking for a refresh token.
* **client\_id**: A unique identifier for your client.
* **client\_secret**: A secret value that accompanies your client identifier.
* **scope**: The `offline` scope allows your app the receive a refresh token, along with
  the new access token.
* **refresh\_token**: The value of the refresh token received along with an
  access token.

Now that we have the parameters to send to the API endpoint, we can construct
the entire API call:

```javascript
const getFreshTokens = async (refreshParams) => {
    const body = new URLSearchParams(refreshParams)
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
    }

    const refreshTokenResponse = await fetch(
        `https://api.prod.whoop.com/oauth/oauth2/token`,
        {
            body,
            headers,
            method: 'POST',
        },
    )

    return refreshTokenResponse.json()
}
```

## Response Type[â](#response-type "Direct link to Response Type")

The response object received from making the API request will look as follows:

```typescript
interface AuthResult {
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
    token_type: 'bearer'
}
```

## Congratulations[â](#congratulations "Direct link to Congratulations")

Your app can now use the new access token for subsequent
API requests for this user's data. Your app can also use the refresh token to complete this flow once the access token
expires.