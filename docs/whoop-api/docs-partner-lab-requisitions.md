# Lab Requisitions

> Source: https://developer.whoop.com/docs/partner/lab-requisitions

---

# Lab Requisitions

A **lab requisition** is a collection of service requests representing a complete lab order. Requisitions are created by WHOOP (not by the partner) when a member's lab tests are ordered.

## Fields[â](#fields "Direct link to Fields")

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique identifier for the requisition |
| `created_at` | timestamp | When the requisition was created |
| `updated_at` | timestamp | When the requisition was last updated |
| `service_requests` | array | The list of service requests in this requisition |
| `patient` | object | The patient for whom this requisition was created. Contains an `id` as well as partner-specific metadata. |

### Example[â](#example "Direct link to Example")

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T14:22:00Z",
  "patient": {
    "id": "569250ea-0a6b-49ab-804b-13cf486aacc7"
  },
  "service_requests": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "status": "active",
      "intent": "order",
      "code": "LIPID_PANEL",
      "task_business_status": "PARTIAL_RESULTS_READY",
      "task_description": "Fasting lipid panel"
    },
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "status": "active",
      "intent": "order",
      "code": "CBC",
      "task_business_status": "FULL_RESULTS_READY",
      "task_description": "Complete blood count"
    }
  ]
}
```

## When to Use the Requisition Endpoint[â](#when-to-use-the-requisition-endpoint "Direct link to When to Use the Requisition Endpoint")

A requisition is the entry point for every new lab order. When you receive a `lab_requisition.created` webhook, fetch the full requisition to see which tests are ordered and retrieve the patient details you need to process the order.

Use `GET /v2/partner/requisition/{id}` when you need to see all service requests for an order at once.

Use `GET /v2/partner/service-request/{id}` when you need to check the status of a single specific test.

## Requisition Lifecycle[â](#requisition-lifecycle "Direct link to Requisition Lifecycle")

Requisitions are created and managed by WHOOP. As a partner, you:

* Read requisitions and their service requests
* Update individual service request statuses as you process the order
* Submit diagnostic reports for each completed service request