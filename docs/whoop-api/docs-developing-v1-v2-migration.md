# v1 to v2 Migration Guide

> Source: https://developer.whoop.com/docs/developing/v1-v2-migration

---

# v1 to v2 Migration Guide

This guide provides information for developers migrating from v1 to v2 of the WHOOP Developer API. The v2 API offers several improvements while maintaining compatibility with core functionality.

## Overview of Changes[â](#overview-of-changes "Direct link to Overview of Changes")

The v2 API provides several improvements over the v1 API:

* More consistent resource paths and naming
* Enhanced data modeling with more precise types
* UUID-based identification for certain resources
* Better client/server error handling
* More consistent pagination behavior
* Improved OpenAPI specifications and documentation
* Recovery activities are included in the Workouts endpoint

## Endpoint Changes[â](#endpoint-changes "Direct link to Endpoint Changes")

| v1 Endpoint | v2 Endpoint | Notes |
| --- | --- | --- |
| `v1/activity/sleep` | `v2/activity/sleep` | Same structure, but UUID instead of long for `sleepId` |
| `v1/activity/workout` | `v2/activity/workout` | Same structure, but UUID instead of long for `workoutId` |
| `v1/cycle` | `v2/cycle` | Enhanced with `v2/cycle/{cycleId}/sleep` relationship |
| `v1/recovery` | `v2/recovery` | Improved scoring model |

## Data Model Changes[â](#data-model-changes "Direct link to Data Model Changes")

### Common Changes[â](#common-changes "Direct link to Common Changes")

* IDs changed from `long` to `UUID` for some resources (e.g., Sleep, Workout)
* More consistent Optional handling
* Added `activityV1Id` fields to maintain backwards compatibility
* Timezone handling standardized to UTC when not specified

### Sleep Model[â](#sleep-model "Direct link to Sleep Model")

* `v1: long getId()` â `v2: UUID getId()` for uniquely identifying sleep
* Added `Optional<Integer> getActivityV1Id()` to maintain backwards compatibility
* Enhanced sleep stage information
* More detailed sleep quality metrics
* Improved scoring model with additional fields

### Workout Model[â](#workout-model "Direct link to Workout Model")

* `v1: long getId()` â `v2: UUID getId()` for uniquely identifying workouts
* Added `Optional<Integer> getActivityV1Id()` to maintain backwards compatibility with v1 IDs
* More consistent handling of Optional fields
* Improved workout scoring model with properly typed Optional values

### Cycle Model[â](#cycle-model "Direct link to Cycle Model")

* Consistent score state handling between v1 and v2
* Score is only created when all required data is present (avg heart rate, max heart rate, kilojoules, and strain)
* No fallback values for missing data (maintains backwards compatibility)
* Added relationship to Sleep data through `v2/cycle/{cycleId}/sleep`

### Authentication and Security[â](#authentication-and-security "Direct link to Authentication and Security")

* Consistent scope naming and usage
* Same OAuth 2.0 flow with improved token validation
* Security scopes defined as constants in `DeveloperApiConstants` (e.g., `READ_SLEEP`, `READ_CYCLES`, `READ_WORKOUT`)

## Webhook Model Versions[â](#webhook-model-versions "Direct link to Webhook Model Versions")

WHOOP supports two webhook model versions that align with the API versions. For detailed webhook documentation, see [Webhooks](/docs/developing/webhooks/).

### v2 Webhooks (default)[â](#v2-webhooks-default "Direct link to v2 Webhooks (default)")

* Use UUID identifiers instead of integer IDs for activity webhooks (workout and sleep events)
* Recovery webhooks use the UUID identifier of the sleep associated with the recovery in v2 model versions
* Align with v2 API endpoints and data models

### v1 Webhooks (legacy)[â](#v1-webhooks-legacy "Direct link to v1 Webhooks (legacy)")

* Use integer IDs for identifying resources
* Compatible with existing v1 integrations
* Align with v1 API endpoints

### Key Differences[â](#key-differences "Direct link to Key Differences")

| Event Type | v1 Webhook ID | v2 Webhook ID | Notes |
| --- | --- | --- | --- |
| `workout.updated/deleted` | Integer workout ID | UUID workout ID | Corresponds to v2 workout endpoints |
| `sleep.updated/deleted` | Integer sleep ID | UUID sleep ID | Corresponds to v2 sleep endpoints |
| `recovery.updated/deleted` | Integer cycle ID | UUID sleep ID | Recovery webhooks use UUID sleep IDs in v2 versions |

### Configuring Webhook Versions[â](#configuring-webhook-versions "Direct link to Configuring Webhook Versions")

In the WHOOP Developer Dashboard, you can configure the model version for each webhook URL:

1. Navigate to your app settings in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/)
2. In the **Webhooks** section, add or edit webhook URLs
3. Select **v1** or **v2** from the **Model Version** dropdown for each URL
4. Save your app configuration

### Migration Strategy for Webhooks[â](#migration-strategy-for-webhooks "Direct link to Migration Strategy for Webhooks")

When migrating from v1 to v2:

