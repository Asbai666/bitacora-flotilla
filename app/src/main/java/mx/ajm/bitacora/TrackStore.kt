package mx.ajm.bitacora

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class Pt(val t: Long, val lat: Double, val lon: Double, val acc: Float, val speed: Float)

data class Stop(
    var start: Long, var end: Long, var lat: Double, var lon: Double,
    var address: String = "", var open: Boolean = true
) {
    fun minutes(): Long = (end - start) / 60000
    fun toJson(): JSONObject = JSONObject().apply {
        put("start", start); put("end", end); put("lat", lat); put("lon", lon)
        put("address", address); put("open", open); put("minutes", minutes())
    }
    companion object {
        fun from(o: JSONObject) = Stop(
            o.getLong("start"), o.getLong("end"), o.getDouble("lat"), o.getDouble("lon"),
            o.optString("address", ""), o.optBoolean("open", false)
        )
    }
}

/** Guarda los puntos GPS y las paradas por día en archivos internos, y arma el KML para Google Earth. */
class TrackStore(private val ctx: Context) {
    private val dir = File(ctx.filesDir, "tracks").apply { mkdirs() }

    fun pointsFile(date: String) = File(dir, "$date.csv")
    fun stopsFile(date: String) = File(dir, "$date-stops.json")
    fun kmlFile(date: String) = File(dir, "Recorrido $date.kml")
    fun stateFile() = File(dir, "detector.json")

    @Synchronized
    fun append(date: String, p: Pt) {
        pointsFile(date).appendText("${p.t},${p.lat},${p.lon},${p.acc},${p.speed}\n")
    }

    fun points(date: String): List<Pt> {
        val f = pointsFile(date)
        if (!f.exists()) return emptyList()
        return f.readLines().mapNotNull { l ->
            val s = l.split(",")
            if (s.size < 5) null else try {
                Pt(s[0].toLong(), s[1].toDouble(), s[2].toDouble(), s[3].toFloat(), s[4].toFloat())
            } catch (e: Exception) { null }
        }
    }

    @Synchronized
    fun stops(date: String): MutableList<Stop> {
        val f = stopsFile(date)
        if (!f.exists()) return mutableListOf()
        return try {
            val a = JSONArray(f.readText())
            MutableList(a.length()) { Stop.from(a.getJSONObject(it)) }
        } catch (e: Exception) { mutableListOf() }
    }

    @Synchronized
    fun saveStops(date: String, list: List<Stop>) {
        val a = JSONArray(); list.forEach { a.put(it.toJson()) }
        stopsFile(date).writeText(a.toString())
    }

    fun distanceKm(date: String): Double {
        val pts = points(date).filter { it.acc <= 40f }
        var d = 0.0
        for (i in 1 until pts.size) {
            val m = meters(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)
            if (m > 8) d += m          // ignora el temblor del GPS estando quieto
        }
        return d / 1000.0
    }

    fun summary(date: String): JSONObject {
        val pts = points(date)
        return JSONObject().apply {
            put("date", date)
            put("points", pts.size)
            put("km", Math.round(distanceKm(date) * 10) / 10.0)
            put("first", pts.firstOrNull()?.t ?: 0)
            put("last", pts.lastOrNull()?.let { JSONObject().put("t", it.t).put("lat", it.lat).put("lon", it.lon) } ?: JSONObject.NULL)
            val a = JSONArray(); stops(date).forEach { a.put(it.toJson()) }
            put("stops", a)
        }
    }

