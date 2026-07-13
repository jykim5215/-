plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.audiobridge"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.audiobridge"
        minSdk = 26
        targetSdk = 35
        // CI가 -PversionCode=<run_number> -PversionName=1.0.<run_number>로 주입 (앱 내 업데이트 비교 기준)
        versionCode = (project.findProperty("versionCode") as? String)?.toIntOrNull() ?: 1
        versionName = (project.findProperty("versionName") as? String) ?: "1.0.0"
    }

    signingConfigs {
        // 기본: 사이드로딩 전용 공유 디버그 키(공개 저장소 포함, 비밀 아님).
        // 스토어 배포: CI 시크릿(RELEASE_KEYSTORE_B64 등)이 있으면 개인 릴리스 키로 서명 — STORE.md 참고.
        create("shared") {
            val envKeystore = System.getenv("RELEASE_KEYSTORE")
            if (envKeystore != null) {
                storeFile = file(envKeystore)
                storePassword = System.getenv("RELEASE_KEYSTORE_PASSWORD") ?: ""
                keyAlias = System.getenv("RELEASE_KEY_ALIAS") ?: "release"
                keyPassword = System.getenv("RELEASE_KEY_PASSWORD") ?: ""
            } else {
                storeFile = rootProject.file("signing/debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
