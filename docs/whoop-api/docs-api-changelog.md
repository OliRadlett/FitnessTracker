# API Changelog

> Source: https://developer.whoop.com/docs/api-changelog

---

# API Changelog

This changelog highlights notable changes to the WHOOP Developer Platform, such as new API endpoints or webhook event types.

## 2025-11-01[â](#2025-11-01 "Direct link to 2025-11-01")

### Webhook Updates, New V1 Migration API[â](#webhook-updates-new-v1-migration-api "Direct link to Webhook Updates, New V1 Migration API")

Updated webhook documentation to clarify that v1 webhooks are no longer being published. Provided documentation for new activity mapping endpoint to look up historical v1 activity ids.

* **Documentation**: â¨Newâ¨ [v1 -> v2 activity id mapping documentation](/docs/developing/v1-v2-migration#2-lookup-v2-ids-from-v1-ids) for activity v1 id lookups.

## 2025-08-01[â](#2025-08-01 "Direct link to 2025-08-01")

### Webhook Documentation Clarification[â](#webhook-documentation-clarification "Direct link to Webhook Documentation Clarification")

Updated webhook documentation to clarify that v2 recovery webhooks use the UUID of the associated sleep, not the cycle ID.

* **v1 Recovery Webhooks**: Continue to use cycle ID as the identifier
* **v2 Recovery Webhooks**: Use the UUID of the sleep that the recovery is associated with
* **Documentation**: Updated [webhook documentation](/docs/developing/webhooks/) to reflect the correct identifier usage

## 2025-07-01[â](#2025-07-01 "Direct link to 2025-07-01")

### v2 API Launch[â](#v2-api-launch "Direct link to v2 API Launch")

The v2 API is now available, featuring improved data models and new capabilities. All developers are encouraged to migrate from v1.

* **Migration Guide**: A comprehensive [v1 to v2 migration guide](/docs/developing/v1-v2-migration) is available to assist with the transition.

## 2024-05-01[â](#2024-05-01 "Direct link to 2024-05-01")

### Strength Trainer activities[â](#strength-trainer-activities "Direct link to Strength Trainer activities")

Strength Trainer activities are available via the [`/workout`](https://developer.whoop.com/api#tag/Workout) endpoint.

## 2023-02-01[â](#2023-02-01 "Direct link to 2023-02-01")

### De-authorization endpoint[â](#de-authorization-endpoint "Direct link to De-authorization endpoint")

[revokeUserOauthAccess](https://developer.whoop.com/api/#tag/User/operation/revokeUserOAuthAccess) â if a user wants to disable your integration, you can revoke their access token from your application in order to respect their privacy. This will ensure you no longer receive webhooks for this user.

## 2022-09-01[â](#2022-09-01 "Direct link to 2022-09-01")

### Developer Platform Launch ð[â](#developer-platform-launch- "Direct link to Developer Platform Launch ð")

WHOOP releases their Developer Platform! Read more about the launch [here](https://www.whoop.com/thelocker/access-your-whoop-data-with-new-integrations-data-export-options).