import { NativeModule, requireNativeModule } from 'expo';

import { SmsListenerModuleEvents, SimSlotInfo, InboxMessage } from './SmsListener.types';

declare class SmsListenerModule extends NativeModule<SmsListenerModuleEvents> {
  startListening(): void;
  stopListening(): void;
  getSimSlots(): SimSlotInfo[];
  // Foreground service + missed-messages inbox scan. Require a native
  // rebuild — guard calls with `typeof X === 'function'` until the app has
  // been rebuilt with this module version.
  startForegroundService(): void;
  stopForegroundService(): void;
  queryInboxSince(sinceMillis: number, subscriptionId: number): InboxMessage[];
  // Battery-optimization exemption, for background reliability. Also
  // require a native rebuild — guard with `typeof X === 'function'`.
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  // Sends an SMS from the given SIM (subscriptionId). Requires a native
  // rebuild — guard with `typeof X === 'function'`. Requires SEND_SMS
  // permission to already be granted (services/smsSender.ts requests it).
  sendSms(phoneNumber: string, message: string, subscriptionId: number): boolean;
  // Whether BootReceiver should also relaunch the whole app ~5s after a
  // device reboot, in addition to always restarting the foreground service.
  // Requires a native rebuild — guard with `typeof X === 'function'`.
  setBootRelaunchEnabled(enabled: boolean): void;
  isBootRelaunchEnabled(): boolean;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<SmsListenerModule>('SmsListener');
