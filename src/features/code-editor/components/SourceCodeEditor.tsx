/**
 * SourceCodeEditor - Unified Monaco source window for editable and read-only code.
 * Supports URDF, Xacro, MJCF, USD text, and equivalent MJCF previews in one reusable shell.
 */
import React, {
  Suspense,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  startTransition,
} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  Code,
  Copy,
  Download,
  Info,
  Loader2,
  Lock,
  Maximize,
  Minimize,
  Save,
  X,
} from 'lucide-react';
import type { Theme } from '@/types';
import { useUIStore, type CodeEditorFontFamily, type Language } from '@/store';
import { DraggableWindow } from '@/shared/components';
import { useDraggableWindow } from '@/shared/hooks';
import { Tooltip } from '@/shared/components/ui';
import type { SourceCodeDocumentFlavor } from '../types';
import type { MonacoInstance } from '../utils/monacoLoader';
import {
  getDocumentLanguageId,
  isXmlLikeDocumentFlavor,
  resolveXmlCompletionEntryForContext,
  supportsDocumentValidation,
} from '../utils/xmlLanguageSupport';
import { getUrdfValidationDebounceMs } from '../utils/editorPerformance.ts';
import { ensureSourceCodeEditorLanguages } from '../utils/monacoLoader';
import { downloadSourceCodeDocument } from '../utils/sourceCodeDownload';
import type { ValidationError } from '../utils/urdfValidation.ts';
import {
  requestXmlCompletionsWithWorker,
  requestXmlValidationWithWorker,
} from '../utils/xmlEditorWorkerBridge.ts';
import { useSourceCodeEditorAutoApply } from '../hooks/useSourceCodeEditorAutoApply';

export interface SourceCodeEditorProps {
  code: string;
  onCodeChange: (newCode: string) => Promise<boolean> | boolean;
  onClose: () => void;
  theme: Theme;
  fileName?: string;
  lang?: Language;
  documentFlavor?: SourceCodeDocumentFlavor;
  readOnly?: boolean;
  autoApplyEnabled?: boolean;
  onDownload?: () => void;
}

interface DocumentMeta {
  language: ReturnType<typeof getDocumentLanguageId>;
  label: string;
  supportsValidation: boolean;
  isXmlLike: boolean;
}

