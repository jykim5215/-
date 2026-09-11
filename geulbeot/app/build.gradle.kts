plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "kr.geulbeot.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "kr.geulbeot.app"
        // Android 8.0. Below this the Storage Access Framework and the adaptive launcher icon
        // behave differently enough to need a second code path for very few devices.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // Korean only: the app exists to work with Korean documents and its UI follows
        // 한글's own wording. Shipping other locales would ship empty translations.
        resourceConfigurations += setOf("ko")
    }

    // Release signing is read from a properties file that is deliberately not in the repository.
    // Without it the release build is simply unsigned - no key material, real or placeholder, is
    // ever committed, because a key in the repository would let anyone sign a package that
    // replaces this app through its own update path.
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    val hasReleaseKey = keystorePropertiesFile.exists()

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                val properties = java.util.Properties()
                keystorePropertiesFile.inputStream().use { properties.load(it) }
                storeFile = rootProject.file(properties.getProperty("storeFile"))
                storePassword = properties.getProperty("storePassword")
                keyAlias = properties.getProperty("keyAlias")
                keyPassword = properties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseKey) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            // No applicationIdSuffix: the launcher shortcuts in res/xml name the package
            // explicitly, and a suffixed debug build would leave them pointing at nothing.
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    implementation(project(":core-hwp"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.documentfile)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.window)
    implementation(libs.androidx.compose.material.icons)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
