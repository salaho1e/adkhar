import json
import os
import sys
import time

import requests

TOKEN = os.environ["BOT_TOKEN"]
CHAT_ID = os.environ["CHAT_ID"]
THREAD_ID = os.environ.get("THREAD_ID")  # اختياري: رقم التوبيك

kind = sys.argv[1] if len(sys.argv) > 1 else "morning"  # morning | evening

with open("adhkar.json", encoding="utf-8") as f:
    data = json.load(f)

url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"

for text in data[kind]:
    payload = {"chat_id": CHAT_ID, "text": text}
    if THREAD_ID:
        payload["message_thread_id"] = int(THREAD_ID)
    r = requests.post(url, json=payload, timeout=30)
    print(r.status_code, r.text[:200])
    r.raise_for_status()
    time.sleep(1)
