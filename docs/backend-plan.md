# Solar OS backend plan

Plan only. This document does not add a NestJS application, MongoDB deployment, routes, or seed scripts. The paired UI stays on one in-memory fixture and does not call HTTP.

Repositories:

- Frontend: https://github.com/AntonFesun/solar_os — Angular UI. Already exists. One fixture drives every screen. Stub values are marked DEMO.
- Backend: https://github.com/AntonFesun/solar_os_api — this plan. NestJS and MongoDB when a later implementation is built.

The shared surface is the HTTP contract below. There is no shared library in this release.

## Two-repo boundary

`solar_os` owns presentation: routes, theme rendering, charts, and the DEMO badge. Its services sit behind interfaces shaped like the endpoints in this plan. The current implementation of those interfaces is a fixture class. The fixture holds one coherent timeline. Cards, the flow diagram, analytics, phases, battery, solar, cost, alerts, and settings all read that same object. The fixture does not draw independent random numbers per card.

`solar_os_api` will own persistence, validation, aggregation, tariff math, and the energy-balance check. Canonical telemetry is watts and watt-hours. The UI may format kW or kWh for display. It does not keep a second source of truth once it is pointed at the API.

Settings that affect identity (name, phase count, limits, capacities, tariffs, theme) are local fixture state today. The API will persist them. Theme is stored so clients agree, and the client still applies it. Display unit preferences do not change the stored units.

Scenario switching (daytime, night, high load, grid outage, battery discharge, excess solar, generator) stays in the frontend fixture. The first API implementation does not host those scenarios and does not grow a simulation engine. It serves one seeded site, `demo-site`, whose samples already satisfy the balance rule. When the UI later calls HTTP, it shows that seed. The scenario control remains a DEMO fixture behavior.

Missing measurements are `null`. They are never coerced to zero.

## Runtime, when implemented

One NestJS 11 service on the default Express adapter. MongoDB 7, database name `solar_os`, access through `@nestjs/mongoose`. Collection shapes live next to the HTTP layer. The balance identity, cost rollup, and solar ratios live in a domain layer the controllers call.

Modules: sites, telemetry, energy, battery, solar, cost, alerts, settings.

Process configuration is `MONGODB_URI`, `PORT`, and the frontend origin used for CORS. Secrets stay out of the repository. The first implementation has no authentication middleware.

`GET /api/v1/health` may report process up and a Mongo ping. It is an operational check, not a UI contract, and it returns no site data.

Breaking changes to the fields below require `/api/v2`. Adding a field is allowed on `/api/v1`.

## Units and time

| Quantity | Unit | Notes |
| --- | --- | --- |
| Power | W | Instantaneous |
| Energy | Wh | Accumulated over a bucket |
| Voltage | V | Phase |
| Current | A | Phase |
| Power factor | 0–1 | Magnitude only in this release |
| State of charge | 0–100 | `batterySoc` on the live snapshot and `soc` on the battery read are the same quantity |
| Temperature | °C | Null when the source has no probe |
| Health | 0–100 or null | Battery health when the source provides it |
| Money | decimal string | ISO 4217 currency from settings. Binary floats are not used for money |
| Tariff price | decimal string per kWh | Convert with kWh = Wh / 1000 at read time |
| Time | ISO-8601 UTC | Bucket edges are UTC instants of site-local boundaries |

`from` is inclusive and `to` is exclusive. Both are UTC instants. Bucket boundaries align to the site IANA timezone (default `UTC`, stored on the site). `grain=hour` means a local clock hour. An hour bucket is priced and rolled up as a whole; day and night tariff starts sit on the hour so a bucket is not split.

## Sign convention

- `consumptionW` is house demand and is greater than or equal to zero.
- `solarW` and `generatorW` are generation and are greater than or equal to zero.
- `gridW` is positive when the site imports from the grid and negative when the site exports. Export is negative grid power, not a second live field.
- `batteryW` is positive when power flows into the battery (charge) and negative when the battery discharges.
- House load is never signed as generation.

Energy buckets split the signed flows into non-negative totals: `gridImport`, `gridExport`, `batteryIn` (charge), `batteryOut` (discharge), plus `consumption`, `solar`, and `generator`. All of those series values are watt-hours.

Phase `activePower` uses the grid sign. Positive is import on that phase, negative is export. The sum of phase active powers equals `gridW` within tolerance. That sum is not household consumption. Solar and battery may sit on a bus the phase meter does not measure as load.

## Balance rule

