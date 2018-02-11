This demo was built to show the following behaviors:

 * When to setup message handlers
 * Request/response
 * Publish/subscribe
 * Getting around timing issues with timers and message expiration
 * Using `configure` to provide all topology configuration at once
 * Sharing a common topology module amongst services

## 2.0.0 timings

There are notable performance differences in 2.0.0:

 * recipient times don't "decay" as message counts increase
 * there aren't massive pauses when receving continuous message sets
 * this remains true even with publish confirmation on

 * 100 ~ 30 ms
 * 1000 ~ 215 ms
 * 10000 ~ 1600 ms
 * 15000 ~ 2.6 s
 * 100000 ~ 16 seconds

## 1.1.0 timings

* 100 ~ 30 ms
* 1000 ~ 150 ms
* 10000 ~ 800 ms (sometimes low as 690, sometimes high as 820)
* 15000 ~ 1.2 s
* 100000 ~ 109 s

every 30k or so HUGE PAUSE :@ costing roughly 10-20s
