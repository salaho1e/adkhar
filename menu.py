"""يقرأ رسائل تيليغرام الجديدة ويرد بالقائمة. يعمل كل 5 دقائق عبر GitHub Actions."""
import json
import time

from tg import call, send_kind, send_text

KINDS = ("morning", "evening", "friday")
MENU = {"inline_keyboard": [
    [{"text": "🌅 أذكار الصباح", "callback_data": "morning"},
     {"text": "🌇 أذكار المساء", "callback_data": "evening"}],
    [{"text": "🕌 الجمعة", "callback_data": "friday"}],
]}
MAX_AGE = 3600  # نتجاهل الأوامر الأقدم من ساعة


def dest_of(msg):
    thread = msg.get("message_thread_id") if msg.get("is_topic_message") else None
    return (str(msg["chat"]["id"]), thread)


def show_menu(msg):
    send_text(dest_of(msg), "اختر ما تريد عرضه 👇", {"reply_markup": json.dumps(MENU)})


def handle_message(msg, me, now):
    text = (msg.get("text") or "").strip()
    if not text or now - msg.get("date", 0) > MAX_AGE:
        return
    if msg["chat"]["type"] == "private":  # في المحادثة الخاصة أي رسالة تعرض القائمة
        show_menu(msg)
        return
    if not text.startswith("/"):
        return
    name, _, target = text.split()[0][1:].partition("@")
    if target and target.lower() != me:  # الأمر موجّه لبوت آخر
        return
    if name.lower() in ("menu", "start", "adhkar"):
        show_menu(msg)


def handle_callback(cq):
    try:
        call("answerCallbackQuery", {"callback_query_id": cq["id"]})
    except Exception as e:  # يفشل غالباً لأن الضغطة قديمة، ولا يهم
        print("answerCallbackQuery:", e)
    msg = cq.get("message")
    if cq.get("data") in KINDS and msg:
        send_kind(dest_of(msg), cq["data"])


def main():
    me = call("getMe")["username"].lower()
    updates = call("getUpdates", {
        "timeout": 0,
        "allowed_updates": json.dumps(["message", "callback_query"]),
    })
    if not updates:
        return
    # نؤكد الاستلام أولاً حتى لا يتكرر الإرسال إن تعطل التشغيل
    call("getUpdates", {"offset": max(u["update_id"] for u in updates) + 1, "timeout": 0})
    now = time.time()
    for u in updates:
        try:
            if "callback_query" in u:
                handle_callback(u["callback_query"])
            elif "message" in u:
                handle_message(u["message"], me, now)
        except Exception as e:
            print("خطأ في معالجة تحديث:", e)


if __name__ == "__main__":
    main()
