import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

/** 저장소 루트의 version.json 을 버전 단일 출처로 사용한다. */
val versionJson: Map<String, String> = run {
    val f = File(rootProject.projectDir.parentFile, "version.json")
    if (!f.exists()) mapOf("version" to "1.0.0", "versionCode" to "1")
    else {
        val text = f.readText()
        fun str(key: String) = Regex("\"$key\"\\s*:\\s*\"([^\"]*)\"").find(text)?.groupValues?.get(1)
        fun num(key: String) = Regex("\"$key\"\\s*:\\s*(\\d+)").find(text)?.groupValues?.get(1)
        mapOf(
            "version" to (str("version") ?: "1.0.0"),
            "versionCode" to (num("versionCode") ?: "1"),
        )
    }
}

android {
    namespace = "com.vocacard.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vocacard.app"
        minSdk = 26
        targetSdk = 35
        versionCode = versionJson.getValue("versionCode").toInt()
        versionName = versionJson.getValue("version")

        // 공개 저장소의 공개 API만 사용한다. 토큰/자격증명은 어디에도 포함하지 않는다.
        buildConfigField("String", "UPDATE_REPO", "\"jykim5215/-\"")

        vectorDrawables.useSupportLibrary = true
    }

    /*
     * 서명 정보는 **저장소에 두지 않는다.**
     * keystore 경로/비밀번호는 Gradle 프로퍼티(-P) 또는 환경 변수로만 주입하며,
     * 없으면 서명되지 않은 릴리즈로 빌드된다(로컬 개발용).
     */
    val keystorePath = (findProperty("VOCA_KEYSTORE") as String?)
        ?: System.getenv("VOCA_KEYSTORE")
    val hasKeystore = !keystorePath.isNullOrBlank() && File(keystorePath).exists()

    signingConfigs {
        if (hasKeystore) {
            create("release") {
                storeFile = File(keystorePath!!)
                storePassword = (findProperty("VOCA_KEYSTORE_PASSWORD") as String?)
                    ?: System.getenv("VOCA_KEYSTORE_PASSWORD")
                keyAlias = (findProperty("VOCA_KEY_ALIAS") as String?)
                    ?: System.getenv("VOCA_KEY_ALIAS") ?: "vocacard"
                keyPassword = (findProperty("VOCA_KEY_PASSWORD") as String?)
                    ?: System.getenv("VOCA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // 첫 릴리즈는 난독화를 끄고 안정성을 우선한다. 규칙은 proguard-rules.pro 에 준비되어 있다.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasKeystore) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
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
        buildConfig = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.navigation.compose)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.datastore.preferences)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
}
