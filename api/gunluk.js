const { fetchFileFromGitHub } = require("../lib/githubFetch");
const { buildGunlukViewModel } = require("../lib/gunlukEngine");
const { checkAuth, unauthorized } = require("../lib/auth");

module.exports = async (req, res) => {
  if (!checkAuth(req)) return unauthorized(res);
  try {
    const path = process.env.GOREVLER_PATH || "Alanlar/Görevler.md";
    const markdown = await fetchFileFromGitHub(path);
    const viewModel = buildGunlukViewModel(markdown);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(viewModel);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
