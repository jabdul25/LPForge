# LPFORGE Warming Continuity Deadline Scheduling Fix V1

## Scope

This release corrects a discovery scheduling contract defect only. It does not
alter entry/range policy, P4 thresholds, execution/P6, capital limits, position
limits, RPC concurrency, or evidence thresholds.

## Root cause

Continuity protection previously began only after a candidate reached the late
`QUALIFIED`/`TRACKING` handoff. A WARMING candidate could therefore be rotated
out of an economic lease before its 10-minute anchored evidence window matured,
creating scheduler-induced gaps above the existing 450-second maximum.

## Canonical behavior after this release

- A successful first active WARMING observation starts a continuity tracker only
  when a bounded tracker slot is available.
- The tracker persists its anchor, last-observation time, and 450-second
  deadline; it is protected from ordinary economic lease rotation.
- The active collector orders active continuity trackers by earliest deadline
  before ordinary fair-slice economic candidates.
- Only two trackers may be active. Candidates without a slot remain waiting;
  they do not create a protected anchored episode that cannot be serviced.
- Trackers remain subject to existing completion, hard-disqualification,
  invalid-evidence, and canonical-expiry release paths.

## Validation

Focused continuity suite: 40/40 passing.

Full canonical CI: 984/984 passing, including all boundary and migration
checks. The existing evidence requirements remain: maximum gap 450 seconds,
minimum observations and anchored span unchanged, tracker cap 2, economic
lease cap 2, and read RPC concurrency 1.

## Live validation

Deployment must be observed through a natural continuity episode. No candidate
or trade is forced. A healthy live episode is expected to show a retained
WARMING tracker with observation intervals comfortably below 450 seconds until
confirmation, disqualification, expiry, or invalid evidence.
