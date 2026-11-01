# Mobile planner sources

> Planning aid, not a certified lift plan.

The intended source for the chart is the official **Grove GMK5250L-1 load chart,
page 17**:
<https://www.manitowoc.com/media/15016/download>.

The manufacturer PDF was found locally in the project workspace and verified
against the active M1 chart axes. The extracted document metadata identify the
PDF as `2025-02-11_KB_MTW_PG_GMK5250L-1_V2.indd`, created on 2025-03-04
08:59:40 +01:00 by Adobe InDesign 20.1 and produced by Adobe PDF Library 17.0.

The M1 values below match page 17 exactly for the 28 non-null capacity cells used
by the chart. Blank cells remain intentionally left as blank/not permitted in the
official table. The implementation performs exact lookup only; it does not
interpolate or extrapolate values that the manufacturer does not publish.

| Number | Use | Source | Status |
| --- | --- | --- | --- |
| Grove GMK5250L-1 | Crane name | Grove GMK5250L-1 load chart, page 17 | VERIFIED |
| 2025-02-11_KB_MTW_PG_GMK5250L-1_V2.indd | PDF title | Manufacturer PDF metadata, page 17 | VERIFIED |
| 0.8 m | Pivot offset | Legacy Cycle 3 `craneModel.js` KIT; chart source intended for chart values | LEGACY / VERIFIED |
| 13.3 m, 23.6 m, 38.0 m, 52.4 m, 70.0 m | Boom length rows | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| 5 m, 8 m, 10 m, 11 m, 12 m, 15 m, 20 m, 30 m | Radius columns | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| 121.0, 84.5, 64.5 t | 13.3 m row, radii 5/8/10 m | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| 111.0, 83.5, 68.0, 62.0, 57.0, 45.0, 27.0 t | 23.6 m row, radii 5/8/10/11/12/15/20 m | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| 59.0, 58.5, 53.0, 50.5, 47.5, 40.0, 30.5, 17.2 t | 38.0 m row, radii 5/8/10/11/12/15/20/30 m | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| 31.0, 31.0, 31.0, 28.5, 23.5, 15.0 t | 52.4 m row, radii 10/11/12/15/20/30 m | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| 14.5, 14.5, 14.5, 14.5, 12.1 t | 70.0 m row, radii 12/15/20/30 m | Grove GMK5250L-1 load chart, p. 17 | VERIFIED |
| User inputs | Total weight W, length spread L, width spread B, eccentricity | Backlog item M3 specification (no invented crane dimensions) | USER INPUT / PARAMETER |
| Rigid plate statics: R_i = W/4 ± W*e_x/(2L) ± W*e_y/(2B) | Pad reaction equilibrium model | Classical statics equilibrium: sum F_z = W, sum M_x = W*e_y, sum M_y = W*e_x | STANDARD STATICS |

Blank cells on page 17 remain `null` in the implementation and are not treated as
fabricated values. The exact chart configuration is full outriggers, 7.8 m track
width, 360 degrees, 80 t counterweight, EN 13000.
