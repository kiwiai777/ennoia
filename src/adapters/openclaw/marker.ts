export function stripCortexMarkers(content: string): string {
  const BEGIN_MARKER = '<!-- CORTEX_USER_MODEL_BEGIN -->';
  const END_MARKER = '<!-- CORTEX_USER_MODEL_END -->';

  let result = content;
  
  // check for errors
  const beginCount = (content.match(new RegExp(BEGIN_MARKER, 'g')) || []).length;
  const endCount = (content.match(new RegExp(END_MARKER, 'g')) || []).length;
  
  if (beginCount !== endCount) {
    console.warn(`[WARNING] OpenClaw marker mismatch: found ${beginCount} BEGIN and ${endCount} END markers. Skipping marker stripping.`);
    return content;
  }
  
  // if nested, we should warn and not strip.
  // basic regex check: a BEGIN followed by another BEGIN before an END
  const nestedRegex = new RegExp(`${BEGIN_MARKER}[\\s\\S]*?${BEGIN_MARKER}[\\s\\S]*?${END_MARKER}`);
  if (nestedRegex.test(content)) {
    console.warn(`[WARNING] OpenClaw marker nested error: BEGIN-BEGIN-END detected. Skipping marker stripping.`);
    return content;
  }

  // safe to strip pairs
  // The regex removes from BEGIN_MARKER to END_MARKER including the line they are on? 
  // Let's strip the entire block including markers.
  const stripRegex = new RegExp(`^.*${BEGIN_MARKER}.*[\\r\\n]*[\\s\\S]*?^.*${END_MARKER}.*[\\r\\n]*`, 'gm');
  // if markers aren't on their own lines, fallback
  const stripFallbackRegex = new RegExp(`${BEGIN_MARKER}[\\s\\S]*?${END_MARKER}`, 'g');
  
  result = result.replace(stripRegex, '');
  // fallback for inline markers just in case
  result = result.replace(stripFallbackRegex, '');
  
  return result;
}