const editorTexts = {
  en: {
    save: 'Save',
    saveTooltip: 'Save (Ctrl+S)',
    download: 'Download',
    downloadTooltip: 'Download file',
    previewDownloadTooltip: 'Use the Export dialog to download a complete MJCF bundle',
    copy: 'Copy',
    copyTooltip: 'Copy to clipboard',
    copied: 'Copied',
    modified: 'Modified',
    readOnly: 'Read-only',
    readOnlyView: 'Read-only view',
    generated: 'Generated',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
    maximized: 'Maximized',
    noErrors: 'No errors',
    problems: 'problems',
    loading: 'Loading...',
    noStructuralValidation: 'No structural validation',
    jumpToProblem: 'Jump to first problem',
    saveShortcut: 'Ctrl+S',
    urdfLabel: 'URDF/XML',
    xacroLabel: 'Xacro/XML',
    sdfLabel: 'SDF/XML',
    mjcfLabel: 'MJCF/XML',
    usdLabel: 'USD/ASCII',
    equivalentMjcfLabel: 'Equivalent MJCF',
    xmlParseError: 'XML parsing error',
    missingRobotRoot: 'Missing <robot> root element',
    robotMissingName: '<robot> element missing name attribute',
    linkMissingName: 'Link #{0} missing name attribute',
    jointMissingName: 'Joint #{0} missing name attribute',
    jointMissingType: 'Joint "{0}" missing type attribute',
    jointMissingParent: 'Joint "{0}" missing <parent> element',
    jointMissingChild: 'Joint "{0}" missing <child> element',
    missingSdfRoot: 'Missing <sdf> root element',
    sdfMissingVersion: '<sdf> element missing version attribute',
    sdfMissingModelOrWorld: '<sdf> must contain at least one <model> or <world>',
    sdfModelMissingName: 'SDF model #{0} missing name attribute',
    sdfLinkMissingName: 'SDF link #{0} missing name attribute',
    sdfJointMissingName: 'SDF joint #{0} missing name attribute',
    sdfJointMissingType: 'SDF joint "{0}" missing type attribute',
    sdfJointMissingParent: 'SDF joint "{0}" missing <parent> element',
    sdfJointMissingChild: 'SDF joint "{0}" missing <child> element',
    invalidSdfJointType: 'SDF joint "{0}" has invalid type "{1}"',
    missingMjcfRoot: 'Missing <mujoco> root element',
    missingMjcfWorldbody: '<mujoco> is missing required <worldbody> element',
    invalidMjcfJointType: 'MJCF <joint> has invalid type "{0}"',
    invalidMjcfGeomType: 'MJCF <geom> has invalid type "{0}"',
    unknownElement: 'Unknown <{0}> element under <{1}>',
    unknownAttribute: '<{0}> has unknown "{1}" attribute',
    missingRequiredAttribute: '<{0}> missing required "{1}" attribute',
    invalidAttributeValue: '<{0}> attribute "{1}" has invalid value "{2}"',
    cannotParseXml: 'Cannot parse XML',
  },
  zh: {
    save: '保存',
    saveTooltip: '保存 (Ctrl+S)',
    download: '下载',
    downloadTooltip: '下载文件',
    previewDownloadTooltip: '请使用导出面板下载完整的 MJCF bundle',
    copy: '复制',
    copyTooltip: '复制到剪贴板',
    copied: '已复制',
    modified: '已修改',
    readOnly: '只读',
    readOnlyView: '只读视图',
    generated: '生成内容',
    maximize: '最大化',
    restore: '还原',
    close: '关闭',
    maximized: '最大化',
    noErrors: '无错误',
    problems: '个问题',
    loading: '加载中...',
    noStructuralValidation: '当前模式不做结构校验',
    jumpToProblem: '跳转到第一个问题',
    saveShortcut: 'Ctrl+S',
    urdfLabel: 'URDF/XML',
    xacroLabel: 'Xacro/XML',
    sdfLabel: 'SDF/XML',
    mjcfLabel: 'MJCF/XML',
    usdLabel: 'USD/ASCII',
    equivalentMjcfLabel: '等效 MJCF',
    xmlParseError: 'XML 解析错误',
    missingRobotRoot: '缺少 <robot> 根元素',
    robotMissingName: '<robot> 元素缺少 name 属性',
    linkMissingName: '第 {0} 个 <link> 缺少 name 属性',
    jointMissingName: '第 {0} 个 <joint> 缺少 name 属性',
    jointMissingType: '关节 "{0}" 缺少 type 属性',
    jointMissingParent: '关节 "{0}" 缺少 <parent> 元素',
    jointMissingChild: '关节 "{0}" 缺少 <child> 元素',
    missingSdfRoot: '缺少 <sdf> 根元素',
    sdfMissingVersion: '<sdf> 元素缺少 version 属性',
    sdfMissingModelOrWorld: '<sdf> 中至少需要一个 <model> 或 <world>',
    sdfModelMissingName: '第 {0} 个 SDF <model> 缺少 name 属性',
    sdfLinkMissingName: '第 {0} 个 SDF <link> 缺少 name 属性',
    sdfJointMissingName: '第 {0} 个 SDF <joint> 缺少 name 属性',
    sdfJointMissingType: 'SDF 关节 "{0}" 缺少 type 属性',
    sdfJointMissingParent: 'SDF 关节 "{0}" 缺少 <parent> 元素',
    sdfJointMissingChild: 'SDF 关节 "{0}" 缺少 <child> 元素',
    invalidSdfJointType: 'SDF 关节 "{0}" 的 type 值 "{1}" 非法',
    missingMjcfRoot: '缺少 <mujoco> 根元素',
    missingMjcfWorldbody: '<mujoco> 缺少必需的 <worldbody> 元素',
    invalidMjcfJointType: 'MJCF <joint> 的 type 值 "{0}" 非法',
    invalidMjcfGeomType: 'MJCF <geom> 的 type 值 "{0}" 非法',
    unknownElement: '<{1}> 下存在未知元素 <{0}>',
    unknownAttribute: '<{0}> 存在未知属性 "{1}"',
    missingRequiredAttribute: '<{0}> 缺少必需属性 "{1}"',
    invalidAttributeValue: '<{0}> 的属性 "{1}" 存在非法值 "{2}"',
    cannotParseXml: '无法解析 XML',
  },
};

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const FIND_WIDGET_TOOLTIP_TARGET_SELECTOR =
  '.find-widget .button, .find-widget .monaco-custom-toggle';
const HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-element-hover';
const HEADER_PRIMARY_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors';
const MonacoEditor = React.lazy(() =>
  import('@monaco-editor/react').then((module) => ({ default: module.default })),
);

const formatContentSize = (content: string): string => {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const resolveCodeEditorFontFamily = (fontFamily: CodeEditorFontFamily): string => {
  switch (fontFamily) {
    case 'fira-code':
      return "'Fira Code', 'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace";
    case 'system-mono':
      return "ui-monospace, 'SFMono-Regular', 'Consolas', 'Monaco', 'Liberation Mono', 'Courier New', monospace";
    case 'jetbrains-mono':
    default:
      return "'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace";
  }
};

const getDocumentMeta = (
  documentFlavor: SourceCodeDocumentFlavor,
  t: (typeof editorTexts)['en'],
): DocumentMeta => {
  const language = getDocumentLanguageId(documentFlavor);

  switch (documentFlavor) {
    case 'mjcf':
      return {
        language,
        label: t.mjcfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'sdf':
      return {
        language,
        label: t.sdfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'usd':
      return {
        language,
        label: t.usdLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'equivalent-mjcf':
      return {
        language,
        label: t.equivalentMjcfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'xacro':
      return {
        language,
        label: t.xacroLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'urdf':
    default:
      return {
        language,
        label: t.urdfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
  }
};

const attachFindWidgetTooltipSuppression = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: { getDomNode: () => any },
) => {
  const editorDomNode = editor.getDomNode();
  if (!(editorDomNode instanceof HTMLElement)) {
    return () => undefined;
  }

  const handleMouseOverCapture = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(FIND_WIDGET_TOOLTIP_TARGET_SELECTOR)) {
      event.stopPropagation();
    }
  };

  editorDomNode.addEventListener('mouseover', handleMouseOverCapture, true);

  return () => {
    editorDomNode.removeEventListener('mouseover', handleMouseOverCapture, true);
  };
};

const toWorkerValidationError = (
  error: unknown,
  t: (typeof editorTexts)['en'],
): ValidationError[] => [
  {
    line: 1,
    column: 1,
    message: `${t.cannotParseXml}: ${error instanceof Error ? error.message : String(error)}`,
  },
];

export const SourceCodeEditor: React.FC<SourceCodeEditorProps> = ({
  code,
  onCodeChange,
  onClose,
  theme,
  fileName = 'robot.urdf',
  lang = 'en',
  documentFlavor = 'urdf',
  readOnly = false,
  autoApplyEnabled = true,
  onDownload,
}) => {
  const codeEditorFontFamily = useUIStore((state) => state.codeEditorFontFamily);
  const codeEditorFontSize = useUIStore((state) => state.codeEditorFontSize);
  const t = editorTexts[lang];
  const isEquivalentMjcfPreview = documentFlavor === 'equivalent-mjcf';
  const isReadOnly = readOnly || documentFlavor === 'equivalent-mjcf';
  const documentMeta = useMemo(() => getDocumentMeta(documentFlavor, t), [documentFlavor, t]);
  const [isDirty, setIsDirty] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isValidationPending, setIsValidationPending] = useState(documentMeta.supportsValidation);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [autoApplyBlockedCode, setAutoApplyBlockedCode] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState(code);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAppliedCodeRef = useRef<string | null>(null);
  const pendingAppliedBaseCodeRef = useRef<string | null>(null);
  const validationRequestSequenceRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const editorMountVersionRef = useRef(0);
  const [monacoInstance, setMonacoInstance] = useState<MonacoInstance | null>(null);

  const windowState = useDraggableWindow({
    defaultPosition: { x: 100, y: 100 },
    defaultSize: { width: 800, height: 600 },
    minSize: { width: MIN_WIDTH, height: MIN_HEIGHT },
    centerOnMount: false,
    enableMinimize: false,
    clampResizeToViewport: false,
    dragBounds: {
      allowNegativeX: true,
      minVisibleWidth: 100,
      bottomMargin: 50,
    },
  });

  const { isMaximized, size, toggleMaximize } = windowState;

  const contentSizeLabel = useMemo(() => formatContentSize(currentCode), [currentCode]);

  useEffect(() => {
    return () => {
      editorMountVersionRef.current += 1;
      validationRequestSequenceRef.current += 1;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const awaitingParentApplySync =
      pendingAppliedCodeRef.current !== null &&
      pendingAppliedCodeRef.current === currentCode &&
      code === pendingAppliedBaseCodeRef.current;

    if (awaitingParentApplySync) {
      return;
    }

    if (pendingAppliedCodeRef.current !== null && code !== pendingAppliedBaseCodeRef.current) {
      pendingAppliedCodeRef.current = null;
      pendingAppliedBaseCodeRef.current = null;
    }

    if (editorRef.current && code !== currentCode && !isDirty) {
      editorRef.current.setValue(code);
      setCurrentCode(code);
      setAutoApplyBlockedCode(null);
      return;
    }

    if (code === currentCode && pendingAppliedCodeRef.current === code) {
      pendingAppliedCodeRef.current = null;
      pendingAppliedBaseCodeRef.current = null;
    }
  }, [code, currentCode, isDirty]);

  useEffect(() => {
    if (!documentMeta.supportsValidation) {
      setValidationErrors([]);
      setIsValidationPending(false);
      validationRequestSequenceRef.current += 1;
      return undefined;
    }

    const requestSequence = validationRequestSequenceRef.current + 1;
    validationRequestSequenceRef.current = requestSequence;
    setIsValidationPending(true);

    const timeout = window.setTimeout(() => {
      void requestXmlValidationWithWorker(currentCode, documentFlavor, t)
        .then((nextErrors) => {
          if (validationRequestSequenceRef.current !== requestSequence) {
            return;
          }
          startTransition(() => {
            setValidationErrors(nextErrors);
            setIsValidationPending(false);
          });
        })
        .catch((error) => {
          if (validationRequestSequenceRef.current !== requestSequence) {
            return;
          }
          console.error('XML validation worker request failed:', error);
          startTransition(() => {
            setValidationErrors(toWorkerValidationError(error, t));
            setIsValidationPending(false);
          });
        });
    }, getUrdfValidationDebounceMs(currentCode.length));

    return () => {
      window.clearTimeout(timeout);
      if (validationRequestSequenceRef.current === requestSequence) {
        validationRequestSequenceRef.current += 1;
      }
    };
  }, [currentCode, documentFlavor, documentMeta.supportsValidation, t]);

  useEffect(() => {
    if (
      !monacoInstance ||
      (documentFlavor !== 'urdf' &&
        documentFlavor !== 'xacro' &&
        documentFlavor !== 'sdf' &&
        documentFlavor !== 'mjcf')
    ) {
      return undefined;
    }

    const completionItemKind = monacoInstance.languages.CompletionItemKind;
    const completionKindMap = {
      tag: completionItemKind.Keyword,
      attribute: completionItemKind.Property,
      value: completionItemKind.EnumMember,
      snippet: completionItemKind.Snippet,
    } as const;

    const disposable = monacoInstance.languages.registerCompletionItemProvider('xml', {
      triggerCharacters: ['<', ' ', ':', '"'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideCompletionItems: async (model: any, position: any) => {
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        let entries: Awaited<ReturnType<typeof requestXmlCompletionsWithWorker>>;

        try {
          entries = await requestXmlCompletionsWithWorker(documentFlavor, textBeforeCursor);
        } catch (error) {
          console.error('XML completion worker request failed:', error);
          return { suggestions: [] };
        }

        if (entries.length === 0) {
          return { suggestions: [] };
        }

        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        return {
          suggestions: entries.map((entry) => {
            const resolvedEntry = resolveXmlCompletionEntryForContext(entry, textBeforeCursor);
            return {
              label: resolvedEntry.label,
              kind: completionKindMap[resolvedEntry.kind],
              insertText: resolvedEntry.insertText,
              insertTextRules: resolvedEntry.insertAsSnippet
                ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              documentation: resolvedEntry.documentation,
              range,
            };
          }),
        };
      },
    });

    return () => disposable.dispose();
  }, [documentFlavor, monacoInstance]);

  useEffect(() => {
    if (!monacoInstance || !editorRef.current) {
      return;
    }

    const model = editorRef.current.getModel();
    if (!model) {
      return;
    }

    monacoInstance.editor.setModelLanguage(model, documentMeta.language);
  }, [documentMeta.language, monacoInstance]);

  useEffect(() => {
    if (!monacoInstance || !editorRef.current) {
      return;
    }

    const model = editorRef.current.getModel();
    if (!model) {
      return;
    }

    const markers = documentMeta.supportsValidation
      ? validationErrors.map((error) => ({
          severity: monacoInstance.MarkerSeverity.Error,
          startLineNumber: error.line,
          startColumn: error.column || 1,
          endLineNumber: error.endLine || error.line,
          endColumn: error.endColumn || error.column || 1,
          message: error.message,
          source: 'XML Validator',
        }))
      : [];

    monacoInstance.editor.setModelMarkers(model, 'urdf-validator', markers);
  }, [documentMeta.supportsValidation, monacoInstance, validationErrors]);

  const handleApply = useCallback(
    async (trigger: 'manual' | 'auto' = 'manual') => {
      if (isReadOnly || !editorRef.current || isApplying) {
        return false;
      }

      const value = editorRef.current.getValue();
      if (documentMeta.supportsValidation) {
        void requestXmlValidationWithWorker(value, documentFlavor, t)
          .then((nextErrors) => {
            startTransition(() => {
              setValidationErrors(nextErrors);
            });
          })
          .catch((error) => {
            console.error('XML validation worker request failed during apply:', error);
            startTransition(() => {
              setValidationErrors(toWorkerValidationError(error, t));
            });
          });
      }

      setIsApplying(true);

      try {
        const didApply = await Promise.resolve(onCodeChange(value));
        if (didApply) {
          pendingAppliedCodeRef.current = value;
          pendingAppliedBaseCodeRef.current = code;
          setIsDirty(false);
          setAutoApplyBlockedCode(null);
          return true;
        }

        if (trigger === 'auto') {
          setAutoApplyBlockedCode(value);
        }
        return false;
      } catch (error) {
        if (trigger === 'auto') {
          setAutoApplyBlockedCode(value);
        }
        console.error('Failed to apply source code changes:', error);
        return false;
      } finally {
        setIsApplying(false);
      }
    },
    [
      code,
      documentFlavor,
      documentMeta.supportsValidation,
      isApplying,
      isReadOnly,
      onCodeChange,
      t,
    ],
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) {
        return;
      }

      setCurrentCode(value);
      setIsDirty(isReadOnly ? false : value !== code);
      if (autoApplyBlockedCode && autoApplyBlockedCode !== value) {
        setAutoApplyBlockedCode(null);
      }
    },
    [autoApplyBlockedCode, code, isReadOnly],
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(currentCode);
    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  }, [currentCode]);

  const handleDownload = useCallback(() => {
    downloadSourceCodeDocument({
      content: currentCode,
      fileName,
      documentFlavor,
      onDownload,
    });
  }, [currentCode, documentFlavor, fileName, onDownload]);

  useEffect(() => {
    if (isReadOnly) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (isDirty) {
          void handleApply('manual');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApply, isDirty, isReadOnly]);

  const handleAutoApply = useCallback(() => {
    void handleApply('auto');
  }, [handleApply]);

  useSourceCodeEditorAutoApply({
    enabled: autoApplyEnabled,
    currentCode,
    isDirty,
    isReadOnly,
    supportsValidation: documentMeta.supportsValidation,
    validationErrorCount: validationErrors.length,
    isValidationPending,
    isApplying,
    autoApplyBlockedCode,
    onAutoApply: handleAutoApply,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      editorRef.current?.layout();
    });
    return () => cancelAnimationFrame(id);
  }, [isMaximized, size.height, size.width]);

  useEffect(() => {
    if (!isEditorReady || !editorRef.current) {
      return undefined;
    }

    return attachFindWidgetTooltipSuppression(editorRef.current);
  }, [isEditorReady]);

  const handleEditorMount = useCallback((editor: unknown, monaco: MonacoInstance) => {
    const mountVersion = editorMountVersionRef.current + 1;
    editorMountVersionRef.current = mountVersion;
    editorRef.current = editor;

    if (editorMountVersionRef.current !== mountVersion || editorRef.current !== editor) {
      return;
    }

    try {
      setMonacoInstance(ensureSourceCodeEditorLanguages(monaco));
    } catch (error) {
      console.error('Failed to initialize Monaco editor languages:', error);
      setMonacoInstance(monaco);
    }

    setIsEditorReady(true);
    requestAnimationFrame(() => {
      if (editorMountVersionRef.current === mountVersion && editorRef.current) {
        editorRef.current.layout();
      }
    });
  }, []);

  return (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap">
          <div className="flex items-center gap-1.5 opacity-80">
            <Code className="h-4 w-4 text-system-blue" />
            <span className="truncate font-mono text-xs font-semibold tracking-tight text-text-primary">
              {fileName}
            </span>
          </div>
          <span className="shrink-0 text-[10px] text-text-tertiary">{contentSizeLabel}</span>
          {isReadOnly ? (
            <span className="shrink-0 rounded bg-element-hover px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
              {t.readOnly}
            </span>
          ) : null}
          {documentFlavor === 'equivalent-mjcf' ? (
            <span className="shrink-0 rounded bg-system-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-system-blue">
              {t.generated}
            </span>
          ) : null}
          {!isReadOnly && isDirty ? (
            <span className="shrink-0 rounded bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {t.modified}
            </span>
          ) : null}
        </div>
      }
      headerActions={
        <div className="flex items-center gap-1">
          {!isReadOnly ? (
            <Tooltip content={t.saveTooltip} side="bottom">
              <button
                onClick={() => {
                  void handleApply('manual');
                }}
                disabled={!isDirty || isApplying}
                className={`${HEADER_PRIMARY_ACTION_CLASS} ${
                  isDirty || isApplying
                    ? 'bg-system-blue-solid text-white hover:bg-system-blue-hover'
                    : 'cursor-not-allowed bg-transparent text-text-tertiary'
                }`}
                type="button"
              >
                {isApplying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                <span>{t.save}</span>
              </button>
            </Tooltip>
          ) : null}
          <Tooltip
            content={isEquivalentMjcfPreview ? t.previewDownloadTooltip : t.downloadTooltip}
            side="bottom"
          >
            <button
              onClick={handleDownload}
              className={`${HEADER_ACTION_CLASS} ${
                isEquivalentMjcfPreview ? 'cursor-not-allowed opacity-60' : ''
              }`}
              disabled={isEquivalentMjcfPreview}
              type="button"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t.download}</span>
            </button>
          </Tooltip>
          <Tooltip content={t.copyTooltip} side="bottom">
            <button
              onClick={handleCopy}
              className={`${HEADER_ACTION_CLASS} ${
                copied ? 'bg-element-hover text-system-blue' : ''
              }`}
              type="button"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? t.copied : t.copy}</span>
            </button>
          </Tooltip>
        </div>
      }
      className={`fixed z-[220] flex flex-col overflow-hidden rounded-lg border border-border-black bg-panel-bg text-text-primary shadow-2xl ${
        isMaximized ? 'inset-0 !h-full !w-full !transform-none rounded-none' : ''
      }`}
      headerClassName="flex h-10 items-center justify-between gap-3 border-b border-border-black bg-element-bg px-3 select-none"
      headerLeftClassName="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden"
      headerRightClassName="flex shrink-0 items-center gap-1"
      headerDraggableClassName="cursor-move"
      headerDraggingClassName="cursor-move"
      showMinimizeButton={false}
      maximizeTitle={t.maximize}
      restoreTitle={t.restore}
      closeTitle={t.close}
      onHeaderDoubleClick={toggleMaximize}
      controlButtonClassName="rounded p-1.5 text-text-tertiary transition-colors hover:bg-element-hover"
      closeButtonClassName="rounded p-1.5 text-text-tertiary transition-colors hover:bg-danger hover:text-white"
      rightResizeHandleClassName="absolute right-0 top-10 bottom-7 z-40 w-1.5 cursor-ew-resize transition-colors hover:bg-system-blue/30"
      bottomResizeHandleClassName="absolute bottom-0 left-0 right-0 z-40 h-1.5 cursor-ns-resize transition-colors hover:bg-system-blue/30"
      cornerResizeHandleClassName="absolute bottom-0 right-0 z-50 h-4 w-4 cursor-nwse-resize transition-colors hover:bg-system-blue/40"
      rightResizeDirection="e"
      bottomResizeDirection="s"
      cornerResizeDirection="se"
      controlIcons={{
        maximize: <Maximize className="h-3.5 w-3.5" />,
        restore: <Minimize className="h-3.5 w-3.5" />,
        close: <X className="h-4 w-4" />,
      }}
    >
      <div className="relative flex-1 overflow-hidden">
        {!isEditorReady ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel-bg">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
              <span>{t.loading}</span>
            </div>
          </div>
        ) : null}

        <Suspense fallback={null}>
          <MonacoEditor
            height="100%"
            defaultLanguage={documentMeta.language}
            defaultValue={code}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            onMount={handleEditorMount}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: codeEditorFontSize,
              fontFamily: resolveCodeEditorFontFamily(codeEditorFontFamily),
              fontLigatures: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: false,
              tabSize: 2,
              formatOnPaste: !isReadOnly && documentMeta.isXmlLike,
              formatOnType: !isReadOnly && documentMeta.isXmlLike,
              lineNumbersMinChars: 4,
              padding: { top: 12, bottom: 14 },
              renderLineHighlight: 'all',
              readOnly: isReadOnly,
              domReadOnly: isReadOnly,
              glyphMargin: documentMeta.supportsValidation,
              renderValidationDecorations: documentMeta.supportsValidation ? 'editable' : 'off',
            }}
          />
        </Suspense>
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between border-t border-border-black bg-element-bg px-3 text-[10px] select-none">
        <div className="flex items-center gap-3">
          {documentMeta.supportsValidation ? (
            validationErrors.length > 0 ? (
              <Tooltip content={t.jumpToProblem} side="bottom">
                <button
                  className="flex items-center gap-1.5 text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400"
                  onClick={() => {
                    const firstError = validationErrors[0];
                    if (!editorRef.current || !firstError) {
                      return;
                    }

                    editorRef.current.revealLineInCenter(firstError.line);
                    editorRef.current.setPosition({
                      lineNumber: firstError.line,
                      column: firstError.column || 1,
                    });
                    editorRef.current.focus();
                  }}
                  type="button"
                >
                  <AlertCircle className="h-3 w-3" />
                  <span>
                    {validationErrors.length} {t.problems}
                  </span>
                </button>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-1.5 text-success dark:text-success">
                <CheckCircle className="h-3 w-3" />
                <span>{t.noErrors}</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-1.5 text-text-secondary">
              {isReadOnly ? <Lock className="h-3 w-3" /> : <Info className="h-3 w-3" />}
              <span>{isReadOnly ? t.readOnlyView : t.noStructuralValidation}</span>
            </div>
          )}

          {isReadOnly ? (
            <>
              <div className="h-3 w-px bg-border-black" />
              <div className="flex items-center gap-1.5 text-text-secondary">
                <span>{t.readOnly}</span>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 font-mono text-text-tertiary">
          {!isReadOnly ? (
            <>
              <span>{t.saveShortcut}</span>
              <span aria-hidden="true">•</span>
            </>
          ) : null}
          <span>{documentMeta.label}</span>
          <span aria-hidden="true">•</span>
          <span>
            {isMaximized ? t.maximized : `${Math.round(size.width)} × ${Math.round(size.height)}`}
          </span>
        </div>
      </div>
    </DraggableWindow>
  );
};
