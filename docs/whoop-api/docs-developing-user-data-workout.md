# Workout

> Source: https://developer.whoop.com/docs/developing/user-data/workout

---

WHOOP keeps track of what type of activity you performed (e.g., Running, Cycling), Strain score, and other
physiological measurements such as duration in [Heart Rate Zones](https://www.whoop.com/thelocker/max-heart-rate-training-zones/).

## Data Model[â](#data-model "Direct link to Data Model")

|  |  |
| --- | --- |
| id required | string <uuid>  Unique identifier for the workout activity |
| v1\_id | integer <int64>  Previous generation identifier for the activity. Will not exist past 09/01/2025 |
| user\_id required | integer <int64>  The WHOOP User who performed the workout |
| created\_at required | string <date-time>  The time the workout activity was recorded in WHOOP |
| updated\_at required | string <date-time>  The time the workout activity was last updated in WHOOP |
| start required | string <date-time>  Start time bound of the workout |
| end required | string <date-time>  End time bound of the workout |
| timezone\_offset required | string  The user's timezone offset at the time the workout was recorded. Follows format for Time Zone Designator (TZD) - '+hh:mm', '-hh:mm', or 'Z'.  [Learn more about the Time Zone Designator from the W3C Standard](https://www.w3.org/TR/NOTE-datetime) |
| sport\_name required | string  Name of the WHOOP Sport performed during the workout |
| score\_state required | string  Enum: "SCORED" "PENDING\_SCORE" "UNSCORABLE"  `SCORED` means the workout activity was scored and the measurement values will be present. `PENDING_SCORE` means WHOOP is currently evaluating the workout activity. `UNSCORABLE` means this activity could not be scored for some reason - commonly because there is not enough user metric data for the time range. |
| score | object (WorkoutScore)  WHOOP's measurements and evaluation of the workout activity. Only present if the Workout State is `SCORED` |
| sport\_id | integer <int32>  ID of the WHOOP Sport performed during the workout. Will not exist past 09/01/2025 |

Copy

 Expand all  Collapse all

`{

* "id": "ecfc6a15-4661-442f-a9a4-f160dd7afae8",
* "v1_id": 1043,
* "user_id": 9012,
* "created_at": "2022-04-24T11:25:44.774Z",
* "updated_at": "2022-04-24T14:25:44.774Z",
* "start": "2022-04-24T02:25:44.774Z",
* "end": "2022-04-24T10:25:44.774Z",
* "timezone_offset": "-05:00",
* "sport_name": "running",
* "score_state": "SCORED",
* "score": {
  + "strain": 8.2463,
  + "average_heart_rate": 123,
  + "max_heart_rate": 146,
  + "kilojoule": 1569.34033203125,
  + "percent_recorded": 100,
  + "distance_meter": 1772.77035916,
  + "altitude_gain_meter": 46.64384460449,
  + "altitude_change_meter": -0.781372010707855,
  + "zone_durations": {
    - "zone_zero_milli": 300000,
    - "zone_one_milli": 600000,
    - "zone_two_milli": 900000,
    - "zone_three_milli": 900000,
    - "zone_four_milli": 600000,
    - "zone_five_milli": 300000}},
* "sport_id": 1

}`

## WHOOP Sports[â](#whoop-sports "Direct link to WHOOP Sports")

| Sport ID | Sport |
| --- | --- |
| -1 | Activity |
| 0 | Running |
| 1 | Cycling |
| 16 | Baseball |
| 17 | Basketball |
| 18 | Rowing |
| 19 | Fencing |
| 20 | Field Hockey |
| 21 | Football |
| 22 | Golf |
| 24 | Ice Hockey |
| 25 | Lacrosse |
| 27 | Rugby |
| 28 | Sailing |
| 29 | Skiing |
| 30 | Soccer |
| 31 | Softball |
| 32 | Squash |
| 33 | Swimming |
| 34 | Tennis |
| 35 | Track & Field |
| 36 | Volleyball |
| 37 | Water Polo |
| 38 | Wrestling |
| 39 | Boxing |
| 42 | Dance |
| 43 | Pilates |
| 44 | Yoga |
| 45 | Weightlifting |
| 47 | Cross Country Skiing |
| 48 | Functional Fitness |
| 49 | Duathlon |
| 51 | Gymnastics |
| 52 | Hiking/Rucking |
| 53 | Horseback Riding |
| 55 | Kayaking |
| 56 | Martial Arts |
| 57 | Mountain Biking |
| 59 | Powerlifting |
| 60 | Rock Climbing |
| 61 | Paddleboarding |
| 62 | Triathlon |
| 63 | Walking |
| 64 | Surfing |
| 65 | Elliptical |
| 66 | Stairmaster |
| 70 | Meditation |
| 71 | Other |
| 73 | Diving |
| 74 | Operations - Tactical |
| 75 | Operations - Medical |
| 76 | Operations - Flying |
| 77 | Operations - Water |
| 82 | Ultimate |
| 83 | Climber |
| 84 | Jumping Rope |
| 85 | Australian Football |
| 86 | Skateboarding |
| 87 | Coaching |
| 88 | Ice Bath |
| 89 | Commuting |
| 90 | Gaming |
| 91 | Snowboarding |
| 92 | Motocross |
| 93 | Caddying |
| 94 | Obstacle Course Racing |
| 95 | Motor Racing |
| 96 | HIIT |
| 97 | Spin |
| 98 | Jiu Jitsu |
| 99 | Manual Labor |
| 100 | Cricket |
| 101 | Pickleball |
| 102 | Inline Skating |
| 103 | Box Fitness |
| 104 | Spikeball |
| 105 | Wheelchair Pushing |
| 106 | Paddle Tennis |
| 107 | Barre |
| 108 | Stage Performance |
| 109 | High Stress Work |
| 110 | Parkour |
| 111 | Gaelic Football |
| 112 | Hurling/Camogie |
| 113 | Circus Arts |
| 121 | Massage Therapy |
| 123 | Strength Trainer |
| 125 | Watching Sports |
| 126 | Assault Bike |
| 127 | Kickboxing |
| 128 | Stretching |
| 230 | Table Tennis |
| 231 | Badminton |
| 232 | Netball |
| 233 | Sauna |
| 234 | Disc Golf |
| 235 | Yard Work |
| 236 | Air Compression |
| 237 | Percussive Massage |
| 238 | Paintball |
| 239 | Ice Skating |
| 240 | Handball |
| 248 | F45 Training |
| 249 | Padel |
| 250 | Barry's |
| 251 | Dedicated Parenting |
| 252 | Stroller Walking |
| 253 | Stroller Jogging |
| 254 | Toddlerwearing |
| 255 | Babywearing |
| 258 | Barre3 |
| 259 | Hot Yoga |
| 261 | Stadium Steps |
| 262 | Polo |
| 263 | Musical Performance |
| 264 | Kite Boarding |
| 266 | Dog Walking |
| 267 | Water Skiing |
| 268 | Wakeboarding |
| 269 | Cooking |
| 270 | Cleaning |
| 272 | Public Speaking |