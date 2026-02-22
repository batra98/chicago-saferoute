"""
models.py — Pydantic request/response schemas.
"""

from typing import Literal
from pydantic import BaseModel, Field


class Coordinates(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    start_lat: float = Field(..., description="Start latitude")
    start_lng: float = Field(..., description="Start longitude")
    end_lat: float = Field(..., description="End latitude")
    end_lng: float = Field(..., description="End longitude")
    start_label: str = Field(default="Start", description="Human-readable start name")
    end_label: str = Field(default="Destination", description="Human-readable end name")
    category: str | None = Field(None, description="VIOLENT, PROPERTY, or OTHER")
    hour: int | None = Field(None, ge=0, le=23, description="0-23")


class NarrateRequest(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    start_label: str = "Start"
    end_label: str = "Destination"
    mode: Literal["safest", "balanced", "fastest"] = "safest"
    category: str | None = None
    hour: int | None = None


class RouteSegment(BaseModel):
    segment_index: int
    from_coords: Coordinates
    to_coords: Coordinates
    mid_coords: Coordinates
    distance_m: int
    street_name: str
    crime_count: int
    crime_score: float
    crime_summary: dict[str, int]


class RouteResult(BaseModel):
    mode: str
    coords: list[dict]
    distance_m: int
    distance_km: float
    travel_time_min: float
    crime_score: float
    crime_count: int


class RoutesResponse(BaseModel):
    safest: RouteResult
    balanced: RouteResult
    fastest: RouteResult


# Demo presets
DEMO_PRESETS = {
    1: {
        "name": "The Tourist",
        "description": "Millennium Park → Lincoln Park Zoo",
        "start_lat": 41.8826,
        "start_lng": -87.6233,
        "start_label": "Millennium Park",
        "end_lat": 41.9214,
        "end_lng": -87.6337,
        "end_label": "Lincoln Park Zoo",
    },
    2: {
        "name": "The Student",
        "description": "Wicker Park Blue Line → UIC Campus",
        "start_lat": 41.9097,
        "start_lng": -87.6773,
        "start_label": "Wicker Park Blue Line Station",
        "end_lat": 41.8710,
        "end_lng": -87.6500,
        "end_label": "UIC–Halsted Blue Line Station",
    },
    3: {
        "name": "The Night Owl",
        "description": "Logan Square → River North",
        "start_lat": 41.9219,
        "start_lng": -87.7068,
        "start_label": "Logan Square Blue Line",
        "end_lat": 41.8919,
        "end_lng": -87.6323,
        "end_label": "River North (Clark & Ohio)",
    },
}
