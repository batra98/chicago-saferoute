"""
graph_builder.py — Builds and caches a Chicago road network graph
using OSMnx, with crime scores attached to each edge.
"""

import os
import pickle
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import osmnx as ox
import networkx as nx
from scipy.spatial import KDTree
from pyproj import Transformer
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
GRAPH_CACHE = DATA_DIR / "chicago_graph_raw.pkl"
SCORED_GRAPH_CACHE = DATA_DIR / "chicago_graph_scored.pkl"

CRIME_RADIUS_METERS = float(os.getenv("CRIME_RADIUS_METERS", "75"))

# Chicago bounding box (tight)
CHICAGO_PLACE = "Chicago, Illinois, USA"


def _load_or_build_raw_graph() -> nx.MultiDiGraph:
    """Download Chicago road network from OSM or load from cache."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if GRAPH_CACHE.exists():
        logger.info("Loading raw Chicago graph from cache...")
        with open(GRAPH_CACHE, "rb") as f:
            return pickle.load(f)

    logger.info("Downloading Chicago road network from OpenStreetMap (this takes ~2 min)...")
    G = ox.graph_from_place(CHICAGO_PLACE, network_type="drive")
    G = ox.project_graph(G)   # project to UTM — required for nearest_nodes without scikit-learn
    # Keep only the largest strongly connected component — guarantees every pair is reachable
    G = G.subgraph(max(nx.strongly_connected_components(G), key=len)).copy()
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    with open(GRAPH_CACHE, "wb") as f:
        pickle.dump(G, f)
    logger.info("Raw graph saved: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())
    return G


def build_scored_graph(crime_df: pd.DataFrame, force_rebuild: bool = False) -> nx.MultiDiGraph:
    """Attach crime scores to every edge, cache result."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not force_rebuild and SCORED_GRAPH_CACHE.exists():
        logger.info("Loading scored graph from cache...")
        with open(SCORED_GRAPH_CACHE, "rb") as f:
            return pickle.load(f)

    G = _load_or_build_raw_graph()

    # Graph is projected to UTM — reproject crime coords to the same CRS (meters)
    crs = G.graph["crs"]
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    lngs = crime_df["longitude"].values
    lats = crime_df["latitude"].values
    x_utm, y_utm = transformer.transform(lngs, lats)
    crime_coords_utm = np.column_stack([x_utm, y_utm])
    crime_severities = crime_df["severity"].values

    logger.info("Building KD-tree over %d crime incidents (UTM coords)...", len(crime_df))
    tree = KDTree(crime_coords_utm)

    logger.info("Scoring %d edges (radius=%dm)...", G.number_of_edges(), int(CRIME_RADIUS_METERS))
    for u, v, key, data in G.edges(data=True, keys=True):
        # Node x/y are in UTM meters after projection
        u_data = G.nodes[u]
        v_data = G.nodes[v]
        mid_x = (u_data["x"] + v_data["x"]) / 2
        mid_y = (u_data["y"] + v_data["y"]) / 2

        # Query crimes within radius (meters)
        indices = tree.query_ball_point([mid_x, mid_y], CRIME_RADIUS_METERS)
        if indices:
            crime_score = float(np.sum(crime_severities[indices]))
        else:
            crime_score = 0.0

        G[u][v][key]["crime_score"] = crime_score
        G[u][v][key]["crime_count"] = len(indices)

    with open(SCORED_GRAPH_CACHE, "wb") as f:
        pickle.dump(G, f)
    logger.info("Scored graph saved to cache.")
    return G


def get_node_for_location(G: nx.MultiDiGraph, lat: float, lng: float) -> int:
    """Find the nearest graph node to a lat/lng coordinate.
    Graph is projected to UTM so we reproject the lat/lng first.
    """
    crs = G.graph["crs"]
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    x, y = transformer.transform(lng, lat)
    return ox.nearest_nodes(G, X=x, Y=y)
