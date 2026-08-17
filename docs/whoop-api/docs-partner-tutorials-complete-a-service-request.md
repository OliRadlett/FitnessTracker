# Complete a Service Request

> Source: https://developer.whoop.com/docs/partner/tutorials/complete-a-service-request

---

# Complete a Service Request

This tutorial walks through the end-to-end workflow for processing a lab order using the
[Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
to make HTTP requests to WHOOP's server.

## Prerequisites[â](#prerequisites "Direct link to Prerequisites")

* Trusted Partner Bearer token: The token received after completing the [Partner Authentication](/docs/partner/authentication) flow.
* Requisition ID: The identifier of the lab order provided by WHOOP.

## Overview[â](#overview "Direct link to Overview")

The process of completing a service request requires three steps:

* Get the Requisition to see which service requests it contains.
* Update the Service Request status to reflect lab progress.
* Submit a Diagnostic Report for each service request as its results become available.

## Get the Requisition[â](#get-the-requisition "Direct link to Get the Requisition")

Let's start by fetching the requisition. This gives us the list of service requests we need to process.

```javascript
const partnerToken = "__TRUSTED_PARTNER_BEARER_TOKEN__";
const requisitionId = "__REQUISITION_ID__";

const getRequisition = async (partnerToken, requisitionId) => {
    const uri = `https://api.prod.whoop.com/developer/v2/partner/requisition/${requisitionId}`

    const response = await fetch(uri, {
        headers: {
            Authorization: `Bearer ${partnerToken}`,
        },
    })

    if (response.status === 200) {
        return response.json()
    } else if (response.status === 404) {
        throw new Error('Requisition not found')
    } else {
        throw new Error(`Unexpected status: ${response.status}`)
    }
}
```

### Response[â](#response "Direct link to Response")

The response includes the requisition, the patient, and all of its service requests. Note the `id` of each
service requestâyou will need it in the next steps.

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "patient": {
    "id": "569250ea-0a6b-49ab-804b-13cf486aacc7"
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

## Update Service Request Status[â](#update-service-request-status "Direct link to Update Service Request Status")

After retrieving the requisition, validate the order and confirm it by setting `task_business_status` to
`ORDER_CONFIRMED`. You will call this endpoint again as the order progresses through the workflow. See
[Service Requests](/docs/partner/service-requests#task_business_status) for the full list of expected values.

```javascript
const updateServiceRequestStatus = async (partnerToken, serviceRequestId, taskBusinessStatus, reason) => {
    const uri = `https://api.prod.whoop.com/developer/v2/partner/service-request/${serviceRequestId}/status`

    const response = await fetch(uri, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${partnerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task_business_status: taskBusinessStatus, reason }),
    })

    if (response.status === 200) {
        return response.json()
    } else if (response.status === 404) {
        throw new Error('Service request not found')
    } else {
        throw new Error(`Unexpected status: ${response.status}`)
    }
}

// Confirm the order after validating the requisition
await updateServiceRequestStatus(
    partnerToken,
    '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    'ORDER_CONFIRMED',
)
```

The request body fields are:

* **task\_business\_status**: The workflow state to set. See [Service Requests](/docs/partner/service-requests#task_business_status) for the full list of valid values.
* **reason**: An optional note explaining the status change.

### Response[â](#response-1 "Direct link to Response")

Returns the updated service request.

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "active",
  "intent": "order",
  "code": "LIPID_PANEL",
  "task_business_status": "ORDER_CONFIRMED",
  "task_description": "Fasting lipid panel"
}
```

## Submit Diagnostic Results[â](#submit-diagnostic-results "Direct link to Submit Diagnostic Results")

As each test completes, submit the diagnostic results for that service request. You do not need to wait
for the full panel to finishâsubmit results for each service request as they become available.

```javascript
const submitDiagnosticResults = async (partnerToken, serviceRequestId, results) => {
    const uri = `https://api.prod.whoop.com/developer/v2/partner/service-request/${serviceRequestId}/results`

    const response = await fetch(uri, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${partnerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(results),
    })

    if (response.status === 201) {
        return // Successfully created
    } else if (response.status === 404) {
        throw new Error('Service request not found')
    } else {
        throw new Error(`Unexpected status: ${response.status}`)
    }
}

await submitDiagnosticResults(partnerToken, '3fa85f64-5717-4562-b3fc-2c963f66afa6', {
    status: 'final',
    observations: [
        {
            code: 'TOTAL_CHOLESTEROL',
            value_numeric: 185,
            unit: 'mg/dL',
        },
        {
            code: 'BLOOD_TYPE',
            value_text: 'A+',
        },
    ],
})
```

### Response[â](#response-2 "Direct link to Response")

A `201 Created` response with no body indicates the results were submitted successfully.

## Congratulations[â](#congratulations "Direct link to Congratulations")

After going through this tutorial, you have learned:

* How to retrieve a lab requisition and its service requests from WHOOP.
* How to update a service request's status to reflect your lab's workflow progress.
* How to submit final diagnostic results for a completed service request.

For a deeper look at submitting results, see [Submit Diagnostic Results](/docs/partner/tutorials/submit-diagnostic-results).