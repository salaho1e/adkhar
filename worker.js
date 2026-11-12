// Cloudflare Worker: قائمة بوت الأذكار (ردّ فوري عبر Webhook)
// يقرأ النصوص وأسماء الصور من adhkar.json في المستودع العام.

const RAW = "https://raw.githubusercontent.com/salaho1e/adkhar/main";

const MENU = {
  inline_keyboard: [
    [
      { text: "🌅 أذكار الصباح", callback_data: "morning" },
      { text: "🌇 أذكار المساء", callback_data: "evening" },
    ],
    [{ text: "🕌 الجمعة", callback_data: "friday" }],
  ],
};
const KINDS = ["morning", "evening", "friday"];
let ME = null; // اسم البوت (يُحفظ بعد أول طلب)

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    if (
      env.WEBHOOK_SECRET &&
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    // نردّ على تيليغرام فوراً ونكمل العمل في الخلفية
    ctx.waitUntil(handle(update, env).catch((e) => console.log("error:", e.message)));
    return new Response("ok");
  },
};

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

function dest(msg) {
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
    if (KINDS.includes(cq.data) && cq.message) await sendKind(env, dest(cq.message), cq.data);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.text) return;
  const text = msg.text.trim();
  if (msg.chat.type !== "private") {
    // في المجموعات نردّ على الأوامر فقط
    if (!text.startsWith("/")) return;
    const [name, target] = text.split(/\s/)[0].slice(1).split("@");
    if (target && target.toLowerCase() !== (await botName(env))) return;
    if (!["menu", "start", "adhkar"].includes(name.toLowerCase())) return;
  }
  await tg(env, "sendMessage", { ...dest(msg), text: "اختر ما تريد عرضه 👇", reply_markup: MENU });
}

async function loadItems(kind) {
  const r = await fetch(`${RAW}/adhkar.json`, { cf: { cacheTtl: 300 } });
  const data = await r.json();
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
  const pages = [];
  for (let i = 1; i <= 30; i++) {
    const url = `${RAW}/${folder}/${String(i).padStart(2, "0")}.jpg`;
    const r = await fetch(url, { method: "HEAD", cf: { cacheTtl: 300 } });
    if (!r.ok) break;
    pages.push(url);
  }
  return pages;
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
