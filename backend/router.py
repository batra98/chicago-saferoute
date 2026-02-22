"""
router.py — Crime-weighted shortest path computation using Dijkstra.
Supports three modes: safest, balanced, fastest.
"""

import logging
import os
from typing import Literal

import networkx as nx
import osmnx as ox
import numpy as np
from pyproj import Transformer

from graph_builder import get_node_for_location

logger = logging.getLogger(__name__)

RouteMode = Literal["safest", "balanced", "fastest"]

MODE_WEIGHTS: dict[RouteMode, tuple[float, float]] = {
    #                alpha (distance), beta (crime)
    "safest":   (0.2, 0.8),
    "balanced": (0.5, 0.5),
    "fastest":  (0.8, 0.2),
}

_transformer_cache: dict[str, Transformer] = {}

def _get_transformer(crs: str) -> Transformer:
    """Cache UTM→WGS84 transformers per CRS string."""
    if crs not in _transformer_cache:
        _transformer_cache[crs] = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    return _transformer_cache[crs]


def _node_lnglat(G: nx.MultiDiGraph, node_id: int) -> tuple[float, float]:
    """Return (lng, lat) in WGS84 for a projected graph node."""
    nd = G.nodes[node_id]
    crs = G.graph.get("crs", "EPSG:4326")
    if crs == "EPSG:4326":
        return nd["x"], nd["y"]
    t = _get_transformer(crs)
    lng, lat = t.transform(nd["x"], nd["y"])
    return lng, lat


def _compute_edge_weight(G: nx.MultiDiGraph, alpha: float, beta: float) -> dict:
    """
    For each edge compute: weight = alpha * norm_distance + beta * norm_crime
    Returns edge weight dict keyed by (u, v, key).
    """
    # Gather all raw values for normalization
    distances = []
    crimes = []
    for u, v, key, data in G.edges(data=True, keys=True):
        distances.append(data.get("length", 1.0))
        crimes.append(data.get("crime_score", 0.0))

    max_dist = max(distances) if distances else 1.0
    max_crime = max(crimes) if crimes else 1.0
    if max_crime == 0:
        max_crime = 1.0

    weights = {}
    for u, v, key, data in G.edges(data=True, keys=True):
        norm_d = data.get("length", 1.0) / max_dist
        norm_c = data.get("crime_score", 0.0) / max_crime
        weights[(u, v, key)] = alpha * norm_d + beta * norm_c + 1e-6  # avoid zero
    return weights


