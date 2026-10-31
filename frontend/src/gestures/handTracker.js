/**
 * Stage 1 of hand control: webcam frames -> 21 landmarks per hand.
 *
 * Uses MediaPipe Tasks Vision (the browser build). Two things matter for a
 * hackathon demo:
 *
 *  1. The WASM bundle must be served locally, not fetched from a CDN. Venue
 *     wifi will not download 10 MB reliably and the demo dies. Run
 *        npm i @mediapipe/tasks-vision
 *     and let Vite serve node_modules; passing `baseOptions.delegate: 'GPU'`
 *     falls back to CPU on machines without WebGL2.
 *
 *  2. Nothing here throws into React. Every failure becomes `onError(msg)` so
 *     the UI can show "camera unavailable" and the demo continues with the mouse.
 *
 * Privacy: frames never leave the machine. No recording, no upload.
 */

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export class HandTracker {
  /**
   * @param {object} opts
   * @param {(hands: number[][][]) => void} opts.onHands  21 × [x,y] per hand
   * @param {(msg: string) => void} opts.onError
   * @param {HTMLVideoElement} opts.video                 a <video> to draw from
   * @param {number} [opts.fps]                           detection rate (default 15)
   */
  constructor({ onHands, onError, video, fps = 15 }) {
    this.onHands = onHands
    this.onError = onError
    this.video = video
    this.intervalMs = 1000 / fps

    this.running = false
    this.stream = null
    this.landmarker = null
    this.timer = null
    this.lastVideoTime = -1
  }

  async start() {
    if (this.running) return
    this.running = true

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })
      this.video.srcObject = this.stream
      this.video.muted = true
      this.video.playsInline = true
      await this.video.play()
    } catch (err) {
      this.fail(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in the browser and try again.'
          : 'No camera found. The demo still works with the mouse.',
      )
      return
    }

    try {
      const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(
        // Vite copies this from node_modules; no CDN at demo time.
        '/mediapipe-wasm',
      )
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        numHands: 2,
        runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      })
    } catch (err) {
      this.fail(`Hand tracking could not start: ${err?.message || err}`)
      return
    }

    // Detection runs on its own timer at `fps`, not on requestAnimationFrame,
    // so the 3D scene keeps its frame budget.
    this.timer = setInterval(() => this.detect(), this.intervalMs)
  }

  detect() {
    if (!this.landmarker || !this.video || this.video.readyState < 2) return
    // skip if the video has not advanced — MediaPipe requires increasing timestamps
    if (this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime

    let result
    try {
      result = this.landmarker.detectForVideo(this.video, performance.now())
    } catch {
      return // a single dropped frame is not worth surfacing
    }

    const hands = (result?.landmarks || []).map((marks) => marks.map((m) => [m.x, m.y]))
    this.onHands(hands)
  }

  fail(message) {
    this.stop()
    this.onError?.(message)
  }

  stop() {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop())
    this.stream = null
    try {
      this.landmarker?.close?.()
    } catch {
      /* already closed */
    }
    this.landmarker = null
  }
}
