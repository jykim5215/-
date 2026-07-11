package app.audiobridge

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder

/**
 * 스트리밍 유지용 포그라운드 서비스.
 * 마이크/미디어프로젝션 타입 승격을 담당하고, 실제 작업은 BridgeEngine이 수행한다.
 */
class BridgeService : Service() {

    companion object {
        const val CHANNEL_ID = "audiobridge"
        const val NOTIF_ID = 1
        const val ACTION_FOREGROUND = "app.audiobridge.action.FOREGROUND"
        const val ACTION_MIC = "app.audiobridge.action.MIC"
        const val ACTION_PROJECTION = "app.audiobridge.action.PROJECTION"
        const val ACTION_DISCONNECT = "app.audiobridge.action.DISCONNECT"
        const val ACTION_STOP = "app.audiobridge.action.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
    }

    private var types = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        BridgeEngine.init(applicationContext)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_MIC -> {
                promote(baseType() or micType())
                BridgeEngine.onServiceMicReady()
            }
            ACTION_PROJECTION -> {
                promote(baseType() or projectionType())
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }
                if (code == Activity.RESULT_OK && data != null) {
                    val mpm = getSystemService(MediaProjectionManager::class.java)
                    val proj = runCatching { mpm.getMediaProjection(code, data) }.getOrNull()
                    BridgeEngine.onProjectionReady(proj)
                } else {
                    BridgeEngine.onProjectionReady(null)
                }
            }
            ACTION_DISCONNECT -> BridgeEngine.disconnect()
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            else -> promote(baseType())
        }
        return START_NOT_STICKY
    }

    private fun promote(newTypes: Int) {
        types = types or newTypes
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notification, types)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun baseType(): Int =
        if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0

    private fun micType(): Int =
        if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0

    private fun projectionType(): Int =
        if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0

    private fun buildNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val disconnectIntent = PendingIntent.getService(
            this, 1, Intent(this, BridgeService::class.java).setAction(ACTION_DISCONNECT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val peer = BridgeState.peerName.value
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bridge)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(if (peer != null) "PC: $peer" else "")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .addAction(
                Notification.Action.Builder(null, getString(R.string.notif_disconnect), disconnectIntent).build()
            )
            .build()
    }
}
