# WHOOP API — OpenAPI Reference

> **Version:** unknown
> **Source:** https://api.prod.whoop.com/developer/doc/openapi.json
> **Downloaded:** 2026-08-17 14:52:02 UTC

## Servers

- `https://api.prod.whoop.com/developer` — 

## Authentication

### OAuth

- **Type:** oauth2
- **Flow:** authorizationCode
  - Authorization URL: `https://api.prod.whoop.com/oauth/oauth2/auth`
  - Token URL: `https://api.prod.whoop.com/oauth/oauth2/token`
  - Scopes:
    - `read:recovery` — Read Recovery data, including score, heart rate variability, and resting heart rate.
    - `read:cycles` — Read cycles data, including day Strain and average heart rate during a physiological cycle.
    - `read:workout` — Read workout data, including activity Strain and average heart rate.
    - `read:sleep` — Read sleep data, including performance % and duration per sleep stage.
    - `read:profile` — Read profile data, including name and email.
    - `read:body_measurement` — Read body measurements data, including height, weight, and max heart rate.

### Trusted Partner

- **Type:** oauth2
- **Flow:** clientCredentials
  - Token URL: `https://api.prod.whoop.com/developer/v2/partner/token`
  - Scopes:
    - `whoop-partner/token` — Read service requests and upload results.

## Endpoints

### Activity ID Mapping

Utility endpoints for activity ID mapping

#### `GET` /v1/activity-mapping/{activityV1Id}

**Get V2 UUID for V1 Activity ID**

Lookup the V2 UUID for a given V1 activity ID

**Operation ID:** `getActivityMapping`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `activityV1Id` | path | integer | ✅ | V1 Activity ID |

**Responses:**

