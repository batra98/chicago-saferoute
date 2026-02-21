"""
router.py — Crime-weighted shortest path computation using Dijkstra.
Supports three modes: safest, balanced, fastest.
"""

import logging
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
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
) -> dict[RouteMode, dict]:
    """
    Compute Dijkstra routes for all three modes.
    Returns route metadata + node coordinates for each mode.
    """
    origin = get_node_for_location(G, start_lat, start_lng)
    destination = get_node_for_location(G, end_lat, end_lng)

    results = {}

    for mode, (alpha, beta) in MODE_WEIGHTS.items():
        logger.info("Computing %s route...", mode)

        # Build weight dict for this mode
        edge_weights = _compute_edge_weight(G, alpha, beta)

        def weight_fn(u, v, data):
            # MultiDiGraph: data is a dict of key → edge_attr
            # Pick the key with lowest weight
            best = min(
                edge_weights.get((u, v, k), 1e9) for k in data
            )
            return best

        path_nodes = nx.shortest_path(G, origin, destination, weight=weight_fn)

        # Collect route stats + per-edge crime scores
        total_distance = 0.0
        total_crime_score = 0.0
        total_crime_count = 0
        coords = []
        edge_scores: list[float] = []

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
                edge_scores.append(0.0)  # last node has no outgoing edge

        # Normalize crime scores to 0-1 for gradient coloring
        max_score = max(edge_scores) if edge_scores else 1.0
        if max_score == 0:
            max_score = 1.0
        for c, score in zip(coords, edge_scores):
            c["crime_score_norm"] = round(score / max_score, 3)

        travel_time_min = (total_distance / 1000) / 25 * 60  # ~25 km/h urban

        results[mode] = {
            "mode": mode,
            "nodes": path_nodes,
            "coords": coords,
            "distance_m": round(total_distance),
            "distance_km": round(total_distance / 1000, 2),
            "travel_time_min": round(travel_time_min, 1),
            "crime_score": round(total_crime_score, 2),
            "crime_count": total_crime_count,
        }

    return results


def get_segment_crime_data(
    G: nx.MultiDiGraph,
    crime_df,
    path_nodes: list[int],
    radius_m: float = 100,
) -> list[dict]:
    """
    For each consecutive pair of nodes (segment) in a path,
    return nearby crime data — used by the Gemini agent narrator.
    """
    from scipy.spatial import KDTree
    import pandas as pd

    crs = G.graph.get("crs", "EPSG:4326")
    t = _get_transformer(crs) if crs != "EPSG:4326" else None

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
                    plng, plat = t.transform(x, y)
                    path_coords.append({"lat": plat, "lng": plng})
                else:
                    path_coords.append({"lat": y, "lng": x})
        else:
            path_coords = [{"lat": u_lat, "lng": u_lng}, {"lat": v_lat, "lng": v_lng}]

        segments.append({
            "segment_index": i,
            "from_node": u,
            "to_node": v,
            "from_coords": {"lat": u_lat, "lng": u_lng},
            "to_coords": {"lat": v_lat, "lng": v_lng},
            "mid_coords": {"lat": mid_lat, "lng": mid_lng},
            "path_coords": path_coords,
            "distance_m": round(edata.get("length", 0)),
            "street_name": edata.get("name", "Unknown St"),
            "crime_count": len(indices),
            "crime_score": round(edata.get("crime_score", 0), 2),
            "crime_summary": crime_summary,
            "incidents": incidents,
        })

    return segments
