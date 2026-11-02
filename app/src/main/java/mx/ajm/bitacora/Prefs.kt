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

    init {
        // v2.0: una parada es quedarse 7 min dentro de 150 m
        if (p.getInt("schema", 1) < 4) p.edit().putInt("stopMinutes", 7).putInt("stopRadius", 150).putInt("schema", 4).apply()
        // v2.2: el servicio de Google de la hoja queda configurado de fábrica
        if (p.getInt("schema", 1) < 5) p.edit().putString("scriptUrl", DEFAULT_URL).putInt("schema", 5).apply()
    }

    var scriptUrl: String
        get() = p.getString("scriptUrl", DEFAULT_URL) ?: DEFAULT_URL
        set(v) = p.edit().putString("scriptUrl", v.trim()).apply()
    var token: String
        get() = p.getString("token", DEFAULT_TOKEN) ?: DEFAULT_TOKEN
        set(v) = p.edit().putString("token", v.trim()).apply()
    // ---- usuario registrado (cada quien tiene su propia bitácora) ----
    var userKey: String
        get() = p.getString("userKey", "") ?: ""
        set(v) = p.edit().putString("userKey", v.trim()).apply()
    var sheetUrl: String
        get() = p.getString("sheetUrl", "") ?: ""
        set(v) = p.edit().putString("sheetUrl", v.trim()).apply()
    var employee: String
        get() = p.getString("employee", "") ?: ""
        set(v) = p.edit().putString("employee", v.trim()).apply()
    var email: String
        get() = p.getString("email", "") ?: ""
        set(v) = p.edit().putString("email", v.trim()).apply()
    var name: String
        get() = p.getString("name", "") ?: ""
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
        get() = p.getInt("stopMinutes", 7)
        set(v) = p.edit().putInt("stopMinutes", v).apply()
    /** radio en metros dentro del cual el vehículo se considera detenido */
    var stopRadius: Int
        get() = p.getInt("stopRadius", 150)
        set(v) = p.edit().putInt("stopRadius", v).apply()

    // ---- domicilio particular ----
    var homeLat: Double
        get() = java.lang.Double.longBitsToDouble(p.getLong("homeLat", 0L))
        set(v) = p.edit().putLong("homeLat", java.lang.Double.doubleToRawLongBits(v)).apply()
    var homeLon: Double
        get() = java.lang.Double.longBitsToDouble(p.getLong("homeLon", 0L))
        set(v) = p.edit().putLong("homeLon", java.lang.Double.doubleToRawLongBits(v)).apply()
    var homeAddr: String
        get() = p.getString("homeAddr", "") ?: ""
        set(v) = p.edit().putString("homeAddr", v.trim()).apply()
    val hasHome: Boolean get() = p.contains("homeLat") && !(homeLat == 0.0 && homeLon == 0.0)

    /** grabar solo al salir del domicilio (se arma con la alerta de inicio) */
    var autoStart: Boolean
        get() = p.getBoolean("autoStart", true)
        set(v) = p.edit().putBoolean("autoStart", v).apply()
    /** esperando que el vehículo salga del domicilio */
    var armed: Boolean
        get() = p.getBoolean("armed", false)
        set(v) = p.edit().putBoolean("armed", v).apply()
    /** hora en que se detectó la salida del domicilio (ms) y fecha */
    var departedAt: Long
        get() = p.getLong("departedAt", 0L)
        set(v) = p.edit().putLong("departedAt", v).apply()
    /** último km conocido en la hoja (para iniciar el día sin abrir la app) */
    var lastKm: Double
        get() = p.getFloat("lastKm", -1f).toDouble()
        set(v) = p.edit().putFloat("lastKm", v.toFloat()).apply()

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
        put("registered", userKey.isNotEmpty()); put("sheetUrl", sheetUrl); put("employee", employee); put("email", email)
        put("startAt", startAt); put("endAt", endAt); put("workDays", workDays); put("stopMinutes", stopMinutes)
        put("stopRadius", stopRadius); put("autoStart", autoStart); put("armed", armed)
        put("home", if (hasHome) JSONObject().put("lat", homeLat).put("lon", homeLon).put("address", homeAddr) else JSONObject.NULL)
        put("departedAt", if (departedAt > 0 && today(departedAt) == today()) departedAt else 0L)
        put("today", today())
        put("day", JSONObject().apply {
            put("date", dayDate); put("started", dayStarted); put("ended", dayEnded); put("rest", dayRest)
        })
        put("tracking", tracking)
    }

    fun applyConfig(o: JSONObject) {
        if (o.has("scriptUrl")) scriptUrl = o.getString("scriptUrl")
        if (o.has("token")) token = o.getString("token")
        if (o.has("userKey")) userKey = o.getString("userKey")
        if (o.has("sheetUrl")) sheetUrl = o.getString("sheetUrl")
        if (o.has("employee")) employee = o.getString("employee")
        if (o.has("email")) email = o.getString("email")
        if (o.has("name")) name = o.getString("name")
        if (o.has("plates")) plates = o.getString("plates")
        if (o.has("startAt")) startAt = o.getInt("startAt")
        if (o.has("endAt")) endAt = o.getInt("endAt")
        if (o.has("workDays")) workDays = o.getInt("workDays")
        if (o.has("stopMinutes")) stopMinutes = o.getInt("stopMinutes").coerceIn(1, 30)
        if (o.has("stopRadius")) stopRadius = o.getInt("stopRadius").coerceIn(50, 500)
        if (o.has("autoStart")) autoStart = o.getBoolean("autoStart")
        if (o.has("lastKm") && !o.isNull("lastKm")) lastKm = o.getDouble("lastKm")
        if (o.has("home")) {
            val h = o.optJSONObject("home")
            if (h == null) p.edit().remove("homeLat").remove("homeLon").remove("homeAddr").apply()
            else { homeLat = h.getDouble("lat"); homeLon = h.getDouble("lon"); homeAddr = h.optString("address", "") }
        }
    }

    companion object {
        const val DEFAULT_TOKEN = "hjS36zxuCyNVX7H2pNeZKx2Z"
        const val DEFAULT_URL = "https://script.google.com/macros/s/AKfycbyMegwLhsGlU4bgl_WyYTMQvWdYtAfS5KJ9z4-9lUXn5YfBBiIZfJaWBHIVXKR9DeSP/exec"
        fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        fun today(t: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(t))
    }
}
