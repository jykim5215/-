package com.vocacard.app.ui.components.pile

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 단어 하나에 해당하는 **강체(rigid body)**.
 *
 * 충돌 형상은 알약(capsule) — 가로로 늘어선 원 몇 개다.
 * 사각형 SAT 대신 원 뭉치를 쓰는 이유:
 *  - 원-원 충돌은 수식이 짧아 틀릴 여지가 적다(이 프로젝트는 실기 테스트가 어렵다).
 *  - 접촉점이 여러 개 생기므로 바닥에 **평평하게** 눕는다. 접촉점이 하나뿐이면
 *    쌓인 칩이 좌우로 계속 흔들린다.
 *  - 충돌 임펄스를 무게중심에서 떨어진 지점에 적용하므로 **회전이 자연스럽게 생긴다.**
 * 그리는 모양도 같은 알약(모서리 반지름 = halfH)이라 보이는 것과 부딪히는 것이 일치한다.
 */
class PileBody(
    val wordId: Long,
    val text: String,
    val halfW: Float,
    val halfH: Float,
    var x: Float,
    var y: Float,
    angle: Float = 0f,
) {
    /** 라디안. 그리기와 물리가 같은 값을 쓴다. */
    var angle: Float = angle
    var vx: Float = 0f
    var vy: Float = 0f

    /** 각속도(rad/s). */
    var av: Float = 0f

    /** 손가락으로 잡고 있는 동안은 무한 질량처럼 굴어 밀리지 않는다. */
    var held: Boolean = false

    /** 충돌 직후 잠깐 밝아지는 값(0~1). */
    var flash: Float = 0f

    /** 거의 멈춘 상태가 이어진 프레임 수. 일정 이상이면 재워서 잔떨림을 없앤다. */
    var restFrames: Int = 0

    val radius: Float = halfH
    val mass: Float = (halfW * 2f) * (halfH * 2f) * DENSITY
    val inertia: Float =
        mass * ((halfW * 2f) * (halfW * 2f) + (halfH * 2f) * (halfH * 2f)) / 12f

    val invMass: Float get() = if (held) 0f else 1f / mass
    val invInertia: Float get() = if (held) 0f else 1f / inertia

    /** 로컬 x 축 위에 놓인 원들의 중심 오프셋. 알약의 뼈대. */
    val offsets: FloatArray = run {
        val span = (halfW - halfH).coerceAtLeast(0f)
        if (span < 1f) {
            floatArrayOf(0f)
        } else {
            val n = max(2, (span / halfH).roundToInt() + 1).coerceAtMost(5)
            FloatArray(n) { i -> -span + 2f * span * i / (n - 1) }
        }
    }

    fun circleX(i: Int): Float = x + cos(angle) * offsets[i]
    fun circleY(i: Int): Float = y + sin(angle) * offsets[i]

    /** 회전을 고려한 히트 테스트(알약 내부인지). */
    fun contains(px: Float, py: Float): Boolean {
        for (i in offsets.indices) {
            val dx = px - circleX(i)
            val dy = py - circleY(i)
            if (dx * dx + dy * dy <= radius * radius) return true
        }
        return false
    }

    fun wake() {
        restFrames = 0
    }

    internal fun sane(): Boolean =
        x.isFinite() && y.isFinite() && vx.isFinite() && vy.isFinite() &&
            av.isFinite() && angle.isFinite()

    companion object {
        const val DENSITY = 0.00002f
    }
}

/**
 * 회전까지 다루는 작은 2D 강체 물리 세계.
 *
 * 순차 임펄스(sequential impulse) 방식이다. 접촉마다
 *  1. 법선 방향 임펄스로 파고든 속도를 없애고(반발계수 적용),
 *  2. 접선 방향 마찰 임펄스를 쿨롱 한계 안에서 걸고,
 *  3. 남은 침투는 위치를 직접 밀어 정리한다.
 * 임펄스를 무게중심에서 떨어진 접촉점에 적용하기 때문에 토크가 생겨 **칩이 굴러간다.**
 */
class PileWorld {
    val bodies = mutableListOf<PileBody>()

    var width: Float = 0f
    var height: Float = 0f

    /** 화면 좌표계 중력(px/s²). 가속도 센서가 갱신한다. */
    var gravityX: Float = 0f
    var gravityY: Float = GRAVITY

    fun add(body: PileBody) {
        bodies += body
    }

    fun clear() = bodies.clear()

    /** 흔들기 — 위로 튀어 오르며 제각기 다른 방향으로 돈다. */
    fun shake(strength: Float, rand: (Int) -> Float) {
        bodies.forEachIndexed { i, b ->
            if (b.held) return@forEachIndexed
            b.vx += (rand(i * 3) - 0.5f) * 2f * strength
            b.vy += -(0.35f + rand(i * 3 + 1) * 0.65f) * strength
            b.av += (rand(i * 3 + 2) - 0.5f) * 14f
            b.flash = 1f
            b.wake()
        }
    }

