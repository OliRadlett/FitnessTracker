# Support

> Source: https://developer.whoop.com/docs/developing/support

---

# Support

## FAQ[â](#faq "Direct link to FAQ")

#### How do I get started with the WHOOP Developer Platform?[â](#how-do-i-get-started-with-the-whoop-developer-platform "Direct link to How do I get started with the WHOOP Developer Platform?")

To get started, you need to sign up for an account on whoop.com and obtain a WHOOP device. Once you have an account, you can create an application by navigating to Dashboard on developer.whoop.com and logging in with your account credentials. You can reference our [getting started](https://developer.whoop.com/docs/developing/getting-started) guide to learn how to integrate WHOOP data into your application.

#### What data is available through the WHOOP API?[â](#what-data-is-available-through-the-whoop-api "Direct link to What data is available through the WHOOP API?")

The WHOOP API provides access to various types of data, including [activity](https://developer.whoop.com/docs/developing/user-data/workout) data, [sleep](https://developer.whoop.com/docs/developing/user-data/sleep) data, [recovery](https://developer.whoop.com/docs/developing/user-data/recovery) data, and more. For a detailed list of available endpoints and the data they return, please refer to our [API documentation](https://developer.whoop.com/api).

#### Are there any costs associated with using the WHOOP API?[â](#are-there-any-costs-associated-with-using-the-whoop-api "Direct link to Are there any costs associated with using the WHOOP API?")

Access to the WHOOP Developer Platform and API is currently free. However, you must have a WHOOP device, which requires a membership. Check [join.whoop.com](https://www.join.whoop.com?utm_source=whoop&utm_medium=developer) for more details.

#### Do you offer a sandbox environment for developers who do not have a WHOOP?[â](#do-you-offer-a-sandbox-environment-for-developers-who-do-not-have-a-whoop "Direct link to Do you offer a sandbox environment for developers who do not have a WHOOP?")

We require all developers on the Developer Platform to have a WHOOP device. Using WHOOP and understanding the user flow dramatically helps with understanding and integrating with our API.

#### What are the future improvement plans for the WHOOP API?[â](#what-are-the-future-improvement-plans-for-the-whoop-api "Direct link to What are the future improvement plans for the WHOOP API?")

We strive to continuously improve our API offering and make it straightforward to work with. We will regularly update the API as new functionality and features are released, and note the update in our [changelog](https://developer.whoop.com/docs/api-changelog/). For ideas on enhancing the API, submit a question from the [Support](https://developer-dashboard.whoop.com/support) page, or open an **Idea / Feature request** from your app through **Open Request**.

#### What is your rate limiting policy?[â](#what-is-your-rate-limiting-policy "Direct link to What is your rate limiting policy?")

Check out our rate limiting policy [here](https://developer.whoop.com/docs/developing/rate-limiting).

#### What is a rough estimate of how much a dayâs worth of data for an individual would be in terms of KB?[â](#what-is-a-rough-estimate-of-how-much-a-days-worth-of-data-for-an-individual-would-be-in-terms-of-kb "Direct link to What is a rough estimate of how much a dayâs worth of data for an individual would be in terms of KB?")

A dayâs worth of member data (with one workout, one sleep, and one recovery) would be about 4 KB. For each additional workout or nap, add 1 KB.

#### How often should we refresh tokens in the OAuth flow?[â](#how-often-should-we-refresh-tokens-in-the-oauth-flow "Direct link to How often should we refresh tokens in the OAuth flow?")

You should refresh tokens every hour. See an example flow [here](https://www.oauth.com/oauth2-servers/server-side-apps/example-flow/) and documentation for refreshing an access token [here](https://www.oauth.com/oauth2-servers/making-authenticated-requests/refreshing-an-access-token/).

#### Do I need to include the `offline` scope?[â](#do-i-need-to-include-the-offline-scope "Direct link to do-i-need-to-include-the-offline-scope")

We recommend requesting the `offline` scope *both* when requesting an access token, as this will give you a refresh token, as well as when refreshing an access token. With a refresh token, your app can get a new access token after the original one expires, which is crucial for accessing WHOOP data over time.

#### Do I need to show that my app has collected a memberâs authorization in my UI?[â](#do-i-need-to-show-that-my-app-has-collected-a-members-authorization-in-my-ui "Direct link to Do I need to show that my app has collected a memberâs authorization in my UI?")

The WHOOP member should always be able to see that they've granted you access to their data. You should offer an easy and intuitive way for the member to [disable](https://developer.whoop.com/api/#tag/User/operation/revokeUserOAuthAccess) the integration as well. The member can also revoke access to an integration via the WHOOP app.

#### Generally, what is the lift to use the API?[â](#generally-what-is-the-lift-to-use-the-api "Direct link to Generally, what is the lift to use the API?")

The WHOOP API utilizes [OAuth 2.0](https://developer.whoop.com/docs/developing/oauth) authentication, which is well-documented and industry standard, and [webhooks](https://developer.whoop.com/docs/developing/webhooks/) to notify when new data is available. Integrating with the WHOOP API is very straightforward. Typically, the hardest part of integrating with the WHOOP API is understanding the data model (*e.g., what is a [physiological cycle](https://developer.whoop.com/docs/developing/user-data/cycle), and how does that differ from a calendar day?*). Weâve heard from countless developers that wearing a WHOOP makes understanding the API and data model significantly easier.

#### Does the API offer access to continuous heart rate data?[â](#does-the-api-offer-access-to-continuous-heart-rate-data "Direct link to Does the API offer access to continuous heart rate data?")

Each WHOOP device can broadcast heart rate over Bluetooth Low Energy (BLE) to other devices. Many applications have implemented a Bluetooth listener to let members connect their WHOOP as a heart rate monitor. Continuous heart rate data is not available via the WHOOP API.

## Submitting feedback[â](#submitting-feedback "Direct link to Submitting feedback")

If you are encountering issues with or have feedback about the WHOOP API, submit a question from the [Support](https://developer-dashboard.whoop.com/support) page and optionally select the app it relates to. Please note that responses may take some time.

Still have questions? Submit them from the [Support](https://developer-dashboard.whoop.com/support) page and optionally select the app they relate to.