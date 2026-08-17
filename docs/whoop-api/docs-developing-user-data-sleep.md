# Sleep

> Source: https://developer.whoop.com/docs/developing/user-data/sleep

---

# Sleep

WHOOP tracks a member's [sleep performance](https://support.whoop.com/s/article/WHOOP-Sleep). You
can view details and measurements about sleep.

**Note:** In addition to the sleep activity that starts a [Cycle](/docs/developing/user-data/cycle), a member can also take *naps*
throughout the Cycle. WHOOP sets the field `nap` to true on a Sleep that is a Nap. Naps reduce the amount of sleep needed by a member for the next Cycle.

## Data Model[â](#data-model "Direct link to Data Model")

|  |  |
| --- | --- |
| id required | string <uuid>  Unique identifier for the sleep activity |
| cycle\_id required | integer <int64>  Unique identifier for the cycle this sleep belongs to |
| v1\_id | integer <int64>  Previous generation identifier for the activity. Will not exist past 09/01/2025 |
| user\_id required | integer <int64>  The WHOOP User who performed the sleep activity |
| created\_at required | string <date-time>  The time the sleep activity was recorded in WHOOP |
| updated\_at required | string <date-time>  The time the sleep activity was last updated in WHOOP |
| start required | string <date-time>  Start time bound of the sleep |
| end required | string <date-time>  End time bound of the sleep |
| timezone\_offset required | string  The user's timezone offset at the time the sleep was recorded. Follows format for Time Zone Designator (TZD) - '+hh:mm', '-hh:mm', or 'Z'.  [Learn more about the Time Zone Designator from the W3C Standard](https://www.w3.org/TR/NOTE-datetime) |
| nap required | boolean  If true, this sleep activity was a nap for the user |
| score\_state required | string  Enum: "SCORED" "PENDING\_SCORE" "UNSCORABLE"  `SCORED` means the sleep activity was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the sleep activity. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| score | object (SleepScore)  WHOOP's measurements and evaluation of the sleep activity. Only present if the Sleep State is `SCORED` |

Copy

 Expand all  Collapse all

`{

* "id": "ecfc6a15-4661-442f-a9a4-f160dd7afae8",
* "cycle_id": 93845,
* "v1_id": 93845,
* "user_id": 10129,
* "created_at": "2022-04-24T11:25:44.774Z",
* "updated_at": "2022-04-24T14:25:44.774Z",
* "start": "2022-04-24T02:25:44.774Z",
* "end": "2022-04-24T10:25:44.774Z",
* "timezone_offset": "-05:00",
* "nap": false,
* "score_state": "SCORED",
* "score": {
  + "stage_summary": {
    - "total_in_bed_time_milli": 30272735,
    - "total_awake_time_milli": 1403507,
    - "total_no_data_time_milli": 0,
    - "total_light_sleep_time_milli": 14905851,
    - "total_slow_wave_sleep_time_milli": 6630370,
    - "total_rem_sleep_time_milli": 5879573,
    - "sleep_cycle_count": 3,
    - "disturbance_count": 12},
  + "sleep_needed": {
    - "baseline_milli": 27395716,
    - "need_from_sleep_debt_milli": 352230,
    - "need_from_recent_strain_milli": 208595,
    - "need_from_recent_nap_milli": -12312},
  + "respiratory_rate": 16.11328125,
  + "sleep_performance_percentage": 98,
  + "sleep_consistency_percentage": 90,
  + "sleep_efficiency_percentage": 91.69533848}

}`