- **200**: Successfully retrieved mapping
  - Schema: [`ActivityIdMappingResponse`](#activityidmappingresponse)
- **404**: Activity mapping not found
- **500**: Server error

---

### Cycle

#### `GET` /v2/cycle/{cycleId}

Get the cycle for the specified ID

**Operation ID:** `getCycleById`

**Required scopes:** `read:cycles`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `cycleId` | path | integer | ✅ | ID of the cycle to retrieve |

**Responses:**

- **200**: Successful request
  - Schema: [`Cycle`](#cycle)
- **400**: Client error constructing the request
- **404**: No resource found
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `GET` /v2/cycle

Get all physiological cycles for a user, paginated. Results are sorted by start time in descending order.

**Operation ID:** `getCycleCollection`

**Required scopes:** `read:cycles`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `limit` | query | integer |  | Limit on the number of cycles returned |
| `start` | query | string |  | Return cycles that occurred after or during (inclusive) this time. If not specified, the response will not filter cycles by a minimum time. |
| `end` | query | string |  | Return cycles that intersect this time or ended before (exclusive) this time. If not specified, `end` will be set to `now`. |
| `nextToken` | query | string |  | Optional next token from the previous response to get the next page. If not provided, the first page in the collection is returned |

**Responses:**

- **200**: Successful request
  - Schema: [`PaginatedCycleResponse`](#paginatedcycleresponse)
- **400**: Client error constructing the request
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `GET` /v2/cycle/{cycleId}/sleep

Get the sleep for the specified cycle ID

**Operation ID:** `getSleepForCycle`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `cycleId` | path | integer | ✅ | ID of the cycle to retrieve sleep for |

**Responses:**

- **200**: Successful request
  - Schema: [`Sleep`](#sleep)
- **400**: Client error constructing the request
- **404**: No resource found
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

### Partner

Endpoints for trusted WHOOP partner operations

#### `POST` /v2/partner/development/add-test-data

**Generate test data for partner development**

Generates test user and lab requisition data for partner integration testing. This endpoint is only available in non-production environments

**Operation ID:** `addTestData`

**Responses:**

- **204**: Test data generated successfully
- **404**: Not available in production environments
- **500**: Failed to generate test data

---

#### `GET` /v2/partner/requisition/{id}

**Get a lab requisition by ID**

Retrieves a lab requisition with its associated service requests by its unique identifier. The requesting partner must be an owner of the lab requisition.

**Operation ID:** `getLabRequisitionById`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | ✅ | Unique identifier of the lab requisition |

**Responses:**

- **200**: Lab requisition found
  - Schema: [`LabRequisition`](#labrequisition)
- **404**: Lab requisition not found or partner is not an owner

---

#### `GET` /v2/partner/service-request/{id}

**Get a service request by ID**

Retrieves a service request by its unique identifier. The requesting partner must be an owner of the service request.

**Operation ID:** `getServiceRequestById`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | ✅ | Unique identifier of the service request |

**Responses:**

- **200**: Service request found
  - Schema: [`ServiceRequest`](#servicerequest)
- **404**: Service request not found or partner is not an owner

---

#### `POST` /v2/partner/token

**Request a partner client token**

Exchanges partner client credentials for an access token.

**Operation ID:** `requestToken`

**Request Body** (`application/json`):

- Schema: [`PartnerTokenRequest`](#partnertokenrequest)

**Responses:**

- **200**: Token issued successfully
  - Schema: [`PartnerTokenResponse`](#partnertokenresponse)
- **401**: Invalid client credentials

---

#### `PATCH` /v2/partner/requisition/{id}/status

**Update lab requisition service request statuses**

Updates the task business status on all service requests belonging to the requisition. The requesting partner must be an owner.

**Operation ID:** `updateLabRequisitionStatus`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | ✅ | Unique identifier of the lab requisition |

**Request Body** (`application/json`):

- Schema: [`ServiceRequestStatusRequest`](#servicerequeststatusrequest)

**Responses:**

- **204**: Service request statuses updated successfully
- **404**: Lab requisition not found or partner is not an owner

---

#### `PATCH` /v2/partner/service-request/{id}/status

**Update service request status**

Updates the business status of a service request task. The requesting partner must be an owner of the service request.

**Operation ID:** `updateServiceRequestStatus`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | ✅ | Unique identifier of the service request |

**Request Body** (`application/json`):

- Schema: [`ServiceRequestStatusRequest`](#servicerequeststatusrequest)

**Responses:**

- **200**: Service request status updated successfully
  - Schema: [`ServiceRequest`](#servicerequest)
- **404**: Service request not found or partner is not an owner

---

#### `POST` /v2/partner/service-request/{id}/results

**Create diagnostic report results for a service request**

Creates a diagnostic report with results for a service request. The requesting partner must be an owner of the service request.

**Operation ID:** `uploadDiagnosticReportResults`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | ✅ | Unique identifier of the service request |

**Request Body** (`application/json`):

- Schema: [`DiagnosticReportCreateRequest`](#diagnosticreportcreaterequest)

**Responses:**

- **201**: Diagnostic report created successfully
- **404**: Service request not found or partner is not an owner

---

### Recovery

#### `GET` /v2/recovery

Get all recoveries for a user, paginated. Results are sorted by start time of the related sleep in descending order.

**Operation ID:** `getRecoveryCollection`

**Required scopes:** `read:recovery`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `limit` | query | integer |  | Limit on the number of recoveries returned |
| `start` | query | string |  | Return recoveries that occurred after or during (inclusive) this time. If not specified, the response will not filter recoveries by a minimum time. |
| `end` | query | string |  | Return recoveries that intersect this time or ended before (exclusive) this time. If not specified, `end` will be set to `now`. |
| `nextToken` | query | string |  | Optional next token from the previous response to get the next page. If not provided, the first page in the collection is returned |

**Responses:**

- **200**: Successful request
  - Schema: [`RecoveryCollection`](#recoverycollection)
- **400**: Client error constructing the request
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `GET` /v2/cycle/{cycleId}/recovery

Get the recovery for a cycle

**Operation ID:** `getRecoveryForCycle`

**Required scopes:** `read:recovery`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `cycleId` | path | integer | ✅ | ID of the cycle to retrieve |

**Responses:**

- **200**: Successful request
  - Schema: [`Recovery`](#recovery)
- **400**: Client error constructing the request
- **404**: No resource found
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

### Sleep

#### `GET` /v2/activity/sleep/{sleepId}

Get the sleep for the specified ID

**Operation ID:** `getSleepById`

**Required scopes:** `read:sleep`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `sleepId` | path | string | ✅ | ID of the sleep to retrieve |

**Responses:**

- **200**: Successful request
  - Schema: [`Sleep`](#sleep)
- **400**: Client error constructing the request
- **404**: No resource found
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `GET` /v2/activity/sleep

Get all sleeps for a user, paginated. Results are sorted by start time in descending order.

**Operation ID:** `getSleepCollection`

**Required scopes:** `read:sleep`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `limit` | query | integer |  | Limit on the number of sleeps returned |
| `start` | query | string |  | Return sleeps that occurred after or during (inclusive) this time. If not specified, the response will not filter sleeps by a minimum time. |
| `end` | query | string |  | Return sleeps that intersect this time or ended before (exclusive) this time. If not specified, `end` will be set to `now`. |
| `nextToken` | query | string |  | Optional next token from the previous response to get the next page. If not provided, the first page in the collection is returned |

**Responses:**

- **200**: Successful request
  - Schema: [`PaginatedSleepResponse`](#paginatedsleepresponse)
- **400**: Client error constructing the request
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

### User

Endpoints for retrieving user profile and measurement data.

#### `GET` /v2/user/measurement/body

**Get User Body Measurements**

Retrieves the body measurements (height, weight, max heart rate) for the authenticated user.

**Operation ID:** `getBodyMeasurement`

**Required scopes:** `read:body_measurement`

**Responses:**

- **200**: Successfully retrieved body measurements
  - Schema: [`UserBodyMeasurement`](#userbodymeasurement)
- **401**: Invalid authorization
- **404**: Requested resource not found
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `GET` /v2/user/profile/basic

**Get Basic User Profile**

Retrieves the basic profile information (name, email) for the authenticated user.

**Operation ID:** `getProfileBasic`

**Required scopes:** `read:profile`

**Responses:**

- **200**: Successfully retrieved user profile
  - Schema: [`UserBasicProfile`](#userbasicprofile)
- **401**: Invalid authorization
- **404**: Requested resource not found
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `DELETE` /v2/user/access

Revoke the access token granted by the user. If the associated OAuth client is configured to receive webhooks, it will no longer receive them for this user.

**Operation ID:** `revokeUserOAuthAccess`

**Responses:**

- **204**: Successful request; no response body
- **400**: Client error constructing the request
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

### Workout

#### `GET` /v2/activity/workout/{workoutId}

Get the workout for the specified ID

**Operation ID:** `getWorkoutById`

**Required scopes:** `read:workout`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `workoutId` | path | string | ✅ | ID of the workout to retrieve |

**Responses:**

- **200**: Successful request
  - Schema: [`WorkoutV2`](#workoutv2)
- **400**: Client error constructing the request
- **404**: No resource found
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

#### `GET` /v2/activity/workout

Get all workouts for a user, paginated. Results are sorted by start time in descending order.

**Operation ID:** `getWorkoutCollection`

**Required scopes:** `read:workout`

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `limit` | query | integer |  | Limit on the number of workouts returned |
| `start` | query | string |  | Return workouts that occurred after or during (inclusive) this time. If not specified, the response will not filter workouts by a minimum time. |
| `end` | query | string |  | Return workouts that intersect this time or ended before (exclusive) this time. If not specified, `end` will be set to `now`. |
| `nextToken` | query | string |  | Optional next token from the previous response to get the next page. If not provided, the first page in the collection is returned |

**Responses:**

- **200**: Successful request
  - Schema: [`WorkoutCollection`](#workoutcollection)
- **400**: Client error constructing the request
- **401**: Invalid authorization
- **429**: Request rejected due to rate limiting
- **500**: Server error occurred while making request

---

## Data Models (Schemas)

### ActivityIdMappingResponse

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `v2_activity_id` | string (uuid) | ✅ | V2 Unique identifier for the activity |

---

### Appointment

Appointment information

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `start_time` | string (date-time) | ✅ | The start time of the appointment |
| `service_request_ids` | array of string | ✅ | The service request IDs associated with this appointment |

---

### CreateObservationRequest

optional list of observations to attach to the diagnostic report

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `value_numeric` | number (double) |  | the decimal value for this observation, if there is one |
| `value_text` | string |  | the text value for this observation, if there is one |
| `unit` | string |  | the unit of this observation value, if there is one |
| `status` | string |  | the status of this observation |
| `code` | string |  | the code for this observation |

---

### Cycle

The collection of records in this page.

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | integer (int64) | ✅ | Unique identifier for the physiological cycle |
| `user_id` | integer (int64) | ✅ | The WHOOP User for the physiological cycle |
| `created_at` | string (date-time) | ✅ | The time the cycle was recorded in WHOOP |
| `updated_at` | string (date-time) | ✅ | The time the cycle was last updated in WHOOP |
| `start` | string (date-time) | ✅ | Start time bound of the cycle |
| `end` | string (date-time) |  | End time bound of the cycle. If not present, the user is currently in this cycle |
| `timezone_offset` | string | ✅ | The user's timezone offset at the time the cycle was recorded. Follows format for Time Zone Designator (TZD) - '+hh:mm', '-hh:mm', or 'Z'. |
| `score_state` | string (enum: SCORED, PENDING_SCORE, UNSCORABLE) | ✅ | `SCORED` means the cycle was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the cycle. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| `score` | CycleScore |  |  |

---

### CycleScore

WHOOP's measurements and evaluation of the cycle. Only present if the score state is `SCORED`

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `strain` | number (float) | ✅ | WHOOP metric of the cardiovascular load - the level of strain  on the user's cardiovascular system based on the user's heart rate during the cycle. Strain is scored on a scale from 0 to 21. |
| `kilojoule` | number (float) | ✅ | Kilojoules the user expended during the cycle. |
| `average_heart_rate` | integer (int32) | ✅ | The user's average heart rate during the cycle. |
| `max_heart_rate` | integer (int32) | ✅ | The user's max heart rate during the cycle. |

---

### DiagnosticReportCreateRequest

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `status` | string |  | the status of the diagnostic report |
| `observations` | array of CreateObservationRequest |  | optional list of observations to attach to the diagnostic report |

---

### LabRequisition

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (uuid) | ✅ | Unique identifier for the lab requisition |
| `created_at` | string (date-time) | ✅ | Timestamp when the lab requisition was created |
| `updated_at` | string (date-time) | ✅ | Timestamp when the lab requisition was last updated |
| `service_requests` | array of ServiceRequest | ✅ | The service requests associated with this lab requisition |
| `patient` | PatientCore | ✅ |  |
| `appointments` | array of Appointment | ✅ | The appointments associated with this lab requisition |

---

### PaginatedCycleResponse

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `records` | array of Cycle |  | The collection of records in this page. |
| `next_token` | string |  | A token that can be used on the next request to access the next page of records. If the token is not present, there are no more records in the collection. |

---

### PaginatedSleepResponse

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `records` | array of Sleep |  | The collection of records in this page. |
| `next_token` | string |  | A token that can be used on the next request to access the next page of records. If the token is not present, there are no more records in the collection. |

---

### PartnerTokenRequest

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `client_id` | string | ✅ | client id for this partner |
| `client_secret` | string | ✅ |  |
| `scope` | string |  | scope for this token request |
| `grant_type` | string |  | grant type for this token request |

---

### PartnerTokenResponse

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `access_token` | string |  |  |
| `expires_in` | integer (int32) |  |  |
| `token_type` | string |  |  |

---

### Patient

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (uuid) | ✅ | Unique identifier for the patient |

---

### PatientCore

Patient information

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (uuid) | ✅ | Unique identifier for the patient |

---

### Recovery

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `cycle_id` | integer (int64) | ✅ | The Recovery represents how recovered the user is for this physiological cycle |
| `sleep_id` | string (uuid) | ✅ | ID of the Sleep associated with the Recovery |
| `user_id` | integer (int64) | ✅ | The WHOOP User for the recovery |
| `created_at` | string (date-time) | ✅ | The time the recovery was recorded in WHOOP |
| `updated_at` | string (date-time) | ✅ | The time the recovery was last updated in WHOOP |
| `score_state` | string (enum: SCORED, PENDING_SCORE, UNSCORABLE) | ✅ | `SCORED` means the recovery was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the cycle. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| `score` | RecoveryScore |  |  |

---

### RecoveryCollection

Paginated collection of recovery activities with next token for pagination

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `records` | array of Recovery |  | The collection of records in this page. |
| `next_token` | string |  | A token that can be used on the next request to access the next page of records. If the token is not present, there are no more records in the collection. |

---

### RecoveryScore

WHOOP's measurements and evaluation of the recovery. Only present if the Recovery State is `SCORED`

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `user_calibrating` | boolean | ✅ | True if the user is still calibrating and not enough data is available in WHOOP to provide an accurate recovery. |
| `recovery_score` | number (float) | ✅ | Percentage (0-100%) that reflects how well prepared the user's body is to take on Strain. The Recovery score is a measure of the user body's "return to baseline" after a stressor. |
| `resting_heart_rate` | number (float) | ✅ | The user's resting heart rate. |
| `hrv_rmssd_milli` | number (float) | ✅ | The user's Heart Rate Variability measured using Root Mean Square of Successive Differences (RMSSD), in milliseconds. |
| `spo2_percentage` | number (float) |  | The percentage of oxygen in the user's blood. Only present if the user is on 4.0 or greater. |
| `skin_temp_celsius` | number (float) |  | The user's skin temperature, in Celsius. Only present if the user is on 4.0 or greater. |

---

### ServiceRequest

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (uuid) | ✅ | Unique identifier for the service request |
| `status` | string | ✅ | FHIR status of the service request |
| `intent` | string | ✅ | FHIR intent of the service request |
| `code` | string | ✅ | Code identifying the specific service or procedure requested |
| `task_business_status` | string |  | Task business status for workflow tracking (e.g., 'Specimen collected', 'Results pending') |
| `task_description` | string |  | Task description - free text explanation of what needs to be performed |

---

### ServiceRequestStatusRequest

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `task_business_status` | string |  | Task business status for workflow tracking (e.g., 'Specimen collected', 'Results pending') |
| `reason` | string |  | Optional reason for the task business status change |

---

### Sleep

The collection of records in this page.

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (uuid) | ✅ | Unique identifier for the sleep activity |
| `cycle_id` | integer (int64) | ✅ | Unique identifier for the cycle this sleep belongs to |
| `v1_id` | integer (int64) |  | Previous generation identifier for the activity. Will not exist past 09/01/2025 |
| `user_id` | integer (int64) | ✅ | The WHOOP User who performed the sleep activity |
| `created_at` | string (date-time) | ✅ | The time the sleep activity was recorded in WHOOP |
| `updated_at` | string (date-time) | ✅ | The time the sleep activity was last updated in WHOOP |
| `start` | string (date-time) | ✅ | Start time bound of the sleep |
| `end` | string (date-time) | ✅ | End time bound of the sleep |
| `timezone_offset` | string | ✅ | The user's timezone offset at the time the sleep was recorded. Follows format for Time Zone Designator (TZD) - '+hh:mm', '-hh:mm', or 'Z'. |
| `nap` | boolean | ✅ | If true, this sleep activity was a nap for the user |
| `score_state` | string (enum: SCORED, PENDING_SCORE, UNSCORABLE) | ✅ | `SCORED` means the sleep activity was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the sleep activity. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| `score` | SleepScore |  |  |

---

### SleepNeeded

Breakdown of the amount of sleep a user needed before the sleep activity. Summing all individual components results in the amount of sleep the user needed prior to this sleep activity

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `baseline_milli` | integer (int64) | ✅ | The amount of sleep a user needed based on historical trends |
| `need_from_sleep_debt_milli` | integer (int64) | ✅ | The difference between the amount of sleep the user's body required and the amount the user actually got |
| `need_from_recent_strain_milli` | integer (int64) | ✅ | Additional sleep need accrued based on the user's strain |
| `need_from_recent_nap_milli` | integer (int64) | ✅ | Reduction in sleep need accrued based on the user's recent nap activity (negative value or zero) |

---

### SleepScore

WHOOP's measurements and evaluation of the sleep activity. Only present if the Sleep State is `SCORED`

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `stage_summary` | SleepStageSummary | ✅ |  |
| `sleep_needed` | SleepNeeded | ✅ |  |
| `respiratory_rate` | number (float) |  | The user's respiratory rate during the sleep. |
| `sleep_performance_percentage` | number (float) |  | A percentage (0-100%) of the time a user is asleep over the amount of sleep the user needed. May not be reported if WHOOP does not have enough data about a user yet to calculate Sleep Need. |
| `sleep_consistency_percentage` | number (float) |  | Percentage (0-100%) of how similar this sleep and wake times compared to the previous day. May not be reported if WHOOP does not have enough sleep data about a user yet to understand consistency. |
| `sleep_efficiency_percentage` | number (float) |  | A percentage (0-100%) of the time you spend in bed that you are actually asleep. |

---

### SleepStageSummary

Summary of the sleep stages

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `total_in_bed_time_milli` | integer (int32) | ✅ | Total time the user spent in bed, in milliseconds |
| `total_awake_time_milli` | integer (int32) | ✅ | Total time the user spent awake, in milliseconds |
| `total_no_data_time_milli` | integer (int32) | ✅ | Total time WHOOP did not receive data from the user during the sleep, in milliseconds |
| `total_light_sleep_time_milli` | integer (int32) | ✅ | Total time the user spent in light sleep, in milliseconds |
| `total_slow_wave_sleep_time_milli` | integer (int32) | ✅ | Total time the user spent in Slow Wave Sleep (SWS), in milliseconds |
| `total_rem_sleep_time_milli` | integer (int32) | ✅ | Total time the user spent in Rapid Eye Movement (REM) sleep, in milliseconds |
| `sleep_cycle_count` | integer (int32) | ✅ | Number of sleep cycles during the user's sleep |
| `disturbance_count` | integer (int32) | ✅ | Number of times the user was disturbed during sleep |

---

### UnilabsAppointment

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `slot_id` | string |  | External slot identifier used when booking the appointment |
| `collection_address` | UnilabsCollectionAddress |  |  |
| `service_request_ids` | array of string | ✅ | The service request IDs associated with this appointment |
| `start_time` | string (date-time) | ✅ | The start time of the appointment |

---

### UnilabsCollectionAddress

The collection address for this appointment

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `building` | string | ✅ | Building name or number |
| `area` | string | ✅ | Area or district |
| `emirate` | string | ✅ | Emirate |
| `landmark` | string |  | Nearby landmark |
| `flat_no` | string |  | Flat or apartment number |

---

### UnilabsPatient

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `first_name` | string | ✅ | First name of the patient |
| `last_name` | string | ✅ | Last name of the patient |
| `birth_date` | string (date) | ✅ | Birth date of the patient |
| `gender` | string |  | Gender of the patient |
| `email` | string |  | Email address of the patient |
| `phone` | string |  | Phone number of the patient |
| `nationality` | string |  | Nationality of the patient |
| `id` | string (uuid) | ✅ | Unique identifier for the patient |
| `emirates_id` | string |  | Emirates ID of the patient |
| `passport_no` | string |  | Passport number of the patient |

---

### UserBasicProfile

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `user_id` | integer (int64) | ✅ | The WHOOP User |
| `email` | string | ✅ | User's Email |
| `first_name` | string | ✅ | User's First Name |
| `last_name` | string | ✅ | User's Last Name |

---

### UserBodyMeasurement

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `height_meter` | number (float) | ✅ | User's height in meters |
| `weight_kilogram` | number (float) | ✅ | User's weight in kilograms |
| `max_heart_rate` | integer (int32) | ✅ | The max heart rate WHOOP calculated for the user |

---

### WorkoutCollection

Paginated collection of workout activities with next token for pagination

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `records` | array of WorkoutV2 |  | The collection of records in this page. |
| `next_token` | string |  | A token that can be used on the next request to access the next page of records. If the token is not present, there are no more records in the collection. |

---

### WorkoutScore

WHOOP's measurements and evaluation of the workout activity. Only present if the Workout State is `SCORED`

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `strain` | number (float) | ✅ | WHOOP metric of the cardiovascular load - the level of strain the workout had on the user's cardiovascular system based on the user's heart rate. Strain is scored on a scale from 0 to 21. |
| `average_heart_rate` | integer (int32) | ✅ | The user's average heart rate (beats per minute) during the workout. |
| `max_heart_rate` | integer (int32) | ✅ | The user's max heart rate (beats per minute) during the workout. |
| `kilojoule` | number (float) | ✅ | Kilojoules the user expended during the workout. |
| `percent_recorded` | number (float) | ✅ | Percentage (0-100%) of heart rate data WHOOP received during the workout. |
| `distance_meter` | number (float) |  | The distance the user travelled during the workout. Only present if distance data sent to WHOOP |
| `altitude_gain_meter` | number (float) |  | The altitude gained during the workout. This measurement does not account for downward travel - it is strictly a measure of altitude climbed. If a member climbed up and down a 1,000 meter mountain, ending at the same altitude, this measurement would be 1,000 meters. Only present if altitude data is included as part of the workout |
| `altitude_change_meter` | number (float) |  | The altitude difference between the start and end points of the workout. If a member climbed up and down a mountain, ending at the same altitude, this measurement would be 0. Only present if altitude data is included as part of the workout |
| `zone_durations` | ZoneDurations | ✅ |  |

---

### WorkoutV2

A WHOOP workout activity with full details and scoring information

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (uuid) | ✅ | Unique identifier for the workout activity |
| `v1_id` | integer (int64) |  | Previous generation identifier for the activity. Will not exist past 09/01/2025 |
| `user_id` | integer (int64) | ✅ | The WHOOP User who performed the workout |
| `created_at` | string (date-time) | ✅ | The time the workout activity was recorded in WHOOP |
| `updated_at` | string (date-time) | ✅ | The time the workout activity was last updated in WHOOP |
| `start` | string (date-time) | ✅ | Start time bound of the workout |
| `end` | string (date-time) | ✅ | End time bound of the workout |
| `timezone_offset` | string | ✅ | The user's timezone offset at the time the workout was recorded. Follows format for Time Zone Designator (TZD) - '+hh:mm', '-hh:mm', or 'Z'. |
| `sport_name` | string | ✅ | Name of the WHOOP Sport performed during the workout |
| `score_state` | string (enum: SCORED, PENDING_SCORE, UNSCORABLE) | ✅ | `SCORED` means the workout activity was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the workout activity. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| `score` | WorkoutScore |  |  |
| `sport_id` | integer (int32) |  | ID of the WHOOP Sport performed during the workout. Will not exist past 09/01/2025 |

---

### ZoneDurations

Breakdown of time spent in each heart rate zone during the workout.

**Type:** object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `zone_zero_milli` | integer (int64) | ✅ | Duration in milliseconds spent in Zone 0 (very light activity) |
| `zone_one_milli` | integer (int64) | ✅ | Duration in milliseconds spent in Zone 1 (light activity) |
| `zone_two_milli` | integer (int64) | ✅ | Duration in milliseconds spent in Zone 2 (moderate activity) |
| `zone_three_milli` | integer (int64) | ✅ | Duration in milliseconds spent in Zone 3 (hard activity) |
| `zone_four_milli` | integer (int64) | ✅ | Duration in milliseconds spent in Zone 4 (very hard activity) |
| `zone_five_milli` | integer (int64) | ✅ | Duration in milliseconds spent in Zone 5 (maximum effort) |

---
