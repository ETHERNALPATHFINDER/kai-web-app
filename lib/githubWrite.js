// Safe, sha-guarded writes to the private vault-data repo.
//
// Reading a file's content+sha is still just a read, so it uses the existing read-only
// GITHUB_TOKEN (same one lib/githubFetch.js uses for Finans.md/Görevler.md/Bilgi.md). Only
// the actual PUT uses a separate GITHUB_WRITE_TOKEN (Contents: Read and write, scoped only
// to kai-vault-data) — that token is never sent to the browser and never reused for anything
// else. The read-only GITHUB_TOKEN's permissions are never changed.
//
// Every write is compare-and-swap: the file's current `sha` is sent with the PUT, so GitHub
// rejects the write if the file changed since it was read (e.g. Obsidian Git pushed a change
// mid-request). safeUpdateFile() re-reads and retries exactly once on that conflict, then
// gives up rather than silently overwriting.

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`${missing.join(" / ")} env değişkenleri eksik. Vercel proje ayarlarından ekle.`);
  }
}

async function fetchFileWithSha(path) {
  requireEnv(["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]);
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  const branch = GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
    path
  ).replace(/%2F/g, "/")}?ref=${branch}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      // Default (non-"raw") media type — we need the `sha` field alongside content, not just bytes.
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kai-web-app",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub'dan ${path} okunamadı (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const content = Buffer.from(json.content, json.encoding || "base64").toString("utf8");
  return { content, sha: json.sha };
}

async function writeFileWithSha(path, newContent, sha, commitMessage) {
  requireEnv(["GITHUB_WRITE_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]);
  const { GITHUB_WRITE_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  const branch = GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
    path
  ).replace(/%2F/g, "/")}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_WRITE_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kai-web-app",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: commitMessage || `KAI: ${path} güncellendi`,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      sha,
      branch,
    }),
  });

  if (res.status === 409 || res.status === 422) {
    const err = new Error("Dosya GitHub'da bu sırada değişmiş (sha uyuşmazlığı).");
    err.code = "SHA_CONFLICT";
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub'a ${path} yazılamadı (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Fetch -> mutate (pure, synchronous) -> write, with exactly one retry on a sha conflict.
 *
 * `mutateFn(content)` must return the new full file content as a string. If it decides there
 * is nothing to change (e.g. a duplicate-guard chose to skip the write), it should return the
 * exact same string it was given — safeUpdateFile treats that as "nothing to write" and never
 * calls the GitHub write API at all.
 *
 * Returns { written: boolean, retried?: boolean }. Throws only on a real failure (missing env,
 * network error, or a second sha conflict after the single retry).
 */
async function safeUpdateFile(path, mutateFn, commitMessage) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content, sha } = await fetchFileWithSha(path);
    const newContent = mutateFn(content);
    if (newContent === content) {
      return { written: false }; // mutateFn decided not to change anything (e.g. duplicate)
    }
    try {
      await writeFileWithSha(path, newContent, sha, commitMessage);
      return { written: true, retried: attempt > 0 };
    } catch (err) {
      lastErr = err;
      if (err.code === "SHA_CONFLICT" && attempt === 0) {
        continue; // re-fetch fresh content + sha and try exactly once more
      }
      throw err;
    }
  }
  throw lastErr || new Error("Yazma başarısız oldu.");
}

module.exports = { fetchFileWithSha, writeFileWithSha, safeUpdateFile };
