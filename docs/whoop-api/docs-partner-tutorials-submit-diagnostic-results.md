# Submit Diagnostic Results

> Source: https://developer.whoop.com/docs/partner/tutorials/submit-diagnostic-results

---

# Submit Diagnostic Results

This example will use the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
to make an HTTP request to WHOOP's server.

## Prerequisites[â](#prerequisites "Direct link to Prerequisites")

* Trusted Partner Bearer token: The token received after completing the [Partner Authentication](/docs/partner/authentication) flow.
* Service Request ID: The identifier of the service request to submit results for.

## When to Call This Endpoint[â](#when-to-call-this-endpoint "Direct link to When to Call This Endpoint")

Call this endpoint as each individual test completesâdo not wait for the full panel to finish. You should
also keep the service request status up to date throughout the workflow via
`PATCH /v2/partner/service-request/{id}/status`.

## Making the Request[â](#making-the-request "Direct link to Making the Request")

We first need to assemble the result payload to send to WHOOP's server.

```javascript
const partnerToken = "__TRUSTED_PARTNER_BEARER_TOKEN__";
const serviceRequestId = "__SERVICE_REQUEST_ID__";

const results = {
    status: 'final',
    observations: [
        {
            code: 'TOTAL_CHOLESTEROL',
            value_numeric: 185,
            unit: 'mg/dL',
            status: 'final',
        },
        {
            code: 'HDL',
            value_numeric: 55,
            unit: 'mg/dL',
            status: 'final',
        },
        {
            code: 'LDL',
            value_numeric: 110,
            unit: 'mg/dL',
            status: 'final',
        },
        {
            code: 'BLOOD_TYPE',
            value_text: 'A+',
            status: 'final',
        },
    ],
}
```

The request body fields are:

* **status**: The overall state of the diagnostic report. Use `final` when testing is complete and all results
  are verified. Other valid values include `partial`, `preliminary`, `amended`, `corrected`, and `cancelled`.
* **observations**: An array of individual test result measurements included in this report.

Each observation in the `observations` array contains:

* **code**: The test or measurement identifier (e.g. `"TOTAL_CHOLESTEROL"`).
* **value\_numeric**: The measured result as a number. Use for quantitative results (e.g. `185`).
* **value\_text**: The measured result as a string. Use for qualitative results (e.g. `"A+"`). At least one of `value_numeric` or `value_text` must be provided.
* **unit**: The unit of measurement (e.g. `"mg/dL"`).
* **status**: The status of this individual observation (e.g. `"final"`). Follows FHIR ObservationStatus values.

Now that we have the payload, we can construct the full API call:

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
        throw new Error(`Unexpected response: ${response.status}`)
    }
}

await submitDiagnosticResults(partnerToken, serviceRequestId, results)
```

## Response[â](#response "Direct link to Response")

A `201 Created` response with no body indicates the results were submitted successfully. A `404 Not Found` response means the service request ID does not exist.

## Congratulations[â](#congratulations "Direct link to Congratulations")

Your lab results have been submitted to WHOOP. The member's diagnostic data is now available on their end.

For the complete end-to-end workflow including status updates, see [Complete a Service Request](/docs/partner/tutorials/complete-a-service-request).