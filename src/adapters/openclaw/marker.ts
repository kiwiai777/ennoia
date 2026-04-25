export function stripCortexMarkers(content: string): string {
  const BEGIN_MARKER = '<!-- CORTEX_USER_MODEL_BEGIN -->';
  const END_MARKER = '<!-- CORTEX_USER_MODEL_END -->';

  const lines = content.split('\n');
  const out: string[] = [];
  let inMarker = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === BEGIN_MARKER) {
      if (inMarker) {
        console.warn(`[WARNING] OpenClaw marker nested error: BEGIN-BEGIN-END detected. Skipping marker stripping.`);
        return content;
      }
      inMarker = true;
      continue;
    }
    if (trimmed === END_MARKER) {
      if (!inMarker) {
        console.warn(`[WARNING] OpenClaw marker mismatch: orphan END marker detected. Skipping marker stripping.`);
        return content;
      }
      inMarker = false;
      continue;
    }
    if (!inMarker) {
      out.push(line);
    }
  }

  if (inMarker) {
    console.warn(`[WARNING] OpenClaw marker mismatch: missing END marker detected. Skipping marker stripping.`);
    return content;
  }

  return out.join('\n');
}
