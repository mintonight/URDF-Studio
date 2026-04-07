import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface WorkspaceCanvasErrorNoticeProps {
  title: string;
  message: string;
  detail?: string;
}

export function WorkspaceCanvasErrorNotice({
  title,
  message,
  detail,
}: WorkspaceCanvasErrorNoticeProps): React.ReactNode {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-panel-bg/92 p-6 backdrop-blur-sm">
      <div
        role="alert"
        className="w-full max-w-lg rounded-2xl border border-border-black bg-panel-bg px-6 py-5 shadow-xl"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-system-blue/20 bg-system-blue/10 text-system-blue">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{message}</p>
            {detail ? (
              <p className="mt-3 rounded-lg border border-border-black bg-element-bg px-3 py-2 text-xs leading-5 text-text-tertiary">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
