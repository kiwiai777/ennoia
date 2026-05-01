export async function detectOllama(endpoint = 'http://localhost:11434'): Promise<{
  available: boolean;
  models?: string[];
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${endpoint}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        available: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    const models = data.models?.map((m: any) => m.name) || [];

    return {
      available: true,
      models,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
