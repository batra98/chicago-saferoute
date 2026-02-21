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

SYSTEM_PROMPT = """You are a safety-aware, street-smart local friend from Chicago walking a route with the user.
When given a street segment with nearby crime data, give a brief, natural heads-up. 
Sound like a real human walking next to them — conversational, varied, and context-aware.

RULES:
- Respond with SKIP if and only if the segment is genuinely unremarkable (low incident count, no violent crime).
- When you DO speak: 1-2 sentences max. Use an engaging, conversational tone.
- CRITICAL: NEVER start a sentence with "Heads up" or "Just a heads up". Ban those phrases entirely.
- VARY YOUR PHRASING. Sometimes give a tactical tip ("Keep your phone pocketed here"), sometimes mention the specific vibe ("This stretch of {street} gets sketchy at night due to robberies"), sometimes just be direct.
- Mention the dominant crime type natively in the sentence without sounding like a stats readout.
- No filler phrases like "As we continue..." or "Moving along..."
- Use 🚨 only for genuinely high-risk (lots of violent crime)."""


# Only call Gemini for segments above this incident count
MIN_CRIME_THRESHOLD = 10


def _build_segment_prompt(segment: dict, segment_num: int, total: int) -> str:
    street = segment.get("street_name", "this segment")
    crime_count = segment.get("crime_count", 0)
    crime_summary = segment.get("crime_summary", {})
    distance = segment.get("distance_m", 0)

    # Lead with the dominant crime type for better Gemini context
    top_crime = list(crime_summary.keys())[0] if crime_summary else "various crimes"
    other_crimes = (
        ", ".join(f"{v} {k.lower()}" for k, v in list(crime_summary.items())[1:3])
        if len(crime_summary) > 1 else ""
    )
    crimes_str = f"{crime_summary.get(top_crime, crime_count)} {top_crime.lower()}"
    if other_crimes:
        crimes_str += f", also {other_crimes}"

    return (
        f"Street: {street} ({distance}m). "
        f"{crime_count} incidents within 100m — primarily {crimes_str}. "
        f"Give a natural, specific heads-up for someone walking this right now, or SKIP."
    )


async def narrate_route_stream(
    segments: list[dict],
    route_mode: str,
    start_label: str,
    end_label: str,
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
                        max_output_tokens=500,
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
        })
        seg_index += 1

    # Final summary — use a plain prompt so it never SKIPs
    summary_prompt = (
        f"In 1-2 sentences, give an honest safety verdict for this {route_mode} route "
        f"from {start_label} to {end_label}. Mention the riskiest stretch and "
        f"whether the route is overall reasonable. Sound like a knowledgeable local, not a report."
    )
    summary_text = ""
    try:
        # Use a fresh call without the SKIP system prompt for the summary
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=summary_prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=250,
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
            max_output_tokens=300,   # 2 full sentences comfortably
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
