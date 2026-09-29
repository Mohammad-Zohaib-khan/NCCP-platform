/**
 * useFaceCapture — Camera capture hook for face-recognition attendance.
 *
 * FACE RECOGNITION PIPELINE (no external ML / cloud AI required for current implementation):
 *
 *   1. openCamera()  — calls navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
 *                       and starts a live preview in the <video> element via `videoRef`.
 *
 *   2. captureFrame() — draws the current video frame onto an offscreen <canvas>,
 *                        calls canvas.toDataURL('image/jpeg', 0.85) to get a base-64 JPEG string.
 *                        This is the "proof" payload sent to the backend.
 *
 *   3. Backend route  — POST /attendance/sessions/:id/verify/face
 *                        standardFaceCaptureProvider in biometric.ts validates that proof.length >= 20,
 *                        then writes an attendance row (method='face', verification='face_provider').
 *
 *   TO ADD A REAL ML MODEL:
 *     Option A (client-side):  Before calling attendanceApi.verifyFace(), run the captured frame
 *                               through face-api.js to compute a descriptor, verify against an
 *                               enrolled descriptor stored per trainee, then pass the result as proof.
 *     Option B (server-side):  Replace standardFaceCaptureProvider in biometric.ts with a provider
 *                               that calls your cloud Vision / Rekognition / Azure Face endpoint.
 *                               No change to this hook is needed.
 */

import { useCallback, useRef, useState } from 'react'
import { attendanceApi } from '../lib/nccp-api'

export type FaceCaptureStatus =
  | 'idle'
  | 'requesting-permission'
  | 'live'            // camera stream active, showing preview
  | 'capturing'       // frame is being captured
  | 'submitting'      // sending to backend
  | 'success'
  | 'error'

export interface UseFaceCaptureReturn {
  status: FaceCaptureStatus
  errorMessage: string | null
  capturedFrame: string | null   // base-64 JPEG data URL (for preview)
  videoRef: React.RefObject<HTMLVideoElement>
  canvasRef: React.RefObject<HTMLCanvasElement>
  openCamera: () => Promise<void>
  closeCamera: () => void
  captureAndSubmit: (sessionId: string) => Promise<void>
  reset: () => void
}

export function useFaceCapture(): UseFaceCaptureReturn {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState<FaceCaptureStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null)

  /** Step 1 — Open device camera and attach stream to the video element */
  const openCamera = useCallback(async () => {
    setStatus('requesting-permission')
    setErrorMessage(null)
    setCapturedFrame(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',   // front-facing camera for face recognition
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      })
      streamRef.current = stream
      setStatus('live')
      // Attach stream to video element after next render tick
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => { /* autoplay may be blocked */ })
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        setErrorMessage('Camera permission denied. Please allow camera access in your browser and try again.')
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFoundError')) {
        setErrorMessage('No camera detected on this device.')
      } else {
        setErrorMessage(`Camera error: ${msg}`)
      }
      setStatus('error')
    }
  }, [])

  /** Stop all camera tracks and release the stream */
  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
    setCapturedFrame(null)
  }, [])

  /**
   * Step 2+3 — Capture a JPEG frame from the live video stream,
   *            then POST it to the backend as the face-recognition proof.
   *
   *  The base-64 JPEG is the "proof" that the FaceProvider receives.
   *  standardFaceCaptureProvider (biometric.ts) checks proof.length >= 20 and marks
   *  attendance with verification='face_provider'.
   *
   *  When a real ML provider is configured it will instead:
   *    • decode the base-64 -> ImageBitmap (server) or use it client-side
   *    • run face detection + embedding comparison against the trainee's enrolled descriptor
   *    • return ok=true only when cosine similarity >= threshold
   */
  const captureAndSubmit = useCallback(async (sessionId: string) => {
    if (!videoRef.current || !canvasRef.current) {
      setErrorMessage('Camera is not ready. Please open the camera first.')
      setStatus('error')
      return
    }
    setStatus('capturing')

    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setErrorMessage('Canvas context unavailable.')
      setStatus('error')
      return
    }

    // Mirror the frame horizontally so the preview matches what the user sees
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
    ctx.restore()

    // Convert to base-64 JPEG — this is the "proof" payload
    const proof = canvas.toDataURL('image/jpeg', 0.85)
    setCapturedFrame(proof)

    // Stop the stream immediately after capture (privacy-first)
    closeCamera()

    setStatus('submitting')
    try {
      // Send to backend — POST /attendance/sessions/:id/verify/face { proof }
      // Backend standardFaceCaptureProvider validates proof length and writes the attendance row.
      await attendanceApi.verifyFace(sessionId, proof)
      setStatus('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not available') || msg.includes('ATTENDANCE_CLOSED')) {
        setErrorMessage('Face attendance is not open for this session right now.')
      } else if (msg.includes('already recorded') || msg.includes('ATTENDANCE_DUPLICATE')) {
        setErrorMessage('Your attendance for this session is already recorded.')
      } else {
        setErrorMessage(`Check-in failed: ${msg}`)
      }
      setStatus('error')
    }
  }, [closeCamera])

  const reset = useCallback(() => {
    closeCamera()
    setStatus('idle')
    setErrorMessage(null)
    setCapturedFrame(null)
  }, [closeCamera])

  return { status, errorMessage, capturedFrame, videoRef, canvasRef, openCamera, closeCamera, captureAndSubmit, reset }
}
