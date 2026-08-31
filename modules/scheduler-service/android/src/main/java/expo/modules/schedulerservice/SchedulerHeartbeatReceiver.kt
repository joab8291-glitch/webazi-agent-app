package expo.modules.schedulerservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Mirrors expo.modules.smslistener.HeartbeatReceiver: fired every ~5
 * minutes by the alarm scheduled in SchedulerForegroundService, and
 * restarts that service if Android has silently killed it since the
 * last beat.
 */
class SchedulerHeartbeatReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val serviceIntent = Intent(context, SchedulerForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(serviceIntent)
    } else {
      context.startService(serviceIntent)
    }
  }
}