Instantaneous identity, in watts:

`solarW + generatorW + gridW = consumptionW + batteryW`

The same identity expanded into non-negative parts:

`solarW + generatorW + max(gridW, 0) + max(-batteryW, 0) = consumptionW + max(-gridW, 0) + max(batteryW, 0)`

Tolerance for a sample:

`abs(residualW) <= max(50 W, 0.02 * max(consumptionW, solarW, generatorW))`

`residualW` is the left side of the first identity minus the right side.

Interval identity, in watt-hours, for one bucket:

`solar + generator + gridImport + batteryOut = consumption + gridExport + batteryIn`

Tolerance for a bucket:

`abs(residualWh) <= max(10 Wh, 0.02 * max(consumption, solar, generator))`

The live response includes the residual, the tolerance, and whether the sample passed. A future write that fails the check is rejected with HTTP 422 and does not replace the last good sample. Seed data must already pass. This release does not store a round-trip battery efficiency. State of charge is a measured field. A mismatch between SOC movement and `batteryIn` / `batteryOut` is left visible. It is not silently corrected.

`generator` is on every energy point because the shared one-line series list omitted it, and the identity is false for the generator scenario without it. The fixture emits `generator` as well.

## What is stubbed now, and what the API will own

| Concern | Frontend fixture now | API, first implementation |
| --- | --- | --- |
| Source of numbers | One in-memory object. Every stub value is marked DEMO | MongoDB. Responses are not labeled DEMO. Seed documents may record `source: "seed"` |
| Transport | No HTTP calls | The endpoints in this plan |
| Screens | Overview, flow, analytics, phases, battery, solar, cost, alerts, settings | The same screens read these read models |
| Settings | Local only: name, phases, limits, capacities, tariffs, theme | `site_settings`, including those fields |
| Balance | Fixture data satisfies the identity | Server checks the identity on write and returns it on the live read |
| Cost | Same formulas as this plan, with assumptions | Hour buckets times the stored tariff. Assumptions are returned. No savings figure |
| Alerts | Fixture list | `alerts` collection, seeded. No rule engine yet |
| Scenarios | Switchable DEMO timelines | Not served. One seeded site |
| Auth | None | None |
| Devices | None | None. Adapters are a later phase |
| Empty data | Visible empty state | `null` measurements and `status: "empty"` |

The API owns the formulas for self-consumption, grid dependency, phase imbalance, overload, battery runtime, and cost. The fixture uses those same formulas so the screens agree before HTTP exists. The UI does not invent a savings number.

## Collections and indexes

String `siteId` is the site document `_id`. The seed id is `demo-site`.

### `sites`

Identity and timezone only.

- `_id` (string site id), `timezone` (IANA), `createdAt`, `updatedAt`

The `_id` index is the lookup.

### `site_settings`

One document per site. This is the settings resource.

- `siteId`
- `name`
- `phaseCount`: `1` or `3`
- `limits.gridImportW`, `limits.gridExportW`, `limits.voltageMinV`, `limits.voltageMaxV`, `limits.currentMaxA`, `limits.phaseImbalanceMax` (ratio from 0 to 1)
- `capacities.pvW`, `capacities.batteryWh`, `capacities.batteryReserveSoc` (0–100, runtime assumption only)
- `tariffs.currency`, `tariffs.mode` (`flat` or `dayNight`), `tariffs.importPerKwh`, `tariffs.exportPerKwh`
- `tariffs.day` and `tariffs.night`: `startLocal` on the hour, plus that window's import and export prices. Null when mode is `flat`
- `theme`: `dark` or `light`
- `units.power` (`W` or `kW`) and `units.energy` (`Wh` or `kWh`), display preferences
- `refreshIntervalSec`, `staleAfterSec` (default 120)
- `alertThresholds.lowBatterySoc`, `alertThresholds.highConsumptionW`
- `dataSourceMode`: `seed` until the device phase

Index: unique `{ siteId: 1 }`.

### `power_samples`

Instantaneous telemetry.

- `siteId`, `ts`
- `consumptionW`, `solarW`, `gridW`, `batteryW`, `batterySoc`, `generatorW`
- `tempC`, `health` (nullable; the battery read uses the latest sample)
- `status`: `ok`, `offline`, or `error`

`stale` and `empty` are read-model states, not stored sample statuses.

Index: unique `{ siteId: 1, ts: -1 }`. The latest sample is the first key in that order.

### `phase_samples`

