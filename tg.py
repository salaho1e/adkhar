"""دوال مشتركة للتعامل مع تيليغرام (الإرسال والصور والوجهات)."""
import json
import os
import time

import requests

TOKEN = os.environ["BOT_TOKEN"]
API = f"https://api.telegram.org/bot{TOKEN}"
BASE = os.path.dirname(os.path.abspath(__file__))
_photo_ids = {}  # لإعادة استخدام الصور بعد رفعها مرة واحدة


def call(method, data=None, files=None, timeout=60):
    r = None
    for _ in range(3):
        for f in (files or {}).values():
            f.seek(0)
        r = requests.post(f"{API}/{method}", data=data, files=files or None, timeout=timeout)
        if r.status_code == 429:  # طلبات كثيرة: ننتظر ثم نعيد
            wait = r.json().get("parameters", {}).get("retry_after", 5)
            time.sleep(wait + 1)
            continue
        break
    print(method, r.status_code)  # لا نطبع الرد حتى لا تظهر أرقام المحادثات في سجل عام
    if not r.ok:
        # لا نطبع الرابط حتى لا يظهر الـ Token في السجل
        raise RuntimeError(f"{method}: {r.status_code} {r.text[:200]}")
    return r.json()["result"]


def parse_targets():
    """يقرأ الوجهات من المتغير TARGETS: كل سطر (أو فاصلة) = chat_id أو chat_id:thread_id.
    وإن لم يوجد يرجع للأسرار القديمة CHAT_ID و THREAD_ID."""
    raw = os.environ.get("TARGETS", "").strip()
    if not raw:
        chat = os.environ.get("CHAT_ID", "").strip()
        thread = os.environ.get("THREAD_ID", "").strip()
        raw = f"{chat}:{thread}" if chat and thread else chat
    targets = []
    for part in raw.replace(",", "\n").splitlines():
        part = part.strip()
        if not part or part.startswith("#"):
            continue
        chat, _, thread = part.partition(":")
        targets.append((chat.strip(), thread.strip() or None))
    return targets


def base(dest):
    d = {"chat_id": dest[0]}
    if dest[1]:
        d["message_thread_id"] = int(dest[1])
    return d


def send_text(dest, text, extra=None):
    data = {**base(dest), "text": text}
    if extra:
        data.update(extra)
    return call("sendMessage", data)


def send_photo(dest, path, caption):
    short = caption if len(caption) <= 1024 else ""  # حد تيليغرام لتعليق الصورة
    fid = _photo_ids.get(path)
    if fid:
        res = call("sendPhoto", {**base(dest), "photo": fid, "caption": short})
    else:
        with open(path, "rb") as f:
            res = call("sendPhoto", {**base(dest), "caption": short}, files={"photo": f})
        _photo_ids[path] = res["photo"][-1]["file_id"]
    if caption and not short:
        send_text(dest, caption)


def list_images(folder):
    return sorted(
        os.path.join(folder, n) for n in os.listdir(folder)
        if n.lower().endswith((".jpg", ".jpeg", ".png"))
    )


def send_album(dest, folder, caption):
    paths = list_images(folder)
    chunks = [paths[i:i + 10] for i in range(0, len(paths), 10)]  # الحد الأقصى 10 صور
    if len(chunks) > 1 and len(chunks[-1]) == 1:  # الألبوم لا يقبل صورة واحدة
        chunks[-1].insert(0, chunks[-2].pop())
    for n, chunk in enumerate(chunks):
        if len(chunk) == 1:
            send_photo(dest, chunk[0], caption if n == 0 else "")
            continue
        media, files = [], {}
        for j, p in enumerate(chunk):
            m = {"type": "photo"}
            if p in _photo_ids:
                m["media"] = _photo_ids[p]
            else:
                key = f"f{j}"
                files[key] = open(p, "rb")
                m["media"] = f"attach://{key}"
            if n == 0 and j == 0 and caption and len(caption) <= 1024:
                m["caption"] = caption
            media.append(m)
        try:
            res = call("sendMediaGroup", {**base(dest), "media": json.dumps(media)},
                       files=files, timeout=180)
        finally:
            for f in files.values():
                f.close()
        for p, msg in zip(chunk, res):
            _photo_ids.setdefault(p, msg["photo"][-1]["file_id"])
        time.sleep(2)
    if caption and len(caption) > 1024:
        send_text(dest, caption)


def load_items(kind):
    with open(os.path.join(BASE, "adhkar.json"), encoding="utf-8") as f:
        return json.load(f)[kind]


def send_kind(dest, kind):
    """يرسل مجموعة (morning / evening / friday) إلى وجهة واحدة."""
    for item in load_items(kind):
        caption = item.get("caption", "")
        folder = item.get("folder")
        image = item.get("image")
        folder_path = os.path.join(BASE, folder) if folder else None
        image_path = os.path.join(BASE, image) if image else None
        if folder_path and os.path.isdir(folder_path) and list_images(folder_path):
            send_album(dest, folder_path, caption)
        elif image_path and os.path.exists(image_path):
            send_photo(dest, image_path, caption)
        elif caption and not item.get("skip_if_missing"):
            if image or folder:
                print("لا توجد صورة، سيُرسل النص فقط:", image or folder)
            send_text(dest, caption)
        time.sleep(1)