    fun step(dt: Float) {
        if (width <= 0f || height <= 0f) return
        val h = dt.coerceAtMost(MAX_STEP)

        // 1. 힘 적분
        bodies.forEach { b ->
            if (b.held || b.restFrames > SLEEP_FRAMES) return@forEach
            b.vx += gravityX * h
            b.vy += gravityY * h
            b.vx *= LINEAR_DAMPING
            b.vy *= LINEAR_DAMPING
            b.av *= ANGULAR_DAMPING
            clampVelocity(b)
            b.x += b.vx * h
            b.y += b.vy * h
            b.angle += b.av * h
        }

        // 2. 접촉 해소
        repeat(SOLVER_ITERATIONS) {
            resolvePairs()
            resolveWalls()
        }

        // 3. 뒷정리 — 재우기, 밝기 감쇠, 수치 폭주 방어
        bodies.forEach { b ->
            if (!b.sane()) reset(b)
            val moving = abs(b.vx) + abs(b.vy) > REST_SPEED || abs(b.av) > REST_SPIN
            if (moving || b.held) {
                b.restFrames = 0
            } else {
                b.restFrames++
                if (b.restFrames > SLEEP_FRAMES) {
                    b.vx = 0f; b.vy = 0f; b.av = 0f
                }
            }
            if (b.flash > 0f) b.flash = (b.flash - h * 2.2f).coerceAtLeast(0f)
        }
    }

    private fun clampVelocity(b: PileBody) {
        val speed = sqrt(b.vx * b.vx + b.vy * b.vy)
        if (speed > MAX_SPEED) {
            val k = MAX_SPEED / speed
            b.vx *= k; b.vy *= k
        }
        if (b.av > MAX_SPIN) b.av = MAX_SPIN
        if (b.av < -MAX_SPIN) b.av = -MAX_SPIN
    }

    private fun reset(b: PileBody) {
        b.x = (width / 2f); b.y = (height / 2f)
        b.vx = 0f; b.vy = 0f; b.av = 0f; b.angle = 0f
    }

    private fun resolvePairs() {
        for (i in bodies.indices) {
            val a = bodies[i]
            for (j in i + 1 until bodies.size) {
                val b = bodies[j]
                if (a.held && b.held) continue
                // 넓은 단계: 두 알약의 외접원이 안 닿으면 건너뛴다.
                val dxc = b.x - a.x
                val dyc = b.y - a.y
                val reach = (a.halfW + a.halfH) + (b.halfW + b.halfH)
                if (dxc * dxc + dyc * dyc > reach * reach) continue

                for (ci in a.offsets.indices) {
                    val ax = a.circleX(ci)
                    val ay = a.circleY(ci)
                    for (cj in b.offsets.indices) {
                        val bx = b.circleX(cj)
                        val by = b.circleY(cj)
                        val dx = bx - ax
                        val dy = by - ay
                        val rsum = a.radius + b.radius
                        val d2 = dx * dx + dy * dy
                        if (d2 >= rsum * rsum || d2 < 1e-6f) continue

                        val dist = sqrt(d2)
                        val nx = dx / dist
                        val ny = dy / dist
                        val penetration = rsum - dist
                        val cx = ax + nx * (a.radius - penetration * 0.5f)
                        val cy = ay + ny * (a.radius - penetration * 0.5f)
                        solveContact(a, b, cx, cy, nx, ny, penetration)
                    }
                }
            }
        }
    }

    private fun resolveWalls() {
        bodies.forEach { b ->
            if (b.held) {
                // 잡고 있어도 통 밖으로는 못 나간다.
                b.x = b.x.coerceIn(b.halfW, (width - b.halfW).coerceAtLeast(b.halfW))
                b.y = b.y.coerceIn(b.halfH, (height - b.halfH).coerceAtLeast(b.halfH))
                return@forEach
            }
            for (i in b.offsets.indices) {
                val px = b.circleX(i)
                val py = b.circleY(i)
                // 법선은 통 안쪽을 향한다.
                wallContact(b, px, py, b.radius - px, 1f, 0f)
                wallContact(b, px, py, b.radius - (width - px), -1f, 0f)
                wallContact(b, px, py, b.radius - py, 0f, 1f)
                wallContact(b, px, py, b.radius - (height - py), 0f, -1f)
            }
        }
    }

    private fun wallContact(
        b: PileBody,
        px: Float,
        py: Float,
        penetration: Float,
        nx: Float,
        ny: Float,
    ) {
        if (penetration <= 0f) return
        val cx = px - nx * b.radius
        val cy = py - ny * b.radius
        solveContact(null, b, cx, cy, nx, ny, penetration)
    }

