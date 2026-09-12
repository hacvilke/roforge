// Lightweight streaming Markdown renderer for assistant output.
// Renders line-by-line as lines complete (safe for token streaming), keeps
// code-fence state across deltas, and resets cleanly per assistant segment.
// Deliberately small: headings, bullets, numbered lists, bold, inline code,
// fences, blockquotes, rules. Everything else passes through untouched.
import { bold, dim, cyan, gray } from "./ansi.js";

export class MarkdownStream {
  constructor() {
    this.buf = "";
    this.inFence = false;
  }

  // Consume a chunk; returns the renderable output for completed lines.
  push(delta) {
    this.buf += String(delta ?? "");
    let out = "";
    let idx;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      out += this._renderLine(line) + "\n";
    }
    return out;
  }

  // Flush the incomplete trailing line (at end of an assistant segment).
  finish() {
    if (!this.buf.length) return "";
    const line = this.buf;
    this.buf = "";
    return this._renderLine(line) + "\n";
  }

  _renderLine(line) {
    if (/^\s*(```|~~~)/.test(line)) {
      this.inFence = !this.inFence;
      return dim("  " + line.trim());
    }
    if (this.inFence) {
      return dim("  " + line);
    }
    return this._renderPlain(line);
  }

  _renderPlain(line) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) return bold(h[1] + " " + this._inline(h[2]));
    if (/^\s*([-*+])\s+/.test(line)) {
      return cyan("•  ") + this._inline(line.replace(/^\s*[-*+]\s+/, ""));
    }
    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (num) return gray(num[1] + ".") + " " + this._inline(num[2]);
    if (/^\s*>\s?/.test(line)) {
      return dim("│ ") + dim(this._inline(line.replace(/^\s*>\s?/, "")));
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return dim("────────────────────────────────");
    if (!line.trim()) return "";
    return this._inline(line);
  }

  _inline(s) {
    s = s.replace(/`([^`]+)`/g, (_, c) => cyan(c));
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, b) => bold(b));
    return s;
  }
}
