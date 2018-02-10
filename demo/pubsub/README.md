This demo was built to show the following behaviors:

 * When to setup message handlers
 * Request/response
 * Publish/subscribe
 * Getting around timing issues with timers and message expiration
 * Using `configure` to provide all topology configuration at once
 * Sharing a common topology module amongst services

## 1.1.0 timings

* 100 ~ 30 ms
* 1000 ~ 150 ms
* 10000 ~ 800 ms (sometimes low as 690, sometimes high as 820)
* 15000 ~ 1.2 s
* 100000 ~ 109 s

every 30k or so HUGE PAUSE :@ costing roughly 10-20s
