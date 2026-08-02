package com.vocacard.app.ui.components.pile

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * 단어 하나에 해당하는 물리 바디.
 *
 * 회전은 **충돌 계산에 쓰지 않는다**(AABB 유지). [lean] 은 가로 속도에 따라 살짝 기우는
 * 시각 효과일 뿐이며, 각도를 충돌에 넣는 순간 안정적인 쌓임이 무너지기 때문에 일부러 분리했다.
 */
class PileBody(
    val wordId: Long,
    val text: String,
    val halfW: Float,
    val halfH: Float,
    var x: Float,
    var y: Float,
) {
    var vx: Float = 0f
    var vy: Float = 0f

    /** 시각용 기울기(도). 가로 속도에 비례해 부드럽게 따라간다. */
    var lean: Float = 0f

    /** 손가락으로 잡고 있는 동안은 물리를 적용하지 않는다. */
    var held: Boolean = false

    /** 충돌 직후 잠깐 밝게 표시하기 위한 값(0~1). */
    var flash: Float = 0f

    fun contains(px: Float, py: Float): Boolean =
        abs(px - x) <= halfW && abs(py - y) <= halfH

    val speed: Float get() = sqrt(vx * vx + vy * vy)
}

/**
 * 아주 작은 2D 물리 세계.
 *
 * 왜 직접 만들었나: 필요한 것은 "상자 수십 개가 통 안에서 굴러다니고 쌓인다" 뿐이라
 * 물리 엔진을 통째로 넣는 것은 과하다. AABB + 순차 임펄스 해법이면 충분하고,
 * 바디가 60개 이하라 O(n²) 충돌 검사도 프레임당 여유롭게 끝난다.
 */
class PileWorld {
    val bodies = mutableListOf<PileBody>()

    var width: Float = 0f
    var height: Float = 0f

    /** 화면 좌표계 중력(px/s²). 가속도 센서에서 갱신된다. */
    var gravityX: Float = 0f
    var gravityY: Float = GRAVITY

    fun add(body: PileBody) {
        bodies += body
    }

    fun clear() = bodies.clear()

    /** 흔들기 — 모든 바디에 위쪽으로 튀는 임펄스를 준다. */
    fun shake(strength: Float, rand: (Int) -> Float) {
        bodies.forEachIndexed { i, b ->
            if (b.held) return@forEachIndexed
            b.vx += (rand(i * 2) - 0.5f) * 2f * strength
            b.vy += -(0.35f + rand(i * 2 + 1) * 0.65f) * strength
            b.flash = 1f
        }
    }

    fun step(dt: Float) {
        if (width <= 0f || height <= 0f) return
        val h = dt.coerceAtMost(MAX_STEP)

        bodies.forEach { b ->
            if (b.held) return@forEach
            b.vx += gravityX * h
            b.vy += gravityY * h
            b.vx *= DAMPING
            b.vy *= DAMPING
            b.x += b.vx * h
            b.y += b.vy * h
        }

        repeat(SOLVER_ITERATIONS) {
            resolvePairs()
            resolveWalls()
        }

        bodies.forEach { b ->
            // 거의 멈췄으면 강하게 잡아 줘야 바닥에서 잔떨림이 생기지 않는다.
            if (abs(b.vx) < REST_EPSILON) b.vx *= 0.6f
            if (abs(b.vy) < REST_EPSILON) b.vy *= 0.6f

            val targetLean = (b.vx / 260f).coerceIn(-1f, 1f) * MAX_LEAN
            b.lean += (targetLean - b.lean) * 0.18f
            if (b.flash > 0f) b.flash = (b.flash - h * 2.2f).coerceAtLeast(0f)
        }
    }

