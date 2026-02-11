import { useState, useId } from 'react';
import { Modal } from './Modal';

interface ReasonModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string | undefined) => void;
  title: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
}

export function ReasonModal({
  open,
  onClose,
  onSubmit,
  title,
  placeholder = 'Reason (optional)',
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
}: ReasonModalProps) {
  const titleId = useId();
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    onSubmit(reason.trim() || undefined);
    setReason('');
    onClose();
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} titleId={titleId} className="max-w-md">
      <h2 id={titleId} className="text-lg font-bold mb-4">
        {title}
      </h2>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 resize-y"
      />
      <div className="flex gap-3">
        <button
          onClick={handleClose}
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}
