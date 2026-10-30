package mx.ajm.bitacora

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Ajustes de la app y estado del día (lo usan la interfaz, el servicio de GPS y las alarmas). */
class Prefs(ctx: Context) {
    private val p: SharedPreferences = ctx.getSharedPreferences("bitacora", Context.MODE_PRIVATE)

    init {   // versión 2: paradas a los 2 min dentro de 100 m
        if (p.getInt("schema", 1) < 2) p.edit().putInt("stopMinutes", 2).putInt("schema", 2).apply()
    }

    var scriptUrl: String
        get() = p.getString("scriptUrl", "") ?: ""
        set(v) = p.edit().putString("scriptUrl", v.trim()).apply()
    var token: String
        get() = p.getString("token", DEFAULT_TOKEN) ?: DEFAULT_TOKEN
        set(v) = p.edit().putString("token", v.trim()).apply()
    var name: String
        get() = p.getString("name", "Asbai Jimenez") ?: "Asbai Jimenez"
        set(v) = p.edit().putString("name", v.trim()).apply()
    var plates: String
        get() = p.getString("plates", "") ?: ""
        set(v) = p.edit().putString("plates", v.trim()).apply()
    /** minutos desde medianoche */
    var startAt: Int
        get() = p.getInt("startAt", 8 * 60)
        set(v) = p.edit().putInt("startAt", v).apply()
    var endAt: Int
        get() = p.getInt("endAt", 18 * 60)
        set(v) = p.edit().putInt("endAt", v).apply()
    /** bits: domingo=0 … sábado=6 (por defecto lunes a sábado) */
    var workDays: Int
        get() = p.getInt("workDays", 0b1111110)
        set(v) = p.edit().putInt("workDays", v).apply()
    var stopMinutes: Int
        get() = p.getInt("stopMinutes", 2)
        set(v) = p.edit().putInt("stopMinutes", v).apply()

    // ---- estado del día ----
    var dayDate: String
        get() = p.getString("dayDate", "") ?: ""
        set(v) = p.edit().putString("dayDate", v).apply()
    var dayStarted: Boolean
        get() = dayDate == today() && p.getBoolean("dayStarted", false)
        set(v) = p.edit().putBoolean("dayStarted", v).apply()
    var dayEnded: Boolean
        get() = dayDate == today() && p.getBoolean("dayEnded", false)
        set(v) = p.edit().putBoolean("dayEnded", v).apply()
    var dayRest: Boolean
        get() = dayDate == today() && p.getBoolean("dayRest", false)
        set(v) = p.edit().putBoolean("dayRest", v).apply()

    var tracking: Boolean
        get() = p.getBoolean("tracking", false)
        set(v) = p.edit().putBoolean("tracking", v).apply()
    var trackDate: String
        get() = p.getString("trackDate", "") ?: ""
        set(v) = p.edit().putString("trackDate", v).apply()

    var reminderCount: Int
        get() = p.getInt("reminderCount", 0)
        set(v) = p.edit().putInt("reminderCount", v).apply()

    fun isWorkDay(cal: Calendar = Calendar.getInstance()): Boolean =
        (workDays shr (cal.get(Calendar.DAY_OF_WEEK) - 1)) and 1 == 1

    fun setDayState(o: JSONObject) {
        val e = p.edit()
        e.putString("dayDate", o.optString("date", today()))
        e.putBoolean("dayStarted", o.optBoolean("started", false))
        e.putBoolean("dayEnded", o.optBoolean("ended", false))
        e.putBoolean("dayRest", o.optBoolean("rest", false))
        e.apply()
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("scriptUrl", scriptUrl); put("token", token); put("name", name); put("plates", plates)
        put("startAt", startAt); put("endAt", endAt); put("workDays", workDays); put("stopMinutes", stopMinutes)
        put("today", today())
        put("day", JSONObject().apply {
            put("date", dayDate); put("started", dayStarted); put("ended", dayEnded); put("rest", dayRest)
        })
        put("tracking", tracking)
    }

    fun applyConfig(o: JSONObject) {
        if (o.has("scriptUrl")) scriptUrl = o.getString("scriptUrl")
        if (o.has("token")) token = o.getString("token")
        if (o.has("name")) name = o.getString("name")
        if (o.has("plates")) plates = o.getString("plates")
        if (o.has("startAt")) startAt = o.getInt("startAt")
        if (o.has("endAt")) endAt = o.getInt("endAt")
        if (o.has("workDays")) workDays = o.getInt("workDays")
        if (o.has("stopMinutes")) stopMinutes = o.getInt("stopMinutes").coerceIn(1, 30)
    }

    companion object {
        const val DEFAULT_TOKEN = "hjS36zxuCyNVX7H2pNeZKx2Z"
        fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    }
}
