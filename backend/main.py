"""
main.py — FastAPI application entry point for Chicago SafeRoute backend.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

from models import RouteRequest, NarrateRequest, DEMO_PRESETS
from crime_data import load_crime_data, get_heatmap_points, get_crime_summary
from graph_builder import build_scored_graph
from router import compute_routes, get_segment_crime_data
from agent import narrate_route_stream

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App state ────────────────────────────────────────────────────────────────
app_state = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load data and graph on startup."""
    logger.info("🚀 Loading crime data and building graph...")
    crime_df = load_crime_data()
    G = build_scored_graph(crime_df)
    app_state["crime_df"] = crime_df
    app_state["graph"] = G
    logger.info("✅ Ready! %d crime incidents, %d graph nodes", len(crime_df), G.number_of_nodes())
    yield
    app_state.clear()


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Chicago SafeRoute API",
    description="Crime-weighted routing with Gemini AI narration",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "crime_records": len(app_state.get("crime_df", [])),
        "graph_nodes": app_state["graph"].number_of_nodes() if "graph" in app_state else 0,
    }


# ── Crime data endpoints ──────────────────────────────────────────────────────
@app.get("/crimes/heatmap")
def crimes_heatmap(
    crime_type: str | None = Query(None, description="Filter by crime type"),
    hour: int | None = Query(None, ge=0, le=23, description="Filter by hour of day"),
):
    """Return crime points for the Deck.gl heatmap layer."""
    df = app_state["crime_df"]

    if crime_type:
        df = df[df["primary_type"].str.upper() == crime_type.upper()]
    if hour is not None:
        df = df[df["date"].dt.hour == hour]

    return {"points": get_heatmap_points(df), "total": len(df)}


@app.get("/crimes/summary")
def crimes_summary():
    """Aggregate crime statistics."""
    return get_crime_summary(app_state["crime_df"])


@app.get("/crimes/types")
def crime_types():
    """List all distinct crime types."""
    df = app_state["crime_df"]
    types = sorted(df["primary_type"].dropna().unique().tolist())
    return {"types": types}


# ── Routing endpoints ─────────────────────────────────────────────────────────
@app.post("/route/compute")
def route_compute(req: RouteRequest):
    """Compute safest, balanced, and fastest routes."""
    G = app_state["graph"]
    try:
        routes = compute_routes(G, req.start_lat, req.start_lng, req.end_lat, req.end_lng)
    except Exception as e:
        logger.error("Routing error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    # Remove raw node lists (too large), keep coords + stats
    return {
        mode: {k: v for k, v in data.items() if k != "nodes"}
        for mode, data in routes.items()
    }


@app.post("/route/narrate")
async def route_narrate(req: NarrateRequest):
    """SSE stream — Gemini narrates each segment of the chosen route."""
    G = app_state["graph"]
    crime_df = app_state["crime_df"]

    try:
        routes = compute_routes(G, req.start_lat, req.start_lng, req.end_lat, req.end_lng)
        route = routes[req.mode]
        node_ids = [c["node_id"] for c in route["coords"]]
        segments = get_segment_crime_data(G, crime_df, node_ids)
    except Exception as e:
        logger.error("Narration setup error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    async def event_stream():
        async for event in narrate_route_stream(
            segments, req.mode, req.start_label, req.end_label
        ):
            yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Demo presets ──────────────────────────────────────────────────────────────
@app.get("/demo/{demo_id}")
def get_demo(demo_id: int):
    """Load a preset demo route."""
    if demo_id not in DEMO_PRESETS:
        raise HTTPException(status_code=404, detail=f"Demo {demo_id} not found")
    return DEMO_PRESETS[demo_id]


@app.get("/demo")
def list_demos():
    """List all available demo routes."""
    return {
        str(k): {"name": v["name"], "description": v["description"]}
        for k, v in DEMO_PRESETS.items()
    }