    // ---------- KML (Google Earth) ----------
    fun buildKml(date: String, who: String, plates: String): String {
        val pts = points(date).filter { it.acc <= 50f }
        val st = stops(date)
        val hm = SimpleDateFormat("HH:mm", Locale.US)
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val sb = StringBuilder()
        sb.append("""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
<name>${esc("Recorrido $date · $who")}</name>
<description>${esc("Vehículo $plates · ${"%.1f".format(Locale.US, distanceKm(date))} km por GPS · ${st.size} paradas de 5 min o más")}</description>
<Style id="ruta"><LineStyle><color>ff17a3e8</color><width>5</width></LineStyle></Style>
<Style id="parada"><IconStyle><color>ff2b37b4</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
<Style id="inicio"><IconStyle><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle></Style>
<Style id="fin"><IconStyle><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/blu-circle.png</href></Icon></IconStyle></Style>
""")
        if (pts.isNotEmpty()) {
            sb.append("<Placemark><name>Ruta del día</name><styleUrl>#ruta</styleUrl><gx:Track>\n")
            pts.forEach { sb.append("<when>").append(iso.format(Date(it.t))).append("</when>\n") }
            pts.forEach { sb.append("<gx:coord>${it.lon} ${it.lat} 0</gx:coord>\n") }
            sb.append("</gx:Track></Placemark>\n")
            sb.append("<Placemark><name>${esc("Inicio " + hm.format(Date(pts.first().t)))}</name><styleUrl>#inicio</styleUrl><Point><coordinates>${pts.first().lon},${pts.first().lat},0</coordinates></Point></Placemark>\n")
            sb.append("<Placemark><name>${esc("Fin " + hm.format(Date(pts.last().t)))}</name><styleUrl>#fin</styleUrl><Point><coordinates>${pts.last().lon},${pts.last().lat},0</coordinates></Point></Placemark>\n")
        }
        sb.append("<Folder><name>Paradas</name>\n")
        st.forEachIndexed { i, s ->
            val title = "Parada ${i + 1} · ${hm.format(Date(s.start))}–${hm.format(Date(s.end))} (${s.minutes()} min)"
            sb.append("<Placemark><name>${esc(title)}</name><description>${esc(s.address + "\n" + "%.6f, %.6f".format(Locale.US, s.lat, s.lon))}</description>")
            sb.append("<TimeSpan><begin>${iso.format(Date(s.start))}</begin><end>${iso.format(Date(s.end))}</end></TimeSpan>")
            sb.append("<styleUrl>#parada</styleUrl><Point><coordinates>${s.lon},${s.lat},0</coordinates></Point></Placemark>\n")
        }
        sb.append("</Folder>\n</Document>\n</kml>\n")
        return sb.toString()
    }

    fun buildCsv(date: String): String {
        val hm = SimpleDateFormat("HH:mm", Locale.US)
        val sb = StringBuilder("parada,fecha,llegada,salida,minutos,latitud,longitud,direccion\n")
        stops(date).forEachIndexed { i, s ->
            sb.append("${i + 1},$date,${hm.format(Date(s.start))},${hm.format(Date(s.end))},${s.minutes()},")
            sb.append("%.6f,%.6f,".format(Locale.US, s.lat, s.lon))
            sb.append("\"").append(s.address.replace("\"", "'")).append("\"\n")
        }
        return sb.toString()
    }

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    companion object {
        fun meters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6371000.0
            val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
            val a = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
            return 2 * r * atan2(sqrt(a), sqrt(1 - a))
        }
    }
}

/**
 * Detector de paradas: si el vehículo permanece dentro de RADIO metros durante
 * [minutes] minutos se abre una parada; al alejarse más de SALIDA metros se cierra.
 */
class StopDetector(private val minutes: Int) {
    var anchorLat = 0.0; var anchorLon = 0.0; var anchorT = 0L
    var lastInsideT = 0L
    var openIndex = -1          // índice de la parada abierta en la lista del día
    private var hasAnchor = false

    sealed class Event {
        data class Opened(val stop: Stop) : Event()
        data class Closed(val stop: Stop) : Event()
    }

    fun feed(p: Pt, stops: MutableList<Stop>): Event? {
        if (p.acc > 50f) return null
        if (!hasAnchor) { reset(p); return null }
        val d = TrackStore.meters(anchorLat, anchorLon, p.lat, p.lon)
        if (openIndex >= 0) {
            val s = stops.getOrNull(openIndex) ?: run { openIndex = -1; return null }
            if (d > SALIDA) {
                s.end = lastInsideT; s.open = false; openIndex = -1
                reset(p)
                return Event.Closed(s)
            }
            if (d <= RADIO) { lastInsideT = p.t; s.end = p.t }
            return null
        }
        if (d <= RADIO) {
            lastInsideT = p.t
            if (p.t - anchorT >= minutes * 60_000L) {
                val s = Stop(anchorT, p.t, anchorLat, anchorLon)
                stops.add(s); openIndex = stops.size - 1
                return Event.Opened(s)
            }
        } else reset(p)
        return null
    }

    private fun reset(p: Pt) { anchorLat = p.lat; anchorLon = p.lon; anchorT = p.t; lastInsideT = p.t; hasAnchor = true }

    fun toJson(): JSONObject = JSONObject().apply {
        put("lat", anchorLat); put("lon", anchorLon); put("t", anchorT); put("in", lastInsideT); put("open", openIndex); put("has", hasAnchor)
    }
    fun restore(o: JSONObject) {
        anchorLat = o.optDouble("lat"); anchorLon = o.optDouble("lon"); anchorT = o.optLong("t")
        lastInsideT = o.optLong("in"); openIndex = o.optInt("open", -1); hasAnchor = o.optBoolean("has", false)
    }

    companion object { const val RADIO = 60.0; const val SALIDA = 120.0 }
}
