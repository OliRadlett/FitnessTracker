# Refreshing Access Tokens

> Source: https://developer.whoop.com/docs/tutorials/refresh-token-postman

---

# Refreshing Access Tokens

[Postman](https://www.postman.com/) is an application you can use to make, save, and share API requests. We're
going to use it to demonstrate using a refresh token to receive a new access token from WHOOP.

## Prerequisites[â](#prerequisites "Direct link to Prerequisites")

* Refresh Token: A refresh token is received along with an access token when
  completing the initial [OAuth 2.0 flow](/docs/developing/oauth#request-an-access-token), when the auth request includes
  the
  `offline` [scope](/docs/developing/oauth#scope). [Learn
  more](/docs/developing/oauth#refresh-the-token)
* Client Id: A unique identifier for your client. [Learn more](/docs/developing/oauth#client-id)
* Client Secret: A secret value that accompanies your client
  identifier. [Learn more](/docs/developing/oauth#client-secret)
* Refresh Token Endpoint: `https://api.prod.whoop.com/oauth/oauth2/token`
  . [Learn more](/docs/developing/oauth#refresh-token-endpoint)

## Making the Request[â](#making-the-request "Direct link to Making the Request")

We're going to issue a POST request to the refresh token endpoint to receive a
new access token.

Fill in the fields as follows:

* **HTTP Request Type/Verb**: POST
* **URL**: `https://api.prod.whoop.com/oauth/oauth2/token`

In the Body section, select the "x-www-form-urlencoded" radio button. Fill in
the following keys and values:

* **grant\_type**: `refresh_token`. This [grant type](https://oauth.net/2/grant-types/refresh-token/)
  explicitly tells an OAuth provider you're asking for a refresh token.
* **refresh\_token**: The value of the refresh token received along with an
  access token.
* **client\_id**: A unique identifier for your client.
* **client\_secret**: A secret value that accompanies your client identifier.
* **scope**: The `offline` scope allows you to get a new refresh token and an access token.

In this image, Postman [variables](https://learning.postman.com/docs/sending-requests/variables/) take the place of the
refresh
token, client id, and client secret. Postman should prepopulate those variables with
the configured values. Alternatively, place the values directly in the
value of the POST data rather than using variables at all.

Click "Send" to make your request.

## Receiving the Response[â](#receiving-the-response "Direct link to Receiving the Response")

Under the Request Body section, a Response Body should be visible as a JSON
payload. It will have the following form:

```json
{
  "access_token": "the-value-of-the-new-access-token",
  "expires_in": 3600,
  "refresh_token": "the-value-of-the-new-refresh-token",
  "scope": "offline other-scopes-requested",
  "token_type": "bearer"
}
```

## Congratulations[â](#congratulations "Direct link to Congratulations")

You can use the new access token to make additional
API requests for this user's data. You can also use the new refresh token to
complete this flow once the access token expires.