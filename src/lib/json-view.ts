export function highlightJson(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let color = "text-sky-300";
      if (match.startsWith('"')) color = /:\s*$/.test(match) ? "text-lime" : "text-foreground";
      else if (match === "true" || match === "false") color = "text-warn";
      else if (match === "null") color = "text-destructive";
      return `<span class="${color}">${match}</span>`;
    },
  );
}

export function prettyBody(text: string): { json: boolean; text: string } {
  try {
    return { json: true, text: JSON.stringify(JSON.parse(text) as unknown, null, 2) };
  } catch {
    return { json: false, text };
  }
}
