import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { DraggableWindow } from '@/shared/components';
import { useDraggableWindow } from '@/shared/hooks';
import { Button } from '@/shared/components/ui/Button';
import { Dialog } from '@/shared/components/ui/Dialog';
import {
  sendConversationTurnStream,
  type ConversationHistoryTurn,
} from '../services/conversationService';
import { ConversationMessageMarkdown } from './ConversationMessageMarkdown';
import { buildConversationContext } from '../utils/buildConversationContext';
import { shouldSubmitConversationInput } from '../utils/conversationInput';
import { buildConversationPromptSuggestions } from '../utils/conversationPromptSuggestions';
import {
  createConversationMessage,
  isConversationChatMessage,
  removeTrailingAssistantPlaceholder,
  getActiveConversationHistory,
  replaceActiveConversationTimeline,
  startNewConversationTimeline,
} from '../utils/conversationTimeline';
import type { AIConversationLaunchContext, AIConversationMessage } from '../types';

interface AIConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
}

interface ConversationSubmissionState {
  history: ConversationHistoryTurn[];
  userMessage: string;
  replaceCurrentConversation?: boolean;
}

type ConversationResetAction = 'new-conversation' | 'clear-history';

function resolveSelectedEntityName(context: AIConversationLaunchContext | null): string | null {
  if (!context?.selectedEntity) {
    return null;
  }

  const { type, id } = context.selectedEntity;
  return type === 'link'
    ? context.robotSnapshot.links[id]?.name || id
    : context.robotSnapshot.joints[id]?.name || id;
}

function replaceTrailingAssistantMessage(
  messages: AIConversationMessage[],
  nextContent: string,
): AIConversationMessage[] {
  const nextMessages = [...messages];

  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (!message || !isConversationChatMessage(message)) {
      break;
    }

    if (message.role !== 'assistant') {
      continue;
    }

    nextMessages[index] = {
      kind: 'message',
      role: 'assistant',
      content: nextContent,
    };
    return nextMessages;
  }

  nextMessages.push({
    kind: 'message',
    role: 'assistant',
    content: nextContent,
  });
  return nextMessages;
}

function appendTrailingAssistantDelta(
  messages: AIConversationMessage[],
  delta: string,
): AIConversationMessage[] {
  if (!delta) {
    return messages;
  }

  const nextMessages = [...messages];
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (!message || !isConversationChatMessage(message)) {
      break;
    }

    if (message.role !== 'assistant') {
      continue;
    }

    nextMessages[index] = {
      kind: 'message',
      role: 'assistant',
      content: `${message.content}${delta}`,
    };
    return nextMessages;
  }

  nextMessages.push({
    kind: 'message',
    role: 'assistant',
    content: delta,
  });
  return nextMessages;
}

