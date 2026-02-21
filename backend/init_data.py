"""
init_data.py — Run this once to pre-download crime data and build
the scored Chicago road graph. Subsequent server starts use the cache.

Usage:
    uv run python init_data.py
"""

import logging
from crime_data import load_crime_data
from graph_builder import build_scored_graph

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

if __name__ == "__main__":
    logger.info("Step 1/2: Fetching Chicago crime data (last 12 months)...")
    crime_df = load_crime_data(force_refresh=False)
    logger.info("✅ Crime data loaded: %d incidents", len(crime_df))

    logger.info("Step 2/2: Building crime-scored road graph (this takes ~3-5 min first time)...")
    G = build_scored_graph(crime_df, force_rebuild=False)
    logger.info(
        "✅ Graph ready: %d nodes, %d edges",
        G.number_of_nodes(),
        G.number_of_edges(),
    )
    logger.info("🚀 All data cached. You can now run: uv run uvicorn main:app --reload")
