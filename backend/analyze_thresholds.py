import pandas as pd
import numpy as np
import math
from crime_data import load_crime_data, COMMUNITY_AREA_NAMES

df = load_crime_data()

# We need to simulate the "radius search" at many points to see the distribution of total_severity
# Let's take a sample of community areas or a grid
sample_points = df.sample(1000)[['latitude', 'longitude']].values

severities = []
deg_radius = 0.01

for lat, lng in sample_points:
    mask = (
        (df["latitude"] > lat - deg_radius) & (df["latitude"] < lat + deg_radius) &
        (df["longitude"] > lng - deg_radius) & (df["longitude"] < lng + deg_radius)
    )
    local_df = df[mask]
    if not local_df.empty:
        severities.append(local_df["severity"].sum())

print(f"Count: {len(severities)}")
print(f"Min: {np.min(severities)}")
print(f"Max: {np.max(severities)}")
print(f"Median: {np.median(severities)}")
print(f"75th percentile: {np.percentile(severities, 75)}")
print(f"90th percentile: {np.percentile(severities, 90)}")
print(f"95th percentile: {np.percentile(severities, 95)}")

# Current log scale: penalty = 15 * math.log10(total_severity + 1)
median_severity = np.median(severities)
print(f"Current score at median: {100 - 15 * math.log10(median_severity + 1)}")
