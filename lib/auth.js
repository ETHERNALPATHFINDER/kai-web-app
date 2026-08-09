// Minimal shared-secret protection for a personal single-user app.
// Not enterprise-grade auth — just enough to keep Finans.md's numbers off the open
// internet. For stronger protection, use Vercel's built-in Password Protection
// (Pro plan) or put the whole app behind Cloudflare Access instead.

function checkAuth(req) {
  const required = process.env.APP_KEY;
  if (!required) return true; // no key configured -> auth disabled (not recommended)
  const header = req.headers["x-app-key"];
  const query = req.query ? req.query.key : undefined;
  return header === required || query === required;
}

function unauthorized(res) {
  res.status(401).json({ error: "Yetkisiz. x-app-key header'ı veya ?key= parametresi gerekli." });
}

module.exports = { checkAuth, unauthorized };
