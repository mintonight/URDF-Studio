import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

function formatErrorBoundaryMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * 顶层 React 错误边界：捕获任意子树（属性编辑器 / 源码编辑器 / AI 弹窗 / 结构树 …）
 * 的渲染期异常，避免整页白屏。现有的 WorkspaceCanvasErrorBoundary 只兜 3D 画布。
 *
 * fallback 故意自包含（内联样式、不依赖 store / i18n），因为崩溃子树里那些可能也挂了。
 */
export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // ponytail: 完整 stack + 组件栈落日志，生产崩溃可诊断而非被静默吞掉；
    // 后续可替换为上报通道（Sentry …）。
    console.error('[URDF Studio] 未捕获的渲染错误:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleDismiss = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    const { error, hasError } = this.state;
    if (!hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          background: '#0b0d10',
          color: '#e6e8eb',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          应用遇到错误 · Something went wrong
        </h1>
        <p style={{ margin: 0, opacity: 0.7, maxWidth: 480 }}>
          页面渲染中断。请重新加载；若问题持续，可将下方错误信息反馈给开发。
        </p>
        <pre
          style={{
            margin: 0,
            maxWidth: '90vw',
            maxHeight: '40vh',
            overflow: 'auto',
            padding: 12,
            background: '#15181c',
            borderRadius: 8,
            fontSize: 12,
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {formatErrorBoundaryMessage(error)}
        </pre>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: 6,
              background: '#3b82f6',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            重新加载 Reload
          </button>
          <button
            type="button"
            onClick={this.handleDismiss}
            style={{
              padding: '8px 16px',
              border: '1px solid #2a2f36',
              borderRadius: 6,
              background: 'transparent',
              color: '#e6e8eb',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            尝试恢复 Retry
          </button>
        </div>
      </div>
    );
  }
}
