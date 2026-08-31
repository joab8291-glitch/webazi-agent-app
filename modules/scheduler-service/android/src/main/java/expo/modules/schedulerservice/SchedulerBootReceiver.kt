package expo.modules.schedulerservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts the scheduler foreground service on every device boot, so a
 * transaction scheduled for a few minutes later doesn't silently miss its
 * window just because the phone was rebooted.
 *
 * The "relaunch the whole app" behavior (boot_flag) lives only in
 * expo.modules.smslistener.BootReceiver, to avoid both modules' boot
 * receivers racing to open the app twice.
 */
class SchedulerBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context?, intent: Intent?) {
    if (context == null || intent == null) return

    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") {
      return
    }

    val serviceIntent = Intent(context, SchedulerForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(serviceIntent)
    } else {
      context.startService(serviceIntent)
    }
  }
}
