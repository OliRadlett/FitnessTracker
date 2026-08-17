# Get Current Recovery Score

> Source: https://developer.whoop.com/docs/tutorials/get-current-recovery-score

---

# Get Current Recovery Score

This example will use the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
to make an HTTP request to WHOOP's server.

## Prerequisites[â](#prerequisites "Direct link to Prerequisites")

* Access Token: The token received after completing the OAuth 2.0 flow. Your app must pass the Access Token as a Bearer token in the `Authorization` header.
* The Access Token is granted permission to `read:cycles` and `read:recovery` OAuth scopes.

## Overview[â](#overview "Direct link to Overview")

The process of getting a user's current recovery score requires two steps:

* Get the user's current Cycle. ([API Docs](/api#operation/getCycleCollection))
* Get the user's Recovery for the current Cycle if one exists. ([API Docs](/api#operation/getRecoveryForCycle))

These two steps are required because every Cycle is not guaranteed to have a Recovery score. For example, the user may not have worn
their WHOOP the previous day. In this scenario, the Recovery score will be missing for the Cycle.

## Get the User's Current Cycle[â](#get-the-users-current-cycle "Direct link to Get the User's Current Cycle")

Let's start by getting the current Cycle. The Cycle Collection is sorted by time in descending order, so making a
request with `limit=1` will give us the latest Cycle.

```javascript
const accessToken = "__ACCESS_TOKEN_FOR_USER__";

query = new URLSearchParams({
  limit: "1",
});
```

We will append those parameters as query param values to our GET request.

```javascript
const getCurrentCycle = async (accessToken, query) => {
  const uri = `https://api.prod.whoop.com/developer/v1/cycle?${query}`;

  const cycleResponse = await fetch(uri, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (cycleResponse.status === 200) {
    return cycleResponse.json();
  } else {
    throw new Error(`Received ${cycleResponse.status} status from Whoop`);
  }
};
```

### Response[â](#response "Direct link to Response")

The response will include an array of Cycles, which should have precisely one if the user has at least one Cycle (new users
may not have a Cycle yet, so check there is at least one in the array). You will need the `cycle_id` from the latest cycle
for the next step.

|  |  |
| --- | --- |
| records | Array of objects (Cycle) [ items ]  The collection of records in this page. |
| next\_token | string  A token that can be used on the next request to access the next page of records. If the token is not present, there are no more records in the collection. |

Copy

 Expand all  Collapse all

`{

* "records": [
  + {
    - "id": 93845,
    - "user_id": 10129,
    - "created_at": "2022-04-24T11:25:44.774Z",
    - "updated_at": "2022-04-24T14:25:44.774Z",
    - "start": "2022-04-24T02:25:44.774Z",
    - "end": "2022-04-24T10:25:44.774Z",
    - "timezone_offset": "-05:00",
    - "score_state": "SCORED",
    - "score": {
      * "strain": 5.2951527,
      * "kilojoule": 8288.297,
      * "average_heart_rate": 68,
      * "max_heart_rate": 141}}],
* "next_token": "MTIzOjEyMzEyMw"

}`

## Get Recovery for Cycle[â](#get-recovery-for-cycle "Direct link to Get Recovery for Cycle")

With the latest Cycle, we can now get the Recovery score for the Cycle if one exists. Before using the Recovery score,
there are a few things you should consider:

* Not every Cycle has a Recovery - the user may not have worn their strap the previous day.
* New users may be calibrating. New users require calibration before the Recovery score is relevant to them. The calibration period lasts a few
  days for new users. You can use the field `user_calibrating` to check if the user is still in the calibration phase.
* WHOOP may not be able to score every Recovery - you should check if the `score_state` is `SCORED`. If the `score_state` is `PENDING_SCORE`, you will
  need to check back later. If the `score_state` is `UNSCORABLE`, a Recovery Score cannot be calculated by WHOOP for this user's Cycle.

```javascript
const getRecoveryForCycle: = async (accessToken, cycleId) => {
    const uri = `https://api.prod.whoop.com/developer/v1/cycle/${cycleId}/recovery`

    const recoveryResponse = await fetch(uri, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    })

    if (recoveryResponse.status === 200) {
        return recoveryResponse.json()
    } else if (recoveryResponse.status === 404) {
        return null
    } else {
        throw new Error(`Received ${recoveryResponse.status} status from Whoop`)
    }
}
```

### Response[â](#response-1 "Direct link to Response")

Upon success, the API should return a 200 HTTP status or 404 if a Recovery does not exist for the current cycle. Remember
not all Cycles will have a Recovery.

Recovery data is included in the Cycle response. See the [Cycle schema](/api#operation/getCycleById) for the complete data structure.

## Congratulations[â](#congratulations "Direct link to Congratulations")

You have now received Recovery data for the current Cycle.