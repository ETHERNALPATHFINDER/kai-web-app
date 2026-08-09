// Generic Obsidian-markdown parsing helpers shared by finansEngine.js and gunlukEngine.js.
// Kept intentionally simple/permissive: the vault files are hand-written by a human via
// chat, not machine-generated, so the parser favors "best effort + sensible fallback"
// over strict schema validation.

/** Strip HTML comments (e.g. <!-- Şablon: ... --> placeholder blocks) before any parsing. */
function stripComments(md) {
  return md.replace(/<!--[\s\S]*?-->/g, "");
}

/** Split a markdown document into top-level "## Heading" sections. */
function splitSections(md) {
  const lines = stripComments(md).split(/\r?\n/);
  const sections = {};
  let current = "__preamble__";
  sections[current] = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = m[1].trim();
      sections[current] = [];
    } else {
      sections[current].push(line);
    }
  }
  return sections;
}

/** Split a section's lines into "### Heading" blocks. Returns [{title, lines}]. */
function splitSubsections(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) {
      current = { title: m[1].trim(), lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks;
}

/** Parse "- Key: Value" lines (and their soft-wrapped continuation lines) into an object. */
function parseKeyValueLines(lines) {
  const out = {};
  let lastKey = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      lastKey = null; // blank line ends the key-value block (rest is prose, not a continuation)
      continue;
    }
    const m = line.match(/^-\s*\*?\*?([^:*]+?)\*?\*?:\s*(.*)$/);
    if (m) {
      lastKey = m[1].trim();
      out[lastKey] = (out[lastKey] ? out[lastKey] + " " : "") + m[2].trim();
    } else if (lastKey && !line.startsWith("#") && !line.startsWith("*") && !line.startsWith("-") && !line.startsWith(">")) {
      // soft-wrapped continuation of the previous value (plain prose only)
      out[lastKey] += " " + line;
    } else {
      lastKey = null;
    }
  }
  return out;
}

/** Parse the first GitHub-flavored pipe table found in `lines`. Returns array of row objects. */
function parseFirstTable(lines) {
  let headerIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];
  const header = splitRow(lines[headerIdx]);
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*\|.*\|\s*$/.test(line)) break;
    const cells = splitRow(line);
    const row = {};
    header.forEach((h, idx) => (row[h] = (cells[idx] || "").trim()));
    rows.push(row);
  }
  return rows;
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/** Turkish-formatted number ("3.377", "1.400.000", "84.000") -> integer. Handles minus signs. */
function parseTLNumber(str) {
  if (str == null) return null;
  const s = String(str).trim();
  // "Açık bırakıldı" is the other phrasing Finans.md uses for "consciously left open" —
  // without this it falls through to digit-stripping and can misparse an embedded date
  // (e.g. "...bilinçli olarak, 2026-08-04)") into a bogus tiny number.
  if (!s || s === "—" || s === "-" || /veri eksik/i.test(s) || /açık bırakıldı/i.test(s)) return null;
  const cleaned = s.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  // Turkish format: "." = thousands separator, "," = decimal separator
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? null : n;
}

/** "2026-08-06" -> Date. Returns null if not a plain ISO date. */
function parseISODate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function isMissing(value) {
  if (value == null) return true;
  const s = String(value).trim();
  return s === "" || s === "—" || /veri eksik/i.test(s);
}

/**
 * "Today" as seen on a wall clock in Europe/Istanbul, returned as a UTC-midnight Date
 * so it compares cleanly against parseISODate()'s output (which is also UTC-midnight).
 * Turkey has used a fixed UTC+3 offset (no DST) since 2016, but this uses Intl instead
 * of hardcoding +3 so it keeps working if that ever changes.
 */
function istanbulTodayUTCDate(instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return new Date(Date.UTC(+get("year"), +get("month") - 1, +get("day")));
}

// Note: HTML escaping lives only in public/app.js (KAI.escapeHtml) — this module is used
// by the server-side engines (lib/finansEngine.js, lib/gunlukEngine.js), which never
// produce HTML themselves (they return plain ViewModel objects; see "Engine" rule in
// Bilgi.md). Escaping only ever needs to happen once, at render time, in the UI layer.

module.exports = {
  splitSections,
  splitSubsections,
  parseKeyValueLines,
  parseFirstTable,
  parseTLNumber,
  parseISODate,
  isMissing,
  istanbulTodayUTCDate,
};
