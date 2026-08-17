# Overview

> Source: https://developer.whoop.com/docs/developing/overview

---

# Overview

Before diving into specifics, let's review the process for launching an app on the WHOOP Developer Platform.

## 1. Sign up for WHOOP[â](#1-sign-up-for-whoop "Direct link to 1. Sign up for WHOOP")

You must have a WHOOP membership to develop an app on the Developer Platform. Your WHOOP account is also your WHOOP
developer login. You can join WHOOP [here](https://join.whoop.com?utm_source=whoop&utm_medium=developer).

## 2. Create an App in the WHOOP Developer Dashboard[â](#2-create-an-app-in-the-whoop-developer-dashboard "Direct link to 2. Create an App in the WHOOP Developer Dashboard")

The [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/) is where you register your app with WHOOP. You
can create a new app, access your Client Secret, and invite other developers to view and maintain the
app. [Getting started with the Developer Dashboard](/docs/developing/getting-started) will walk you through registering
your first app.

You can create up to 5 apps. If you need more, open your app in the [Developer Dashboard](https://developer-dashboard.whoop.com), click **Open Request**, and choose **App limit increase**.

## 3. Authenticate with WHOOP using the OAuth 2.0 protocol[â](#3-authenticate-with-whoop-using-the-oauth-20-protocol "Direct link to 3. Authenticate with WHOOP using the OAuth 2.0 protocol")

Once you have a `Client ID` and `Client Secret` in the Developer Dashboard, you can use
the [OAuth standard](/docs/developing/oauth) to request consent from WHOOP members to access data on their
behalf. Once a WHOOP member grants your app permission, you will receive a per-user Access and Refresh Token that your
app uses on requests to the WHOOP API.

## 4. Make requests to the WHOOP API[â](#4-make-requests-to-the-whoop-api "Direct link to 4. Make requests to the WHOOP API")

WHOOP exposes RESTful endpoints that you can access using the Access and Refresh Token from **Step #3: Authenticate with
WHOOP**. You can view the documentation on the API endpoints [here](/api).

## 5. Launch your app[â](#5-launch-your-app "Direct link to 5. Launch your app")

When you are ready to launch your app, [submit it for approval](/docs/developing/app-approval).

Also, consider
how [request limits](/docs/developing/rate-limiting) may impact your app.