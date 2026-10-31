package mx.ajm.bitacora

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Geocoder
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/** Graba el recorrido del día con el GPS aunque la pantalla esté apagada, y detecta paradas. */
class TrackingService : Service() {
    private lateinit var prefs: Prefs
    private lateinit var store: TrackStore
    private lateinit var detector: StopDetector
    private val io = Executors.newSingleThreadExecutor()
    private var lastNotify = 0L
    private var date = ""

    private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(r: LocationResult) {
            r.locations.forEach { l ->
                val p = Pt(l.time, l.latitude, l.longitude, l.accuracy, if (l.hasSpeed()) l.speed else 0f)
                io.execute { handle(p) }
            }
        }
    }

    private var waiting = false

    /** Mientras está armado: al alejarse del domicilio empieza a grabar el recorrido. */
    private val armCallback = object : LocationCallback() {
        override fun onLocationResult(r: LocationResult) {
            val l = r.lastLocation ?: return
            if (!prefs.armed || l.accuracy > 80f) return
            val d = TrackStore.meters(prefs.homeLat, prefs.homeLon, l.latitude, l.longitude)
            if (d > prefs.stopRadius + 50) departed(l.time)
        }
    }

    @SuppressLint("MissingPermission")
    private fun departed(t: Long) {
        waiting = false
        try { client.removeLocationUpdates(armCallback) } catch (e: Exception) { }
        prefs.armed = false
        prefs.departedAt = t
        prefs.trackDate = Prefs.today(); prefs.tracking = true
        store.stateFile().delete()
        detector = StopDetector(prefs.stopMinutes, prefs.stopRadius)
        date = prefs.trackDate
        // el punto de partida es el domicilio
        store.append(date, Pt(t - 1000, prefs.homeLat, prefs.homeLon, 5f, 0f))
        Alerts.alert(this, Alerts.ID_START, "Saliste del domicilio: grabando recorrido",
            "La jornada empezó a las " + SimpleDateFormat("HH:mm", Locale.US).format(Date(t)) + ". Toca para confirmar el km inicial con la foto del odómetro.", "departed")
        MainActivity.emit("departed", JSONObject().put("t", t))
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L)
            .setMinUpdateIntervalMillis(5_000L).setWaitForAccurateLocation(false).build()
        client.requestLocationUpdates(req, callback, Looper.getMainLooper())
        ContextCompat.getSystemService(this, android.app.NotificationManager::class.java)?.notify(Alerts.ID_TRACK, notification("Grabando recorrido…"))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this); store = TrackStore(this)
        detector = StopDetector(prefs.stopMinutes, prefs.stopRadius)
        Alerts.channels(this)
    }

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { finish(); return START_NOT_STICKY }
        if (intent?.action == ACTION_ARM || (intent?.action == null && prefs.armed && !prefs.tracking)) {
            if (!prefs.hasHome) { prefs.armed = false; stopSelf(); return START_NOT_STICKY }
            prefs.armed = true
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
            try {
                ServiceCompat.startForeground(this, Alerts.ID_TRACK, notification("Esperando la salida del domicilio…", "Listo para grabar"), type)
            } catch (e: Exception) { prefs.armed = false; stopSelf(); return START_NOT_STICKY }
            if (!waiting) {
                waiting = true
                try { client.removeLocationUpdates(callback) } catch (e: Exception) { }
                val req = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 30_000L)
                    .setMinUpdateIntervalMillis(15_000L).build()
                client.requestLocationUpdates(req, armCallback, Looper.getMainLooper())
            }
            return START_STICKY
        }
        if (date.isEmpty()) date = prefs.trackDate.ifEmpty { Prefs.today() }
        if (intent?.action == ACTION_MANUAL) {
            val lat = intent.getDoubleExtra("lat", 0.0); val lon = intent.getDoubleExtra("lon", 0.0)
            val addr = intent.getStringExtra("address") ?: ""
            io.execute {
                val stops = store.stops(date)
                // si ya hay una parada abierta, se cierra antes de abrir la manual
                stops.getOrNull(detector.openIndex)?.let { it.open = false; it.end = maxOf(it.end, detector.lastInsideT) }
                val now = System.currentTimeMillis()
                stops.add(Stop(now, now, lat, lon, addr, open = true, manual = true))
                detector.openManual(stops.size - 1, lat, lon, now)
                store.saveStops(date, stops)
                try { store.stateFile().writeText(detector.toJson().toString()) } catch (e: Exception) { }
                MainActivity.emit("track", store.summary(date))
            }
            return START_STICKY
        }
        if (intent?.action == ACTION_REMOVE) {
            val idx = intent.getIntExtra("index", -1)
            io.execute {
                val stops = store.stops(date)
                if (idx in stops.indices) {
                    stops.removeAt(idx)
                    if (detector.openIndex == idx) detector.openIndex = -1
                    else if (detector.openIndex > idx) detector.openIndex -= 1
                    store.saveStops(date, stops)
                    try { store.stateFile().writeText(detector.toJson().toString()) } catch (e: Exception) { }
                }
                MainActivity.emit("track", store.summary(date))
            }
            return START_STICKY
        }
        if (waiting) { waiting = false; try { client.removeLocationUpdates(armCallback) } catch (e: Exception) { } }
        prefs.armed = false
        date = prefs.trackDate.ifEmpty { Prefs.today() }
        try { detector.restore(JSONObject(store.stateFile().readText())) } catch (e: Exception) { }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, Alerts.ID_TRACK, notification("Grabando recorrido…"), type)
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L)
            .setMinUpdateIntervalMillis(5_000L)
            .setWaitForAccurateLocation(false)
            .build()
        client.requestLocationUpdates(req, callback, Looper.getMainLooper())
        return START_STICKY
    }

    private fun handle(p: Pt) {
        store.append(date, p)
        val stops = store.stops(date)
        when (val ev = detector.feed(p, stops)) {
            is StopDetector.Event.Opened -> {
                val atHome = prefs.hasHome && TrackStore.meters(prefs.homeLat, prefs.homeLon, ev.stop.lat, ev.stop.lon) <= prefs.stopRadius
                ev.stop.address = if (atHome) "Domicilio particular" + (if (prefs.homeAddr.isNotBlank()) " · " + prefs.homeAddr else "")
                    else address(ev.stop.lat, ev.stop.lon)
                store.saveStops(date, stops)
                val hm = SimpleDateFormat("HH:mm", Locale.US).format(Date(ev.stop.start))
                if (atHome) Alerts.alert(this, Alerts.ID_STOP, "Llegaste al domicilio a las $hm",
                    "Se agregó el registro del último tramo. Toca para tomar la foto del odómetro y cerrar la jornada.", "home")
                else Alerts.alert(this, Alerts.ID_STOP, "Parada desde las $hm: nuevo registro",
                    "Vehículo detenido${if (ev.stop.address.isNotEmpty()) " en " + ev.stop.address else ""}. Toca para guardarla en la bitácora y confirmar el km con la foto del odómetro.", "stop")
            }
            is StopDetector.Event.Closed -> {
                store.saveStops(date, stops)
                MainActivity.emit("stopClosed", ev.stop.toJson())
            }
            null -> if (detector.openIndex >= 0) store.saveStops(date, stops)
        }
        try { store.stateFile().writeText(detector.toJson().toString()) } catch (e: Exception) { }
        val now = System.currentTimeMillis()
        if (now - lastNotify > 60_000) {
            lastNotify = now
            val s = store.summary(date)
            val txt = "%.1f km · %d paradas".format(Locale.US, s.optDouble("km"), s.getJSONArray("stops").length())
            ContextCompat.getSystemService(this, android.app.NotificationManager::class.java)?.notify(Alerts.ID_TRACK, notification(txt))
            MainActivity.emit("track", s)
        }
    }

    private fun address(lat: Double, lon: Double): String = try {
        @Suppress("DEPRECATION")
        val a = Geocoder(this, Locale("es", "MX")).getFromLocation(lat, lon, 1)?.firstOrNull()
        if (a == null) "" else listOfNotNull(
            listOfNotNull(a.thoroughfare, a.subThoroughfare).joinToString(" ").ifBlank { null },
            a.subLocality, a.locality
        ).joinToString(", ")
    } catch (e: Exception) { "" }

    private fun notification(text: String, title: String = "Recorrido del día en curso") = NotificationCompat.Builder(this, Alerts.CH_TRACK)
        .setSmallIcon(R.drawable.ic_stat)
        .setColor(0xFFFFB020.toInt())
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(Alerts.openAppIntent(this))
        .build()

    private fun finish() {
        try { client.removeLocationUpdates(callback) } catch (e: Exception) { }
        try { client.removeLocationUpdates(armCallback) } catch (e: Exception) { }
        waiting = false; prefs.armed = false
        io.execute {
            val stops = store.stops(date)
            if (detector.openIndex >= 0) {
                stops.getOrNull(detector.openIndex)?.let { it.open = false; it.end = maxOf(it.end, detector.lastInsideT) }
                store.saveStops(date, stops)
            }
            store.stateFile().delete()
        }
        prefs.tracking = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        try { client.removeLocationUpdates(callback) } catch (e: Exception) { }
        try { client.removeLocationUpdates(armCallback) } catch (e: Exception) { }
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "mx.ajm.bitacora.STOP_TRACKING"
        const val ACTION_MANUAL = "mx.ajm.bitacora.MANUAL_STOP"
        const val ACTION_REMOVE = "mx.ajm.bitacora.REMOVE_STOP"
        const val ACTION_ARM = "mx.ajm.bitacora.ARM"

        /** Espera a que el vehículo salga del domicilio para empezar a grabar. */
        fun arm(ctx: Context): Boolean {
            val p = Prefs(ctx)
            if (!p.hasHome || (p.tracking && p.trackDate == Prefs.today())) return false
            p.armed = true
            return try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, TrackingService::class.java).setAction(ACTION_ARM)); true
            } catch (e: Exception) { p.armed = false; false }
        }

        fun disarm(ctx: Context) {
            val p = Prefs(ctx)
            if (!p.armed) return
            p.armed = false
            if (!p.tracking) ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_STOP))
        }

        fun removeStop(ctx: Context, index: Int) {
            ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_REMOVE).putExtra("index", index))
        }

        fun manualStop(ctx: Context, lat: Double, lon: Double, address: String) {
            ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_MANUAL)
                .putExtra("lat", lat).putExtra("lon", lon).putExtra("address", address))
        }

        fun start(ctx: Context): Boolean {
            val p = Prefs(ctx)
            if (p.trackDate != Prefs.today()) {
                p.trackDate = Prefs.today()
                TrackStore(ctx).stateFile().delete()
            }
            p.tracking = true
            return try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, TrackingService::class.java)); true
            } catch (e: Exception) {
                Alerts.alert(ctx, Alerts.ID_MOVE, "Toca para reanudar el recorrido",
                    "Android detuvo la grabación del GPS. Abre la app para continuar.", "resume")
                false
            }
        }

        fun stop(ctx: Context) {
            Prefs(ctx).tracking = false
            ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_STOP))
        }
    }
}
