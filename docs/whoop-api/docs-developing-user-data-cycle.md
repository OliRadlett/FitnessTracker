# Cycle

> Source: https://developer.whoop.com/docs/developing/user-data/cycle

---

# Cycle

The human body undergoes a biological rhythm of asleep, awake, asleep, awake. We often think of one repetition within a
calendar day, such as Tuesday, April 19, 2022. However, calendar days and sleep patterns don't always align. Some people work when
other people are sleeping. Some people don't go to sleep for at least 24 hours.

We always reference a member's activity in the context of a Physiological Cycle (known as Cycle for short)
rather than calendar days. When you request a member's latest Cycle, the member's current Cycle will only have a `Start Time`.
Cycles in the past have both a start and end time.

## Data Model[â](#data-model "Direct link to Data Model")

|  |  |
| --- | --- |
| id required | integer <int64>  Unique identifier for the physiological cycle |
| user\_id required | integer <int64>  The WHOOP User for the physiological cycle |
| created\_at required | string <date-time>  The time the cycle was recorded in WHOOP |
| updated\_at required | string <date-time>  The time the cycle was last updated in WHOOP |
| start required | string <date-time>  Start time bound of the cycle |
| end | string <date-time>  End time bound of the cycle. If not present, the user is currently in this cycle |
| timezone\_offset required | string  The user's timezone offset at the time the cycle was recorded. Follows format for Time Zone Designator (TZD) - '+hh:mm', '-hh:mm', or 'Z'.  [Learn more about the Time Zone Designator from the W3C Standard](https://www.w3.org/TR/NOTE-datetime) |
| score\_state required | string  Enum: "SCORED" "PENDING\_SCORE" "UNSCORABLE"  `SCORED` means the cycle was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the cycle. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| score | object (CycleScore)  WHOOP's measurements and evaluation of the cycle. Only present if the score state is `SCORED` |

Copy

 Expand all  Collapse all

`{

* "id": 93845,
* "user_id": 10129,
* "created_at": "2022-04-24T11:25:44.774Z",
* "updated_at": "2022-04-24T14:25:44.774Z",
* "start": "2022-04-24T02:25:44.774Z",
* "end": "2022-04-24T10:25:44.774Z",
* "timezone_offset": "-05:00",
* "score_state": "SCORED",
* "score": {
  + "strain": 5.2951527,
  + "kilojoule": 8288.297,
  + "average_heart_rate": 68,
  + "max_heart_rate": 141}

}`