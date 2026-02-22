"""
agent.py — Gemini AI agent that narrates a route segment by segment,
streaming SSE events to the frontend.
"""

import os
import json
import logging
from typing import AsyncIterator

from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

SYSTEM_PROMPT = """You are the internal 'Decision Engine' of a Chicago safe-routing app, speaking directly to the user as you guide them.
I will give you a street segment on the route we chose, nearby crime data, AND the alternative streets we avoided at this intersection.
Your job is to explain *why* we are walking down this specific street. You are actively analyzing the environment to keep them safe.

IMPORTANT: You MUST ground your reasoning in facts and exact statistics. Use the specific crime numbers to justify your route choice, and EXPLICITLY compare your choice to the alternatives provided. DO NOT invent numbers or street names.

Examples of what you SHOULD sound like:
- "We're taking Columbus here because it only has 2 reported thefts, whereas avoiding Michigan Ave saved us from 15 recent incidents."
- "I routed us down State Street; it's the safest way through, avoiding the 8 batteries reported on Wabash."
- "We're sticking to this path because it's completely clear of recent incidents. Zero crimes reported here, making it the optimal choice over the parallel streets."

RULES:
1. Always write full, complete sentences.
2. Keep it to 1 sentence, maximum 2.
3. Frame your sentence as an active, calculated decision you made for the user's safety: "We're taking...", "I routed us...", "I chose this path..."
4. Explicitly compare the exact crime numbers of the street you chose versus the avoided alternatives IF alternative data is provided.
5. LOGICAL CONSISTENCY: NEVER call a path "safer" if it has MORE crimes than the avoided alternative. If you choose a street with more crimes (e.g., because it's a major thoroughfare or shorter), justify it as "the most direct safe-enough path" or "a calculated balance of efficiency and safety."
6. NEVER start a sentence with "Heads up" or "Just a heads up". Ban those phrases entirely.
7. Only output the exact string "SKIP" if you feel you've already talked too much recently on similar types of streets.
8. CRITICAL: NEVER apologize or say you cannot fulfill the request. If alternative street data is missing, simply justify the choice by saying it is the shortest safe path."""

# We want the agent to narrate almost every major street now since it's explaining the route, 
# so lower the threshold considerably (0 means it considers narrating everywhere, though it can still choose to SKIP)
MIN_CRIME_THRESHOLD = 0


def _build_segment_prompt(segment: dict, segment_num: int, total: int) -> str:
    street = segment.get("street_name", "this segment")
    crime_count = segment.get("crime_count", 0)
    crime_summary = segment.get("crime_summary", {})
    top_crime = list(crime_summary.keys())[0] if crime_summary else "none"
    
    avoided_alts = segment.get("avoided_alternatives", [])
    
    if avoided_alts:
        alt_strs = []
        for alt in avoided_alts:
            alt_name = alt.get("street_name", "an alternative")
            alt_count = alt.get("crime_count", 0)
            alt_strs.append(f"{alt_name} ({alt_count} crimes)")
        alt_context = f" At this turn, we avoided: {', '.join(alt_strs)}. Explain to the user WHY we chose this path, explicitly comparing our choice to the avoided alternatives."
    else:
        alt_context = f" We don't have alternative street data for this turn. Justify why {street} is a good safe choice based on its low crime count."

    return (
        f"We are routing the user down {street}. The data shows exactly {crime_count} recent reports, "
        f"mostly {top_crime}.{alt_context} "
    )


