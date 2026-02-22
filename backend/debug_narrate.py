import requests

URL = "http://localhost:8000/route/narrate"
data = {
    "start_lat": 41.8781, "start_lng": -87.6403, 
    "end_lat": 41.8826, "end_lng": -87.6233,
    "start_label": "Union Station", "end_label": "Millennium Park",
    "mode": "safest",
    "category": "VIOLENT",
    "hour": 12
}

try:
    resp = requests.post(URL, json=data)
    print(f"Status: {resp.status_code}")
    print(resp.text)
except Exception as e:
    print(f"Error: {e}")
