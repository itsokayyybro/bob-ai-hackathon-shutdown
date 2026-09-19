# Operations console — frontend

A React + TypeScript dashboard for the AI Emergency Operations & Resource
Orchestration System. It reads the FastAPI backend and turns the engine's
normalised scores into conclusions a coordinator can act on.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173, proxies /api to localhost:8000
```

The backend must be running:

```bash
cd ../backend && uvicorn app.main:app --port 8000
```

For production, `npm run build` emits `dist/`, which the backend mounts and
serves from its own root (see the end of `src/backend/app/main.py`). No separate
web server is needed.

| Command | Does |
|---|---|
| `npm run dev` | Dev server with HMR and the `/api` proxy |
| `npm run build` | Typecheck (`tsc -b`) then bundle to `dist/` |
| `npm run lint` | Oxlint |
| `npm run preview` | Serve the built bundle |

## The one design rule

**The engine speaks in floats. The console speaks in sentences.**

The API returns things like `criticality 0.43`, `accessibility_factor 0.0`,
`confidence_factor 0.008`. None of that tells anyone what is wrong or what to do,
so nothing like it reaches the screen. Every number passes through a translation
layer first:

| API says | Console says |
|---|---|
| `accessibility_factor: 0.0` | No usable route |
| `confidence_factor: 0.008` | Almost no current information |
| `criticality_score: 0.43` | High need |
| `status: "overloaded"` | Taking more casualties than it can handle |
| `status: "partially_blocked"` | Passable with difficulty |
| `freshness: 0.08` | 40 min ago — too old to rely on |
| `conflict_status: "conflicting"` | Two reports disagree. Send someone to confirm. |

That layer is `src/lib/explain.ts`. If you add a screen, route your values
through it rather than printing them.

## Headline figures

The three numbers on the event card partition the affected population by whether
help can actually reach it, so they always sum to the total shown beneath them:

```
cannot reach + unconfirmed + reachable = total affected
```

That is a deliberate constraint. It means the headline can be sanity-checked
against itself instead of being three unrelated counters. Derived in
`src/lib/derive.ts`.

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ResponseAI      Overview Resources Timeline Reports    Live  T+ │
├────────────────┬─────────────────────────────┬───────────────────┤
│ Event + stats  │                             │ Priority actions  │
│ Recent updates │           Map               │  P1 … [Allocate]  │
│ What to watch  │                             │ Teams             │
│                ├─────────────────────────────┤                   │
│                │ Situation timeline          │                   │
└────────────────┴─────────────────────────────┴───────────────────┘
```

Left column is what happened, centre is where, right is what to do about it.

## Structure

```
src/
  lib/
    api.ts          typed client for every endpoint
    types.ts        response shapes, verified against live responses
    explain.ts      floats → sentences (the translation layer)
    derive.ts       headline figures, priority actions, watch list
    useConsole.ts   shared state, polled every 5 s
    constants.ts    source reliability + decay, mirrored from backend config
    operatorLog.ts  the operator's own confirm/decline record
  components/       Card, TopBar, PlacesMap, OverviewCards, Reports, …
  views/            Overview, ResourcesView, TimelineView, ReportsView
  styles/           tokens.css (MD3 light) · base.css · app.css
```

## The map

Hand-drawn SVG, not a tile map. The system reasons over a graph of 15 places and
14 road segments in a ~6 km valley, so the map draws that graph: real
coordinates, place **names** rather than database codes, and greedy label
placement so nothing collides. Damaged roads are the only thing that draws the
eye, because they are the only thing that changes a plan. A cut road is labelled
`CUT` in words, so no colour has to be decoded.

No tile server means it cannot fail offline and it costs no extra dependency.

## Theme

Light, black-and-white base with Material Design 3 accents: a tinted page with
white cards on it, tonal status containers (light fill, dark on-colour), one
primary blue reserved for actions. Colour is never decorative — if something is
coloured it means something. Typeface is IBM Plex Sans, which fits the IBM Bob
integration and is built for dense interfaces.

## Honest limits

- **Nothing is dispatched.** The backend has no allocation write endpoint, so
  `Allocate` records the decision in the session and the UI says so. Wiring it up
  needs a `POST /actions/allocate` on the backend.
- **No forecasting.** The engine does not predict, so the "What to watch" card is
  labelled as read from current state rather than projected.
- **Report ages are wall-clock**, because that is what the backend's freshness
  decay uses. They are not scenario-clock offsets.
- All figures in the scenario are synthetic.
