import OpenAI from 'openai';
import { translations, type Language } from '@/shared/i18n';
import { getConversationSystemPrompt, type ConversationMode } from '../config/prompts';

export interface ConversationHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendConversationTurnInput {
  mode: ConversationMode;
  lang?: Language;
  context: string;
  history?: ConversationHistoryTurn[];
  userMessage: string;
}

export interface SendConversationTurnStreamInput extends SendConversationTurnInput {
  signal?: AbortSignal;
  onReplyDelta?: (delta: string) => void;
}

export type ConversationTurnErrorCode =
  | 'empty_user_message'
  | 'missing_api_key'
  | 'empty_response'
  | 'request_failed';

export interface ConversationTurnError {
  code: ConversationTurnErrorCode;
  message: string;
}

export interface ConversationTurnResult {
  reply: string;
  error: ConversationTurnError | null;
}

export interface ConversationTurnStreamResult extends ConversationTurnResult {
  status: 'completed' | 'aborted' | 'error';
}

interface ConversationStreamChunkLike {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

const MAX_HISTORY_TURNS = 8;

const getApiKey = (): string => {
  const candidates = [process.env.API_KEY, process.env.OPENAI_API_KEY, process.env.GEMINI_API_KEY];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      return value;
    }
  }

  return '';
};

const getBaseUrl = (): string => {
  return process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
};

const createOpenAIClient = (apiKey: string): OpenAI => {
  return new OpenAI({
    apiKey,
    baseURL: getBaseUrl(),
    dangerouslyAllowBrowser: true,
  });
};

const getModelName = (): string => {
  return process.env.OPENAI_MODEL?.trim() || 'bce/deepseek-v3.2';
};

const getConversationTexts = (lang: Language) => {
  const t = translations[lang];
  return {
    missingApiKey: t.apiKeyMissing,
    emptyResponse: t.aiServiceReturnedEmptyContent,
    unknownError: t.unknownError,
    requestFailed: (message?: string) =>
      t.aiServiceCouldNotProcessRequest.replace(
        '{message}',
        message || t.unknownError.toLowerCase(),
      ),
  };
};

const sanitizeHistoryTurn = (turn: ConversationHistoryTurn): ConversationHistoryTurn | null => {
  if (!turn.content) return null;
  const content = turn.content.trim();
  if (!content) return null;
  if (turn.role !== 'user' && turn.role !== 'assistant') return null;
  return {
    role: turn.role,
    content,
  };
};

export const buildConversationMessages = (
  history: ConversationHistoryTurn[] | undefined,
  userMessage: string,
): Array<{ role: 'user' | 'assistant'; content: string }> => {
  const normalizedHistory = (history || [])
    .map(sanitizeHistoryTurn)
    .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
    .slice(-MAX_HISTORY_TURNS);

  const normalizedUserMessage = userMessage.trim();
  const messages = normalizedHistory.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  messages.push({
    role: 'user',
    content: normalizedUserMessage,
  });

  return messages;
};

export const serializeConversationHistory = (
  history: ConversationHistoryTurn[] | undefined,
): string => {
  const normalizedHistory = (history || [])
    .map(sanitizeHistoryTurn)
    .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
    .slice(-MAX_HISTORY_TURNS);

  return JSON.stringify(normalizedHistory);
};

const buildConversationError = (
  code: ConversationTurnErrorCode,
  message: string,
): ConversationTurnError => ({
  code,
  message,
});

export const isConversationAbortError = (error: unknown): boolean => {
  return (
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  );
};

export const extractConversationDelta = (
  chunk: ConversationStreamChunkLike | null | undefined,
): string => {
  if (!chunk?.choices?.length) {
    return '';
  }

  return chunk.choices.map((choice) => choice.delta?.content ?? '').join('');
};

export const sendConversationTurnStream = async ({
  mode,
  lang = 'en',
  context,
  history = [],
  userMessage,
  signal,
  onReplyDelta,
}: SendConversationTurnStreamInput): Promise<ConversationTurnStreamResult> => {
  const text = getConversationTexts(lang);
  const trimmedMessage = userMessage.trim();

  if (!trimmedMessage) {
    return {
      reply: '',
      error: buildConversationError('empty_user_message', text.emptyResponse),
      status: 'error',
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      reply: '',
      error: buildConversationError('missing_api_key', text.missingApiKey),
      status: 'error',
    };
  }

  const systemPrompt = getConversationSystemPrompt(lang, {
    mode,
    context,
    // Conversation history already goes into `messages`; keep the prompt copy empty
    // so we do not pay for the same turns twice.
    history: '',
  });

  const openai = createOpenAIClient(apiKey);
  const modelName = getModelName();
  const messages = buildConversationMessages(history, trimmedMessage);
  const requestMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
  let reply = '';

  try {
    const stream = await openai.chat.completions.create(
      {
        model: modelName,
        messages: requestMessages,
        temperature: 0.3,
        stream: true,
      },
      {
        signal,
      },
    );

    for await (const chunk of stream) {
      const delta = extractConversationDelta(chunk);
      if (!delta) {
        continue;
      }

      reply += delta;
      onReplyDelta?.(delta);
    }

    const normalizedReply = reply.trim();
    if (!normalizedReply) {
      return {
        reply: '',
        error: buildConversationError('empty_response', text.emptyResponse),
        status: 'error',
      };
    }

    return {
      reply: normalizedReply,
      error: null,
      status: 'completed',
    };
  } catch (error) {
    if (isConversationAbortError(error) || signal?.aborted) {
      return {
        reply: reply.trim(),
        error: null,
        status: 'aborted',
      };
    }

    const e = error as { message?: string };
    console.error('Conversation request failed', error);
    return {
      reply: '',
      error: buildConversationError('request_failed', text.requestFailed(e?.message)),
      status: 'error',
    };
  }
};

export const sendConversationTurn = async (
  input: SendConversationTurnInput,
): Promise<ConversationTurnResult> => {
  const result = await sendConversationTurnStream(input);
  return {
    reply: result.reply,
    error: result.error,
  };
};
