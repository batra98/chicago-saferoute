"""
crime_data.py — Fetches + caches Chicago crime data (last 12 months)
from the Chicago Data Portal open API.
"""

import os
import pickle
import logging
from pathlib import Path
from datetime import datetime, timedelta

import requests
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
CRIME_CACHE = DATA_DIR / "crimes_12mo.parquet"
CHICAGO_API_URL = os.getenv(
    "CHICAGO_API_URL",
    "https://data.cityofchicago.org/resource/ijzp-q8t2.json",
)

# Crime type severity weights (for edge scoring)
SEVERITY_WEIGHTS = {
    "HOMICIDE": 10.0,
    "CRIMINAL SEXUAL ASSAULT": 8.0,
    "ROBBERY": 6.0,
    "ASSAULT": 5.0,
    "BATTERY": 4.0,
    "BURGLARY": 3.0,
    "MOTOR VEHICLE THEFT": 2.5,
    "CRIM SEXUAL ASSAULT": 8.0,
    "ARSON": 4.0,
    "KIDNAPPING": 9.0,
    "STALKING": 4.0,
    "THEFT": 1.5,
    "NARCOTICS": 2.0,
    "WEAPONS VIOLATION": 5.0,
}

CRIME_CATEGORIES = {
    "VIOLENT": ["HOMICIDE", "BATTERY", "ASSAULT", "ROBBERY", "WEAPONS VIOLATION", "CRIM SEXUAL ASSAULT", "KIDNAPPING", "OFFENSE INVOLVING CHILDREN"],
    "PROPERTY": ["THEFT", "MOTOR VEHICLE THEFT", "BURGLARY", "CRIMINAL DAMAGE", "DECEPTIVE PRACTICE", "ARSON", "STOLEN PROPERTY"],
    "OTHER": ["NARCOTICS", "CRIMINAL TRESPASS", "PUBLIC PEACE VIOLATION", "LIQUOR LAW VIOLATION", "INTERFERENCE WITH PUBLIC OFFICER", "PROSTITUTION", "STALKING", "INTIMIDATION", "GAMBLING", "OBSCENITY"]
}

# Mapping of a few community area IDs to names for common areas
COMMUNITY_AREA_NAMES = {
    "1": "Rogers Park", "2": "West Ridge", "3": "Uptown", "4": "Lincoln Square", "5": "North Center", "6": "Lake View", "7": "Lincoln Park", "8": "Near North Side", "24": "West Town", "28": "Near West Side", "32": "Loop", "33": "Near South Side", "41": "Hyde Park", "77": "Edgewater"
}

HEATMAP_LIMIT = 50_000  # max incidents for heatmap response


def _fetch_from_api(since_date: str) -> pd.DataFrame:
    """Fetch from Chicago Data Portal Socrata API (paginated)."""
    all_records = []
    limit = 50_000
    offset = 0

    logger.info("Fetching Chicago crime data from API since %s...", since_date)
    while True:
        params = {
            "$limit": limit,
            "$offset": offset,
            "$where": f"date >= '{since_date}' AND latitude IS NOT NULL AND longitude IS NOT NULL",
            "$select": "date,primary_type,latitude,longitude,community_area,description,block,arrest",
            "$order": "date DESC",
        }
        resp = requests.get(CHICAGO_API_URL, params=params, timeout=60)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        all_records.extend(batch)
        offset += limit
        logger.info("  fetched %d records so far...", len(all_records))
        if len(batch) < limit:
            break

    df = pd.DataFrame(all_records)
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude"])
    df["severity"] = df["primary_type"].map(SEVERITY_WEIGHTS).fillna(1.0)
    return df


def load_crime_data(force_refresh: bool = False) -> pd.DataFrame:
    """Load crime data, using cache if available and fresh (< 24h old)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not force_refresh and CRIME_CACHE.exists():
        cache_age = datetime.now().timestamp() - CRIME_CACHE.stat().st_mtime
        if cache_age < 86_400:  # 24 hours
            logger.info("Loading crime data from cache: %s", CRIME_CACHE)
            return pd.read_parquet(CRIME_CACHE)

    since = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%S")
    df = _fetch_from_api(since)
    df.to_parquet(CRIME_CACHE, index=False)
    logger.info("Crime data saved to %s (%d records)", CRIME_CACHE, len(df))
    return df


def get_heatmap_points(df: pd.DataFrame) -> list[dict]:
    """Return a sample of crime points for heatmap rendering."""
    sample = df.sample(min(HEATMAP_LIMIT, len(df)), random_state=42)
    return [
        {
            "lat": row.latitude,
            "lng": row.longitude,
            "weight": row.severity,
            "type": row.primary_type,
            "description": getattr(row, "description", ""),
            "block": getattr(row, "block", ""),
            "date": row.date.strftime("%b %d, %Y • %I:%M %p") if hasattr(row, "date") else "",
        }
        for row in sample.itertuples()
    ]


def get_crime_summary(df: pd.DataFrame) -> dict:
    """Top-level stats for the sidebar."""
    return {
        "total_incidents": len(df),
        "date_range": {
            "from": df["date"].min().isoformat() if not df.empty else None,
            "to": df["date"].max().isoformat() if not df.empty else None,
        },
        "by_type": (
            df.groupby("primary_type")
            .size()
            .sort_values(ascending=False)
            .head(10)
            .to_dict()
        ),
        "by_hour": (
            df["date"].dt.hour.value_counts().sort_index().to_dict()
            if "date" in df.columns
            else {}
        ),
    }


def get_neighborhood_safety(df: pd.DataFrame, lat: float, lng: float) -> dict:
    """Find the safety score for the local area near lat/lng."""
    # 1. Radius search (~1km)
    # Approx 0.01 deg is ~1.1km
    deg_radius = 0.01
    mask = (
        (df["latitude"] > lat - deg_radius) & (df["latitude"] < lat + deg_radius) &
        (df["longitude"] > lng - deg_radius) & (df["longitude"] < lng + deg_radius)
    )
    local_df = df[mask]
    
    if local_df.empty:
        return {"score": 0, "rating": "Unknown", "name": "Unknown", "incident_count": 0}
    
    # Get community area if available
    ca_id = str(local_df["community_area"].iloc[0]) if "community_area" in local_df.columns and not local_df["community_area"].empty else "unknown"
    ca_name = COMMUNITY_AREA_NAMES.get(ca_id, f"Area {ca_id}")

    # Calculate score based on density and severity
    # We'll normalize relative to some "high" density.
    # A "Moderate" score might be ~50-100 incidents per sq km per year.
    count = len(local_df)
    total_severity = local_df["severity"].sum()
    
    # Heuristic scoring (0-100, 100 is best)
    # Higher density/severity reduces score
    # Use square-root scaling for better distribution; 30,000 severity = 0 score.
    # Median severity (~5500) will result in a score of ~57.
    penalty = 100 * ((total_severity / 30000) ** 0.5)
    score = max(0, min(100, 100 - penalty))
    
    rating = "Safe"
    if score < 40: rating = "High Risk"
    elif score < 70: rating = "Moderate"
    
    return {
        "score": round(score),
        "rating": rating,
        "name": ca_name,
        "incident_count": count
    }
