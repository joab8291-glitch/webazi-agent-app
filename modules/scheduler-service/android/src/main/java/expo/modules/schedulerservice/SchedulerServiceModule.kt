package expo.modules.schedulerservice

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SchedulerServiceModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("SchedulerService")

    // Starts the foreground service that keeps the process (and the
    // JS scheduler's setInterval loop) alive in the background.
    Function("startForegroundService") {
      val context = appContext.reactContext ?: return@Function null
      val intent = Intent(context, SchedulerForegroundService::class.java)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("stopForegroundService") {
      val context = appContext.reactContext ?: return@Function null
      context.stopService(Intent(context, SchedulerForegroundService::class.java))
    }

    // Reuse the same battery-optimization check already built for the
    // SMS listener — same underlying OS API, just exposed here too so
    // the scheduler's own settings section can prompt independently.
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function false
      val powerManager =
        context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
      powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false
    }

    Function("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function null
      val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = android.net.Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }
  }
}
