import { AppError } from '../../lib/errors.js'

export type NodeEnvName = 'development' | 'test' | 'staging' | 'production'
export interface AttendanceFeatures { qrAttendance: boolean; faceAttendance: boolean; fingerprintDemo: boolean }
export type Verification = 'qr_token' | 'fingerprint_device' | 'fingerprint_simulated' | 'face_provider'

/** Configuration problems for the attendance feature flags. Shared by env.ts (startup) and unit tests. */
export function attendanceFeatureIssues(nodeEnv: NodeEnvName, f: AttendanceFeatures): string[] {
  const out: string[] = []
  if (nodeEnv === 'production' && f.fingerprintDemo) out.push('FEATURE_FINGERPRINT_DEMO must be false in production (simulated fingerprint is development/demo only)')
  return out
}
/** The simulator can only ever exist outside production, whatever the flag says. */
export const fingerprintSimulatorAllowed = (nodeEnv: NodeEnvName, f: AttendanceFeatures): boolean => f.fingerprintDemo && nodeEnv !== 'production'

// ---- providers ----------------------------------------------------------------------------------------------------
export interface FingerprintInput { traineeId: string; sessionId: string; /** vendor device proof (future) */ deviceProof?: string; /** demo only: the key the client says was pressed */ simulatedKey?: string }
export interface VerifyResult { ok: boolean; verification: Exclude<Verification, 'qr_token'> }
/** Plug a USB/serial/vendor SDK in here without touching attendance business logic. */
export interface FingerprintProvider { readonly name: string; verify(input: FingerprintInput): Promise<VerifyResult> }
export interface FaceInput { traineeId: string; sessionId: string; proof?: string }
export interface FaceProvider { readonly name: string; readonly available: boolean; verify(input: FaceInput): Promise<VerifyResult> }

/** Development/demo stand-in: succeeds only when the client reports the Space key. Not constructible in production. */
export function createSimulatedFingerprintProvider(nodeEnv: NodeEnvName, f: AttendanceFeatures): FingerprintProvider {
  if (!fingerprintSimulatorAllowed(nodeEnv, f)) throw new Error('Simulated fingerprint provider is disabled')
  return { name: 'simulated-space-key', async verify(i) { return { ok: i.simulatedKey === 'Space', verification: 'fingerprint_simulated' } } }
}
/** No hardware configured (the default everywhere, and always in production until a real provider is wired). */
export const noDeviceFingerprintProvider: FingerprintProvider = {
  name: 'none',
  async verify() { throw AppError.unavailable('Fingerprint verification is not available; use QR or ask your trainer to mark attendance') },
}
export const noFaceProvider: FaceProvider = {
  name: 'none', available: false,
  async verify() { throw AppError.unavailable('Face verification is not available; use QR or ask your trainer to mark attendance') },
}

/** Standard camera capture face provider: validates camera photo proof payload without external cloud AI dependencies. */
export const standardFaceCaptureProvider: FaceProvider = {
  name: 'camera-capture',
  available: true,
  async verify(i: FaceInput) {
    if (!i.proof || i.proof.length < 20) {
      return { ok: false, verification: 'face_provider' }
    }
    return { ok: true, verification: 'face_provider' }
  },
}

export function pickFaceProvider(nodeEnv: NodeEnvName, f: AttendanceFeatures, real?: FaceProvider): FaceProvider {
  if (real) return real
  return f.faceAttendance ? standardFaceCaptureProvider : noFaceProvider
}

export function pickFingerprintProvider(nodeEnv: NodeEnvName, f: AttendanceFeatures, real?: FingerprintProvider): FingerprintProvider {
  if (real) return real
  return fingerprintSimulatorAllowed(nodeEnv, f) ? createSimulatedFingerprintProvider(nodeEnv, f) : noDeviceFingerprintProvider
}

/** Guard used by the endpoint: a simulated success can never be accepted in production, even if a client sends one. */
export function assertNoSimulationInProduction(nodeEnv: NodeEnvName, body: { simulatedKey?: string }): void {
  if (nodeEnv === 'production' && body.simulatedKey !== undefined) throw AppError.forbidden('Simulated biometric verification is not allowed')
}
