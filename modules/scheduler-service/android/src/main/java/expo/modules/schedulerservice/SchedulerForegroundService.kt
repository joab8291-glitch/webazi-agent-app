package expo.modules.schedulerservice

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Keeps the app process alive so the existing JS scheduler loop
 * (services/scheduler.ts, setInterval every 30s) keeps running even
 * when the app is backgrounded or the Activity is destroyed.
 *
 * This does NOT reimplement scheduling logic natively — it exists
 * purely to stop Android from killing the process the JS scheduler
 * runs inside. Modeled directly on SmsForegroundService.kt, including
 * its self-healing AlarmManager heartbeat (see scheduleHeartbeat()).
 */
class SchedulerForegroundService : Service() {

  companion object {
    private const val CHANNEL_ID = "webazi_scheduler"
    private const val NOTIFICATION_ID = 4272 // distinct from SMS service's 4271
    private const val HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L
    private const val HEARTBEAT_REQUEST_CODE = 4275 // distinct from SMS service's 4273
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, buildNotification())
    scheduleHeartbeat()
    return START_STICKY
  }

  private fun heartbeatPendingIntent(): PendingIntent {
    val intent = Intent(this, SchedulerHeartbeatReceiver::class.java)
    return PendingIntent.getBroadcast(
      this,
      HEARTBEAT_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun scheduleHeartbeat() {
    val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = heartbeatPendingIntent()
    val triggerAt = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } else {
        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
    } catch (e: SecurityException) {
      alarmManager.setInexactRepeating(
        AlarmManager.RTC_WAKEUP,
        triggerAt,
        HEARTBEAT_INTERVAL_MS,
        pendingIntent
      )
    }
  }

  private fun cancelHeartbeat() {
    val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarmManager.cancel(heartbeatPendingIntent())
  }

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      val existing = manager?.getNotificationChannel(CHANNEL_ID)

      if (existing == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Scheduled Transactions",
          NotificationManager.IMPORTANCE_MIN
        ).apply {
          description = "Keeps scheduled USSD transactions running in the background"
          setShowBadge(false)
        }
        manager?.createNotificationChannel(channel)
      }
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Webazi")
      .setContentText("Watching for scheduled transactions")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .setPriority(Notification.PRIORITY_MIN)
      .build()
  }

  override fun onDestroy() {
    cancelHeartbeat()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  /**
   * Restart if the user swipes the app away from Recents — same
   * reasoning as SmsForegroundService: a scheduled transaction due a
   * few minutes later shouldn't silently die just because the task
   * was removed from Recents.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    val restartIntent = Intent(applicationContext, SchedulerForegroundService::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      applicationContext.startForegroundService(restartIntent)
    } else {
      applicationContext.startService(restartIntent)
    }

    super.onTaskRemoved(rootIntent)
  }
}
