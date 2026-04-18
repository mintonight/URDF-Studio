/**
 * AI Assistant Feature Types
 */

import type { InspectionReport, RobotState } from '@/types';

/**
 * AI response structure
 */
export interface AIResponse {
  explanation: string;
  actionType: 'modification' | 'generation' | 'advice';
  robotData?: Partial<RobotState>;
}

/**
 * Inspection item definition
 */
export interface InspectionItem {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  maxScore: number;
}

/**
 * Inspection category definition
 */
export interface InspectionCategory {
  id: string;
  name: string;
  nameZh: string;
  weight: number;
  items: InspectionItem[];
}

/**
 * Issue types for inspection
 */
export type IssueType = 'error' | 'warning' | 'suggestion' | 'pass';

/**
 * Inspection issue
 */
export interface InspectionIssue {
  type: IssueType;
  title: string;
  description: string;
  category?: string;
  itemId?: string;
  score?: number;
  relatedIds?: string[];
}

export type AIConversationMode = 'general' | 'inspection-followup';

export interface AIConversationChatMessage {
  kind: 'message';
  role: 'user' | 'assistant';
  content: string;
}

export interface AIConversationDivider {
  kind: 'divider';
  marker: 'new-conversation';
}

export type AIConversationMessage = AIConversationChatMessage | AIConversationDivider;

export interface AIConversationSelection {
  type: 'link' | 'joint';
  id: string;
}

export interface AIConversationFocusedIssue {
  type: IssueType;
  title: string;
  description: string;
  category?: string;
  itemId?: string;
  score?: number;
  relatedIds?: string[];
}

export interface AIConversationLaunchContext {
  sessionId: number;
  mode: AIConversationMode;
  robotSnapshot: RobotState;
  inspectionReportSnapshot?: InspectionReport | null;
  selectedEntity?: AIConversationSelection | null;
  focusedIssue?: AIConversationFocusedIssue | null;
}

export interface AIConversationTurnError {
  code: 'empty_user_message' | 'missing_api_key' | 'empty_response' | 'request_failed';
  message: string;
}

export interface AIConversationTurnResult {
  reply: string;
  error: AIConversationTurnError | null;
}