- `siteId`, `ts`
- `phases[]`: `phase` (`L1`, `L2`, `L3`), `voltage`, `current`, `activePower`, `powerFactor`

A single-phase site stores `L1` only.

Index: unique `{ siteId: 1, ts: -1 }`.

### `energy_buckets`

- `siteId`
- `grain`: `hour`, `day`, `week`, `month`, or `year`
- `start`: UTC instant of the local boundary
- `consumption`, `solar`, `gridImport`, `gridExport`, `batteryIn`, `batteryOut`, `generator` (Wh, each >= 0)

Index: unique `{ siteId: 1, grain: 1, start: 1 }`.

Hour buckets are the source for cost, throughput, and today's solar. Day, week, month, and year buckets are sums of those hours for the same site and are stored so a chart query does not re-sum on read. Coarser grains are never added on top of hours when computing a total.

### `alerts`

- `siteId`
- `severity`: `info`, `warning`, or `critical`
- `type`: `high_consumption`, `phase_overload`, `voltage_anomaly`, `low_battery`, `inverter_offline`, `sensor_disconnected`, `grid_loss`
- `message`, `deviceId` (null until devices exist), `raisedAt`, `resolvedAt`
- `status`: `open`, `acknowledged`, or `resolved`

Indexes:

- `{ siteId: 1, status: 1, raisedAt: -1 }` for the list
- partial unique `{ siteId: 1, type: 1 }` where `status` is `open` and `deviceId` is null, so one open alert of each type exists per site until devices exist

### Not created in the first implementation

Battery, solar, and cost do not have their own collections. They are read models over samples, hour buckets, and settings.

A later `devices` collection may hold `siteId`, kind (`meter`, `inverter`, `bms`), adapter (`rest`, `websocket`, `mqtt`, `modbus`), and last-seen status. It is not created for the first implementation.

## Endpoints

Base path `/api/v1`. JSON. Unknown site id is 404. A known site with no measurements is 200 and uses nulls.

### `GET /sites/:siteId/live`

Response fields:

- `siteId`
- `consumptionW`, `solarW`, `gridW`, `batteryW`, `generatorW` (number or null)
- `batterySoc` (0–100 or null)
- `status`: `ok`, `stale`, `offline`, `error`, or `empty`
- `updatedAt` (ISO-8601 or null)
- `balance`: `residualW`, `toleranceW`, `ok`. Null when status is `empty`

Read rule. Take the newest `power_samples` document. No document yields status `empty` and null powers. Stored `ok` becomes `stale` when `now - ts` is greater than `staleAfterSec`. Stored `offline` and `error` pass through. `balance` is computed from the returned numbers.

### `GET /sites/:siteId/energy`

Query: `from`, `to`, `grain` (`hour`, `day`, `week`, `month`, `year`).

Maximum span: hour 7 days, day 400 days, week 3 years, month 10 years, year 20 years. A wider span is 400.

Response fields:

- `siteId`, `from`, `to`, `grain`, `toleranceWh`
- `series[]`: `start`, `end`, `consumption`, `solar`, `gridImport`, `gridExport`, `batteryIn`, `batteryOut`, `generator`
- `summary.selfConsumption` and `summary.gridDependency` (ratio or null) plus a short `summary.formula` string for each

A valid site and an empty range return `series: []` and null ratios.

`summary.selfConsumption` over the range is `clamp((solar - gridExport) / solar, 0, 1)` when solar is greater than zero, else null. Grid export is treated as solar that left the site. Energy that charged the battery counts as self-consumed. Generator watt-hours are not in the numerator.

`summary.gridDependency` is `gridImport / consumption` when consumption is greater than zero, else null.

### `GET /sites/:siteId/phases/live`

Response fields:

- `siteId`, `updatedAt`, `status` (same stale rule as live power)
- `phases[]`: `phase`, `voltage`, `current`, `activePower`, `powerFactor`
- `imbalance` (ratio or null)
- `overload` (boolean)

`imbalance` is `(max(current) - min(current)) / mean(current)` when three phases are present and the mean current is greater than zero. Otherwise null.

`overload` is true when any phase voltage is outside `voltageMinV`/`voltageMaxV`, current exceeds `currentMaxA`, absolute active power exceeds the per-phase share of the grid import limit, or imbalance exceeds `phaseImbalanceMax`. Null limits are not evaluated.

### `GET /sites/:siteId/battery`

Response fields:

- `siteId`
- `soc`, `capacityWh`, `powerW`, `throughputWh`, `tempC`, `health`
- `runtime.hours` (number or null), `runtime.assumption` (string, always present)
- `updatedAt`

