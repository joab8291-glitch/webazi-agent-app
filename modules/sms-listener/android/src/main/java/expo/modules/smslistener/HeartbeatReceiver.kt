package expo.modules.smslistener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Fired every ~5 minutes by the AlarmManager alarm scheduled in
 * SmsForegroundService.onStartCommand(). If the service is still alive,
 * calling startForegroundService() here is a harmless no-op that just
 * re-enters onStartCommand and re-arms the next heartbeat. If Android
 * silently killed the service in the meantime, this same call brings it
 * back — that's the "self-healing" part of the loop.
 */
class HeartbeatReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val serviceIntent = Intent(context, SmsForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(serviceIntent)
    } else {
      context.startService(serviceIntent)
    }
  }
}
