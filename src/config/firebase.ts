// src/config/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// ※Firebaseコンソールで取得した設定値に書き換えてください
const firebaseConfig = {
    apiKey: "AIzaSyBWEOV0b-YqJEolBpxeX2JWWEOuV4tjXS4",
    authDomain: "kensyu10152.firebaseapp.com",
    projectId: "kensyu10152",
    storageBucket: "kensyu10152.firebasestorage.app",
    messagingSenderId: "1061813696329",
    appId: "1:1061813696329:web:47e282aae897abe7b2cc98",
    measurementId: "G-481G7HQNET"
    
  };

// Firebaseの初期化
const app = initializeApp(firebaseConfig);

// データベース（Firestore）と認証（Auth）の機能をエクスポート
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);