import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Button, Callout } from '@openstuff-dev/ui-angular';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/**
 * The browser's own BarcodeDetector where it reads QR codes (Chrome on Android), otherwise the
 * zxing ponyfill, loaded on first use from this server (no CDN).
 */
async function createDetector(): Promise<Detector> {
  type Native = DetectorClass & { getSupportedFormats?: () => Promise<string[]> };
  const native = (globalThis as { BarcodeDetector?: Native }).BarcodeDetector;
  if (native && (await native.getSupportedFormats?.())?.includes('qr_code')) {
    return new native({ formats: ['qr_code'] });
  }
  const ponyfill = await import('barcode-detector/ponyfill');
  ponyfill.prepareZXingModule({ overrides: { locateFile: (file: string) => `/zxing/${file}` } });
  return new (ponyfill.BarcodeDetector as unknown as DetectorClass)({ formats: ['qr_code'] });
}

/**
 * Reads QR codes from the camera and emits each one once (the same code again only after 3
 * seconds). Local until the toolkit has one (finding d9aca63a against design).
 */
@Component({
  selector: 'app-scanner',
  imports: [Button, Callout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame" [class.on]="running()">
      <video #video playsinline muted aria-label="Camera"></video>
      @if (running()) {
        <span class="aim" aria-hidden="true"></span>
      } @else {
        <div class="off">
          <button
            os-button
            variant="primary"
            type="button"
            [loading]="starting()"
            (click)="start()"
          >
            Use the camera
          </button>
        </div>
      }
    </div>
    @if (running()) {
      <button os-button type="button" variant="ghost" size="sm" (click)="stop()">
        Turn the camera off
      </button>
    }
    @if (problem(); as problem) {
      <os-callout tone="warning">{{ problem }}</os-callout>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--os-space-2);
      justify-items: start;
    }

    .frame {
      position: relative;
      display: grid;
      place-items: center;
      inline-size: 100%;
      aspect-ratio: 4 / 3;
      max-block-size: 60dvh;
      overflow: hidden;
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-lg);
      background: var(--os-bg-surface-200);
    }

    video {
      position: absolute;
      inset: 0;
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
      visibility: hidden;
    }

    .on video {
      visibility: visible;
    }

    .aim {
      position: absolute;
      inset: 20%;
      border: 3px var(--os-border-style) var(--os-brand-default);
      border-radius: var(--os-radius-lg);
    }

    .off {
      position: relative;
    }
  `,
})
export class Scanner {
  /** A code the camera read. */
  readonly scanned = output<string>();
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  protected readonly running = signal(false);
  protected readonly starting = signal(false);
  protected readonly problem = signal<string | null>(null);
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = { value: '', at: 0 };

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
    });
  }

  protected async start(): Promise<void> {
    this.problem.set(null);
    // Missing outside secure contexts (plain http on another device), whatever the types say.
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (!media) {
      this.problem.set('This browser can’t use the camera here. Type the code instead.');
      return;
    }
    this.starting.set(true);
    try {
      const [stream, detector] = await Promise.all([
        media.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        createDetector(),
      ]);
      this.stream = stream;
      const video = this.video().nativeElement;
      video.srcObject = stream;
      await video.play();
      this.running.set(true);
      this.loop(detector);
    } catch (error) {
      const denied = (error as DOMException | undefined)?.name === 'NotAllowedError';
      this.problem.set(
        denied
          ? 'The camera is blocked. Allow it in the browser’s site settings, or type the code.'
          : 'The camera didn’t start. Type the code instead.',
      );
      this.stop();
    } finally {
      this.starting.set(false);
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.running.set(false);
  }

  private loop(detector: Detector): void {
    const tick = async () => {
      if (!this.stream) return;
      try {
        const hit = (await detector.detect(this.video().nativeElement)).at(0);
        const now = Date.now();
        if (hit && (hit.rawValue !== this.last.value || now - this.last.at > 3000)) {
          this.last = { value: hit.rawValue, at: now };
          if ('vibrate' in navigator) navigator.vibrate(60);
          this.scanned.emit(hit.rawValue);
        }
      } catch {
        // A frame that couldn't be read; try the next one.
      }
      this.timer = setTimeout(() => void tick(), 200);
    };
    void tick();
  }
}
