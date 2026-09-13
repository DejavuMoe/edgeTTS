const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXmlText(text: string): string {
  return text.replace(/[&<>"']/g, (match) => XML_ENTITIES[match] ?? match);
}