`soc`, `powerW`, `tempC`, and `health` come from the latest power sample. `capacityWh` and `batteryReserveSoc` come from settings. `throughputWh` is the sum of `batteryIn + batteryOut` across hour buckets only. It is null when no hour buckets exist.

`runtime.hours`, only while `powerW` is negative and `capacityWh` is greater than zero:

`(soc - batteryReserveSoc) / 100 * capacityWh / abs(powerW)`

Assumption, returned as text: the latest discharge power is held constant; solar, grid, generator, and later load changes are ignored; reserve SOC comes from settings; the result is null when the battery is not discharging or capacity is zero.

### `GET /sites/:siteId/solar`

Response fields:

- `siteId`, `powerW`, `todayWh`, `peakW`, `exportWh`, `selfConsumption`
- `assumptions` (string array)
- `updatedAt`

`powerW` is the latest sample. `todayWh` and `exportWh` sum local-today hour buckets (`solar` and `gridExport`). `peakW` is the max `solarW` among samples on that local day. Each is null when the underlying rows are absent. `selfConsumption` uses the ratio defined above, for the local day. The assumptions array states that export is attributed to solar, that battery charge counts as self-consumed, and that generator energy is excluded from the numerator.

### `GET /sites/:siteId/cost`

Query: `from`, `to` (same inclusive-exclusive UTC instants).

Response fields:

- `siteId`, `from`, `to`
- `tariff`: the stored tariff, echoed (currency, mode, prices, windows, timezone)
- `importCost`, `exportCredit` (decimal strings)
- `assumptions` (string array)

Cost uses hour buckets whose `start` falls in `[from, to)`. Each bucket takes the price of the window that contains its start. Flat mode uses the flat prices.

- `importCost = Σ (gridImport / 1000) * import price`
- `exportCredit = Σ (gridExport / 1000) * export price`

Import and export are not netted. The assumptions list names the mode, the prices, the timezone, and the decision not to compute savings. This endpoint has no savings field.

### `GET /sites/:siteId/alerts`

Optional query: `status`, `limit` (default 50, maximum 200). The fixture may ignore the query and return its full DEMO list.

Response fields: `siteId`, `alerts[]` of `id`, `severity`, `type`, `message`, `deviceId`, `raisedAt`, `resolvedAt`, `status`. Sort is `raisedAt` descending.

The first implementation returns seeded alerts. It does not evaluate thresholds. Thresholds are stored for a later evaluator. Intended types, when that evaluator exists, are high consumption against `highConsumptionW`, phase overload and voltage anomaly from the phase rules, low battery against `lowBatterySoc`, and inverter offline, sensor disconnected, and grid loss from adapter status.

### `GET /sites/:siteId/settings` and `PATCH /sites/:siteId/settings`

GET returns the full settings document.

PATCH accepts a partial JSON object of the settings fields listed above. Unknown keys are 400. `dataSourceMode` other than `seed` is 400 until the device phase. The response is the full document after the write. PATCH does not rewrite samples or buckets. A capacity change affects later runtime math only. Theme is persisted; the client applies it.

## Errors

| Status | When |
| --- | --- |
| 400 | Bad `from`/`to`/`grain`, span over the cap, unknown PATCH field, `dataSourceMode` not yet allowed |
| 404 | Unknown `siteId` |
| 422 | A future sample or bucket write that fails the balance identity |

Error body fields: `statusCode`, `error`, `message`, `details`. Balance failures include `details.residualW` or `details.residualWh`.

## Phases

This task is the plan. No application code ships with it.

First implementation, later: the NestJS service, the collections and indexes above, a `demo-site` seed that passes the balance rule, the read endpoints, settings PATCH, the read-time stale rule, and CORS for the frontend origin. Still no auth and no device I/O.

Auth is a later phase. It adds users and site membership and requires a credential on every route except health. A shared static secret is not a stand-in for that phase.

Device adapters are a later phase. They ingest only. The adapter set is REST poll, WebSocket, MQTT, Modbus, smart meter, inverter, and BMS. An adapter's output is a power sample and, when the meter has phases, a phase sample. Both pass the balance check before insert. There is no command path to devices. Monitoring and control stay separate.

## Non-goals

- No Angular app in the API repository, and no second frontend repository.
- No vendor cloud clients and no device commands.
- No invented savings, and no silent rewrite of SOC to force a coulomb balance.
- No per-card random data. One site timeline feeds every read model.
