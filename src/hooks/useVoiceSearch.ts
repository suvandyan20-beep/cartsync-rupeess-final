import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export type VoiceSearchStatus = 'idle' | 'requesting' | 'listening' | 'error';

interface UseVoiceSearchOptions {
  onTranscriptUpdate?: (text: string) => void;
  onSearchComplete?: (finalText: string) => void;
  lang?: string;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function mapSpeechErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Please allow microphone access in your browser site settings and click the microphone again.';
    case 'audio-capture':
      return 'No working microphone was detected. Please connect or enable a microphone and try again.';
    case 'no-speech':
      return 'No speech was detected. Click the microphone and try saying something like "wireless earphones" or "products under 500 rupees".';
    case 'network':
      return 'Speech recognition could not reach the browser speech service. Please check your connection or type your search instead.';
    case 'aborted':
      return '';
    default:
      return 'Voice recognition encountered an issue. Please try again or type your search query.';
  }
}

export function useVoiceSearch({
  onTranscriptUpdate,
  onSearchComplete,
  lang = 'en-IN',
}: UseVoiceSearchOptions) {
  const [isSupported] = useState<boolean>(() => Boolean(getSpeechRecognitionCtor()));
  const [status, setStatus] = useState<VoiceSearchStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const latestTranscriptRef = useRef('');
  const cancelledRef = useRef(false);
  const hadFatalErrorRef = useRef(false);
  const onUpdateRef = useRef(onTranscriptUpdate);
  const onCompleteRef = useRef(onSearchComplete);

  useEffect(() => {
    onUpdateRef.current = onTranscriptUpdate;
  }, [onTranscriptUpdate]);

  useEffect(() => {
    onCompleteRef.current = onSearchComplete;
  }, [onSearchComplete]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) {
      setStatus('idle');
      return;
    }
    try {
      rec.stop();
    } catch {
      setStatus('idle');
    }
  }, []);

  const cancelListening = useCallback(() => {
    cancelledRef.current = true;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.abort();
      } catch {
        // ignore abort failures
      }
    }
    setStatus('idle');
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setStatus((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setErrorMessage(
        'Voice search is not supported in this browser. Try Google Chrome, Microsoft Edge, or Safari, or type your product search.'
      );
      setStatus('error');
      return;
    }

    if (recognitionRef.current) {
      stopListening();
      return;
    }

    setErrorMessage(null);
    setTranscript('');
    latestTranscriptRef.current = '';
    cancelledRef.current = false;
    hadFatalErrorRef.current = false;
    setStatus('requesting');

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStatus('listening');
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let combined = '';
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i]?.[0]?.transcript || '';
      }
      const cleaned = combined.replace(/\s+/g, ' ').replace(/[.?!]+$/, '').trim();
      latestTranscriptRef.current = cleaned;
      setTranscript(cleaned);
      onUpdateRef.current?.(cleaned);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event.error === 'aborted') {
        return;
      }
      hadFatalErrorRef.current = true;
      const friendly = mapSpeechErrorMessage(event.error);
      if (friendly) {
        setErrorMessage(friendly);
        setStatus('error');
      } else {
        setStatus('idle');
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      const finalText = latestTranscriptRef.current.trim();
      if (!hadFatalErrorRef.current) {
        setStatus('idle');
      }
      if (!cancelledRef.current && finalText) {
        onCompleteRef.current?.(finalText);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      const message =
        err instanceof Error && err.message
          ? `Could not start voice search: ${err.message}`
          : 'Could not access microphone. Please check browser permissions and try again.';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [lang, stopListening]);

  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore cleanup abort
        }
      }
    };
  }, []);

  return {
    isSupported,
    status,
    isListening: status === 'listening' || status === 'requesting',
    transcript,
    errorMessage,
    startListening,
    stopListening,
    cancelListening,
    clearError,
  };
}
