const { checkAuth, unauthorized } = require("../lib/auth");
const { handleMessage } = require("../lib/kaiActions");

module.exports = async (req, res) => {
  if (!checkAuth(req)) return unauthorized(res);
  if (req.method !== "POST") {
    res.status(405).json({ error: "Yalnızca POST desteklenir." });
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "message alanı gerekli." });
      return;
    }
    // recentHistory: client-supplied, last 6-10 {role, text} pairs from localStorage. Capped
    // here too so a tampered/oversized payload can't blow up the Claude request.
    const recentHistory = Array.isArray(body.recentHistory) ? body.recentHistory.slice(-10) : [];

    const result = await handleMessage({ message, recentHistory });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ reply: result.reply, action: result.action, written: !!result.written });
  } catch (err) {
    // Anything unexpected (Claude API down, Bilgi.md missing, etc.) still comes back as a
    // short JSON error instead of a raw 500 stack trace — nothing was written in this path.
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
