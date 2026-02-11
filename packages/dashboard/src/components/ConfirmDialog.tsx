import { useId, useState } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: ConfirmDialogProps) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const btnClass =
    variant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : 'bg-blue-600 text-white hover:bg-blue-700';

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} titleId={titleId} className="max-w-sm">
      <h2 id={titleId} className="text-lg font-bold mb-2">
        {title}
      </h2>
      <p className="text-gray-600 text-sm mb-6">{message}</p>
      <div className="flex gap-3">
        <button
          onClick={onClose}
          disabled={confirming}
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className={`flex-1 px-4 py-2.5 rounded-lg transition-colors ${btnClass} disabled:opacity-50`}
        >
          {confirming ? 'Processing…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
