import { AIConversationModal } from '@/features/ai-assistant/components/AIConversationModal';
import type { AIConversationLaunchContext } from '@/features/ai-assistant/types';
import type { Language } from '@/shared/i18n';

interface AIConversationConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
}

export function AIConversationConnector({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
}: AIConversationConnectorProps) {
  return (
    <AIConversationModal
      isOpen={isOpen}
      onClose={onClose}
      lang={lang}
      launchContext={launchContext}
      onStartNewConversation={onStartNewConversation}
    />
  );
}
