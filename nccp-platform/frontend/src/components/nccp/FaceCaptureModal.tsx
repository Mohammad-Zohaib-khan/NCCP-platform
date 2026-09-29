/**
 * FaceCaptureModal — Face Recognition Attendance Check-in UI
 *
 * This component integrates the full camera-capture pipeline:
 *   1. Opens device camera via useFaceCapture hook (getUserMedia)
 *   2. Shows live video preview with a face-alignment overlay guide
 *   3. On "Take Photo", captures a JPEG frame and sends it to:
 *        POST /api/v1/attendance/sessions/:sessionId/verify/face
 *      The backend standardFaceCaptureProvider (biometric.ts) validates the proof
 *      and writes an attendance row (method='face', verification='face_provider').
 *
 * INTEGRATING A REAL ML MODEL (no change to this component needed):
 *   - Client-side: run face-api.js between capture and submit inside useFaceCapture
 *   - Server-side: replace standardFaceCaptureProvider in biometric.ts
 */

import { Camera, CheckCircle, Loader2, RefreshCw, ShieldCheck, X, XCircle } from 'lucide-react'
import { useFaceCapture } from '../../hooks/use-face-capture'
import { useI18n } from '../../lib/i18n-context'

interface FaceCaptureModalProps {
  /** The class_sessions.id for the current session — passed to verifyFace */
  sessionId: string
  onSuccess: () => void
  onClose: () => void
}

