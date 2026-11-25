import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Camera,
  Upload,
  X,
  Sparkles,
  RefreshCw,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatINR } from '../utils/currency.ts';
import type { Product, VisualSearchResult } from '../types.ts';

interface CameraSearchModalProps {
  open: boolean;
  userId?: string;
  onClose: () => void;
  onApplyVisualResults: (result: VisualSearchResult) => void;
  onSelectProduct: (productId: string) => void;
}

function resizeImageToJpegDataUrl(source: HTMLVideoElement | HTMLImageElement, maxDim = 1024): string {
  const srcWidth =
    source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const srcHeight =
    source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;

  const scale = Math.min(1, maxDim / Math.max(srcWidth || maxDim, srcHeight || maxDim));
  const width = Math.max(1, Math.round((srcWidth || 640) * scale));
  const height = Math.max(1, Math.round((srcHeight || 480) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize image canvas.');
  }
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export function CameraSearchModal({
  open,
  userId,
  onClose,
  onApplyVisualResults,
  onSelectProduct,
}: CameraSearchModalProps) {
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'active' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<VisualSearchResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState('idle');
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('error');
      setCameraError(
        'Live camera access is unavailable in this browser context. You can upload or drag a photo instead.'
      );
      return;
    }

    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraState('active');
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access or switch to Upload Photo.'
          : 'No active camera feed detected. Switch to Upload Photo to search any image.';
      setCameraState('error');
      setCameraError(msg);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setPreviewDataUrl(null);
      setResult(null);
      setSearchError(null);
      return;
    }

    if (mode === 'camera' && !previewDataUrl) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [open, mode, previewDataUrl, startCamera, stopCamera]);

  async function runVisualSearch(imageDataUrl: string) {
    setSearching(true);
    setSearchError(null);
    setResult(null);
    try {
      const res = await fetch('/api/products/camera-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Visual product search failed.');
      }
      setResult({
        detectedItemSummary: data.detectedItemSummary,
        searchKeywords: data.searchKeywords || [],
        reasoning: data.reasoning || '',
        products: (data.products || []) as Product[],
      });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Unable to identify product.');
    } finally {
      setSearching(false);
    }
  }

  function handleCaptureSnapshot() {
    if (!videoRef.current || cameraState !== 'active') return;
    try {
      const dataUrl = resizeImageToJpegDataUrl(videoRef.current);
      stopCamera();
      setPreviewDataUrl(dataUrl);
      void runVisualSearch(dataUrl);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to capture camera frame.');
    }
  }

  function processImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setSearchError('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }
    setSearchError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        try {
          const resized = resizeImageToJpegDataUrl(img);
          setPreviewDataUrl(resized);
          void runVisualSearch(resized);
        } catch (err) {
          setSearchError(err instanceof Error ? err.message : 'Could not process image.');
        }
      };
      img.onerror = () => setSearchError('Unable to decode the selected image file.');
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
    e.target.value = '';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processImageFile(file);
    }
  }

  function handleRetake() {
    setPreviewDataUrl(null);
    setResult(null);
    setSearchError(null);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#24152F]/80 p-4">
      <div className="bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl w-full max-w-2xl shadow-card-lg overflow-hidden flex flex-col max-h-[90vh] animate-fade-in">
        {/* Header */}
        <div className="px-6 py-4 bg-[#24152F] text-[#FFFFFF] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#FF783D] text-[#24152F] flex items-center justify-center">
              <Camera className="w-4 h-4" strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="font-display text-xl font-extrabold text-[#FFFFFF]">
                Visual Camera Search
              </h2>
              <p className="text-xs text-[#BBA5D5]">
                Point your camera or upload a photo to find matching CartSync products
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#FFFFFF] hover:bg-[#352145] rounded-xl transition-colors cursor-pointer"
            aria-label="Close camera search"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 pt-4 pb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('camera');
              handleRetake();
            }}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-extrabold rounded-xl border-2 transition-colors cursor-pointer ${
              mode === 'camera'
                ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                : 'bg-[#FFF8F0] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
            }`}
          >
            <Camera className="w-3.5 h-3.5" strokeWidth={2} />
            <span>Live Camera</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('upload');
              handleRetake();
            }}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-extrabold rounded-xl border-2 transition-colors cursor-pointer ${
              mode === 'upload'
                ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                : 'bg-[#FFF8F0] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" strokeWidth={2} />
            <span>Upload Photo</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto space-y-5">
          {!previewDataUrl ? (
            mode === 'camera' ? (
              <div className="space-y-4">
                <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-[#24152F] border-2 border-[#24152F] flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${
                      cameraState === 'active' ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {cameraState === 'active' && (
                    <div className="pointer-events-none absolute inset-6 border-2 border-[#D9F36A] rounded-xl" />
                  )}

                  {cameraState === 'starting' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-[#FFF8F0] text-xs gap-2">
                      <Camera className="w-7 h-7 text-[#FF783D] animate-pulse" strokeWidth={2} />
                      <span>Starting camera viewfinder...</span>
                    </div>
                  )}

                  {cameraState === 'error' && (
                    <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center gap-3 bg-[#FFF8F0]">
                      <AlertCircle className="w-7 h-7 text-[#FF783D]" strokeWidth={2} />
                      <p className="text-sm font-bold text-[#24152F] max-w-md">{cameraError}</p>
                      <div className="flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          onClick={startCamera}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FFFFFF] border-2 border-[#24152F] hover:bg-[#BBA5D5] rounded-xl cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>Retry Camera</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setMode('upload')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>Switch to Upload Photo</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {cameraState === 'active' && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#5E5468]">
                      Center the item in frame and capture to search catalog matches.
                    </span>
                    <button
                      type="button"
                      onClick={handleCaptureSnapshot}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer whitespace-nowrap"
                    >
                      <Camera className="w-4 h-4" strokeWidth={2} />
                      <span>Capture & Search</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={`p-10 rounded-2xl border-2 border-dashed transition-colors text-center space-y-4 ${
                  dragActive
                    ? 'border-[#24152F] bg-[#F2EBFF]'
                    : 'border-[#BBA5D5] bg-[#FFF8F0] hover:border-[#FF783D]'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] mx-auto flex items-center justify-center">
                  <Upload className="w-5 h-5 text-[#FF783D]" strokeWidth={2} />
                </div>
                <div className="space-y-1">
                  <p className="font-display text-base font-extrabold text-[#24152F]">
                    Drop a product photo here, or browse from your device
                  </p>
                  <p className="text-xs text-[#5E5468]">
                    Supports JPEG, PNG, or WebP · Automatically identifies backpacks, mobiles, laptops, footwear, apparel & homeware
                  </p>
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>Choose Image</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-5">
              {/* Captured Preview + Status */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB]">
                <div className="sm:col-span-4 aspect-[4/3] rounded-xl overflow-hidden border-2 border-[#E6D8CB] bg-[#FFFFFF]">
                  <img
                    src={previewDataUrl}
                    alt="Captured product query"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="sm:col-span-8 space-y-2.5">
                  {searching ? (
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 text-xs font-extrabold text-[#24152F]">
                        <Sparkles className="w-4 h-4 text-[#FF783D] animate-pulse" strokeWidth={2} />
                        <span>Identifying product & matching CartSync catalog...</span>
                      </div>
                      <div className="h-3 w-3/4 rounded-full skeleton-cream" />
                      <div className="h-3 w-1/2 rounded-full skeleton-cream" />
                    </div>
                  ) : result ? (
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#24152F]">
                        <CheckCircle2 className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                        <span>Detected: {result.detectedItemSummary}</span>
                      </div>
                      <p className="text-xs text-[#5E5468] leading-relaxed">{result.reasoning}</p>
                      {result.searchKeywords.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {result.searchKeywords.map((kw) => (
                            <span
                              key={kw}
                              className="px-2.5 py-0.5 rounded-lg bg-[#BBA5D5] text-[#24152F] text-[11px] font-bold"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleRetake}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#24152F] bg-[#FFFFFF] border-2 border-[#24152F] hover:bg-[#BBA5D5] rounded-xl cursor-pointer transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{mode === 'camera' ? 'Retake Photo' : 'Try Another Image'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {searchError && (
                <div className="p-3.5 rounded-xl bg-[#FEE2E2] border-2 border-[#C83E4D] text-xs font-bold text-[#9E2A3B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2} />
                  <span>{searchError}</span>
                </div>
              )}

              {/* Matched Catalog Results */}
              {result && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-[#24152F]">
                      Catalog Visual Matches ({result.products.length})
                    </h3>
                    {result.products.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          onApplyVisualResults(result);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#C6E548] border-2 border-[#24152F] rounded-xl cursor-pointer transition-colors"
                      >
                        <span>Filter Search to Matches</span>
                        <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>

                  {result.products.length === 0 ? (
                    <div className="p-6 rounded-2xl border-2 border-[#E6D8CB] bg-[#FFF8F0] text-xs text-[#5E5468] text-center">
                      No direct match found in the current catalog for "{result.detectedItemSummary}". Try another angle or upload a clearer photo.
                    </div>
                  ) : (
                    <div className="divide-y-2 divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden bg-[#FFFFFF]">
                      {result.products.map((prod) => (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => {
                            onSelectProduct(prod.id);
                            onClose();
                          }}
                          className="w-full p-3.5 flex items-center justify-between gap-4 hover:bg-[#FFF8F0] transition-colors text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <ProductImage
                              src={prod.imageUrl}
                              alt={prod.name}
                              className="w-16 h-12 rounded-xl border-2 border-[#E6D8CB] shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-[#5E5468]">
                                {prod.category} · {prod.brand}
                              </div>
                              <div className="font-display text-sm font-extrabold text-[#24152F] truncate">
                                {prod.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-extrabold text-[#24152F] tabular-nums">
                              {formatINR(prod.price)}
                            </div>
                            <div className="text-[11px] text-[#FF783D] font-extrabold">
                              Inspect →
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
