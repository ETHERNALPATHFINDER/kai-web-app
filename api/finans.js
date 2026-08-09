const { fetchFileFromGitHub } = require("../lib/githubFetch");
const { buildFinansViewModel } = require("../lib/finansEngine");
const { checkAuth, unauthorized } = require("../lib/auth");

module.exports = async (req, res) => {
  if (!checkAuth(req)) return unauthorized(res);
  try {
    const path = process.env.FINANS_PATH || "Alanlar/Finans.md";
    const markdown = await fetchFileFromGitHub(path);
    const viewModel = buildFinansViewModel(markdown);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(viewModel);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
