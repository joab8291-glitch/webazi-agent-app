import { NativeModule, requireNativeModule } from 'expo';

declare class SchedulerServiceModule extends NativeModule<{}> {
  // Starts the foreground service that keeps the app process (and the
  // JS scheduler's setInterval loop in services/scheduler.ts) alive
  // while the app is backgrounded. Requires a native rebuild — guard
  // calls with `typeof X === 'function'` until the app has been
  // rebuilt with this module included.
  startForegroundService(): void;
  stopForegroundService(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
}

export default requireNativeModule<SchedulerServiceModule>('SchedulerService');
