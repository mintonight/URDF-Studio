/**
 * AI Assistant Feature
 *
 * Provides AI-powered robot inspection, conversation, and report follow-up capabilities.
 */

// Components
export { AIModal } from './components/AIModal'
export { AIInspectionModal } from './components/AIInspectionModal'
export { AIConversationModal } from './components/AIConversationModal'

// Services
export { generateRobotFromPrompt, runRobotInspection } from './services/aiService'
export { sendConversationTurn } from './services/conversationService'

// Utilities
export {
  INSPECTION_CRITERIA,
  calculateItemScore,
  calculateCategoryScore,
  calculateOverallScore,
  getInspectionItem,
  getInspectionCategory
} from './utils/inspectionCriteria'

// Types
export type {
  AIResponse,
  InspectionItem,
  InspectionCategory,
  IssueType,
  InspectionIssue,
  AIConversationMode,
  AIConversationMessage,
  AIConversationFocusedIssue,
  AIConversationSelection,
  AIConversationLaunchContext,
  AIConversationTurnResult,
} from './types'
