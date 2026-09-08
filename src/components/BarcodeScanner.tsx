import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { X, ScanLine, CameraOff } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let mounted = true;
    const reader = new BrowserMultiFormatReader();

    async function start() {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current ?? undefined,
          (result, _err, ctrl) => {
            if (!mounted) return;
            if (result) {
              const code = result.getText();
              ctrl.stop();
              onScan(code);
            }
          }
        );
        if (mounted) {
          controlsRef.current = controls;
          setScanning(true);
        }
      } catch {
        if (mounted) setError("Caméra inaccessible. Vérifiez les permissions.");
      }
    }

    start();

    return () => {
      mounted = false;
      try { controlsRef.current?.stop(); } catch { /* ignore */ }
      BrowserMultiFormatReader.releaseAllStreams();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- comportement existant : ne pas relancer le scan si onScan change de référence
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl overflow-hidden w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ScanLine size={18} style={{ color: '#6366f1' }} />
            <span className="font-semibold text-slate-800 text-sm">Scanner un code-barres</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="relative bg-black" style={{ minHeight: 260 }}>
          <video ref={videoRef} className="w-full" style={{ display: error ? 'none' : 'block' }} />

          {/* Cadre de scan */}
          {scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-52 h-32">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
                <div className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 animate-pulse" style={{ background: '#6366f1' }} />
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
              <CameraOff size={36} className="text-slate-400" />
              <p className="text-slate-300 text-sm text-center">{error}</p>
            </div>
          )}

          {!scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </div>

        <div className="px-4 py-3 text-center">
          <p className="text-xs text-slate-400">Pointez la caméra vers un code-barres ou QR code</p>
        </div>
      </div>
    </div>
  );
}
