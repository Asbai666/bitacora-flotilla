package mx.ajm.bitacora

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Calendar

object Alerts {
    const val CH_TRACK = "seguimiento"
    const val CH_ALERT = "alertas_v1"
    const val ID_TRACK = 1
    const val ID_START = 10
    const val ID_END = 11
    const val ID_STOP = 12
    const val ID_MOVE = 13

    private val VIBRATE = longArrayOf(0, 600, 250, 600, 250, 900)

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_TRACK, "Recorrido en curso", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Aviso fijo mientras se graba el recorrido del día"
        })
        nm.createNotificationChannel(NotificationChannel(CH_ALERT, "Alertas de bitácora", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Inicio y fin de jornada, vehículo detenido"
            enableVibration(true); vibrationPattern = VIBRATE
            enableLights(true); lightColor = 0xFFFFB020.toInt()
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        })
    }

    fun openAppIntent(ctx: Context, action: String? = null): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (action != null) putExtra("alert", action)
        }
        return PendingIntent.getActivity(ctx, action?.hashCode() ?: 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun alert(ctx: Context, id: Int, title: String, text: String, action: String) {
        channels(ctx)
        val n = NotificationCompat.Builder(ctx, CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFFFFB020.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(VIBRATE)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx, action))
            .setFullScreenIntent(openAppIntent(ctx, action), false)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (e: SecurityException) { }
        MainActivity.emit("alert", org.json.JSONObject().put("kind", action).put("title", title).put("text", text))
    }

    // ---------- recordatorios de inicio y fin ----------
    const val A_START = "mx.ajm.bitacora.START_CHECK"
    const val A_END = "mx.ajm.bitacora.END_CHECK"

    fun schedule(ctx: Context) {
        val prefs = Prefs(ctx)
        set(ctx, A_START, nextAt(prefs.startAt))
        set(ctx, A_END, nextAt(prefs.endAt))
    }

    // ---------- vigilancia del GPS: cada 15 min revisa que sigan llegando puntos ----------
    const val A_WATCH = "mx.ajm.bitacora.GPS_WATCH"
    fun scheduleWatch(ctx: Context) = set(ctx, A_WATCH, System.currentTimeMillis() + 15 * 60_000L)

    fun snooze(ctx: Context, action: String, minutes: Int) =
        set(ctx, action, System.currentTimeMillis() + minutes * 60_000L)

    private fun nextAt(minuteOfDay: Int): Long {
        val c = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, minuteOfDay / 60); set(Calendar.MINUTE, minuteOfDay % 60)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        if (c.timeInMillis <= System.currentTimeMillis() + 5_000) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    private fun set(ctx: Context, action: String, at: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(ctx, action.hashCode(), Intent(ctx, AlarmReceiver::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val p = Prefs(ctx)
        val workDay = p.isWorkDay() && !p.dayRest
        when (intent.action) {
            Alerts.A_START -> {
                val recording = p.tracking && p.trackDate == Prefs.today()
                if (workDay && !p.dayStarted && (p.armed || recording)) { p.reminderCount = 0; Alerts.schedule(ctx); return }
                if (workDay && !p.dayStarted) {
                    Alerts.alert(ctx, Alerts.ID_START, "Registra el inicio de jornada",
                        "Toma la foto del odómetro al salir para empezar a grabar el recorrido. Si hoy descansas, márcalo como día de descanso.", "start")
                    if (p.reminderCount < 4) { p.reminderCount = p.reminderCount + 1; Alerts.snooze(ctx, Alerts.A_START, 15); return }
                }
                p.reminderCount = 0
            }
            Alerts.A_WATCH -> {
                if (!p.tracking) return
                val f = TrackStore(ctx).pointsFile(p.trackDate)
                val age = System.currentTimeMillis() - (if (f.exists()) f.lastModified() else 0L)
                if (age > 12 * 60_000L) {
                    TrackingService.resume(ctx)
                    if (System.currentTimeMillis() - p.watchAlertAt > 30 * 60_000L) {
                        p.watchAlertAt = System.currentTimeMillis()
                        val hm = if (f.exists()) java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date(f.lastModified())) else "—"
                        Alerts.alert(ctx, Alerts.ID_MOVE, "El GPS dejó de grabar",
                            "No hay puntos del recorrido desde las $hm. Abre la app para reanudarlo y revisa que la batería esté sin restricción.", "resume")
                    }
                }
                Alerts.scheduleWatch(ctx); return
            }
            Alerts.A_END -> {
                if (workDay && p.dayStarted && !p.dayEnded) {
                    Alerts.alert(ctx, Alerts.ID_END, "Registra el fin de jornada",
                        "Toma la foto del odómetro al llegar para cerrar el día y guardar el recorrido.", "end")
                    if (p.reminderCount < 4) { p.reminderCount = p.reminderCount + 1; Alerts.snooze(ctx, Alerts.A_END, 15); return }
                }
                p.reminderCount = 0
            }
        }
        Alerts.schedule(ctx)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Alerts.schedule(ctx)
        val p = Prefs(ctx)
        if (p.tracking) TrackingService.resume(ctx)
        else if (p.armed) TrackingService.arm(ctx)
    }
}
