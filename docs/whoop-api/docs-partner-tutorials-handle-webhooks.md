# Handle Partner Webhooks

> Source: https://developer.whoop.com/docs/partner/tutorials/handle-webhooks

---

# Handle Partner Webhooks

This example will use the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
to make HTTP requests to WHOOP's server.

## Prerequisites[â](#prerequisites "Direct link to Prerequisites")

* Trusted Partner Bearer token: The token received after completing the [Partner Authentication](/docs/partner/authentication) flow. Note that this is separate from the webhook signing secret, which is also provided during onboarding and is used to verify incoming webhooks.
* A publicly accessible HTTPS endpoint on your server to receive webhook POST requests. Your webhook URL is configured by WHOOP during the partner onboarding process.

## Overview[â](#overview "Direct link to Overview")

WHOOP notifies your server of new lab orders and other events by sending a webhook to your registered endpoint.
Webhook payloads are intentionally minimalâthey contain only an event type and a resource ID. Your server
must then call the Partner API to retrieve the full details.

The events your server may receive are:

* **lab\_requisition.created**: A new lab order has been created and is ready for your lab to process.
* **clinical\_report\_review.requested**: A clinical report is ready for your team to review.

## Webhook Payload[â](#webhook-payload "Direct link to Webhook Payload")

Every webhook WHOOP sends to your endpoint has the same structure:

```json
{
  "event_type": "lab_requisition.created",
  "resource_id": "e72719d6-0dbb-4eb3-9ccc-781b563fc3d3"
}
```

The fields are:

* **event\_type**: The type of event that occurred (see event types above).
* **resource\_id**: The ID of the resource you should fetch from the Partner API to get full details.

## Verifying the Signature[â](#verifying-the-signature "Direct link to Verifying the Signature")

Every webhook WHOOP sends includes a `WHOOP-Signed` header containing an HMAC-SHA256 signature of the
request body. You should verify this signature before processing any webhook to confirm the request came
from WHOOP.

WHOOP signs the raw JSON request body using the signing secret associated with your partner account.
The signature is a lowercase hex-encoded HMAC-SHA256 digest.

```javascript
// This is a sample implementation, there are likely edge cases around this specific API that are not covered or handled.
const crypto = require('crypto')

const verifyWhoopSignature = (rawBody, signingSecret, whoopSignedHeader) => {
    const expected = crypto
        .createHmac('sha256', signingSecret)
        .update(rawBody, 'utf8')
        .digest('hex')

    return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(whoopSignedHeader),
    )
}
```

## Receiving the Webhook[â](#receiving-the-webhook "Direct link to Receiving the Webhook")

Your endpoint should accept POST requests, verify the signature, and respond with a `204` status within
one second to acknowledge receipt. WHOOP will treat responses that take longer than one second as a
failure. Perform any heavy processing asynchronously after responding.

If your endpoint fails or does not respond in time, WHOOP will retry the webhook using exponential
backoff.

```javascript
// Example using Express, simplified for understanding
app.post('/whoop/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['whoop-signed']
    const signingSecret = process.env.WHOOP_WEBHOOK_SIGNING_SECRET

    if (!verifyWhoopSignature(req.body, signingSecret, signature)) {
        return res.sendStatus(401)
    }

    // Acknowledge receipt immediately â WHOOP expects a 204 within 1 second
    res.sendStatus(204)

    const { event_type, resource_id } = JSON.parse(req.body)

    try {
        await handleWhoopEvent(event_type, resource_id)
    } catch (err) {
        console.error('Error handling WHOOP webhook', err)
    }
})
```

## Fetching the Full Resource[â](#fetching-the-full-resource "Direct link to Fetching the Full Resource")

After receiving the webhook, use the `resource_id` to fetch the full details from the Partner API.
Which endpoint you call depends on the `event_type`.

```javascript
const partnerToken = '__TRUSTED_PARTNER_BEARER_TOKEN__'

const handleWhoopEvent = async (eventType, resourceId) => {
    switch (eventType) {
        case 'lab_requisition.created':
            // Fetch the full requisition and confirm each service request with ORDER_CONFIRMED
            return handleLabRequisition(partnerToken, resourceId)
        case 'clinical_report_review.requested':
            // Fetch the review details and route to your clinical review workflow
            return handleClinicalReportReview(partnerToken, resourceId)
        default:
            console.warn(`Unknown event type: ${eventType}`)
    }
}
```

### Handling a lab\_requisition.created Event[â](#handling-a-lab_requisitioncreated-event "Direct link to Handling a lab_requisition.created Event")

When a new lab order arrives, fetch the requisition to see which tests are ordered and get the patient
details you need to process the order.

```javascript
// Example simplified for understanding
const handleLabRequisition = async (partnerToken, requisitionId) => {
    const uri = `https://api.prod.whoop.com/developer/v2/partner/requisition/${requisitionId}`

    const response = await fetch(uri, {
        headers: {
            Authorization: `Bearer ${partnerToken}`,
        },
    })

    if (response.status === 200) {
        const requisition = await response.json()
        // Validate the order, then confirm each service request with ORDER_CONFIRMED
        for (const serviceRequest of requisition.service_requests) {
            await updateServiceRequestStatus(partnerToken, serviceRequest.id, 'ORDER_CONFIRMED')
        }
    } else if (response.status === 404) {
        throw new Error('Requisition not found')
    } else {
        throw new Error(`Unexpected status: ${response.status}`)
    }
}
```

### Response[â](#response "Direct link to Response")

The response contains the full requisition with all service requests and patient details:

```json
{
  "id": "e72719d6-0dbb-4eb3-9ccc-781b563fc3d3",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "patient": {
    "id": "569250ea-0a6b-49ab-804b-13cf486aacc7",
    "... partner specific fields ...": "..."
  },
  "service_requests": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "status": "active",
      "intent": "order",
      "code": "LIPID_PANEL",
      "task_business_status": null,
      "task_description": "Fasting lipid panel"
    }
  ]
}
```

Once you have the requisition, see [Complete a Service Request](/docs/partner/tutorials/complete-a-service-request)
for how to update service request status and submit results as you process the order.

## Congratulations[â](#congratulations "Direct link to Congratulations")

After going through this tutorial, you have learned:

* How WHOOP partner webhooks work and why payloads contain only an event type and resource ID.
* How to verify the `WHOOP-Signed` HMAC-SHA256 signature to authenticate incoming webhook requests.
* How to set up an endpoint to receive and acknowledge webhook notifications from WHOOP within the required one-second window.
* How WHOOP retries failed webhook deliveries using exponential backoff.
* How to use the `event_type` and `resource_id` from a webhook to fetch the full resource from the Partner API.