    private fun resolvePairs() {
        for (i in bodies.indices) {
            val a = bodies[i]
            for (j in i + 1 until bodies.size) {
                val b = bodies[j]

                val dx = b.x - a.x
                val overlapX = (a.halfW + b.halfW) - abs(dx)
                if (overlapX <= 0f) continue
                val dy = b.y - a.y
                val overlapY = (a.halfH + b.halfH) - abs(dy)
                if (overlapY <= 0f) continue

                // 겹침이 더 얕은 축으로 밀어낸다(최소 이동 거리).
                if (overlapX < overlapY) {
                    val sign = if (dx < 0f) -1f else 1f
                    separate(a, b, sign * overlapX * 0.5f, 0f)
                    val approach = (b.vx - a.vx) * sign
                    if (approach < 0f) {
                        val impulse = -(1f + RESTITUTION) * approach * 0.5f
                        if (!a.held) a.vx -= impulse * sign
                        if (!b.held) b.vx += impulse * sign
                        a.flash = 1f; b.flash = 1f
                    }
                    applyFrictionY(a, b)
                } else {
                    val sign = if (dy < 0f) -1f else 1f
                    separate(a, b, 0f, sign * overlapY * 0.5f)
                    val approach = (b.vy - a.vy) * sign
                    if (approach < 0f) {
                        val impulse = -(1f + RESTITUTION) * approach * 0.5f
                        if (!a.held) a.vy -= impulse * sign
                        if (!b.held) b.vy += impulse * sign
                        a.flash = 1f; b.flash = 1f
                    }
                    applyFrictionX(a, b)
                }
            }
        }
    }

    /** 잡혀 있는 바디는 밀리지 않는다 — 손가락이 이기게 한다. */
    private fun separate(a: PileBody, b: PileBody, cx: Float, cy: Float) {
        when {
            a.held && b.held -> return
            a.held -> { b.x += cx * 2f; b.y += cy * 2f }
            b.held -> { a.x -= cx * 2f; a.y -= cy * 2f }
            else -> {
                a.x -= cx; a.y -= cy
                b.x += cx; b.y += cy
            }
        }
    }

    private fun applyFrictionX(a: PileBody, b: PileBody) {
        val rel = b.vx - a.vx
        if (!a.held) a.vx += rel * FRICTION * 0.5f
        if (!b.held) b.vx -= rel * FRICTION * 0.5f
    }

    private fun applyFrictionY(a: PileBody, b: PileBody) {
        val rel = b.vy - a.vy
        if (!a.held) a.vy += rel * FRICTION * 0.5f
        if (!b.held) b.vy -= rel * FRICTION * 0.5f
    }

    private fun resolveWalls() {
        bodies.forEach { b ->
            if (b.held) {
                // 잡고 있어도 통 밖으로는 못 나가게 한다.
                b.x = b.x.coerceIn(b.halfW, (width - b.halfW).coerceAtLeast(b.halfW))
                b.y = b.y.coerceIn(b.halfH, (height - b.halfH).coerceAtLeast(b.halfH))
                return@forEach
            }
            val minX = b.halfW
            val maxX = (width - b.halfW).coerceAtLeast(minX)
            val minY = b.halfH
            val maxY = (height - b.halfH).coerceAtLeast(minY)

            if (b.x < minX) {
                b.x = minX; if (b.vx < 0f) { b.vx = -b.vx * RESTITUTION; b.flash = 1f }
                b.vy *= WALL_FRICTION
            } else if (b.x > maxX) {
                b.x = maxX; if (b.vx > 0f) { b.vx = -b.vx * RESTITUTION; b.flash = 1f }
                b.vy *= WALL_FRICTION
            }
            if (b.y < minY) {
                b.y = minY; if (b.vy < 0f) { b.vy = -b.vy * RESTITUTION; b.flash = 1f }
                b.vx *= WALL_FRICTION
            } else if (b.y > maxY) {
                b.y = maxY; if (b.vy > 0f) { b.vy = -b.vy * RESTITUTION; b.flash = 1f }
                b.vx *= WALL_FRICTION
            }
        }
    }

    companion object {
        /** 화면 좌표 기준 기본 중력. 지구 중력(9.8)에 픽셀 배율을 곱한 값. */
        const val GRAVITY = 2400f
        const val PIXELS_PER_G = 245f

        private const val RESTITUTION = 0.28f
        private const val FRICTION = 0.22f
        private const val WALL_FRICTION = 0.92f
        private const val DAMPING = 0.995f
        private const val REST_EPSILON = 12f
        private const val MAX_LEAN = 7f
        private const val MAX_STEP = 1f / 30f
        private const val SOLVER_ITERATIONS = 5
    }
}
