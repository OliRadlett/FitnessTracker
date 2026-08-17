# Webhooks

> Source: https://developer.whoop.com/docs/developing/webhooks

---

# Webhooks

WHOOP webhooks allow you to get notified when an event takes place for users that have authenticated with your app. By subscribing to webhooks, you will be alerted when a user's data was updated rather than needing to constantly make API requests to check for updates.

## Setting Up Webhooks[â](#setting-up-webhooks "Direct link to Setting Up Webhooks")

You will first need to create an HTTPS URL endpoint to receive webhooks. This endpoint should be capable of accepting POST requests with a body consisting of the [webhook data format](#webhook-specifications) and be able to perform [webhook signature validation](#webhooks-security).

note

If you are using multiple apps in the WHOOP dashboard, you will need a unique Webhook endpoint per app.

With your webhook endpoint set up, you can [create or update](/docs/developing/getting-started) an app to start accepting webhooks at that URL. Simply add your HTTPS URL to the **Webhook URL** section at the bottom of the page and save the app.

That's it! The next time a WHOOP user that has authenticated with your app triggers one of the supported webhook events, you will receive a webhook alerting you of the change.

## Webhook Model Versions[â](#webhook-model-versions "Direct link to Webhook Model Versions")

WHOOP supports two webhook model versions that you can configure for each webhook URL:

### v2 Webhooks (default)[â](#v2-webhooks-default "Direct link to v2 Webhooks (default)")

v2 webhooks use UUID identifiers instead of integer IDs, providing better alignment with the v2 API endpoints. When you configure a webhook URL to use the v2 model version:

### v1 Webhooks (legacy)[â](#v1-webhooks-legacy "Direct link to v1 Webhooks (legacy)")

v1 webhooks used traditional integer IDs for identifying resources and maintain backward compatibility with existing integrations.
v1 webhooks are no longer published.

* **Activity webhooks** (workout and sleep events) will include UUID identifiers that correspond to the v2 API endpoints
* **Recovery webhooks** will include the UUID identifier of the sleep that the recovery is associated with, rather than the cycle ID

### Configuring Webhook Model Versions[â](#configuring-webhook-model-versions "Direct link to Configuring Webhook Model Versions")

In the WHOOP Developer Dashboard, you can configure the model version for each webhook URL individually:

1. Navigate to your app settings in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/)
2. In the **Webhooks** section, you can add multiple webhook URLs
3. For each URL, select either **v1** or **v2** from the **Model Version** dropdown
4. Save your app configuration

This flexibility allows you to:

* Migrate to v2 webhooks gradually by configuring different URLs for different versions
* Test v2 webhook format on a separate endpoint before switching your production webhook
* Support both v1 and v2 integrations simultaneously if needed

Migration Strategy

If you're migrating from v1 to v2 webhooks, consider setting up a separate webhook URL with v2 model version for testing before switching your production webhook configuration.

## Webhook Specifications[â](#webhook-specifications "Direct link to Webhook Specifications")

Webhooks are sent over HTTPS as a POST request to your configured URL. The body of the webhook request includes the following fields:

|  |  |
| --- | --- |
| user\_id | int64  The WHOOP User for the event |
| id | int64 or string  Identifier of the object that triggered this webhook. For v1 webhooks: integer ID. For v2 webhooks: UUID. For recovery events in v2, this is the id (UUID) of the sleep that the recovery is associated with. |
| type | string  Enum: "workout.updated" "workout.deleted" "sleep.updated" "sleep.deleted" "recovery.updated" "recovery.deleted"  The type of event that triggered this webhook |
| trace\_id | string  Trace ID for the event that triggered this webhook |

Copy

`{

* "user_id": 10129,
* "id": 10235,
* "type": "workout.updated",
* "trace_id": "d3709ee7-104e-4f70-a928-2932964b017b"

}`

### Webhook Event Types[â](#webhook-event-types "Direct link to Webhook Event Types")

There are several events that are published as webhooks:

| Event Type | v1 ID Type (long) | v2 ID Type (UUID) | Explanation |
| --- | --- | --- | --- |
| `recovery.updated` | The id of the cycle for the recovery (long) | The id of the associated sleep (UUID) | Occurs when a recovery is created or updated. In v1, the ID refers to the cycle. In v2, the ID is the UUID of the sleep that the recovery is associated with. |
| `recovery.deleted` | The id of the cycle for the recovery (long) | The id of the associated sleep (UUID) | Occurs when a recovery is deleted. In v1, the ID refers to the cycle. In v2, the ID is the UUID of the sleep that the recovery is associated with. Note: a recovery is deleted when its associated sleep is deleted. |
| `workout.updated` | The id of the workout (long) | The id of the workout (UUID) | Occurs when a workout is created or updated. |
| `workout.deleted` | The id of the workout (long) | The id of the workout (UUID) | Occurs when a workout is deleted. |
| `sleep.updated` | The id of the sleep (long) | The id of the sleep (UUID) | Occurs when a sleep is created or updated. |
| `sleep.deleted` | The id of the sleep (long) | The id of the sleep (UUID) | Occurs when a sleep is deleted. |

note

All webhook event types are sent to each configured webhook URL. If you don't need to process a specific event type, simply respond with a `2XX` status code.

## Webhooks Security[â](#webhooks-security "Direct link to Webhooks Security")

In order to validate that the webhooks you are receiving are originating from WHOOP, you will want to implement signature validation. This can be done by making use of two of the headers sent with each webhook request:

* `X-WHOOP-Signature` - the actual signature
* `X-WHOOP-Signature-Timestamp` - the milliseconds since epoch timestamp used to verify the signature

To verify the signature, first prepend the timestamp header value to the raw http request body. Then, generate a SHA256 HMAC signature of that string using the secret key for your app, which can be found in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/). Finally, base64 encode the result, and compare it to the signature header. If they do not match then the request is invalid and should be dropped.

See below for example signature validation pseudocode:

```text
calculated_signature_string = base64Encode(HMACSHA256(timestamp_header + raw_http_request_body, client_secret))
```

## Example Request Flow[â](#example-request-flow "Direct link to Example Request Flow")

To illustrate a webhook use case, check out the below example request flows that utilize webhooks.

### v2 Webhook Example[â](#v2-webhook-example "Direct link to v2 Webhook Example")

1. WHOOP user `456` goes through the OAuth consent flow with your app, allowing you to read their sleep data.
2. WHOOP user `456` records a sleep. WHOOP assigns UUID `550e8400-e29b-41d4-a716-446655440000` to this sleep.
3. WHOOP makes a post request to your V2 webhook endpoint with the body of:

   ```json
   {
     "user_id": 456,
     "id": "550e8400-e29b-41d4-a716-446655440000",
     "type": "sleep.updated",
     "trace_id": "e369c784-5100-49e8-8098-75d35c47b31b"
   }
   ```
4. Based on seeing `sleep.updated` in the `type` field, your app makes a GET request to the `v2/activity/sleep/550e8400-e29b-41d4-a716-446655440000` endpoint using the access token for WHOOP user `456` in order to retrieve the sleep data.

### v1 Webhook Example[â](#v1-webhook-example "Direct link to v1 Webhook Example")

1. WHOOP user `456` goes through the OAuth consent flow with your app, allowing you to read their sleep data.
2. WHOOP user `456` records a sleep. WHOOP assigns id `1234` to this sleep.
3. WHOOP makes a post request to your v1 webhook endpoint with the body of:

   ```json
   {
     "user_id": 456,
     "id": 1234,
     "type": "sleep.updated",
     "trace_id": "e369c784-5100-49e8-8098-75d35c47b31b"
   }
   ```
4. Based on seeing `sleep.updated` in the `type` field, your app makes a GET request to the `v1/activity/sleep/1234` endpoint using the access token for WHOOP user `456` in order to retrieve the sleep data.

As you begin implementing webhooks, you should have logic for interpreting each of these webhook event types. The webhook model version you choose should align with the API version you're using to retrieve the data:

* **v2 webhooks** â Use with `v2` API endpoints (UUID IDs)
* **v1 webhooks** â Use with `v1` API endpoints (long IDs)

## Webhooks Testing[â](#webhooks-testing "Direct link to Webhooks Testing")

