# User

> Source: https://developer.whoop.com/docs/developing/user-data/user

---

# User

## Basic Profile[â](#basic-profile "Direct link to Basic Profile")

Profile information about the user, such as their email and name.

### Data Model[â](#data-model "Direct link to Data Model")

|  |  |
| --- | --- |
| user\_id required | integer <int64>  The WHOOP User |
| email required | string  User's Email |
| first\_name required | string  User's First Name |
| last\_name required | string  User's Last Name |

Copy

`{

* "user_id": 10129,
* "email": "jsmith123@whoop.com",
* "first_name": "John",
* "last_name": "Smith"

}`

## Body Measurements[â](#body-measurements "Direct link to Body Measurements")

Body measurements about the user, such as their weight and height.

### Data Model[â](#data-model-1 "Direct link to Data Model")

|  |  |
| --- | --- |
| height\_meter required | number <float>  User's height in meters |
| weight\_kilogram required | number <float>  User's weight in kilograms |
| max\_heart\_rate required | integer <int32>  The max heart rate WHOOP calculated for the user  [WHOOP Locker: Understanding Max Heart Rate and Why It Matters for Training](https://www.whoop.com/thelocker/calculating-max-heart-rate/) |

Copy

`{

* "height_meter": 1.8288,
* "weight_kilogram": 90.7185,
* "max_heart_rate": 200

}`