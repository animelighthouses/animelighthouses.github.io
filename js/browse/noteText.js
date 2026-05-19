/**
 * Render sightings.notes on cards: plain text plus [label](https://...) links.
 */

const NOTE_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * Append note text to parent. Only http(s) URLs in markdown-style links become anchors.
 * @param {HTMLElement} parent
 * @param {string} raw
 */
export function appendFormattedNoteText(parent, raw) {
  const s = String(raw);
  let last = 0;
  let found = false;

  for (const m of s.matchAll(NOTE_LINK_RE)) {
    found = true;
    const i = m.index;
    if (i > last) {
      parent.appendChild(document.createTextNode(s.slice(last, i)));
    }
    const a = document.createElement("a");
    a.href = m[2];
    a.textContent = m[1];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    parent.appendChild(a);
    last = i + m[0].length;
  }

  if (!found) {
    parent.appendChild(document.createTextNode(s));
    return;
  }

  if (last < s.length) {
    parent.appendChild(document.createTextNode(s.slice(last)));
  }
}
