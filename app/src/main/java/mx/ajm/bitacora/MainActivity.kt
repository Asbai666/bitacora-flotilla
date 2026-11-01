package mx.ajm.bitacora

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var prefs: Prefs
    private lateinit var photos: PhotoProcessor
    private lateinit var store: TrackStore

    private var pendingSlot = ""
    private var pendingCb = 0
    private var permCb: (() -> Unit)? = null

    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) handlePhoto(pendingCb, pendingSlot, Uri.fromFile(photos.captureFile(pendingSlot)), true)
        else reply(pendingCb, JSONObject().put("ok", false).put("cancelled", true))
    }
    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) handlePhoto(pendingCb, pendingSlot, uri, false)
        else reply(pendingCb, JSONObject().put("ok", false).put("cancelled", true))
    }
    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permCb?.invoke(); permCb = null; emit("perms", permissionState())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this); photos = PhotoProcessor(this); store = TrackStore(this)
        pendingSlot = savedInstanceState?.getString("slot") ?: ""
        pendingCb = savedInstanceState?.getInt("cb") ?: 0
        Alerts.channels(this)
        Alerts.schedule(this)

        web = WebView(this)
        current = WeakReference(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            textZoom = 100
        }
        // el tablero tiene su propio tema oscuro
        if (Build.VERSION.SDK_INT >= 33) web.settings.isAlgorithmicDarkeningAllowed = false
        else if (Build.VERSION.SDK_INT >= 29) web.settings.forceDark = android.webkit.WebSettings.FORCE_DARK_OFF
        web.setBackgroundColor(0xFF0B0F12.toInt())
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.url.host == "tile.openstreetmap.org") tile(request.url) else null
        }
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("file:///android_asset/index.html")

        if (prefs.tracking) TrackingService.resume(this)
        else if (prefs.armed) TrackingService.arm(this)
        handleAlertIntent(intent)
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out); out.putString("slot", pendingSlot); out.putInt("cb", pendingCb)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleAlertIntent(intent) }

    override fun onResume() {
        super.onResume(); current = WeakReference(this)
        emit("resume", JSONObject().put("track", store.summary(Prefs.today())).put("perms", permissionState()))
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.onBack ? window.onBack() : false") { r ->
            if (r != "true") @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    private fun handleAlertIntent(i: Intent?) {
        val k = i?.getStringExtra("alert") ?: return
        web.postDelayed({ emit("openAlert", JSONObject().put("kind", k)) }, 600)
    }

    // ---------- mapa: calles de OpenStreetMap con caché en el teléfono ----------
    // OSM pide identificar la app y guardar en caché los mosaicos; sin eso los bloquea.
    private fun tile(u: Uri): WebResourceResponse {
        val parts = u.pathSegments
        val dir = java.io.File(cacheDir, "tiles").apply { mkdirs() }
        val f = java.io.File(dir, parts.joinToString("_"))
        val fresh = f.exists() && System.currentTimeMillis() - f.lastModified() < 14L * 86_400_000
        if (!fresh) try {
            val c = (java.net.URL(u.toString()).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 10_000; readTimeout = 15_000
                setRequestProperty("User-Agent", "BitacoraFlotilla/2.5 (Android; mx.ajm.bitacora)")
                setRequestProperty("Referer", "https://github.com/Asbai666/bitacora-flotilla")
            }
            if (c.responseCode == 200) { val bytes = c.inputStream.use { it.readBytes() }; f.writeBytes(bytes) }
            c.disconnect()
        } catch (e: Exception) { }
        return if (f.exists()) WebResourceResponse("image/png", null, f.inputStream())
        else WebResourceResponse("image/png", null, 404, "Not Found", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
    }

    // ---------- respuesta a la interfaz ----------
    private fun reply(cb: Int, o: JSONObject) {
        if (cb == 0) return
        runOnUiThread { web.evaluateJavascript("window.__cb($cb, ${JSONObject.quote(o.toString())})", null) }
    }
    private fun fail(cb: Int, e: Throwable) = reply(cb, JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName))

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun permissionState() = JSONObject().apply {
        put("location", has(Manifest.permission.ACCESS_FINE_LOCATION))
        put("notifications", Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS))
        put("battery", getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName))
        put("exactAlarm", Build.VERSION.SDK_INT < 31 || getSystemService(AlarmManager::class.java).canScheduleExactAlarms())
        put("media", Build.VERSION.SDK_INT < 29 || has(Manifest.permission.ACCESS_MEDIA_LOCATION))
        put("background", Build.VERSION.SDK_INT < 29 || has(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    }

    private fun basePerms(): Array<String> {
        val l = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) l += Manifest.permission.POST_NOTIFICATIONS
        return l.toTypedArray()
    }
    private fun mediaPerms(): Array<String> {
        val l = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33) l += Manifest.permission.READ_MEDIA_IMAGES
        else l += Manifest.permission.READ_EXTERNAL_STORAGE
        if (Build.VERSION.SDK_INT >= 29) l += Manifest.permission.ACCESS_MEDIA_LOCATION
        return l.toTypedArray()
    }
    private fun ensure(perms: Array<String>, then: () -> Unit) {
        val missing = perms.filter { !has(it) }
        if (missing.isEmpty()) then() else { permCb = then; askPerms.launch(missing.toTypedArray()) }
    }

    @SuppressLint("MissingPermission")
    private suspend fun currentLocation(): Pair<Double, Double>? {
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) return null
        val client = LocationServices.getFusedLocationProviderClient(this)
        val l = withTimeoutOrNull(15_000) {
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token).await()
        } ?: try { client.lastLocation.await() } catch (e: Exception) { null }
        return l?.let { it.latitude to it.longitude }
    }

    private fun address(lat: Double, lon: Double): String = try {
        @Suppress("DEPRECATION")
        val a = Geocoder(this, Locale("es", "MX")).getFromLocation(lat, lon, 1)?.firstOrNull()
        if (a == null) "" else listOfNotNull(
            listOfNotNull(a.thoroughfare, a.subThoroughfare).joinToString(" ").ifBlank { null },
            a.subLocality, a.locality
        ).joinToString(", ")
    } catch (e: Exception) { "" }

    private fun handlePhoto(cb: Int, slot: String, uri: Uri, fromCamera: Boolean) {
        lifecycleScope.launch {
            try {
                val loc = if (fromCamera) currentLocation() else null
                val r = withContext(Dispatchers.Default) { photos.process(slot, uri, fromCamera, loc, prefs.name, prefs.plates) }
                val lat = r.opt("lat"); val lon = r.opt("lon")
                if (lat is Double && lon is Double) r.put("address", withContext(Dispatchers.IO) { address(lat, lon) })
                reply(cb, r.put("ok", true))
            } catch (e: Throwable) { fail(cb, e) }
        }
    }

    /** Arma el KML del día o del mes. */
    private fun kmlFor(scope: String): java.io.File? {
        if (scope.length == 7) {
            val days = store.daysOf(scope); if (days.isEmpty()) return null
            val f = java.io.File(store.kmlFile(scope).parentFile, "Recorridos $scope.kml")
            f.writeText(store.buildKml(days, "Recorridos $scope · ${prefs.name}", prefs.plates)); return f
        }
        val d = scope.ifEmpty { Prefs.today() }
        if (store.points(d).isEmpty() && store.stops(d).isEmpty()) return null
        val f = store.kmlFile(d); f.writeText(store.buildKml(d, prefs.name, prefs.plates)); return f
    }

    private fun openKml(f: java.io.File) {
        val uri = FileProvider.getUriForFile(this, "mx.ajm.bitacora.files", f)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.google-earth.kml+xml").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { startActivity(i) } catch (e: ActivityNotFoundException) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.earth"))) }
            catch (x: Exception) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.earth"))) }
        }
    }

    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray): String? {
        if (Build.VERSION.SDK_INT < 29) return null
        return try {
            val cv = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/Bitacora Flotilla")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv) ?: return null
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            "Descargas/Bitacora Flotilla/$name"
        } catch (e: Exception) { null }
    }

    // ---------- puente con la interfaz (JavaScript) ----------
    inner class Bridge {
        @JavascriptInterface fun config(): String = prefs.toJson().put("perms", permissionState()).toString()

        @JavascriptInterface fun setConfig(json: String) {
            prefs.applyConfig(JSONObject(json)); Alerts.schedule(this@MainActivity)
        }

        @JavascriptInterface fun setDay(json: String) {
            prefs.setDayState(JSONObject(json)); prefs.reminderCount = 0; Alerts.schedule(this@MainActivity)
        }

        @JavascriptInterface fun permissions(cb: Int) = runOnUiThread {
            ensure(basePerms()) { reply(cb, permissionState().put("ok", true)) }
        }

        @JavascriptInterface fun photo(cb: Int, slot: String, source: String) = runOnUiThread {
            pendingSlot = slot; pendingCb = cb
            if (source == "camera") {
                ensure(basePerms()) {
                    val f = photos.captureFile(slot); f.delete()
                    val uri = FileProvider.getUriForFile(this@MainActivity, "mx.ajm.bitacora.files", f)
                    try { takePicture.launch(uri) } catch (e: ActivityNotFoundException) { fail(cb, e) }
                }
            } else ensure(mediaPerms()) { pickImage.launch("image/*") }
        }

        @JavascriptInterface fun rewatermark(cb: Int, slot: String, lat: Double, lon: Double) {
            lifecycleScope.launch {
                try {
                    val r = withContext(Dispatchers.Default) { photos.rewatermark(slot, lat, lon, prefs.name, prefs.plates) }
                    r.put("address", withContext(Dispatchers.IO) { address(lat, lon) })
                    reply(cb, r.put("ok", true))
                } catch (e: Throwable) { fail(cb, e) }
            }
        }

        @JavascriptInterface fun clearPhoto(slot: String) { photos.clear(slot) }

        /** Lee solo la zona de la foto que se tocó (x, y entre 0 y 1). */
        @JavascriptInterface fun ocrRegion(cb: Int, slot: String, x: Double, y: Double) {
            lifecycleScope.launch {
                try {
                    val lines = withContext(Dispatchers.Default) { photos.ocrRegion(slot, x, y) }
                    reply(cb, JSONObject().put("ok", true).put("lines", lines))
                } catch (e: Throwable) { fail(cb, e) }
            }
        }

        @JavascriptInterface fun location(cb: Int) = runOnUiThread {
            ensure(basePerms()) {
                lifecycleScope.launch {
                    val l = currentLocation()
                    if (l == null) reply(cb, JSONObject().put("ok", false).put("error", "No se obtuvo la ubicación. Revisa que el GPS esté encendido."))
                    else reply(cb, JSONObject().put("ok", true).put("lat", l.first).put("lon", l.second)
                        .put("address", withContext(Dispatchers.IO) { address(l.first, l.second) }))
                }
            }
        }

        @JavascriptInterface fun startTracking(cb: Int) = runOnUiThread {
            ensure(basePerms()) {
                if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    reply(cb, JSONObject().put("ok", false).put("error", "Sin permiso de ubicación no se puede grabar el recorrido."))
                } else reply(cb, JSONObject().put("ok", TrackingService.start(this@MainActivity)))
            }
        }

        @JavascriptInterface fun stopTracking() { TrackingService.stop(this@MainActivity) }

        /** Graba solo cuando el vehículo salga del domicilio. */
        @JavascriptInterface fun arm(cb: Int) = runOnUiThread {
            ensure(basePerms()) {
                when {
                    !has(Manifest.permission.ACCESS_FINE_LOCATION) -> reply(cb, JSONObject().put("ok", false).put("error", "Sin permiso de ubicación no se puede detectar la salida."))
                    !prefs.hasHome -> reply(cb, JSONObject().put("ok", false).put("error", "Primero guarda la ubicación de tu domicilio en Ajustes."))
                    else -> reply(cb, JSONObject().put("ok", TrackingService.arm(this@MainActivity)))
                }
            }
        }

        @JavascriptInterface fun disarm() { TrackingService.disarm(this@MainActivity) }

        /** Toma la ubicación actual como domicilio particular. */
        @JavascriptInterface fun setHomeHere(cb: Int) = runOnUiThread {
            ensure(basePerms()) {
                lifecycleScope.launch {
                    val l = currentLocation()
                    if (l == null) { reply(cb, JSONObject().put("ok", false).put("error", "No se obtuvo la ubicación. Revisa que el GPS esté encendido.")); return@launch }
                    val addr = withContext(Dispatchers.IO) { address(l.first, l.second) }
                    prefs.homeLat = l.first; prefs.homeLon = l.second; prefs.homeAddr = addr
                    reply(cb, JSONObject().put("ok", true).put("lat", l.first).put("lon", l.second).put("address", addr))
                }
            }
        }

        /** Dirección de unas coordenadas escritas a mano. */
        @JavascriptInterface fun geocode(cb: Int, lat: Double, lon: Double) {
            lifecycleScope.launch { reply(cb, JSONObject().put("ok", true).put("address", withContext(Dispatchers.IO) { address(lat, lon) })) }
        }

        @JavascriptInterface fun backgroundLocation() = runOnUiThread {
            if (Build.VERSION.SDK_INT >= 29 && has(Manifest.permission.ACCESS_FINE_LOCATION))
                ensure(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) { }
            else ensure(basePerms()) { }
        }

        /** KML de un día ("2026-10-30") o de un mes ("2026-10"): lo guarda en Descargas y abre el menú para compartir. */
        @JavascriptInterface fun shareKml(cb: Int, scope: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val f = kmlFor(scope) ?: throw IllegalStateException("No hay recorridos grabados en ese periodo")
                    val local = saveToDownloads(f.name, "application/vnd.google-earth.kml+xml", f.readBytes())
                    val uri = FileProvider.getUriForFile(this@MainActivity, "mx.ajm.bitacora.files", f)
                    val send = Intent(Intent.ACTION_SEND).setType("application/vnd.google-earth.kml+xml")
                        .putExtra(Intent.EXTRA_STREAM, uri).putExtra(Intent.EXTRA_SUBJECT, f.name.removeSuffix(".kml"))
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    withContext(Dispatchers.Main) { startActivity(Intent.createChooser(send, "Compartir recorrido KML")) }
                    reply(cb, JSONObject().put("ok", true).put("local", local ?: JSONObject.NULL).put("name", f.name))
                } catch (e: Throwable) { fail(cb, e) }
            }
        }

        @JavascriptInterface fun earthScope(scope: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                val f = try { kmlFor(scope) } catch (e: Exception) { null } ?: return@launch
                withContext(Dispatchers.Main) { openKml(f) }
            }
        }

        @JavascriptInterface fun monthDays(month: String): String {
            val a = JSONArray()
            store.daysOf(month).forEach { d ->
                a.put(JSONObject().put("date", d).put("km", Math.round(store.distanceKm(d) * 10) / 10.0).put("stops", store.stops(d).size))
            }
            return a.toString()
        }

        /** Parada manual en la ubicación actual. */
        @JavascriptInterface fun addStop(cb: Int, date: String) = runOnUiThread {
            ensure(basePerms()) {
                lifecycleScope.launch {
                    val l = currentLocation()
                    if (l == null) { reply(cb, JSONObject().put("ok", false).put("error", "No se obtuvo la ubicación. Revisa que el GPS esté encendido.")); return@launch }
                    val addr = withContext(Dispatchers.IO) { address(l.first, l.second) }
                    val d = date.ifEmpty { Prefs.today() }
                    if (prefs.tracking && prefs.trackDate == d) TrackingService.manualStop(this@MainActivity, l.first, l.second, addr)
                    else withContext(Dispatchers.IO) {
                        val list = store.stops(d); val now = System.currentTimeMillis()
                        list.add(Stop(now, now, l.first, l.second, addr, open = false, manual = true)); store.saveStops(d, list)
                    }
                    reply(cb, JSONObject().put("ok", true).put("lat", l.first).put("lon", l.second).put("address", addr))
                }
            }
        }

        @JavascriptInterface fun removeStop(date: String, index: Int) {
            val d = date.ifEmpty { Prefs.today() }
            if (prefs.tracking && prefs.trackDate == d) TrackingService.removeStop(this@MainActivity, index)
            else store.removeStop(d, index)
        }

        @JavascriptInterface fun trackKm(date: String, from: Double, to: Double): Double =
            Math.round(store.distanceKm(date.ifEmpty { Prefs.today() }, from.toLong(), if (to <= 0) Long.MAX_VALUE else to.toLong()) * 10) / 10.0

        /** Puntos del recorrido del día para el mini mapa (reducidos a ~1500). */
        @JavascriptInterface fun route(date: String): String {
            val pts = store.points(date.ifEmpty { Prefs.today() }).filter { it.acc <= 50f }
            val step = maxOf(1, pts.size / 1500)
            val a = JSONArray()
            pts.forEachIndexed { i, p ->
                if (i % step == 0 || i == pts.size - 1) a.put(JSONArray().put(Math.round(p.lat * 1e6) / 1e6).put(Math.round(p.lon * 1e6) / 1e6))
            }
            return a.toString()
        }

        @JavascriptInterface fun track(date: String): String =
            date.ifEmpty { Prefs.today() }.let { d -> store.summary(d).put("active", prefs.tracking && prefs.trackDate == d).put("trackDate", prefs.trackDate).toString() }

        @JavascriptInterface fun call(cb: Int, action: String, json: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val payload = JSONObject(json)
                    if (action == "save" || action == "carga") {
                        val list = payload.optJSONArray("photoSlots") ?: JSONArray()
                        val arr = JSONArray()
                        val date = payload.optJSONObject("entry")?.optString("fTras")?.ifEmpty { null }
                            ?: payload.optJSONObject("carga")?.optString("fCarga")?.ifEmpty { null } ?: Prefs.today()
                        for (i in 0 until list.length()) {
                            val it = list.getJSONObject(i); val slot = it.getString("slot")
                            val f = photos.marked(slot); if (!f.exists()) continue
                            val o = JSONObject().put("slot", slot)
                                .put("name", "$date ${PhotoProcessor.label(slot)} ${java.text.SimpleDateFormat("HHmm", java.util.Locale.US).format(java.util.Date(photos.readMeta(slot)?.time ?: System.currentTimeMillis()))} - ${prefs.name}.jpg")
                                .put("b64", photos.b64(f))
                            if (it.optString("box").isNotEmpty() && photos.small(slot).exists()) o.put("box", it.getString("box")).put("small", photos.b64(photos.small(slot)))
                            arr.put(o)
                        }
                        payload.remove("photoSlots"); payload.put("photos", arr)
                    }
                    reply(cb, Backend(prefs).call(action, payload))
                } catch (e: Throwable) { fail(cb, e) }
            }
        }

        @JavascriptInterface fun exportTrack(cb: Int, date: String, upload: Boolean, odoKm: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val d = date.ifEmpty { Prefs.today() }
                    val kml = store.buildKml(d, prefs.name, prefs.plates, odoKm)
                    val csv = store.buildCsv(d)
                    store.kmlFile(d).writeText(kml)
                    val local = saveToDownloads("Recorrido $d.kml", "application/vnd.google-earth.kml+xml", kml.toByteArray())
                    saveToDownloads("Recorrido $d - paradas.csv", "text/csv", csv.toByteArray())
                    val out = JSONObject().put("ok", true).put("local", local ?: JSONObject.NULL)
                    if (upload) {
                        try { out.put("links", Backend(prefs).call("track", JSONObject().put("date", d).put("kml", kml).put("csv", csv)).optJSONObject("links")) }
                        catch (e: Exception) { out.put("uploadError", e.message) }
                    }
                    reply(cb, out)
                } catch (e: Throwable) { fail(cb, e) }
            }
        }

        @JavascriptInterface fun openEarth(date: String) = runOnUiThread {
            val d = date.ifEmpty { Prefs.today() }
            val f = store.kmlFile(d)
            f.writeText(store.buildKml(d, prefs.name, prefs.plates))
            openKml(f)
        }

        @SuppressLint("BatteryLife")
        @JavascriptInterface fun battery() = runOnUiThread {
            try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
            catch (e: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }

        @JavascriptInterface fun exactAlarms() = runOnUiThread {
            if (Build.VERSION.SDK_INT >= 31) try { startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))) } catch (e: Exception) { }
        }

        @JavascriptInterface fun appSettings() = runOnUiThread {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }

        @JavascriptInterface fun testAlert() {
            Alerts.alert(this@MainActivity, Alerts.ID_MOVE, "Prueba de alerta", "Así suenan y se ven los avisos de inicio, fin y vehículo detenido.", "test")
        }
    }

    companion object {
        private var current: WeakReference<MainActivity>? = null

        /** Envía un aviso a la interfaz si la app está abierta. */
        fun emit(type: String, data: JSONObject) {
            val a = current?.get() ?: return
            a.runOnUiThread {
                if (!a.isFinishing) a.web.evaluateJavascript(
                    "window.onNative && window.onNative(${JSONObject.quote(type)}, ${JSONObject.quote(data.toString())})", null)
            }
        }
    }
}
