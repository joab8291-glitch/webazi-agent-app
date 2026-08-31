package expo.modules.smslistener

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log

/**
 * Runs on every device boot (and on the QUICKBOOT_POWERON some OEMs fire
 * instead/as well). Two jobs, mirroring the reference app's BootReceiver:
 *
 * 1. Always restart the SMS listener foreground service, so incoming
 *    M-Pesa payment SMS aren't silently missed just because the phone
 *    was rebooted and the agent hasn't reopened the app yet.
 *
 * 2. If the agent has turned on the "boot_flag" setting (persisted via
 *    BootPrefs / SmsListenerModule.setBootRelaunchEnabled), also relaunch
 *    the whole app itself ~5 seconds after boot — some agents want the
 *    UI up and visible again without having to tap the icon themselves.
 */
class BootReceiver : BroadcastReceiver() {

  companion object {
    private const val TAG = "WebaziBootReceiver"
    private const val RELAUNCH_REQUEST_CODE = 4274
    private const val RELAUNCH_DELAY_MS = 5000L
  }

  override fun onReceive(context: Context?, intent: Intent?) {
    if (context == null || intent == null) return

    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") {
      return
    }

    Log.i(TAG, "Boot completed — restarting SMS listener service")
    restartSmsService(context)

    if (BootPrefs.isBootRelaunchEnabled(context)) {
      Log.i(TAG, "boot_flag is on — scheduling app relaunch in ${RELAUNCH_DELAY_MS}ms")
      scheduleAppRelaunch(context)
    }
  }

  private fun restartSmsService(context: Context) {
    val serviceIntent = Intent(context, SmsForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(serviceIntent)
    } else {
      context.startService(serviceIntent)
    }
  }

  /**
   * Schedules the app's own launcher activity to open shortly after boot.
   * Tries an exact AlarmManager alarm first (matches the reference app);
   * on Android 12+ this needs the SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM
   * permission, which isn't guaranteed to be granted on every OEM, so we
   * fall back to a plain Handler delay (kept alive via goAsync) rather
   * than silently doing nothing.
   */
  private fun scheduleAppRelaunch(context: Context) {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return

    try {
      val activityIntent = Intent(launchIntent).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        putExtra("after_boot", true)
      }
      val pendingIntent = PendingIntent.getActivity(
        context,
        RELAUNCH_REQUEST_CODE,
        activityIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.setExactAndAllowWhileIdle(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        SystemClock.elapsedRealtime() + RELAUNCH_DELAY_MS,
        pendingIntent
      )
    } catch (e: SecurityException) {
      // Exact alarms not permitted on this OEM/Android version — fall back
      // to a plain delayed launch. goAsync() keeps the receiver process
      // alive long enough for the delay (well under the ~10s ANR budget).
      val pendingResult = goAsync()
      Handler(Looper.getMainLooper()).postDelayed({
        try {
          val activityIntent = Intent(launchIntent).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra("after_boot", true)
          }
          context.startActivity(activityIntent)
        } catch (inner: Exception) {
          Log.e(TAG, "Fallback app relaunch failed", inner)
        } finally {
          pendingResult.finish()
        }
      }, RELAUNCH_DELAY_MS)
    }
  }
}
