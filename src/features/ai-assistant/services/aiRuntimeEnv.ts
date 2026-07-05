interface AiRuntimeEnvSource {
  [key: string]: string | undefined;
  VITE_API_KEY?: string;
  VITE_OPENAI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  VITE_OPENAI_BASE_URL?: string;
  VITE_OPENAI_MODEL?: string;
  API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export interface AiRuntimeEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const readImportMetaEnv = (): AiRuntimeEnvSource => {
  return ((import.meta as ImportMeta & { env?: AiRuntimeEnvSource }).env ?? {}) as AiRuntimeEnvSource;
};

const readProcessEnv = (): AiRuntimeEnvSource => {
  return typeof process !== 'undefined' ? process.env : {};
};

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmedValue = value?.trim();
    if (trimmedValue) {
      return trimmedValue;
    }
  }
  return '';
};

export function resolveAiRuntimeEnv(
  viteEnv: AiRuntimeEnvSource = readImportMetaEnv(),
  processEnv: AiRuntimeEnvSource = readProcessEnv(),
): AiRuntimeEnv {
  return {
    apiKey: firstNonEmpty(
      viteEnv.VITE_API_KEY,
      viteEnv.VITE_OPENAI_API_KEY,
      viteEnv.VITE_GEMINI_API_KEY,
      processEnv.API_KEY,
      processEnv.OPENAI_API_KEY,
      processEnv.GEMINI_API_KEY,
    ),
    baseUrl:
      firstNonEmpty(viteEnv.VITE_OPENAI_BASE_URL, processEnv.OPENAI_BASE_URL) ||
      'https://api.openai.com/v1',
    model: firstNonEmpty(viteEnv.VITE_OPENAI_MODEL, processEnv.OPENAI_MODEL) || 'bce/deepseek-v3.2',
  };
}
