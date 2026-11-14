
const RAW = "https://raw.githubusercontent.com/salaho1e/adkhar/main";
const DEFAULT_TZ = "Africa/Algiers"; // توقيت الجزائر UTC+1
const KINDS = ["morning", "evening", "friday"];
const DEFAULT_TIMES = { morning: "06:30", evening: "17:00", friday: "07:00" };

const MENU = {
  inline_keyboard: [
    [
      { text: "🌅 أذكار الصباح", callback_data: "morning" },
      { text: "🌇 أذكار المساء", callback_data: "evening" },
    ],
    [{ text: "🕌 الجمعة", callback_data: "friday" }],
  ],
};

let ME = null; // اسم البوت
const cache = new Map();

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { v, t: Date.now() });
  return v;
}

export default {
  // ردود تيليغرام (Webhook)
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    if (
      env.WEBHOOK_SECRET &&
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    ctx.waitUntil(handle(update, env).catch((e) => console.log("error:", e.message)));
    return new Response("ok");
  },

  // الإرسال المجدول: يعمل كل دقيقة ويرسل لمن حان وقته
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runSchedule(env, new Date(event.scheduledTime)).catch((e) =>
        console.log("schedule error:", e.message)
      )
    );
  },
};

/* ---------- الجدولة ---------- */

function localNow(env, date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.TZ_NAME || DEFAULT_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { time: `${get("hour")}:${get("minute")}`, weekday: get("weekday") };
}

// كل سطر:  رقم_المجموعة[:رقم_التوبيك]  morning=06:30 evening=17:00 friday=07:00
// وإن لم تُكتب أوقات تُستعمل الأوقات الافتراضية.
function parseTargets(raw) {
  const out = [];
  for (const line of (raw || "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0] || parts[0].startsWith("#")) continue;
    const [chat, thread] = parts[0].split(":");
    const dest = { chat_id: /^-?\d+$/.test(chat) ? Number(chat) : chat };
    if (thread) dest.message_thread_id = Number(thread);
    const times = {};
    for (const tok of parts.slice(1)) {
      const [k, v] = tok.split("=");
      const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
      if (KINDS.includes(k) && m) times[k] = `${m[1].padStart(2, "0")}:${m[2]}`;
    }
    out.push({ dest, times: Object.keys(times).length ? times : { ...DEFAULT_TIMES } });
  }
  return out;
}

async function runSchedule(env, date) {
  const { time, weekday } = localNow(env, date);
  for (const t of parseTargets(env.TARGETS)) {
    for (const kind of KINDS) {
      if (t.times[kind] !== time) continue;
      if (kind === "friday" && weekday !== "Fri") continue;
      try {
        console.log("sending", kind, "to", t.dest.chat_id, t.dest.message_thread_id || "");
        await sendKind(env, t.dest, kind);
        console.log("sent", kind, "to", t.dest.chat_id, t.dest.message_thread_id || "");
      } catch (e) {
        console.log("send failed", t.dest.chat_id, e.message);
      }
    }
  }
}

/* ---------- تيليغرام ---------- */

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) console.log(method, "failed:", j.description);
  return j;
}

function destOf(msg) {
  const d = { chat_id: msg.chat.id };
  if (msg.is_topic_message && msg.message_thread_id) d.message_thread_id = msg.message_thread_id;
  return d;
}

async function botName(env) {
  if (!ME) ME = ((await tg(env, "getMe", {})).result?.username || "").toLowerCase();
  return ME;
}

async function handle(update, env) {
  if (update.callback_query) {
    const cq = update.callback_query;
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "جارٍ الإرسال…" });
    if (KINDS.includes(cq.data) && cq.message) await sendKind(env, destOf(cq.message), cq.data);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.text) return;
  const text = msg.text.trim();
  const [name, target] = text.startsWith("/") ? text.split(/\s/)[0].slice(1).split("@") : ["", ""];
  if (target && target.toLowerCase() !== (await botName(env))) return; // أمر لبوت آخر

  // /id يعرض رقم المحادثة (والتوبيك) لنسخه إلى TARGETS
  if (name.toLowerCase() === "id") {
    const thread = msg.is_topic_message && msg.message_thread_id ? `:${msg.message_thread_id}` : "";
    await tg(env, "sendMessage", {
      ...destOf(msg),
      text: `انسخ هذا السطر إلى TARGETS:\n${msg.chat.id}${thread}`,
    });
    return;
  }
  if (msg.chat.type !== "private" && !["menu", "start", "adhkar"].includes(name.toLowerCase())) return;
  await tg(env, "sendMessage", { ...destOf(msg), text: "اختر ما تريد عرضه 👇", reply_markup: MENU });
}

/* ---------- المحتوى ---------- */

async function loadItems(kind) {
  const data = await cached("adhkar.json", 300000, async () => {
    const r = await fetch(`${RAW}/adhkar.json`, { cf: { cacheTtl: 300 } });
    return r.json();
  });
  return data[kind] || [];
}

async function sendKind(env, d, kind) {
  for (const item of await loadItems(kind)) {
    const caption = item.caption || "";
    if (item.folder) {
      const pages = await listFolder(item.folder);
      if (pages.length) {
        await sendAlbum(env, d, pages, caption);
        continue;
      }
    }
    if (item.image && (await sendPhoto(env, d, `${RAW}/${item.image}`, caption))) continue;
    if (caption && !item.skip_if_missing) await tg(env, "sendMessage", { ...d, text: caption });
  }
}

// صفحات المجلد يجب أن تُسمّى 01.jpg و02.jpg ... بالترتيب
async function listFolder(folder) {
  return cached(`folder:${folder}`, 300000, async () => {
    const pages = [];
    for (let i = 1; i <= 30; i++) {
      const url = `${RAW}/${folder}/${String(i).padStart(2, "0")}.jpg`;
      const r = await fetch(url, { method: "HEAD", cf: { cacheTtl: 300 } });
      if (!r.ok) break;
      pages.push(url);
    }
    return pages;
  });
}

async function sendPhoto(env, d, url, caption) {
  const short = caption.length <= 1024 ? caption : ""; // حد تعليق الصورة
  const j = await tg(env, "sendPhoto", { ...d, photo: url, caption: short });
  if (j.ok && caption && !short) await tg(env, "sendMessage", { ...d, text: caption });
  return j.ok;
}

async function sendAlbum(env, d, urls, caption) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += 10) chunks.push(urls.slice(i, i + 10)); // الحد 10 صور
  const last = chunks.length - 1;
  if (last > 0 && chunks[last].length === 1) chunks[last].unshift(chunks[last - 1].pop());
  const short = caption.length <= 1024 ? caption : "";
  for (let n = 0; n < chunks.length; n++) {
    const chunk = chunks[n];
    if (chunk.length === 1) {
      await sendPhoto(env, d, chunk[0], n === 0 ? caption : "");
      continue;
    }
    const media = chunk.map((u, j) => ({
      type: "photo",
      media: u,
      ...(n === 0 && j === 0 && short ? { caption: short } : {}),
    }));
    await tg(env, "sendMediaGroup", { ...d, media });
  }
  if (caption && !short) await tg(env, "sendMessage", { ...d, text: caption });
}