def compute_routes(
    G: nx.MultiDiGraph,
    crime_df: any, # pd.DataFrame
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    category: str | None = None,
    hour: int | None = None,
) -> dict:
    """
    Compute both the safest and shortest routes.
    Returns route metadata + coordinates for both, plus comparison stats.
    """
    origin = get_node_for_location(G, start_lat, start_lng)
    destination = get_node_for_location(G, end_lat, end_lng)

    # 1. Compute SHORTEST path (baseline)
    logger.info("Computing shortest path baseline...")
    shortest_path_nodes = nx.shortest_path(G, origin, destination, weight="length")
    
    shortest_dist = 0.0
    shortest_crime_score = 0.0
    shortest_coords = []
    for i, node in enumerate(shortest_path_nodes):
        lng, lat = _node_lnglat(G, node)
        shortest_coords.append({"lat": lat, "lng": lng})
        if i < len(shortest_path_nodes) - 1:
            next_node = shortest_path_nodes[i+1]
            edata = G[node][next_node][min(G[node][next_node], key=lambda k: G[node][next_node][k].get("length", 1e9))]
            shortest_dist += edata.get("length", 0)
            shortest_crime_score += edata.get("crime_score", 0)

    # 2. Compute SAFEST path (using alpha/beta)
    mode = "safest"
    alpha, beta = MODE_WEIGHTS[mode]
    logger.info("Computing safest route...")

    # Build weight dict for safest path
    if category or hour is not None:
        from crime_data import CRIME_CATEGORIES
        logger.info("Applying dynamic filters to routing: category=%s, hour=%s", category, hour)
        df = crime_df
        if category:
            cat_upper = category.upper()
            if cat_upper in CRIME_CATEGORIES:
                df = df[df["primary_type"].str.upper().isin(CRIME_CATEGORIES[cat_upper])]
        if hour is not None:
            df = df[df["date"].dt.hour == hour]
        
        from scipy.spatial import KDTree
        crs = G.graph["crs"]
        transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        x_utm, y_utm = transformer.transform(df["longitude"].values, df["latitude"].values)
        tree = KDTree(np.column_stack([x_utm, y_utm]))
        crime_severities = df["severity"].values
        
        dynamic_crime_scores = {}
        radius = float(os.getenv("CRIME_RADIUS_METERS", "75"))
        
        for u, v, key, data in G.edges(data=True, keys=True):
            mid_x = (G.nodes[u]["x"] + G.nodes[v]["x"]) / 2
            mid_y = (G.nodes[u]["y"] + G.nodes[v]["y"]) / 2
            indices = tree.query_ball_point([mid_x, mid_y], radius)
            dynamic_crime_scores[(u, v, key)] = float(np.sum(crime_severities[indices])) if indices else 0.0

        distances = [d.get("length", 1.0) for _, _, _, d in G.edges(data=True, keys=True)]
        crimes = list(dynamic_crime_scores.values())
        max_dist = max(distances) if distances else 1.0
        max_crime = max(crimes) if crimes else 1.0
        if max_crime == 0: max_crime = 1.0
        
        edge_weights = {}
        for u, v, key, data in G.edges(data=True, keys=True):
            norm_d = data.get("length", 1.0) / max_dist
            norm_c = dynamic_crime_scores[(u, v, key)] / max_crime
            edge_weights[(u, v, key)] = alpha * norm_d + beta * norm_c + 1e-6
    else:
        edge_weights = _compute_edge_weight(G, alpha, beta)

    def weight_fn(u, v, data):
        return min(edge_weights.get((u, v, k), 1e9) for k in data)

    path_nodes = nx.shortest_path(G, origin, destination, weight=weight_fn)

    # Collect safest route stats
    total_distance = 0.0
    total_crime_score = 0.0
    total_crime_count = 0
    coords = []
    edge_scores = []

    for i, node in enumerate(path_nodes):
        lng, lat = _node_lnglat(G, node)
        coords.append({"lat": lat, "lng": lng, "node_id": node})

        if i < len(path_nodes) - 1:
            next_node = path_nodes[i + 1]
            edge_data = G[node][next_node]
            best_key = min(edge_data, key=lambda k: edge_data[k].get("length", 1e9))
            edata = edge_data[best_key]
            total_distance += edata.get("length", 0)
            total_crime_score += edata.get("crime_score", 0)
            total_crime_count += edata.get("crime_count", 0)
            edge_scores.append(float(edata.get("crime_score", 0)))
        else:
            edge_scores.append(0.0)

    # Normalize safest path scores
    max_score = max(edge_scores) if edge_scores else 1.0
    if max_score == 0: max_score = 1.0
    for c, score in zip(coords, edge_scores):
        c["crime_score_norm"] = round(score / max_score, 3)

    # 3. Calculate Comparison Stats
    travel_time_min = (total_distance / 1000) / 25 * 60
    shortest_time_min = (shortest_dist / 1000) / 25 * 60
    
    extra_dist = max(0, total_distance - shortest_dist)
    extra_time = max(0.0, travel_time_min - shortest_time_min)
    crimes_avoided_score = max(0.0, shortest_crime_score - total_crime_score)

    return {
        "mode": mode,
        "coords": coords,
        "shortest_coords": shortest_coords,
        "distance_m": round(total_distance),
        "travel_time_min": round(travel_time_min, 1),
        "crime_score": round(total_crime_score, 2),
        "comparison": {
            "extra_distance_m": round(extra_dist),
            "extra_time_min": round(extra_time, 1),
            "crimes_avoided_score": round(crimes_avoided_score, 2),
            "shortest_distance_m": round(shortest_dist),
        }
    }


