/**
 * Audio service for playing notification chimes
 */
export class AudioService {
  private audioContext?: AudioContext;

  constructor() {
    // Initialize audio context when needed to comply with browser policies
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window !== "undefined") {
      // Standard Web Audio API
      if (window.AudioContext) {
        this.audioContext = new AudioContext();
      } else {
        // Fallback for Safari and older browsers that use the prefixed version
        const win = window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        };
        if (win.webkitAudioContext) {
          this.audioContext = new win.webkitAudioContext();
        }
      }
    }
    // If we're in an SSR context or AudioContext isn't available, don't initialize
  }

  private async ensureAudioEnabled() {
    if (!this.audioContext) return false;

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    return this.audioContext.state === "running";
  }

  async playChime() {
    if (!this.audioContext) return;

    try {
      const isReady = await this.ensureAudioEnabled();
      if (!isReady) return;

      // Create a pleasant tone (E5 note ~1661Hz)
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Pleasant tone parameters - sine wave, E5
      oscillator.frequency.setValueAtTime(1661, this.audioContext.currentTime);
      oscillator.type = "sine";

      // Envelope - quick attack, smooth decay
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(
        0.3,
        this.audioContext.currentTime + 0.01,
      ); // Quick rise
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        this.audioContext.currentTime + 0.25,
      ); // Smooth decay

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.25);
    } catch (error) {
      console.error("Audio chime error:", error);
    }
  }

  async playErrorChime() {
    if (!this.audioContext) return;

    try {
      const isReady = await this.ensureAudioEnabled();
      if (!isReady) return;

      // Create an error sound (lower, shorter, more urgent)
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Lower frequency for error
      oscillator.frequency.setValueAtTime(880, this.audioContext.currentTime); // A5
      oscillator.type = "square"; // More harsh sound for errors

      // Short, abrupt sound
      gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        this.audioContext.currentTime + 0.1,
      );

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.1);
    } catch (error) {
      console.error("Audio error chime error:", error);
    }
  }
}

// Export singleton instance
export const audioService = new AudioService();
