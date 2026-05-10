# Chicago SafeRoute

> A proactive, AI-powered navigation engine that guides you through the safest corridors of Chicago using real-time crime data and Gemini 2.5 voice narration.

## Inspiration
As graduate students, we mostly walk or rely on public transport to get around. While this gives us a great connection to the city, it also comes with a familiar late-night anxiety.

Picture this: You’re on a solo trip or out with friends. It’s 2:00 AM, the club just closed, and you need to get back to your hotel. You pull up a standard navigation app, and it gives you the shortest path. But in a city you don't know, "shortest" often means cutting through a dark alley or a neighborhood with high historical crime rates.

Back in Madison, we are lucky to have the Safewalk team to keep us secure, but when traveling to a new city like Chicago, you don’t always have that safety net. We were inspired by the **City of Chicago Data Portal** to build the digital version of that safety net, transforming raw crime statistics into a proactive, life-saving tool. Our goal was to create a navigator that doesn't just show you where you are, but actively guides you through the safest possible corridors using real-time AI narration.

---

## What It Does
Chicago SafeRoute is a crime-aware navigation application that helps users find the safest walking, biking, or transit paths through the city. Unlike traditional maps that only optimize for speed or distance, SafeRoute analyzes thousands of historical crime records to steer you away from danger.

### Key Features
* **Live Crime Heatmap:** Visualize crime density across Chicago with interactive filters for crime types and a time-of-day slider to see how safety changes from day to night.
* **Safest Route Navigation:** Generates paths using a weighted Dijkstra algorithm that prioritizes well-lit, low-crime corridors, actively comparing them against the "shortest" path.
* **AI Agent Narration:** A live Gemini 2.5 Flash-powered AI "walks" with you, providing real-time voice and text updates on the safety of your current segment and justifying why certain turns were made.
* **Cinematic 3D Traversal:** Follow your route in a high-fidelity Mapbox 3D environment that tracks your progress and highlights nearby incidents in a premium, glassmorphic UI.

---

## Built With
SafeRoute leverages a modern, high-performance tech stack across the frontend, backend, and AI layers:

* **Frontend (App & Routing UI):** **Next.js** and **React** for a reactive, PWA-ready interface; **Tailwind CSS** for the glassmorphic, mobile-first design system; **Mapbox GL JS** for high-performance WebGL 3D map rendering and layer animations.
* **Backend (Routing & Processing):** **Python 3** powered by **FastAPI** for high-throughput, asynchronous API endpoints; **OSMnx** and **NetworkX** for downloading, modeling, and running graph algorithms (Weighted Dijkstra) on Chicago's road network; **SciPy (`cKDTree`)** for hyper-fast spatial indexing and nearest-neighbor crime lookups (mapping 200k+ incidents in milliseconds); **Pandas** for dataset cleaning.
* **AI & Narration Engine:** **Google Gemini 2.5 Flash API** for real-time, context-aware safety summaries and street-level briefings; **Server-Sent Events (SSE)** via FastAPI's `StreamingResponse` to push AI chunks to the client instantly; native **Web Speech API** for robust, client-side text-to-speech fallback and playback.
* **Deployment & Infrastructure:** **Vercel** for automatic Next.js edge deployments and HTTPS/PWA support; **Google Cloud Run** running a custom **Docker** container for the heavily memory-bound Python graph structures; **Google Workload Identity Federation** for keyless CI/CD GitHub Actions.

---

## How We Built It
Chicago SafeRoute is powered by a modern "Twin Engines" architecture:

### 1. The Routing Engine (Backend)
Built with **FastAPI** and **Python**, we utilized **OSMnx** and **NetworkX** to model Chicago’s road network as a highly detailed directed multigraph. We mapped over 200,000 recent crime incidents to these segments using high-performance **KDTree** spatial indexing. 

To calculate the route, we implemented a customized Weighted Dijkstra algorithm. The edge weights are not just physical distance, but a linear combination of normalized distance and normalized crime density, heavily penalizing severe crimes (like battery) over minor ones.

### 2. The Narration Engine (AI & Frontend)
Built with **Next.js**, **React**, and **Tailwind CSS**, the frontend provides a smooth, App-like experience. As you visually "traverse" the route on the Mapbox GL JS map, the backend streams segment-specific safety data via **Server-Sent Events (SSE)**. 

Using **Google Gemini 2.5 Flash**, we built a live "AI Navigator." The AI processes the upcoming street data and generates conversational, real-time briefings—acting as a knowledgeable local friend walking beside you. This narration is played back seamlessly using the native Web Speech API.

---

## Data Science and Algorithms
SafeRoute is built on a foundation of geospatial data science and mathematical optimization:

1. **Graph Theory:** Chicago's road network is modeled as a directed multigraph using OSMnx.
2. **Spatial Indexing:** High-performance radius searches (75m–100m) query incidents in milliseconds using `scipy.spatial.KDTree`.
3. **Feature Engineering & Normalization:**
    * **Severity Multipliers:** Different crimes are weighted by impact (e.g., Homicide = 10x, Battery = 5x, Theft = 1.5x).
    * **Min-Max Scaling:** Both distance and crime scores are normalized to a `[0, 1]` range before being combined.
4. **Weighted Multi-Objective Optimization:** Edge cost is calculated by combining normalized distance and crime score:
   `cost = (alpha * normalized_distance) + (beta * normalized_crime_score)`

---

## Challenges We Ran Into
* **Geospatial Precision:** Mapbox operates in WGS84 (latitude/longitude), but accurate distance and area calculations require projecting into UTM (meters). Building a robust pipeline to snap crime coordinates to the correct network edges without lagging the UI was a significant hurdle.
* **AI Information Overload:** Initially, the LLM was too "chatty," trying to narrate every single 50-meter street segment. We solved this by clustering segments by street name and only pinging the AI when reaching a statistically significant danger zone or making a major turn.
* **Balancing Objectives:** Finding the right `alpha` and `beta` values for our cost function taught us the mathematical art of trade-offs. We had to ensure "safest" didn't result in an absurdly long, zig-zagging detour just to avoid one minor incident.

---

## Accomplishments That We're Proud Of
* **Bridging the Gap:** We successfully transformed a massive, intimidating civic dataset into an intuitive, conversational AI companion that feels human and reassuring. 
* **Real-Time Performance:** Achieving sub-second latency for complex geospatial routing and KDTree incident mapping, allowing for a fluid UI experience.
* **Immersive Design:** Crafting a UI that feels like a premium iOS app, utilizing dynamic map coloring (Neon Cyber Green for night routes) and smooth 3D camera animations.

---

## What We Learned
* **Geospatial Informatics:** Deep experience dealing with coordinate reference systems, map projections, and the complexities of rendering vast amounts of data efficiently on a WebGL canvas.
* **Prompt Engineering for Voice:** Tuning an LLM to output text specifically designed to be *spoken aloud* by a synthetic voice algorithm, ensuring it sounds like a conversation rather than a dense analytical report.

---

## What's Next for SafeRoute
* **City Expansion:** Ingesting live data portals from other major cities like New York, San Francisco, and London.
* **Predictive Temporal Modeling:** Implementing machine learning models that predict crime likelihood based on historical weather patterns, twilight times, and major local events (e.g., post-game traffic).
* **Community Reporting:** Integrating a crowdsourced "Waze-like" feature where users can report poorly lit streets, broken sidewalks, or immediate hazards in real-time.