def get_segment_crime_data(
    G: nx.MultiDiGraph,
    crime_df,
    path_nodes: list[int],
    radius_m: float = 100,
    category: str | None = None,
    hour: int | None = None,
) -> list[dict]:
    """
    For each consecutive pair of nodes (segment) in a path,
    return nearby crime data — used by the Gemini agent narrator.
    """
    from scipy.spatial import KDTree
    import pandas as pd

    crs = G.graph.get("crs", "EPSG:4326")
    t = _get_transformer(crs) if crs != "EPSG:4326" else None

    # Apply filters to the crime_df used for narration/segment analysis
    if category or hour is not None:
        from crime_data import CRIME_CATEGORIES
        if category:
            cat_upper = category.upper()
            if cat_upper in CRIME_CATEGORIES:
                crime_df = crime_df[crime_df["primary_type"].str.upper().isin(CRIME_CATEGORIES[cat_upper])]
        if hour is not None:
            crime_df = crime_df[crime_df["date"].dt.hour == hour]

    tree = KDTree(crime_df[["latitude", "longitude"]].values)
    radius_deg = radius_m / 111_000
    segments = []

    for i in range(len(path_nodes) - 1):
        u = path_nodes[i]
        v = path_nodes[i + 1]

        # Reproject UTM → WGS84 for both nodes
        u_lng, u_lat = _node_lnglat(G, u)
        v_lng, v_lat = _node_lnglat(G, v)

        mid_lat = (u_lat + v_lat) / 2
        mid_lng = (u_lng + v_lng) / 2

        # KDTree is in lat/lng space so query with lat/lng midpoint
        indices = tree.query_ball_point([mid_lat, mid_lng], radius_deg)
        nearby = crime_df.iloc[indices] if indices else pd.DataFrame()

        # Summarize by type
        crime_summary = {}
        incidents = []
        if not nearby.empty:
            crime_summary = nearby["primary_type"].value_counts().head(5).to_dict()
            # Extract up to 50 raw coordinates for frontend pulse markers
            for _, row in nearby.head(50).iterrows():
                incidents.append({
                    "lat": row["latitude"],
                    "lng": row["longitude"],
                    "type": row["primary_type"],
                    "date": str(row.get("date", "Recent"))
                })

        edge_data = G[u][v]
        best_key = min(edge_data, key=lambda k: edge_data[k].get("length", 1e9))
        edata = edge_data[best_key]

        # Extract full geometry if available (for curved roads)
        path_coords = []
        if "geometry" in edata:
            # edata["geometry"] is a Shapely LineString in the graph's projected CRS (UTM typically)
            for x, y in edata["geometry"].coords:
                if t:
                    try:
                        plng, plat = t.transform(x, y)
                    except Exception:
                        plng, plat = x, y
                    path_coords.append({"lat": plat, "lng": plng})
                else:
                    path_coords.append({"lat": y, "lng": x})
        else:
            path_coords = [{"lat": u_lat, "lng": u_lng}, {"lat": v_lat, "lng": v_lng}]

        # --- AVOIDED ALTERNATIVES EXTRACTION ---
        # Look at out-edges from `u` that do NOT go to `v`
        avoided_alternatives = []
        out_edges = list(G.out_edges(u, data=True))
        
        for alt_u, alt_v, alt_data in out_edges:
            if alt_v != v:
                alt_name = alt_data.get("name")
                if isinstance(alt_name, list):
                     alt_name = alt_name[0]
                if alt_name and alt_name != edata.get("name"):
                    # Calculate approximate crime on this alternative path
                    alt_v_lng, alt_v_lat = _node_lnglat(G, alt_v)
                    alt_mid_lat = (u_lat + alt_v_lat) / 2
                    alt_mid_lng = (u_lng + alt_v_lng) / 2
                    
                    alt_indices = tree.query_ball_point([alt_mid_lat, alt_mid_lng], radius_deg)
                    alt_count = len(alt_indices)
                    
                    alt_summary = {}
                    if alt_indices:
                        alt_nearby = crime_df.iloc[alt_indices]
                        alt_summary = alt_nearby["primary_type"].value_counts().head(3).to_dict()
                        
                    avoided_alternatives.append({
                        "street_name": alt_name,
                        "crime_count": alt_count,
                        "crime_summary": alt_summary,
                        "to_coords": {"lat": alt_v_lat, "lng": alt_v_lng}
                    })
                    
                    if len(avoided_alternatives) >= 2:
                        break # Only need 1 or 2 for context

        segments.append({
            "segment_index": i,
            "from_node": u,
            "to_node": v,
            "from_coords": {"lat": u_lat, "lng": u_lng},
            "to_coords": {"lat": v_lat, "lng": v_lng},
            "mid_coords": {"lat": mid_lat, "lng": mid_lng},
            "path_coords": path_coords,
            "distance_m": round(edata.get("length", 0)),
            "street_name": (
                edata.get("name")[0] if isinstance(edata.get("name"), list) 
                else edata.get("name", "this segment")
            ) if edata.get("name") else "this segment",
            "crime_count": len(indices),
            "crime_score": round(edata.get("crime_score", 0), 2),
            "crime_summary": crime_summary,
            "incidents": incidents,
            "avoided_alternatives": avoided_alternatives,
        })

    return segments
