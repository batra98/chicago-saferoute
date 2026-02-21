# Chicago SafeRoute 🗺️

> A crime-aware navigation system for Chicago. Visualize crime patterns and find the safest route between any two points — narrated live by an AI agent.

---

## Overview

**Chicago SafeRoute** is a hackathon project that combines:
- Real Chicago crime data (Chicago Data Portal / Kaggle)
- An interactive heatmap of crime density
- A crime-weighted pathfinding engine
- A **live AI agent** (Gemini) that walks through each route segment, evaluating crime data at every turn in real time

---

## Tech Stack

| Layer       | Technology                              | Notes                                         |
|-------------|-----------------------------------------|-----------------------------------------------|
| Frontend    | Next.js 16 (App Router, TypeScript)     | React SSR, handles SSE streaming              |
| Map         | Mapbox GL JS                            | Dark-v11 style + native heatmap layer         |
| Styling     | Tailwind CSS v4                         | Dark glassmorphism theme                      |
| Backend     | FastAPI (Python 3.12+)                  | Async, SSE streaming                          |
| Python Mgmt | `uv`                                    | Fast, reproducible dependency management      |
| Graph       | OSMnx 2.x + NetworkX                   | UTM-projected graph, largest SCC, Dijkstra    |
| AI Model    | Google Gemini (`gemini-2.5-flash`)      | Streaming narration, AFC disabled             |
| Crime Data  | Chicago Data Portal API                 | Last 12 months, cached as Parquet             |
| Voice       | Web Speech API (browser-native)         | Sentence-buffered TTS, mute toggle            |

---

## Project Structure

```
chicago-saferoute/
├── plan.md                  ← You are here
├── README.md
├── .gitignore
│
├── backend/
│   ├── pyproject.toml       # uv-managed dependencies
│   ├── main.py              # FastAPI app entry point
│   ├── router.py            # Crime-weighted graph + Dijkstra
│   ├── agent.py             # Gemini streaming agent
│   ├── crime_data.py        # Chicago Data Portal ingestion + preprocessing
│   ├── graph_builder.py     # OSMnx Chicago road network
│   ├── models.py            # Pydantic schemas
│   └── .env                 # GEMINI_API_KEY, MAPBOX_TOKEN
│
└── frontend/
    ├── package.json
    ├── .env.local            # NEXT_PUBLIC_MAPBOX_TOKEN
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx          # Main map page
    │   └── api/
    │       └── route/route.ts  # Proxy to backend
    └── components/
        ├── MapView.tsx           # Mapbox GL JS instance
        ├── CrimeHeatmap.tsx      # Deck.gl heatmap layer
        ├── RoutePanel.tsx        # Route options sidebar
        ├── AgentNarrator.tsx     # Streaming LLM text + progress
        ├── CrimeFilters.tsx      # Crime type toggles
        ├── TimeSlider.tsx        # Hour-of-day animation
        └── DemoPresets.tsx       # 2 preset demo routes
```

---

## Core Features

### 1. Crime Heatmap Visualization
- Deck.gl `HeatmapLayer` over Mapbox GL dark-style map
- **Filters**: crime type (theft, assault, robbery, burglary, homicide, etc.)
- **Time slider**: animate heatmap density by hour of day
- Click any crime cluster → popup with incident details

### 2. Crime-Weighted Routing Engine

**Graph construction:**
- Load Chicago road network from OSMnx
- For each road edge, compute: `crime_score = Σ incidents within 75m radius`
- Apply severity multiplier: homicide=10x, assault=5x, robbery=4x, theft=1x

**Weighted Dijkstra:**
```
edge_weight = α × (distance_km) + β × (crime_score_normalized)
```

| Mode     | α   | β   | Description                   |
|----------|-----|-----|-------------------------------|
| Safest   | 0.2 | 0.8 | Maximize crime avoidance      |
| Balanced | 0.5 | 0.5 | Equal tradeoff                |
| Fastest  | 0.8 | 0.2 | Minimize distance             |

**Output per route:**
- Polyline coordinates
- Total distance (km)
- Estimated walk/drive time
- Crime exposure score
- Number of incidents along path

### 3. Gemini AI Agent — Live Path Narration ✨

The crown jewel. When a user selects a route, the backend:

1. Breaks the path into **segments** (each turn/intersection)
2. Fetches crime data for each segment (incidents within 100m)
3. Streams a Gemini prompt that "walks" the agent through the path:

