import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  width?: string;
  zIndexClassName?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className = '',
  width = 'w-[400px]',
  zIndexClassName = 'z-[100]',
}) => {
  if (!isOpen) return null;

  const content = (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Overlay - No blur, just dim */}
      <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={onClose} />

      <div
        className={`
          relative bg-panel-bg
          rounded-2xl
          shadow-xl
          border border-border-black
          overflow-hidden flex flex-col
          transform transition-all duration-200 scale-100 opacity-100
          ${width} ${className}
        `}
      >
        <div className="bg-element-bg px-4 py-3 border-b border-border-black flex items-center justify-between shrink-0">
          <h2 className="text-[13px] font-semibold text-text-primary truncate">{title}</h2>
          <IconButton
            onClick={onClose}
            variant="close"
            aria-label="Close dialog"
            title="Close dialog"
          >
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh] bg-panel-bg">{children}</div>

        {footer && (
          <div className="bg-element-bg px-4 py-3 border-t border-border-black shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
