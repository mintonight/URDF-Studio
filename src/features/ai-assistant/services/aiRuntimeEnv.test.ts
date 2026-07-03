import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAiRuntimeEnv } from './aiRuntimeEnv';

test('resolveAiRuntimeEnv reads Vite-prefixed browser env first', () => {
  const runtimeEnv = resolveAiRuntimeEnv(
    {
      VITE_OPENAI_API_KEY: ' vite-openai-key ',
      VITE_OPENAI_BASE_URL: ' https://example.test/v1 ',
      VITE_OPENAI_MODEL: ' deepseek-v4-pro ',
    },
    {
      API_KEY: 'process-key',
      OPENAI_BASE_URL: 'https://process.example/v1',
      OPENAI_MODEL: 'process-model',
    },
  );

  assert.deepEqual(runtimeEnv, {
    apiKey: 'vite-openai-key',
    baseUrl: 'https://example.test/v1',
    model: 'deepseek-v4-pro',
  });
});

test('resolveAiRuntimeEnv falls back to legacy process env names', () => {
  const runtimeEnv = resolveAiRuntimeEnv(
    {},
    {
      OPENAI_API_KEY: 'process-openai-key',
    },
  );

  assert.equal(runtimeEnv.apiKey, 'process-openai-key');
  assert.equal(runtimeEnv.baseUrl, 'https://api.openai.com/v1');
  assert.equal(runtimeEnv.model, 'bce/deepseek-v3.2');
});