```
System: You are a safety-aware navigator for Chicago. 
        I will give you each segment of a route with nearby crime data.
        For each segment, comment briefly on the safety and your decision.
        Be conversational, concise, and highlight any warnings.

User: [Segment 1] Corner of Wacker & Michigan Ave
      Nearby incidents (100m, last 12mo): 3 thefts, 0 assaults
      Distance: 120m → heading East

Agent: Michigan Ave near Wacker is relatively safe — just minor theft
       activity typical of a busy downtown corridor. Continuing east... ✅

User: [Segment 2] Canal St & Adams St
      Nearby incidents: 12 thefts, 2 assaults, 1 robbery
      Distance: 85m → turning South
      
Agent: ⚠️ Heads up — this corner shows elevated theft and assault rates.
       On the safest route, we're bypassing the next two blocks via 
       Jackson Blvd instead. Routing around... 🔄
```

**SSE stream:** each narration chunk → frontend renders live text + animates map camera to that segment.

### 4. Demo Presets (3 Routes)

#### Demo 1: "The Tourist" 🏛️
- **Start**: Millennium Park → **End**: Lincoln Park Zoo
- **Highlight**: Long North Side corridor, shows clear route divergence.

#### Demo 2: "The Student" 🎓
- **Start**: Wicker Park Blue Line → **End**: UIC–Halsted Blue Line
- **Highlight**: Crosses 4+ neighborhoods with different safety profiles.

#### Demo 3: "The Night Owl" 🌙
- **Start**: Logan Square Blue Line → **End**: River North (Clark & Ohio)
- **Highlight**: Long west→east, shows how safest route avoids NW Side crime hotspots.

### 5. Voice Narration 🔊

Uses the **browser's Web Speech API** (no API key required):
- Each text chunk is buffered until a sentence boundary (`.`, `!`, `?`)
- Then spoken via `SpeechSynthesis.speak()`
- Toggle button (🔊/🔇) in the narrator panel header
- Speech cancels immediately on route stop or mute

---

## Setup Instructions

### Prerequisites
- Python 3.12+ with `uv` installed (`pip install uv`)
- Node.js 18+
- Mapbox API token (free at mapbox.com)
- Google Gemini API key (free at aistudio.google.com)

### Backend

```bash
cd backend
uv sync
cp .env.example .env
# Fill in GEMINI_API_KEY in .env

# First run — downloads crime data and builds graph (~2 min, cached after)
uv run python init_data.py

# Start server
uv run uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# Edit .env.local and set NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev   # starts at localhost:3000
```

---

## Environment Variables

### backend/.env
```
GEMINI_API_KEY=your_key_here
```

### frontend/.env.local
```
NEXT_PUBLIC_MAPBOX_TOKEN=your_token_here
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Architecture Notes

- **Graph projection**: OSMnx 2.x projects to UTM (meters). All node `x`/`y` must be reprojected to WGS84 via `pyproj.Transformer` before sending to the frontend. See `_node_lnglat()` in `router.py`.
- **Gemini model**: Use `gemini-2.5-flash`. Disable AFC (`AutomaticFunctionCallingConfig(disable=True)`) — it defaults to AUTO and breaks streaming generators.
- **Graph connectivity**: Filter to largest strongly connected component after download to prevent Dijkstra "No path" errors.
- **SSE streaming**: `chunk` events carry text fragments; `segment_done` carries full segment + WGS84 coords. Frontend speech buffer flushes at sentence boundaries.

---

## Design System

- **Theme**: Dark map (Mapbox `dark-v11` style)
- **Colors**:
  - Crime heatmap: purple → orange → red
  - Safe route: `#22c55e` (green)
  - Balanced route: `#f59e0b` (amber)
  - Fast route: `#ef4444` (red)
  - UI: `#0a0a0f` with glassmorphism panels
- **Animations**: Route draw, camera follow, streaming text fade-in, agent dot pulse

---

## Roadmap / Nice-to-Haves

- [ ] Time-of-day aware routing
- [ ] Neighborhood safety score cards (A–F)
- [ ] Crime trend sparklines
- [ ] Walking vs. driving mode toggle
- [ ] Share route via URL

---

## Current Narration Architecture (up to date as of Feb 2026)

