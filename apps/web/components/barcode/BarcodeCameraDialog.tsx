'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'

type Detection = { rawValue?: string }
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Detection[]>
}
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

type Props = {
  title?: string
  onDetected: (value: string) => boolean
  onClose: () => void
}

/** Camera barcode reader for browsers that implement the native Barcode Detection API. */
export default function BarcodeCameraDialog({ title = 'Scan barcode', onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDetectedRef = useRef(onDetected)
  const [message, setMessage] = useState('Starting camera…')

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    let active = true
    let stream: MediaStream | null = null
    let frameId = 0
    let detector: BarcodeDetectorLike | null = null
    let detecting = false

    const stopTracks = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
    }

    const start = async () => {
      const detectorConstructor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage('Camera access is unavailable in this browser. Use a connected scanner or enter the barcode manually.')
        return
      }
      if (!detectorConstructor) {
        setMessage('This browser does not support camera barcode scanning. Use a connected scanner or enter the barcode manually.')
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        })
        if (!active) {
          stopTracks()
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        const requestedFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'qr_code']
        const supportedFormats = detectorConstructor.getSupportedFormats
          ? await detectorConstructor.getSupportedFormats()
          : requestedFormats
        const formats = requestedFormats.filter((format) => supportedFormats.includes(format))
        if (formats.length === 0) {
          setMessage('This camera does not support common product barcodes. Use a connected scanner or enter the barcode manually.')
          return
        }
        detector = new detectorConstructor({ formats })
        setMessage('Center a product barcode in the camera view.')

        const detectFrame = async () => {
          if (!active || !detector || !videoRef.current) return
          if (!detecting) {
            detecting = true
            try {
              const detections = await detector.detect(videoRef.current)
              const value = detections.find((result) => result.rawValue?.trim())?.rawValue?.trim()
              if (value) {
                const accepted = onDetectedRef.current(value)
                if (accepted) {
                  active = false
                  stopTracks()
                  return
                }
                setMessage(`No product is linked to ${value}. Try again or close the scanner.`)
              }
            } catch {
              setMessage('The barcode could not be read. Adjust the camera or try another scan.')
            } finally {
              detecting = false
            }
          }
          if (active) frameId = window.requestAnimationFrame(() => void detectFrame())
        }
        frameId = window.requestAnimationFrame(() => void detectFrame())
      } catch (error) {
        if (!active) return
        setMessage(error instanceof Error && error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access or use a connected scanner.'
          : 'The camera could not start. Check camera access or use a connected scanner.')
      }
    }

    void start()
    return () => {
      active = false
      stopTracks()
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(8, 15, 25, .72)', padding: 16 }}
    >
      <section style={{ width: 'min(620px, 100%)', overflow: 'hidden', borderRadius: 14, background: 'var(--color-surface, #fff)', color: 'var(--color-text-primary, #182230)', boxShadow: '0 24px 80px rgba(0,0,0,.28)' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--color-border, #d9e0e8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 750 }}><Camera size={19} />{title}</div>
          <button type="button" aria-label="Close scanner" onClick={onClose} className="btn-outline" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: 7 }}><X size={18} /></button>
        </header>
        <div style={{ padding: 16 }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: 'min(62vh, 520px)', objectFit: 'cover', borderRadius: 10, background: '#111827' }} />
          <p role="status" aria-live="polite" style={{ margin: '12px 2px 0', fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-muted, #596579)' }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" className="btn-outline" onClick={onClose} style={{ borderRadius: 8, padding: '8px 14px' }}>Cancel</button></div>
        </div>
      </section>
    </div>
  )
}
