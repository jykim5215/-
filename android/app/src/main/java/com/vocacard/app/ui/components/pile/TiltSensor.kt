package com.vocacard.app.ui.components.pile

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import kotlin.math.abs
import kotlin.math.sqrt

/** 화면 좌표계로 변환된 중력 방향. y 는 아래가 양수(Compose 좌표계와 동일). */
data class Tilt(val x: Float, val y: Float)

/**
 * 가속도 센서로 기기 기울기와 흔들기를 읽는다.
 *
 * - **권한이 필요 없다.** 가속도계는 일반 센서라 별도 퍼미션 없이 읽을 수 있다.
 * - 센서가 없는 기기(에뮬레이터 등)에서는 그냥 아래 방향 중력이 유지된다 — 기능이 죽지 않는다.
 * - 화면 회전에 맞춰 축을 돌려 준다. 가로 모드에서도 "아래"가 실제 아래를 향한다.
 * - 흔들기는 중력을 뺀 가속도의 크기로 판정하고, 연속 발동을 막기 위해 쿨다운을 둔다.
 *
 * @param onShake 흔들림이 감지될 때 세기(0~1 정도로 정규화된 값)와 함께 호출된다.
 */
@Composable
fun rememberTilt(
    enabled: Boolean,
    onShake: (Float) -> Unit,
): State<Tilt> {
    val context = LocalContext.current
    val view = LocalView.current
    val tilt = remember { mutableStateOf(Tilt(0f, 1f)) }
    val currentOnShake by rememberUpdatedState(onShake)

    DisposableEffect(enabled, context) {
        if (!enabled) return@DisposableEffect onDispose { }

        val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val sensor = manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (manager == null || sensor == null) {
            tilt.value = Tilt(0f, 1f)
            return@DisposableEffect onDispose { }
        }

        // 저역 통과로 중력 성분만 남기고, 나머지를 흔들림으로 본다.
        val gravity = FloatArray(3)
        var initialized = false
        var lastShakeAt = 0L

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (!initialized) {
                    System.arraycopy(event.values, 0, gravity, 0, 3)
                    initialized = true
                } else {
                    for (i in 0..2) {
                        gravity[i] = LOW_PASS * gravity[i] + (1f - LOW_PASS) * event.values[i]
                    }
                }

                val rotation = view.display?.rotation ?: Surface.ROTATION_0
                // 센서 x/y 를 화면 방향에 맞춰 회전시킨다.
                val (sx, sy) = when (rotation) {
                    Surface.ROTATION_90 -> gravity[1] to -gravity[0]
                    Surface.ROTATION_180 -> -gravity[0] to -gravity[1]
                    Surface.ROTATION_270 -> -gravity[1] to gravity[0]
                    else -> gravity[0] to gravity[1]
                }
                // 기기를 오른쪽으로 기울이면 물건이 오른쪽으로 굴러야 한다 → x 부호 반전.
                tilt.value = Tilt(x = -sx / GRAVITY_EARTH, y = sy / GRAVITY_EARTH)

                val dx = event.values[0] - gravity[0]
                val dy = event.values[1] - gravity[1]
                val dz = event.values[2] - gravity[2]
                val jerk = sqrt(dx * dx + dy * dy + dz * dz)
                if (jerk > SHAKE_THRESHOLD) {
                    val now = System.currentTimeMillis()
                    if (now - lastShakeAt > SHAKE_COOLDOWN_MS) {
                        lastShakeAt = now
                        currentOnShake(((jerk - SHAKE_THRESHOLD) / SHAKE_THRESHOLD).coerceIn(0.2f, 1.6f))
                    }
                }
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }

        manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
        onDispose { manager.unregisterListener(listener) }
    }

    return tilt
}

/** 흔들기 여부와 무관하게, 기울기가 거의 없으면 아래로 떨어지게 보정한다. */
fun Tilt.normalized(): Tilt {
    val mag = sqrt(x * x + y * y)
    return if (mag < 0.15f) Tilt(0f, 1f) else Tilt(x / mag, y / mag)
}

fun Tilt.isFlat(): Boolean = abs(y) < 0.25f && abs(x) < 0.25f

private const val LOW_PASS = 0.85f
private const val GRAVITY_EARTH = 9.81f
private const val SHAKE_THRESHOLD = 7.5f
private const val SHAKE_COOLDOWN_MS = 450L
