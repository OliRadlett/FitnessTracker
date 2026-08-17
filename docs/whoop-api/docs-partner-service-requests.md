# Service Requests

> Source: https://developer.whoop.com/docs/partner/service-requests

---

# Service Requests

A **service request** represents a single FHIR-based healthcare service orderâtypically one lab test within a requisition. Service requests are created by WHOOP when a lab order is placed, and partners interact with them throughout the lab workflow.

## Fields[â](#fields "Direct link to Fields")

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique identifier for the service request |
| `status` | string | FHIR status of the request (see below) |
| `code` | string | The service or procedure being requested (e.g. a lab test code) |
| `task_business_status` | string (optional) | Workflow state set by the partner to communicate progress |
| `task_description` | string (optional) | Additional description of the task |

### Example[â](#example "Direct link to Example")

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "active",
  "code": "LIPID_PANEL",
  "task_business_status": "ORDER_CONFIRMED",
  "task_description": "Fasting lipid panel"
}
```

## Status Values[â](#status-values "Direct link to Status Values")

The `status` field follows FHIR ServiceRequest status conventions:

| Status | Meaning |
| --- | --- |
| `active` | The service request is in progress |
| `completed` | The service request has been fulfilled |
| `revoked` | The service request was cancelled |

## task\_business\_status[â](#task_business_status "Direct link to task_business_status")

The `task_business_status` field is how partners communicate workflow progress back to WHOOP. Partners set this field via `PATCH /v2/partner/service-request/{id}/status` throughout the lab workflow.

### Happy Path[â](#happy-path "Direct link to Happy Path")

The expected sequence for a successfully completed service request is:

| Value | Meaning |
| --- | --- |
| `ORDER_CONFIRMED` | Partner has accepted and confirmed the lab order |
| `APPOINTMENT_ATTENDED` | The member attended their appointment and a sample was collected |
| `PARTIAL_RESULTS_READY` | Some results are available but the full panel is not yet complete |
| `FULL_RESULTS_READY` | All results have been submitted |

### Issue Statuses[â](#issue-statuses "Direct link to Issue Statuses")

If something goes wrong, partners should set one of the following issue statuses. Issue statuses are terminal â once set, WHOOP takes responsibility for next steps.

| Value | Meaning |
| --- | --- |
| `APPOINTMENT_ISSUE` | An issue occurred with the appointment (e.g. cancellation). WHOOP will reschedule. |
| `RESULTS_ISSUE` | An issue with one or more lab tests means some results will be unavailable. |
| `ORDER_ISSUE` | An issue with the order means it will not be fulfilled. WHOOP will place a new order. |

See the [Complete a Service Request](/docs/partner/tutorials/complete-a-service-request) tutorial for an end-to-end example.

## Relationship to Requisitions[â](#relationship-to-requisitions "Direct link to Relationship to Requisitions")

Service requests always belong to a **requisition**. A requisition can contain one or more service requests. You can retrieve all service requests for a requisition in a single call via `GET /v2/partner/requisition/{id}`. See [Lab Requisitions](/docs/partner/lab-requisitions) for details.