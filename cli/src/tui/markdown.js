// Lightweight streaming Markdown renderer for assistant output.
// Renders line-by-line as lines complete (safe for token streaming), keeps
// code-fence state across deltas, and resets cleanly per assistant segment.
// Deliberately small: headings, bullets, numbered lists, bold, inline code,
// fences, blockquotes, rules. Everything else passes through untouched.
//
// Two output modes:
//   push()/finish()    — ANSI strings (piped / non-TTY path, legacy rendering)
//   pushLines() & co   — styled segment lines (Array<{text, attr}>) for the
//                        LiveRegion, which wraps them to terminal width
//                        itself while preserving per-segment style.
import { bold, dim, cyan } from "./ansi.js";
import { ATTR } from "./frame.js";

const A = ATTR;

// attr → string-mode ANSI helper (respects NO_COLOR / --no-color at call time)
const STRING_STYLE = {
  [A.BOLD]: bold,
  [A.DIM]: dim,
  [A.CYAN]: cyan,
};

export class MarkdownStream {
  constructor() {
    this.buf = "";
    this.inFence = false;
  }

  // --- string mode (piped output) -------------------------------------------

  // Consume a chunk; returns the rendered output for completed lines.
  push(delta) {
    const lines = this.pushLines(delta);
    if (!lines.length) return "";
    return lines.map((segs) => segsToAnsi(segs)).join("\n") + "\n";
  }

  // Flush the incomplete trailing line (at end of an assistant segment).
  finish() {
    const segs = this.finishLines();
    return segs ? segsToAnsi(segs) + "\n" : "";
  }

  // --- segment mode (LiveRegion) --------------------------------------------

  // Consume a chunk; returns styled lines for every line that COMPLETED in
  // this delta (each line = Array<{text, attr}>). The partial trailing line
  // stays buffered; use partialLines() to render it.
  pushLines(delta) {
    this.buf += String(delta ?? "");
    const out = [];
    let idx;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      out.push(this._renderLineSegs(line));
    }
    return out;
  }

  // Styled segments for the currently buffered (incomplete) line, or null.
  partialLines() {
    if (!this.buf.length) return null;
    return this._renderLineSegs(this.buf);
  }

  // Flush the incomplete trailing line as segments (or null).
  finishLines() {
    if (!this.buf.length) return null;
    const line = this.buf;
    this.buf = "";
    return this._renderLineSegs(line);
  }

  // --- shared core ------------------------------------------------------------

  _renderLineSegs(line) {
    if (/^\s*(```|~~~)/.test(line)) {
      this.inFence = !this.inFence;
      return [{ text: "  " + line.trim(), attr: A.DIM }];
    }
    if (this.inFence) {
      return [{ text: "  " + line, attr: A.DIM }];
    }
    return this._renderPlainSegs(line);
  }

  _pushSeg(line, text, attr) {
    if (!text) return;
    const last = line[line.length - 1];
    if (last && last.attr === attr) last.text += text;
    else line.push({ text, attr: attr || 0 });
  }

  _renderPlainSegs(line) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const out = [{ text: h[1] + " ", attr: A.BOLD }];
      for (const seg of this._inlineSegs(h[2])) {
        // heading text is bold by default; code inside keeps its own style
        this._pushSeg(out, seg.text, seg.attr === A.CYAN ? seg.attr : A.BOLD);
      }
      return out;
    }
    if (/^\s*([-*+])\s+/.test(line)) {
      const out = [{ text: "•  ", attr: A.CYAN }];
      for (const seg of this._inlineSegs(line.replace(/^\s*[-*+]\s+/, ""))) this._pushSeg(out, seg.text, seg.attr);
      return out;
    }
    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (num) {
      const out = [{ text: num[1] + ". ", attr: A.DIM }];
      for (const seg of this._inlineSegs(num[2])) this._pushSeg(out, seg.text, seg.attr);
      return out;
    }
    if (/^\s*>\s?/.test(line)) {
      const out = [{ text: "│ ", attr: A.DIM }];
      for (const seg of this._inlineSegs(line.replace(/^\s*>\s?/, ""))) this._pushSeg(out, seg.text, A.DIM);
      return out;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      return [{ text: "────────────────────────────────", attr: A.DIM }];
    }
    if (!line.trim()) return [];
    return this._inlineSegs(line);
  }

  // Split inline text into plain / code / bold segments.
  _inlineSegs(s) {
    const out = [];
    // tokenize: `code`, **bold**, and plain runs
    const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) this._pushSeg(out, s.slice(last, m.index), A.PLAIN);
      const tok = m[0];
      if (tok.startsWith("`")) this._pushSeg(out, tok.slice(1, -1), A.CYAN);
      else this._pushSeg(out, tok.slice(2, -2), A.BOLD);
      last = m.index + tok.length;
    }
    if (last < s.length) this._pushSeg(out, s.slice(last), A.PLAIN);
    return out;
  }
}

export function segsToAnsi(segs) {
  let out = "";
  for (const seg of segs || []) {
    const style = STRING_STYLE[seg.attr] || ((t) => t);
    out += style(seg.text);
  }
  return out;
}
