// Minimal ANSI helpers.
// Color can be disabled with --no-color, ROFORGE_NO_COLOR=1, or the standard
// NO_COLOR env var (checked at call time so flags work even after import).
function colorEnabled() {
  if (process.env.NO_COLOR || process.env.ROFORGE_NO_COLOR) return false;
  if (process.argv.includes("--no-color")) return false;
  return true;
}
const c = (n) => (s) => (colorEnabled() ? `\x1b[${n}m${s}\x1b[0m` : String(s));
export const bold = c(1);
export const dim = c(2);
export const red = c(31);
export const green = c(32);
export const yellow = c(33);
export const blue = c(34);
export const magenta = c(35);
export const cyan = c(36);
export const gray = c(90);

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "", "⠼", "⠴", "", "", "⠇", "⠏"];

export const CLEAR_LINE = "\x1b[2K";
export const MOVE_UP = (n) => `\x1b[${n}A`;
export const COLUMNS = () => (typeof process.stdout.columns === "number" ? process.stdout.columns : 80);

// Wrap plain text to terminal width (word-aware).
export function wrap(text, width) {
  width = Math.max(20, width - 2);
  const out = [];
  for (const rawLine of String(text).split("\n")) {
    let line = rawLine;
    while (line.length > width) {
      let cut = line.lastIndexOf(" ", width);
      if (cut < 20) cut = width;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^\s+/, "");
    }
    out.push(line);
  }
  return out.join("\n");
}
