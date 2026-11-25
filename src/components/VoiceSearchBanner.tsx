import { AlertCircle, Mic, Square, X } from 'lucide-react';
import type { VoiceSearchStatus } from '../hooks/useVoiceSearch.ts';

interface VoiceSearchBannerProps {
  status: VoiceSearchStatus;
  transcript: string;
  errorMessage: string | null;
  onStopListening: () => void;
  onDismissError: () => void;
  variant?: 'dark' | 'light';
}

export function VoiceSearchBanner({
  status,
  transcript,
  errorMessage,
  onStopListening,
  onDismissError,
  variant = 'light',
}: VoiceSearchBannerProps) {
  const isListening = status === 'listening' || status === 'requesting';

  if (!isListening && !errorMessage) {
    return null;
  }

  if (isListening) {
    const isDark = variant === 'dark';
    return (
      <div
        role="status"
        aria-live="polite"
        className={`mt-2.5 px-3.5 py-2.5 rounded-xl border-2 flex flex-wrap items-center justify-between gap-3 ${
          isDark
            ? 'bg-[#352145] border-[#FF783D] text-[#FFFFFF]'
            : 'bg-[#FFF8F0] border-[#FF783D] text-[#24152F]'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="w-8 h-8 rounded-lg bg-[#FF783D] text-[#24152F] flex items-center justify-center shrink-0">
            <Mic className="w-4 h-4 animate-pulse" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-extrabold flex items-center gap-2">
              <span>
                {status === 'requesting'
                  ? 'Requesting microphone permission...'
                  : 'Listening... Speak your product search'}
              </span>
              <span className="inline-flex items-end gap-0.5 h-3" aria-hidden="true">
                <span className="w-1 h-2 bg-[#FF783D] rounded-full animate-bounce" />
                <span className="w-1 h-3 bg-[#D9F36A] rounded-full animate-bounce [animation-delay:120ms]" />
                <span className="w-1 h-1.5 bg-[#FF783D] rounded-full animate-bounce [animation-delay:240ms]" />
              </span>
            </div>
            <div className={`text-[11px] truncate ${isDark ? 'text-[#BBA5D5]' : 'text-[#5E5468]'}`}>
              {transcript
                ? `Heard: "${transcript}" — you can edit text anytime`
                : 'Try "Show me wireless earphones" or "products under 500 rupees"'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onStopListening}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C83E4D] hover:bg-[#9E2A3B] text-[#FFFFFF] text-xs font-extrabold cursor-pointer transition-colors shrink-0 whitespace-nowrap"
        >
          <Square className="w-3 h-3 fill-current" strokeWidth={2} />
          <span>Stop Listening</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mt-2.5 px-3.5 py-2.5 rounded-xl bg-[#FEE2E2] border-2 border-[#C83E4D] text-[#9E2A3B] flex items-center justify-between gap-3 text-xs font-bold"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 shrink-0 text-[#C83E4D]" strokeWidth={2.2} />
        <span>{errorMessage}</span>
      </div>
      <button
        type="button"
        onClick={onDismissError}
        aria-label="Dismiss voice search message"
        className="p-1 rounded-md hover:bg-[#fecaca] text-[#9E2A3B] cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2.2} />
      </button>
    </div>
  );
}