1. **Set up a test webhook URL** with v2 model version to test the new UUID format
2. **Update your webhook handler** to process UUID identifiers for activity events
3. **Align with your API version**: Use v2 webhooks if you're calling v2 API endpoints
4. **Gradual migration**: You can run both v1 and v2 webhooks simultaneously during testing

**Example v1 vs v2 Webhook Payloads:**

v1 Webhook (sleep.updated):

```json
{
  "user_id": 456,
  "id": 1234,
  "type": "sleep.updated",
  "trace_id": "e369c784-5100-49e8-8098-75d35c47b31b"
}
```

v2 Webhook (sleep.updated):

```json
{
  "user_id": 456,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "sleep.updated",
  "trace_id": "e369c784-5100-49e8-8098-75d35c47b31b"
}
```

Webhook and API Alignment

The webhook model version you choose should align with the API version you're using:

* **v1 webhooks** â Use with `v1` API endpoints (integer IDs)
* **v2 webhooks** â Use with `v2` API endpoints (UUID IDs)

## Migration Steps[â](#migration-steps "Direct link to Migration Steps")

### 1. Update Endpoints[â](#1-update-endpoints "Direct link to 1. Update Endpoints")

Update your API client to use v2 endpoints instead of v1:

```diff
- GET /v1/activity/sleep
+ GET /v2/activity/sleep

- GET /v1/activity/sleep/{sleepId}
+ GET /v2/activity/sleep/{sleepId}

- GET /v1/activity/workout
+ GET /v2/activity/workout

- GET /v1/activity/workout/{workoutId}
+ GET /v2/activity/workout/{workoutId}
```

### 2. Lookup V2 IDs from V1 IDs[â](#2-lookup-v2-ids-from-v1-ids "Direct link to 2. Lookup V2 IDs from V1 IDs")

If you have existing V1 activity IDs and need to find their corresponding V2 UUIDs, you can use the Activity ID Mapping endpoint:

```text
GET /v1/activity-mapping/{activityV1Id}
```

**Response Codes:**

* `200`: Successfully retrieved V2 UUID
* `404`: No mapping found for the provided V1 ID

**Use Case:**
This endpoint is designed for **one-time migration** scenarios when:

* You have stored V1 activity IDs in your database and need to migrate them to V2 UUIDs
* You need to lookup the V2 UUID for a historical V1 activity ID
* You're transitioning your application from v1 to v2

Migration Only

This endpoint is intended for migration purposes only. Once you migrate to v2, you should **store and use V2 UUIDs** exclusively. Do not rely on V1 IDs or repeatedly call this mapping endpoint in production workflows.

### 3. Update ID Handling[â](#3-update-id-handling "Direct link to 3. Update ID Handling")

Resource IDs are now UUIDs instead of longs for certain resources:

```diff
- long sleepId = 12345;
+ UUID sleepId = UUID.fromString("ecfc6a15-4661-442f-a9a4-f160dd7afae8");

- long workoutId = 56789;
+ UUID workoutId = UUID.fromString("7bfc6a15-5521-612f-b9a4-e274dd7afae9");
```

**For existing V1 IDs:** Use the Activity ID Mapping endpoint (see section 2) to perform a one-time lookup of the corresponding V2 UUID, then store and use the V2 UUID going forward.

### 4. Update Webhook Configuration (If Using Webhooks)[â](#4-update-webhook-configuration-if-using-webhooks "Direct link to 4. Update Webhook Configuration (If Using Webhooks)")

If you're using webhooks, you will need to update to the v2 webhook model version:

1. **Test first**: Set up a separate webhook URL with v2 model version
2. **Update webhook processing**: Modify your webhook handler to process UUID identifiers
3. **Switch webhook version**: Update your production webhook URL to use v2 model version
4. **Verify alignment**: Ensure webhook version matches the API version you're calling

See the [Webhooks documentation](/docs/developing/webhooks/) for detailed configuration instructions.

### 5. Update Response Handling[â](#5-update-response-handling "Direct link to 5. Update Response Handling")

Adjust your code to handle the updated data models:

* Check for presence of fields with Optional.isPresent() rather than null checks
* Use Optional.map(), Optional.orElse(), etc. for proper Optional handling
* Use the new field names and structures
* Take advantage of additional fields and relationships available in v2

### 6. Testing[â](#6-testing "Direct link to 6. Testing")

* Test your integration thoroughly with both v1 and v2 endpoints
* Compare responses for consistency before fully migrating
* If using webhooks, test both v1 and v2 webhook formats
* Test the Activity ID Mapping endpoint with your existing V1 IDs to verify mappings exist
* Use the v2 API documentation for field details and required parameters

## Benefits of Migrating[â](#benefits-of-migrating "Direct link to Benefits of Migrating")

* More consistent API behavior
* Better data models and relationships
* Improved error handling
* Webhook model versions that align with API versions
* Future features will be added to v2 first
* Long-term support and improvement path

## Deprecation Timeline[â](#deprecation-timeline "Direct link to Deprecation Timeline")

The v1 API is no longer supported and any new features or functionality will be added to v2 only. As such, developers must migrate to v2 to take continue getting webhook events and take advantage of future improvements and functionality.