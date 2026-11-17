package mx.ajm.bitacora

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Alerta fuerte: sirena de dos tonos por el canal de ALARMA (suena aunque el teléfono esté en vibración)
 * y vibración larga. Si el volumen de alarma está bajo, lo sube a ~85 % mientras suena y luego lo regresa.
 */
object Siren {
    private var player: MediaPlayer? = null
    private var restore: Int = -1

    fun play(ctx: Context) {
        val app = ctx.applicationContext
        stop(app)
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        try {
            val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            val cur = am.getStreamVolume(AudioManager.STREAM_ALARM)
            val want = (max * 0.85).toInt().coerceAtLeast(1)
            if (cur < want) { restore = cur; am.setStreamVolume(AudioManager.STREAM_ALARM, want, 0) }
        } catch (e: Exception) { restore = -1 }
        try {
            val mp = MediaPlayer()
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            val fd = app.resources.openRawResourceFd(R.raw.sirena)
            mp.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length); fd.close()
            mp.setOnCompletionListener { stop(app) }
            mp.prepare(); mp.start()
            player = mp
        } catch (e: Exception) { stop(app) }
        vibrate(app)
    }

    fun stop(ctx: Context) {
        try { player?.stop() } catch (e: Exception) { }
        try { player?.release() } catch (e: Exception) { }
        player = null
        if (restore >= 0) {
            try { (ctx.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager).setStreamVolume(AudioManager.STREAM_ALARM, restore, 0) } catch (e: Exception) { }
            restore = -1
        }
    }

    private fun vibrate(ctx: Context) {
        val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        val pattern = longArrayOf(0, 900, 250, 900, 250, 900, 250, 1400)
        try {
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, -1)) else @Suppress("DEPRECATION") v.vibrate(pattern, -1)
        } catch (e: Exception) { }
    }
}
