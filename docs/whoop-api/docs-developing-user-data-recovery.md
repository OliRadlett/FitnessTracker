# Recovery

> Source: https://developer.whoop.com/docs/developing/user-data/recovery

---

# Recovery

WHOOP Recovery is a daily measure of how prepared your body is to perform. When you wake up in the morning, WHOOP
calculates a Recovery score as a percentage between 0 - 100%. The higher the score, the more primed your body is to take
on Strain that day.

In addition to the WHOOP Recovery score, the Recovery object has objective measurements that factored into the
score such as the resting heart rate (RHR), heart rate variability (HRV), and for 4.0 members, blood oxygen (SpO2)
and skin temperature.

## Data Model[â](#data-model "Direct link to Data Model")

|  |  |
| --- | --- |
| cycle\_id required | integer <int64>  The Recovery represents how recovered the user is for this physiological cycle |
| sleep\_id required | string <uuid>  ID of the Sleep associated with the Recovery |
| user\_id required | integer <int64>  The WHOOP User for the recovery |
| created\_at required | string <date-time>  The time the recovery was recorded in WHOOP |
| updated\_at required | string <date-time>  The time the recovery was last updated in WHOOP |
| score\_state required | string  Enum: "SCORED" "PENDING\_SCORE" "UNSCORABLE"  `SCORED` means the recovery was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the cycle. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| score | object (RecoveryScore)  WHOOP's measurements and evaluation of the recovery. Only present if the Recovery State is `SCORED` |

Copy

 Expand all  Collapse all

`{

* "cycle_id": 93845,
* "sleep_id": "123e4567-e89b-12d3-a456-426614174000",
* "user_id": 10129,
* "created_at": "2022-04-24T11:25:44.774Z",
* "updated_at": "2022-04-24T14:25:44.774Z",
* "score_state": "SCORED",
* "score": {
  + "user_calibrating": false,
  + "recovery_score": 44,
  + "resting_heart_rate": 64,
  + "hrv_rmssd_milli": 31.813562,
  + "spo2_percentage": 95.6875,
  + "skin_temp_celsius": 33.7}

}`

Recovery data is available through the Cycle endpoints in the V2 API. See the [API documentation](/api#operation/getCycleById) for details on accessing recovery information through cycles.