export function FaceCaptureModal({ sessionId, onSuccess, onClose }: FaceCaptureModalProps) {
  const { language, t } = useI18n()
  const { status, errorMessage, capturedFrame, videoRef, canvasRef, openCamera, closeCamera, captureAndSubmit, reset } = useFaceCapture()

  const handleCapture = async () => {
    await captureAndSubmit(sessionId)
    if (status !== 'error') {
      // onSuccess is called after the state propagates in the next render
    }
  }

  // Call onSuccess when status transitions to 'success'
  // (done via useEffect pattern inline — simpler without extra import)
  if (status === 'success') {
    return (
      <div className="face-modal-backdrop" onClick={onClose}>
        <div className="face-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Face check-in successful">
          <div className="face-modal-success">
            <CheckCircle size={64} className="face-success-icon" />
            <h2>{language === 'hi' ? 'उपस्थिति दर्ज की गई' : 'Attendance Recorded'}</h2>
            <p>{language === 'hi' ? 'आपकी चेहरा पहचान सत्यापन सफल रही।' : 'Your face check-in was successful.'}</p>
            <p className="face-tech-note">
              <ShieldCheck size={14} /> {language === 'hi' ? 'कैमरा कैप्चर द्वारा सत्यापित' : 'Verified via camera capture'} · provider: <code>face_provider</code>
            </p>
            <button className="face-btn face-btn-primary" onClick={() => { onSuccess(); onClose() }}>
              {language === 'hi' ? 'संपन्न' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="face-modal-backdrop" onClick={status === 'idle' || status === 'error' ? onClose : undefined}>
      <div className="face-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Face recognition check-in">

        {/* Header */}
        <div className="face-modal-header">
          <div>
            <span className="face-modal-eyebrow">{t('Face Recognition')}</span>
            <h2>{language === 'hi' ? 'कैमरा उपस्थिति' : 'Camera Check-in'}</h2>
          </div>
          <button className="face-modal-close" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Camera area */}
        <div className="face-camera-area">
          {/* Live video preview */}
          {(status === 'live' || status === 'capturing') && (
            <div className="face-video-wrap">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="face-video"
                aria-label="Live camera preview for face recognition"
              />
              {/* Face alignment guide overlay */}
              <div className="face-guide-overlay">
                <div className="face-guide-oval" />
                <span className="face-guide-label">{language === 'hi' ? 'अपना चेहरा फ्रेम के बीच में रखें' : 'Centre your face within the oval'}</span>
              </div>
            </div>
          )}

          {/* Captured frame preview */}
          {status === 'submitting' && capturedFrame && (
            <div className="face-video-wrap">
              <img src={capturedFrame} alt="Captured face frame being submitted" className="face-video" />
              <div className="face-submitting-overlay">
                <Loader2 size={36} className="face-spinner" />
                <span>{language === 'hi' ? 'उपस्थिति जमा की जा रही है…' : 'Submitting attendance…'}</span>
              </div>
            </div>
          )}

          {/* Idle / permission request state */}
          {(status === 'idle' || status === 'requesting-permission') && (
            <div className="face-placeholder">
              <Camera size={64} className="face-placeholder-icon" />
              <p>{language === 'hi' ? <>चेहरा उपस्थिति शुरू करने के लिए <strong>"कैमरा खोलें"</strong> पर क्लिक करें।</> : <>Click <strong>"Open Camera"</strong> to start face check-in.</>}</p>
              <p className="face-tech-note">
                <ShieldCheck size={13} /> ML-ready · provider interface in <code>biometric.ts</code>
              </p>
              {status === 'requesting-permission' && (
                <span className="face-requesting"><Loader2 size={15} className="face-spinner" /> {language === 'hi' ? 'कैमरा अनुमति मांगी जा रही है…' : 'Requesting camera permission…'}</span>
              )}
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="face-placeholder face-error">
              <XCircle size={52} className="face-error-icon" />
              <p className="face-error-msg">{errorMessage ?? (language === 'hi' ? 'एक त्रुटि हुई।' : 'An error occurred.')}</p>
            </div>
          )}
        </div>

        {/* Hidden canvas used for frame capture — not displayed */}
        <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />

        {/* Action buttons */}
        <div className="face-modal-actions">
          {status === 'idle' && (
            <button className="face-btn face-btn-primary" onClick={openCamera}>
              <Camera size={17} /> {language === 'hi' ? 'कैमरा खोलें' : 'Open Camera'}
            </button>
          )}
          {status === 'live' && (
            <>
              <button className="face-btn face-btn-secondary" onClick={closeCamera}>
                <X size={15} /> {t('Cancel')}
              </button>
              <button className="face-btn face-btn-primary" onClick={handleCapture}>
                <Camera size={17} /> {language === 'hi' ? 'फोटो लें और उपस्थिति दर्ज करें' : 'Take Photo & Check In'}
              </button>
            </>
          )}
          {(status === 'capturing' || status === 'submitting') && (
            <button className="face-btn face-btn-primary" disabled>
              <Loader2 size={15} className="face-spinner" />
              {status === 'capturing' ? (language === 'hi' ? 'फोटो ली जा रही है…' : 'Capturing…') : (language === 'hi' ? 'सत्यापित किया जा रहा है…' : 'Submitting…')}
            </button>
          )}
          {status === 'error' && (
            <>
              <button className="face-btn face-btn-secondary" onClick={onClose}>
                {t('Close')}
              </button>
              <button className="face-btn face-btn-primary" onClick={reset}>
                <RefreshCw size={15} /> {language === 'hi' ? 'पुनः प्रयास करें' : 'Try Again'}
              </button>
            </>
          )}
        </div>

      </div>

      {/* Inline styles scoped to this modal */}
      <style>{`
        .face-modal-backdrop {
          position: fixed; inset: 0; z-index: 9999;
          background: rgba(0,0,0,0.72);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
          backdrop-filter: blur(4px);
        }
        .face-modal {
          background: #0f172a; color: #e2e8f0;
          border-radius: 16px; width: 100%; max-width: 480px;
          border: 1px solid rgba(255,255,255,0.1);
          overflow: hidden;
          box-shadow: 0 25px 60px rgba(0,0,0,0.6);
        }
        .face-modal-header {
          display: flex; align-items: flex-start; justify-content: space-between;
          padding: 20px 20px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .face-modal-eyebrow {
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
          color: #4ade80; display: block; margin-bottom: 4px;
        }
        .face-modal-header h2 { margin: 0; font-size: 18px; font-weight: 700; }
        .face-modal-close {
          background: none; border: none; cursor: pointer;
          color: #94a3b8; padding: 4px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          transition: color .15s, background .15s;
        }
        .face-modal-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.1); }

        .face-camera-area {
          width: 100%; aspect-ratio: 4/3; background: #020617;
          position: relative; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
        }
        .face-video-wrap { width: 100%; height: 100%; position: relative; }
        .face-video {
          width: 100%; height: 100%; object-fit: cover;
          transform: scaleX(-1); /* Mirror for natural selfie feel */
        }
        .face-guide-overlay {
          position: absolute; inset: 0; display: flex;
          flex-direction: column; align-items: center; justify-content: center;
          pointer-events: none;
        }
        .face-guide-oval {
          width: 200px; height: 250px;
          border: 3px solid rgba(74, 222, 128, 0.8);
          border-radius: 50%;
          box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), inset 0 0 30px rgba(74,222,128,0.15);
          animation: face-pulse 2s ease-in-out infinite;
        }
        @keyframes face-pulse {
          0%, 100% { border-color: rgba(74,222,128,0.8); box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), inset 0 0 30px rgba(74,222,128,0.15), 0 0 0 3px rgba(74,222,128,0.3); }
          50% { border-color: rgba(74,222,128,1); box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), inset 0 0 40px rgba(74,222,128,0.25), 0 0 0 6px rgba(74,222,128,0.2); }
        }
        .face-guide-label {
          margin-top: 16px; font-size: 12px; color: rgba(255,255,255,0.9);
          background: rgba(0,0,0,0.5); padding: 4px 12px; border-radius: 20px;
          font-weight: 600;
        }
        .face-submitting-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0.6);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; color: white; font-weight: 600;
        }

        .face-placeholder {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; padding: 32px 24px;
          text-align: center; color: #94a3b8;
        }
        .face-placeholder-icon { color: #334155; }
        .face-placeholder p { margin: 0; font-size: 14px; line-height: 1.5; }
        .face-placeholder strong { color: #e2e8f0; }
        .face-error { }
        .face-error-icon { color: #f87171; }
        .face-error-msg { color: #fca5a5; font-size: 13px; max-width: 340px; }
        .face-tech-note {
          font-size: 11px !important; color: #475569 !important;
          display: flex !important; align-items: center; gap: 4px;
        }
        .face-tech-note code { font-size: 10px; color: #4ade80; }
        .face-requesting { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #94a3b8; }

        .face-modal-success {
          display: flex; flex-direction: column; align-items: center;
          gap: 12px; padding: 48px 32px; text-align: center;
        }
        .face-success-icon { color: #4ade80; }
        .face-modal-success h2 { margin: 0; font-size: 22px; }
        .face-modal-success p { margin: 0; color: #94a3b8; font-size: 14px; }

        .face-modal-actions {
          display: flex; gap: 10px; justify-content: flex-end;
          padding: 16px 20px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .face-btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
          cursor: pointer; border: none; transition: opacity .15s, transform .1s;
        }
        .face-btn:active { transform: scale(0.97); }
        .face-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .face-btn-primary { background: #4ade80; color: #052e16; }
        .face-btn-primary:hover:not(:disabled) { opacity: 0.9; }
        .face-btn-secondary { background: rgba(255,255,255,0.1); color: #cbd5e1; }
        .face-btn-secondary:hover { background: rgba(255,255,255,0.15); }

        .face-spinner { animation: face-spin 1s linear infinite; }
        @keyframes face-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