export function AIConversationModal({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
}: AIConversationModalProps) {
  const t = translations[lang];
  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: { width: 760, height: 620 },
    minSize: { width: 560, height: 400 },
    centerOnMount: true,
    enableMinimize: true,
  });
  const { isMinimized, size, isResizing } = windowState;

  const [messages, setMessages] = useState<AIConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [lastSubmittedTurn, setLastSubmittedTurn] = useState<ConversationSubmissionState | null>(
    null,
  );
  const [pendingResetAction, setPendingResetAction] = useState<ConversationResetAction | null>(
    null,
  );
  const [requestError, setRequestError] = useState<string | null>(null);

  const isMountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skipNextSessionResetRef = useRef(false);

  const selectedEntityName = useMemo(
    () => resolveSelectedEntityName(launchContext),
    [launchContext],
  );
  const isReportFollowup = launchContext?.mode === 'inspection-followup';
  const reportSnapshot = isReportFollowup
    ? (launchContext?.inspectionReportSnapshot ?? null)
    : null;
  const focusedIssue = isReportFollowup ? (launchContext?.focusedIssue ?? null) : null;
  const headerTitle = isReportFollowup ? t.discussReportWithAI : t.aiConversation;
  const headerSubtitle = isReportFollowup ? t.askAboutReport : t.aiConversationDesc;
  const latestTimelineValue = (() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return '';
    }

    return isConversationChatMessage(lastMessage) ? lastMessage.content : lastMessage.marker;
  })();
  const showHeaderActionLabels = !isMinimized && size.width >= 700;
  const suggestedPrompts = useMemo(
    () =>
      buildConversationPromptSuggestions({
        lang,
        isReportFollowup: Boolean(isReportFollowup),
        selectedEntityName,
        focusedIssueTitle: focusedIssue?.title,
      }),
    [focusedIssue?.title, isReportFollowup, lang, selectedEntityName],
  );

  const resetConversationState = useCallback(
    (options?: { preserveMessages?: boolean; startNewConversation?: boolean }) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestIdRef.current += 1;
      setMessages((currentMessages) => {
        if (!options?.preserveMessages) {
          return [];
        }

        if (options.startNewConversation) {
          return startNewConversationTimeline(currentMessages);
        }

        return removeTrailingAssistantPlaceholder(currentMessages);
      });
      setInput('');
      setIsSending(false);
      setCopiedMessageKey(null);
      setLastSubmittedTurn(null);
      setPendingResetAction(null);
      setRequestError(null);
      isComposingRef.current = false;
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (skipNextSessionResetRef.current) {
      skipNextSessionResetRef.current = false;
      return;
    }

    resetConversationState();
  }, [launchContext?.sessionId, resetConversationState]);

  useEffect(() => {
    if (!isOpen && isSending) {
      abortControllerRef.current?.abort();
    }
  }, [isOpen, isSending]);

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [input.length, isOpen, isMinimized, launchContext?.sessionId]);

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        block: 'end',
        behavior: messages.length <= 1 && !isSending ? 'auto' : 'smooth',
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen, isMinimized, isSending, latestTimelineValue, messages.length]);

  const handleCopyMessage = async (messageKey: string, content: string) => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);

      if (!isMountedRef.current) {
        return;
      }

      setCopiedMessageKey(messageKey);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }

      copiedTimerRef.current = setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current));
      }, 1800);
    } catch (error) {
      console.error('Conversation copy failed', error);
    }
  };

  const handleStopGenerating = () => {
    abortControllerRef.current?.abort();
  };

  const handleConfirmResetAction = () => {
    if (!launchContext || !pendingResetAction) {
      return;
    }

    if (pendingResetAction === 'new-conversation') {
      skipNextSessionResetRef.current = true;
      resetConversationState({
        preserveMessages: true,
        startNewConversation: true,
      });
      onStartNewConversation(launchContext);
      return;
    }

    resetConversationState();
  };

  const handleSuggestedPromptSelect = async (prompt: string) => {
    if (!prompt.trim() || isSending) {
      return;
    }

    setInput('');
    await submitConversationTurn({
      history: [],
      userMessage: prompt,
    });
  };

  const submitConversationTurn = async ({
    history,
    userMessage,
    replaceCurrentConversation = false,
  }: ConversationSubmissionState) => {
    if (!launchContext || !userMessage.trim() || isSending) {
      return;
    }

    const trimmedMessage = userMessage.trim();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const isRequestActive = () =>
      isMountedRef.current &&
      requestIdRef.current === requestId &&
      abortControllerRef.current === abortController;

    setLastSubmittedTurn({
      history: history.map((message) => ({ ...message })),
      userMessage: trimmedMessage,
    });
    setRequestError(null);
    const nextTurnMessages = [
      createConversationMessage('user', trimmedMessage),
      createConversationMessage('assistant', ''),
    ];
    setMessages((prev) => {
      if (replaceCurrentConversation) {
        return replaceActiveConversationTimeline(prev, [
          ...history.map((message) => createConversationMessage(message.role, message.content)),
          ...nextTurnMessages,
        ]);
      }

      return [...removeTrailingAssistantPlaceholder(prev), ...nextTurnMessages];
    });
    setIsSending(true);

    try {
      const result = await sendConversationTurnStream({
        mode: launchContext.mode,
        lang,
        context: buildConversationContext({
          mode: launchContext.mode,
          robot: launchContext.robotSnapshot,
          inspectionReport: reportSnapshot,
          selectedEntity: launchContext.selectedEntity,
          focusedIssue,
        }),
        history,
        userMessage: trimmedMessage,
        signal: abortController.signal,
        onReplyDelta: (delta) => {
          if (!isRequestActive()) {
            return;
          }

          setMessages((prev) => appendTrailingAssistantDelta(prev, delta));
        },
      });

      if (!isRequestActive()) {
        return;
      }

      if (result.status === 'aborted') {
        setRequestError(null);
        setMessages((prev) => {
          if (result.reply) {
            return replaceTrailingAssistantMessage(prev, result.reply);
          }

          return removeTrailingAssistantPlaceholder(prev);
        });
        return;
      }

      if (result.status === 'error') {
        setRequestError(result.error?.message ?? t.unknownError);
        setMessages((prev) => {
          if (result.reply) {
            return replaceTrailingAssistantMessage(prev, result.reply);
          }

          return removeTrailingAssistantPlaceholder(prev);
        });
        return;
      }

      setRequestError(null);
      setMessages((prev) => replaceTrailingAssistantMessage(prev, result.reply));
    } finally {
      if (isRequestActive()) {
        abortControllerRef.current = null;
        setIsSending(false);
      }
    }
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      return;
    }

    const history = getActiveConversationHistory(messages);
    setInput('');
    await submitConversationTurn({
      history,
      userMessage: trimmedInput,
    });
  };

  const handleRetry = async () => {
    if (!lastSubmittedTurn || isSending) {
      return;
    }

    await submitConversationTurn({
      history: lastSubmittedTurn.history,
      userMessage: lastSubmittedTurn.userMessage,
      replaceCurrentConversation: true,
    });
  };

  if (!isOpen || !launchContext) {
    return null;
  }

  const confirmDialogTitle =
    pendingResetAction === 'new-conversation'
      ? t.newConversationConfirmTitle
      : t.clearConversationHistoryConfirmTitle;
  const confirmDialogMessage =
    pendingResetAction === 'new-conversation'
      ? t.newConversationConfirmMessage
      : t.clearConversationHistoryConfirmMessage;
  const confirmDialogActionLabel =
    pendingResetAction === 'new-conversation' ? t.newConversation : t.clearConversationHistory;
  const headerActionButtonClassName =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-panel-bg px-2.5 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover focus:outline-none focus:ring-2 focus:ring-system-blue/30 dark:bg-panel-bg';
  const newConversationButtonClassName = `${headerActionButtonClassName} hover:border-system-blue/35 hover:text-system-blue focus:border-system-blue/35 focus:text-system-blue`;
  const clearHistoryButtonClassName = `${headerActionButtonClassName} hover:border-danger-border hover:bg-danger-soft hover:text-danger-hover focus:ring-danger/20`;

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[95] bg-transparent" />

      <DraggableWindow
        window={windowState}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-border-black bg-panel-bg p-1.5 text-system-blue dark:bg-element-bg dark:text-system-blue">
              <MessageCircle className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-sm font-semibold text-text-primary">{headerTitle}</h1>
              {!isMinimized && <p className="text-[10px] text-text-tertiary">{headerSubtitle}</p>}
            </div>
          </div>
        }
        headerActions={
          <div className="flex items-center gap-2">
            <button
              data-window-control
              type="button"
              onClick={() => setPendingResetAction('new-conversation')}
              className={newConversationButtonClassName}
              aria-label={t.newConversation}
              title={t.newConversation}
            >
              <Plus className="h-3.5 w-3.5" />
              {showHeaderActionLabels && <span>{t.newConversation}</span>}
            </button>
            <button
              data-window-control
              type="button"
              onClick={() => setPendingResetAction('clear-history')}
              className={clearHistoryButtonClassName}
              aria-label={t.clearConversationHistory}
              title={t.clearConversationHistory}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {showHeaderActionLabels && <span>{t.clearConversationHistory}</span>}
            </button>
          </div>
        }
        className="z-[110] flex flex-col overflow-hidden rounded-2xl border border-border-black bg-panel-bg text-text-primary shadow-xl dark:bg-panel-bg"
        headerClassName="h-12 border-b border-border-black flex items-center justify-between px-4 bg-element-bg shrink-0"
        interactionClassName="select-none"
        minimizeTitle={t.minimize}
        maximizeTitle={t.maximize}
        restoreTitle={t.restore}
        closeTitle={t.close}
        controlButtonClassName="p-1.5 hover:bg-element-hover rounded-md transition-colors"
        closeButtonClassName="p-1.5 text-text-tertiary hover:bg-red-500 hover:text-white rounded-md transition-colors"
        rightResizeHandleClassName="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-system-blue/15 active:bg-system-blue/25 transition-colors z-20"
        bottomResizeHandleClassName="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-system-blue/15 active:bg-system-blue/25 transition-colors z-20"
        cornerResizeHandleClassName="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize hover:bg-system-blue/20 active:bg-system-blue/30 transition-colors z-30 flex items-center justify-center"
        cornerResizeHandle={<div className="w-2 h-2 border-r-2 border-b-2 border-border-strong" />}
      >
        {!isMinimized && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              className={`flex-1 overflow-y-auto bg-white px-6 pt-6 dark:bg-panel-bg custom-scrollbar ${
                messages.length === 0 ? 'pb-2' : 'pb-6'
              }`}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label={headerTitle}
            >
              {messages.length === 0 ? (
                <div className="flex h-full min-h-0 flex-col items-center justify-end px-10 text-center">
                  <div className="rounded-2xl border border-border-black bg-panel-bg p-4 shadow-sm dark:bg-element-bg">
                    <MessageCircle className="w-8 h-8 text-text-tertiary opacity-40" />
                  </div>
                  <div className="mt-4 max-w-2xl space-y-4">
                    <div className="text-sm font-semibold text-text-primary">{headerTitle}</div>
                    <p className="text-xs leading-relaxed text-text-tertiary">
                      {isReportFollowup ? t.askAboutReport : t.aiConversationDesc}
                    </p>
                    <div className="space-y-3 rounded-2xl border border-border-black bg-panel-bg/80 px-4 py-4 text-left shadow-sm dark:bg-element-bg/70">
                      <div className="flex items-start gap-3 rounded-xl border border-border-black/60 bg-element-bg/70 px-3 py-3 dark:bg-element-bg">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-system-blue/20 bg-system-blue/10 text-system-blue">
                          <MessageCircle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                            {t.examples}
                          </div>
                          <div className="text-[10px] leading-relaxed text-text-tertiary">
                            {t.conversationSuggestionsHint}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {suggestedPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => {
                              void handleSuggestedPromptSelect(prompt);
                            }}
                            className="group flex items-start gap-3 rounded-xl border border-border-black bg-panel-bg px-3.5 py-3 text-left shadow-sm transition-all duration-100 hover:-translate-y-0.5 hover:border-system-blue/35 hover:bg-element-hover focus:border-system-blue/35 focus:bg-element-hover focus:outline-none focus:ring-2 focus:ring-system-blue/30 dark:bg-panel-bg"
                            title={prompt}
                          >
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-system-blue/20 bg-system-blue/10 text-system-blue transition-colors group-hover:border-system-blue/35 group-hover:bg-system-blue/15 group-hover:text-system-blue-hover group-focus-visible:border-system-blue/35 group-focus-visible:bg-system-blue/15 group-focus-visible:text-system-blue-hover">
                              <Send className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs leading-relaxed text-text-secondary transition-colors group-hover:text-text-primary group-focus-visible:text-text-primary">
                                {prompt}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, index) => {
                    if (!isConversationChatMessage(message)) {
                      return (
                        <div key={`divider-${index}`} className="flex items-center gap-3 py-3">
                          <div className="h-px flex-1 bg-border-black" />
                          <span className="rounded-full border border-border-black bg-element-bg px-3 py-1 text-[10px] font-semibold tracking-[0.08em] text-text-tertiary dark:bg-element-bg">
                            {t.newConversationDividerLabel}
                          </span>
                          <div className="h-px flex-1 bg-border-black" />
                        </div>
                      );
                    }

                    const messageKey = `${message.role}-${index}`;
                    const isCopied = copiedMessageKey === messageKey;
                    const isStreamingAssistant =
                      message.role === 'assistant' && index === messages.length - 1 && isSending;

                    return (
                      <div
                        key={messageKey}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className="max-w-[85%]">
                          <div
                            className={`rounded-xl px-4 py-3 shadow-sm ${
                              message.role === 'user'
                                ? 'rounded-tr-[4px] border border-system-blue-solid bg-system-blue-solid text-white'
                                : 'rounded-tl-[4px] border border-border-black bg-panel-bg text-text-secondary dark:bg-element-bg'
                            }`}
                          >
                            {isStreamingAssistant && !message.content ? (
                              <div className="flex items-center gap-2 text-sm text-text-tertiary">
                                <Loader2 className="w-4 h-4 animate-spin text-system-blue" />
                                <span>{t.aiAnalyzing}</span>
                              </div>
                            ) : (
                              <>
                                <ConversationMessageMarkdown
                                  content={message.content}
                                  tone={message.role === 'user' ? 'user' : 'assistant'}
                                />
                                {isStreamingAssistant && message.content && (
                                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-text-tertiary">
                                    <Loader2 className="w-3 h-3 animate-spin text-system-blue" />
                                    <span>{t.aiAnalyzing}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {message.content && (
                            <div
                              className={`mt-1.5 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void handleCopyMessage(messageKey, message.content);
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors focus:outline-none focus:ring-2 ${
                                  message.role === 'user'
                                    ? 'border-white/20 bg-white/10 text-white/90 hover:bg-white/15 focus:ring-white/30'
                                    : 'border-border-black bg-panel-bg text-text-tertiary hover:bg-element-hover hover:text-text-secondary focus:ring-system-blue/30 dark:bg-element-bg'
                                }`}
                                aria-label={isCopied ? t.copied : t.copyToClipboard}
                                title={isCopied ? t.copied : t.copyToClipboard}
                              >
                                {isCopied ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{isCopied ? t.copied : t.copy}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div ref={messagesEndRef} aria-hidden="true" />
                </div>
              )}
            </div>

            <div className="border-t border-border-black bg-element-bg p-4">
              <div className="rounded-xl border border-border-black bg-panel-bg p-2 shadow-sm dark:bg-panel-bg">
                {requestError && (
                  <div className="mb-2 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
                    {requestError}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      shouldSubmitConversationInput(event, { isComposing: isComposingRef.current })
                    ) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={t.chatPlaceholder}
                  className="min-h-[88px] w-full resize-none rounded-lg border-none bg-transparent px-2 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="px-2 text-[10px] font-medium text-text-tertiary">
                    {t.sendOnEnterHint}
                  </span>
                  <div className="flex items-center gap-2">
                    {lastSubmittedTurn && !isSending && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRetry();
                        }}
                        className="flex h-8 items-center gap-2 rounded-lg border border-border-black bg-panel-bg px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-element-hover"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t.retryLastResponse}
                      </button>
                    )}
                    {isSending && (
                      <button
                        type="button"
                        onClick={handleStopGenerating}
                        className="flex h-8 items-center gap-2 rounded-lg border border-border-black bg-panel-bg px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-element-hover"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        {t.stopGenerating}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void handleSend();
                      }}
                      disabled={isSending || !input.trim()}
                      className="flex h-8 items-center gap-2 rounded-lg bg-system-blue-solid px-4 text-xs font-semibold text-white transition-colors hover:bg-system-blue-hover disabled:opacity-30"
                    >
                      {isSending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      {t.send}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isResizing && (
          <div className="absolute bottom-2 right-12 z-50 rounded-lg bg-system-blue-solid px-2 py-1 text-[10px] font-medium text-white shadow-sm">
            {size.width} × {size.height}
          </div>
        )}
      </DraggableWindow>

      <Dialog
        isOpen={pendingResetAction !== null}
        onClose={() => setPendingResetAction(null)}
        title={confirmDialogTitle}
        width="w-[460px]"
        zIndexClassName="z-[130]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingResetAction(null)}>
              {t.cancel}
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmResetAction}>
              {confirmDialogActionLabel}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">{confirmDialogMessage}</p>
      </Dialog>
    </>
  );
}

export default AIConversationModal;