async def narrate_route_stream(
    segments: list[dict],
    route_mode: str,
    start_label: str,
    end_label: str,
    comparison_stats: dict | None = None,
) -> AsyncIterator[str]:
    """
    Stream Gemini narration for noteworthy route segments only.
    Yields SSE-formatted strings.
    """
    total = len(segments)

    # Brief intro
    intro = f"SafeRoute — {route_mode.upper()} mode. {start_label} → {end_label}. Analyzing {total} segments."
    yield _sse_event("intro", {"text": intro, "segment_index": -1})

    narrated_streets: set[str] = set()
    
    # Calculate max crime per street first so we know when to narrate
    street_max_crimes = {}
    for s in segments:
        st = s.get("street_name", "unknown")
        if isinstance(st, list): st = st[0] if st else "unknown"
        street_max_crimes[str(st)] = max(street_max_crimes.get(str(st), 0), s.get("crime_count", 0))

    seg_index = 0
    for s in segments:
        street = s.get("street_name", "unknown")
        if isinstance(street, list): street = street[0] if street else "unknown"
        street = str(street)
        
        crime_count = s.get("crime_count", 0)
        max_crime_on_street = street_max_crimes.get(street, crime_count)

        should_narrate = (
            max_crime_on_street >= MIN_CRIME_THRESHOLD and
            street not in narrated_streets and
            crime_count == max_crime_on_street # Narrate when we actually hit the worst segment of that street
        )

        full_text = ""
        if should_narrate:
            narrated_streets.add(street)
            prompt = _build_segment_prompt(s, seg_index, total)

            try:
                resp = await client.aio.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.7,
                        max_output_tokens=4000,
                        safety_settings=[
                            types.SafetySetting(
                                category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                                threshold=types.HarmBlockThreshold.BLOCK_NONE,
                            ),
                            types.SafetySetting(
                                category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                                threshold=types.HarmBlockThreshold.BLOCK_NONE,
                            ),
                            types.SafetySetting(
                                category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                                threshold=types.HarmBlockThreshold.BLOCK_NONE,
                            ),
                            types.SafetySetting(
                                category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                                threshold=types.HarmBlockThreshold.BLOCK_NONE,
                            ),
                        ],
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                        tool_config=types.ToolConfig(
                            function_calling_config=types.FunctionCallingConfig(mode="NONE")
                        ),
                    ),
                )
                full_text = resp.text or ""
            except Exception as e:
                logger.error("Gemini error on street %s: %s", street, e)

            if full_text.strip().upper().startswith("SKIP"):
                full_text = ""

        yield _sse_event("segment_done", {
            "segment_index": seg_index,
            "full_narration": full_text.strip(),
            "crime_count": crime_count,
            "crime_score": s["crime_score"],
            "coords": s["mid_coords"],
            "from_coords": s["from_coords"],
            "to_coords": s["to_coords"],
            "path_coords": s.get("path_coords"),
            "incidents": s.get("incidents", []),
            "avoided_alternatives": s.get("avoided_alternatives", []),
        })
        seg_index += 1

    # Final summary — use a plain prompt so it never SKIPs
    stats_context = ""
    if comparison_stats:
        extra_time = comparison_stats.get("extra_time_min", 0)
        crimes_avoided = comparison_stats.get("crimes_avoided_score", 0)
        stats_context = (
            f" IMPORTANT: Mention that this safest route added approximately {extra_time} extra minutes "
            f"compared to the direct path, but successfully avoided areas with a combined crime severity score of {crimes_avoided}. "
            f"Frame this as a deliberate, smart safety trade-off."
        )

    summary_prompt = (
        f"In 1-2 sentences, give an honest safety verdict for this {route_mode} journey "
        f"from {start_label} to {end_label}. {stats_context} "
        f"Take a holistic view of the entire path: "
        f"if it involves trains (like the Blue Line), acknowledge the transition between transit and walking. "
        f"Identify the single most critical street segment or area where they should be highest alert. "
        f"Sound like a street-smart local giving a friend the real talk, not a formal report."
    )
    summary_text = ""
    try:
        # Use a fresh call without the SKIP system prompt for the summary
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=summary_prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4000,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                tool_config=types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(mode="NONE")
                ),
            ),
        )
        summary_text = response.text or ""
    except Exception as e:
        logger.error("Gemini summary error: %s", e)

    yield _sse_event("done", {"summary": summary_text.strip()})


async def _stream_gemini(prompt: str):
    """Yield text chunks from Gemini streaming response."""
    response = await client.aio.models.generate_content_stream(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.7,
            max_output_tokens=4000,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(mode="NONE")
            ),
        ),
    )
    async for chunk in response:
        if chunk.text:
            yield chunk.text


def _sse_event(event_type: str, data: dict) -> str:
    """Format as SSE event string."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
