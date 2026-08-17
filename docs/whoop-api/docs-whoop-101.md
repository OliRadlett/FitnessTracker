# WHOOP 101

> Source: https://developer.whoop.com/docs/whoop-101

---

# WHOOP 101

WHOOP is a 24/7 wearable that helps members understand how well their bodies function and how they change over time.
Through continuous monitoring of physiological signals, WHOOP helps members understand how well their body performs
and recovers. As a developer, you have the opportunity to build integrations that leverage WHOOP insights across three
pillars - **Strain, Recovery, and Sleep**.

This guide will provide you with an overview of the core concepts powering WHOOP to get you ready to build your
app.

## Strain[â](#strain "Direct link to Strain")

WHOOP Strain is a measurement of the amount of stress on your body. The Strain score is a number on a 0 to 21 scale,
based on the [Borg Scale of Perceived Exertion](https://www.whoop.com/thelocker/borg-scale-perceived-exertion-rpe/).
WHOOP scores Strain continuously for members throughout the day and every workout.

**Note:** *Strain is not on a linear scale. It takes more stress to move from a score of **16 to 17**
than **4 to 5**.*

Your body is constantly changing, and each day is different. If you do the same workout two days in a row, you
will likely report different Strain scores based on fluctuations in how your body recovered and changed. Strain is also
specific to your baseline. Two people making the same motions will likely generate different Strain
scores.

WHOOP categorizes Strain score values into Light, Moderate, High, and All Out.

* **Light Strain (0-9)** - This strain category indicates room for active recovery with minimal stress on the
  body.
* **Moderate Strain (10-13)** - This category indicates moderate stress on the body, which helps maintain
  fitness.
* **High Strain (14-17)** - This category indicates increased stress which helps build fitness gains in
  your training.
* **All Out (18-21)** - This category indicates all-out training or a packed activity day that puts significant stress
  on
  the body and may be difficult to recover from the day after.

Want to learn more?

* [WHOOP Strain](https://support.whoop.com/s/article/WHOOP-Strain)
* [How Does WHOOP Strain Work?](https://www.whoop.com/thelocker/how-does-whoop-strain-work-101/)
* [Why Doesn't WHOOP Count Steps?](https://www.whoop.com/thelocker/dont-count-steps-strain/)
* [Podcast No. 26: Understanding Strain](https://www.whoop.com/thelocker/podcast-26-understanding-strain/)

### Workout Activity[â](#workout-activity "Direct link to Workout Activity")

WHOOP tracks workouts for you and how much Strain accumulated over the workout. You can create workout activities
manually, import them from other sources
like [Apple Health](https://support.whoop.com/s/article/Apple-Health-Integration),
or [WHOOP may automatically detect and classify workouts](https://www.whoop.com/thelocker/activity-auto-detection-knows-you-work-out/)
.

WHOOP keeps track of what type of activity you performed (e.g., Running, Cycle), Strain score, and other
physiological measurements such as duration
in [Heart Rate Zones](https://www.whoop.com/thelocker/max-heart-rate-training-zones/).

## Recovery[â](#recovery "Direct link to Recovery")

WHOOP Recovery is a daily measure of how prepared your body is to perform. When you wake up in the morning, WHOOP
calculates a Recovery score as a percentage between 0 - 100%. The higher the score, the more primed your body is to take
on Strain that day.

WHOOP calculates Recovery scores using measurements from the previous day and your sleep, such as resting heart rate (RHR),
heart
rate variability (HRV), respiratory rate, sleep duration/quality, skin temperature, and blood oxygen. Unlike Strain, a
Recovery score does not change over the day (unless you edit your sleep which triggers a
Recovery score re-calculation).

WHOOP categorizes Recovery scores into one of three colors:

* **GREEN (67-100%)**: You are well recovered and primed to perform. Whether at home, at work, or in the gym, your
  body is signaling that it can handle a strenuous day.
* **YELLOW (34-66%)**: Your body is maintaining and ready to take on moderate amounts of strain.
* **RED (0-33%)**: Rest is likely what your body needs. Your body is working hard to recover. Some reasons could include
  overtraining,
  sickness, stress, lack of sleep, or other lifestyle factors.

Want to learn more?

* [WHOOP Recovery](https://support.whoop.com/s/article/WHOOP-Recovery)
* [How Does WHOOP Recovery Work?](https://www.whoop.com/thelocker/how-does-whoop-recovery-work-101/)
* [Everything You Need to Know About Heart Rate Variability (HRV)](https://www.whoop.com/thelocker/heart-rate-variability-hrv/)
* [Podcast No. 29: Heart Rate Variability (HRV)](https://www.whoop.com/thelocker/podcast-29-heart-rate-variability-hrv/)

## Sleep[â](#sleep "Direct link to Sleep")

WHOOP tracks your sleep, including how long you slept and the stages of your sleep - Light, REM, and Slow Wave Sleep
(Deep). WHOOP also calculates how much sleep you need based on
your [Sleep Debt](https://www.whoop.com/thelocker/what-is-sleep-debt-catch-up/) and your previous day's activity.

Want to learn more?

* [WHOOP Sleep](https://support.whoop.com/s/article/WHOOP-Sleep)
* [How Does WHOOP Measure Sleep, and How Accurate is it?](https://www.whoop.com/thelocker/how-well-whoop-measures-sleep/)
* [What is Light Sleep?](https://www.whoop.com/thelocker/what-is-light-sleep-why-its-important/)
  | [Deep Sleep?](https://www.whoop.com/thelocker/what-is-deep-sleep/)
  | [REM Sleep?](https://www.whoop.com/thelocker/what-is-rem-sleep/)
* [What are the differences between Deep and REM Sleep?](https://www.whoop.com/thelocker/deep-sleep-vs-rem-sleep-what-are-the-differences/)