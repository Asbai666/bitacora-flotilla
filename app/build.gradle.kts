plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "mx.ajm.bitacora"
    compileSdk = 35

    defaultConfig {
        applicationId = "mx.ajm.bitacora"
        minSdk = 26
        targetSdk = 35
        versionCode = 14
        versionName = "3.1"
    }

    signingConfigs {
        create("ajm") {
            storeFile = file("bitacora.keystore")
            storePassword = "bitacoraAJM"
            keyAlias = "bitacora"
            keyPassword = "bitacoraAJM"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("ajm")
        }
        debug {
            signingConfig = signingConfigs.getByName("ajm")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
}
