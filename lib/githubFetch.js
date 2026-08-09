// Fetches a single file's raw content from a (private) GitHub repo using a
// fine-grained personal access token stored in the GITHUB_TOKEN env var.
// The token needs only "Contents: Read-only" permission on the target repo.

async function fetchFileFromGitHub(path) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error(
      "GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO env değişkenleri eksik. Vercel proje ayarlarından ekle."
    );
  }
  const branch = GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
    path
  ).replace(/%2F/g, "/")}?ref=${branch}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kai-web-app",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub'dan ${path} okunamadı (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.text();
}

module.exports = { fetchFileFromGitHub };