**Flow:**
1. Backend computes route → returns segments with `crime_count`, `crime_score`, `street_name`, `mid_coords`
2. `agent.py` groups consecutive segments by street name using `itertools.groupby`
3. Each unique street is narrated **at most once** (tracked via `narrated_streets` set) — eliminates repeats
4. Only streets with `crime_count >= 10` trigger a Gemini call (threshold filter)
5. Gemini uses `generate_content` (non-streaming, complete response) — avoids mid-sentence truncation
6. Results emitted as SSE `segment_done` events with `full_narration` (empty string = silent move)
7. Frontend `AgentNarrator`: `for await` loop over SSE events → `await animateTo(coords)` → `await speakAndWait(text)`
8. Dot stops during speech, resumes on next event — natural pause-and-continue behavior
9. Voice and text appear simultaneously (same `await`)

**Typical narration count:** 3–6 alerts per route (vs. 13+ before clustering)

---

## Mapbox API Brainstorm 🗺️

These are possibilities to make traversal more cinematic and narration more contextual:

### Already Implemented
- **3D extruded buildings** (`fill-extrusion`) — cityscape depth
- **Atmospheric fog** (`map.setFog()`) — dark blue haze, star intensity
- **Native heatmap layer** — crime density visualization
- **Crime-gradient line** — route colors green→red by per-segment `crime_score_norm`
- **Cinematic camera tracking** — `map.jumpTo()` locked to dot position with shortest-path bearing interpolation
- **Constant-speed animation** — Dot perfectly traces the exact street geometry polyline (`path_coords`) without cutting corners
- **Animated route draw** — Line opacity animates from 0→1 on first load

### High Impact Ideas
| Idea | API | Effect |
|------|-----|--------|
| **Neighborhood labels** | `map.addLayer` with custom symbol | Label each neighborhood as dot crosses it |

### Interesting but Complex
- **Mapbox Directions API** — real turn-by-turn with maneuver instructions; could replace OSMnx for routing (but loses crime-weighting control)
- **Isochrone API** — show reachable area within N minutes, color-coded by danger level
- **3D crime towers** (`fill-extrusion` on hexbin grid) — bar chart of crimes rising from the map
- **Scrollytelling** — `map.flyTo` controlled by scroll position for a guided story mode

10. **Cinematic Animation & Path Following**
    - Smooth 60fps interpolation of the Mapbox camera and Agent marker.
    - Full polyline geometry extraction from OSMnx graph so the marker traces curved streets perfectly.
    - Synchronized zoom, pitch (55deg), and shortest-path bearing rotation during route traversal.

11. **Street-Smart Chicago Persona**
    - A custom Gemini system prompt that translates raw crime reports into relatable, vibe-based warnings.
    - Banned robotic statistical recitation in favor of conversational fillers and tactical safety tips.

12. **Incident Pulse Markers**
    - Dynamic Mapbox DOM markers that pulse and glow specifically when the AI pauses to warn the user about a dangerous block.
    - Severity color-coding (Red = Violent, Orange = Property, Green = Low Risk).
    - Custom Lucide SVG icons embedded into the markers.
    - Hover popups displaying the specific crime type and date of occurrence.

### Next Steps / Remaining Work

1.  **Dynamic Routing & "Behind the Scenes" Narration (Crucial Shift)**
    - *Goal*: Instead of overwhelming the user with 3 upfront static routes, the UI will take the start/end inputs and immediately launch into the safe route traversal.
    - *Mechanic*: The AI won't just describe *what* is on the street, it will describe *why* it chose this street. (e.g., "I'm routing us down State Street instead of Wabash because there were 15 recent robberies one block east. We're taking the well-lit path.")
    - *UI Update*: Remove the 3-route selection panel entirely. Streamline directly from standard input to cinematic traversal.

2.  **ElevenLabs Ultra-Realistic TTS Integration**
    - Replace the robotic browser Web Speech API with an emotionally resonant, human-sounding ElevenLabs voice.
    - Sync the ElevenLabs audio stream with the `segment_done` SSE events so the camera panning perfectly matches the spoken cadence.

3.  **Time of Day Context**
    - Inject the current local time (or user-selected time) into the routing engine and the Gemini prompt. "It's 2 AM right now, so we are absolutely avoiding the park paths."*

---

*Built for a hackathon. Data from [City of Chicago Data Portal](https://data.cityofchicago.org/). AI by Google Gemini 2.5 Flash.*
