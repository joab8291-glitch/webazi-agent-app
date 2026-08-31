import { NativeModule, requireNativeModule } from 'expo';
import { UssdExecutorModuleEvents } from './UssdExecutor.types';

declare class UssdExecutorModule extends NativeModule<UssdExecutorModuleEvents> {
  isAccessibilityEnabled(): boolean;
  openAccessibilitySettings(): void;
  dialUssd(
    ussdCode: string,
    subscriptionId: number,
    menuInputs: string[],
    // true (delivery dials): native side only reports success for a
    // confirmed Sambaza/Airtel transfer message — the financial-safety
    // classifier. false (balance/status queries, manual test dial):
    // native side reports success for any non-blank response, and the
    // caller does its own semantic validation.
    expectSambazaConfirmation: boolean,
    // Delay (ms, 1-5000) between each step of sending a queued menu
    // input during a multi-step (Normal/Advanced) dial. Requires a
    // native rebuild — older builds ignore a 5th argument being passed.
    keyInputDelayMs: number
  ): void;
  // Added for auto-close-dialogs / keep-screen-awake settings. Requires a
  // native rebuild — guard calls with `typeof X === 'function'` until the
  // app has been rebuilt with this module version.
  closeLingeringUssdDialog(): void;
  acquireDialWakeLock(): void;
  releaseDialWakeLock(): void;
}

export default requireNativeModule<UssdExecutorModule>('UssdExecutor');
