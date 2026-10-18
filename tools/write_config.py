"""Write site/config.js from environment variables (Cloudflare Pages build step).

The Google Maps key is a browser key restricted to our domains in Google
Cloud, but it still stays out of the repo: Cloudflare injects it at build time.
"""
import json
import os

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
config = {"mapsKey": os.environ.get("GOOGLE_MAPS_KEY", "")}
if os.environ.get("GOOGLE_MAP_ID"):
    config["mapId"] = os.environ["GOOGLE_MAP_ID"]
with open(os.path.join(SITE, "config.js"), "w", encoding="utf-8") as f:
    f.write("window.FTL_CONFIG = " + json.dumps(config) + ";\n")
print("config.js written; maps key set:", bool(config["mapsKey"]))
