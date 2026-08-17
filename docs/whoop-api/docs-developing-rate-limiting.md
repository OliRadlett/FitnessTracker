# API Rate Limiting

> Source: https://developer.whoop.com/docs/developing/rate-limiting

---

# API Rate Limiting

All clients are subject to two sets of rate limiting for requests. By default,
clients may only send:

* 100 requests per minute.
* 10,000 requests per day.

Rate Limit Increases

Upon request, WHOOP can increase your rate limits. Open your app in the [Developer Dashboard](https://developer-dashboard.whoop.com), click **Open Request**, and choose **Rate limit increase**. Be sure to include details surrounding your request.

## Rate Limit Information[â](#rate-limit-information "Direct link to Rate Limit Information")

Information about current rate limits is provided in response headers, following this
[specification](https://datatracker.ietf.org/doc/id/draft-polli-ratelimit-headers-05.html#name-header-specifications).

You may see response headers that look like the following:

```text
X-RateLimit-Limit = "100, 100;window=60, 10000;window=86400"
X-RateLimit-Remaining = "98"
X-RateLimit-Reset = "3"
```

### X-RateLimit-Limit[â](#x-ratelimit-limit "Direct link to X-RateLimit-Limit")

This value expresses the current values for the rate-limiting and over what
[time window](https://datatracker.ietf.org/doc/id/draft-polli-ratelimit-headers-05.html#name-time-window).

The example here is using the default rate limits. The client has not reached any limit yet and is
closest to hitting the `minute` window (versus the `day` window). The first number (`100`) states the
limit the client is closest to hitting. The time window is in seconds. `100;window=60` describes the first
rate limit of 100 requests per minute (60 seconds). `10000;window=86400` represents a rate limit of 10,000 requests over
a 24-hour (86,400 seconds) period.

### X-RateLimit-Remaining[â](#x-ratelimit-remaining "Direct link to X-RateLimit-Remaining")

`X-RateLimit-Remaining` is the number of requests that your app may execute within
the [time window](https://datatracker.ietf.org/doc/id/draft-polli-ratelimit-headers-05.html#name-time-window)
before WHOOP will reject subsequent requests. In this case, the client is closest to hitting the minute
limit of 100, so `X-RateLimit-Remaining: 98` means the client can make 98 more requests in that minute. In other words,
the client only made two requests in the current minute.

### X-RateLimit-Reset[â](#x-ratelimit-reset "Direct link to X-RateLimit-Reset")

`X-RateLimit-Reset` is the number of seconds that need to elapse before the `X-RateLimit-Remaining` header resets. In
this case, the client is closest to hitting the minute limit of 100 so
the `X-RateLimit-Reset` header corresponds to that limit precisely.

## Rate Limited Response[â](#rate-limited-response "Direct link to Rate Limited Response")

After an API key's rate limit has been reached or exceeded, WHOOP's servers will respond with
a `429 - Too Many Requests` HTTP status code.