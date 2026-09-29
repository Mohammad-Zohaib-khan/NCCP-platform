import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Generates an ISO-compliant standard scannable QR Code boolean matrix
 * Compatible with mobile phone cameras, Google Lens, and ZXing readers
 */
export function generateQrMatrix(text: string): boolean[][] {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
    const size = qr.modules.size
    const matrix: boolean[][] = []
    for (let r = 0; r < size; r++) {
      const row: boolean[] = []
      for (let c = 0; c < size; c++) {
        row.push(qr.modules.get(r, c) === 1)
      }
      matrix.push(row)
    }
    return matrix
  } catch {
    return [[true]]
  }
}

interface QrCodeProps {
  value: string
  size?: number
  fgColor?: string
  bgColor?: string
  includeLogo?: boolean
  className?: string
}

export const QrCodeSvg: React.FC<QrCodeProps> = ({
  value,
  size = 230,
  fgColor = '#005A43',
  bgColor = '#FFFFFF',
  includeLogo = true,
  className = '',
}) => {
  const [dataUrl, setDataUrl] = useState<string>('')

  // Generate high-resolution scannable DataURL for maximum mobile camera compatibility
  useEffect(() => {
    let active = true
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: {
        dark: fgColor,
        light: bgColor,
      },
      errorCorrectionLevel: 'H',
    })
      .then((url) => {
        if (active) setDataUrl(url)
      })
      .catch((err) => {
        console.warn('QR DataURL generation warning:', err)
      })
    return () => {
      active = false
    }
  }, [value, size, fgColor, bgColor])

  const matrix = React.useMemo(() => generateQrMatrix(value), [value])
  const matrixSize = matrix.length
  const cellSize = size / (matrixSize + 2) // padding on sides
  const padding = cellSize

  return (
    <div
      className={`inline-block rounded-2xl p-3 bg-white shadow-lg border border-emerald-900/15 relative overflow-hidden group ${className}`}
      style={{ width: size + 24, height: size + 24 }}
    >
      {dataUrl ? (
        <div className="relative w-full h-full flex items-center justify-center">
          <img
            src={dataUrl}
            alt="Scannable NCCP Attendance QR Code"
            className="w-full h-full object-contain rounded-lg"
          />
          {includeLogo && (
            <div
              className="absolute pointer-events-none flex items-center justify-center bg-white rounded-lg shadow-md border border-amber-400"
              style={{
                width: Math.max(36, Math.floor(size * 0.18)),
                height: Math.max(36, Math.floor(size * 0.18)),
              }}
            >
              <div className="w-6 h-6 rounded-full bg-emerald-900 flex items-center justify-center">
                <span className="text-[10px] font-bold text-amber-300">NC</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto max-w-full"
        >
          <rect width={size} height={size} fill={bgColor} rx={12} />
          {matrix.map((row, r) =>
            row.map((cell, c) => {
              if (!cell) return null
              // Reserved center for logo if requested
              if (
                includeLogo &&
                r >= Math.floor(matrixSize / 2) - 2 &&
                r <= Math.floor(matrixSize / 2) + 2 &&
                c >= Math.floor(matrixSize / 2) - 2 &&
                c <= Math.floor(matrixSize / 2) + 2
              ) {
                return null
              }
              return (
                <rect
                  key={`${r}-${c}`}
                  x={padding + c * cellSize}
                  y={padding + r * cellSize}
                  width={cellSize + 0.1}
                  height={cellSize + 0.1}
                  fill={fgColor}
                  rx={cellSize * 0.15}
                />
              )
            })
          )}
        </svg>
      )}
    </div>
  )
}
