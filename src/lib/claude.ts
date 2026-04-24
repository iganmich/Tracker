export async function callClaude(
  prompt: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Claude proxy error: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const p = JSON.parse(line.slice(6).trim());
        if (p.delta?.type === "text_delta") {
          full += p.delta.text;
          onChunk(full);
        }
      } catch {
        /* ignore parse errors on keepalive lines */
      }
    }
  }
}