    /**
     * 접촉 하나를 푼다. [a] 가 null 이면 상대는 움직이지 않는 벽이다.
     * 법선 [nx],[ny] 는 a → b 방향(벽이면 통 안쪽 방향)이다.
     */
    private fun solveContact(
        a: PileBody?,
        b: PileBody,
        cx: Float,
        cy: Float,
        nx: Float,
        ny: Float,
        penetration: Float,
    ) {
        val invMassA = a?.invMass ?: 0f
        val invInertiaA = a?.invInertia ?: 0f
        val invMassB = b.invMass
        val invInertiaB = b.invInertia
        val invSum = invMassA + invMassB
        if (invSum <= 0f) return

        val rax = if (a != null) cx - a.x else 0f
        val ray = if (a != null) cy - a.y else 0f
        val rbx = cx - b.x
        val rby = cy - b.y

        // 접촉점에서의 상대 속도 (v + ω × r)
        val vaX = if (a != null) a.vx - a.av * ray else 0f
        val vaY = if (a != null) a.vy + a.av * rax else 0f
        val vbX = b.vx - b.av * rby
        val vbY = b.vy + b.av * rbx
        val rvX = vbX - vaX
        val rvY = vbY - vaY

        val velAlongNormal = rvX * nx + rvY * ny

        val raCrossN = rax * ny - ray * nx
        val rbCrossN = rbx * ny - rby * nx
        val kNormal = invSum +
            raCrossN * raCrossN * invInertiaA +
            rbCrossN * rbCrossN * invInertiaB
        if (kNormal <= 0f) return

        var jn = 0f
        if (velAlongNormal < 0f) {
            // 살짝만 부딪힐 때는 튀지 않게 반발을 죽인다(잔진동 방지).
            val e = if (-velAlongNormal < RESTITUTION_CUTOFF) 0f else RESTITUTION
            jn = -(1f + e) * velAlongNormal / kNormal
            applyImpulse(a, b, jn * nx, jn * ny, rax, ray, rbx, rby)

            if (-velAlongNormal > FLASH_SPEED) {
                a?.flash = 1f
                b.flash = 1f
            }
            a?.wake(); b.wake()
        }

        // 마찰 — 접선 방향, 쿨롱 한계 안에서
        if (jn > 0f) {
            val tx = -ny
            val ty = nx
            val vaX2 = if (a != null) a.vx - a.av * ray else 0f
            val vaY2 = if (a != null) a.vy + a.av * rax else 0f
            val rvtX = (b.vx - b.av * rby) - vaX2
            val rvtY = (b.vy + b.av * rbx) - vaY2
            val velAlongTangent = rvtX * tx + rvtY * ty

            val raCrossT = rax * ty - ray * tx
            val rbCrossT = rbx * ty - rby * tx
            val kTangent = invSum +
                raCrossT * raCrossT * invInertiaA +
                rbCrossT * rbCrossT * invInertiaB
            if (kTangent > 0f) {
                var jt = -velAlongTangent / kTangent
                val maxFriction = FRICTION * jn
                if (jt > maxFriction) jt = maxFriction
                if (jt < -maxFriction) jt = -maxFriction
                applyImpulse(a, b, jt * tx, jt * ty, rax, ray, rbx, rby)
            }
        }

        // 위치 보정 — 임펄스만으로는 남는 침투를 직접 밀어낸다.
        val correction = (penetration - SLOP).coerceAtLeast(0f) * POSITION_CORRECTION / invSum
        if (correction > 0f) {
            if (a != null) {
                a.x -= nx * correction * invMassA
                a.y -= ny * correction * invMassA
            }
            b.x += nx * correction * invMassB
            b.y += ny * correction * invMassB
        }
    }

    private fun applyImpulse(
        a: PileBody?,
        b: PileBody,
        ix: Float,
        iy: Float,
        rax: Float,
        ray: Float,
        rbx: Float,
        rby: Float,
    ) {
        if (a != null && !a.held) {
            a.vx -= ix * a.invMass
            a.vy -= iy * a.invMass
            a.av -= (rax * iy - ray * ix) * a.invInertia
            clampVelocity(a)
        }
        if (!b.held) {
            b.vx += ix * b.invMass
            b.vy += iy * b.invMass
            b.av += (rbx * iy - rby * ix) * b.invInertia
            clampVelocity(b)
        }
    }

    companion object {
        /** 화면 좌표 기준 기본 중력(px/s²). */
        const val GRAVITY = 2600f

        private const val RESTITUTION = 0.22f

        /** 이보다 느린 충돌은 튕기지 않는다 — 쌓인 칩이 계속 떠는 것을 막는다. */
        private const val RESTITUTION_CUTOFF = 140f
        private const val FRICTION = 0.45f
        private const val LINEAR_DAMPING = 0.994f
        private const val ANGULAR_DAMPING = 0.96f
        private const val POSITION_CORRECTION = 0.5f
        private const val SLOP = 0.6f
        private const val SOLVER_ITERATIONS = 7
        private const val MAX_STEP = 1f / 30f
        private const val MAX_SPEED = 6000f
        private const val MAX_SPIN = 26f
        private const val REST_SPEED = 14f
        private const val REST_SPIN = 0.18f
        private const val SLEEP_FRAMES = 24
        private const val FLASH_SPEED = 260f
    }
}
