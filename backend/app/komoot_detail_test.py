"""Test Komoot tour detail and coordinates endpoints."""
import os
import base64
import json
import httpx

EMAIL = os.environ.get("KOMOOT_EMAIL", "")
PASSWORD = os.environ.get("KOMOOT_PASSWORD", "")
USER_ID = os.environ.get("KOMOOT_USER_ID", "")
BASE = "https://www.komoot.com/api/v007"

def auth_headers():
    creds = base64.b64encode(f"{EMAIL}:{PASSWORD}".encode()).decode()
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/hal+json, application/json",
        "Authorization": f"Basic {creds}",
    }

def main():
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        # 1. Get first tour from list
        print("=== Getting tour list ===")
        resp = client.get(f"{BASE}/users/{USER_ID}/tours/", headers=auth_headers(), params={"limit": 1})
        print(f"Status: {resp.status_code}")
        data = resp.json()
        tours = data.get("_embedded", {}).get("tours", [])
        if not tours:
            print("No tours found!")
            return
        
        tour_id = tours[0].get("id")
        print(f"First tour ID: {tour_id}")
        print(f"First tour keys: {list(tours[0].keys())[:20]}")
        print(f"First tour sample: {json.dumps(tours[0], indent=2)[:1000]}")
        
        # 2. Get tour detail
        print(f"\n=== Getting tour detail {tour_id} ===")
        resp = client.get(f"{BASE}/tours/{tour_id}/", headers=auth_headers())
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            detail = resp.json()
            print(f"Detail keys: {list(detail.keys())[:30]}")
            # Check for coordinate-related fields
            for key in ["decoded_coordinate", "coordinate", "_embedded", "path", "coordinates", "points"]:
                if key in detail:
                    val = detail[key]
                    if isinstance(val, str):
                        print(f"  {key}: string of length {len(val)}, preview: {val[:100]}...")
                    elif isinstance(val, list):
                        print(f"  {key}: list of {len(val)} items")
                        if val:
                            print(f"    first: {str(val[0])[:200]}")
                    elif isinstance(val, dict):
                        print(f"  {key}: dict with keys {list(val.keys())[:10]}")
                        if "coordinates" in val:
                            coords = val["coordinates"]
                            print(f"    coordinates: list of {len(coords)} items")
                            if coords:
                                print(f"    first coord: {coords[0]}")
                    else:
                        print(f"  {key}: {type(val).__name__} = {str(val)[:100]}")
            
            # Check _embedded for coordinate data
            embedded = detail.get("_embedded", {})
            if embedded:
                print(f"\n_embedded keys: {list(embedded.keys())[:10]}")
                for ek, ev in embedded.items():
                    if isinstance(ev, dict):
                        print(f"  {ek}: dict keys={list(ev.keys())[:10]}")
                        if "coordinates" in ev:
                            coords = ev["coordinates"]
                            print(f"    coordinates: {len(coords)} items, first: {coords[0] if coords else 'empty'}")
                    elif isinstance(ev, list):
                        print(f"  {ek}: list of {len(ev)}")
            
            # Print full detail truncated
            print(f"\nFull detail (first 2000 chars):\n{json.dumps(detail, indent=2)[:2000]}")
        
        # 3. Get coordinates endpoint
        print(f"\n=== Getting coordinates for tour {tour_id} ===")
        resp = client.get(f"{BASE}/tours/{tour_id}/coordinates/", headers=auth_headers())
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            coords = resp.json()
            if isinstance(coords, list):
                print(f"Coordinates: list of {len(coords)} items")
                if coords:
                    print(f"First 3: {json.dumps(coords[:3], indent=2)}")
            elif isinstance(coords, dict):
                print(f"Coordinates: dict with keys {list(coords.keys())[:10]}")
                print(f"Preview: {json.dumps(coords, indent=2)[:500]}")
        
        # 4. Get surface endpoint
        print(f"\n=== Getting surface for tour {tour_id} ===")
        resp = client.get(f"{BASE}/tours/{tour_id}/surface/", headers=auth_headers())
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            surface = resp.json()
            print(f"Surface: {json.dumps(surface, indent=2)[:500]}")

if __name__ == "__main__":
    main()
