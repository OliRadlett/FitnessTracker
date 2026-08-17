# Authenticating with WHOOP (with Passport)

> Source: https://developer.whoop.com/docs/tutorials/access-token-passport

---

# Authenticating with WHOOP (with Passport)

Though Javascript is a primary language for client-side application development, all requests to WHOOP must be made
server-side. This tutorial does not propose or require a given framework for building Javascript
server-side applications. Some examples of Javascript server-side frameworks are [express.js](https://expressjs.com/)
and [next.js](https://nextjs.org/).

You can choose from one of the many OAuth 2.0 libraries. In this tutorial, we will
use [Passport](http://www.passportjs.org/)
for authentication. Specifically, this will use
the [passport-oauth2](http://www.passportjs.org/packages/passport-oauth2/) package.

## Install Dependencies[â](#install-dependencies "Direct link to Install Dependencies")

```bash
npm install passport passport-oauth2
```

Additionally, if you're using Typescript, you'll want to include the type
definitions as well:

```bash
npm install @types/passport @types/passport-oauth2
```

## Configure The Strategy[â](#configure-the-strategy "Direct link to Configure The Strategy")

We first need to define the data `Passport` will need to complete the OAuth 2.0
authorization flow, stored in a configuration.

```javascript
const whoopOAuthConfig = {
    authorizationURL: `${process.env.WHOOP_API_HOSTNAME}/oauth/oauth2/auth`,
    tokenURL: `${process.env.WHOOP_API_HOSTNAME}/oauth/oauth2/token`,
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    state: true,
    scope: [
        'offline',
        'read:profile'
    ],
}
```

The data elements are:

* `authorizationURL`: The WHOOP URL prompts a user to sign in to WHOOP and
  authorize your application. [Learn more](/docs/developing/oauth#authorization-url)
* `tokenURL`: The WHOOP URL to exchange an authorization code for an access
  token. [Learn more](/docs/developing/oauth#token-url)
* `clientID`: A unique identifier for your client. [Learn more](/docs/developing/oauth#client-id)
* `clientSecret`: A secret value that accompanies your client
  identifier. [Learn more](/docs/developing/oauth#client-secret)
* `callbackURL`: WHOOP will redirect the user to this location after the user authorizes your
  application. [Learn more](/docs/developing/oauth#redirect-url)
* `state`: Set this to `true` to have the strategy define the state value
  that WHOOP will pass back to your app. [Learn more](/docs/developing/oauth#state)
* `scope`: A list of the data types and operations your app can access. We are requesting the `offline` scope to
  retrieve a refresh token and `read:profile` to access User
  Profile information from the WHOOP API in this example. You need to add the relevant scopes your app needs
  access. [Learn more](/docs/developing/oauth#scope)

## Determine What To Do After Authentication Succeeds[â](#determine-what-to-do-after-authentication-succeeds "Direct link to Determine What To Do After Authentication Succeeds")

`Passport` needs a function to execute once the OAuth flow is complete. What occurs in that function is specific to your
application.

In this example, we will use the received information from the OAuth flow to save the user to our database
using [Prisma](https://www.prisma.io/). But, of course, what your application does with this may differ.

```javascript
const getUser = async (
    accessToken,
    refreshToken,
    {expires_in},
    profile,
    done,
) => {
    const {first_name, last_name, user_id} = profile

    const createUserParams = {
        accessToken,
        expiresAt: Date.now() + expires_in * 1000,
        firstName: first_name,
        lastName: last_name,
        refreshToken,
        userId: user_id,
    }

    const user = await prisma.user.upsert({
        where: {userId: user_id},
        create: createUserParams,
        update: createUserParams,
    })

    done(null, user)
}
```

Passport will pass in several parameters that we can use in our application-specific logic:

* `accessToken`: the access token to retrieve user information from the WHOOP
  API. For future requests, your app must pass the Access Token as a Bearer token in the Authorization header. We will
  use this as an example below to retrieve [profile
  data](#get-user-profile-information).
* `refreshToken`: Your app can use the Refresh Token to retrieve a new access token after expiration. [Learn
  more](/docs/developing/oauth#refresh-the-token)
* `results`: this is an object that contains fields for `access_token`,
   `expires_in`, `scope`, and `token_type`.
* `profile`: the normalized representation of a user's profile data. The Passport library will populate the `profile`
  because we later tell Passport how to [get user profile
  information](#get-user-profile-information).
* `done`: a callback function accepting errors and the user as the parameters.

Given all that information, we are extracting the user's first name, last name,
and WHOOP user id from their profile and storing that in our database, along
with their active tokens.

Note that Passport's documentation shows a function that takes [four
parameters](https://github.com/jaredhanson/passport-oauth2#configure-strategy).
Using this won't have the information about when the token expires, so we're
instead, we're relying on
a [less-common variant](https://github.com/jaredhanson/passport-google-oauth/issues/23#issuecomment-27128329)
for this data.

## Get User Profile Information[â](#get-user-profile-information "Direct link to Get User Profile Information")

WHOOP includes an API endpoint to access user profile details, which your app
will have access to if the app requests (and the user authorizes) the
`read:profile` scope.

```javascript
const fetchProfile = async (
    accessToken,
    done,
) => {
    const profileResponse = await fetch(
        `${process.env.WHOOP_API_HOSTNAME}/developer/v1/user/profile/basic`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    )

    const profile = await profileResponse.json()

    done(null, profile)
}
```

This [async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
uses Javascript's [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
to make a request to the WHOOP profile endpoint, passing in the access token we
receive from a successful OAuth 2.0 flow as a bearer token in the Authorization header.

The function returns the user's profile information. Passport [normalizes](http://www.passportjs.org/docs/profile/)
received profile information.

## Use The WHOOP Strategy[â](#use-the-whoop-strategy "Direct link to Use The WHOOP Strategy")

Now that we have all of the individual pieces built, it's time to put them
together.

```javascript
const whoopAuthorizationStrategy = new OAuth2Strategy(whoopOAuthConfig, getUser)
whoopAuthorizationStrategy.userProfile = fetchProfile

passport.use('withWhoop', whoopAuthorizationStrategy)
```

Here we are building a strategy, passing it our WHOOP configuration and telling it what to do when a user is
authenticated - which is to save or get the user from our database.

We're also telling the strategy to use our ability to fetch profile information.

Lastly, we're telling Passport itself to use our newly-created strategy.

## Authenticate With WHOOP[â](#authenticate-with-whoop "Direct link to Authenticate With WHOOP")

We need to authenticate requests using `passport.authenticate()`. Where this gets invoked will depend on your framework
of choice. Let's assume an [Express](https://expressjs.com/) application.

```javascript
app.get('/auth/example',
    passport.authenticate('withWhoop'));

app.get('/auth/example/callback',
    passport.authenticate('withWhoop', {failureRedirect: '/login'}),
    function (req, res) {
        res.redirect('/welcome');
    });
```

How this gets invoked in your middleware stack or routing layer will depend on
the framework you're using.

## Congratulations[â](#congratulations "Direct link to Congratulations")

After going through this tutorial, you have learned:

* How to build a custom Passport OAuth 2.0 strategy to complete the OAuth flow with WHOOP.
* Where to add your custom logic to handle user management and persistence.
* How to access a user's profile information and tell Passport about it to automatically retrieve user information from
  WHOOP.
* How to connect those individual pieces with Passports OAuth 2.0 package.

The next step for you is to plug this into whatever framework or middleware you're using to trigger Passport
to authenticate.