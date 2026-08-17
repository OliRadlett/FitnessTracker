# Getting Started

> Source: https://developer.whoop.com/docs/developing/getting-started

---

# Getting Started

To start developing with WHOOP, you first need to create an `App` in
the WHOOP [Developer Dashboard](https://developer-dashboard.whoop.com). If you're already registered in the Developer Dashboard,
you can skip this section and learn [how to authenticate with WHOOP](/docs/developing/oauth) using your app's `Client ID`
and `Client Secret`.

The [Developer Dashboard](https://developer-dashboard.whoop.com) site manages Client Secrets and access to WHOOP OAuth API endpoints. When you sign in to the Developer Dashboard, you'll be redirected to id.whoop.com to authenticate using your WHOOP account credentials.

## Creating your first App[â](#creating-your-first-app "Direct link to Creating your first App")

To create your first App, head to the [App creation flow](https://developer-dashboard.whoop.com/apps/create) in the Developer Dashboard. You will be prompted to [create a Team](/docs/developing/getting-started#creating-your-team) if you have not yet done so.

You can create up to 5 Apps. If you need more, open your app in the [Developer Dashboard](https://developer-dashboard.whoop.com), click **Open Request**, and choose **App limit increase**.

### Scopes[â](#scopes "Direct link to Scopes")

Scopes define the limits of access your App will have to an individual's account data. At least one scope *must*
be specified to create an App. When performing the OAuth flow, you can request one or more of these scopes from a WHOOP member.

Please note that you should limit the scopes requested to *only* the ones your application will use.

You can learn more about the available scopes and what they represent
from the [API Docs](/api#section/Authentication).

### Redirect URIs[â](#redirect-uris "Direct link to Redirect URIs")

You must specify at least one redirect URL for each App. The redirect URI on your OAuth authorization request must match the
value in the Developer Dashboard. You may provide multiple Redirect URIs that your client needs.

### Completing Client Creation[â](#completing-client-creation "Direct link to Completing Client Creation")

After filling in all the fields, click the **Create** button at the bottom to complete the process.

## Accessing Client Credentials[â](#accessing-client-credentials "Direct link to Accessing Client Credentials")

After you have created your App, you will be provided with your `Client ID` and `Client Secret`. These values are required to complete the OAuth flow.

Note: your `Client Secret` should *never* be logged or shared with anyone. It should only be used server side and should never be exposed in a client, web, or mobile application.

After creating the App, you will be able to see these values later by clicking into
the app from the [Apps](https://developer-dashboard.whoop.com/) section, where all your current Apps are listed.

## Editing or Deleting an App[â](#editing-or-deleting-an-app "Direct link to Editing or Deleting an App")

To change any details about your app, navigate to the [App](https://developer-dashboard.whoop.com/), click the pencil icon, edit any values, and save your app.

Caution!

Clicking the red trash can button will delete the app. Exercise caution when deleting apps, as this action cannot be undone.

---

## Creating your team[â](#creating-your-team "Direct link to Creating your team")

Before creating your first app, you'll be prompted to create a Team.

After clicking **Get Started**, you'll be taken to the team creation form.

Choose a name for your team and click **Create Team**.

## Adding Users To A Team[â](#adding-users-to-a-team "Direct link to Adding Users To A Team")

You can add other developers to your team to share access to app information and management.

To invite someone to your team, you can head to the [Team](https://developer-dashboard.whoop.com/team) section of the Developer Dashboard and click the **Invite** button in the top right corner.

From there, you can add another developer to your team. To add the developer to your team, you need the email address associated with their WHOOP account.

Fill in the WHOOP email of the other developer, and click **Invite**.