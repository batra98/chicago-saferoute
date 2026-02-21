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

| Layer       | Technology                          | Notes                                      |
|-------------|-------------------------------------|--------------------------------------------|
| Frontend    | Next.js 14 (App Router, TypeScript) | React SSR, handles SSE streaming           |
| Map         | Mapbox GL JS + Deck.gl              | GPU-accelerated tiles + heatmap layer      |
| Styling     | Tailwind CSS + shadcn/ui            | Dark glassmorphism theme                   |
| Backend     | FastAPI (Python 3.12+)              | Async, SSE streaming                       |
| Python Mgmt | `uv`                                | Fast, reproducible dependency management   |
| Graph       | OSMnx + NetworkX                    | Chicago road network + weighted Dijkstra   |
| AI Agent    | Google Gemini API (`gemini-2.0-flash`) | Streaming narration of path traversal   |
| Crime Data  | Chicago Data Portal API             | Last 12 months, filtered by lat/lon        |

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

### 4. Demo Presets (2 Routes)

#### Demo 1: "The Tourist" 🏛️
- **Start**: Union Station (225 S Canal St)
- **End**: Navy Pier (600 E Grand Ave)
- **Highlight**: Crosses the Loop — shows downtown crime clusters, safe vs. fast route choices through Millennium Park vs. State St.

#### Demo 2: "The Student" 🎓
- **Start**: Wicker Park Blue Line Station (1655 N Damen Ave)
- **End**: UIC–Halsted Blue Line Station (near University of Illinois Chicago)
- **Highlight**: Crosses 4+ neighborhoods with dramatically different safety profiles. Safest route avoids high-crime stretch of Division St.

---

## API Endpoints (Backend)

| Method | Endpoint            | Description                                      |
|--------|---------------------|--------------------------------------------------|
| GET    | `/health`           | Health check                                     |
| GET    | `/crimes/heatmap`   | Returns crime points for map heatmap             |
| GET    | `/crimes/summary`   | Aggregate stats by neighborhood                  |
| POST   | `/route/compute`    | Returns 3 candidate routes (safest/balanced/fast)|
| POST   | `/route/narrate`    | SSE stream — Gemini narration of selected route |
| GET    | `/demo/{id}`        | Load preset demo route (1=tourist, 2=student)    |

---

## Data Pipeline

```
Chicago Data Portal API
  → filter: last 12 months, has lat/lon
  → columns: date, primary_type, latitude, longitude, community_area
  → ~150k–200k incidents
  → store as: backend/data/crimes_2024.parquet

OSMnx → Chicago city graph
  → ~50k nodes, ~120k edges
  → cache: backend/data/chicago_graph.pkl

Crime scoring:
  → KD-tree spatial index on crime points
  → for each edge midpoint: query incidents within 75m
  → attach crime_score to edge attributes
  → cache: backend/data/chicago_graph_scored.pkl
```

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
# Fill in GEMINI_API_KEY and MAPBOX_TOKEN in .env

# First run — downloads crime data and builds graph (takes ~2-3 min)
uv run python -m crime_data    # fetches + caches crime data
uv run python -m graph_builder # builds + caches scored road graph

# Start server
uv run uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_MAPBOX_TOKEN

npm run dev   # starts at localhost:3000
```

---

## Environment Variables

### backend/.env
```
GEMINI_API_KEY=your_key_here
MAPBOX_TOKEN=your_token_here
```

### frontend/.env.local
```
NEXT_PUBLIC_MAPBOX_TOKEN=your_token_here
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Design System

- **Theme**: Dark map (Mapbox `dark-v11` style)
- **Colors**: 
  - Crime heatmap: purple → orange → red (low → high)
  - Safe route: `#22c55e` (green)
  - Balanced route: `#f59e0b` (amber)
  - Fast route: `#ef4444` (red)
  - UI background: `#0a0a0f` with glassmorphism panels
- **Typography**: Inter (Google Fonts)
- **Animations**: Route drawing animation, camera follow, streaming text fade-in

---

## Roadmap / Nice-to-Haves

- [ ] Time-of-day aware routing (crime rates differ dramatically night vs. day)
- [ ] Neighborhood safety score cards (A–F rating)
- [ ] Crime trend sparklines (is this area improving?)
- [ ] Walking vs. driving mode toggle
- [ ] Share route via URL (encoded route params)
- [ ] Weather overlay (dark + rainy = higher risk)

---

*Built for a hackathon demo. Data sourced from [City of Chicago Data Portal](https://data.cityofchicago.org/). AI narration powered by Google Gemini.*