To generate a webhook, first authenticate with your app to ensure your data is retrievable via the API. Then, open the WHOOP app and do one of the following:

1. [Log an activity](https://support.whoop.com/s/article/Logging-Activities-Sleep) in the past (e.g. navigate to yesterday and create a 5 minute cycling activity)Â â once this activity is processed, your webhook endpoint will receive a `workout.updated` webhook.
2. Edit a previous sleep by changing the start or end time by 1 minuteÂ âÂ once the sleep is processed, your webhook will receive both a `sleep.updated` webhook and a `recovery.updated` webhook.

You can then edit or delete the workout you created, and you can revert the sleep duration change. Each of these actions will also result in webhooks being sentÂ â `workout.updated`, `workout.deleted`, and `sleep.updated`, respectively.

## Delivery & Retries[â](#delivery--retries "Direct link to Delivery & Retries")

WHOOP will retry webhook delivery for failed webhook requests **five times over the course of about one hour**. A webhook delivery is considered failed if it receives any response other than a successful `2XX`, or if it receives no response before timing out.

In order to reduce the amount of delivery failures you encounter, you should consider processing the requests asynchronously after returning a successful response, e.g. with a queue worker.

## Best Practices[â](#best-practices "Direct link to Best Practices")

While working with webhooks, it is important to follow these best practices in order to ensure that you can get the most out of the webhook system.

### Respond quickly[â](#respond-quickly "Direct link to Respond quickly")

As laid out in the [Delivery & Retries](#delivery--retries) section, WHOOP will not indefinitely retry if your webhook endpoint is determined to be unavailable. We recommend designing your webhook API to return a successful `2XX` status code within a second and for high availability. If your webhook implementation has other dependencies or needs to do expensive work, one strategy is to have your API enqueue the event on a queue for asynchronous processing.

### Validate signatures[â](#validate-signatures "Direct link to Validate signatures")

Be sure to validate the message signature to ensure webhooks you receive were actually sent by WHOOP. Check out the [Webhooks Security](#webhooks-security) section to see more details on how to implement this.

### Implement a reconciliation job[â](#implement-a-reconciliation-job "Direct link to Implement a reconciliation job")

Since webhook delivery can fail webhooks should not be the sole source of truth for your application. Therefore, we recommend implementing a reconciliation job to occasionally fetch data from WHOOP.

## Limitations[â](#limitations "Direct link to Limitations")

There are a few limitations to be aware of when implementing webhooks:

1. It is possible you will receive multiple webhook invocations for the same triggering event. You can make use of the `trace_id` field in the webhook to detect duplicate webhooks.
2. These are event based webhooks, meaning they are notifications of changes and not actually the changes themselves. You will need to call the API in order to retrieve the most up-to-date data around this event. There is an example of what this flow would look like in the [Example Request Flow](#example-request-flow) section.
3. It is possible that a webhook may be missed. You should implement a reconciliation job that can occasionally reach out to the WHOOP API for the data types you care about to fetch data that may have been missed.

## Webhooks FAQs[â](#webhooks-faqs "Direct link to Webhooks FAQs")

#### Why are there only update and delete events? Do we get notified of create events?[â](#why-are-there-only-update-and-delete-events-do-we-get-notified-of-create-events "Direct link to Why are there only update and delete events? Do we get notified of create events?")

Yes! When workouts, sleeps, or recoveries are created those events are
published as an "update" event.

#### Are there webhooks for Day Strain, cycles, or body measurements?[â](#are-there-webhooks-for-day-strain-cycles-or-body-measurements "Direct link to Are there webhooks for Day Strain, cycles, or body measurements?")

Not at the moment; these data points should be retrieved by calling their
respective APIs. All of the current webhook types are listed in the [Event Types](#webhook-event-types) section.

#### How can I stop receiving webhooks for users who have disabled my integration?[â](#how-can-i-stop-receiving-webhooks-for-users-who-have-disabled-my-integration "Direct link to How can I stop receiving webhooks for users who have disabled my integration?")

It is best practice to [revoke access tokens](/docs/developing/oauth#revoking-an-access-token) for users who have disabled your integration. Once you do revoke their access token, no webhooks will be sent for the user.