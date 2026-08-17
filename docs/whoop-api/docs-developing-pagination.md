# Pagination

> Source: https://developer.whoop.com/docs/developing/pagination

---

# Pagination

Collections such as the [Cycle](/api#operation/getCycleCollection)
, [Recovery](/api#operation/getRecoveryCollection), [Sleep](/api#operation/getSleepCollection),
and [Workout](/api#operation/getWorkoutCollection)
Collections can include a large number of records. Responses to queries on the collection may be truncated, but you can
paginate through the results to read the full collection.

The Collection APIs return a token to represent the current page on each response. You send that token on the subsequent
request to retrieve the next page. You iterated through all pages if the `next_token` field is empty on the response.

Using the' limit' header, you can also control how many records the API endpoint returns per page. However, the API
endpoint will not return more than the max allowed value ([API Docs](/api#operation/getCycleCollection) specify the
max value on each endpoint).

## Example[â](#example "Direct link to Example")

Let's query a user's sleep for the first three months of 2022. We make the first request specifying the query parameters
for `start` and `end`.

```text
GET https://api.prod.whoop.com/developer/v1/activity/sleep?start=2022-01-01T00:00:00.000Z&end=2022-04-01T00:00:00.000Z
```

The request returns each sleep in the `records` field and a `next_token`, which we can use on the request to get the
next
page.

```json
{
  "records": [
    {
      ...
    }
  ],
  "next_token": "eyIkIjoib0AxIiwibyI6MTB9"
}
```

The `next_token` can be placed on the subsequent request to fetch the next page of Sleeps using the same query parameters.

```text
GET https://api.prod.whoop.com/developer/v1/activity/sleep?nextToken=eyIkIjoib0AxIiwibyI6MTB9&start=2022-01-01T00:00:00.000Z&end=2022-04-01T00:00:00.000Z
```

You can continue paginating in this manner to retrieve all pages until the `next_token` is empty.