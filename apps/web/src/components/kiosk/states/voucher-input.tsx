import { useState, useEffect, useCallback } from 'react';
import { Ticket, X, Check, Loader2, ChevronLeft, Delete } from 'lucide-react';
import type { useTranslation } from '@/lib/i18n/use-translation';

// Match the actual translator signature so passing `t` from useTranslation
// type-checks (DictionaryKey is a literal-string union; widening to `string`
// fails contravariance under strictFunctionTypes).
type T = ReturnType<typeof useTranslation>['t'];

interface VoucherInputStateProps {
  sessionId?: string;
  onBack: () => void;
  onRedeemed: (sessionId: string) => void;
  t: T;
  boothId?: string;
}

const NUMPAD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const VALID_CHARS = new Set(NUMPAD_ROWS.flat());

export function VoucherInputState({
  sessionId,
  onBack,
  onRedeemed,
  t,
  boothId,
}: VoucherInputStateProps) {
  const [code, setCode] = useState<string>('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const trimmedCode = code.trim();
  // Session is created in background by the parent shell after the user
  // picks a method. While we wait for PAYMENT_QR to arrive we keep the
  // submit disabled and surface a "preparing" hint so the guest knows the
  // app isn't frozen.
  const sessionReady = !!sessionId;
  const canSubmit = trimmedCode.length > 0 && !validating && !success && sessionReady;

  const handleSubmit = useCallback(async () => {
    if (validating || success) return;
    if (!trimmedCode) {
      setError(t('kiosk.voucher.empty'));
      return;
    }
    if (!sessionId) {
      // Quietly bail — the preparing banner already tells the guest to wait
      // and showing a red error here would just be visual noise. Defensive
      // path: only hit when keyboard Enter fires before sessionId arrives.
      return;
    }

    setValidating(true);
    setError(null);

    try {
      const res = await fetch('/api/voucher/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: trimmedCode.toUpperCase(),
          sessionId,
          boothId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || t('kiosk.voucher.invalid'));
        setValidating(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        onRedeemed(sessionId);
      }, 1200);
    } catch (err) {
      setError(t('kiosk.voucher.error'));
      setValidating(false);
    }
  }, [trimmedCode, sessionId, boothId, onRedeemed, t, validating, success]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (validating || success) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setCode((prev) => prev.slice(0, -1));
        setError(null);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCode('');
        setError(null);
        return;
      }
      const upper = e.key.toUpperCase();
      if (VALID_CHARS.has(upper)) {
        setCode((prev) => (prev.length < 12 ? prev + upper : prev));
        setError(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [validating, success, handleSubmit]);

  const handleInput = (char: string) => {
    if (validating || success) return;
    setCode((prev) => (prev.length < 12 ? prev + char : prev));
    setError(null);
  };

  const handleBackspace = () => {
    if (validating || success) return;
    setCode((prev) => prev.slice(0, -1));
    setError(null);
  };

  const handleClear = () => {
    if (validating || success) return;
    setCode('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-brand-cream flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 shrink-0">
        <button
          type="button"
          onClick={onBack}
          disabled={validating || success}
          className="px-5 py-2.5 bg-brand-green-dark text-white rounded-full font-semibold flex items-center gap-2 disabled:opacity-50 hover:bg-brand-green-dark/90 transition"
        >
          <ChevronLeft className="w-5 h-5" />
          {t('kiosk.voucher.back')}
        </button>
        <h1 className="text-2xl font-bold text-brand-green-dark">
          {t('kiosk.voucher.header')}
        </h1>
        <div className="w-28" />
      </header>

      {/* Main 2-column content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 px-8 pb-8">
        {/* Left column: Info + Code Display + Submit */}
        <div className="flex-1 flex flex-col items-center justify-center max-w-[600px] mx-auto lg:mx-0 lg:px-8 w-full">
          <Ticket className="w-20 h-20 text-brand-green-dark stroke-[1.5] mb-4" />

          <h2 className="text-2xl lg:text-3xl font-bold text-brand-green-dark mb-2 text-center">
            {t('kiosk.voucher.title')}
          </h2>
          <p className="text-gray-600 text-center mb-6 text-sm lg:text-base">
            {t('kiosk.voucher.subtitle')}
          </p>

          {/* Code Display */}
          <div className="bg-white rounded-2xl p-6 shadow-lg w-full mb-6 border-2 border-dashed border-brand-green-dark/30">
            <div className="font-mono text-3xl lg:text-4xl tracking-[0.3em] text-center text-brand-green-dark min-h-[60px] flex items-center justify-center font-bold">
              {code || (
                <span className="text-gray-300 text-2xl tracking-normal font-normal">
                  {t('kiosk.voucher.placeholder')}
                </span>
              )}
            </div>
          </div>

          {/* Status message — reserved height so the submit button below
              never jumps when a banner appears/disappears. Priority order:
              error > success > preparing (preparing is informational and
              should not stomp on a real error message). */}
          <div className="min-h-[56px] mb-4 flex items-center justify-center w-full">
            {error ? (
              <div className="bg-red-50 border-2 border-red-200 text-red-700 px-5 py-3 rounded-xl flex items-center gap-2">
                <X className="w-5 h-5 shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            ) : success ? (
              <div className="bg-green-50 border-2 border-green-200 text-green-700 px-5 py-3 rounded-xl flex items-center gap-2">
                <Check className="w-5 h-5 shrink-0" />
                <span className="text-sm font-medium">{t('kiosk.voucher.success')}</span>
              </div>
            ) : !sessionReady ? (
              <div className="bg-blue-50 border-2 border-blue-200 text-blue-700 px-5 py-3 rounded-xl flex items-center gap-2">
                <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                <span className="text-sm font-medium">{t('kiosk.voucher.preparing')}</span>
              </div>
            ) : null}
          </div>

          {/* Submit Button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-brand-green-dark hover:bg-brand-green-dark/90 text-brand-yellow font-extrabold text-xl lg:text-2xl px-12 py-4 lg:px-16 lg:py-5 rounded-full shadow-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 w-full"
          >
            {validating && <Loader2 className="animate-spin w-6 h-6" />}
            {validating ? t('kiosk.voucher.validating') : t('kiosk.voucher.submit')}
          </button>
        </div>

        {/* Right column: QWERTY Numpad */}
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-gray-900 rounded-3xl p-4 lg:p-6 shadow-2xl w-full max-w-[800px]">
            {NUMPAD_ROWS.map((row, rowIdx) => (
              <div
                key={rowIdx}
                className="flex justify-center gap-1.5 lg:gap-2 mb-1.5 lg:mb-2"
              >
                {row.map((char) => (
                  <button
                    key={char}
                    type="button"
                    onClick={() => handleInput(char)}
                    disabled={validating || success}
                    className="
                      flex-1 max-w-[64px] aspect-square rounded-lg
                      bg-white text-brand-green-dark
                      font-bold text-xl lg:text-2xl
                      shadow-md hover:bg-brand-yellow
                      transition-all duration-150 active:scale-95
                      disabled:opacity-50 disabled:cursor-not-allowed
                    "
                  >
                    {char}
                  </button>
                ))}
              </div>
            ))}

            {/* Action row: Backspace + Clear */}
            <div className="flex justify-center gap-2 mt-3">
              <button
                type="button"
                onClick={handleBackspace}
                disabled={validating || success || !code}
                className="
                  flex-1 max-w-[160px] py-3 lg:py-4 rounded-lg
                  bg-red-100 hover:bg-red-200 text-red-700
                  font-semibold text-sm lg:text-base
                  shadow-md transition-all active:scale-95
                  disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2
                "
              >
                <Delete className="w-5 h-5" />
                {t('kiosk.voucher.backspace')}
              </button>

              <button
                type="button"
                onClick={handleClear}
                disabled={validating || success || !code}
                className="
                  flex-1 max-w-[160px] py-3 lg:py-4 rounded-lg
                  bg-gray-200 hover:bg-gray-300 text-gray-700
                  font-semibold text-sm lg:text-base
                  shadow-md transition-all active:scale-95
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {t('kiosk.voucher.clear')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}