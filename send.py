import json
import os
import sys
import time

import requests

TOKEN = os.environ["BOT_TOKEN"]
CHAT_ID = os.environ["CHAT_ID"]
THREAD_ID = os.environ.get("THREAD_ID")
API = f"https://api.telegram.org/bot{TOKEN}"


def base():
    d = {"chat_id": CHAT_ID}
    if THREAD_ID:
        d["message_thread_id"] = int(THREAD_ID)
    return d


def check(r):
    print(r.status_code, r.text[:150])
    r.raise_for_status()


def send_text(text):
    check(requests.post(f"{API}/sendMessage", data={**base(), "text": text}, timeout=30))


def send_photo(path, caption):
    # تيليغرام يسمح بـ 1024 حرفاً فقط في تعليق الصورة
    short = caption if len(caption) <= 1024 else ""
    with open(path, "rb") as f:
        check(requests.post(f"{API}/sendPhoto", data={**base(), "caption": short},
                            files={"photo": f}, timeout=60))
    if caption and not short:
        send_text(caption)


def send_album(folder, caption):
    files = sorted(
        os.path.join(folder, n) for n in os.listdir(folder)
        if n.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    for i in range(0, len(files), 10):  # الحد الأقصى 10 صور في المجموعة
        chunk = files[i:i + 10]
        media, handles = [], {}
        for j, p in enumerate(chunk):
            key = f"f{j}"
            handles[key] = open(p, "rb")
            m = {"type": "photo", "media": f"attach://{key}"}
            if i == 0 and j == 0 and caption and len(caption) <= 1024:
                m["caption"] = caption
            media.append(m)
        check(requests.post(f"{API}/sendMediaGroup",
                            data={**base(), "media": json.dumps(media)},
                            files=handles, timeout=120))
        for h in handles.values():
            h.close()
        time.sleep(2)
    if caption and len(caption) > 1024:
        send_text(caption)


kind = sys.argv[1] if len(sys.argv) > 1 else "morning"
with open("adhkar.json", encoding="utf-8") as f:
    items = json.load(f)[kind]

for item in items:
    caption = item.get("caption", "")
    folder = item.get("folder")
    image = item.get("image")
    if folder and os.path.isdir(folder) and os.listdir(folder):
        send_album(folder, caption)
    elif image and os.path.exists(image):
        send_photo(image, caption)
    elif caption and not item.get("skip_if_missing"):
        print("لا توجد صورة، سيُرسل النص فقط:", image or folder)
        send_text(caption)
    time.sleep(1)
