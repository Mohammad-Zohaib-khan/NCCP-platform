/**
 * Authenticated API client for NCCP Frontend.
 *
 * Features:
 * - In-memory access token storage (never localStorage/cookies for tokens)
 * - Single-flight automatic token refresh via HttpOnly refresh cookie (/api/v1/auth/refresh)
 * - Automatic X-Request-Id header generation
 * - Standardized error handling matching backend AppError format
 */

export interface ApiErrorPayload {
  code: string
  message: string
  requestId?: string
  details?: Record<string, unknown>
}

export class ApiError extends Error {
  public code: string
  public status: number
  public requestId?: string | undefined
  public details?: Record<string, unknown> | undefined

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || `API error (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code || 'UNKNOWN_ERROR'
    this.requestId = payload.requestId
    this.details = payload.details
  }
}

let accessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getApiBaseUrl(): string {
  const envUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined)?.trim()
  if (envUrl && envUrl !== '/api/v1') {
    return envUrl
  }
  // When running directly in browser on port 3000 without Nginx proxy (e.g. localhost:3000)
  if (typeof window !== 'undefined' && window.location.port === '3000') {
    return `${window.location.protocol}//${window.location.hostname}:8080/api/v1`
  }
  // Behind Nginx reverse proxy (port 80 / 443) or in cloud deployment
  return '/api/v1'
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'req-' + Math.random().toString(36).substring(2, 11)
}

/**
 * Single-flight refresh token lock.
 * If multiple requests receive a 401 simultaneously, only one refresh call is made.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const baseUrl = getApiBaseUrl()
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': generateRequestId(),
        },
        credentials: 'include', // sends HttpOnly refresh cookie
      })

      if (!res.ok) {
        setAccessToken(null)
        return null
      }

      const data = await res.json()
      if (data.accessToken) {
        setAccessToken(data.accessToken)
        return data.accessToken
      }
      setAccessToken(null)
      return null
    } catch {
      setAccessToken(null)
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const baseUrl = getApiBaseUrl()
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', generateRequestId())
  }

  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include', // ensure cookies (refresh session) are sent
  }

  let response: Response
  try {
    response = await fetch(url, fetchOptions)
  } catch (err) {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Network request failed',
    })
  }

  // Handle 401 Unauthorized — attempt token refresh once
  if (response.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      return apiRequest<T>(endpoint, options, true)
    }
  }

  if (response.status === 204) {
    return {} as T
  }

  const contentType = response.headers.get('content-type')
  const isJson = contentType && contentType.includes('application/json')
  const body = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    let message = response.statusText
    if (isJson && body && body.error) {
      return body.error
    } else if (typeof body === 'string') {
      if (body.trim().startsWith('<') || body.includes('<!DOCTYPE') || body.includes('<html')) {
        message = `Unable to communicate with API server at ${baseUrl} (HTTP ${response.status}). Ensure the backend service is running.`
      } else {
        message = body
      }
    }
    const errorPayload: ApiErrorPayload = {
      code: `HTTP_${response.status}`,
      message,
    }
    throw new ApiError(response.status, errorPayload)
  }

  return body as T
}
