"""
agent.py — Gemini AI agent that narrates a route segment by segment,
streaming SSE events to the frontend.
"""

import os
import json
import logging
import base64
import asyncio
from typing import AsyncIterator

import struct
import io
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

SYSTEM_PROMPT = """You are a smooth, street-smart Chicago pacing companion guiding a user along a walking route.
I will give you a street segment on the current route, nearby crime data, AND the alternative streets we consciously avoided at this intersection.

Your job is to provide exactly ONE flowing, conversational sentence observing the current environment or explaining why we turned here.

IMPORTANT: You MUST ground your reasoning in facts and exact statistics without sounding like a robot reading a spreadsheet. 

Examples of what you SHOULD sound like:
- "Sticking to Columbus here keeps us clear of the recent thefts reported over on Michigan Ave."
- "Wabash has seen a few batteries lately, so State Street is a much smoother path for us."
- "Quiet stretch here on Oakley, completely clear of any recent incidents."

RULES:
1. ALWAYS write full, flowing, conversational sentences. Maximum 1 sentence.
2. BAN repetitive robotic openings. NEVER start your sentence with "I've routed us down...", "We're taking...", "I chose this path...", or "We're continuing on...".
3. BAN the phrases "Heads up", "Just a heads up", or "Zero crimes".
4. If there is an avoided alternative provided, casually mention the crime we avoided by taking our current path.
5. If there are no alternatives provided, just make a brief, reassuring observation about the calmness of the current street.
6. Speak as a companion walking alongside them, not a computer interface.
7. CRITICAL: Only output the exact string "SKIP" if you feel you have nothing uniquely valuable to say right now, or if you've already reassured them enough recently.
"""

# Thresholds for when we should proactively talk
MIN_CRIME_THRESHOLD = 0

def _is_segment_noteworthy(segment: dict) -> bool:
    """
    Determine if a segment is actually worth sending to the LLM.
    Silence is golden: if this street and its alternatives both have 0 crimes, say nothing.
    """
    crime_count = segment.get("crime_count", 0)
    if crime_count > 0:
        return True # Danger on our actual path is noteworthy
    
    alts = segment.get("avoided_alternatives", [])
    for alt in alts:
        if alt.get("crime_count", 0) > 0:
            return True # We actively avoided danger, this is noteworthy
            
    return False # 0 crimes here, 0 crimes around us. Just walk in silence.


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

def pcm_to_wav(pcm_data: bytes, sample_rate=24000, channels=1, bit_depth=16) -> bytes:
    """Wraps raw PCM L16 data in a standard WAV header."""
    byte_rate = sample_rate * channels * (bit_depth // 8)
    block_align = channels * (bit_depth // 8)
    
    header = io.BytesIO()
    header.write(b'RIFF')
    header.write(struct.pack('<I', 36 + len(pcm_data)))
    header.write(b'WAVE')
    header.write(b'fmt ')
    header.write(struct.pack('<I', 16))
    header.write(struct.pack('<H', 1)) # PCM format
    header.write(struct.pack('<H', channels))
    header.write(struct.pack('<I', sample_rate))
    header.write(struct.pack('<I', byte_rate))
    header.write(struct.pack('<H', block_align))
    header.write(struct.pack('<H', bit_depth))
    header.write(b'data')
    header.write(struct.pack('<I', len(pcm_data)))
    return header.getvalue() + pcm_data

async def generate_narrator_audio(text: str, voice_id: str | None = None) -> str | None:
    """
    Generates speech using Gemini Native TTS.
    Returns base64 encoded audio string (WAV).
    """
    if not text:
        return None
        
    # Default to Gemini 2.5 Native TTS (Unlimited Free Tier for Hackathon)
    try:
        # Map human-friendly names to Gemini personas
        voice_map = {"George": "Puck", "Callum": "Charon", "Charlie": "Aoede", "Rachel": "Kore"}
        gemini_voice = voice_map.get(voice_id, "Puck") if voice_id else "Puck"

        def _call_gemini_tts():
            resp = client.models.generate_content(
                model='gemini-2.5-flash-preview-tts',
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=['AUDIO'],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=gemini_voice)
                        )
                    )
                )
            )
            parts = [p for p in resp.candidates[0].content.parts if p.inline_data]
            if not parts: return None
            # Gemini returns raw 24kHz PCM. Convert to playable WAV.
            return pcm_to_wav(parts[0].inline_data.data)

        audio_data = await asyncio.wait_for(asyncio.to_thread(_call_gemini_tts), timeout=8.0)
        if audio_data:
            return base64.b64encode(audio_data).decode('utf-8')
    except Exception as e:
        logger.error(f"Gemini TTS error: {e}")
            
    return None

async def narrate_route_stream(
    segments: list[dict],
    route_mode: str,
    start_label: str,
    end_label: str,
    comparison_stats: dict | None = None,
    voice_id: str | None = None,
) -> AsyncIterator[str]:
    """
    Stream Gemini narration for noteworthy route segments only.
    Yields SSE-formatted strings.
    """
    total = len(segments)

    intro = f"Charting a clear course from {start_label} to {end_label}. I'm tracking {total} blocks ahead to ensure a safe journey."
    yield _sse_event("intro", {
        "text": intro, 
        "segment_index": -1,
        "audio_base64": await generate_narrator_audio(intro, voice_id)
    })

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
            _is_segment_noteworthy(s) and
            street not in narrated_streets and
            crime_count == max_crime_on_street # Narrate when we actually hit the worst segment of that street
        )

        full_text = ""
        if should_narrate:
            narrated_streets.add(street)
            prompt = _build_segment_prompt(s, seg_index, total)

            try:
                # We use the sync client running in a separate thread so it doesn't block the main event loop
                # This guarantees `asyncio.wait_for` can actually interrupt a hung socket.
                def _call_gemini_sync():
                    return client.models.generate_content(
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

                resp = await asyncio.wait_for(
                    asyncio.to_thread(_call_gemini_sync),
                    timeout=8.0
                )
                full_text = resp.text or ""
            except asyncio.TimeoutError:
                logger.error("Gemini TIMEOUT on street %s (took >8s)", street)
                full_text = f"Proceed carefully along {street}."
            except Exception as e:
                logger.error("Gemini error on street %s: %s", street, e)

            if full_text.strip().upper().startswith("SKIP"):
                full_text = ""

        audio = None
        if full_text.strip():
            audio = await generate_narrator_audio(full_text.strip(), voice_id)
            
        yield _sse_event("segment_done", {
            "segment_index": seg_index,
            "full_narration": full_text.strip(),
            "audio_base64": audio,
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
        def _call_gemini_summary_sync():
            return client.models.generate_content(
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
        response = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini_summary_sync),
            timeout=10.0
        )
        summary_text = response.text or ""
    except asyncio.TimeoutError:
        logger.error("Gemini TIMEOUT on path summary (took >10s)")
        summary_text = f"You've arrived at {end_label}. Stay safe."
    except Exception as e:
        logger.error("Gemini summary error: %s", e)

    yield _sse_event("done", {
        "summary": summary_text.strip(),
        "audio_base64": await generate_narrator_audio(summary_text.strip(), voice_id)
    })


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
