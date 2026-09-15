/* ==========================================================================
   VORTEX VIP - PLATAFORMA EM TEMPO REAL (FIRESTORE, RTDB, WEBRTC & STORIES)
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
    getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, 
    deleteDoc, addDoc, onSnapshot, query, where, orderBy, limit, writeBatch, arrayUnion, arrayRemove, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
    getDatabase, ref, set as rtdbSet, onValue, onDisconnect, serverTimestamp as rtdbTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Credenciais Oficiais Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCHxfX6jN5SiM5ahu3cS0Bo9q9BEYhOqqA",
  authDomain: "menssagem-dx.firebaseapp.com",
  databaseURL: "https://menssagem-dx-default-rtdb.firebaseio.com",
  projectId: "menssagem-dx",
  storageBucket: "menssagem-dx.firebasestorage.app",
  messagingSenderId: "107151991007",
  appId: "1:107151991007:web:d35d21ed4ca93429a4c96a",
  measurementId: "G-KB9V9Y79VF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

const rtcServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

if (window.lucide) {
    lucide.createIcons();
}

/* ==========================================================================
   ESTADO GLOBAL & VARIÁVEIS
   ========================================================================== */
let currentUser = null;
let currentProfile = {
    uid: '',
    name: 'Usuário',
    surname: '',
    username: '',
    status: 'Disponível no VORTEX ⚡',
    avatar: '',
    accentColor: '#fff01f',
    pin: '1234',
    pinEnabled: false,
    ghostMode: false,
    privacyMode: false,
    soundEnabled: true,
    themeEnabled: true,
    isVerified: true,
    pinnedChats: []
};

let pinnedChats = [];
let activeChatContact = null;
let managedGroup = null;
let pendingGroupAvatar = '';
let managedGroupUnsubscribe = null;
let activeStoryList = [];
let currentStoryIndex = 0;
let currentStoryAuthor = null;
let storyTimer = null;
let storyStartTime = 0;
let storyDuration = 5000;
let storyAnimFrame = null;
let isStoryPaused = false;
let storyPausedAt = 0;
let wasStoryMusicPlayingBeforePause = false;
let isHoldingStory = false;
let storyHoldTimer = null;
let storyPressStartTime = 0;
let storyPressStartX = 0;
let storyPressStartY = 0;
let wasStoryHoldAction = false;
let currentStoryDocUnsubscribe = null;
let storyMusicAudio = null;
let isStoryMusicMuted = false;

let currentChatUnsubscribe = null;
let contactsUnsubscribe = null;
let requestsUnsubscribe = null;
let storiesUnsubscribe = null;
let notificationsUnsubscribe = null;
let broadcastUnsubscribe = null;
let userNotifications = [];
let broadcastNotifications = [];
let allNotifications = [];
let currentNotifFilter = 'all';
let readNotifIds = new Set();
let deletedNotifIds = new Set();

try {
    const savedRead = typeof localStorage !== 'undefined' ? localStorage.getItem('vortex_read_notifs') : null;
    if (savedRead) readNotifIds = new Set(JSON.parse(savedRead));
    const savedDel = typeof localStorage !== 'undefined' ? localStorage.getItem('vortex_deleted_notifs') : null;
    if (savedDel) deletedNotifIds = new Set(JSON.parse(savedDel));
} catch (e) {}

function saveNotifStorage() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('vortex_read_notifs', JSON.stringify([...readNotifIds]));
            localStorage.setItem('vortex_deleted_notifs', JSON.stringify([...deletedNotifIds]));
        }
    } catch (e) {}
}
let contactStatusUnsubscribe = null;
let incomingCallUnsubscribe = null;
let activeCallDocUnsubscribe = null;
let callerCandidatesUnsubscribe = null;
let calleeCandidatesUnsubscribe = null;
let userContactsSet = new Set();
let blockedContactsSet = new Set();
let blockedUnsubscribe = null;
let blockedByContactUnsubscribe = null;
let isBlockedByActiveContact = false;

let isMultiSelectMode = false;
let selectedMessageIds = new Set();
let currentChatMessagesMap = new Map();
let replyingToMsg = null;
let editingMessage = null;
let activeSelectedMsg = null;
let activeSelectedMsgEl = null;

// Mensagens em Espera para Encaminhamento e Exclusão
let messageToForward = null;
let messageToDelete = null;

const groupMemberNamesCache = new Map();

function getGroupSenderColor(uid) {
    if (!uid) return '#00f3ff';
    const colors = [
        '#00f3ff', // Cyan
        '#ffb800', // Gold
        '#38bdf8', // Azul Claro
        '#a855f7', // Roxo
        '#4ade80', // Verde Neon
        '#f43f5e', // Rosa
        '#fb923c', // Laranja
        '#e879f9', // Magenta
        '#2dd4bf'  // Verde Água
    ];
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;
let activeAudioStream = null;
let isVoiceRecordingCanceled = false;
let isMicPointerDown = false;
let micPointerStartX = 0;
let micPointerStartY = 0;
let micPointerStartTime = 0;
let hasCanceledByDrag = false;
let wasHoldRecording = false;

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let callTimerInterval = null;
let callSeconds = 0;
let isCallMuted = false;
let currentFacingMode = 'user';
let vibrationInterval = null;
let hasUserInteracted = false;

const pinState = {
    currentPinInput: "",
    newPinInput: "",
    verifyPinInput: ""
};

let currentPlayingAudio = null;
let typingTimer = null;
let activityTimer = null;
let activeChatActivityUnsubscribe = null;
let activeContactActivity = null;
let activeContactActivityTimer = null;
let activeContactUserData = null;
const activityUnsubscribes = [];
const cardActivityTimers = new Map();
let groupCreationUnsubscribes = [];
let groupProfileMemberUnsubscribes = [];

export function cleanupGroupCreationListeners() {
    if (groupCreationUnsubscribes.length > 0) {
        groupCreationUnsubscribes.splice(0).forEach(unsub => {
            try { unsub(); } catch (_) {}
        });
    }
}

export function cleanupGroupProfileMemberListeners() {
    if (groupProfileMemberUnsubscribes.length > 0) {
        groupProfileMemberUnsubscribes.splice(0).forEach(unsub => {
            try { unsub(); } catch (_) {}
        });
    }
}

export function setAvatarContent(avatarEl, imageUrl, name, initialId) {
    if (!avatarEl) return;
    let initialEl = initialId ? document.getElementById(initialId) : avatarEl.querySelector('.avatar-initial');
    if (imageUrl) {
        avatarEl.style.backgroundImage = `url('${imageUrl}')`;
        if (initialEl) initialEl.innerText = '';
    } else {
        avatarEl.style.backgroundImage = '';
        const initial = (name || 'C').charAt(0).toUpperCase();
        if (!initialEl) {
            initialEl = document.createElement('span');
            initialEl.className = 'avatar-initial';
            if (initialId) initialEl.id = initialId;
            avatarEl.prepend(initialEl);
        }
        initialEl.innerText = initial;
    }
}

export function formatAudioTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(Number(seconds));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatMusicDuration(duration) {
    if (duration === null || duration === undefined || duration === '') return '0:30';
    let totalSecs;
    if (typeof duration === 'string' && duration.includes(':')) {
        const parts = duration.split(':').map(p => parseInt(p, 10));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            totalSecs = parts[0] * 60 + parts[1];
        } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            totalSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else {
            totalSecs = Math.round(Number(duration));
        }
    } else {
        totalSecs = Math.round(Number(duration));
    }
    if (isNaN(totalSecs) || totalSecs <= 0) return '0:30';
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
        return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function parseAudioDuration(dur) {
    if (!dur) return '';
    if (typeof dur === 'number') {
        return formatAudioTime(dur);
    }
    const str = String(dur).trim();
    const mmssMatch = str.match(/(\d+:\d{2})/);
    if (mmssMatch) {
        return mmssMatch[1];
    }
    const match = str.match(/\d+(\.\d+)?/);
    if (match) {
        const num = parseFloat(match[0]);
        if (!isNaN(num) && num > 0) {
            return formatAudioTime(num);
        }
    }
    return '';
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createActivityIndicatorHTML(activity = {}) {
    const icons = {
        typing: 'message-circle',
        recording: 'mic',
        audio: 'mic',
        image: 'image',
        video: 'video',
        music: 'music',
        file: 'file-text'
    };
    const labels = {
        typing: 'digitando',
        recording: 'gravando áudio',
        audio: 'enviando áudio',
        image: 'enviando imagem',
        video: 'enviando vídeo',
        music: 'enviando música',
        file: 'enviando arquivo'
    };
    const kind = activity.kind || 'typing';
    return `<span class="typing-indicator activity-indicator"><i data-lucide="${icons[kind] || 'loader'}"></i><span class="dot"></span><span class="dot"></span><span class="dot"></span> ${escapeHTML(activity.label || labels[kind] || 'processando')}</span>`;
}

const clickSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2357/2357-preview.mp3');
const unlockSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3');
const replySendSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
const ringtoneSound = new Audio('https://assets.mixkit.co/active_storage/sfx/1350/1350-preview.mp3');
ringtoneSound.loop = true;

const mediaSizeLimits = {
    image: { bytes: 700000, label: 'imagem' },
    video: { bytes: 650000, label: 'vídeo' },
    audio: { bytes: 700000, label: 'música ou áudio' },
    file: { bytes: 600000, label: 'arquivo' }
};

function getMediaSizeLimit(type) {
    return mediaSizeLimits[type] || mediaSizeLimits.file;
}

function showMediaSizeWarning(type) {
    const limit = getMediaSizeLimit(type);
    showToast('Arquivo muito grande', `O limite para ${limit.label} é ${(limit.bytes / 1000).toFixed(0)} KB.`, 'red');
}

window.addEventListener('pointerdown', () => { hasUserInteracted = true; }, { once: true, passive: true });
window.addEventListener('keydown', () => { hasUserInteracted = true; }, { once: true, passive: true });

function playSound(snd) {
    if (currentProfile.soundEnabled && snd) {
        snd.currentTime = 0;
        snd.play().catch(() => {});
    }
}

function showToast(title, message, type = 'blue') {
    let container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    const icon = type === 'red' ? 'alert-circle' : (type === 'green' ? 'check-circle' : 'info');
    toast.innerHTML = `
        <div class="toast-icon"><i data-lucide="${icon}"></i></div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <div class="toast-close"><i data-lucide="x"></i></div>
    `;
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) closeBtn.onclick = () => toast.remove();
    container.prepend(toast);
    if (window.lucide) lucide.createIcons();
    playSound(notificationSound);
    setTimeout(() => toast.remove(), 4500);
}

function startPhoneVibration() {
    if (hasUserInteracted && "vibrate" in navigator) {
        navigator.vibrate([600, 300, 600, 300, 600]);
        clearInterval(vibrationInterval);
        vibrationInterval = setInterval(() => {
            if ("vibrate" in navigator) navigator.vibrate([600, 300, 600, 300, 600]);
        }, 2400);
    }
}

function stopPhoneVibration() {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
    if (hasUserInteracted && "vibrate" in navigator) navigator.vibrate(0);
}

async function requestCallMedia() {
    try {
        return { stream: await navigator.mediaDevices.getUserMedia({ video: true, audio: true }), hasVideo: true };
    } catch (videoError) {
        console.warn('Câmera indisponível, tentando chamada somente com áudio:', videoError.name);
        try {
            return { stream: await navigator.mediaDevices.getUserMedia({ video: false, audio: true }), hasVideo: false };
        } catch (audioError) {
            throw videoError;
        }
    }
}

function formatLastSeen(timestamp) {
    if (!timestamp) return 'recentemente';
    const date = new Date(timestamp);
    const now = new Date();
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${String(hours).padStart(2, '0')}:${minutes}`;

    let period = '';
    if (hours >= 0 && hours < 6) period = 'da madrugada';
    else if (hours >= 6 && hours < 12) period = 'da manhã';
    else if (hours >= 12 && hours < 18) period = 'da tarde';
    else period = 'da noite';

    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return `hoje às ${timeStr} ${period}`;
    if (isYesterday) return `ontem às ${timeStr} ${period}`;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `em ${day}/${month} às ${timeStr} ${period}`;
}

function normalizeUsername(value) {
    return value.trim().replace(/^@+/, '').toLowerCase();
}

function isValidUsername(value) {
    return /^[a-zA-Z0-9_.]+$/.test(value) && value.length >= 3 && value.length <= 30;
}

function usernameValidationMessage(value) {
    if (!value) return 'O nome de usuário é obrigatório.';
    if (value.length < 3 || value.length > 30) return 'Use entre 3 e 30 caracteres.';
    if (!isValidUsername(value)) return 'Use apenas letras, números, ponto e sublinhado.';
    return '';
}

async function ensureUsernameReservation(profile) {
    const usernameKey = normalizeUsername(profile.username || '');
    if (!profile.uid || !isValidUsername(usernameKey)) return;

    const usernameRef = doc(db, 'usernames', usernameKey);
    await runTransaction(db, async (transaction) => {
        const usernameSnap = await transaction.get(usernameRef);
        if (!usernameSnap.exists()) {
            transaction.set(usernameRef, {
                uid: profile.uid,
                username: `@${usernameKey}`,
                updatedAt: Date.now()
            });
        }
    });
}

/* ==========================================================================
   AUTENTICAÇÃO COM GOOGLE & PRESENÇA
   ========================================================================== */
onAuthStateChanged(auth, async (user) => {
    const authScreen = document.getElementById('auth-screen');
    const lockScreen = document.getElementById('lock-screen');

    if (user) {
        currentUser = user;
        if (authScreen) authScreen.classList.add('unlocked');
        
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) {
            const rawEmailPrefix = user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') : 'user';
            const autoUsername = `@${rawEmailPrefix}_${Math.floor(1000 + Math.random() * 9000)}`;
            const nameParts = (user.displayName || 'Membro VIP').split(' ');

            currentProfile = {
                uid: user.uid,
                email: user.email || '',
                name: nameParts[0] || 'Membro',
                surname: nameParts.slice(1).join(' ') || '',
                username: autoUsername,
                status: 'Disponível no VORTEX ⚡',
                avatar: user.photoURL || '',
                accentColor: '#fff01f',
                pin: '1234',
                pinEnabled: false,
                ghostMode: false,
                privacyMode: false,
                soundEnabled: true,
                isVerified: true,
                online: true,
                lastSeen: Date.now(),
                pinnedChats: []
            };
            await setDoc(userDocRef, currentProfile);
        } else {
            currentProfile = { ...currentProfile, ...userSnap.data(), uid: user.uid };
        }

        pinnedChats = Array.isArray(currentProfile.pinnedChats) ? currentProfile.pinnedChats : [];
        applyUserTheme();
        updateProfileDOM();
        if (typeof updateChatPinUI === 'function') updateChatPinUI();
        if (typeof applyPinnedSortToChatList === 'function') applyPinnedSortToChatList();

        ensureUsernameReservation(currentProfile).catch((error) => {
            console.error('Erro ao reservar username inicial:', error);
        });

        setupPresence(user.uid);

        onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                currentProfile = { ...currentProfile, ...docSnap.data() };
                pinnedChats = Array.isArray(currentProfile.pinnedChats) ? currentProfile.pinnedChats : [];
                applyUserTheme();
                updateProfileDOM();
                checkBannedAccountState();
                updateAdminUIVisibility();
                if (typeof updateChatPinUI === 'function') updateChatPinUI();
                if (typeof applyPinnedSortToChatList === 'function') applyPinnedSortToChatList();
            }
        });

        if (currentProfile.pinEnabled && lockScreen) lockScreen.classList.remove('unlocked');
        checkBannedAccountState();
        updateAdminUIVisibility();

        listenToContacts();
        listenToBlockedContacts();
        listenToRequests();
        listenToStories();
        listenToIncomingCalls();
        listenToNotifications();
        listenToAdminReports();
        loadUserFavoriteTracks();
        showToast("Conectado", `Bem-vindo, ${currentProfile.name}!`, "green");
    } else {
        currentUser = null;
        loadUserFavoriteTracks();
        if (authScreen) authScreen.classList.remove('unlocked');
        detachListeners();
        updateAdminUIVisibility();
    }
});

export function updateNotificationsBadge() {
    const badge = document.getElementById('notifications-bell-badge');
    if (!badge) return;
    const unreadCount = allNotifications.filter(n => !n.read && !readNotifIds.has(n.id) && !deletedNotifIds.has(n.id)).length;
    badge.innerText = unreadCount;
    badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
}

export function combineAndRenderNotifications() {
    const mergedMap = new Map();
    [...userNotifications, ...broadcastNotifications].forEach(n => {
        if (!deletedNotifIds.has(n.id)) {
            mergedMap.set(n.id, n);
        }
    });
    allNotifications = Array.from(mergedMap.values());
    allNotifications.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    updateNotificationsBadge();
    renderNotifications();
}

export function listenToNotifications() {
    if (!currentUser) return;
    if (notificationsUnsubscribe) notificationsUnsubscribe();
    if (broadcastUnsubscribe) broadcastUnsubscribe();

    try {
        // 1. Notificações diretas para o usuário (ex: Selo VIP aprovado)
        const userQuery = query(collection(db, 'notifications'), where('toUid', '==', currentUser.uid), limit(25));
        notificationsUnsubscribe = onSnapshot(userQuery, (snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const notifId = change.doc.id;
                    if (!readNotifIds.has(notifId) && !deletedNotifIds.has(notifId)) {
                        const toastColor = data.type === 'vip' ? 'green' : (data.type === 'alert' ? 'red' : 'blue');
                        showToast(data.title || 'Notificação VIP', data.message || '', toastColor);
                        playSound(notificationSound);
                    }
                }
            });
            userNotifications = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            combineAndRenderNotifications();
        }, (error) => console.warn('Erro ao ouvir notificações do usuário:', error));

        // 2. Transmissões gerais da plataforma (toUid == 'all')
        const broadcastQuery = query(collection(db, 'notifications'), where('toUid', '==', 'all'), limit(25));
        broadcastUnsubscribe = onSnapshot(broadcastQuery, (snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const notifId = change.doc.id;
                    if (!readNotifIds.has(notifId) && !deletedNotifIds.has(notifId)) {
                        const toastColor = data.type === 'alert' ? 'red' : 'blue';
                        showToast(data.title || 'Aviso da Plataforma', data.message || '', toastColor);
                        playSound(notificationSound);
                    }
                }
            });
            broadcastNotifications = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            combineAndRenderNotifications();
        }, (error) => console.warn('Erro ao ouvir avisos e alertas gerais:', error));
    } catch (err) {
        console.warn('Falha ao inicializar listeners de notificações:', err);
    }
}

export function openNotificationsPanel() {
    playSound(clickSound);
    const panel = document.getElementById('notifications-panel');
    if (!panel) return;
    panel.classList.add('active');

    // Ao abrir a central de notificações, marca todas visíveis como lidas
    allNotifications.forEach(n => readNotifIds.add(n.id));
    saveNotifStorage();
    updateNotificationsBadge();
    renderNotifications();
}

export function closeNotificationsPanel() {
    playSound(clickSound);
    document.getElementById('notifications-panel')?.classList.remove('active');
}

export function clearAllNotifications() {
    allNotifications.forEach(n => {
        deletedNotifIds.add(n.id);
        readNotifIds.add(n.id);
    });
    saveNotifStorage();
    combineAndRenderNotifications();
    showToast("Notificações", "Todas as notificações foram limpas.", "blue");
}

export function renderNotifications() {
    const listEl = document.getElementById('notifications-list');
    if (!listEl) return;

    let filtered = allNotifications.filter(n => {
        if (deletedNotifIds.has(n.id)) return false;
        if (currentNotifFilter === 'vip') return n.type === 'vip';
        if (currentNotifFilter === 'warning') return n.type === 'warning';
        if (currentNotifFilter === 'alert') return n.type === 'alert';
        return true;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="bell-off" class="empty-state-icon"></i>
                <p>Nenhuma notificação no momento.</p>
                <small>Você receberá aqui avisos ⚠️, alertas da plataforma 🔴 e a aprovação do seu Selo VIP ⭐.</small>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    listEl.innerHTML = filtered.map(n => {
        const type = n.type || 'warning';
        const isVip = type === 'vip';
        const isAlert = type === 'alert';

        let typeClass = 'warning';
        let badgeText = 'AVISO ⚠️';
        let iconName = 'alert-triangle';

        if (isVip) {
            typeClass = 'vip';
            badgeText = 'SELO VIP ⭐';
            iconName = 'sparkles';
        } else if (isAlert) {
            typeClass = 'alert';
            badgeText = 'ALERTA 🔴';
            iconName = 'shield-alert';
        }

        const isUnread = !readNotifIds.has(n.id);
        const timeStr = n.createdAt ? formatLastSeen(n.createdAt) : 'Recentemente';

        return `
            <div class="notification-card card-${typeClass} ${isUnread ? 'unread' : ''}" data-id="${n.id}">
                <div class="notification-icon-box ${typeClass}">
                    <i data-lucide="${iconName}"></i>
                </div>
                <div class="notification-card-content">
                    <div class="notification-card-top">
                        <span class="notification-card-title">${escapeHTML(n.title || 'Notificação')}</span>
                        <span class="notification-badge ${typeClass}">${badgeText}</span>
                    </div>
                    <div class="notification-card-text">${escapeHTML(n.message || '')}</div>
                    <div class="notification-card-time">
                        <i data-lucide="clock" style="width:11px; height:11px;"></i> ${timeStr}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function setupPresence(uid) {
    const userDocRef = doc(db, 'users', uid);
    const myConnectionsRef = ref(rtdb, `presence/${uid}`);
    const connectedRef = ref(rtdb, '.info/connected');

    if (!currentProfile.ghostMode) {
        updateDoc(userDocRef, { online: true, lastSeen: Date.now() }).catch(() => {});
        rtdbSet(myConnectionsRef, { state: 'online', last_changed: Date.now() }).catch(() => {});
    }

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            rtdbSet(myConnectionsRef, { state: 'online', last_changed: rtdbTimestamp() });
            onDisconnect(myConnectionsRef).set({ state: 'offline', last_changed: rtdbTimestamp() });
            if (!currentProfile.ghostMode) {
                updateDoc(userDocRef, { online: true, lastSeen: Date.now() }).catch(() => {});
            }
        }
    });

    const setOffline = () => {
        if (!currentProfile.ghostMode && currentUser) {
            const ts = Date.now();
            rtdbSet(myConnectionsRef, { state: 'offline', last_changed: ts }).catch(() => {});
            updateDoc(userDocRef, { online: false, lastSeen: ts }).catch(() => {});
        }
    };

    const setOnline = () => {
        if (!currentProfile.ghostMode && currentUser) {
            const ts = Date.now();
            rtdbSet(myConnectionsRef, { state: 'online', last_changed: ts }).catch(() => {});
            updateDoc(userDocRef, { online: true, lastSeen: ts }).catch(() => {});
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') setOffline();
        else if (document.visibilityState === 'visible') setOnline();
    });

    window.addEventListener('pagehide', setOffline);
    window.addEventListener('beforeunload', setOffline);

    // Heartbeat de presença ativo a cada 45s enquanto a aba estiver visível
    setInterval(() => {
        if (!currentProfile.ghostMode && currentUser && document.visibilityState === 'visible') {
            updateDoc(userDocRef, { online: true, lastSeen: Date.now() }).catch(() => {});
            rtdbSet(myConnectionsRef, { state: 'online', last_changed: Date.now() }).catch(() => {});
        }
    }, 45000);
}

function applyPrivacyModeState() {
    const enabled = !!currentProfile.privacyMode;
    document.body.classList.toggle('privacy-mode', enabled);

    document.querySelectorAll('.message, .last-msg, .quoted-reply-box, .audio-player-ui, img, video, .file-attachment-card').forEach((el) => {
        if (el instanceof HTMLElement) {
            el.style.filter = enabled ? 'blur(8px)' : '';
            el.style.opacity = enabled ? '0.8' : '';
            el.style.transition = 'filter 0.2s ease, opacity 0.2s ease';
        }
    });

    document.querySelectorAll('.message:hover, .message:hover *, .message:hover .last-msg').forEach((el) => {
        if (el instanceof HTMLElement) {
            el.style.filter = '';
            el.style.opacity = '1';
        }
    });
}

export function getVipSubscriptionState(user) {
    if (!user) return { status: 'none', isVip: false, daysRemaining: 0, graceDaysRemaining: 0 };
    const email = (user.email || '').toLowerCase().trim();
    const username = (user.username || '').toLowerCase().trim().replace(/^@/, '');
    const name = (user.name || '').trim();
    if (email === 'dxhub.oficial@gmail.com' || username === 'dxhuboficial' || user.role === 'admin' || name.includes('DX Hub')) {
        return { status: 'active', isVip: true, daysRemaining: 9999, graceDaysRemaining: 0 };
    }

    // Suporte flexível a diferentes formatos de data de expiração (Timestamp Firestore, Date, ISO string, número)
    let expiresAt = 0;
    if (user.vipExpiresAt) {
        if (typeof user.vipExpiresAt.toMillis === 'function') {
            expiresAt = user.vipExpiresAt.toMillis();
        } else if (typeof user.vipExpiresAt.toDate === 'function') {
            expiresAt = user.vipExpiresAt.toDate().getTime();
        } else if (user.vipExpiresAt.seconds) {
            expiresAt = user.vipExpiresAt.seconds * 1000;
        } else if (typeof user.vipExpiresAt === 'string') {
            expiresAt = isNaN(Number(user.vipExpiresAt)) ? new Date(user.vipExpiresAt).getTime() : Number(user.vipExpiresAt);
        } else {
            expiresAt = Number(user.vipExpiresAt) || 0;
        }
    }

    if (user.isVip === false && user.isVerified === false && !expiresAt) {
        return { status: 'none', isVip: false, daysRemaining: 0, graceDaysRemaining: 0 };
    }

    // Se for VIP manual/admin ou assinatura sem prazo de validade definido (vitalício/teste/aprovado)
    if ((user.isVip || user.isVerified || user.vipStatus === 'active' || user.vipRequestStatus === 'approved') && !expiresAt) {
        return { status: 'active', isVip: true, daysRemaining: 9999, graceDaysRemaining: 0 };
    }

    const now = Date.now();
    const graceMs = 7 * 24 * 60 * 60 * 1000; // 7 dias de tolerância
    const graceExpiresAt = expiresAt + graceMs;

    if (now < expiresAt) {
        const daysRemaining = Math.max(1, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
        return { status: 'active', isVip: true, daysRemaining, graceDaysRemaining: 0 };
    } else if (now <= graceExpiresAt) {
        const graceDaysRemaining = Math.max(0, Math.ceil((graceExpiresAt - now) / (24 * 60 * 60 * 1000)));
        return { status: 'grace_period', isVip: true, daysRemaining: 0, graceDaysRemaining };
    } else {
        return { status: 'expired', isVip: false, daysRemaining: 0, graceDaysRemaining: 0 };
    }
}

export function checkIsVipUser(user) {
    if (!user) return false;
    const sub = getVipSubscriptionState(user);
    return sub.isVip;
}

export function checkVipSubscriptionLifecycle() {
    if (!currentUser || !currentProfile) return;
    const sub = getVipSubscriptionState(currentProfile);
    const banner = document.getElementById('vip-grace-banner');
    const daysLeftEl = document.getElementById('vip-grace-days-left');

    if (sub.status === 'grace_period') {
        if (banner) {
            banner.style.display = 'flex';
            if (daysLeftEl) {
                daysLeftEl.innerText = `${sub.graceDaysRemaining} ${sub.graceDaysRemaining === 1 ? 'dia' : 'dias'}`;
            }
        }
    } else {
        if (banner) banner.style.display = 'none';
    }

    // Se a assinatura expirou após os 7 dias de tolerância
    if (sub.status === 'expired' && (currentProfile.isVip || currentProfile.isVerified || currentProfile.vipStatus !== 'expired')) {
        currentProfile.isVip = false;
        currentProfile.isVerified = false;
        currentProfile.vipStatus = 'expired';

        if (currentUser && currentUser.uid) {
            updateDoc(doc(db, 'users', currentUser.uid), {
                isVip: false,
                isVerified: false,
                vipStatus: 'expired'
            }).catch(() => {});
        }

        const userBadge = document.getElementById('user-verified-badge');
        if (userBadge) userBadge.style.display = 'none';

        const subscribeBtn = document.getElementById('subscribe-btn');
        if (subscribeBtn) {
            subscribeBtn.innerText = 'Assinar';
            subscribeBtn.className = 'danger-btn vip-action-btn';
        }

        showToast('Assinatura Expirada', 'Seu período de tolerância de 7 dias terminou. O Selo VIP foi removido.', 'orange');
    }
}

function applyUserTheme() {
    document.documentElement.style.setProperty('--accent-color', currentProfile.accentColor || '#fff01f');
    applyPrivacyModeState();
    document.body.classList.toggle('total-black', currentProfile.themeEnabled === false);
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.color === currentProfile.accentColor);
    });
    const soundTog = document.getElementById('sound-toggle');
    const ghostTog = document.getElementById('ghost-toggle');
    const privTog = document.getElementById('privacy-toggle');
    const pinTog = document.getElementById('pin-toggle');
    const themeTog = document.getElementById('theme-toggle');
    const subscribeBtn = document.getElementById('subscribe-btn');
    if (soundTog) soundTog.checked = !!currentProfile.soundEnabled;
    if (ghostTog) ghostTog.checked = !!currentProfile.ghostMode;
    if (privTog) privTog.checked = !!currentProfile.privacyMode;
    if (pinTog) pinTog.checked = !!currentProfile.pinEnabled;
    if (themeTog) themeTog.checked = currentProfile.themeEnabled !== false;
    if (subscribeBtn) {
        const sub = getVipSubscriptionState(currentProfile);
        if (sub.status === 'active') {
            subscribeBtn.innerText = sub.daysRemaining < 9000 ? `Assinado (${sub.daysRemaining}d) ⭐` : 'Assinado ⭐';
            subscribeBtn.className = 'danger-btn vip-action-btn active';
        } else if (sub.status === 'grace_period') {
            subscribeBtn.innerText = `Renovar (${sub.graceDaysRemaining}d) ⚠️`;
            subscribeBtn.className = 'danger-btn vip-action-btn pending';
        } else if (currentProfile.vipRequestStatus === 'pending') {
            subscribeBtn.innerText = 'Em análise ⏳';
            subscribeBtn.className = 'danger-btn vip-action-btn pending';
        } else {
            subscribeBtn.innerText = 'Assinar';
            subscribeBtn.className = 'danger-btn vip-action-btn';
        }
    }
    checkVipSubscriptionLifecycle();
}

function updateProfileDOM() {
    const nameEl = document.getElementById('user-display-name');
    const avatarEl = document.getElementById('user-avatar-display');
    const editPreview = document.getElementById('profile-edit-avatar-preview');
    const userBadge = document.getElementById('user-verified-badge');
    const subscribeBtn = document.getElementById('subscribe-btn');

    if (nameEl) nameEl.innerText = `${currentProfile.name} ${currentProfile.surname}`.trim();
    if (avatarEl) avatarEl.style.backgroundImage = currentProfile.avatar ? `url('${currentProfile.avatar}')` : '';
    if (editPreview) editPreview.style.backgroundImage = currentProfile.avatar ? `url('${currentProfile.avatar}')` : '';

    const isVip = checkIsVipUser(currentProfile);
    const sub = getVipSubscriptionState(currentProfile);

    if (userBadge) {
        userBadge.style.display = isVip ? 'inline-block' : 'none';
        userBadge.classList.toggle('active', isVip);
    }
    if (window.lucide) lucide.createIcons();
    if (subscribeBtn) {
        if (sub.status === 'active') {
            subscribeBtn.innerText = sub.daysRemaining < 9000 ? `Assinado (${sub.daysRemaining}d) ⭐` : 'Assinado ⭐';
            subscribeBtn.className = 'danger-btn vip-action-btn active';
        } else if (sub.status === 'grace_period') {
            subscribeBtn.innerText = `Renovar (${sub.graceDaysRemaining}d) ⚠️`;
            subscribeBtn.className = 'danger-btn vip-action-btn pending';
        } else if (currentProfile.vipRequestStatus === 'pending') {
            subscribeBtn.innerText = 'Em análise ⏳';
            subscribeBtn.className = 'danger-btn vip-action-btn pending';
        } else {
            subscribeBtn.innerText = 'Assinar';
            subscribeBtn.className = 'danger-btn vip-action-btn';
        }
    }
    checkVipSubscriptionLifecycle();
}

function detachListeners() {
    if (currentChatUnsubscribe) currentChatUnsubscribe();
    if (contactsUnsubscribe) contactsUnsubscribe();
    if (requestsUnsubscribe) requestsUnsubscribe();
    if (storiesUnsubscribe) storiesUnsubscribe();
    if (notificationsUnsubscribe) notificationsUnsubscribe();
    if (broadcastUnsubscribe) broadcastUnsubscribe();
    if (contactStatusUnsubscribe) contactStatusUnsubscribe();
    if (incomingCallUnsubscribe) incomingCallUnsubscribe();
    if (activeCallDocUnsubscribe) activeCallDocUnsubscribe();
    if (callerCandidatesUnsubscribe) callerCandidatesUnsubscribe();
    if (calleeCandidatesUnsubscribe) calleeCandidatesUnsubscribe();
    if (currentStoryDocUnsubscribe) currentStoryDocUnsubscribe();
    if (managedGroupUnsubscribe) managedGroupUnsubscribe();
    if (blockedUnsubscribe) blockedUnsubscribe();
    if (adminReportsUnsubscribe) adminReportsUnsubscribe();
    if (adminVipRequestsUnsubscribe) adminVipRequestsUnsubscribe();
}

/* ==========================================================================
   SISTEMA DE PIN E SEGURANÇA
   ========================================================================== */
function updatePinDots(containerId, input) {
    const dots = document.querySelectorAll(`#${containerId} .pin-dot`);
    dots.forEach((dot, i) => dot.classList.toggle('filled', i < input.length));
}

export function triggerNeonUnlock() {
    const neonAnim = document.getElementById('neon-unlock-anim');
    if (neonAnim) {
        neonAnim.classList.remove('active');
        void neonAnim.offsetWidth;
        neonAnim.classList.add('active');
        setTimeout(() => neonAnim.classList.remove('active'), 1200);
    }
}

export function unlockApp() {
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) lockScreen.classList.add('unlocked');
    playSound(unlockSound);
    pinState.currentPinInput = "";
    updatePinDots('pin-dots', "");
    triggerNeonUnlock();
    if (typeof initBackNavigation === 'function') initBackNavigation();
}

export function unlockWithBiometrics() {
    const lockScreen = document.getElementById('lock-screen');
    if (!lockScreen || lockScreen.classList.contains('unlocked')) return;
    if ("vibrate" in navigator) navigator.vibrate([40, 50, 40]);
    unlockApp();
    showToast("Biometria VIP", "Acesso liberado por biometria!", "green");
}

export function enterDigit(digit) {
    playSound(clickSound);
    if (pinState.currentPinInput.length < 4) {
        pinState.currentPinInput += digit;
        updatePinDots('pin-dots', pinState.currentPinInput);
        if (pinState.currentPinInput.length === 4) {
            if (pinState.currentPinInput === (currentProfile.pin || '1234')) {
                unlockApp();
            } else {
                showToast("Segurança", "PIN incorreto!", "red");
                pinState.currentPinInput = "";
                updatePinDots('pin-dots', "");
            }
        }
    }
}

export function clearPin() {
    playSound(clickSound);
    pinState.currentPinInput = pinState.currentPinInput.slice(0, -1);
    updatePinDots('pin-dots', pinState.currentPinInput);
}

export function enterSetPinDigit(digit) {
    playSound(clickSound);
    const setPinOverlay = document.getElementById('set-pin-overlay');
    if (pinState.newPinInput.length < 4) {
        pinState.newPinInput += digit;
        updatePinDots('set-pin-dots', pinState.newPinInput);
        if (pinState.newPinInput.length === 4) {
            currentProfile.pin = pinState.newPinInput;
            currentProfile.pinEnabled = true;
            if (currentUser) {
                updateDoc(doc(db, 'users', currentUser.uid), { pin: currentProfile.pin, pinEnabled: true });
            }
            if (setPinOverlay) setPinOverlay.classList.add('unlocked');
            pinState.newPinInput = "";
            updatePinDots('set-pin-dots', "");
            showToast("Segurança", "Novo PIN salvo com sucesso!", "green");
        }
    }
}

export function clearSetPin() {
    playSound(clickSound);
    pinState.newPinInput = pinState.newPinInput.slice(0, -1);
    updatePinDots('set-pin-dots', pinState.newPinInput);
}

export function closeSetPin() {
    playSound(clickSound);
    document.getElementById('set-pin-overlay')?.classList.add('unlocked');
    pinState.newPinInput = "";
    updatePinDots('set-pin-dots', "");
}

window.enterDigit = enterDigit;
window.clearPin = clearPin;
window.enterSetPinDigit = enterSetPinDigit;
window.clearSetPin = clearSetPin;
window.closeSetPin = closeSetPin;
window.unlockApp = unlockApp;
window.unlockWithBiometrics = unlockWithBiometrics;
window.triggerNeonUnlock = triggerNeonUnlock;

// Event delegation para teclado de DESBLOQUEIO (lock-screen)
document.addEventListener('click', (e) => {
    if (e.target.closest('#lock-screen .key')) {
        const keyEl = e.target.closest('#lock-screen .key');
        const keyValue = keyEl.dataset.key;
        if (keyValue === 'clear') {
            clearPin();
        } else if (keyValue) {
            enterDigit(keyValue);
        } else if (keyEl.id === 'biometric-btn') {
            unlockWithBiometrics();
        }
    }
    // Event delegation para teclado de PIN (set-pin-overlay)
    else if (e.target.closest('#set-pin-overlay .key')) {
        const keyEl = e.target.closest('#set-pin-overlay .key');
        const keyValue = keyEl.dataset.key;
        if (keyValue === 'clear') {
            clearSetPin();
        } else if (keyValue) {
            enterSetPinDigit(keyValue);
        }
    }
});

/* ==========================================================================
   STORIES ENGINE EM TEMPO REAL (GRAVAÇÃO, REAÇÃO & GAVETA AO VIVO)
   ========================================================================== */
export function canUserViewStory(story, viewerUid, authorContactsSet = null) {
    if (!story || !viewerUid) return false;
    // O próprio autor sempre pode ver seus stories
    if (story.authorUid === viewerUid) return true;

    // Se o autor estiver bloqueado pelo visualizador, não exibe
    if (typeof blockedContactsSet !== 'undefined' && blockedContactsSet.has(story.authorUid)) {
        return false;
    }

    // Verificar se o autor do story é um contato aceito pelo visualizador
    const contacts = authorContactsSet || (typeof userContactsSet !== 'undefined' ? userContactsSet : null);
    if (contacts && contacts.has(story.authorUid)) {
        return true;
    }

    // Se o story possui lista explícita de contatos autorizados (gravada pelo autor)
    if (Array.isArray(story.allowedUids)) {
        return story.allowedUids.includes(viewerUid);
    }

    return false;
}

if (typeof window !== 'undefined') {
    window.canUserViewStory = canUserViewStory;
}

function listenToStories() {
    const storiesRef = collection(db, 'stories');
    const validTime = Date.now() - 24 * 60 * 60 * 1000;
    const q = query(storiesRef, where('createdAt', '>=', validTime), orderBy('createdAt', 'desc'));

    storiesUnsubscribe = onSnapshot(q, async (snapshot) => {
        const dynamicContainer = document.getElementById('dynamic-stories-list');
        if (!dynamicContainer) return;
        dynamicContainer.innerHTML = '';

        const userStoriesMap = {};
        snapshot.forEach(d => {
            const data = { id: d.id, ...d.data() };
            if (!userStoriesMap[data.authorUid]) userStoriesMap[data.authorUid] = [];
            userStoriesMap[data.authorUid].push(data);
        });

        // Configuração do próprio status (o usuário SEMPRE vê os seus próprios stories)
        const myStoryList = currentUser ? userStoriesMap[currentUser.uid] : null;
        const myStoryCard = document.getElementById('user-story-card');
        if (myStoryCard) {
            const ring = myStoryCard.querySelector('.story-ring');
            if (ring) {
                ring.classList.toggle('active', !!myStoryList && myStoryList.length > 0);
            }
            myStoryCard.onclick = () => {
                if (myStoryList && myStoryList.length > 0) {
                    openStoryViewer(myStoryList, myStoryList[0]);
                } else {
                    openStatusCreator();
                }
            };
        }

        if (!currentUser) return;

        // Manter conjunto de contatos aceitos sempre atualizado
        try {
            const cSnap = await getDocs(collection(db, 'users', currentUser.uid, 'contacts'));
            cSnap.forEach(d => userContactsSet.add(d.id));
        } catch (e) {
            console.warn('Erro ao carregar contatos para stories:', e);
        }

        Object.keys(userStoriesMap).forEach(uid => {
            if (currentUser && uid === currentUser.uid) return;

            const list = userStoriesMap[uid];
            // Filtrar apenas stories que o currentUser tem permissão para ver (apenas contatos aceitos)
            const visibleStories = list.filter(story => canUserViewStory(story, currentUser.uid, userContactsSet));
            if (!visibleStories.length) return;

            const author = visibleStories[0];

            const item = document.createElement('div');
            item.className = 'story-item';
            item.innerHTML = `
                <div class="story-ring active">
                    <div class="avatar" style="background-image: url('${author.authorAvatar || ''}');" role="img"></div>
                </div>
                <span>${author.authorName}</span>
            `;

            item.onclick = () => openStoryViewer(visibleStories, author);
            dynamicContainer.appendChild(item);
        });
    });
}

function openStoryViewer(stories, author, options = {}) {
    if (currentFeedMusicAudio) {
        try { currentFeedMusicAudio.pause(); } catch (e) {}
        if (currentFeedMusicPostId) updateFeedMusicUI(currentFeedMusicPostId, false);
        currentFeedMusicAudio = null;
        currentFeedMusicPostId = null;
    }

    const isPreview = !!(options && options.isPreview);
    isStoryPreviewMode = isPreview;

    const authorUid = author ? (author.authorUid || author.uid || '') : '';
    const isMyStory = !isPreview && currentUser && authorUid === currentUser.uid;
    const allowedStories = isPreview 
        ? (Array.isArray(stories) ? stories : [stories]) 
        : (isMyStory ? stories : (Array.isArray(stories) ? stories.filter(s => canUserViewStory(s, currentUser?.uid, userContactsSet)) : []));
    if (!allowedStories.length) {
        showToast("Privado", "Este status é visível apenas para contatos aceitos.", "red");
        return;
    }

    activeStoryList = allowedStories;
    currentStoryIndex = 0;
    currentStoryAuthor = author;

    const viewer = document.getElementById('story-viewer');
    const usernameEl = document.getElementById('story-username');
    const avatarEl = document.getElementById('story-viewer-avatar');
    const deleteBtn = document.getElementById('delete-story-btn');
    const reportStoryBtn = document.getElementById('report-story-btn');
    const downloadStoryBtn = document.getElementById('download-story-btn');
    const previewIndicator = document.getElementById('story-preview-indicator');
    const ownFooter = document.getElementById('own-story-footer');
    const otherFooter = document.getElementById('other-story-footer');
    const previewFooter = document.getElementById('story-preview-footer');

    if (usernameEl) usernameEl.innerText = author?.authorName || currentProfile?.name || 'Você';
    if (avatarEl) avatarEl.style.backgroundImage = (author?.authorAvatar || currentProfile?.avatar) ? `url('${author?.authorAvatar || currentProfile?.avatar}')` : '';

    const storyBadge = document.getElementById('story-verified-badge');
    if (storyBadge) {
        const isAuthorVip = isPreview 
            ? checkIsVipUser(currentProfile) 
            : (isMyStory ? checkIsVipUser(currentProfile) : checkIsVipUser(author));
        storyBadge.style.display = isAuthorVip ? 'inline-block' : 'none';
        storyBadge.classList.toggle('active', isAuthorVip);
        if (!isPreview && !isMyStory && author?.authorUid) {
            getDoc(doc(db, 'users', author.authorUid)).then(snap => {
                if (snap.exists()) {
                    const freshVip = checkIsVipUser(snap.data());
                    if (storyBadge) {
                        storyBadge.style.display = freshVip ? 'inline-block' : 'none';
                        storyBadge.classList.toggle('active', freshVip);
                    }
                }
            }).catch(() => {});
        }
    }
    
    if (isPreview) {
        if (previewIndicator) previewIndicator.style.display = 'inline-flex';
        if (previewFooter) previewFooter.style.display = 'flex';
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (reportStoryBtn) reportStoryBtn.style.display = 'none';
        if (downloadStoryBtn) downloadStoryBtn.style.display = 'none';
        if (ownFooter) ownFooter.style.display = 'none';
        if (otherFooter) otherFooter.style.display = 'none';
    } else {
        if (previewIndicator) previewIndicator.style.display = 'none';
        if (previewFooter) previewFooter.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = isMyStory ? 'flex' : 'none';
        if (reportStoryBtn) reportStoryBtn.style.display = isMyStory ? 'none' : 'flex';
        if (downloadStoryBtn) downloadStoryBtn.style.display = 'flex';
        if (ownFooter) ownFooter.style.display = isMyStory ? 'flex' : 'none';
        if (otherFooter) otherFooter.style.display = isMyStory ? 'none' : 'flex';
    }

    closeViewersSheet();
    renderStoryProgressSegments();
    displayCurrentStory();
    if (viewer) viewer.classList.add('active');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function closeStoryViewer() {
    clearTimeout(storyTimer);
    cancelAnimationFrame(storyAnimFrame);
    clearTimeout(storyHoldTimer);
    storyHoldTimer = null;
    isHoldingStory = false;
    isStoryPaused = false;
    storyPausedAt = 0;
    wasStoryHoldAction = false;
    wasStoryMusicPlayingBeforePause = false;
    if (currentStoryDocUnsubscribe) currentStoryDocUnsubscribe();
    
    if (storyMusicAudio) {
        try { storyMusicAudio.pause(); } catch (e) {}
        storyMusicAudio = null;
    }
    const musicBadge = document.getElementById('story-music-badge');
    if (musicBadge) musicBadge.style.display = 'none';

    const contentDiv = document.querySelector('#story-current-face .story-content');
    if (contentDiv) {
        const video = contentDiv.querySelector('video');
        if (video && typeof video.pause === 'function') video.pause();
        contentDiv.innerHTML = '';
    }

    closeViewersSheet();
    document.getElementById('story-viewer')?.classList.remove('active', 'story-paused', 'story-holding');
    const replyInput = document.getElementById('story-reply-input');
    if (replyInput) replyInput.value = '';
    const previewIndicator = document.getElementById('story-preview-indicator');
    if (previewIndicator) previewIndicator.style.display = 'none';
    const previewFooter = document.getElementById('story-preview-footer');
    if (previewFooter) previewFooter.style.display = 'none';
    isStoryPreviewMode = false;
}

function renderStoryProgressSegments() {
    const container = document.getElementById('story-progress-container');
    if (!container) return;
    container.innerHTML = activeStoryList.map((_, i) => `
        <div class="story-progress-segment">
            <div class="story-progress-fill" id="story-fill-${i}"></div>
        </div>
    `).join('');
}

async function displayCurrentStory() {
    clearTimeout(storyTimer);
    cancelAnimationFrame(storyAnimFrame);
    clearTimeout(storyHoldTimer);
    storyHoldTimer = null;
    isHoldingStory = false;
    isStoryPaused = false;
    storyPausedAt = 0;
    wasStoryHoldAction = false;
    wasStoryMusicPlayingBeforePause = false;
    document.getElementById('story-viewer')?.classList.remove('story-paused', 'story-holding');
    if (currentStoryDocUnsubscribe) currentStoryDocUnsubscribe();

    const story = activeStoryList[currentStoryIndex];
    if (!story) {
        closeStoryViewer();
        return;
    }

    // Registra visualização imediata no documento do Story (Firestore) - exceto em modo prévia
    if (currentUser && !story.isPreview && story.id) {
        const storyRef = doc(db, 'stories', story.id);
        const viewData = {
            uid: currentUser.uid,
            name: currentProfile.name || 'Contato',
            surname: currentProfile.surname || '',
            avatar: currentProfile.avatar || '',
            username: currentProfile.username || '@usuario',
            viewedAt: Date.now()
        };
        setDoc(storyRef, {
            views: {
                [currentUser.uid]: viewData
            }
        }, { merge: true }).catch((err) => console.error("Erro ao registrar visualização:", err));
    }

    // Escuta em tempo real este Story específico - exceto em modo prévia
    if (!story.isPreview && story.id) {
        const storyDocRef = doc(db, 'stories', story.id);
        currentStoryDocUnsubscribe = onSnapshot(storyDocRef, (snap) => {
            if (snap.exists()) {
                const updatedData = { id: snap.id, ...snap.data() };
                activeStoryList[currentStoryIndex] = updatedData;
                updateStoryViewersUI(updatedData);
            }
        });
    }

    const contentDiv = document.querySelector('#story-current-face .story-content');
    const captionEl = document.getElementById('story-caption');

    activeStoryList.forEach((_, i) => {
        const fill = document.getElementById(`story-fill-${i}`);
        if (fill) {
            if (i < currentStoryIndex) {
                fill.className = 'story-progress-fill completed';
                fill.style.width = '100%';
            } else if (i > currentStoryIndex) {
                fill.className = 'story-progress-fill';
                fill.style.width = '0%';
            } else {
                fill.className = 'story-progress-fill';
                fill.style.width = '0%';
            }
        }
    });

    if (captionEl) {
        captionEl.innerText = story.caption || '';
        captionEl.classList.toggle('active', !!story.caption);
    }

    storyStartTime = Date.now();
    storyDuration = 5000;

    let mediaSrc = story.src;
    if ((story.hasChunks || !mediaSrc) && story.id && !story.isPreview) {
        if (!mediaSrc) {
            contentDiv.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#fff;font-size:14px;"><i data-lucide="loader-2" class="spin" style="width:32px;height:32px;margin-bottom:8px;"></i><span>Carregando mídia...</span></div>';
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        }
        mediaSrc = await loadMediaWithChunks('stories', story.id, story.src);
        story.src = mediaSrc;
    }

    if (story.type === 'video' && story.isTrimmed && mediaSrc && typeof mediaSrc === 'string' && !mediaSrc.includes('#t=')) {
        mediaSrc = `${mediaSrc}#t=0,15`;
    }

    // Prefetch próximo story se houver
    const nextStory = activeStoryList[currentStoryIndex + 1];
    if (nextStory && (nextStory.hasChunks || !nextStory.src) && nextStory.id && !nextStory.isPreview) {
        loadMediaWithChunks('stories', nextStory.id, nextStory.src).then(res => { if (res) nextStory.src = res; }).catch(() => {});
    }

    if (story.type === 'video') {
        contentDiv.innerHTML = `<video src="${mediaSrc}" autoplay playsinline style="width:100%;height:100%;object-fit:contain;"></video>`;
        const video = contentDiv.querySelector('video');
        video.onloadedmetadata = () => {
            const rawDur = (video.duration && !isNaN(video.duration)) ? video.duration * 1000 : 5000;
            storyDuration = story.isTrimmed ? Math.min(rawDur, 15000) : rawDur;
            startProgressBarAnimation();
        };
        video.ontimeupdate = () => {
            if (story.isTrimmed && video.currentTime >= 15.0) {
                goToNextStory();
            }
        };
        video.onended = () => goToNextStory();
    } else {
        contentDiv.innerHTML = `<img src="${mediaSrc}" alt="Story" style="width:100%;height:100%;object-fit:contain;">`;
        startProgressBarAnimation();
    }

    // Reprodução de Trilha Sonora / Música do Story
    const musicBadge = document.getElementById('story-music-badge');
    const musicTitle = document.getElementById('story-music-title');
    const musicArtist = document.getElementById('story-music-artist');

    if (storyMusicAudio) {
        try { storyMusicAudio.pause(); } catch (e) {}
        storyMusicAudio = null;
    }

    if (story.music && story.music.audioUrl) {
        if (musicBadge) musicBadge.style.display = 'flex';
        if (musicTitle) musicTitle.innerText = story.music.title || 'Música';
        if (musicArtist) musicArtist.innerText = story.music.artist ? `• ${story.music.artist}` : '';

        try {
            storyMusicAudio = new Audio(story.music.audioUrl);
            storyMusicAudio.loop = true;
            storyMusicAudio.muted = isStoryMusicMuted;
            const playPromise = storyMusicAudio.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => console.warn("Autoplay da música do status bloqueado:", err));
            }
        } catch (err) {
            console.warn("Erro ao iniciar áudio da música:", err);
        }
    } else {
        if (musicBadge) musicBadge.style.display = 'none';
    }
}

function updateStoryViewersUI(storyData) {
    const views = storyData.views || {};
    const reactions = storyData.reactions || {};
    const replies = storyData.replies || [];

    const totalViews = Object.keys(views).length;
    const viewsCountText = document.getElementById('story-views-count-text');
    const totalViewsText = document.getElementById('sheet-total-views-text');

    if (viewsCountText) viewsCountText.innerText = `${totalViews} visualizaç${totalViews === 1 ? 'ão' : 'ões'}`;
    if (totalViewsText) totalViewsText.innerText = `${totalViews} visualizaç${totalViews === 1 ? 'ão' : 'ões'}`;

    const pillViews = document.getElementById('pill-views-count');
    const pillReactions = document.getElementById('pill-reactions-count');
    const pillReplies = document.getElementById('pill-replies-count');

    if (pillViews) pillViews.innerText = totalViews;
    if (pillReactions) pillReactions.innerText = Object.keys(reactions).length;
    if (pillReplies) pillReplies.innerText = replies.length;

    const sheet = document.getElementById('story-viewers-sheet');
    if (sheet && sheet.classList.contains('active')) {
        const activeTab = sheet.querySelector('.tab-pill-btn.active')?.dataset.tab || 'views';
        renderViewersSheetTab(activeTab, storyData);
    }
}

export function pauseCurrentStory() {
    if (isStoryPaused) return;
    isStoryPaused = true;
    storyPausedAt = Date.now();

    const contentDiv = document.querySelector('#story-current-face .story-content');
    const video = contentDiv?.querySelector('video');
    if (video && typeof video.pause === 'function' && !video.paused) {
        try { video.pause(); } catch (e) {}
    }

    if (storyMusicAudio && !storyMusicAudio.paused) {
        try { storyMusicAudio.pause(); } catch (e) {}
        wasStoryMusicPlayingBeforePause = true;
    }

    document.getElementById('story-viewer')?.classList.add('story-paused');
}

export function resumeCurrentStory() {
    if (!isStoryPaused) return;

    if (storyPausedAt > 0) {
        const pauseDuration = Date.now() - storyPausedAt;
        storyStartTime += pauseDuration;
        storyPausedAt = 0;
    }

    isStoryPaused = false;

    const contentDiv = document.querySelector('#story-current-face .story-content');
    const video = contentDiv?.querySelector('video');
    if (video && typeof video.play === 'function' && video.paused) {
        try {
            const p = video.play();
            if (p !== undefined) p.catch(e => console.warn('Erro ao retomar vídeo do story:', e));
        } catch (e) {}
    }

    if (storyMusicAudio && wasStoryMusicPlayingBeforePause) {
        try {
            const p = storyMusicAudio.play();
            if (p !== undefined) p.catch(e => console.warn('Erro ao retomar música do story:', e));
        } catch (e) {}
        wasStoryMusicPlayingBeforePause = false;
    }

    const viewer = document.getElementById('story-viewer');
    if (viewer) {
        viewer.classList.remove('story-paused');
        viewer.classList.remove('story-holding');
    }
}

function handleStoryPointerDown(e) {
    if (e && e.button && e.button !== 0) return;
    if (e && e.target && e.target.closest && e.target.closest('#close-story, #download-story-btn, #report-story-btn, #delete-story-btn, #story-views-pill-btn, .story-emoji-btn, #send-reply-btn, #story-reply-input, #story-music-mute-btn, #story-preview-footer, #story-preview-back-btn, #story-preview-publish-now-btn')) {
        return;
    }

    isHoldingStory = true;
    wasStoryHoldAction = false;
    storyPressStartTime = (e && typeof e.timeStamp === 'number' && e.timeStamp > 0) ? e.timeStamp : Date.now();
    storyPressStartX = (e && e.clientX !== undefined) ? e.clientX : 0;
    storyPressStartY = (e && e.clientY !== undefined) ? e.clientY : 0;

    pauseCurrentStory();

    clearTimeout(storyHoldTimer);
    storyHoldTimer = setTimeout(() => {
        if (isHoldingStory) {
            document.getElementById('story-viewer')?.classList.add('story-holding');
        }
    }, 150);
}

function handleStoryPointerUp(e) {
    if (!isHoldingStory) return;
    isHoldingStory = false;
    clearTimeout(storyHoldTimer);
    storyHoldTimer = null;

    const currentTime = (e && typeof e.timeStamp === 'number' && e.timeStamp > 0) ? e.timeStamp : Date.now();
    const pressDuration = currentTime - storyPressStartTime;
    const clientX = (e && e.clientX !== undefined) ? e.clientX : storyPressStartX;
    const clientY = (e && e.clientY !== undefined) ? e.clientY : storyPressStartY;
    const dist = Math.hypot(clientX - storyPressStartX, clientY - storyPressStartY);

    if (pressDuration >= 200 || dist >= 20) {
        wasStoryHoldAction = true;
    }

    resumeCurrentStory();
}

function handleStoryPointerCancel() {
    if (!isHoldingStory) return;
    isHoldingStory = false;
    clearTimeout(storyHoldTimer);
    storyHoldTimer = null;
    wasStoryHoldAction = true;
    resumeCurrentStory();
}

function startProgressBarAnimation() {
    const currentFill = document.getElementById(`story-fill-${currentStoryIndex}`);
    storyStartTime = Date.now();
    storyPausedAt = 0;

    function updateProgress() {
        if (isStoryPaused) {
            storyAnimFrame = requestAnimationFrame(updateProgress);
            return;
        }

        const contentDiv = document.querySelector('#story-current-face .story-content');
        const video = contentDiv?.querySelector('video');
        let progress = 0;
        let isFinished = false;

        if (video && video.duration && !isNaN(video.duration)) {
            progress = Math.min((video.currentTime / video.duration) * 100, 100);
            isFinished = video.ended || (video.currentTime >= video.duration);
        } else {
            const elapsed = Date.now() - storyStartTime;
            progress = Math.min((elapsed / storyDuration) * 100, 100);
            isFinished = elapsed >= storyDuration;
        }

        if (currentFill) currentFill.style.width = `${progress}%`;

        if (!isFinished) {
            storyAnimFrame = requestAnimationFrame(updateProgress);
        } else {
            goToNextStory();
        }
    }

    storyAnimFrame = requestAnimationFrame(updateProgress);
}

function goToNextStory() {
    cancelAnimationFrame(storyAnimFrame);
    if (currentStoryIndex < activeStoryList.length - 1) {
        currentStoryIndex++;
        displayCurrentStory();
    } else {
        closeStoryViewer();
    }
}

function goToPrevStory() {
    cancelAnimationFrame(storyAnimFrame);
    if (currentStoryIndex > 0) {
        currentStoryIndex--;
        displayCurrentStory();
    } else {
        displayCurrentStory();
    }
}

document.getElementById('story-prev')?.addEventListener('click', (e) => {
    if (wasStoryHoldAction) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        wasStoryHoldAction = false;
        return;
    }
    goToPrevStory();
});

document.getElementById('story-next')?.addEventListener('click', (e) => {
    if (wasStoryHoldAction) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        wasStoryHoldAction = false;
        return;
    }
    goToNextStory();
});

document.getElementById('close-story')?.addEventListener('click', closeStoryViewer);

const storyNavEl = document.querySelector('.story-nav');
if (storyNavEl) {
    storyNavEl.addEventListener('pointerdown', handleStoryPointerDown);
    storyNavEl.addEventListener('pointerup', handleStoryPointerUp);
    storyNavEl.addEventListener('pointercancel', handleStoryPointerCancel);
}

window.addEventListener('pointerup', (e) => {
    if (isHoldingStory) {
        handleStoryPointerUp(e);
    }
});

window.addEventListener('pointercancel', () => {
    if (isHoldingStory) {
        handleStoryPointerCancel();
    }
});

document.getElementById('story-viewer')?.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.closest && e.target.closest('.story-nav, .story-cube, .story-cube-container, .story-content, video, img')) {
        e.preventDefault();
    }
});

document.getElementById('download-story-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const story = activeStoryList[currentStoryIndex];
    if (!story || !story.src) return;

    const link = document.createElement('a');
    link.href = story.src;
    link.download = `vortex-story-${Date.now()}.${story.type === 'video' ? 'mp4' : 'jpg'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Download", "Mídia salva no dispositivo!", "green");
});

document.getElementById('report-story-btn')?.addEventListener('click', (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!activeStoryList || !activeStoryList.length) return;
    const story = activeStoryList[currentStoryIndex];
    if (!story) return;
    pauseCurrentStory();
    openReportModal({
        type: 'story',
        storyId: story.id || story.createdAt,
        targetUid: currentStoryAuthor?.authorUid || story.authorUid,
        targetName: currentStoryAuthor?.authorName || story.authorName || 'Autor do Story',
        contentSnippet: story.caption || (story.type === 'video' ? 'Vídeo no Story' : 'Foto no Story')
    });
});

document.getElementById('delete-story-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteCurrentStory();
});

document.getElementById('sheet-delete-story-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteCurrentStory();
});

async function deleteCurrentStory() {
    const story = activeStoryList[currentStoryIndex];
    if (!story || story.authorUid !== currentUser.uid) return;

    if (confirm("Deseja realmente apagar este status?")) {
        await deleteDoc(doc(db, 'stories', story.id));
        getDocs(collection(db, 'stories', story.id, 'chunks')).then(snap => {
            if (snap && snap.docs) snap.docs.forEach(d => deleteDoc(d.ref).catch(() => {}));
        }).catch(() => {});
        mediaChunkCache.delete(`stories_${story.id}`);
        showToast("Status", "Status excluído com sucesso.", "blue");
        closeStoryViewer();
    }
}

// Janela Deslizante de Visualizadores (Estilo WhatsApp)
function openViewersSheet() {
    pauseCurrentStory();
    const sheet = document.getElementById('story-viewers-sheet');
    const story = activeStoryList[currentStoryIndex];
    if (sheet && story) {
        sheet.classList.add('active');
        renderViewersSheetTab('views', story);
        playSound(clickSound);
    }
}

function closeViewersSheet() {
    resumeCurrentStory();
    const sheet = document.getElementById('story-viewers-sheet');
    if (sheet) sheet.classList.remove('active');
}

document.getElementById('story-views-pill-btn')?.addEventListener('click', openViewersSheet);
document.getElementById('close-viewers-sheet-btn')?.addEventListener('click', closeViewersSheet);

document.querySelectorAll('.tab-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        const story = activeStoryList[currentStoryIndex];
        if (story) renderViewersSheetTab(tab, story);
        playSound(clickSound);
    });
});

function renderViewersSheetTab(tab, story) {
    const listEl = document.getElementById('viewers-sheet-list');
    if (!listEl) return;

    if (tab === 'views') {
        const views = story.views || {};
        const entries = Object.values(views).sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0));
        if (entries.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 35px 15px; color: var(--text-dim);">
                    <i data-lucide="eye-off" style="width: 40px; height: 40px; margin-bottom: 8px;"></i>
                    <p style="font-size: 0.9rem; color: #fff; font-weight: 600;">Nenhuma visualização ainda</p>
                    <small>Quando seus contatos visualizarem este status, eles aparecerão aqui ao vivo.</small>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        listEl.innerHTML = entries.map(v => {
            const timeStr = v.viewedAt ? formatLastSeen(v.viewedAt) : 'Visualizado recentemente';
            return `
                <div class="viewer-row-item">
                    <div class="viewer-user-box">
                        <div class="avatar sm" style="background-image: url('${v.avatar || ''}');"></div>
                        <div class="viewer-user-names">
                            <span class="viewer-name-text">${v.name} ${v.surname || ''}</span>
                            <span class="viewer-handle-text">${v.username || '@usuario'}</span>
                        </div>
                    </div>
                    <span class="viewer-time-text">${timeStr}</span>
                </div>
            `;
        }).join('');

    } else if (tab === 'reactions') {
        const reactions = story.reactions || {};
        const entries = Object.values(reactions).sort((a, b) => (b.reactedAt || 0) - (a.reactedAt || 0));
        if (entries.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 35px 15px; color: var(--text-dim);">
                    <i data-lucide="smile" style="width: 40px; height: 40px; margin-bottom: 8px;"></i>
                    <p style="font-size: 0.9rem; color: #fff; font-weight: 600;">Nenhuma reação ainda</p>
                    <small>As reações com emojis enviadas ao seu status aparecerão aqui em tempo real.</small>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        listEl.innerHTML = entries.map(r => `
            <div class="viewer-row-item">
                <div class="viewer-user-box">
                    <div class="avatar sm" style="background-image: url('${r.avatar || ''}');"></div>
                    <div class="viewer-user-names">
                        <span class="viewer-name-text">${r.name}</span>
                        <span class="viewer-handle-text">${r.reactedAt ? formatLastSeen(r.reactedAt) : 'Reagiu'}</span>
                    </div>
                </div>
                <span class="viewer-emoji-tag">${r.emoji}</span>
            </div>
        `).join('');

    } else if (tab === 'replies') {
        const replies = (story.replies || []).slice().reverse();
        if (replies.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 35px 15px; color: var(--text-dim);">
                    <i data-lucide="message-circle-dashed" style="width: 40px; height: 40px; margin-bottom: 8px;"></i>
                    <p style="font-size: 0.9rem; color: #fff; font-weight: 600;">Nenhuma mensagem de resposta</p>
                    <small>Comentários enviados a este status aparecerão nesta aba em tempo real.</small>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        listEl.innerHTML = replies.map(rep => `
            <div class="viewer-row-item">
                <div class="viewer-user-box">
                    <div class="avatar sm" style="background-image: url('${rep.senderAvatar || ''}');"></div>
                    <div class="viewer-user-names">
                        <span class="viewer-name-text">${rep.senderName}</span>
                        <span class="viewer-handle-text">${rep.createdAt ? formatLastSeen(rep.createdAt) : ''}</span>
                    </div>
                </div>
                <div class="viewer-msg-tag">"${rep.text}"</div>
            </div>
        `).join('');
    }

    if (window.lucide) lucide.createIcons();
}

// Resposta ao Story (Exclusivamente para a janelinha do Story)
async function sendStoryReply(text) {
    if (!text || !currentUser) return;
    const story = activeStoryList[currentStoryIndex];
    if (!story) return;

    const cleanText = text.trim().slice(0, 20);
    const storyRef = doc(db, 'stories', story.id);

    const replyItem = {
        id: 'rep_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        senderUid: currentUser.uid,
        senderName: currentProfile.name || 'Contato',
        senderAvatar: currentProfile.avatar || '',
        text: cleanText,
        createdAt: Date.now()
    };

    try {
        const storySnap = await getDoc(storyRef);
        let currentReplies = [];
        if (storySnap.exists() && storySnap.data().replies) {
            currentReplies = storySnap.data().replies;
        }
        currentReplies.push(replyItem);
        await setDoc(storyRef, { replies: currentReplies }, { merge: true });

        playSound(replySendSound);
        showToast("Comentário Enviado", "Mensagem adicionada ao status!", "green");
        const input = document.getElementById('story-reply-input');
        if (input) input.value = '';
    } catch (err) {
        console.error("Erro ao enviar resposta do story:", err);
        showToast("Erro", "Não foi possível enviar a resposta.", "red");
    }
}

document.getElementById('send-reply-btn')?.addEventListener('click', () => {
    const input = document.getElementById('story-reply-input');
    if (input && input.value.trim()) {
        sendStoryReply(input.value);
    }
});

document.getElementById('story-reply-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const input = document.getElementById('story-reply-input');
        if (input && input.value.trim()) {
            sendStoryReply(input.value);
        }
    }
});

// Reação com Emojis (Exclusivamente para a aba Reações do Story)
document.querySelectorAll('.story-emoji-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoji = btn.dataset.emoji;
        const story = activeStoryList[currentStoryIndex];
        
        if (story && currentUser) {
            const storyRef = doc(db, 'stories', story.id);
            const reactionData = {
                uid: currentUser.uid,
                emoji: emoji,
                name: currentProfile.name || 'Contato',
                avatar: currentProfile.avatar || '',
                reactedAt: Date.now()
            };
            setDoc(storyRef, {
                reactions: {
                    [currentUser.uid]: reactionData
                }
            }, { merge: true })
            .then(() => {
                playSound(replySendSound);
                showToast("Reação Enviada", `Reagiu com ${emoji}!`, "green");
            })
            .catch((err) => console.error("Erro ao registrar reação:", err));
        }
    });
});

// Abertura do Painel de Postar Status
function openStatusCreator() {
    playSound(clickSound);
    document.getElementById('post-status-overlay')?.classList.add('active');
}

document.getElementById('open-post-status')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openStatusCreator();
});

document.getElementById('close-post-status')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('post-status-overlay')?.classList.remove('active');
});

const statusFileInput = document.getElementById('status-file-input');
let pendingStatusFile = null;
let pendingStatusFileSrc = null;
let pendingStatusMediaInfo = null;
let pendingStatusCompressedData = null;
let isStoryPreviewMode = false;

/* ==========================================================================
   SISTEMA DE ARMAZENAMENTO E PARTICIONAMENTO DE MÍDIA (FIRESTORE CHUNKS)
   Evita o erro estrito do Firestore: "The value of property is longer than 1048487 bytes"
   Mídias > 700KB são divididas em chunks de 500KB salvos em subcoleção "chunks"
   ========================================================================== */
export const mediaChunkCache = new Map();
export const MAX_DIRECT_PAYLOAD_CHARS = 700000;
export const MEDIA_CHUNK_SIZE = 500000;

export async function saveMediaWithChunks(collectionName, docData, mediaFieldName, mediaPayload) {
    if (!mediaPayload || typeof mediaPayload !== 'string' || mediaPayload.length <= MAX_DIRECT_PAYLOAD_CHARS) {
        const fullDoc = {
            ...docData,
            [mediaFieldName]: mediaPayload || null,
            hasChunks: false
        };
        const docRef = await addDoc(collection(db, collectionName), fullDoc);
        if (mediaPayload && docRef && docRef.id) {
            mediaChunkCache.set(`${collectionName}_${docRef.id}`, mediaPayload);
        }
        return docRef;
    }

    // O payload excede o limite do documento Firestore (~1 MB).
    // Fatiar em pedaços de 500.000 caracteres gravados na subcoleção 'chunks'.
    const chunks = [];
    for (let i = 0; i < mediaPayload.length; i += MEDIA_CHUNK_SIZE) {
        chunks.push(mediaPayload.slice(i, i + MEDIA_CHUNK_SIZE));
    }

    const mainDoc = {
        ...docData,
        [mediaFieldName]: null,
        hasChunks: true,
        totalChunks: chunks.length,
        chunkSize: MEDIA_CHUNK_SIZE
    };

    const docRef = await addDoc(collection(db, collectionName), mainDoc);

    // Gravar os chunks na subcoleção em lotes de até 400
    const BATCH_LIMIT = 400;
    for (let b = 0; b < chunks.length; b += BATCH_LIMIT) {
        const batch = writeBatch(db);
        const chunkBatch = chunks.slice(b, b + BATCH_LIMIT);
        for (let i = 0; i < chunkBatch.length; i++) {
            const index = b + i;
            const chunkDocRef = doc(db, collectionName, docRef.id, 'chunks', String(index));
            batch.set(chunkDocRef, {
                index: index,
                part: chunkBatch[i],
                createdAt: Date.now()
            });
        }
        await batch.commit();
    }

    mediaChunkCache.set(`${collectionName}_${docRef.id}`, mediaPayload);
    return docRef;
}

export async function loadMediaWithChunks(collectionName, docId, fallbackSrc = '') {
    if (!docId) return fallbackSrc || '';
    const cacheKey = `${collectionName}_${docId}`;
    if (mediaChunkCache.has(cacheKey)) {
        return mediaChunkCache.get(cacheKey);
    }
    if (fallbackSrc && typeof fallbackSrc === 'string' && fallbackSrc.length > 50 && !fallbackSrc.startsWith('blob:mock')) {
        return fallbackSrc;
    }

    try {
        const chunksSnap = await getDocs(collection(db, collectionName, docId, 'chunks'));
        if (chunksSnap && !chunksSnap.empty) {
            const list = [];
            chunksSnap.forEach(d => {
                const data = typeof d.data === 'function' ? d.data() : (d || {});
                list.push({
                    index: typeof data.index === 'number' ? data.index : 0,
                    part: data.part || ''
                });
            });
            list.sort((a, b) => a.index - b.index);
            const fullPayload = list.map(item => item.part).join('');
            if (fullPayload) {
                mediaChunkCache.set(cacheKey, fullPayload);
                return fullPayload;
            }
        }
    } catch (err) {
        console.warn(`[loadMediaWithChunks] Erro ao carregar chunks para ${collectionName}/${docId}:`, err);
    }

    return fallbackSrc || '';
}

export function formatBytesToKB(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 KB';
    const kb = Math.round(bytes / 1024);
    return `${kb > 0 ? kb : 1} KB`;
}

export function formatDurationSeconds(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export async function compressImageFileToKB(file, options = {}) {
    if (!file) return null;
    const maxDimension = options.maxDimension || 1280;
    const targetMaxKB = options.targetMaxKB || 500;
    const initialQuality = options.quality || 0.8;

    return new Promise((resolve) => {
        const FR = (typeof window !== 'undefined' && window.FileReader) ? window.FileReader : (typeof FileReader !== 'undefined' ? FileReader : null);
        if (!FR) {
            const rawBytes = file.size || 102400;
            return resolve({
                dataUrl: 'data:image/jpeg;base64,mockpreview',
                sizeBytes: rawBytes,
                sizeKB: Math.round(rawBytes / 1024),
                sizeFormatted: formatBytesToKB(rawBytes),
                width: 800,
                height: 600,
                isCompressed: false
            });
        }

        const reader = new FR();
        reader.onload = (e) => {
            const dataUrl = e?.target?.result || reader.result;
            if (!dataUrl || typeof dataUrl !== 'string') {
                const rawBytes = file.size || 102400;
                return resolve({
                    dataUrl: 'data:image/jpeg;base64,mockpreview',
                    sizeBytes: rawBytes,
                    sizeKB: Math.round(rawBytes / 1024),
                    sizeFormatted: formatBytesToKB(rawBytes),
                    width: 800,
                    height: 600,
                    isCompressed: false
                });
            }

            const ImageConstructor = (typeof window !== 'undefined' && window.Image) ? window.Image : (typeof Image !== 'undefined' ? Image : null);
            if (!ImageConstructor || typeof document === 'undefined' || typeof document.createElement !== 'function') {
                const approxBytes = Math.round((dataUrl.length * 3) / 4);
                return resolve({
                    dataUrl: dataUrl,
                    sizeBytes: approxBytes,
                    sizeKB: Math.round(approxBytes / 1024),
                    sizeFormatted: formatBytesToKB(approxBytes),
                    width: 1280,
                    height: 720,
                    isCompressed: true
                });
            }

            const img = new ImageConstructor();
            img.onload = () => {
                try {
                    let width = img.width || 800;
                    let height = img.height || 600;

                    if (width > maxDimension || height > maxDimension) {
                        if (width > height) {
                            height = Math.round((height * maxDimension) / width);
                            width = maxDimension;
                        } else {
                            width = Math.round((width * maxDimension) / height);
                            height = maxDimension;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext ? canvas.getContext('2d') : null;

                    if (!ctx || typeof canvas.toDataURL !== 'function') {
                        const approxBytes = Math.round((dataUrl.length * 3) / 4);
                        return resolve({
                            dataUrl: dataUrl,
                            sizeBytes: approxBytes,
                            sizeKB: Math.round(approxBytes / 1024),
                            sizeFormatted: formatBytesToKB(approxBytes),
                            width: width,
                            height: height,
                            isCompressed: true
                        });
                    }

                    ctx.drawImage(img, 0, 0, width, height);

                    let compressedDataUrl = canvas.toDataURL('image/jpeg', initialQuality);
                    let approxBytes = Math.round((compressedDataUrl.length * 3) / 4);

                    if (approxBytes > targetMaxKB * 1024) {
                        compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
                        approxBytes = Math.round((compressedDataUrl.length * 3) / 4);
                    }

                    resolve({
                        dataUrl: compressedDataUrl,
                        sizeBytes: approxBytes,
                        sizeKB: Math.round(approxBytes / 1024),
                        sizeFormatted: formatBytesToKB(approxBytes),
                        width: width,
                        height: height,
                        isCompressed: true
                    });
                } catch (err) {
                    const approxBytes = Math.round((dataUrl.length * 3) / 4);
                    resolve({
                        dataUrl: dataUrl,
                        sizeBytes: approxBytes,
                        sizeKB: Math.round(approxBytes / 1024),
                        sizeFormatted: formatBytesToKB(approxBytes),
                        width: 800,
                        height: 600,
                        isCompressed: false
                    });
                }
            };
            img.onerror = () => {
                const approxBytes = Math.round((dataUrl.length * 3) / 4);
                resolve({
                    dataUrl: dataUrl,
                    sizeBytes: approxBytes,
                    sizeKB: Math.round(approxBytes / 1024),
                    sizeFormatted: formatBytesToKB(approxBytes),
                    width: 800,
                    height: 600,
                    isCompressed: false
                });
            };
            img.src = dataUrl;
        };
        reader.onerror = () => {
            const rawBytes = file.size || 102400;
            resolve({
                dataUrl: 'data:image/jpeg;base64,mockpreview',
                sizeBytes: rawBytes,
                sizeKB: Math.round(rawBytes / 1024),
                sizeFormatted: formatBytesToKB(rawBytes),
                width: 800,
                height: 600,
                isCompressed: false
            });
        };
        reader.readAsDataURL(file);
    });
}

export async function trimAndCompressVideoToKB(file, options = {}) {
    if (!file) return null;
    const isStory = !!options.isStory;
    const maxDuration = isStory ? 15 : (options.maxDuration || 120);
    const cutThreshold = isStory ? 15 : (options.cutThreshold || 180);

    return new Promise((resolve) => {
        let objectUrl = null;
        try {
            const urlObj = (typeof window !== 'undefined' && window.URL) ? window.URL : (typeof URL !== 'undefined' ? URL : null);
            if (urlObj && typeof urlObj.createObjectURL === 'function') {
                objectUrl = urlObj.createObjectURL(file);
            }
        } catch (e) {}

        const finalizeWithDuration = (rawDuration) => {
            const originalDuration = Number(file.originalDuration || rawDuration) || 0;
            let finalDuration = originalDuration;
            let isTrimmed = !!file.isTrimmed;

            if (isStory) {
                if (originalDuration > 15.0 || isTrimmed) {
                    finalDuration = 15;
                    isTrimmed = true;
                } else if (originalDuration <= 0) {
                    finalDuration = 15;
                }
            } else {
                if (originalDuration > cutThreshold || isTrimmed) {
                    finalDuration = maxDuration; // 120s
                    isTrimmed = true;
                }
            }

            const originalSizeBytes = file.size || 1048576;
            let effectiveBytes = originalSizeBytes;
            if (isTrimmed && originalDuration > 0 && finalDuration < originalDuration) {
                effectiveBytes = Math.round(originalSizeBytes * (finalDuration / originalDuration));
            }
            const sizeKB = Math.max(1, Math.round(effectiveBytes / 1024));
            const sizeFormatted = `${sizeKB} KB`;

            let trimmedSrc = objectUrl || 'blob:mockvideo';
            if (isTrimmed && typeof trimmedSrc === 'string' && !trimmedSrc.includes('#t=')) {
                trimmedSrc = `${trimmedSrc}#t=0,${finalDuration}`;
            }

            resolve({
                type: 'video',
                file,
                src: trimmedSrc,
                originalDuration,
                duration: finalDuration,
                durationFormatted: formatDurationSeconds(finalDuration),
                sizeBytes: effectiveBytes,
                sizeKB,
                sizeFormatted,
                isTrimmed,
                trimmedTo: finalDuration
            });
        };

        if (typeof file.originalDuration === 'number' && file.originalDuration > 0) {
            return finalizeWithDuration(file.originalDuration);
        }

        if (typeof file.duration === 'number' && file.duration > 0) {
            return finalizeWithDuration(file.duration);
        }

        if (typeof document !== 'undefined' && typeof document.createElement === 'function' && objectUrl) {
            try {
                const videoEl = document.createElement('video');
                videoEl.preload = 'metadata';
                let resolved = false;

                const cleanup = () => {
                    if (videoEl) {
                        videoEl.onloadedmetadata = null;
                        videoEl.onerror = null;
                    }
                };

                videoEl.onloadedmetadata = () => {
                    if (resolved) return;
                    resolved = true;
                    cleanup();
                    finalizeWithDuration(videoEl.duration);
                };

                videoEl.onerror = () => {
                    if (resolved) return;
                    resolved = true;
                    cleanup();
                    finalizeWithDuration(file.originalDuration || file.duration || (isStory ? 15 : 60));
                };

                setTimeout(() => {
                    if (resolved) return;
                    resolved = true;
                    cleanup();
                    finalizeWithDuration(file.originalDuration || file.duration || (isStory ? 15 : 60));
                }, 1500);

                videoEl.src = objectUrl;
                return;
            } catch (err) {
                return finalizeWithDuration(file.originalDuration || file.duration || (isStory ? 15 : 60));
            }
        }

        finalizeWithDuration(file.originalDuration || file.duration || (isStory ? 15 : 60));
    });
}

function setPendingStatusMedia(file, type) {
    if (!file) {
        removeSelectedStatusMedia();
        return;
    }
    pendingStatusFile = file;
    const isVideo = (type === 'video') || (file.type && file.type.startsWith('video'));
    
    // Libera URL anterior se for blob
    try {
        const urlObj = (typeof window !== 'undefined' && window.URL) ? window.URL : (typeof URL !== 'undefined' ? URL : null);
        if (pendingStatusFileSrc && typeof pendingStatusFileSrc === 'string' && pendingStatusFileSrc.startsWith('blob:')) {
            if (urlObj && typeof urlObj.revokeObjectURL === 'function') {
                urlObj.revokeObjectURL(pendingStatusFileSrc);
            }
        }
        if (urlObj && typeof urlObj.createObjectURL === 'function') {
            pendingStatusFileSrc = urlObj.createObjectURL(file);
        }
    } catch (e) {
        pendingStatusFileSrc = null;
    }

    // Informação de mídia síncrona inicial
    const rawBytes = file.size || 102400;
    const isVideoTrimmed = isVideo && (
        file.isTrimmed === true ||
        (typeof file.originalDuration === 'number' && file.originalDuration > 15.0) ||
        (typeof file.duration === 'number' && file.duration > 15.0)
    );
    const initialSizeKB = formatBytesToKB(rawBytes);
    pendingStatusMediaInfo = {
        type: isVideo ? 'video' : 'image',
        sizeBytes: rawBytes,
        sizeFormatted: initialSizeKB,
        isTrimmed: isVideoTrimmed,
        duration: isVideoTrimmed ? 15 : (file.duration || (isVideo ? 15 : 0))
    };

    if (isVideoTrimmed && pendingStatusFileSrc && !pendingStatusFileSrc.includes('#t=')) {
        pendingStatusFileSrc = `${pendingStatusFileSrc}#t=0,15`;
    }

    if (!pendingStatusFileSrc) {
        const FR = (typeof window !== 'undefined' && window.FileReader) ? window.FileReader : (typeof FileReader !== 'undefined' ? FileReader : null);
        if (FR) {
            try {
                const reader = new FR();
                reader.onload = (ev) => {
                    pendingStatusFileSrc = ev?.target?.result || reader.result || 'data:image/jpeg;base64,mockpreview';
                    updateStatusPreviewDOM(file, isVideo, pendingStatusFileSrc, pendingStatusMediaInfo);
                };
                reader.readAsDataURL(file);
            } catch (err) {
                pendingStatusFileSrc = 'data:image/jpeg;base64,mockpreview';
            }
        } else {
            pendingStatusFileSrc = 'data:image/jpeg;base64,mockpreview';
        }
    }
    updateStatusPreviewDOM(file, isVideo, pendingStatusFileSrc, pendingStatusMediaInfo);

    // Otimização / corte assíncrono para KB
    if (isVideo) {
        trimAndCompressVideoToKB(file, { isStory: true, maxDuration: 15, cutThreshold: 15 }).then((info) => {
            if (info && pendingStatusFile === file) {
                pendingStatusMediaInfo = info;
                if (info.src) pendingStatusFileSrc = info.src;
                updateStatusPreviewDOM(file, true, pendingStatusFileSrc, pendingStatusMediaInfo);
            }
        }).catch(() => {});
    } else {
        compressImageFileToKB(file, { maxDimension: 1280, targetMaxKB: 500 }).then((res) => {
            if (res && pendingStatusFile === file) {
                pendingStatusCompressedData = res.dataUrl;
                pendingStatusMediaInfo = {
                    type: 'image',
                    sizeBytes: res.sizeBytes,
                    sizeFormatted: res.sizeFormatted,
                    isCompressed: true
                };
                updateStatusPreviewDOM(file, false, pendingStatusFileSrc, pendingStatusMediaInfo);
            }
        }).catch(() => {});
    }
}

function updateStatusPreviewDOM(file, isVideo, src, mediaInfo = pendingStatusMediaInfo) {
    const previewBox = document.getElementById('status-media-preview-box');
    const previewImg = document.getElementById('status-preview-img');
    const previewVideo = document.getElementById('status-preview-video');
    const previewFilename = document.getElementById('status-preview-filename');
    const previewTag = document.getElementById('status-preview-tag');
    const chooseLabel = document.getElementById('choose-status-media-label');
    const previewSize = document.getElementById('status-preview-size');
    const trimmedBadge = document.getElementById('status-preview-trimmed-badge');

    if (previewBox) previewBox.style.display = 'flex';
    if (previewFilename) previewFilename.textContent = file.name || (isVideo ? 'video.mp4' : 'foto.jpg');
    if (previewTag) {
        previewTag.innerHTML = isVideo 
            ? '<i data-lucide="video"></i> <span>Vídeo selecionado</span>' 
            : '<i data-lucide="image"></i> <span>Foto selecionada</span>';
    }

    if (previewSize) {
        const sizeFormatted = mediaInfo?.sizeFormatted || formatBytesToKB(file.size || 102400);
        previewSize.innerHTML = `<i data-lucide="hard-drive"></i> <span>${sizeFormatted}</span>`;
    }

    if (trimmedBadge) {
        if (isVideo && mediaInfo?.isTrimmed) {
            trimmedBadge.style.display = 'inline-flex';
            trimmedBadge.innerHTML = `<i data-lucide="scissors"></i> <span>Cortado (15s)</span>`;
        } else {
            trimmedBadge.style.display = 'none';
        }
    }

    if (isVideo) {
        if (previewImg) {
            previewImg.style.display = 'none';
            previewImg.src = '';
        }
        if (previewVideo) {
            previewVideo.style.display = 'block';
            previewVideo.src = src;
        }
    } else {
        if (previewVideo) {
            previewVideo.style.display = 'none';
            previewVideo.src = '';
        }
        if (previewImg) {
            previewImg.style.display = 'block';
            previewImg.src = src;
        }
    }

    if (chooseLabel) chooseLabel.textContent = 'Trocar Mídia';
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function removeSelectedStatusMedia() {
    const statusInput = document.getElementById('status-file-input');
    if (statusInput) statusInput.value = '';
    if (pendingStatusFileSrc && typeof pendingStatusFileSrc === 'string' && pendingStatusFileSrc.startsWith('blob:')) {
        try { URL.revokeObjectURL(pendingStatusFileSrc); } catch (e) {}
    }
    pendingStatusFile = null;
    pendingStatusFileSrc = null;
    pendingStatusMediaInfo = null;
    pendingStatusCompressedData = null;

    const previewBox = document.getElementById('status-media-preview-box');
    const previewImg = document.getElementById('status-preview-img');
    const previewVideo = document.getElementById('status-preview-video');
    const chooseLabel = document.getElementById('choose-status-media-label');
    const previewSize = document.getElementById('status-preview-size');
    const trimmedBadge = document.getElementById('status-preview-trimmed-badge');

    if (previewSize) previewSize.innerHTML = `<i data-lucide="hard-drive"></i> <span>0 KB</span>`;
    if (trimmedBadge) trimmedBadge.style.display = 'none';

    if (previewBox) previewBox.style.display = 'none';
    if (previewImg) {
        previewImg.style.display = 'none';
        previewImg.src = '';
    }
    if (previewVideo) {
        previewVideo.style.display = 'none';
        previewVideo.src = '';
    }
    if (chooseLabel) chooseLabel.textContent = 'Escolher Mídia';
}

function openStoryPreview() {
    playSound(clickSound);
    if (!pendingStatusFile || !pendingStatusFileSrc) {
        showToast("Aviso", "Selecione uma foto ou vídeo antes de pré-visualizar.", "yellow");
        return;
    }

    if (composerPreviewAudio) {
        try { composerPreviewAudio.pause(); } catch(e) {}
        composerPreviewAudio = null;
        const icon = document.getElementById('status-preview-music-icon');
        if (icon) {
            icon.setAttribute('data-lucide', 'play');
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        }
    }

    const captionVal = document.getElementById('status-caption-input')?.value?.trim() || '';
    const isVideo = pendingStatusFile.type ? pendingStatusFile.type.startsWith('video') : false;

    const previewStory = {
        id: 'preview-' + Date.now(),
        isPreview: true,
        type: isVideo ? 'video' : 'image',
        src: pendingStatusFileSrc,
        isTrimmed: !!(pendingStatusMediaInfo && pendingStatusMediaInfo.isTrimmed) || !!pendingStatusFile.isTrimmed,
        caption: captionVal,
        views: {},
        reactions: {},
        replies: [],
        createdAt: Date.now(),
        music: pendingStatusMusic ? {
            id: pendingStatusMusic.id,
            title: pendingStatusMusic.title,
            artist: pendingStatusMusic.artist,
            cover: pendingStatusMusic.cover,
            audioUrl: pendingStatusMusic.audioUrl,
            duration: pendingStatusMusic.duration || 30
        } : null
    };

    const author = {
        authorUid: currentUser ? currentUser.uid : 'preview_user',
        uid: currentUser ? currentUser.uid : 'preview_user',
        authorName: currentProfile ? currentProfile.name : 'Você',
        authorUsername: currentProfile ? currentProfile.username : '@voce',
        authorAvatar: currentProfile ? currentProfile.avatar : '',
        isVip: checkIsVipUser(currentProfile),
        role: currentProfile ? currentProfile.role : 'user'
    };

    openStoryViewer([previewStory], author, { isPreview: true });
}

if (statusFileInput) {
    statusFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (file.type && file.type.startsWith('video')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = function() {
                try { window.URL.revokeObjectURL(video.src); } catch (err) {}
                const dur = Number(video.duration) || 0;
                file.originalDuration = dur;
                file.duration = dur;
                if (dur > 15.0) {
                    file.duration = 15;
                    file.isTrimmed = true;
                    setPendingStatusMedia(file, 'video');
                    showToast("Vídeo Cortado", "Vídeo com mais de 15s foi ajustado automaticamente para 15 segundos.", "blue");
                } else {
                    file.duration = dur;
                    file.isTrimmed = false;
                    setPendingStatusMedia(file, 'video');
                    showToast("Vídeo Aceito", "Vídeo pronto para publicação.", "green");
                }
            };
            try {
                video.src = URL.createObjectURL(file);
            } catch (err) {
                setPendingStatusMedia(file, 'video');
            }
        } else {
            setPendingStatusMedia(file, 'image');
            showToast("Imagem Aceita", "Foto convertida para KB e pronta para publicação.", "green");
        }
    });
}

document.getElementById('remove-status-media-btn')?.addEventListener('click', (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    playSound(clickSound);
    removeSelectedStatusMedia();
    showToast("Mídia Removida", "A seleção de mídia foi limpa.", "yellow");
});

document.getElementById('preview-status-btn')?.addEventListener('click', () => {
    openStoryPreview();
});

document.getElementById('status-preview-media-trigger')?.addEventListener('click', () => {
    openStoryPreview();
});

document.getElementById('story-preview-back-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    closeStoryViewer();
});

document.getElementById('story-preview-publish-now-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    closeStoryViewer();
    const publishBtn = document.getElementById('publish-status-btn');
    if (publishBtn) publishBtn.click();
});

document.getElementById('publish-status-btn')?.addEventListener('click', async () => {
    if (!pendingStatusFile) {
        showToast("Aviso", "Selecione uma foto ou vídeo antes de publicar.", "red");
        return;
    }
    if (!currentUser) return;

    const publishBtn = document.getElementById('publish-status-btn');
    if (publishBtn) {
        publishBtn.disabled = true;
        publishBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> <span>Publicando...</span>';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }

    // Buscar lista de contatos aceitos pelo usuário para registrar em allowedUids
    let allowedContacts = [];
    try {
        const contactsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'contacts'));
        allowedContacts = contactsSnap.docs.map(docSnap => docSnap.id);
    } catch (err) {
        console.warn('Erro ao carregar contatos para publicar status:', err);
    }

    const saveStoryWithSrc = async (mediaSrc) => {
        try {
            const isVideo = pendingStatusFile.type ? pendingStatusFile.type.startsWith('video') : false;
            const storyData = {
                authorUid: currentUser.uid,
                authorName: currentProfile.name,
                authorUsername: currentProfile.username,
                authorAvatar: currentProfile.avatar,
                type: isVideo ? 'video' : 'image',
                isTrimmed: !!(pendingStatusMediaInfo && pendingStatusMediaInfo.isTrimmed) || !!pendingStatusFile.isTrimmed,
                mediaSizeKB: pendingStatusMediaInfo?.sizeFormatted || formatBytesToKB(pendingStatusFile.size || 102400),
                caption: document.getElementById('status-caption-input')?.value || '',
                views: {},
                reactions: {},
                replies: [],
                allowedUids: allowedContacts,
                music: pendingStatusMusic ? {
                    id: pendingStatusMusic.id,
                    title: pendingStatusMusic.title,
                    artist: pendingStatusMusic.artist,
                    cover: pendingStatusMusic.cover,
                    audioUrl: pendingStatusMusic.audioUrl,
                    duration: pendingStatusMusic.duration || 30
                } : null,
                createdAt: Date.now()
            };

            await saveMediaWithChunks('stories', storyData, 'src', mediaSrc);

            showToast("Status Publicado", "Seu status de 24 horas está visível para seus contatos aceitos!", "green");
            document.getElementById('post-status-overlay')?.classList.remove('active');
            removeSelectedStatusMedia();
            pendingStatusMusic = null;
            const card = document.getElementById('status-selected-music-card');
            if (card) card.style.display = 'none';
            const addBtn = document.getElementById('status-add-music-btn');
            if (addBtn) addBtn.style.display = 'inline-flex';
            const captionInput = document.getElementById('status-caption-input');
            if (captionInput) captionInput.value = '';
            if (composerPreviewAudio) {
                try { composerPreviewAudio.pause(); } catch(e) {}
                composerPreviewAudio = null;
            }
        } catch (pubErr) {
            console.error('Erro ao publicar status:', pubErr);
            showToast("Erro", "Não foi possível publicar o status.", "red");
        } finally {
            if (publishBtn) {
                publishBtn.disabled = false;
                publishBtn.innerHTML = '<i data-lucide="send"></i> <span>Publicar Status</span>';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
        }
    };

    if (pendingStatusCompressedData) {
        await saveStoryWithSrc(pendingStatusCompressedData);
        return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
        await saveStoryWithSrc(reader.result);
    };
    reader.onerror = () => {
        if (publishBtn) {
            publishBtn.disabled = false;
            publishBtn.innerHTML = '<i data-lucide="send"></i> <span>Publicar Status</span>';
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        }
        showToast("Erro", "Erro ao processar arquivo de mídia.", "red");
    };
    reader.readAsDataURL(pendingStatusFile);
});

/* ==========================================================================
   SISTEMA DE FIXAÇÃO DE CONVERSAS (PINNED CHATS - ATÉ 3 CONVERSAS)
   ========================================================================== */
export function isChatPinned(targetId) {
    if (!targetId) return false;
    return Array.isArray(pinnedChats) && pinnedChats.includes(targetId);
}

export function getPinnedChats() {
    return Array.isArray(pinnedChats) ? [...pinnedChats] : [];
}

export function setPinnedChats(list = []) {
    pinnedChats = Array.isArray(list) ? [...list] : [];
    if (currentProfile) currentProfile.pinnedChats = pinnedChats;
    updateChatPinUI();
    applyPinnedSortToChatList();
}

export function applyPinnedSortToChatList() {
    const chatListEl = document.getElementById('chat-conversations-list');
    if (!chatListEl) return;
    const cards = Array.from(chatListEl.querySelectorAll('.chat-card'));
    if (cards.length === 0) return;

    cards.sort((a, b) => {
        const aPinned = a.dataset.isPinned === 'true';
        const bPinned = b.dataset.isPinned === 'true';

        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        if (aPinned && bPinned) {
            const aIndex = pinnedChats.indexOf(a.dataset.uid);
            const bIndex = pinnedChats.indexOf(b.dataset.uid);
            return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
        }
        return 0;
    });

    cards.forEach(card => chatListEl.appendChild(card));
}

export function updateChatPinUI() {
    // 1. Atualiza opção no menu de 3 pontinhos do chat
    const chatPinText = document.getElementById('chat-pin-text');
    const chatPinIcon = document.getElementById('chat-pin-icon');
    if (chatPinText && activeChatContact) {
        const isPinned = isChatPinned(activeChatContact.uid);
        chatPinText.innerText = isPinned ? 'Desafixar Conversa' : 'Fixar Conversa';
        if (chatPinIcon) {
            chatPinIcon.style.color = isPinned ? 'var(--accent-color, #00ff88)' : '';
        }
    }

    // 2. Atualiza os cards na lista de conversas
    document.querySelectorAll('.chat-card').forEach(card => {
        const uid = card.dataset.uid;
        if (!uid) return;
        const isPinned = isChatPinned(uid);
        card.classList.toggle('is-pinned', isPinned);
        card.dataset.isPinned = isPinned ? 'true' : 'false';

        const pinBadge = card.querySelector('.pinned-chat-badge');
        if (pinBadge) pinBadge.style.display = isPinned ? 'inline-flex' : 'none';

        const pinBtn = card.querySelector('.chat-card-pin-btn');
        if (pinBtn) {
            pinBtn.title = isPinned ? 'Desafixar conversa' : 'Fixar conversa';
            pinBtn.setAttribute('aria-label', pinBtn.title);
        }
    });

    if (window.lucide) lucide.createIcons();
}

export async function togglePinChat(targetId) {
    if (!currentUser || !targetId) return;
    const isPinned = isChatPinned(targetId);

    if (isPinned) {
        pinnedChats = pinnedChats.filter(id => id !== targetId);
        if (currentProfile) currentProfile.pinnedChats = pinnedChats;
        updateChatPinUI();
        applyPinnedSortToChatList();
        showToast("Conversa desafixada", "A conversa foi removida do topo.", "info");
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { pinnedChats });
        } catch (err) {
            console.error('Erro ao salvar conversa desafixada no Firestore:', err);
        }
    } else {
        if (pinnedChats.length >= 3) {
            showToast("Limite atingido", "Você só pode fixar até 3 conversas. Desafixe uma para fixar outra.", "warning");
            return;
        }
        pinnedChats.push(targetId);
        if (currentProfile) currentProfile.pinnedChats = pinnedChats;
        updateChatPinUI();
        applyPinnedSortToChatList();
        showToast("Conversa fixada", "A conversa foi fixada no topo da lista! 📌", "green");
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { pinnedChats });
        } catch (err) {
            console.error('Erro ao salvar conversa fixada no Firestore:', err);
        }
    }
}

/* ==========================================================================
   SISTEMA DE CHAT, MENSAGENS, SELEÇÃO MÚLTIPLA & EXCLUSÃO
   ========================================================================== */
function listenToContacts() {
    if (!currentUser) return;
    activityUnsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    const contactsRef = collection(db, 'users', currentUser.uid, 'contacts');
    
    contactsUnsubscribe = onSnapshot(contactsRef, async (snapshot) => {
        userContactsSet = new Set(snapshot.docs.map(docSnap => docSnap.id));
        const chatListEl = document.getElementById('chat-conversations-list');
        if (!chatListEl) return;

        const groupsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'groups'));
        const groups = groupsSnap.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));

        if (snapshot.empty && groups.length === 0) {
            chatListEl.innerHTML = `
                <div class="gallery-empty-state" style="margin-top: 50px;">
                    <i data-lucide="message-square-dashed" class="empty-state-icon"></i>
                    <p>Nenhuma conversa ainda.</p>
                    <small>Toque na lupa para buscar amigos digitando @ e enviar uma solicitação!</small>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        chatListEl.innerHTML = '';

        snapshot.forEach(docSnap => {
            const contact = docSnap.data();
            const contactUid = contact.uid || docSnap.id;
            contact.uid = contactUid;
            const chatId = [currentUser.uid, contactUid].sort().join('_');

            const isPinned = isChatPinned(contactUid);
            const initialBio = (contact.status && contact.status.trim()) ? `💬 Recado: "${contact.status.trim()}"` : 'Toque para abrir a conversa...';
            const card = document.createElement('div');
            card.className = `chat-card ${isPinned ? 'is-pinned' : ''}`;
            card.dataset.uid = contactUid;
            card.dataset.isGroup = 'false';
            card.dataset.isPinned = isPinned ? 'true' : 'false';
            card.innerHTML = `
                <div class="avatar" id="contact-avatar-${contactUid}" style="background-image: url('${contact.avatar || ''}');" role="button" tabindex="0" title="Ver dados de ${contact.name || 'Contato'}">
                    <span class="avatar-initial" id="avatar-initial-${contactUid}">${!contact.avatar ? (contact.name || 'C').charAt(0).toUpperCase() : ''}</span>
                    <span class="online-dot-badge" id="online-dot-${contactUid}" style="display:none;"></span>
                    <span class="unread-badge" id="unread-badge-${contactUid}" style="display:none;" title="Mensagem não lida">
                        <i data-lucide="bell"></i>
                    </span>
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <span class="name">
                            <span class="name-text">${contact.name || 'Contato'}</span>
                            <i data-lucide="badge-check" class="verified-badge chat-card-verified-badge" id="chat-card-verified-badge-${contactUid}" style="display:${(contact.isVip || contact.isVerified || checkIsVipUser(contact)) ? 'inline-flex' : 'none'};"></i>
                            <span class="pinned-chat-badge" id="pinned-badge-${contactUid}" style="display:${isPinned ? 'inline-flex' : 'none'};" title="Conversa fixada">
                                <i data-lucide="pin"></i>
                            </span>
                        </span>
                        <div class="chat-meta">
                            <span class="time" id="time-${chatId}">Recente</span>
                            <span class="chat-bell-badge" id="chat-bell-${contactUid}" style="display:none;" title="Nova mensagem">
                                <i data-lucide="bell"></i>
                                <span class="chat-bell-count" id="bell-count-${contactUid}">1</span>
                            </span>
                        </div>
                    </div>
                    <p class="last-msg" id="last-msg-${chatId}" data-fallback="${initialBio}">${initialBio}</p>
                    <span class="tag tag-vip" id="vip-tag-${contactUid}" style="display:none;">VIP</span>
                </div>
                <button class="chat-card-pin-btn" id="pin-btn-${contactUid}" type="button" title="${isPinned ? 'Desafixar conversa' : 'Fixar conversa'}" aria-label="Fixar conversa">
                    <i data-lucide="pin"></i>
                </button>
            `;

            card.onclick = () => openDirectChat(contact);
            const contactAvatar = card.querySelector('.avatar');
            if (contactAvatar) {
                contactAvatar.onclick = (event) => {
                    event.stopPropagation();
                    openContactProfile(contact);
                };
            }
            const pinBtn = card.querySelector('.chat-card-pin-btn');
            if (pinBtn) {
                pinBtn.onclick = (event) => {
                    event.stopPropagation();
                    togglePinChat(contactUid);
                };
            }

            let cardPressTimer = null;
            let cardPressMoved = false;
            card.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.group-delete-btn') || e.target.closest('.chat-card-pin-btn')) return;
                cardPressMoved = false;
                cardPressTimer = setTimeout(() => {
                    if (!cardPressMoved) {
                        togglePinChat(contactUid);
                    }
                }, 600);
            });
            card.addEventListener('pointermove', () => { cardPressMoved = true; clearTimeout(cardPressTimer); });
            card.addEventListener('pointerup', () => { clearTimeout(cardPressTimer); });
            card.addEventListener('pointercancel', () => { clearTimeout(cardPressTimer); });
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                togglePinChat(contactUid);
            });

            chatListEl.appendChild(card);
            if (window.lucide) lucide.createIcons();

            const contactUserUnsubscribe = onSnapshot(doc(db, 'users', contactUid), (userSnap) => {
                const tagEl = document.getElementById(`vip-tag-${contactUid}`);
                const badgeEl = document.getElementById(`chat-card-verified-badge-${contactUid}`);
                if (userSnap.exists()) {
                    const uData = userSnap.data();
                    contact.status = uData.status || contact.status;
                    contact.isVip = uData.isVip;
                    contact.isVerified = uData.isVerified;
                    const isVip = checkIsVipUser(uData);
                    if (tagEl) tagEl.style.display = isVip ? 'inline-block' : 'none';
                    if (badgeEl) {
                        badgeEl.style.display = isVip ? 'inline-flex' : 'none';
                        badgeEl.classList.toggle('active', isVip);
                    }
                    card.dataset.isVip = isVip ? 'true' : 'false';
                    if (window.lucide) lucide.createIcons();

                    const lastMsgEl = document.getElementById(`last-msg-${chatId}`);
                    if (lastMsgEl && (!lastMsgEl.dataset.fallback || lastMsgEl.dataset.fallback.startsWith('💬 Recado:') || lastMsgEl.dataset.fallback === 'Toque para abrir a conversa...')) {
                        const newBioText = (uData.status && uData.status.trim()) ? `💬 Recado: "${uData.status.trim()}"` : 'Toque para abrir a conversa...';
                        lastMsgEl.dataset.fallback = newBioText;
                        if (!card.classList.contains('typing')) {
                            lastMsgEl.innerText = newBioText;
                        }
                    }
                } else {
                    if (tagEl) tagEl.style.display = 'none';
                    card.dataset.isVip = 'false';
                }
            }, (error) => console.error('Erro ao ouvir status VIP do contato:', error));
            activityUnsubscribes.push(contactUserUnsubscribe);

            const activityUnsubscribe = onSnapshot(doc(db, 'users', currentUser.uid, 'activity', contactUid), (activitySnap) => {
                const lastMsgEl = document.getElementById(`last-msg-${chatId}`);
                const isBlockedByMe = blockedContactsSet.has(contactUid);
                const activity = activitySnap.exists() ? activitySnap.data() : {};
                const isActive = !isBlockedByMe && activitySnap.exists() && !!activity.active && (activity.expiresAt || 0) > Date.now();

                const timerKey = `card_${contactUid}`;
                if (cardActivityTimers.has(timerKey)) {
                    clearTimeout(cardActivityTimers.get(timerKey));
                    cardActivityTimers.delete(timerKey);
                }

                const applyCardInactive = () => {
                    card.classList.remove('typing');
                    if (lastMsgEl) {
                        const fallbackText = isBlockedByMe ? '🚫 Contato bloqueado' : (lastMsgEl.dataset.fallback || 'Toque para abrir a conversa...');
                        lastMsgEl.innerText = fallbackText;
                    }
                    applyChatFilter();
                };

                if (isActive) {
                    card.classList.add('typing');
                    if (lastMsgEl) {
                        lastMsgEl.innerHTML = createActivityIndicatorHTML(activity);
                        if (window.lucide) lucide.createIcons();
                    }
                    const remainingMs = Math.max(500, (activity.expiresAt || 0) - Date.now());
                    const t = setTimeout(applyCardInactive, remainingMs);
                    cardActivityTimers.set(timerKey, t);
                } else {
                    applyCardInactive();
                }
            }, (error) => console.error('Erro ao ouvir atividade do contato:', error));
            activityUnsubscribes.push(activityUnsubscribe);

            const lastMsgQuery = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(25));
            const lastMsgUnsubscribe = onSnapshot(lastMsgQuery, (msgSnap) => {
                const lastMsgEl = document.getElementById(`last-msg-${chatId}`);
                const timeEl = document.getElementById(`time-${chatId}`);
                const unreadBadge = document.getElementById(`unread-badge-${contactUid}`);
                const chatBell = document.getElementById(`chat-bell-${contactUid}`);
                const bellCount = document.getElementById(`bell-count-${contactUid}`);

                const isBlockedByMe = blockedContactsSet.has(contactUid);

                if (isBlockedByMe) {
                    if (unreadBadge) {
                        unreadBadge.style.display = 'none';
                        unreadBadge.classList.remove('active');
                    }
                    if (chatBell) chatBell.style.display = 'none';
                    card.classList.remove('unread');
                    card.dataset.unread = 'false';
                    card.dataset.unreadCount = '0';
                    if (lastMsgEl && !card.classList.contains('typing')) {
                        lastMsgEl.innerText = '🚫 Contato bloqueado';
                        lastMsgEl.dataset.fallback = '🚫 Contato bloqueado';
                    }
                    if (timeEl) timeEl.innerText = '';
                    applyChatFilter();
                    return;
                }

                const visibleDocs = msgSnap.docs.filter(docSnap => {
                    const m = docSnap.data();
                    return !(m.deletedFor && m.deletedFor.includes(currentUser.uid));
                });

                if (visibleDocs.length > 0) {
                    const lastData = visibleDocs[0].data();
                    if (lastMsgEl) {
                        lastMsgEl.dataset.fallback = lastData.deletedForEveryone ? '🚫 Esta mensagem foi apagada' : (lastData.text || (lastData.type === 'image' ? '📷 Foto' : (lastData.type === 'audio' ? '🎤 Áudio' : '📂 Arquivo')));
                        if (!card.classList.contains('typing')) {
                            if (lastData.deletedForEveryone) {
                                lastMsgEl.innerText = '🚫 Esta mensagem foi apagada';
                            } else {
                                lastMsgEl.innerText = lastMsgEl.dataset.fallback;
                            }
                        }
                    }
                    if (timeEl && lastData.createdAt) {
                        const d = new Date(lastData.createdAt);
                        timeEl.innerText = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    }

                    // Contar mensagens não lidas enviadas pelo outro contato
                    let unreadCount = 0;
                    visibleDocs.forEach(docSnap => {
                        const m = docSnap.data();
                        const sender = m.senderUid || m.fromUid;
                        const isFromOther = sender ? sender !== currentUser.uid : true;
                        const isRead = (Array.isArray(m.readBy) && m.readBy.includes(currentUser.uid)) || (m.readByMap && !!m.readByMap[currentUser.uid]);
                        if (isFromOther && !m.deletedForEveryone && !isRead) {
                            unreadCount++;
                        }
                    });

                    // O sino só fica visível se o usuário NÃO estiver com este chat aberto no momento
                    const isChatCurrentlyOpen = activeChatContact && (activeChatContact.uid === contactUid || activeChatContact.uid === contact.uid) && document.getElementById('chat-window')?.classList.contains('active');

                    const hasUnread = unreadCount > 0 && !isChatCurrentlyOpen;
                    card.classList.toggle('unread', hasUnread);
                    card.dataset.unread = hasUnread ? 'true' : 'false';
                    card.dataset.unreadCount = String(unreadCount);

                    if (hasUnread) {
                        if (unreadBadge) {
                            unreadBadge.style.display = 'flex';
                            unreadBadge.classList.add('active');
                        }
                        if (chatBell) {
                            chatBell.style.display = 'inline-flex';
                            if (bellCount) bellCount.innerText = unreadCount > 99 ? '99+' : String(unreadCount);
                        }
                        if (window.lucide) lucide.createIcons();
                    } else {
                        if (unreadBadge) {
                            unreadBadge.style.display = 'none';
                            unreadBadge.classList.remove('active');
                        }
                        if (chatBell) chatBell.style.display = 'none';
                    }
                    applyChatFilter();
                } else {
                    card.classList.remove('unread');
                    card.dataset.unread = 'false';
                    card.dataset.unreadCount = '0';
                    if (lastMsgEl) {
                        lastMsgEl.dataset.fallback = 'Toque para abrir a conversa...';
                        if (!card.classList.contains('typing')) {
                            lastMsgEl.innerText = 'Toque para abrir a conversa...';
                        }
                    }
                    if (timeEl) timeEl.innerText = '';
                    if (unreadBadge) {
                        unreadBadge.style.display = 'none';
                        unreadBadge.classList.remove('active');
                    }
                    if (chatBell) chatBell.style.display = 'none';
                    applyChatFilter();
                }
            }, (error) => console.error('Erro ao ouvir mensagens do chat:', error));
            activityUnsubscribes.push(lastMsgUnsubscribe);

            const userContactProfileUnsub = onSnapshot(doc(db, 'users', contactUid), (uSnap) => {
                const avatar = document.getElementById(`contact-avatar-${contactUid}`);
                const dot = document.getElementById(`online-dot-${contactUid}`);
                if (uSnap.exists()) {
                    const uData = uSnap.data();
                    const liveAvatar = uData.avatar || '';
                    const liveName = uData.name || contact.name || 'Contato';

                    const isOnline = !!(uData.online && !uData.ghostMode);
                    if (dot) dot.style.display = isOnline ? 'block' : 'none';
                    if (avatar) {
                        setAvatarContent(avatar, liveAvatar, liveName, `avatar-initial-${contactUid}`);
                    }

                    const nameText = card.querySelector('.name-text') || card.querySelector('.name');
                    if (nameText && uData.name) nameText.innerText = liveName;

                    contact.avatar = liveAvatar;
                    contact.name = liveName;

                    if (activeChatContact?.uid === contactUid) {
                        activeChatContact.avatar = liveAvatar;
                        activeChatContact.name = liveName;
                        const chatAvatar = document.getElementById('chat-window-avatar');
                        const chatName = document.getElementById('chat-window-name');
                        if (chatAvatar) {
                            setAvatarContent(chatAvatar, liveAvatar, liveName, 'chat-window-avatar-initial');
                            const chatDot = document.getElementById('chat-window-online-dot');
                            if (chatDot) chatDot.style.display = isOnline ? 'block' : 'none';
                        }
                        if (chatName) chatName.innerText = liveName;
                    }
                }
            });
            activityUnsubscribes.push(userContactProfileUnsub);

            const presenceRef = ref(rtdb, `presence/${contactUid}`);
            const presUnsub = onValue(presenceRef, (pSnap) => {
                const pVal = pSnap.val();
                const dot = document.getElementById(`online-dot-${contactUid}`);
                if (pVal && pVal.state === 'online') {
                    if (dot) dot.style.display = 'block';
                    if (activeChatContact?.uid === contactUid) {
                        const chatDot = document.getElementById('chat-window-online-dot');
                        if (chatDot) chatDot.style.display = 'block';
                    }
                } else if (pVal && pVal.state === 'offline') {
                    if (dot) dot.style.display = 'none';
                    if (activeChatContact?.uid === contactUid) {
                        const chatDot = document.getElementById('chat-window-online-dot');
                        if (chatDot) chatDot.style.display = 'none';
                    }
                }
            });
            activityUnsubscribes.push(presUnsub);
        });

        groups.forEach(group => {
            const groupId = group.groupId || group.id;
            const isGrpPinned = isChatPinned(groupId);
            const card = document.createElement('div');
            card.className = `chat-card ${isGrpPinned ? 'is-pinned' : ''}`;
            card.dataset.uid = groupId;
            card.dataset.isGroup = 'true';
            card.dataset.groupId = groupId;
            card.dataset.isPinned = isGrpPinned ? 'true' : 'false';
            card.innerHTML = `
                <div class="avatar" style="background-image: url('${group.avatar || 'https://images.unsplash.com/...'}');" role="img">
                    <span class="avatar-initial">${!group.avatar ? (group.name || 'G').charAt(0).toUpperCase() : ''}</span>
                    <span class="unread-badge" id="unread-badge-group-${groupId}" style="display:none;" title="Mensagem não lida">
                        <i data-lucide="bell"></i>
                    </span>
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <span class="name">
                            <span class="name-text">${group.name || 'Grupo VIP'}</span>
                            <span class="pinned-chat-badge" id="pinned-badge-group-${groupId}" style="display:${isGrpPinned ? 'inline-flex' : 'none'};" title="Conversa fixada">
                                <i data-lucide="pin"></i>
                            </span>
                        </span>
                        <div class="chat-meta">
                            <span class="time">${group.lastUpdated ? new Date(group.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Agora'}</span>
                            <span class="chat-bell-badge" id="chat-bell-group-${groupId}" style="display:none;" title="Nova mensagem">
                                <i data-lucide="bell"></i>
                                <span class="chat-bell-count" id="bell-count-group-${groupId}">1</span>
                            </span>
                        </div>
                    </div>
                    <p class="last-msg">${group.lastMessageText || 'Grupo criado'}</p>
                    <span class="tag tag-group">Grupo</span>
                </div>
                <button class="chat-card-pin-btn" id="pin-btn-group-${groupId}" type="button" title="${isGrpPinned ? 'Desafixar conversa' : 'Fixar conversa'}" aria-label="Fixar conversa">
                    <i data-lucide="pin"></i>
                </button>
                <button class="group-delete-btn" type="button" title="Apagar grupo" aria-label="Apagar grupo">
                    <i data-lucide="trash-2"></i>
                </button>
            `;
            card.onclick = () => openGroupChat(group);
            const pinBtn = card.querySelector('.chat-card-pin-btn');
            if (pinBtn) {
                pinBtn.onclick = (event) => {
                    event.stopPropagation();
                    togglePinChat(groupId);
                };
            }
            card.querySelector('.group-delete-btn').onclick = (event) => {
                event.stopPropagation();
                if (group.creatorUid === currentUser.uid) deleteGroup(group);
            };
            const groupAvatar = card.querySelector('.avatar');
            groupAvatar.onclick = (event) => {
                event.stopPropagation();
                openGroupProfile(group);
            };
            if (group.creatorUid !== currentUser.uid) {
                card.querySelector('.group-delete-btn').remove();
            }

            let cardPressTimer = null;
            let cardPressMoved = false;
            card.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.group-delete-btn') || e.target.closest('.chat-card-pin-btn')) return;
                cardPressMoved = false;
                cardPressTimer = setTimeout(() => {
                    if (!cardPressMoved) {
                        togglePinChat(groupId);
                    }
                }, 600);
            });
            card.addEventListener('pointermove', () => { cardPressMoved = true; clearTimeout(cardPressTimer); });
            card.addEventListener('pointerup', () => { clearTimeout(cardPressTimer); });
            card.addEventListener('pointercancel', () => { clearTimeout(cardPressTimer); });
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                togglePinChat(groupId);
            });

            chatListEl.appendChild(card);

            const grpProfileUnsub = onSnapshot(doc(db, 'groups', groupId), (groupSnap) => {
                if (!groupSnap.exists()) return;
                const liveGroup = { ...groupSnap.data(), id: groupId, groupId };
                const liveAvatar = card.querySelector('.avatar');
                if (liveAvatar) {
                    setAvatarContent(liveAvatar, liveGroup.avatar, liveGroup.name || 'G');
                }
                const liveName = card.querySelector('.name-text') || card.querySelector('.name');
                if (liveName) liveName.innerText = liveGroup.name || 'Grupo VIP';
            });
            activityUnsubscribes.push(grpProfileUnsub);

            const groupMsgQuery = query(collection(db, 'chats', `group_${groupId}`, 'messages'), orderBy('createdAt', 'desc'), limit(25));
            const grpMsgUnsub = onSnapshot(groupMsgQuery, (msgSnap) => {
                const unreadBadge = document.getElementById(`unread-badge-group-${groupId}`);
                const chatBell = document.getElementById(`chat-bell-group-${groupId}`);
                const bellCount = document.getElementById(`bell-count-group-${groupId}`);

                let unreadCount = 0;
                msgSnap.docs.forEach(docSnap => {
                    const m = docSnap.data();
                    if (m.deletedFor && m.deletedFor.includes(currentUser.uid)) return;
                    const sender = m.senderUid || m.fromUid;
                    const isFromOther = sender ? sender !== currentUser.uid : true;
                    const isRead = (Array.isArray(m.readBy) && m.readBy.includes(currentUser.uid)) || (m.readByMap && !!m.readByMap[currentUser.uid]);
                    if (isFromOther && !m.deletedForEveryone && !isRead) {
                        unreadCount++;
                    }
                });

                const isGroupChatCurrentlyOpen = activeChatContact && activeChatContact.uid === groupId && document.getElementById('chat-window')?.classList.contains('active');

                const hasUnread = unreadCount > 0 && !isGroupChatCurrentlyOpen;
                card.classList.toggle('unread', hasUnread);
                card.dataset.unread = hasUnread ? 'true' : 'false';
                card.dataset.unreadCount = String(unreadCount);

                if (hasUnread) {
                    if (unreadBadge) {
                        unreadBadge.style.display = 'flex';
                        unreadBadge.classList.add('active');
                    }
                    if (chatBell) {
                        chatBell.style.display = 'inline-flex';
                        if (bellCount) bellCount.innerText = unreadCount > 99 ? '99+' : String(unreadCount);
                    }
                    if (window.lucide) lucide.createIcons();
                } else {
                    if (unreadBadge) {
                        unreadBadge.style.display = 'none';
                        unreadBadge.classList.remove('active');
                    }
                    if (chatBell) chatBell.style.display = 'none';
                }
                applyChatFilter();
            }, (error) => console.error('Erro ao ouvir mensagens do grupo:', error));
            activityUnsubscribes.push(grpMsgUnsub);
        });

        updateChatPinUI();
        applyPinnedSortToChatList();
        if (typeof applyChatFilter === 'function') applyChatFilter();
        if (window.lucide) lucide.createIcons();
    });
}

async function deleteGroup(group) {
    if (!currentUser) return;
    const groupId = group.groupId || group.id;
    const groupName = group.name || 'este grupo';
    const confirmed = window.confirm(`Apagar o grupo "${groupName}"? Esta ação remove o grupo para todos os membros.`);
    if (!confirmed) return;

    try {
        const members = [...new Set(group.members || [currentUser.uid])];
        const batch = writeBatch(db);
        batch.delete(doc(db, 'groups', groupId));
        members.forEach(memberUid => {
            batch.delete(doc(db, 'users', memberUid, 'groups', groupId));
        });
        await batch.commit();

        if (activeChatContact?.uid === groupId) {
            document.getElementById('close-chat')?.click();
        }
        showToast('Grupo apagado', `"${groupName}" foi removido.`, 'green');
    } catch (error) {
        console.error('Erro ao apagar grupo:', error);
        showToast('Erro', 'Não foi possível apagar o grupo.', 'red');
    }
}

/* ==========================================================================
   PERFIL E DADOS DO CONTATO (EXIBIÇÃO DE RECADO / BIO)
   ========================================================================== */
let activeContactProfileData = null;
let activeContactProfileUnsubscribe = null;

export function closeContactProfile() {
    const panel = document.getElementById('contact-profile-panel');
    if (panel) {
        panel.classList.remove('active');
    }
    if (activeContactProfileUnsubscribe) {
        activeContactProfileUnsubscribe();
        activeContactProfileUnsubscribe = null;
    }
    activeContactProfileData = null;
    playSound(clickSound);
}

export async function openContactProfile(contact) {
    if (!currentUser || !contact) return;
    if (contact.isGroup) {
        return openGroupProfile(contact);
    }

    const contactUid = contact.uid || contact.id;
    if (!contactUid) return;

    if (activeContactProfileUnsubscribe) {
        activeContactProfileUnsubscribe();
        activeContactProfileUnsubscribe = null;
    }

    const panel = document.getElementById('contact-profile-panel');
    const avatarEl = document.getElementById('contact-profile-avatar');
    const nameEl = document.getElementById('contact-profile-name');
    const usernameEl = document.getElementById('contact-profile-username');
    const badgeEl = document.getElementById('contact-profile-verified-badge');
    const presenceEl = document.getElementById('contact-profile-presence');
    const onlineDotEl = document.getElementById('contact-profile-online-dot');
    const bioTextEl = document.getElementById('contact-profile-bio-text');
    const bioDateEl = document.getElementById('contact-profile-bio-date');
    const blockBtn = document.getElementById('contact-profile-block-btn');
    const blockText = document.getElementById('contact-profile-block-text');
    const reportBtn = document.getElementById('contact-profile-report-btn');
    const chatBtn = document.getElementById('contact-profile-chat-btn');
    const callBtn = document.getElementById('contact-profile-call-btn');

    // Preenchimento inicial imediato
    const initName = contact.name || 'Contato';
    const initUsername = contact.username || '@usuario';
    const initBio = (contact.status && contact.status.trim()) ? contact.status.trim() : 'Disponível no VORTEX ⚡';
    const initIsVip = !!(
        checkIsVipUser(contact) ||
        contact.isVip ||
        contact.isVerified ||
        (contact.email && contact.email.toLowerCase() === 'dxhub.oficial@gmail.com') ||
        (contact.username && contact.username.toLowerCase().replace(/^@/, '') === 'dxhuboficial') ||
        (contact.name && contact.name.includes('DX Hub'))
    );

    if (nameEl) nameEl.innerText = initName;
    if (usernameEl) usernameEl.innerText = initUsername;
    if (badgeEl) {
        badgeEl.style.display = initIsVip ? 'inline-flex' : 'none';
        badgeEl.classList.toggle('active', initIsVip);
    }
    if (bioTextEl) bioTextEl.innerText = `"${initBio}"`;
    if (bioDateEl) bioDateEl.innerText = 'Recado do perfil no VORTEX';
    if (avatarEl) {
        setAvatarContent(avatarEl, contact.avatar, initName, 'contact-profile-avatar-initial');
    }

    updateContactProfileBlockedUI(contactUid);

    // Listener em tempo real dos dados do contato (sincroniza Recado / Bio instantaneamente)
    activeContactProfileUnsubscribe = onSnapshot(doc(db, 'users', contactUid), (snap) => {
        if (!snap.exists()) return;
        const uData = snap.data();
        activeContactProfileData = uData;

        const liveName = uData.name || contact.name || 'Contato';
        const liveUsername = uData.username || '@usuario';
        const liveAvatar = uData.avatar || '';
        const liveBio = (uData.status && uData.status.trim()) ? uData.status.trim() : 'Disponível no VORTEX ⚡';
        const isVip = !!(
            checkIsVipUser(uData) ||
            uData.isVip ||
            uData.isVerified ||
            checkIsVipUser(contact) ||
            contact.isVip ||
            contact.isVerified ||
            (uData.email && uData.email.toLowerCase() === 'dxhub.oficial@gmail.com') ||
            (contact.email && contact.email.toLowerCase() === 'dxhub.oficial@gmail.com') ||
            (uData.username && uData.username.toLowerCase().replace(/^@/, '') === 'dxhuboficial') ||
            (contact.username && contact.username.toLowerCase().replace(/^@/, '') === 'dxhuboficial') ||
            (uData.name && uData.name.includes('DX Hub')) ||
            (contact.name && contact.name.includes('DX Hub'))
        );
        const isOnline = !!(uData.online && !uData.ghostMode && !blockedContactsSet.has(contactUid));

        if (nameEl) nameEl.innerText = liveName;
        if (usernameEl) usernameEl.innerText = liveUsername;
        if (badgeEl) {
            badgeEl.style.display = isVip ? 'inline-flex' : 'none';
            badgeEl.classList.toggle('active', isVip);
        }
        if (window.lucide) lucide.createIcons();
        if (bioTextEl) bioTextEl.innerText = `"${liveBio}"`;
        if (avatarEl) {
            setAvatarContent(avatarEl, liveAvatar, liveName, 'contact-profile-avatar-initial');
        }
        if (onlineDotEl) onlineDotEl.style.display = isOnline ? 'block' : 'none';
        if (presenceEl) {
            if (blockedContactsSet.has(contactUid)) {
                presenceEl.innerText = 'Bloqueado';
            } else {
                presenceEl.innerText = isOnline ? 'Online agora' : (uData.lastSeen ? `Visto por último: ${formatLastSeen(uData.lastSeen)}` : 'Visto recentemente');
            }
        }
        updateContactProfileBlockedUI(contactUid);
    }, (error) => console.error('Erro ao ouvir perfil do contato:', error));

    // Ações dos botões
    if (chatBtn) {
        chatBtn.onclick = () => {
            closeContactProfile();
            openDirectChat(contact);
        };
    }

    if (callBtn) {
        callBtn.onclick = () => {
            closeContactProfile();
            const callTrigger = document.getElementById('chat-audio-call-btn');
            if (callTrigger) callTrigger.click();
            else if (typeof startAudioCall === 'function') startAudioCall();
        };
    }

    if (blockBtn) {
        blockBtn.onclick = () => {
            openBlockContactConfirmation(contact);
        };
    }

    if (reportBtn) {
        reportBtn.onclick = () => {
            openReportModal({
                type: 'user',
                targetUid: contactUid,
                targetName: contact.name || 'Contato',
                isGroup: false
            });
        };
    }

    const closeBtn = document.getElementById('close-contact-profile');
    if (closeBtn) {
        closeBtn.onclick = () => closeContactProfile();
    }

    if (panel) panel.classList.add('active');
    playSound(clickSound);
    if (window.lucide) lucide.createIcons();
}

async function openGroupProfile(group) {
    if (!currentUser) return;
    managedGroup = { ...group, groupId: group.groupId || group.id };
    if (managedGroupUnsubscribe) managedGroupUnsubscribe();
    managedGroupUnsubscribe = onSnapshot(doc(db, 'groups', managedGroup.groupId), (groupSnap) => {
        if (!groupSnap.exists()) return;
        managedGroup = { ...managedGroup, ...groupSnap.data(), groupId: managedGroup.groupId };
        const liveAvatar = document.getElementById('group-profile-avatar');
        if (liveAvatar) liveAvatar.style.backgroundImage = managedGroup.avatar ? `url('${managedGroup.avatar}')` : '';
        pendingGroupAvatar = managedGroup.avatar || '';
        const liveTitle = document.getElementById('group-profile-title');
        if (liveTitle) liveTitle.innerText = managedGroup.name || 'Grupo VIP';
    });
    const isAdmin = managedGroup.creatorUid === currentUser.uid;
    const panel = document.getElementById('group-profile-panel');
    const avatar = document.getElementById('group-profile-avatar');
    const title = document.getElementById('group-profile-title');
    const count = document.getElementById('group-profile-member-count');
    const nameInput = document.getElementById('group-profile-name');
    const descriptionInput = document.getElementById('group-profile-description');
    const adminFields = document.getElementById('group-admin-fields');
    const deleteButton = document.getElementById('delete-group-profile-btn');
    const membersList = document.getElementById('group-profile-members');
    const avatarInputLabel = document.getElementById('group-avatar-input-label');

    if (avatar) avatar.style.backgroundImage = managedGroup.avatar ? `url('${managedGroup.avatar}')` : '';
    pendingGroupAvatar = managedGroup.avatar || '';
    if (title) title.innerText = managedGroup.name || 'Grupo VIP';
    if (count) count.innerText = `${(managedGroup.members || []).length} membros`;
    if (nameInput) nameInput.value = managedGroup.name || '';
    if (descriptionInput) descriptionInput.value = managedGroup.description || '';
    if (adminFields) adminFields.style.display = isAdmin ? 'flex' : 'none';
    if (deleteButton) deleteButton.style.display = isAdmin ? 'flex' : 'none';
    if (avatarInputLabel) avatarInputLabel.style.display = isAdmin ? 'inline-flex' : 'none';
    const addMemberSelect = document.getElementById('group-add-member-select');
    if (addMemberSelect) {
        addMemberSelect.innerHTML = '<option value="">Selecione um contato</option>';
        if (isAdmin) {
            const contactsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'contacts'));
            contactsSnap.forEach(contactDoc => {
                const contact = contactDoc.data();
                if (!(managedGroup.members || []).includes(contact.uid)) {
                    addMemberSelect.insertAdjacentHTML('beforeend', `<option value="${contact.uid}">${contact.name || 'Contato'}</option>`);
                }
            });
        }
    }

    const pauseButton = document.getElementById('toggle-group-pause');
    if (pauseButton) pauseButton.innerHTML = `<i data-lucide="${managedGroup.paused ? 'play' : 'pause'}"></i><span>${managedGroup.paused ? 'Despausar grupo' : 'Pausar grupo'}</span>`;
    cleanupGroupProfileMemberListeners();
    if (membersList) {
        membersList.innerHTML = '<p class="group-member-loading">Carregando membros...</p>';
        const memberDocs = await Promise.all((managedGroup.members || []).map(uid => getDoc(doc(db, 'users', uid))));
        membersList.innerHTML = memberDocs.map((memberDoc, index) => {
            const member = memberDoc.exists() ? memberDoc.data() : {};
            const uid = managedGroup.members[index];
            const isCreator = uid === managedGroup.creatorUid;
            const isAdminMember = (managedGroup.admins || []).includes(uid) || isCreator;
            const menu = isAdmin && !isCreator ? `
                <div class="group-member-menu-wrap">
                    <button class="group-member-menu-btn" type="button" title="Opções do membro" aria-label="Opções do membro"><i data-lucide="more-vertical"></i></button>
                    <div class="group-member-menu">
                        <button type="button" class="group-member-action" data-action="remove">Remover usuário</button>
                        ${isAdminMember ? '' : '<button type="button" class="group-member-action" data-action="promote">Promover como admin</button>'}
                    </div>
                </div>
            ` : '';
            const memberAvatar = member.avatar || '';
            const memberName = member.name || 'Membro';
            return `<div class="contact-selection-item group-member-row" data-member-uid="${uid}"><div class="contact-info-mini"><div class="avatar sm" id="group-profile-member-avatar-${uid}" style="background-image:url('${memberAvatar}')">${!memberAvatar ? memberName.charAt(0).toUpperCase() : ''}</div><span id="group-profile-member-name-${uid}">${memberName}${isAdminMember ? ' (admin)' : ''}</span></div>${menu}</div>`;
        }).join('') || '<p class="group-member-loading">Nenhum membro encontrado.</p>';

        (managedGroup.members || []).forEach(uid => {
            const unsub = onSnapshot(doc(db, 'users', uid), (mSnap) => {
                if (mSnap.exists()) {
                    const mData = mSnap.data();
                    const avEl = document.getElementById(`group-profile-member-avatar-${uid}`);
                    const nameEl = document.getElementById(`group-profile-member-name-${uid}`);
                    const liveAvatar = mData.avatar || '';
                    const liveName = mData.name || 'Membro';
                    const isCreator = uid === managedGroup.creatorUid;
                    const isAdminMember = (managedGroup.admins || []).includes(uid) || isCreator;

                    if (avEl) {
                        if (liveAvatar) {
                            avEl.style.backgroundImage = `url('${liveAvatar}')`;
                            avEl.innerText = '';
                        } else {
                            avEl.style.backgroundImage = '';
                            avEl.innerText = liveName.charAt(0).toUpperCase() || '';
                        }
                    }
                    if (nameEl) {
                        nameEl.innerText = `${liveName}${isAdminMember ? ' (admin)' : ''}`;
                    }
                }
            });
            groupProfileMemberUnsubscribes.push(unsub);
        });
    }
    if (window.lucide) lucide.createIcons();
    membersList?.querySelectorAll('.group-member-menu-btn').forEach(button => {
        button.onclick = (event) => {
            event.stopPropagation();
            const menu = button.nextElementSibling;
            membersList.querySelectorAll('.group-member-menu.active').forEach(openMenu => {
                if (openMenu !== menu) openMenu.classList.remove('active');
            });
            menu?.classList.toggle('active');
        };
    });
    membersList?.querySelectorAll('.group-member-action').forEach(button => {
        button.onclick = async (event) => {
            event.stopPropagation();
            const row = button.closest('.group-member-row');
            const memberUid = row?.dataset.memberUid;
            row?.querySelector('.group-member-menu')?.classList.remove('active');
            if (button.dataset.action === 'remove') await removeGroupMember(memberUid);
            if (button.dataset.action === 'promote') await promoteGroupMember(memberUid);
        };
    });
    panel?.classList.add('active');
}

async function syncGroupReferences(group) {
    const batch = writeBatch(db);
    (group.members || []).forEach(memberUid => {
        batch.set(doc(db, 'users', memberUid, 'groups', group.groupId), {
            groupId: group.groupId,
            name: group.name,
            description: group.description || '',
            avatar: group.avatar || '',
            creatorUid: group.creatorUid,
            admins: group.admins || [group.creatorUid],
            members: group.members,
            paused: !!group.paused,
            updatedAt: Date.now()
        }, { merge: true });
    });
    await batch.commit();
}

async function notifyUser(userUid, title, message) {
    await addDoc(collection(db, 'notifications'), {
        toUid: userUid,
        title,
        message,
        createdAt: Date.now()
    });
}

async function addGroupMember(memberUid) {
    if (!managedGroup || managedGroup.creatorUid !== currentUser?.uid || !memberUid) return;
    if ((managedGroup.members || []).includes(memberUid)) return;

    try {
        managedGroup.members = [...(managedGroup.members || []), memberUid];
        await updateDoc(doc(db, 'groups', managedGroup.groupId), {
            members: managedGroup.members,
            updatedAt: Date.now()
        });
        await syncGroupReferences(managedGroup);
        await notifyUser(memberUid, 'Você foi adicionado a um grupo', `Você foi adicionado ao grupo "${managedGroup.name || 'Grupo VIP'}" pelo administrador.`);
        await openGroupProfile(managedGroup);
        showToast('Membro adicionado', 'O usuário agora consegue ver o grupo.', 'green');
    } catch (error) {
        console.error('Erro ao adicionar membro:', error);
        showToast('Erro', 'Não foi possível adicionar o membro.', 'red');
    }
}

async function removeGroupMember(memberUid) {
    if (!managedGroup || managedGroup.creatorUid !== currentUser?.uid || !memberUid || memberUid === managedGroup.creatorUid) return;
    if (!window.confirm('Remover este usuário do grupo?')) return;

    try {
        managedGroup.members = (managedGroup.members || []).filter(uid => uid !== memberUid);
        managedGroup.admins = (managedGroup.admins || []).filter(uid => uid !== memberUid);
        await updateDoc(doc(db, 'groups', managedGroup.groupId), {
            members: managedGroup.members,
            admins: managedGroup.admins,
            updatedAt: Date.now()
        });
        await deleteDoc(doc(db, 'users', memberUid, 'groups', managedGroup.groupId));
        await notifyUser(memberUid, 'Você foi removido do grupo', 'Você não pertence mais a este grupo porque foi removido pelo administrador.');
        await syncGroupReferences(managedGroup);
        await openGroupProfile(managedGroup);
        showToast('Usuário removido', 'O usuário foi removido do grupo.', 'green');
    } catch (error) {
        console.error('Erro ao remover membro:', error);
        showToast('Erro', 'Não foi possível remover o usuário.', 'red');
    }
}

async function promoteGroupMember(memberUid) {
    if (!managedGroup || managedGroup.creatorUid !== currentUser?.uid || !memberUid) return;
    try {
        managedGroup.admins = [...new Set([...(managedGroup.admins || []), memberUid])];
        await updateDoc(doc(db, 'groups', managedGroup.groupId), { admins: managedGroup.admins, updatedAt: Date.now() });
        await syncGroupReferences(managedGroup);
        await openGroupProfile(managedGroup);
        showToast('Novo admin', 'O usuário foi promovido como administrador.', 'green');
    } catch (error) {
        console.error('Erro ao promover membro:', error);
        showToast('Erro', 'Não foi possível promover o usuário.', 'red');
    }
}

// Variáveis e estado para Presença e Digitação em Tempo Real em Grupos
let currentGroupPresenceHeartbeat = null;
let currentGroupPresenceDocRef = null;
let currentGroupPresenceRef = null;
let currentGroupPresenceUnsubscribe = null;
let currentGroupRtdbPresenceUnsubscribe = null;
let currentGroupActivityUnsubscribe = null;
let currentGroupRtdbActivityUnsubscribe = null;
let currentGroupDocUnsubscribe = null;
let currentGroupOnlineCount = 0;
let currentGroupTypingUsers = new Map();
let activeGroupDoc = null;

async function leaveGroup(targetGroup = null) {
    const groupToLeave = targetGroup || managedGroup || (activeChatContact?.isGroup ? activeChatContact : null);
    if (!groupToLeave || !currentUser) {
        showToast("Erro", "Nenhum grupo selecionado.", "red");
        return false;
    }
    const groupId = groupToLeave.groupId || groupToLeave.uid || groupToLeave.id;
    if (!groupId) return false;

    if (typeof window !== 'undefined' && window.confirm && !window.confirm("Deseja realmente sair deste grupo?")) {
        return false;
    }

    try {
        await updateDoc(doc(db, 'groups', groupId), {
            members: arrayRemove(currentUser.uid),
            admins: arrayRemove(currentUser.uid),
            updatedAt: Date.now()
        });

        await deleteDoc(doc(db, 'users', currentUser.uid, 'groups', groupId)).catch(() => {});
        deleteDoc(doc(db, 'chats', `group_${groupId}`, 'presence', currentUser.uid)).catch(() => {});

        if (typeof rtdb !== 'undefined') {
            const presRef = ref(rtdb, `group_presence/${groupId}/${currentUser.uid}`);
            rtdbSet(presRef, null).catch(() => {});
        }

        if (activeChatContact && activeChatContact.uid === groupId) {
            closeChat();
        }

        document.getElementById('group-profile-panel')?.classList.remove('active');
        managedGroup = null;

        const card = document.querySelector(`.chat-card[data-uid="${groupId}"]`);
        if (card) card.remove();

        showToast("Você saiu do grupo", "Você não faz mais parte deste grupo.", "blue");
        return true;
    } catch (err) {
        console.error('Erro ao sair do grupo:', err);
        showToast("Erro", "Não foi possível sair do grupo.", "red");
        return false;
    }
}

function cleanupActiveGroupListeners() {
    if (currentGroupPresenceHeartbeat) {
        clearInterval(currentGroupPresenceHeartbeat);
        currentGroupPresenceHeartbeat = null;
    }
    if (currentGroupPresenceDocRef) {
        deleteDoc(currentGroupPresenceDocRef).catch(() => {});
        currentGroupPresenceDocRef = null;
    }
    if (currentGroupPresenceRef && typeof rtdbSet === 'function') {
        rtdbSet(currentGroupPresenceRef, null).catch(() => {});
        currentGroupPresenceRef = null;
    }
    if (currentGroupPresenceUnsubscribe && typeof currentGroupPresenceUnsubscribe === 'function') {
        currentGroupPresenceUnsubscribe();
        currentGroupPresenceUnsubscribe = null;
    }
    if (currentGroupRtdbPresenceUnsubscribe && typeof currentGroupRtdbPresenceUnsubscribe === 'function') {
        currentGroupRtdbPresenceUnsubscribe();
        currentGroupRtdbPresenceUnsubscribe = null;
    }
    if (currentGroupActivityUnsubscribe && typeof currentGroupActivityUnsubscribe === 'function') {
        currentGroupActivityUnsubscribe();
        currentGroupActivityUnsubscribe = null;
    }
    if (currentGroupRtdbActivityUnsubscribe && typeof currentGroupRtdbActivityUnsubscribe === 'function') {
        currentGroupRtdbActivityUnsubscribe();
        currentGroupRtdbActivityUnsubscribe = null;
    }
    if (currentGroupDocUnsubscribe && typeof currentGroupDocUnsubscribe === 'function') {
        currentGroupDocUnsubscribe();
        currentGroupDocUnsubscribe = null;
    }
    currentGroupTypingUsers.clear();
    currentGroupOnlineCount = 0;
    activeGroupDoc = null;
}

function updateGroupChatHeaderStatus() {
    const statusEl = document.getElementById('chat-window-status');
    if (!statusEl || !activeChatContact || !activeChatContact.isGroup) return;

    if (activeChatContact.paused) {
        statusEl.className = 'status-animated status-offline';
        statusEl.innerText = 'Grupo pausado pelo administrador';
        return;
    }

    const typingNames = Array.from(currentGroupTypingUsers.values());
    if (typingNames.length > 0) {
        statusEl.className = 'status-animated status-activity status-group-typing';
        let typingLabel = '';
        if (typingNames.length === 1) {
            typingLabel = `${typingNames[0]} está digitando...`;
        } else if (typingNames.length === 2) {
            typingLabel = `${typingNames[0]} e ${typingNames[1]} estão digitando...`;
        } else {
            typingLabel = `${typingNames[0]}, ${typingNames[1]} e outros estão digitando...`;
        }
        statusEl.innerHTML = `
            <span class="typing-indicator activity-indicator">
                <i data-lucide="message-circle"></i>
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
                <span>${escapeHTML(typingLabel)}</span>
            </span>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    const totalMembers = (activeGroupDoc?.members || activeChatContact?.members || []).length;
    statusEl.className = 'status-animated status-online';
    if (currentGroupOnlineCount > 0) {
        statusEl.innerHTML = `
            <span class="group-presence-indicator">
                <span class="presence-pulse-dot"></span>
                <span>${totalMembers} membros • <strong class="online-highlight">${currentGroupOnlineCount} online agora</strong></span>
            </span>
        `;
    } else {
        statusEl.innerText = `${totalMembers} membros`;
    }
}

function openGroupChat(group) {
    const groupId = group.groupId || group.id || group.uid;
    if (!groupId) return;

    cleanupActiveGroupListeners();
    if (bioBubbleTimer) {
        clearTimeout(bioBubbleTimer);
        bioBubbleTimer = null;
    }
    const groupBioBubble = document.getElementById('chat-bio-bubble');
    if (groupBioBubble) {
        groupBioBubble.style.display = 'none';
        groupBioBubble.classList.remove('scrolled-hide', 'bubble-expired');
    }

    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) {
        chatWindow.classList.add('active');
    }
    const leaveGroupTrigger = document.getElementById('chat-leave-group-trigger');
    if (leaveGroupTrigger) leaveGroupTrigger.style.display = 'flex';

    // Ocultar imediatamente o sino e o badge do grupo ao abrir
    const unreadBadge = document.getElementById(`unread-badge-group-${groupId}`);
    const chatBell = document.getElementById(`chat-bell-group-${groupId}`);
    if (unreadBadge) {
        unreadBadge.style.display = 'none';
        unreadBadge.classList.remove('active');
    }
    if (chatBell) chatBell.style.display = 'none';

    const groupCard = document.querySelector(`.chat-card[data-uid="${groupId}"]`);
    if (groupCard) {
        groupCard.classList.remove('unread');
        groupCard.dataset.unread = 'false';
        groupCard.dataset.unreadCount = '0';
    }
    if (typeof applyChatFilter === 'function') applyChatFilter();

    activeGroupDoc = group;
    activeChatContact = { uid: groupId, name: group.name || 'Grupo VIP', avatar: group.avatar || '', isGroup: true, paused: !!group.paused, members: group.members || [] };

    const nameEl = document.getElementById('chat-window-name');
    const avatarEl = document.getElementById('chat-window-avatar');

    if (nameEl) nameEl.innerText = group.name || 'Grupo VIP';
    if (avatarEl) {
        setAvatarContent(avatarEl, group.avatar, group.name || 'G', 'chat-window-avatar-initial');
    }
    const chatDot = document.getElementById('chat-window-online-dot');
    if (chatDot) chatDot.style.display = 'none';
    if (typeof updateChatPinUI === 'function') updateChatPinUI();

    currentGroupOnlineCount = 1; // O próprio usuário está com a aba aberta
    updateGroupChatHeaderStatus();

    // 1. Presença no grupo em tempo real via Firestore (Canal Primário Seguro)
    if (currentUser) {
        const presDocRef = doc(db, 'chats', `group_${groupId}`, 'presence', currentUser.uid);
        currentGroupPresenceDocRef = presDocRef;
        const setPresenceOnline = () => {
            if (!currentUser || !activeChatContact || activeChatContact.uid !== groupId) return;
            setDoc(presDocRef, {
                uid: currentUser.uid,
                name: currentProfile.name || 'Membro',
                online: true,
                updatedAt: Date.now(),
                expiresAt: Date.now() + 45000
            }).catch(() => {});
        };
        setPresenceOnline();
        currentGroupPresenceHeartbeat = setInterval(setPresenceOnline, 20000);

        try {
            currentGroupPresenceUnsubscribe = onSnapshot(collection(db, 'chats', `group_${groupId}`, 'presence'), (snap) => {
                if (!activeChatContact || activeChatContact.uid !== groupId) return;
                const now = Date.now();
                let count = 0;
                snap.forEach(d => {
                    const data = d.data();
                    if (data && data.online && (data.expiresAt ? data.expiresAt > now : data.updatedAt > now - 45000)) {
                        count++;
                    }
                });
                currentGroupOnlineCount = Math.max(1, count);
                updateGroupChatHeaderStatus();
            }, (err) => console.warn('Erro ao escutar presença:', err));
        } catch(e) {}
    }

    // 2. Presença no grupo em tempo real via RTDB (Canal Secundário)
    if (typeof rtdb !== 'undefined' && currentUser) {
        try {
            const presRef = ref(rtdb, `group_presence/${groupId}/${currentUser.uid}`);
            currentGroupPresenceRef = presRef;
            rtdbSet(presRef, {
                inGroup: true,
                uid: currentUser.uid,
                name: currentProfile.name || 'Usuário',
                enteredAt: Date.now()
            }).catch(() => {});

            if (typeof onDisconnect === 'function') {
                try { onDisconnect(presRef).remove(); } catch(e) {}
            }

            const allPresRef = ref(rtdb, `group_presence/${groupId}`);
            currentGroupRtdbPresenceUnsubscribe = onValue(allPresRef, (snap) => {
                if (!activeChatContact || activeChatContact.uid !== groupId) return;
                const val = snap.val() || {};
                const activeMembers = Object.entries(val).filter(([u, data]) => data && data.inGroup);
                if (activeMembers.length > 0) {
                    currentGroupOnlineCount = Math.max(currentGroupOnlineCount, activeMembers.length);
                    updateGroupChatHeaderStatus();
                }
            });
        } catch(e) {}
    }

    // 3. Digitação em tempo real no grupo via Firestore (Canal Primário Seguro)
    if (currentUser) {
        try {
            currentGroupActivityUnsubscribe = onSnapshot(collection(db, 'chats', `group_${groupId}`, 'activity'), (snap) => {
                if (!activeChatContact || activeChatContact.uid !== groupId) return;
                currentGroupTypingUsers.clear();
                const now = Date.now();
                snap.forEach(d => {
                    const data = d.data();
                    if (data && data.active && data.fromUid !== currentUser.uid && (data.expiresAt ? data.expiresAt > now : data.updatedAt > now - 5000)) {
                        currentGroupTypingUsers.set(data.fromUid, data.fromName || 'Membro');
                    }
                });
                updateGroupChatHeaderStatus();
            }, (err) => console.warn('Erro ao escutar digitação no grupo:', err));
        } catch(e) {}
    }

    // 4. Digitação em tempo real no grupo via RTDB (Canal Secundário)
    if (typeof rtdb !== 'undefined' && currentUser) {
        try {
            const typingRef = ref(rtdb, `group_typing/${groupId}`);
            currentGroupRtdbActivityUnsubscribe = onValue(typingRef, (snap) => {
                if (!activeChatContact || activeChatContact.uid !== groupId) return;
                const val = snap.val() || {};
                const now = Date.now();
                Object.entries(val).forEach(([u, data]) => {
                    if (u !== currentUser.uid && data && data.active && (now - (data.updatedAt || 0) < 5000)) {
                        currentGroupTypingUsers.set(u, data.name || 'Membro');
                    }
                });
                updateGroupChatHeaderStatus();
            });
        } catch(e) {}
    }

    // 5. Listener do documento do grupo no Firestore
    try {
        currentGroupDocUnsubscribe = onSnapshot(doc(db, 'groups', groupId), (snap) => {
            if (snap.exists()) {
                activeGroupDoc = { id: snap.id, ...snap.data() };
                if (activeChatContact && activeChatContact.uid === groupId) {
                    activeChatContact.paused = !!activeGroupDoc.paused;
                    activeChatContact.members = activeGroupDoc.members || [];
                    activeChatContact.avatar = activeGroupDoc.avatar || '';
                    activeChatContact.name = activeGroupDoc.name || activeChatContact.name || 'Grupo VIP';

                    const aEl = document.getElementById('chat-window-avatar');
                    const nEl = document.getElementById('chat-window-name');
                    if (aEl) {
                        if (activeChatContact.avatar) {
                            aEl.style.backgroundImage = `url('${activeChatContact.avatar}')`;
                            aEl.innerText = '';
                        } else {
                            aEl.style.backgroundImage = '';
                            aEl.innerText = activeChatContact.name.charAt(0).toUpperCase() || 'G';
                        }
                    }
                    if (nEl) {
                        nEl.innerText = activeChatContact.name;
                    }

                    const cInp = document.getElementById('chat-input-main');
                    const cBtn = document.getElementById('chat-send-btn-main');
                    if (cInp) {
                        cInp.disabled = !!activeGroupDoc.paused;
                        cInp.placeholder = activeGroupDoc.paused ? 'Grupo pausado pelo administrador' : 'Digite uma mensagem...';
                    }
                    if (cBtn) cBtn.disabled = !!activeGroupDoc.paused;
                    updateGroupChatHeaderStatus();
                }
            }
        });
    } catch(e) {}

    showToast('Grupo', `${group.name || 'Grupo VIP'} aberto.`, 'blue');

    const chatInput = document.getElementById('chat-input-main');
    const chatSendButton = document.getElementById('chat-send-btn-main');
    if (chatInput) {
        chatInput.disabled = !!group.paused;
        chatInput.placeholder = group.paused ? 'Grupo pausado pelo administrador' : 'Digite uma mensagem...';
    }
    if (chatSendButton) chatSendButton.disabled = !!group.paused;
    updateActiveChatBlockedUI();
    loadRealtimeMessages();
}

function getActiveChatId() {
    if (!currentUser || !activeChatContact) return null;
    if (activeChatContact.isGroup) return `group_${activeChatContact.uid}`;
    return [currentUser.uid, activeChatContact.uid].sort().join('_');
}

let bioBubbleTimer = null;

export function startBioBubbleTimer(durationMs = 60000) {
    if (bioBubbleTimer) {
        clearTimeout(bioBubbleTimer);
        bioBubbleTimer = null;
    }
    const bubble = document.getElementById('chat-bio-bubble');
    if (bubble) {
        bubble.classList.remove('bubble-expired', 'scrolled-hide');
    }
    bioBubbleTimer = setTimeout(() => {
        const b = document.getElementById('chat-bio-bubble');
        if (b) {
            b.classList.add('bubble-expired');
            const fadeTimer = setTimeout(() => {
                if (b && b.classList.contains('bubble-expired')) {
                    b.style.display = 'none';
                }
            }, 350);
            if (fadeTimer && typeof fadeTimer.unref === 'function') fadeTimer.unref();
        }
        bioBubbleTimer = null;
    }, durationMs);
    if (bioBubbleTimer && typeof bioBubbleTimer.unref === 'function') {
        bioBubbleTimer.unref();
    }
}

export function updateChatBioBubble(contactBio) {
    const bubble = document.getElementById('chat-bio-bubble');
    const dot = document.getElementById('chat-bio-bubble-dot');
    const textEl = document.getElementById('chat-bio-bubble-text');
    if (!bubble) return;

    if (!activeChatContact || activeChatContact.isGroup || !contactBio) {
        bubble.style.display = 'none';
        return;
    }

    const bioLower = contactBio.toLowerCase();
    const isBusy = bioLower.includes('indispon') || bioLower.includes('ocupad') || bioLower.includes('offline') || bioLower.includes('ausente');

    if (dot) {
        dot.className = `bio-bubble-dot ${isBusy ? 'dot-busy' : 'dot-available'}`;
    }

    if (textEl) {
        textEl.innerText = contactBio;
        textEl.title = `Recado: ${contactBio}`;
    }

    // Se já se passaram 60 segundos nesta conversa aberta, não reabre
    if (bubble.classList.contains('bubble-expired')) {
        bubble.style.display = 'none';
        return;
    }

    bubble.style.display = 'inline-flex';

    // Alinhamento dinâmico sob o avatar do contato
    const avatar = document.getElementById('chat-window-avatar');
    const chatWin = document.getElementById('chat-window');
    if (avatar && chatWin && typeof avatar.getBoundingClientRect === 'function' && typeof chatWin.getBoundingClientRect === 'function') {
        try {
            const avatarRect = avatar.getBoundingClientRect();
            const winRect = chatWin.getBoundingClientRect();
            if (avatarRect.width > 0 && winRect.width > 0) {
                const top = Math.max(56, avatarRect.bottom - winRect.top + 4);
                const left = Math.max(12, (avatarRect.left - winRect.left) - 8);
                bubble.style.top = `${top}px`;
                bubble.style.left = `${left}px`;
                const avatarCenter = (avatarRect.left - winRect.left) + (avatarRect.width / 2);
                const beak = bubble.querySelector('.bio-bubble-beak');
                if (beak) {
                    const beakOffset = Math.max(14, Math.min(avatarCenter - left - 7, 120));
                    beak.style.left = `${beakOffset}px`;
                }
            }
        } catch (e) {
            // fallback para posicionamento padrão via CSS
        }
    }
}

function refreshDirectChatStatus() {
    const statusEl = document.getElementById('chat-window-status');
    const chatDot = document.getElementById('chat-window-online-dot');
    const bioEl = document.getElementById('chat-window-bio');
    const sepEl = document.getElementById('chat-header-sep');
    const badgeEl = document.getElementById('chat-window-verified-badge');
    const bioBubble = document.getElementById('chat-bio-bubble');
    if (!statusEl || !activeChatContact || activeChatContact.isGroup) {
        if (bioEl) bioEl.style.display = 'none';
        if (sepEl) sepEl.style.display = 'none';
        if (bioBubble) bioBubble.style.display = 'none';
        return;
    }

    const contactBio = (activeContactUserData && activeContactUserData.status) ? activeContactUserData.status.trim() : (activeChatContact && activeChatContact.status ? activeChatContact.status.trim() : '');
    if (bioEl) {
        bioEl.innerText = contactBio ? `"${contactBio}"` : '';
        bioEl.title = `Recado: ${contactBio}`;
        // Removido da exibição no cabeçalho do contato a pedido do usuário
        bioEl.style.display = 'none';
        if (sepEl) sepEl.style.display = 'none';
    }
    updateChatBioBubble(contactBio);

    if (badgeEl) {
        const isVip = activeContactUserData ? (
            checkIsVipUser(activeContactUserData) ||
            activeContactUserData.isVip ||
            activeContactUserData.isVerified ||
            (activeContactUserData.email && activeContactUserData.email.toLowerCase() === 'dxhub.oficial@gmail.com') ||
            (activeContactUserData.username && activeContactUserData.username.toLowerCase().replace('@', '') === 'dxhuboficial') ||
            (activeContactUserData.name && activeContactUserData.name.includes('DX Hub'))
        ) : (
            checkIsVipUser(activeChatContact) ||
            activeChatContact.isVip ||
            activeChatContact.isVerified ||
            (activeChatContact.email && activeChatContact.email.toLowerCase() === 'dxhub.oficial@gmail.com') ||
            (activeChatContact.username && activeChatContact.username.toLowerCase().replace('@', '') === 'dxhuboficial') ||
            (activeChatContact.name && activeChatContact.name.includes('DX Hub'))
        );
        badgeEl.style.display = isVip ? 'inline-flex' : 'none';
        badgeEl.classList.toggle('active', !!isVip);
        if (window.lucide) lucide.createIcons();
    }

    if (blockedContactsSet.has(activeChatContact.uid)) {
        statusEl.className = 'status-animated status-offline';
        statusEl.innerText = 'Bloqueado';
        if (chatDot) chatDot.style.display = 'none';
        return;
    }
    if (isBlockedByActiveContact) {
        statusEl.className = 'status-animated status-offline';
        statusEl.innerText = 'Indisponível';
        if (chatDot) chatDot.style.display = 'none';
        return;
    }

    if (activeContactActivity) {
        statusEl.className = 'status-animated status-activity';
        statusEl.innerHTML = createActivityIndicatorHTML(activeContactActivity);
        if (window.lucide) lucide.createIcons();
        if (chatDot) chatDot.style.display = 'block';
        return;
    }

    if (activeContactUserData) {
        const isOnline = !!(activeContactUserData.online && !activeContactUserData.ghostMode);
        if (isOnline) {
            statusEl.className = 'status-animated status-online';
            statusEl.innerText = 'Online';
            if (chatDot) chatDot.style.display = 'block';
        } else {
            statusEl.className = 'status-animated status-offline';
            statusEl.innerText = formatLastSeen(activeContactUserData.lastSeen);
            if (chatDot) chatDot.style.display = 'none';
        }
    } else {
        statusEl.className = 'status-animated status-offline';
        statusEl.innerText = 'Visto recentemente';
        if (chatDot) chatDot.style.display = 'none';
    }
}

function openDirectChat(contact) {
    cleanupActiveGroupListeners();
    const leaveGroupTrigger = document.getElementById('chat-leave-group-trigger');
    if (leaveGroupTrigger) leaveGroupTrigger.style.display = 'none';

    activeChatContact = contact;
    const windowEl = document.getElementById('chat-window');
    const nameEl = document.getElementById('chat-window-name');
    const statusEl = document.getElementById('chat-window-status');
    const avatarEl = document.getElementById('chat-window-avatar');

    // Ocultar imediatamente o sino e o badge do contato ao abrir a conversa
    const unreadBadge = document.getElementById(`unread-badge-${contact.uid}`);
    const chatBell = document.getElementById(`chat-bell-${contact.uid}`);
    if (unreadBadge) {
        unreadBadge.style.display = 'none';
        unreadBadge.classList.remove('active');
    }
    if (chatBell) chatBell.style.display = 'none';

    const contactCard = document.querySelector(`.chat-card[data-uid="${contact.uid}"]`);
    if (contactCard) {
        contactCard.classList.remove('unread');
        contactCard.dataset.unread = 'false';
        contactCard.dataset.unreadCount = '0';
    }
    if (typeof applyChatFilter === 'function') applyChatFilter();

    exitSelectionMode();
    cancelReply();
    hideFloatingReactions();

    if (nameEl) nameEl.innerText = contact.name || 'Contato';
    if (avatarEl) {
        setAvatarContent(avatarEl, contact.avatar, contact.name, 'chat-window-avatar-initial');
    }
    const openChatDot = document.getElementById('chat-window-online-dot');
    if (openChatDot) {
        openChatDot.style.display = (contact.online && !contact.ghostMode) ? 'block' : 'none';
    }
    if (typeof updateChatPinUI === 'function') updateChatPinUI();
    startBioBubbleTimer();
    refreshDirectChatStatus();

    // Tocar nas informações do contato (avatar/nome) abre os Dados do Contato
    const headerUserInfo = document.getElementById('chat-header-user-info');
    if (headerUserInfo) {
        headerUserInfo.onclick = (e) => {
            if (e) {
                e.stopPropagation();
                if (e.target && e.target.closest && (e.target.closest('#close-chat') || e.target.closest('.header-icon-btn'))) {
                    return;
                }
            }
            if (activeChatContact && !activeChatContact.isGroup) {
                openContactProfile(activeChatContact);
            }
        };
    }

    // Tocar no balãozinho de recado abre os Dados do Contato
    const bioBubble = document.getElementById('chat-bio-bubble');
    if (bioBubble) {
        bioBubble.classList.remove('scrolled-hide', 'bubble-expired');
        bioBubble.onclick = (e) => {
            if (e) e.stopPropagation();
            if (activeChatContact && !activeChatContact.isGroup) {
                openContactProfile(activeChatContact);
            }
        };
    }

    const msgContainer = document.getElementById('message-container');
    if (msgContainer && !msgContainer._bioBubbleScrollBound) {
        msgContainer._bioBubbleScrollBound = true;
        msgContainer.addEventListener('scroll', () => {
            const bubble = document.getElementById('chat-bio-bubble');
            if (bubble && bubble.style.display !== 'none' && !bubble.classList.contains('bubble-expired')) {
                if (msgContainer.scrollTop > 50) {
                    bubble.classList.add('scrolled-hide');
                } else {
                    bubble.classList.remove('scrolled-hide');
                }
            }
        }, { passive: true });
    }
    
    if (contactStatusUnsubscribe) contactStatusUnsubscribe();
    if (activeChatActivityUnsubscribe) activeChatActivityUnsubscribe();
    if (blockedByContactUnsubscribe) blockedByContactUnsubscribe();
    if (activeContactActivityTimer) {
        clearTimeout(activeContactActivityTimer);
        activeContactActivityTimer = null;
    }
    activeContactActivity = null;
    activeContactUserData = null;
    isBlockedByActiveContact = false;

    blockedByContactUnsubscribe = onSnapshot(
        doc(db, 'users', contact.uid, 'blocked', currentUser.uid),
        (snap) => {
            isBlockedByActiveContact = snap.exists();
            updateActiveChatBlockedUI();
            refreshDirectChatStatus();
        },
        () => {}
    );

    activeChatActivityUnsubscribe = onSnapshot(
        doc(db, 'users', currentUser.uid, 'activity', contact.uid),
        (activitySnap) => {
            if (!statusEl) return;
            if (blockedContactsSet.has(contact.uid) || isBlockedByActiveContact) {
                activeContactActivity = null;
                refreshDirectChatStatus();
                return;
            }
            if (activeContactActivityTimer) {
                clearTimeout(activeContactActivityTimer);
                activeContactActivityTimer = null;
            }

            const activity = activitySnap.exists() ? activitySnap.data() : {};
            const isActive = activitySnap.exists() && !!activity.active && (activity.expiresAt || 0) > Date.now();
            activeContactActivity = isActive ? activity : null;

            refreshDirectChatStatus();

            if (isActive) {
                const remainingMs = Math.max(500, (activity.expiresAt || 0) - Date.now());
                activeContactActivityTimer = setTimeout(() => {
                    activeContactActivity = null;
                    refreshDirectChatStatus();
                }, remainingMs);
            }
        },
        (error) => console.error('Erro ao ouvir atividade do chat:', error)
    );

    contactStatusUnsubscribe = onSnapshot(doc(db, 'users', contact.uid), (snap) => {
        if (snap.exists()) {
            activeContactUserData = snap.data();
            refreshDirectChatStatus();

            const liveAvatar = activeContactUserData.avatar || '';
            const liveName = activeContactUserData.name || contact.name || 'Contato';
            const liveBio = (activeContactUserData.status && activeContactUserData.status.trim()) ? activeContactUserData.status.trim() : 'Disponível no VORTEX ⚡';

            if (activeChatContact && activeChatContact.uid === contact.uid) {
                activeChatContact.avatar = liveAvatar;
                activeChatContact.name = liveName;
                activeChatContact.status = liveBio;
            }

            contact.avatar = liveAvatar;
            contact.name = liveName;
            contact.status = liveBio;

            const curAvatarEl = document.getElementById('chat-window-avatar');
            const curNameEl = document.getElementById('chat-window-name');
            if (curAvatarEl) {
                setAvatarContent(curAvatarEl, liveAvatar, liveName, 'chat-window-avatar-initial');
                const chatDot = document.getElementById('chat-window-online-dot');
                if (chatDot) {
                    const isOnline = activeContactUserData && activeContactUserData.online && !activeContactUserData.ghostMode && !blockedContactsSet.has(contact.uid) && !isBlockedByActiveContact;
                    chatDot.style.display = isOnline ? 'block' : 'none';
                }
            }
            if (curNameEl) {
                curNameEl.innerText = liveName;
            }

            const listAvatarEl = document.getElementById(`contact-avatar-${contact.uid}`);
            if (listAvatarEl) {
                setAvatarContent(listAvatarEl, liveAvatar, liveName, `avatar-initial-${contact.uid}`);
                const listDot = document.getElementById(`online-dot-${contact.uid}`);
                if (listDot) {
                    const isOnline = activeContactUserData && activeContactUserData.online && !activeContactUserData.ghostMode;
                    listDot.style.display = isOnline ? 'block' : 'none';
                }
            }
            const cardEl = document.querySelector(`.chat-card[data-uid="${contact.uid}"]`);
            if (cardEl) {
                const cardName = cardEl.querySelector('.name-text') || cardEl.querySelector('.name');
                if (cardName && liveName) cardName.innerText = liveName;
            }

            // Atualiza card intro no chat se visível
            const introBioText = document.querySelector(`#chat-intro-${contact.uid} .intro-bio-text`);
            if (introBioText) {
                introBioText.innerText = `"${liveBio}"`;
            }

            if (currentUser && currentUser.uid) {
                updateDoc(doc(db, 'users', currentUser.uid, 'contacts', contact.uid), {
                    avatar: liveAvatar,
                    name: liveName,
                    status: liveBio
                }).catch(() => {});
            }
        }
    }, (error) => console.error('Erro ao ouvir status do contato:', error));

    updateActiveChatBlockedUI();
    loadRealtimeMessages();
    if (windowEl) windowEl.classList.add('active');
    playSound(clickSound);
}

function loadRealtimeMessages() {
    if (!currentUser || !activeChatContact) return;
    if (currentChatUnsubscribe) currentChatUnsubscribe();

    const chatId = getActiveChatId();
    if (!chatId) return;
    const messagesQuery = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(100));

    currentChatUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
        const container = document.getElementById('message-container');
        if (!container) return;
        container.innerHTML = '';
        currentChatMessagesMap.clear();

        // Marcar mensagens como lidas
        snapshot.forEach(docSnap => {
            const message = { id: docSnap.id, ...docSnap.data() };
            currentChatMessagesMap.set(docSnap.id, message);
            if (message.deletedFor && message.deletedFor.includes(currentUser.uid)) return;
            if (!activeChatContact.isGroup && (blockedContactsSet.has(message.senderUid) || (message.senderUid && blockedContactsSet.has(message.senderUid)))) return;
            const sender = message.senderUid || message.fromUid;
            const isFromOther = sender ? sender !== currentUser.uid : true;
            const isRead = (Array.isArray(message.readBy) && message.readBy.includes(currentUser.uid)) || (message.readByMap && !!message.readByMap[currentUser.uid]);
            if (isFromOther && !message.deletedForEveryone && !isRead) {
                updateDoc(docSnap.ref, { 
                    readBy: arrayUnion(currentUser.uid),
                    [`readByMap.${currentUser.uid}`]: Date.now()
                }).catch(() => {});
            }
        });

        // Atualizar badge e sino de não lido
        if (activeChatContact) {
            const prefix = activeChatContact.isGroup ? 'group-' : '';
            const unreadBadge = document.getElementById(`unread-badge-${prefix}${activeChatContact.uid}`);
            const chatBell = document.getElementById(`chat-bell-${prefix}${activeChatContact.uid}`);
            if (unreadBadge) {
                unreadBadge.style.display = 'none';
                unreadBadge.classList.remove('active');
            }
            if (chatBell) chatBell.style.display = 'none';

            const cardEl = document.querySelector(`.chat-card[data-uid="${activeChatContact.uid}"]`);
            if (cardEl) {
                cardEl.classList.remove('unread');
                cardEl.dataset.unread = 'false';
                cardEl.dataset.unreadCount = '0';
            }
            if (typeof applyChatFilter === 'function') applyChatFilter();
        }

        // Card de Apresentação do Contato com Recado / Bio no topo da conversa
        if (!activeChatContact.isGroup) {
            const introCard = document.createElement('div');
            introCard.className = 'chat-contact-intro-card';
            introCard.id = `chat-intro-${activeChatContact.uid}`;
            const contactBio = (activeContactUserData && activeContactUserData.status) ? activeContactUserData.status.trim() : (activeChatContact.status ? activeChatContact.status.trim() : 'Disponível no VORTEX ⚡');
            const contactUsername = (activeContactUserData && activeContactUserData.username) || activeChatContact.username || '@usuario';
            const isVip = activeContactUserData ? checkIsVipUser(activeContactUserData) : !!activeChatContact.isVip;
            const contactName = activeChatContact.name || 'Contato';
            const contactAvatar = activeChatContact.avatar || '';

            introCard.innerHTML = `
                <div class="intro-avatar" style="background-image: url('${contactAvatar}');" role="button" tabindex="0" title="Ver dados do contato">
                    ${!contactAvatar ? contactName.charAt(0).toUpperCase() : ''}
                </div>
                <h3 class="intro-name" role="button" tabindex="0" title="Ver dados do contato">
                    <span>${contactName}</span>
                    <i data-lucide="badge-check" class="verified-badge" style="display:${isVip ? 'inline-flex' : 'none'};"></i>
                </h3>
                <span class="intro-username">${contactUsername}</span>
                <div class="intro-bio-box" role="button" tabindex="0" title="Toque para ver os dados do contato">
                    <i data-lucide="quote" class="intro-bio-icon"></i>
                    <div>
                        <span class="intro-bio-label">Recado / Bio:</span>
                        <span class="intro-bio-text">"${contactBio}"</span>
                    </div>
                </div>
                <small class="intro-privacy-notice"><i data-lucide="lock"></i> As mensagens desta conversa são protegidas e privadas.</small>
            `;
            introCard.onclick = () => openContactProfile(activeChatContact);
            container.appendChild(introCard);
        }

        snapshot.forEach(docSnap => {
            const msg = { id: docSnap.id, ...docSnap.data() };
            if (msg.deletedFor && msg.deletedFor.includes(currentUser.uid)) return;
            if (!activeChatContact.isGroup && msg.senderUid !== currentUser.uid && blockedContactsSet.has(msg.senderUid)) {
                return;
            }

            const isMe = msg.senderUid === currentUser.uid;
            const hasBeenSeen = (msg.readBy || []).some(uid => uid !== currentUser.uid);
            const isSelected = selectedMessageIds.has(msg.id);
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isMe ? 'sent' : 'received'} ${msg.deletedForEveryone ? 'deleted-msg' : ''} ${isSelected ? 'selected' : ''}`;
            msgDiv.dataset.id = msg.id;

            let forwardedHTML = msg.forwarded ? `<div class="forwarded-tag"><i data-lucide="forward" style="width: 12px; height: 12px;"></i> Encaminhada</div>` : '';

            let quotedHTML = '';
            if (msg.replyTo && !msg.deletedForEveryone) {
                quotedHTML = `
                    <div class="quoted-reply-box">
                        <span class="quoted-reply-author">${msg.replyTo.senderName}</span>
                        <div class="quoted-reply-text">${msg.replyTo.text || 'Mídia / Anexo'}</div>
                    </div>
                `;
            }

            let mediaHTML = '';
            if (msg.deletedForEveryone) {
                mediaHTML = `<div>🚫 Esta mensagem foi apagada</div>`;
            } else if (msg.uploadState === 'uploading') {
                const uploadPercent = Math.max(0, Math.min(100, Number(msg.uploadPercent) || 0));
                const isVideoUpload = msg.type === 'video';
                mediaHTML = `
                    <div class="remote-upload-status ${isVideoUpload ? 'remote-video-upload' : 'remote-media-upload'}">
                        <div class="remote-upload-icon"><i data-lucide="${isVideoUpload ? 'video' : (msg.type === 'image' ? 'image' : (msg.type === 'audio' ? 'music' : 'file-text'))}"></i></div>
                        <div class="remote-upload-info">
                            <strong>${isVideoUpload ? 'Carregando vídeo' : 'Carregando arquivo'}</strong>
                            <span>${msg.fileName || 'Mídia'}${isVideoUpload ? ` - ${uploadPercent}%` : ''}</span>
                            ${isVideoUpload ? `<div class="remote-upload-progress"><span style="width:${uploadPercent}%"></span></div>` : ''}
                        </div>
                        ${isVideoUpload ? '' : '<div class="remote-upload-spinner"></div>'}
                    </div>
                `;
            } else {
                if (msg.type === 'audio') {
                    const durMatch = (msg.text || '').match(/\((.*?)\)/);
                    const durFromText = durMatch ? parseAudioDuration(durMatch[1]) : '';
                    const durFromMsg = parseAudioDuration(msg.duration);
                    let dur = durFromMsg || durFromText || '';
                    if (!dur || dur === '00:05') {
                        dur = '00:00';
                    }
                    mediaHTML = `
                        <div class="audio-player-ui" data-src="${msg.fileData || ''}" data-total-duration="${dur}">
                            <i data-lucide="play" style="width: 16px; height: 16px; cursor: pointer;"></i>
                            <div class="waveform">
                                ${Array.from({ length: 14 }, () => `<div class="wave-bar" style="height: ${Math.floor(Math.random() * 12) + 4}px"></div>`).join('')}
                            </div>
                            <span class="audio-duration-text">${dur !== '00:00' ? dur : '00:00'}</span>
                            <button class="audio-speed-btn" type="button">1x</button>
                        </div>
                    `;
                } else if (msg.type === 'image') {
                    if (msg.viewOnce) {
                        const hasViewed = Array.isArray(msg.viewedBy) && msg.viewedBy.includes(currentUser.uid);
                        if (hasViewed) {
                            mediaHTML = `
                                <div class="view-once-bubble opened">
                                    <span class="view-once-badge">✓</span>
                                    <i data-lucide="circle-dashed"></i>
                                    <span>Foto (aberta)</span>
                                </div>
                            `;
                        } else {
                            mediaHTML = `
                                <div class="view-once-bubble unopened" data-src="${msg.fileData || ''}" data-msg-id="${msg.id}">
                                    <span class="view-once-badge">1</span>
                                    <i data-lucide="eye"></i>
                                    <span>Foto de visualização única</span>
                                </div>
                            `;
                        }
                    } else {
                        mediaHTML = `<img src="${msg.fileData}" alt="Imagem" class="chat-clickable-image" style="max-width:100%; border-radius:10px; margin-bottom:4px; cursor:pointer;">`;
                    }
                } else if (msg.type === 'video') {
                    mediaHTML = `<video src="${msg.fileData}" controls playsinline style="max-width:100%; border-radius:10px; margin-bottom:4px;"></video>`;
                } else if (msg.type === 'file') {
                    mediaHTML = `
                        <a href="${msg.fileData}" download="${msg.fileName || 'arquivo'}" class="file-attachment-card">
                            <i data-lucide="file-text"></i>
                            <div class="file-info">
                                <div class="file-name">${msg.fileName || 'Arquivo'}</div>
                                <div class="file-size">${msg.fileSize || 'Baixar'}</div>
                            </div>
                            <i data-lucide="download" style="width:16px;"></i>
                        </a>
                    `;
                } else if (msg.type === 'poll' || msg.poll) {
                    const poll = msg.poll;
                    if (poll) {
                        const totalVotes = Array.isArray(poll.options) 
                            ? poll.options.reduce((acc, opt) => acc + (Array.isArray(opt.votes) ? opt.votes.length : 0), 0) 
                            : 0;
                        const allowMultiple = !!poll.allowMultiple;
                        const isCheckbox = allowMultiple;

                        const optionsHTML = (poll.options || []).map(opt => {
                            const optVotes = Array.isArray(opt.votes) ? opt.votes : [];
                            const voteCount = optVotes.length;
                            const isVoted = currentUser ? optVotes.includes(currentUser.uid) : false;
                            const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

                            return `
                                <div class="poll-option-row ${isVoted ? 'voted' : ''}" data-msg-id="${msg.id}" data-opt-id="${opt.id}">
                                    <div class="poll-option-fill" style="width: ${pct}%;"></div>
                                    <div class="poll-option-content">
                                        <div class="poll-option-indicator">
                                            <div class="poll-check-icon ${isCheckbox ? 'checkbox' : 'radio'}">
                                                ${isVoted ? '✓' : ''}
                                            </div>
                                            <span class="poll-option-text">${escapeHTML(opt.text || '')}</span>
                                        </div>
                                        <div class="poll-option-meta">
                                            <span class="poll-option-count">${voteCount}</span>
                                            <span class="poll-option-pct">${pct}%</span>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('');

                        const votesLabel = totalVotes === 1 ? '1 voto' : `${totalVotes} votos`;
                        mediaHTML = `
                            <div class="poll-message-card" data-msg-id="${msg.id}">
                                <div class="poll-card-header">
                                    <span class="poll-card-tag"><i data-lucide="bar-chart-2" style="width: 13px; height: 13px;"></i> Enquete</span>
                                    <div class="poll-card-question">${escapeHTML(poll.question || '')}</div>
                                </div>
                                <div class="poll-card-options">
                                    ${optionsHTML}
                                </div>
                                <div class="poll-card-footer">
                                    <span class="poll-total-votes">${votesLabel} • ${allowMultiple ? 'Múltiplas escolhas' : 'Escolha única'}</span>
                                    <button type="button" class="poll-view-votes-btn" data-msg-id="${msg.id}">
                                        <i data-lucide="info" style="width: 14px; height: 14px;"></i> Ver votos
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                }
            }

            let textHTML = (msg.text && !msg.deletedForEveryone && msg.type !== 'poll') ? `<div>${msg.text}</div>` : '';
            const d = msg.createdAt ? new Date(msg.createdAt) : new Date();
            const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

            let reactionsHTML = '';
            if (msg.reactions && Object.keys(msg.reactions).length > 0 && !msg.deletedForEveryone) {
                const emojis = Object.values(msg.reactions);
                const uniqueEmojis = [...new Set(emojis.map(r => typeof r === 'object' ? r.emoji : r))].join('');
                reactionsHTML = `<div class="reactions-wrapper">${uniqueEmojis} <span style="font-size: 0.65rem; color: #fff;">${emojis.length > 1 ? emojis.length : ''}</span></div>`;
            }

            let groupSenderHTML = '';
            if (activeChatContact && activeChatContact.isGroup) {
                const rawName = msg.senderName || msg.fromName || (isMe ? (currentProfile?.name || currentUser?.displayName || 'Você') : 'Membro');
                if (msg.senderUid && rawName && rawName !== 'Contato' && rawName !== 'Membro') {
                    groupMemberNamesCache.set(msg.senderUid, rawName);
                }
                const resolvedName = (rawName && rawName !== 'Membro') ? rawName : (groupMemberNamesCache.get(msg.senderUid) || 'Membro');
                if (isMe) {
                    const isMyVip = checkIsVipUser(currentProfile);
                    groupSenderHTML = `
                        <div class="group-sender-name group-sender-me" title="Enviado por você">
                            <span class="group-sender-name-text">${escapeHTML(resolvedName)} (Você)</span>
                            <i data-lucide="badge-check" class="verified-badge" style="display:${isMyVip ? 'inline-flex' : 'none'};"></i>
                        </div>
                    `;
                } else {
                    const color = getGroupSenderColor(msg.senderUid);
                    const isSenderVip = !!(msg.isVip || msg.isVerified || (msg.senderEmail === 'dxhub.oficial@gmail.com') || (msg.senderUsername === 'dxhuboficial'));
                    groupSenderHTML = `
                        <div class="group-sender-name" style="color: ${color};" title="Enviado por ${escapeHTML(resolvedName)}">
                            <span class="group-sender-name-text">${escapeHTML(resolvedName)}</span>
                            <i data-lucide="badge-check" class="verified-badge" style="display:${isSenderVip ? 'inline-flex' : 'none'};"></i>
                        </div>
                    `;
                }
            }

            msgDiv.innerHTML = `
                ${groupSenderHTML}
                ${forwardedHTML}
                ${quotedHTML}
                ${mediaHTML}
                ${textHTML}
                <div class="msg-status">
                    ${msg.isEdited && !msg.deletedForEveryone ? `<span class="msg-edited-tag" title="Mensagem editada"><i data-lucide="pencil"></i>Editada</span>` : ''}
                    <span class="msg-time">${timeStr}</span>
                    ${isMe && !msg.deletedForEveryone ? `<i data-lucide="check-check" class="seen-icon ${hasBeenSeen ? 'seen-confirmed' : 'seen-pending'}" title="${hasBeenSeen ? 'Visualizada' : 'Não visualizada'}"></i>` : ''}
                </div>
                ${reactionsHTML}
            `;

            if (activeChatContact && activeChatContact.isGroup && !isMe && msg.senderUid) {
                const currentName = msg.senderName || msg.fromName;
                if (!currentName || currentName === 'Membro' || currentName === 'Contato') {
                    if (typeof getDoc === 'function' && typeof doc === 'function') {
                        getDoc(doc(db, 'users', msg.senderUid)).then(uSnap => {
                            if (uSnap.exists()) {
                                const uData = uSnap.data();
                                const fetchedName = uData.name || uData.username;
                                if (fetchedName) {
                                    groupMemberNamesCache.set(msg.senderUid, fetchedName);
                                    const senderEl = msgDiv.querySelector('.group-sender-name .group-sender-name-text');
                                    if (senderEl) senderEl.innerText = fetchedName;
                                }
                            }
                        }).catch(() => {});
                    }
                }
            }

            msgDiv.addEventListener('click', () => {
                if (isMultiSelectMode) {
                    toggleMessageSelection(msg.id, msgDiv);
                }
            });

            setupSwipeToReply(msgDiv, msg);

            msgDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (!isMultiSelectMode) showFloatingReactions(msg, msgDiv, e);
            });

            let pressTimer;
            msgDiv.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    if (!isMultiSelectMode) showFloatingReactions(msg, msgDiv, e.touches[0]);
                }, 500);
            }, { passive: true });
            msgDiv.addEventListener('touchend', () => clearTimeout(pressTimer));

            const audioUi = msgDiv.querySelector('.audio-player-ui');
            const speedBtn = msgDiv.querySelector('.audio-speed-btn');

            if (audioUi) {
                const durSpan = audioUi.querySelector('.audio-duration-text');
                const currDur = durSpan ? durSpan.innerText.trim() : '';
                if (msg.fileData && (!currDur || currDur === '00:00' || currDur === '00:05')) {
                    try {
                        const tempAudio = new Audio();
                        tempAudio.preload = 'metadata';
                        tempAudio.onloadedmetadata = () => {
                            if (tempAudio.duration && isFinite(tempAudio.duration) && tempAudio.duration > 0) {
                                const realDur = formatAudioTime(tempAudio.duration);
                                if (durSpan && !audioUi.classList.contains('playing')) {
                                    durSpan.innerText = realDur;
                                }
                                audioUi.dataset.totalDuration = realDur;
                            }
                        };
                        tempAudio.src = msg.fileData;
                    } catch (_) {}
                }

                audioUi.onclick = (e) => {
                    if (e.target.closest('.audio-speed-btn')) return;
                    playVoiceNote(audioUi, msg.fileData);
                };
            }

            // Visualização Única e Foto em Tela Cheia
            const viewOnceUnopened = msgDiv.querySelector('.view-once-bubble.unopened');
            if (viewOnceUnopened) {
                viewOnceUnopened.onclick = (e) => {
                    e.stopPropagation();
                    const src = viewOnceUnopened.dataset.src;
                    const msgId = viewOnceUnopened.dataset.msgId;
                    if (src) {
                        openViewOnceModal(src);
                        if (msgId && chatId) {
                            updateDoc(doc(db, 'chats', chatId, 'messages', msgId), {
                                viewedBy: arrayUnion(currentUser.uid)
                            }).catch(() => {});
                        }
                    }
                };
            }

            const chatImg = msgDiv.querySelector('.chat-clickable-image');
            if (chatImg) {
                chatImg.onclick = (e) => {
                    e.stopPropagation();
                    openViewOnceModal(chatImg.src);
                };
            }

            // Enquetes: clique em opção para votar e botão para ver detalhes dos votos
            if (msg.type === 'poll' || msg.poll) {
                const optionRows = msgDiv.querySelectorAll('.poll-option-row');
                optionRows.forEach(row => {
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (isMultiSelectMode) {
                            toggleMessageSelection(msg.id, msgDiv);
                            return;
                        }
                        const optId = row.dataset.optId;
                        if (typeof voteOnPoll === 'function') {
                            voteOnPoll(msg.id, optId);
                        }
                    });
                });

                const viewVotesBtn = msgDiv.querySelector('.poll-view-votes-btn');
                if (viewVotesBtn) {
                    viewVotesBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (typeof openPollVotesModal === 'function') {
                            openPollVotesModal(msg.poll);
                        }
                    });
                }
            }

            if (speedBtn) {
                speedBtn.onclick = (e) => {
                    e.stopPropagation();
                    const speeds = ['1x', '1.5x', '2x'];
                    let current = speedBtn.innerText.trim();
                    let nextIdx = (speeds.indexOf(current) + 1) % speeds.length;
                    speedBtn.innerText = speeds[nextIdx];
                    speedBtn.classList.toggle('active-speed', speeds[nextIdx] !== '1x');

                    if (currentPlayingAudio && audioUi.classList.contains('playing')) {
                        currentPlayingAudio.playbackRate = parseFloat(speeds[nextIdx]);
                    }
                };
            }

            container.appendChild(msgDiv);
        });

        if (window.lucide) lucide.createIcons();
        container.scrollTop = container.scrollHeight;
    });
}

/* ==========================================================================
   SELEÇÃO MÚLTIPLA & EXCLUSÃO
   ========================================================================== */
function enterSelectionMode(initialMsgId = null) {
    isMultiSelectMode = true;
    selectedMessageIds.clear();
    if (initialMsgId) selectedMessageIds.add(initialMsgId);

    document.getElementById('chat-normal-header')?.classList.add('chat-input-hidden');
    document.getElementById('chat-selection-header')?.classList.add('active');
    updateSelectionHeader();
    loadRealtimeMessages();
}

function exitSelectionMode() {
    isMultiSelectMode = false;
    selectedMessageIds.clear();
    document.getElementById('chat-normal-header')?.classList.remove('chat-input-hidden');
    document.getElementById('chat-selection-header')?.classList.remove('active');
    loadRealtimeMessages();
}

function toggleMessageSelection(msgId, el) {
    if (selectedMessageIds.has(msgId)) {
        selectedMessageIds.delete(msgId);
        el.classList.remove('selected');
    } else {
        selectedMessageIds.add(msgId);
        el.classList.add('selected');
    }
    updateSelectionHeader();
    if (selectedMessageIds.size === 0) exitSelectionMode();
}

function updateSelectionHeader() {
    const text = document.getElementById('selection-count-text');
    if (text) text.innerText = `${selectedMessageIds.size} selecionada(s)`;
}

document.getElementById('cancel-selection-btn')?.addEventListener('click', exitSelectionMode);
document.getElementById('enable-multiselect-trigger')?.addEventListener('click', () => {
    document.getElementById('chat-dropdown-menu')?.classList.remove('active');
    enterSelectionMode();
});

document.getElementById('delete-selected-btn')?.addEventListener('click', async () => {
    if (selectedMessageIds.size === 0) return;
    await openDeleteModal(true);
});

function setupSwipeToReply(el, msg) {
    let startX = 0;
    let currentX = 0;
    let isSwiping = false;

    el.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isSwiping = true;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
        if (!isSwiping || isMultiSelectMode) return;
        currentX = e.touches[0].clientX;
        const diffX = currentX - startX;
        if (diffX > 0 && diffX < 85) el.style.transform = `translateX(${diffX}px)`;
    }, { passive: true });

    el.addEventListener('touchend', () => {
        if (!isSwiping || isMultiSelectMode) return;
        const diffX = currentX - startX;
        el.style.transform = 'translateX(0px)';
        if (diffX > 50) {
            if ("vibrate" in navigator) navigator.vibrate(30);
            startReplyToMessage(msg);
        }
        isSwiping = false;
    });
}

function startReplyToMessage(msg) {
    if (msg.deletedForEveryone) return;
    replyingToMsg = msg;
    const bar = document.getElementById('reply-preview-bar');
    const authorEl = document.getElementById('reply-to-author');
    const textEl = document.getElementById('reply-to-text');

    if (authorEl) authorEl.innerText = msg.senderName || 'Contato';
    if (textEl) textEl.innerText = msg.text || (msg.type === 'image' ? 'Foto' : (msg.type === 'audio' ? 'Áudio' : 'Arquivo'));
    if (bar) bar.classList.add('active');

    document.getElementById('chat-input-main')?.focus();
    playSound(clickSound);
}

function cancelReply() {
    replyingToMsg = null;
    document.getElementById('reply-preview-bar')?.classList.remove('active');
}

document.getElementById('cancel-reply-btn')?.addEventListener('click', cancelReply);

function showFloatingReactions(msg, el, eventCoord) {
    if (msg.deletedForEveryone) return;
    activeSelectedMsg = msg;
    activeSelectedMsgEl = el;

    const bar = document.getElementById('floating-reaction-bar');
    if (!bar) return;

    // Mostrar ou ocultar botão de copiar se houver texto
    const canCopy = Boolean(!msg.deletedForEveryone && (msg.text || msg.caption));
    const copyBtn = document.getElementById('action-copy-btn');
    if (copyBtn) {
        copyBtn.style.display = canCopy ? 'inline-flex' : 'none';
    }

    // Mostrar ou ocultar botão de editar apenas se for mensagem de texto do próprio usuário
    const canEdit = Boolean(currentUser && msg.senderUid === currentUser.uid && !msg.deletedForEveryone && (msg.type === 'text' || (!msg.type && msg.text)));
    const editBtn = document.getElementById('action-edit-btn');
    if (editBtn) {
        editBtn.style.display = canEdit ? 'inline-flex' : 'none';
    }

    const rect = (el && typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : { top: 100, bottom: 130 };
    const appEl = document.querySelector('.app-container');
    const containerRect = (appEl && typeof appEl.getBoundingClientRect === 'function') ? appEl.getBoundingClientRect() : { top: 0, bottom: 800 };

    let topPos = rect.top - containerRect.top - 50;
    if (topPos < 60) topPos = rect.bottom - containerRect.top + 10;

    bar.style.top = `${topPos}px`;
    bar.style.left = `50%`;
    bar.style.transform = `translateX(-50%)`;
    bar.classList.add('active');

    if ("vibrate" in navigator) navigator.vibrate(25);
}

function hideFloatingReactions() {
    document.getElementById('floating-reaction-bar')?.classList.remove('active');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#floating-reaction-bar') && !e.target.closest('.message')) {
        hideFloatingReactions();
    }
    if (!e.target.closest('#chat-options-menu-btn') && !e.target.closest('#chat-dropdown-menu')) {
        document.getElementById('chat-dropdown-menu')?.classList.remove('active');
    }
});

document.querySelectorAll('.reaction-emoji').forEach(span => {
    span.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoji = span.dataset.emoji;
        if (activeSelectedMsg && activeChatContact) {
            const chatId = getActiveChatId();
            if (!chatId) return;
            const msgRef = doc(db, 'chats', chatId, 'messages', activeSelectedMsg.id);
            
            const currentReactions = activeSelectedMsg.reactions || {};
            if (currentReactions[currentUser.uid] === emoji) {
                delete currentReactions[currentUser.uid];
            } else {
                currentReactions[currentUser.uid] = emoji;
            }

            await updateDoc(msgRef, { reactions: currentReactions });
            playSound(clickSound);
            hideFloatingReactions();
        }
    });
});

document.getElementById('action-copy-btn')?.addEventListener('click', () => {
    const msg = activeSelectedMsg;
    hideFloatingReactions();
    if (msg) copyMessageText(msg);
});

document.getElementById('action-edit-btn')?.addEventListener('click', () => {
    const msg = activeSelectedMsg;
    hideFloatingReactions();
    if (msg) startEditMessage(msg);
});

document.getElementById('action-info-btn')?.addEventListener('click', () => {
    const msg = activeSelectedMsg;
    hideFloatingReactions();
    if (msg) openMessageInfoModal(msg);
});

document.getElementById('action-reply-btn')?.addEventListener('click', () => {
    const msg = activeSelectedMsg;
    hideFloatingReactions();
    if (msg) startReplyToMessage(msg);
});

document.getElementById('action-forward-btn')?.addEventListener('click', () => {
    const msg = activeSelectedMsg;
    hideFloatingReactions();
    if (msg) openForwardModal(msg);
});

document.getElementById('action-delete-btn')?.addEventListener('click', () => {
    const msg = activeSelectedMsg;
    hideFloatingReactions();
    if (msg) openDeleteModal(false, msg);
});

async function copyMessageText(msg) {
    if (!msg || msg.deletedForEveryone) return;
    const textToCopy = msg.text || msg.caption || '';
    if (!textToCopy) {
        showToast('Aviso', 'Esta mensagem não contém texto para copiar.', 'yellow');
        return;
    }

    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(textToCopy);
        } else {
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = textToCopy;
            tempTextArea.style.position = 'fixed';
            tempTextArea.style.opacity = '0';
            document.body.appendChild(tempTextArea);
            tempTextArea.focus();
            tempTextArea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextArea);
        }
        showToast('Copiado', 'Texto copiado para a área de transferência!', 'green');
        playSound(clickSound);
    } catch (err) {
        console.error('Erro ao copiar texto:', err);
        showToast('Erro', 'Não foi possível copiar a mensagem.', 'red');
    }
}

function startEditMessage(msg) {
    if (!currentUser || !msg) return;
    if (isUserBanned(currentProfile)) {
        showToast('Conta Suspensa', 'Sua conta está banida e não pode editar mensagens.', 'red');
        return;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return;
    }
    if (msg.senderUid !== currentUser.uid) {
        showToast('Aviso', 'Você só pode editar mensagens enviadas por você.', 'yellow');
        return;
    }
    if (msg.deletedForEveryone) {
        showToast('Aviso', 'Mensagens apagadas não podem ser editadas.', 'yellow');
        return;
    }

    cancelReply();
    editingMessage = msg;

    const editBar = document.getElementById('edit-preview-bar');
    const editText = document.getElementById('edit-preview-text');
    if (editBar && editText) {
        editText.innerText = msg.text || '';
        editBar.style.display = 'flex';
        editBar.classList.add('active');
    }

    const input = document.getElementById('chat-input-main');
    if (input) {
        input.value = msg.text || '';
        input.focus();
        const len = input.value.length;
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(len, len);
        }
    }

    const sendIcon = document.getElementById('chat-send-icon');
    sendIcon?.setAttribute('data-lucide', 'check');
    if (window.lucide) lucide.createIcons();
}

function cancelEditMessage() {
    editingMessage = null;
    const editBar = document.getElementById('edit-preview-bar');
    if (editBar) {
        editBar.style.display = 'none';
        editBar.classList.remove('active');
    }
    const input = document.getElementById('chat-input-main');
    if (input) {
        input.value = '';
    }
    const sendIcon = document.getElementById('chat-send-icon');
    sendIcon?.setAttribute('data-lucide', 'mic');
    if (window.lucide) lucide.createIcons();
}

async function saveEditedMessage(msg, newText) {
    if (!currentUser || !msg || !msg.id) return;
    if (isUserBanned(currentProfile)) {
        showToast('Conta Suspensa', 'Sua conta está banida e não pode editar mensagens.', 'red');
        return;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return;
    }
    const chatId = getActiveChatId();
    if (!chatId) return;

    try {
        const msgRef = doc(db, 'chats', chatId, 'messages', msg.id);
        await updateDoc(msgRef, {
            text: newText,
            isEdited: true,
            editedAt: Date.now()
        });
        showToast('Mensagem editada', 'Sua mensagem foi alterada com sucesso!', 'green');
        playSound(clickSound);
    } catch (err) {
        console.error('Erro ao editar mensagem:', err);
        showToast('Erro', 'Não foi possível salvar a edição da mensagem.', 'red');
    } finally {
        cancelEditMessage();
    }
}

document.getElementById('cancel-edit-btn')?.addEventListener('click', cancelEditMessage);

async function openMessageInfoModal(msg) {
    if (!msg) return;
    const modal = document.getElementById('message-info-modal');
    const textEl = document.getElementById('msg-info-text');
    const metaEl = document.getElementById('msg-info-meta');
    const countBadge = document.getElementById('msg-info-seen-count');
    const listEl = document.getElementById('msg-info-readers-list');
    if (!modal || !listEl) return;

    modal.classList.add('active');

    // Prévia do conteúdo da mensagem
    if (textEl) {
        if (msg.deletedForEveryone) {
            textEl.innerHTML = '<i style="color:var(--text-dim);">🚫 Esta mensagem foi apagada</i>';
        } else if (msg.fileData) {
            const isAudio = msg.fileType?.includes('audio') || msg.isAudio;
            textEl.innerHTML = isAudio ? '🎵 Mensagem de voz / Áudio' : '📷 Mídia / Foto compartilhada';
        } else {
            textEl.innerText = msg.text || 'Mensagem';
        }
    }

    if (metaEl) {
        const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
        const dateStr = msg.createdAt ? new Date(msg.createdAt).toLocaleDateString([]) : (msg.timestamp ? new Date(msg.timestamp).toLocaleDateString([]) : '');
        metaEl.innerText = `Enviada em ${dateStr} às ${timeStr}`;
    }

    // Identificar leitores (quem viu a mensagem excluindo o próprio autor)
    const readersUids = (msg.readBy || []).filter(uid => uid !== msg.senderUid);

    if (countBadge) {
        countBadge.innerText = readersUids.length;
    }

    if (readersUids.length === 0) {
        listEl.innerHTML = `
            <div class="msg-info-empty">
                <i data-lucide="check" class="seen-icon" style="width:32px; height:32px; color:var(--text-dim); margin-bottom:6px;"></i>
                <p>Ninguém visualizou ainda</p>
                <small>A mensagem foi entregue aos participantes da conversa.</small>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    listEl.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.8rem; padding:12px;">Carregando visualizações...</p>';

    // Obter dados dos usuários leitores
    const readersData = await Promise.all(readersUids.map(async (uid) => {
        let found = adminUsers.find(u => u.id === uid);
        if (!found && currentUser && currentUser.uid === uid) {
            found = { id: uid, name: currentProfile.name, username: currentProfile.username, avatar: currentProfile.avatar };
        }
        if (!found) {
            try {
                const uDoc = await getDoc(doc(db, 'users', uid));
                if (uDoc.exists()) found = { id: uid, ...uDoc.data() };
            } catch(e) {}
        }
        return {
            uid,
            name: found?.name || 'Membro do Grupo',
            username: found?.username || 'membro',
            avatar: found?.avatar || '',
            readAt: msg.readByMap?.[uid] || null
        };
    }));

    listEl.innerHTML = readersData.map(r => {
        const readTimeStr = r.readAt 
            ? `às ${new Date(r.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Lida';

        return `
            <div class="msg-info-reader-item">
                <div class="msg-info-reader-left">
                    <div class="avatar sm" style="background-image: url('${r.avatar}'); width:34px; height:34px;"></div>
                    <div>
                        <div class="msg-info-reader-name">${escapeHTML(r.name)}</div>
                        <div class="msg-info-reader-user">@${escapeHTML(r.username)}</div>
                    </div>
                </div>
                <div class="msg-info-reader-right">
                    <div class="msg-info-reader-status">
                        <i data-lucide="check-check" class="seen-icon active" style="width:14px; height:14px; color:#00f3ff;"></i>
                        <span>Visualizou</span>
                    </div>
                    <span class="msg-info-reader-time">${readTimeStr}</span>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function closeMessageInfoModal() {
    document.getElementById('message-info-modal')?.classList.remove('active');
}

document.getElementById('close-message-info-modal')?.addEventListener('click', closeMessageInfoModal);
document.getElementById('message-info-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'message-info-modal') closeMessageInfoModal();
});

async function openForwardModal(msgToFwd) {
    messageToForward = msgToFwd;
    const modal = document.getElementById('forward-modal');
    const list = document.getElementById('forward-contacts-list');
    if (!modal || !list || !currentUser || !messageToForward) return;

    list.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.8rem; padding:15px;">Carregando contatos...</p>';
    modal.classList.add('active');

    try {
        const contactsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'contacts'));
        if (contactsSnap.empty) {
            list.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.8rem; padding:15px;">Nenhum contato encontrado.</p>';
            return;
        }

        list.innerHTML = '';
        contactsSnap.forEach(d => {
            const c = d.data();
            const contactUid = c.uid || d.id;
            const item = document.createElement('div');
            item.className = 'contact-selection-item';
            const initialAvatar = c.avatar || '';
            const initialName = c.name || 'Contato';
            item.innerHTML = `
                <div class="contact-info-mini">
                    <div class="avatar sm" id="forward-avatar-${contactUid}" style="background-image: url('${initialAvatar}');">${!initialAvatar ? initialName.charAt(0).toUpperCase() : ''}</div>
                    <span id="forward-name-${contactUid}">${initialName}</span>
                </div>
                <button class="danger-btn" style="background:var(--accent-color); color:#000; font-weight:bold; border:none; padding:4px 12px; font-size:0.75rem; border-radius:8px;">Enviar</button>
            `;

            onSnapshot(doc(db, 'users', contactUid), (uSnap) => {
                if (uSnap.exists()) {
                    const uData = uSnap.data();
                    const avEl = document.getElementById(`forward-avatar-${contactUid}`);
                    const nameEl = document.getElementById(`forward-name-${contactUid}`);
                    const liveAvatar = uData.avatar || '';
                    const liveName = uData.name || c.name || 'Contato';
                    if (avEl) {
                        if (liveAvatar) {
                            avEl.style.backgroundImage = `url('${liveAvatar}')`;
                            avEl.innerText = '';
                        } else {
                            avEl.style.backgroundImage = '';
                            avEl.innerText = liveName.charAt(0).toUpperCase() || '';
                        }
                    }
                    if (nameEl) nameEl.innerText = liveName;
                }
            });

            item.querySelector('button').onclick = async () => {
                if (!messageToForward) return;
                const targetChatId = [currentUser.uid, c.uid].sort().join('_');
                const forwardData = {
                    senderUid: currentUser.uid,
                    senderName: currentProfile.name,
                    senderAvatar: currentProfile.avatar,
                    type: messageToForward.type || 'text',
                    text: messageToForward.text || '',
                    fileData: messageToForward.fileData || '',
                    fileName: messageToForward.fileName || '',
                    fileSize: messageToForward.fileSize || '',
                    forwarded: true,
                    createdAt: Date.now()
                };

                await addDoc(collection(db, 'chats', targetChatId, 'messages'), forwardData);
                showToast("Encaminhado", `Mensagem encaminhada para ${c.name}!`, "green");
                modal.classList.remove('active');
                messageToForward = null;
            };

            list.appendChild(item);
        });
    } catch (err) {
        console.error("Erro ao carregar contatos para encaminhar:", err);
    }
}

document.getElementById('close-forward-modal')?.addEventListener('click', () => {
    document.getElementById('forward-modal')?.classList.remove('active');
    messageToForward = null;
});

async function openDeleteModal(isMultiple = false, msgToDel = null) {
    messageToDelete = msgToDel;
    const modal = document.getElementById('delete-message-modal');
    const deleteForEveryoneBtn = document.getElementById('delete-for-everyone-btn');
    if (!modal) return;

    if (!isMultiple && messageToDelete) {
        const isSender = messageToDelete.senderUid === currentUser.uid;
        if (deleteForEveryoneBtn) {
            deleteForEveryoneBtn.style.display = (isSender && !messageToDelete.deletedForEveryone) ? 'block' : 'none';
        }
    } else if (isMultiple) {
        let allMine = selectedMessageIds.size > 0;
        const chatId = getActiveChatId();

        for (const id of selectedMessageIds) {
            let msg = currentChatMessagesMap.get(id);
            if (!msg && chatId) {
                try {
                    const snap = await getDoc(doc(db, 'chats', chatId, 'messages', id));
                    if (snap.exists()) {
                        msg = { id: snap.id, ...snap.data() };
                        currentChatMessagesMap.set(id, msg);
                    }
                } catch (e) {
                    console.warn('Erro ao verificar mensagem selecionada:', e);
                }
            }
            if (!msg || msg.senderUid !== currentUser.uid || msg.deletedForEveryone) {
                allMine = false;
                break;
            }
        }

        if (deleteForEveryoneBtn) {
            deleteForEveryoneBtn.style.display = allMine ? 'block' : 'none';
        }
    } else {
        if (deleteForEveryoneBtn) deleteForEveryoneBtn.style.display = 'none';
    }

    modal.classList.add('active');
}

document.getElementById('delete-for-everyone-btn')?.addEventListener('click', async () => {
    if (!activeChatContact || !currentUser) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    if (isMultiSelectMode && selectedMessageIds.size > 0) {
        const batch = writeBatch(db);
        let countDeleted = 0;

        for (const id of selectedMessageIds) {
            let msg = currentChatMessagesMap.get(id);
            if (!msg) {
                try {
                    const snap = await getDoc(doc(db, 'chats', chatId, 'messages', id));
                    if (snap.exists()) msg = snap.data();
                } catch (e) {
                    console.warn('Erro ao carregar mensagem:', e);
                }
            }

            if (msg && msg.senderUid === currentUser.uid) {
                const ref = doc(db, 'chats', chatId, 'messages', id);
                batch.update(ref, {
                    deletedForEveryone: true,
                    text: '🚫 Esta mensagem foi apagada',
                    fileData: '',
                    type: 'deleted'
                });
                countDeleted++;
            }
        }

        if (countDeleted > 0) {
            await batch.commit();
            showToast("Apagadas", `${countDeleted} mensagem(ns) apagada(s) para todos.`, "blue");
        } else {
            showToast("Aviso", "Nenhuma mensagem enviada por você foi selecionada para apagar para todos.", "yellow");
        }
        exitSelectionMode();
    } else if (messageToDelete) {
        if (messageToDelete.senderUid === currentUser.uid) {
            await updateDoc(doc(db, 'chats', chatId, 'messages', messageToDelete.id), {
                deletedForEveryone: true,
                text: '🚫 Esta mensagem foi apagada',
                fileData: '',
                type: 'deleted'
            });
            showToast("Apagada", "Mensagem apagada para todos.", "blue");
        } else {
            showToast("Erro", "Você só pode apagar para todos mensagens que você mesmo enviou.", "red");
        }
        messageToDelete = null;
    }

    document.getElementById('delete-message-modal')?.classList.remove('active');
});

document.getElementById('delete-for-me-btn')?.addEventListener('click', async () => {
    if (!activeChatContact || !currentUser) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    if (isMultiSelectMode && selectedMessageIds.size > 0) {
        const batch = writeBatch(db);
        for (const id of selectedMessageIds) {
            const ref = doc(db, 'chats', chatId, 'messages', id);
            batch.update(ref, {
                deletedFor: arrayUnion(currentUser.uid)
            });
        }
        await batch.commit();
        showToast("Apagadas", "Mensagens apagadas para você.", "blue");
        exitSelectionMode();
    } else if (messageToDelete) {
        await updateDoc(doc(db, 'chats', chatId, 'messages', messageToDelete.id), {
            deletedFor: arrayUnion(currentUser.uid)
        });
        showToast("Apagada", "Mensagem apagada para você.", "blue");
        messageToDelete = null;
    }

    document.getElementById('delete-message-modal')?.classList.remove('active');
});

document.getElementById('cancel-delete-modal-btn')?.addEventListener('click', () => {
    document.getElementById('delete-message-modal')?.classList.remove('active');
    messageToDelete = null;
});

document.getElementById('chat-options-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof updateChatPinUI === 'function') updateChatPinUI();
    document.getElementById('chat-dropdown-menu')?.classList.toggle('active');
});

document.getElementById('chat-pin-trigger')?.addEventListener('click', () => {
    document.getElementById('chat-dropdown-menu')?.classList.remove('active');
    if (activeChatContact) {
        togglePinChat(activeChatContact.uid);
    }
});

document.getElementById('clear-chat-trigger')?.addEventListener('click', () => {
    document.getElementById('chat-dropdown-menu')?.classList.remove('active');
    document.getElementById('clear-chat-modal')?.classList.add('active');
});

async function clearChatForCurrentUser(targetChatId = null) {
    if (!currentUser) return;
    const chatId = targetChatId || getActiveChatId();
    if (!chatId) return;

    try {
        const msgsSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
        const docsToUpdate = msgsSnap.docs.filter(d => {
            const data = d.data();
            return !(data.deletedFor && data.deletedFor.includes(currentUser.uid));
        });

        if (docsToUpdate.length > 0) {
            for (let i = 0; i < docsToUpdate.length; i += 450) {
                const chunk = docsToUpdate.slice(i, i + 450);
                const batch = writeBatch(db);
                chunk.forEach(d => {
                    batch.update(d.ref, {
                        deletedFor: arrayUnion(currentUser.uid)
                    });
                });
                await batch.commit();
            }
        }

        const container = document.getElementById('message-container');
        if (container) container.innerHTML = '';

        showToast("Conversa Limpa", "As mensagens foram limpas apenas para você.", "green");
        playSound(clickSound);
    } catch (err) {
        console.error('Erro ao limpar conversa:', err);
        showToast("Erro", "Falha ao limpar a conversa.", "red");
        throw err;
    }
}

document.getElementById('confirm-clear-chat-btn')?.addEventListener('click', async () => {
    try {
        await clearChatForCurrentUser();
    } catch (err) {
        // toast already shown
    }
    document.getElementById('clear-chat-modal')?.classList.remove('active');
});

document.getElementById('cancel-clear-chat-btn')?.addEventListener('click', () => {
    document.getElementById('clear-chat-modal')?.classList.remove('active');
});

/* ==========================================================================
   SISTEMA DE BLOQUEIO E DENÚNCIA DE CONTATOS
   ========================================================================== */
export function listenToBlockedContacts() {
    if (!currentUser) return;
    if (blockedUnsubscribe) blockedUnsubscribe();
    const blockedRef = collection(db, 'users', currentUser.uid, 'blocked');
    blockedUnsubscribe = onSnapshot(blockedRef, (snapshot) => {
        blockedContactsSet = new Set(snapshot.docs.map(d => d.id));
        updateActiveChatBlockedUI();
    }, err => console.warn('Erro ao carregar contatos bloqueados:', err));
}

export function updateActiveChatBlockedUI() {
    if (!activeChatContact) return;
    const isGroup = !!activeChatContact.isGroup;
    const blockTrigger = document.getElementById('block-contact-trigger');
    const blockText = document.getElementById('block-contact-text');
    const blockIcon = document.getElementById('block-contact-icon');
    const reportText = document.getElementById('report-contact-text');
    const blockedBanner = document.getElementById('chat-blocked-banner');
    const blockedBannerText = document.getElementById('chat-blocked-banner-text');
    const chatInput = document.getElementById('chat-input-main');
    const chatSendBtn = document.getElementById('chat-send-btn-main');
    const callBtn = document.getElementById('chat-audio-call-btn');

    if (isGroup) {
        if (blockTrigger) blockTrigger.style.display = 'none';
        if (reportText) reportText.innerText = 'Denunciar Grupo';
        if (blockedBanner) blockedBanner.style.display = 'none';
        return;
    }

    if (blockTrigger) blockTrigger.style.display = 'flex';
    if (reportText) reportText.innerText = 'Denunciar Contato';

    const isBlockedByMe = blockedContactsSet.has(activeChatContact.uid);
    const isBlockedByOther = !isBlockedByMe && isBlockedByActiveContact;
    const isAnyBlocked = isBlockedByMe || isBlockedByOther;

    if (blockText) {
        blockText.innerText = isBlockedByMe ? 'Desbloquear Contato' : 'Bloquear Contato';
    }
    if (blockIcon) {
        blockIcon.setAttribute('data-lucide', isBlockedByMe ? 'shield-check' : 'ban');
    }

    if (blockedBanner) {
        blockedBanner.style.display = isAnyBlocked ? 'flex' : 'none';
        if (blockedBannerText) {
            if (isBlockedByMe) {
                blockedBannerText.innerText = `Você bloqueou ${activeChatContact.name || 'este contato'}.`;
            } else if (isBlockedByOther) {
                blockedBannerText.innerText = `Você foi bloqueado por ${activeChatContact.name || 'este contato'} e não pode enviar mensagens.`;
            }
        }
    }

    const unblockBannerBtn = document.getElementById('unblock-banner-btn');
    if (unblockBannerBtn) {
        unblockBannerBtn.style.display = isBlockedByMe ? 'inline-block' : 'none';
    }

    if (chatInput) {
        if (isBlockedByMe) {
            chatInput.disabled = true;
            chatInput.placeholder = 'Contato bloqueado. Desbloqueie para conversar.';
        } else if (isBlockedByOther) {
            chatInput.disabled = true;
            chatInput.placeholder = 'Você foi bloqueado por este contato.';
        } else if (!activeChatContact.paused) {
            chatInput.disabled = false;
            chatInput.placeholder = 'Digite uma mensagem...';
        }
    }

    if (chatSendBtn) {
        if (isAnyBlocked) {
            chatSendBtn.disabled = true;
        } else if (!activeChatContact.paused) {
            chatSendBtn.disabled = false;
        }
    }

    if (callBtn) {
        if (isAnyBlocked) {
            callBtn.style.opacity = '0.35';
            callBtn.style.pointerEvents = 'none';
        } else {
            callBtn.style.opacity = '1';
            callBtn.style.pointerEvents = 'auto';
        }
    }

    if (window.lucide) lucide.createIcons();
}

export let activeBlockTargetContact = null;

export function updateContactProfileBlockedUI(contactUid) {
    const blockText = document.getElementById('contact-profile-block-text');
    const blockIcon = document.getElementById('contact-profile-block-icon');
    const presenceEl = document.getElementById('contact-profile-presence');
    const onlineDotEl = document.getElementById('contact-profile-online-dot');
    if (!blockText) return;

    const isBlocked = blockedContactsSet.has(contactUid);
    blockText.innerText = isBlocked ? 'Desbloquear Contato' : 'Bloquear Contato';
    if (blockIcon) {
        blockIcon.setAttribute('data-lucide', isBlocked ? 'shield-check' : 'ban');
    }
    if (isBlocked) {
        if (presenceEl) presenceEl.innerText = 'Bloqueado';
        if (onlineDotEl) onlineDotEl.style.display = 'none';
    } else {
        if (presenceEl) {
            presenceEl.innerText = (activeContactProfileData && activeContactProfileData.online) ? 'Online agora' : 'Visto recentemente';
        }
    }
    if (window.lucide) lucide.createIcons();
}

export function openBlockContactConfirmation(contact) {
    if (!currentUser || !contact || contact.isGroup) return;
    activeBlockTargetContact = contact;
    const contactUid = contact.uid || contact.id;
    const isBlocked = blockedContactsSet.has(contactUid);
    const titleEl = document.getElementById('block-modal-title');
    const descEl = document.getElementById('block-modal-desc');
    const confirmBtn = document.getElementById('confirm-block-contact-btn');
    const iconBox = document.getElementById('block-modal-icon-box');

    const contactName = contact.name || 'Contato';

    if (isBlocked) {
        if (titleEl) {
            titleEl.innerText = `Desbloquear ${contactName}?`;
            titleEl.className = 'modal-title';
        }
        if (descEl) descEl.innerText = `Você voltará a receber mensagens e chamadas deste contato.`;
        if (confirmBtn) {
            confirmBtn.innerText = 'Desbloquear Contato';
            confirmBtn.className = 'danger-btn btn-delete-everyone';
            confirmBtn.style.background = 'var(--accent-color)';
            confirmBtn.style.color = '#000';
        }
        if (iconBox) {
            iconBox.innerHTML = '<i data-lucide="shield-check"></i>';
            iconBox.className = 'modal-icon-badge';
            iconBox.style.background = 'rgba(0, 243, 255, 0.15)';
            iconBox.style.color = 'var(--accent-color)';
            iconBox.style.borderColor = 'var(--accent-color)';
        }
    } else {
        if (titleEl) {
            titleEl.innerText = `Bloquear ${contactName}?`;
            titleEl.className = 'modal-title danger-text';
        }
        if (descEl) descEl.innerText = `Contatos bloqueados não poderão lhe enviar mensagens e nem visualizar seus stories no VORTEX.`;
        if (confirmBtn) {
            confirmBtn.innerText = 'Bloquear Contato';
            confirmBtn.className = 'danger-btn btn-delete-everyone';
            confirmBtn.style.background = '#ff3b30';
            confirmBtn.style.color = '#fff';
        }
        if (iconBox) {
            iconBox.innerHTML = '<i data-lucide="shield-alert"></i>';
            iconBox.className = 'modal-icon-badge danger';
            iconBox.style.background = '';
            iconBox.style.color = '';
            iconBox.style.borderColor = '';
        }
    }
    if (window.lucide) lucide.createIcons();
    document.getElementById('block-contact-modal')?.classList.add('active');
}

export async function toggleBlockContact(targetContact = activeChatContact) {
    if (!currentUser || !targetContact || targetContact.isGroup) return;
    const targetUid = targetContact.uid || targetContact.id;
    const targetName = targetContact.name || 'Contato';
    const isBlocked = blockedContactsSet.has(targetUid);

    if (isBlocked) {
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'blocked', targetUid));
            blockedContactsSet.delete(targetUid);
            updateContactProfileBlockedUI(targetUid);
            updateActiveChatBlockedUI();
            refreshDirectChatStatus();
            if (typeof loadRealtimeMessages === 'function' && activeChatContact && activeChatContact.uid === targetUid) {
                loadRealtimeMessages();
            }
            if (typeof applyChatFilter === 'function') applyChatFilter();
            showToast("Contato Desbloqueado", `${targetName} foi desbloqueado com sucesso.`, "green");
            playSound(clickSound);
        } catch (err) {
            console.error('Erro ao desbloquear contato:', err);
            showToast("Erro", "Não foi possível desbloquear o contato.", "red");
        }
    } else {
        try {
            await setDoc(doc(db, 'users', currentUser.uid, 'blocked', targetUid), {
                uid: targetUid,
                name: targetName,
                blockedAt: Date.now()
            });
            blockedContactsSet.add(targetUid);
            updateContactProfileBlockedUI(targetUid);
            updateActiveChatBlockedUI();
            refreshDirectChatStatus();
            if (typeof loadRealtimeMessages === 'function' && activeChatContact && activeChatContact.uid === targetUid) {
                loadRealtimeMessages();
            }
            const targetCard = document.querySelector(`.chat-card[data-uid="${targetUid}"]`);
            if (targetCard) {
                targetCard.classList.remove('unread');
                targetCard.dataset.unread = 'false';
                targetCard.dataset.unreadCount = '0';
                const unreadBadge = document.getElementById(`unread-badge-${targetUid}`);
                const chatBell = document.getElementById(`chat-bell-${targetUid}`);
                const lastMsgEl = document.getElementById(`last-msg-${getActiveChatId()}`);
                if (unreadBadge) {
                    unreadBadge.style.display = 'none';
                    unreadBadge.classList.remove('active');
                }
                if (chatBell) chatBell.style.display = 'none';
                if (lastMsgEl) {
                    lastMsgEl.innerText = '🚫 Contato bloqueado';
                    lastMsgEl.dataset.fallback = '🚫 Contato bloqueado';
                }
            }
            if (typeof applyChatFilter === 'function') applyChatFilter();
            showToast("Contato Bloqueado", `${targetName} foi bloqueado com sucesso.`, "red");
            playSound(clickSound);
        } catch (err) {
            console.error('Erro ao bloquear contato:', err);
            showToast("Erro", "Não foi possível bloquear o contato.", "red");
        }
    }
}

export let activeReportTarget = null;

export function openReportModal(target) {
    activeReportTarget = target;
    const headerTitle = document.getElementById('report-modal-header-title');
    const subtitle = document.getElementById('report-modal-subtitle');
    const blockBox = document.getElementById('report-block-option-box');
    const detailsInput = document.getElementById('report-contact-details');
    const blockCheckbox = document.getElementById('report-also-block-checkbox');
    if (blockCheckbox) blockCheckbox.checked = false;

    const defaultRadio = document.querySelector('input[name="report-reason"][value="spam"]');
    if (defaultRadio) defaultRadio.checked = true;

    if (detailsInput) detailsInput.value = '';

    if (!target) return;

    if (target.type === 'post') {
        if (headerTitle) headerTitle.innerText = 'Denunciar Publicação';
        if (subtitle) subtitle.innerText = `Selecione o motivo para denunciar esta publicação de "${target.targetName || 'Usuário'}":`;
        if (blockBox) blockBox.style.display = 'none';
    } else if (target.type === 'story') {
        if (headerTitle) headerTitle.innerText = 'Denunciar Story';
        if (subtitle) subtitle.innerText = `Selecione o motivo para denunciar o story de "${target.targetName || 'Usuário'}":`;
        if (blockBox) blockBox.style.display = 'none';
    } else if (target.type === 'comment') {
        if (headerTitle) headerTitle.innerText = 'Denunciar Comentário';
        if (subtitle) subtitle.innerText = `Selecione o motivo para denunciar o comentário de "${target.targetName || 'Usuário'}":`;
        if (blockBox) blockBox.style.display = 'none';
    } else if (target.type === 'group' || target.isGroup) {
        if (headerTitle) headerTitle.innerText = 'Denunciar Grupo';
        if (subtitle) subtitle.innerText = `Selecione o motivo para denunciar o grupo "${target.targetName || target.name || 'Grupo'}":`;
        if (blockBox) blockBox.style.display = 'none';
    } else {
        if (headerTitle) headerTitle.innerText = 'Denunciar Contato';
        if (subtitle) subtitle.innerText = `Selecione o motivo para denunciar "${target.targetName || target.name || 'Contato'}":`;
        if (blockBox) blockBox.style.display = 'block';
    }

    document.getElementById('report-contact-modal')?.classList.add('active');
}

export function closeReportModal() {
    const wasStory = activeReportTarget && activeReportTarget.type === 'story';
    activeReportTarget = null;
    document.getElementById('report-contact-modal')?.classList.remove('active');
    if (wasStory && document.getElementById('story-viewer')?.classList.contains('active')) {
        resumeCurrentStory();
    }
}

export async function submitGeneralReport(target = activeReportTarget, reason = 'spam', details = '', alsoBlock = false) {
    if (!currentUser || !target) return false;
    const targetType = target.type || (target.isGroup ? 'group' : 'user');
    const targetUid = target.targetUid || target.uid || '';
    const targetName = target.targetName || target.name || 'Usuário';

    try {
        const reportData = {
            reporterUid: currentUser.uid,
            reporterName: currentProfile?.name || currentUser.displayName || 'Usuário',
            targetUid,
            targetName,
            targetType,
            reason,
            details,
            createdAt: Date.now()
        };

        if (target.postId) reportData.postId = target.postId;
        if (target.storyId) reportData.storyId = target.storyId;
        if (target.commentId) reportData.commentId = target.commentId;
        if (target.contentSnippet) reportData.contentSnippet = target.contentSnippet.substring(0, 150);

        await addDoc(collection(db, 'reports'), reportData);

        if (alsoBlock && targetType === 'user' && targetUid && !blockedContactsSet.has(targetUid)) {
            await toggleBlockContact({ uid: targetUid, name: targetName });
        }

        const typeLabels = {
            post: 'A publicação',
            story: 'O story',
            comment: 'O comentário',
            group: 'O grupo',
            user: 'O contato'
        };
        const label = typeLabels[targetType] || 'O item';
        showToast("Denúncia Enviada", `Agradecemos por colaborar. ${label} foi denunciado(a) e nossa equipe irá analisar.`, "green");
        return true;
    } catch (err) {
        console.error('Erro ao enviar denúncia:', err);
        showToast("Erro", "Não foi possível enviar a denúncia.", "red");
        return false;
    }
}

export async function submitContactReport(targetContact = activeChatContact, reason = 'spam', details = '', alsoBlock = false) {
    if (!targetContact) return false;
    const isGroup = !!targetContact.isGroup;
    return await submitGeneralReport({
        type: isGroup ? 'group' : 'user',
        targetUid: targetContact.uid,
        targetName: targetContact.name,
        isGroup
    }, reason, details, alsoBlock);
}

if (typeof window !== 'undefined') {
    window.listenToBlockedContacts = listenToBlockedContacts;
    window.updateActiveChatBlockedUI = updateActiveChatBlockedUI;
    window.updateContactProfileBlockedUI = updateContactProfileBlockedUI;
    window.openBlockContactConfirmation = openBlockContactConfirmation;
    window.toggleBlockContact = toggleBlockContact;
    window.submitContactReport = submitContactReport;
    window.submitGeneralReport = submitGeneralReport;
    window.openReportModal = openReportModal;
    window.closeReportModal = closeReportModal;
}

document.getElementById('block-contact-trigger')?.addEventListener('click', () => {
    document.getElementById('chat-dropdown-menu')?.classList.remove('active');
    if (!activeChatContact || activeChatContact.isGroup) return;
    openBlockContactConfirmation(activeChatContact);
});

document.getElementById('confirm-block-contact-btn')?.addEventListener('click', async () => {
    document.getElementById('block-contact-modal')?.classList.remove('active');
    const target = activeBlockTargetContact || activeChatContact;
    if (target) {
        await toggleBlockContact(target);
        activeBlockTargetContact = null;
    }
});

document.getElementById('cancel-block-contact-btn')?.addEventListener('click', () => {
    document.getElementById('block-contact-modal')?.classList.remove('active');
    activeBlockTargetContact = null;
});

document.getElementById('unblock-banner-btn')?.addEventListener('click', async () => {
    if (!activeChatContact) return;
    if (!blockedContactsSet.has(activeChatContact.uid)) {
        showToast("Ação Indisponível", "Você foi bloqueado por este contato e não pode desbloqueá-lo.", "red");
        return;
    }
    await toggleBlockContact(activeChatContact);
});

document.getElementById('report-contact-trigger')?.addEventListener('click', () => {
    document.getElementById('chat-dropdown-menu')?.classList.remove('active');
    if (!activeChatContact) return;
    openReportModal({
        type: activeChatContact.isGroup ? 'group' : 'user',
        targetUid: activeChatContact.uid,
        targetName: activeChatContact.name,
        isGroup: !!activeChatContact.isGroup
    });
});

document.getElementById('submit-report-contact-btn')?.addEventListener('click', async () => {
    const target = activeReportTarget || (activeChatContact ? {
        type: activeChatContact.isGroup ? 'group' : 'user',
        targetUid: activeChatContact.uid,
        targetName: activeChatContact.name,
        isGroup: !!activeChatContact.isGroup
    } : null);

    if (!target) return;
    const selectedReason = document.querySelector('input[name="report-reason"]:checked')?.value || 'outro';
    const details = document.getElementById('report-contact-details')?.value || '';
    const alsoBlock = !!document.getElementById('report-also-block-checkbox')?.checked;

    await submitGeneralReport(target, selectedReason, details, alsoBlock);
    closeReportModal();
});

document.getElementById('close-report-modal')?.addEventListener('click', () => {
    closeReportModal();
});

document.getElementById('cancel-report-modal-btn')?.addEventListener('click', () => {
    closeReportModal();
});

/* ==========================================================================
   PAINEL DE ADMINISTRAÇÃO ADM & MODERAÇÃO (VORTEX VIP)
   ========================================================================== */
export const AUTHORIZED_ADMIN_EMAIL = 'dxhub.oficial@gmail.com';

export function isUserAdmin(user = currentUser, profile = currentProfile) {
    const email = (user?.email || profile?.email || '').toLowerCase().trim();
    return email === AUTHORIZED_ADMIN_EMAIL.toLowerCase();
}

export function updateAdminUIVisibility() {
    const isAdmin = isUserAdmin();
    const adminBtn = document.getElementById('admin-panel-btn');
    const adminSettingsItem = document.getElementById('admin-settings-item');
    const adminPanel = document.getElementById('admin-panel');

    if (adminBtn) {
        adminBtn.style.display = isAdmin ? 'flex' : 'none';
    }
    if (adminSettingsItem) {
        adminSettingsItem.style.display = isAdmin ? 'flex' : 'none';
    }
    if (!isAdmin && adminPanel && adminPanel.classList.contains('active')) {
        adminPanel.classList.remove('active');
    }
}

let adminReports = [];
let adminUsers = [];
let adminPosts = [];
let adminGroups = [];
let adminVipRequests = [];
let adminReportsUnsubscribe = null;
let adminVipRequestsUnsubscribe = null;
let currentAdminTab = 'reports';
let currentAdminReportFilter = 'all';
let currentAdminVipFilter = 'all';
let targetBanUser = null;
let targetPurgeUser = null;

const reportReasonLabels = {
    'spam': 'Spam ou mensagens em massa',
    'assedio': 'Assédio, ofensa ou ameaça',
    'inapropriado': 'Conteúdo impróprio ou violência',
    'golpe': 'Golpe, fraude ou conta falsa',
    'outro': 'Outro motivo'
};

export const RESTRICTION_DURATION_MS = 3 * 60 * 60 * 1000; // 3 Horas = 10.800.000 ms
export const RESTRICTION_MESSAGE = 'Sua conta foi banida temporalmente você não vai conseguir enviar mensagem curtir ou comentar. Ainda é possível enviar story e publicar post além disso nada mais...';

// Aliases para compatibilidade
export const BAN_DURATION_MS = RESTRICTION_DURATION_MS;
export const BAN_RESTRICTION_MESSAGE = RESTRICTION_MESSAGE;

export function isUserBanned(user = currentProfile) {
    return Boolean(user && user.banned);
}

export function isUserRestricted(user = currentProfile) {
    if (!user || !user.restricted) return false;
    if (user.restrictionExpiresAt && Date.now() >= user.restrictionExpiresAt) {
        return false;
    }
    return true;
}

export function getRemainingRestrictionTime(user = currentProfile) {
    if (!user || !isUserRestricted(user)) return 0;
    const diff = (user.restrictionExpiresAt || 0) - Date.now();
    return diff > 0 ? diff : 0;
}

export function getRemainingRestrictionTimeFormatted(user = currentProfile) {
    const diff = getRemainingRestrictionTime(user);
    if (diff <= 0) return '00:00:00';
    const totalSec = Math.floor(diff / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const getRemainingBanTime = getRemainingRestrictionTime;
export const getRemainingBanTimeFormatted = getRemainingRestrictionTimeFormatted;

export function showRestrictionActionNotice() {
    const timeLeft = getRemainingRestrictionTimeFormatted(currentProfile);
    showToast('Acesso Restrito', `${RESTRICTION_MESSAGE}\n(Restam: ${timeLeft})`, 'red');
    const noticeModal = document.getElementById('temp-ban-notice-modal');
    if (noticeModal) {
        noticeModal.classList.add('active');
        const modalTime = document.getElementById('modal-temp-ban-countdown');
        if (modalTime) modalTime.innerText = timeLeft;
    }
}
export const showBannedActionNotice = showRestrictionActionNotice;

let bannedStateInterval = null;

export function checkBannedAccountState() {
    const bannedOverlay = document.getElementById('banned-account-overlay');
    const bannedReason = document.getElementById('banned-account-reason');

    // 1. Bloqueio Total se a conta estiver banida
    if (currentProfile && currentProfile.banned) {
        if (bannedOverlay) bannedOverlay.style.display = 'flex';
        if (bannedReason) {
            bannedReason.style.display = 'block';
            bannedReason.innerText = currentProfile.banReason || 'Sua conta foi suspensa por violar as regras da comunidade VORTEX VIP.';
        }
        const tempBanBanner = document.getElementById('temp-ban-banner');
        if (tempBanBanner) tempBanBanner.style.display = 'none';
        const chatTempBanBanner = document.getElementById('chat-temp-ban-banner');
        if (chatTempBanBanner) chatTempBanBanner.style.display = 'none';
        return;
    } else {
        if (bannedOverlay) bannedOverlay.style.display = 'none';
    }

    // 2. Restrição Temporal de 3 Horas se a conta estiver restrita
    checkRestrictionAccountState();
}

export async function checkRestrictionAccountState() {
    const tempBanBanner = document.getElementById('temp-ban-banner');
    const tempBanCountdown = document.getElementById('temp-ban-countdown');
    const chatTempBanBanner = document.getElementById('chat-temp-ban-banner');
    const chatTempBanCountdown = document.getElementById('chat-temp-ban-countdown');
    const modalCountdown = document.getElementById('modal-temp-ban-countdown');
    const chatInput = document.getElementById('chat-input-main');

    if (!currentUser || !currentProfile) {
        if (tempBanBanner) tempBanBanner.style.display = 'none';
        if (chatTempBanBanner) chatTempBanBanner.style.display = 'none';
        return;
    }

    const restricted = isUserRestricted(currentProfile);

    if (currentProfile.restricted && !restricted) {
        // Expirou o prazo de 3 horas da restrição!
        currentProfile.restricted = false;
        currentProfile.restrictionExpiresAt = null;
        currentProfile.restrictionReason = null;
        if (tempBanBanner) tempBanBanner.style.display = 'none';
        if (chatTempBanBanner) chatTempBanBanner.style.display = 'none';
        const noticeModal = document.getElementById('temp-ban-notice-modal');
        if (noticeModal) noticeModal.classList.remove('active');
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = 'Mensagem...';
        }

        try {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                restricted: false,
                restrictionExpiresAt: null,
                restrictionReason: null
            });
            showToast("Restrição Encerrada", "Seu prazo de restrição de 3 horas terminou! Sua conta foi totalmente liberada para mensagens, curtidas e comentários.", "green");
        } catch (err) {
            console.warn('Erro ao restaurar restrição expirada:', err);
        }
        return;
    }

    if (restricted) {
        const timeLeftStr = getRemainingRestrictionTimeFormatted(currentProfile);
        if (tempBanBanner) tempBanBanner.style.display = 'flex';
        if (tempBanCountdown) tempBanCountdown.innerText = timeLeftStr;
        if (chatTempBanBanner) chatTempBanBanner.style.display = 'flex';
        if (chatTempBanCountdown) chatTempBanCountdown.innerText = timeLeftStr;
        if (modalCountdown) modalCountdown.innerText = timeLeftStr;

        if (chatInput) {
            chatInput.placeholder = `Envio de mensagens restrito (Restam: ${timeLeftStr})`;
        }
    } else {
        if (tempBanBanner) tempBanBanner.style.display = 'none';
        if (chatTempBanBanner) chatTempBanBanner.style.display = 'none';
        if (chatInput && chatInput.placeholder && chatInput.placeholder.includes('restrito')) {
            chatInput.disabled = false;
            chatInput.placeholder = 'Mensagem...';
        }
    }

    if (!bannedStateInterval && typeof window !== 'undefined') {
        bannedStateInterval = setInterval(() => {
            if (currentUser && currentProfile && (currentProfile.banned || currentProfile.restricted)) {
                checkBannedAccountState();
            }
        }, 1000);
        if (bannedStateInterval && typeof bannedStateInterval.unref === 'function') {
            bannedStateInterval.unref();
        }
    }
}

export function openAdminPanel() {
    if (!isUserAdmin()) {
        showToast("Acesso Negado", "O Painel ADM é restrito exclusivamente ao e-mail dxhub.oficial@gmail.com.", "red");
        return;
    }
    const adminPanel = document.getElementById('admin-panel');
    if (!adminPanel) return;
    adminPanel.classList.add('active');
    switchAdminTab('reports');
    listenToAdminReports();
    listenToAdminVipRequests();
    loadAdminUsers();
    loadAdminPosts();
    loadAdminGroups();
    loadAdminVipRequests();
    if (window.lucide) lucide.createIcons();
}

export function closeAdminPanel() {
    document.getElementById('admin-panel')?.classList.remove('active');
}

export function switchAdminTab(tabName) {
    currentAdminTab = tabName;
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.admin-view').forEach(view => {
        view.classList.toggle('active', view.id === `admin-view-${tabName}`);
    });

    if (tabName === 'reports') renderAdminReports();
    if (tabName === 'users') {
        loadAdminUsers();
        renderAdminUsers();
    }
    if (tabName === 'posts') {
        loadAdminPosts();
        renderAdminPosts();
    }
    if (tabName === 'groups') {
        loadAdminGroups();
        renderAdminGroups();
    }
    if (tabName === 'vip-requests') {
        loadAdminVipRequests();
        renderAdminVipRequests();
    }
    if (tabName === 'broadcast') {
        loadAdminUsers().then(() => populateBroadcastRecipients());
        loadAdminBroadcastHistory();
    }
    if (window.lucide) lucide.createIcons();
}

export function listenToAdminReports() {
    if (!currentUser || !isUserAdmin()) return;
    if (adminReportsUnsubscribe) adminReportsUnsubscribe();

    try {
        const reportsRef = collection(db, 'reports');
        adminReportsUnsubscribe = onSnapshot(reportsRef, (snapshot) => {
            adminReports = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            adminReports.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            const pendingCount = adminReports.filter(r => !r.resolved).length;
            const badgeH = document.getElementById('admin-pending-badge');
            if (badgeH) {
                badgeH.innerText = pendingCount;
                badgeH.style.display = pendingCount > 0 ? 'inline-block' : 'none';
            }
            const badgeT = document.getElementById('admin-reports-badge');
            if (badgeT) {
                badgeT.innerText = pendingCount;
            }

            if (currentAdminTab === 'reports') renderAdminReports();
        }, (err) => console.warn('Erro ao escutar denúncias:', err));
    } catch (e) {
        console.warn('Falha no listener de denúncias:', e);
    }
}

export function renderAdminReports() {
    const container = document.getElementById('admin-reports-list');
    if (!container) return;

    const searchTerm = (document.getElementById('admin-reports-search-input')?.value || '').toLowerCase().trim();

    let filtered = adminReports.filter(r => {
        if (currentAdminReportFilter === 'pending' && r.resolved) return false;
        if (currentAdminReportFilter === 'resolved' && !r.resolved) return false;
        if (searchTerm) {
            const tName = (r.targetName || '').toLowerCase();
            const rReason = (reportReasonLabels[r.reason] || r.reason || '').toLowerCase();
            const rDetails = (r.details || '').toLowerCase();
            const rReporter = (r.reporterName || '').toLowerCase();
            const rSnippet = (r.contentSnippet || '').toLowerCase();
            const rType = (r.targetType || '').toLowerCase();
            return tName.includes(searchTerm) || rReason.includes(searchTerm) || rDetails.includes(searchTerm) || rReporter.includes(searchTerm) || rSnippet.includes(searchTerm) || rType.includes(searchTerm);
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="shield-check" class="empty-state-icon"></i>
                <p>Nenhuma denúncia encontrada.</p>
                <small>${currentAdminReportFilter === 'pending' ? 'Tudo limpo! Não há denúncias pendentes no momento.' : 'Nenhuma denúncia corresponde ao filtro selecionado.'}</small>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(r => {
        const isResolved = !!r.resolved;
        const targetIsGroup = r.targetType === 'group';
        const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : 'Data não registrada';
        const reasonText = reportReasonLabels[r.reason] || r.reason || 'Não informado';

        let typeBadgeClass = 'admin-badge-banned';
        let typeLabel = 'Usuário';
        if (r.targetType === 'group') {
            typeBadgeClass = 'admin-badge-vip';
            typeLabel = 'Grupo';
        } else if (r.targetType === 'post') {
            typeBadgeClass = 'admin-badge-role';
            typeLabel = 'Post';
        } else if (r.targetType === 'story') {
            typeBadgeClass = 'admin-badge-vip';
            typeLabel = 'Story';
        } else if (r.targetType === 'comment') {
            typeBadgeClass = 'admin-badge-role';
            typeLabel = 'Comentário';
        }

        return `
            <div class="admin-card ${isResolved ? 'resolved-report' : 'pending-report'}" data-report-id="${r.id}">
                <div class="admin-card-header">
                    <div class="admin-card-user-info">
                        <span class="admin-card-title">${r.targetName || 'Sem nome'}</span>
                        <span class="admin-badge ${typeBadgeClass}">${typeLabel}</span>
                    </div>
                    <span class="admin-card-subtitle">${dateStr}</span>
                </div>
                <div class="admin-card-body">
                    <div style="color:#ff6b6b; font-weight:700;">Motivo: ${reasonText}</div>
                    ${r.contentSnippet ? `<div style="color:var(--text-dim); font-size:0.75rem; margin-top:2px; font-style: italic;">Trecho: "${escapeHTML(r.contentSnippet)}"</div>` : ''}
                    ${r.details ? `<div style="color:var(--text-main); margin-top:2px;">"${r.details}"</div>` : ''}
                    <div style="color:var(--text-dim); font-size:0.72rem; margin-top:4px;">
                        Denunciante: <strong>${r.reporterName || 'Anônimo'}</strong> (${r.reporterUid || 'ID'})
                    </div>
                    ${isResolved ? `<div style="color:#34c759; font-weight:700; font-size:0.75rem; margin-top:4px;">✓ Resolvido</div>` : ''}
                </div>
                <div class="admin-card-actions">
                    ${!isResolved ? `
                        <button type="button" class="admin-btn-action btn-success admin-resolve-btn" data-id="${r.id}">
                            <i data-lucide="check"></i> Resolver
                        </button>
                    ` : ''}
                    ${!targetIsGroup && r.targetUid ? `
                        <button type="button" class="admin-btn-action btn-danger admin-ban-from-report-btn" data-uid="${r.targetUid}" data-name="${r.targetName}">
                            <i data-lucide="user-x"></i> Banir Infrator
                        </button>
                        <button type="button" class="admin-btn-action btn-danger admin-purge-from-report-btn" data-uid="${r.targetUid}" data-name="${r.targetName}">
                            <i data-lucide="trash-2"></i> Excluir Tudo da Conta
                        </button>
                    ` : targetIsGroup ? `
                        <button type="button" class="admin-btn-action btn-danger admin-delete-group-direct-btn" data-id="${r.targetUid}">
                            <i data-lucide="trash-2"></i> Apagar Grupo
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Wire up events
    container.querySelectorAll('.admin-resolve-btn').forEach(btn => {
        btn.addEventListener('click', () => adminResolveReport(btn.dataset.id));
    });
    container.querySelectorAll('.admin-ban-from-report-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdminBanModal(btn.dataset.uid, btn.dataset.name));
    });
    container.querySelectorAll('.admin-purge-from-report-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdminPurgeModal(btn.dataset.uid, btn.dataset.name));
    });
    container.querySelectorAll('.admin-delete-group-direct-btn').forEach(btn => {
        btn.addEventListener('click', () => adminDeleteGroup(btn.dataset.id));
    });

    if (window.lucide) lucide.createIcons();
}

export async function loadAdminUsers() {
    try {
        const snap = await getDocs(collection(db, 'users'));
        adminUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (currentAdminTab === 'users') renderAdminUsers();
    } catch (e) {
        console.warn('Erro ao carregar usuários para admin:', e);
    }
}

export function renderAdminUsers() {
    const container = document.getElementById('admin-users-list');
    if (!container) return;

    const searchTerm = (document.getElementById('admin-users-search-input')?.value || '').toLowerCase().trim();

    let filtered = adminUsers.filter(u => {
        if (!searchTerm) return true;
        const name = (u.name || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const uid = (u.id || '').toLowerCase();
        return name.includes(searchTerm) || username.includes(searchTerm) || email.includes(searchTerm) || uid.includes(searchTerm);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="users" class="empty-state-icon"></i>
                <p>Nenhum usuário encontrado.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(u => {
        const isBanned = Boolean(u.banned);
        const isRestricted = isUserRestricted(u);
        const isVip = checkIsVipUser(u);
        const timeLeft = isRestricted ? getRemainingRestrictionTimeFormatted(u) : '';

        return `
            <div class="admin-card" data-user-id="${u.id}">
                <div class="admin-card-header">
                    <div class="admin-card-user-info">
                        <div class="avatar sm" style="background-image: url('${u.avatar || ''}');"></div>
                        <div>
                            <span class="admin-card-title">${escapeHTML(u.name || 'Usuário')}</span>
                            <span class="admin-card-subtitle">@${escapeHTML(u.username || 'sem_username')}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:4px; align-items:center;">
                        ${isBanned ? `
                            <span class="admin-badge admin-badge-banned">BANIDO</span>
                        ` : isRestricted ? `
                            <span class="admin-badge admin-badge-banned" style="background: rgba(255,149,0,0.2); border: 1px solid #ff9500; color: #ff9500;">RESTRITO (${timeLeft})</span>
                        ` : `
                            <span class="admin-badge admin-badge-active">ATIVO</span>
                        `}
                        ${isVip ? '<span class="admin-badge admin-badge-vip">VIP</span>' : ''}
                    </div>
                </div>
                <div class="admin-card-body">
                    <div>UID: <code style="color:var(--accent-color); font-size:0.75rem;">${u.id}</code></div>
                    ${u.email ? `<div>Email: ${escapeHTML(u.email)}</div>` : ''}
                    ${isBanned ? `<div style="color:#ff6b6b; font-size:0.78rem; margin-top:2px;">Status: Conta suspensa totalmente</div>` : ''}
                    ${!isBanned && isRestricted ? `<div style="color:#ff9500; font-size:0.78rem; margin-top:2px;">Status: Restrito temporariamente (restam ${timeLeft})</div>` : ''}
                </div>
                <div class="admin-card-actions">
                    ${isBanned ? `
                        <button type="button" class="admin-btn-action btn-success admin-unban-action-btn" data-uid="${u.id}" data-name="${escapeHTML(u.name || 'Usuário')}">
                            <i data-lucide="user-check"></i> Desbanir Usuário
                        </button>
                    ` : `
                        <button type="button" class="admin-btn-action btn-danger admin-ban-action-btn" data-uid="${u.id}" data-name="${escapeHTML(u.name || 'Usuário')}">
                            <i data-lucide="user-x"></i> Banir Usuário
                        </button>
                    `}
                    ${isRestricted ? `
                        <button type="button" class="admin-btn-action admin-unrestrict-action-btn" data-uid="${u.id}" data-name="${escapeHTML(u.name || 'Usuário')}" style="background: rgba(255,149,0,0.18); border: 1px solid #ff9500; color: #ff9500;">
                            <i data-lucide="unlock"></i> Remover Restrição
                        </button>
                    ` : `
                        <button type="button" class="admin-btn-action admin-restrict-action-btn" data-uid="${u.id}" data-name="${escapeHTML(u.name || 'Usuário')}" style="background: rgba(255,149,0,0.18); border: 1px solid #ff9500; color: #ff9500;">
                            <i data-lucide="clock"></i> Restringir (3h)
                        </button>
                    `}
                    <button type="button" class="admin-btn-action btn-accent admin-vip-action-btn" data-uid="${u.id}" data-vip="${!isVip}">
                        <i data-lucide="badge-check"></i> ${isVip ? 'Remover VIP' : 'Conceder VIP'}
                    </button>
                    <button type="button" class="admin-btn-action btn-danger admin-purge-action-btn" data-uid="${u.id}" data-name="${escapeHTML(u.name || 'Usuário')}">
                        <i data-lucide="trash-2"></i> Excluir Tudo da Conta
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Wire up events
    container.querySelectorAll('.admin-ban-action-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdminBanModal(btn.dataset.uid, btn.dataset.name));
    });
    container.querySelectorAll('.admin-unban-action-btn').forEach(btn => {
        btn.addEventListener('click', () => adminUnbanUser(btn.dataset.uid));
    });
    container.querySelectorAll('.admin-restrict-action-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdminRestrictModal(btn.dataset.uid, btn.dataset.name));
    });
    container.querySelectorAll('.admin-unrestrict-action-btn').forEach(btn => {
        btn.addEventListener('click', () => adminUnrestrictUser(btn.dataset.uid));
    });
    container.querySelectorAll('.admin-vip-action-btn').forEach(btn => {
        btn.addEventListener('click', () => adminToggleUserVip(btn.dataset.uid, btn.dataset.vip === 'true'));
    });
    container.querySelectorAll('.admin-purge-action-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdminPurgeModal(btn.dataset.uid, btn.dataset.name));
    });

    if (window.lucide) lucide.createIcons();
}

export async function loadAdminPosts() {
    try {
        const snap = await getDocs(collection(db, 'posts'));
        adminPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        adminPosts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (currentAdminTab === 'posts') renderAdminPosts();
    } catch (e) {
        console.warn('Erro ao carregar posts para admin:', e);
    }
}

export function renderAdminPosts() {
    const container = document.getElementById('admin-posts-list');
    if (!container) return;

    const searchTerm = (document.getElementById('admin-posts-search-input')?.value || '').toLowerCase().trim();

    let filtered = adminPosts.filter(p => {
        if (!searchTerm) return true;
        const author = (p.authorName || '').toLowerCase();
        const caption = (p.caption || '').toLowerCase();
        return author.includes(searchTerm) || caption.includes(searchTerm);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="film" class="empty-state-icon"></i>
                <p>Nenhuma publicação encontrada.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(p => {
        const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : '';
        const hasMedia = !!p.mediaUrl;

        return `
            <div class="admin-card" data-post-id="${p.id}">
                <div class="admin-card-header">
                    <div class="admin-card-user-info">
                        <div class="avatar sm" style="background-image: url('${p.authorAvatar || ''}');"></div>
                        <div>
                            <span class="admin-card-title">${p.authorName || 'Autor'}</span>
                            <span class="admin-card-subtitle">${dateStr}</span>
                        </div>
                    </div>
                </div>
                <div class="admin-card-body">
                    <div class="admin-post-preview">
                        ${hasMedia ? `<div class="admin-post-thumb" style="background-image: url('${p.mediaUrl}');"></div>` : ''}
                        <div style="flex:1;">
                            <div style="font-weight:600;">${p.caption || 'Sem legenda'}</div>
                            <small style="color:var(--text-dim);">${(p.comments || []).length} comentários</small>
                        </div>
                    </div>
                </div>
                <div class="admin-card-actions">
                    <button type="button" class="admin-btn-action btn-danger admin-delete-post-action-btn" data-id="${p.id}">
                        <i data-lucide="trash-2"></i> Excluir Publicação
                    </button>
                    <button type="button" class="admin-btn-action btn-danger admin-purge-post-author-btn" data-uid="${p.authorUid}" data-name="${p.authorName}">
                        <i data-lucide="user-x"></i> Banir e Excluir Tudo do Autor
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.admin-delete-post-action-btn').forEach(btn => {
        btn.addEventListener('click', () => adminDeletePost(btn.dataset.id));
    });
    container.querySelectorAll('.admin-purge-post-author-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdminPurgeModal(btn.dataset.uid, btn.dataset.name));
    });

    if (window.lucide) lucide.createIcons();
}

export async function loadAdminGroups() {
    try {
        const snap = await getDocs(collection(db, 'groups'));
        adminGroups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (currentAdminTab === 'groups') renderAdminGroups();
    } catch (e) {
        console.warn('Erro ao carregar grupos para admin:', e);
    }
}

export function renderAdminGroups() {
    const container = document.getElementById('admin-groups-list');
    if (!container) return;

    const searchTerm = (document.getElementById('admin-groups-search-input')?.value || '').toLowerCase().trim();

    let filtered = adminGroups.filter(g => {
        if (!searchTerm) return true;
        const name = (g.name || '').toLowerCase();
        const desc = (g.description || '').toLowerCase();
        return name.includes(searchTerm) || desc.includes(searchTerm);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="message-square" class="empty-state-icon"></i>
                <p>Nenhum grupo encontrado.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(g => {
        const isPaused = !!g.paused;
        const membersCount = (g.members || []).length;

        return `
            <div class="admin-card" data-group-id="${g.id}">
                <div class="admin-card-header">
                    <div class="admin-card-user-info">
                        <div class="avatar sm" style="background-image: url('${g.avatar || ''}');"></div>
                        <div>
                            <span class="admin-card-title">${g.name || 'Grupo VIP'}</span>
                            <span class="admin-card-subtitle">${membersCount} membro(s)</span>
                        </div>
                    </div>
                    <span class="admin-badge ${isPaused ? 'admin-badge-banned' : 'admin-badge-active'}">
                        ${isPaused ? 'PAUSADO' : 'ATIVO'}
                    </span>
                </div>
                <div class="admin-card-body">
                    <div>Descrição: ${g.description || 'Sem descrição'}</div>
                    <div style="font-size:0.72rem; color:var(--text-dim); margin-top:2px;">Criador: ${g.creatorUid || 'ID'}</div>
                </div>
                <div class="admin-card-actions">
                    <button type="button" class="admin-btn-action btn-accent admin-toggle-pause-group-action-btn" data-id="${g.id}" data-paused="${!isPaused}">
                        <i data-lucide="${isPaused ? 'play' : 'pause'}"></i> ${isPaused ? 'Despausar Grupo' : 'Pausar Grupo'}
                    </button>
                    <button type="button" class="admin-btn-action btn-danger admin-delete-group-action-btn" data-id="${g.id}">
                        <i data-lucide="trash-2"></i> Excluir Grupo
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.admin-toggle-pause-group-action-btn').forEach(btn => {
        btn.addEventListener('click', () => adminTogglePauseGroup(btn.dataset.id, btn.dataset.paused === 'true'));
    });
    container.querySelectorAll('.admin-delete-group-action-btn').forEach(btn => {
        btn.addEventListener('click', () => adminDeleteGroup(btn.dataset.id));
    });

    if (window.lucide) lucide.createIcons();
}

export async function loadAdminVipRequests() {
    try {
        const snap = await getDocs(collection(db, 'vip_requests'));
        adminVipRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        adminVipRequests.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));

        const pendingCount = adminVipRequests.filter(r => r.status === 'pending').length;
        const badge = document.getElementById('admin-vip-badge');
        if (badge) {
            badge.innerText = pendingCount;
            badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }

        if (currentAdminTab === 'vip-requests') renderAdminVipRequests();
    } catch (e) {
        console.warn('Erro ao carregar solicitações VIP:', e);
    }
}

export function listenToAdminVipRequests() {
    if (!currentUser || !isUserAdmin()) return;
    if (adminVipRequestsUnsubscribe) adminVipRequestsUnsubscribe();

    try {
        const vipRef = collection(db, 'vip_requests');
        adminVipRequestsUnsubscribe = onSnapshot(vipRef, (snapshot) => {
            adminVipRequests = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            adminVipRequests.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));

            const pendingCount = adminVipRequests.filter(r => r.status === 'pending').length;
            const badge = document.getElementById('admin-vip-badge');
            if (badge) {
                badge.innerText = pendingCount;
                badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
            }

            if (currentAdminTab === 'vip-requests') renderAdminVipRequests();
        }, (err) => console.warn('Erro ao escutar solicitações VIP:', err));
    } catch (e) {
        console.warn('Falha no listener de solicitações VIP:', e);
    }
}

export function renderAdminVipRequests() {
    const container = document.getElementById('admin-vip-requests-list');
    if (!container) return;

    const searchTerm = (document.getElementById('admin-vip-search-input')?.value || '').toLowerCase().trim();

    const filtered = adminVipRequests.filter(r => {
        if (currentAdminVipFilter !== 'all' && r.status !== currentAdminVipFilter) {
            return false;
        }
        if (searchTerm) {
            const name = (r.name || '').toLowerCase();
            const username = (r.username || '').toLowerCase();
            const email = (r.email || '').toLowerCase();
            const uid = (r.uid || '').toLowerCase();
            return name.includes(searchTerm) || username.includes(searchTerm) || email.includes(searchTerm) || uid.includes(searchTerm);
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="badge-check" class="empty-state-icon"></i>
                <p>Nenhuma solicitação VIP encontrada.</p>
                <small>Quando os usuários clicarem em "Assinar", as solicitações aparecerão aqui para aprovação.</small>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(r => {
        const isPending = r.status === 'pending';
        const isApproved = r.status === 'approved';
        const isRejected = r.status === 'rejected';

        let badgeHtml = '';
        if (isPending) {
            badgeHtml = `<span class="admin-badge" style="background: rgba(255,149,0,0.2); border: 1px solid #ff9500; color: #ff9500;">EM ANÁLISE ⏳</span>`;
        } else if (isApproved) {
            badgeHtml = `<span class="admin-badge" style="background: rgba(48,209,88,0.2); border: 1px solid #30d158; color: #30d158;">APROVADA ✅</span>`;
        } else if (isRejected) {
            badgeHtml = `<span class="admin-badge" style="background: rgba(255,59,48,0.2); border: 1px solid #ff3b30; color: #ff3b30;">REJEITADA ❌</span>`;
        } else {
            badgeHtml = `<span class="admin-badge admin-badge-active">${escapeHTML(r.status || 'Nova')}</span>`;
        }

        const dateStr = r.requestedAt ? new Date(r.requestedAt).toLocaleString('pt-BR') : 'Recentemente';

        return `
            <div class="admin-card" data-vip-req-id="${r.id}" data-uid="${r.uid}">
                <div class="admin-card-header">
                    <div class="admin-card-user-info">
                        <div class="avatar sm" style="background-image: url('${r.avatar || ''}');"></div>
                        <div>
                            <span class="admin-card-title">${escapeHTML(r.name || 'Usuário')} ${escapeHTML(r.surname || '')}</span>
                            <span class="admin-card-subtitle">@${escapeHTML(r.username || 'sem_username')}</span>
                        </div>
                    </div>
                    <div>
                        ${badgeHtml}
                    </div>
                </div>
                <div class="admin-card-body">
                    <div>UID: <code style="color:var(--accent-color); font-size:0.75rem;">${r.uid}</code></div>
                    ${r.email ? `<div>Email: ${escapeHTML(r.email)}</div>` : ''}
                    <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 4px;">
                        <i data-lucide="clock" style="width:12px; height:12px; display:inline-block; vertical-align:middle;"></i> Solicitado em: ${dateStr}
                    </div>
                </div>
                <div class="admin-card-actions">
                    ${!isApproved ? `
                        <button type="button" class="admin-btn-action btn-success admin-approve-vip-btn" data-uid="${r.uid}" data-reqid="${r.id}">
                            <i data-lucide="check"></i> Aprovar VIP
                        </button>
                    ` : ''}
                    ${!isRejected ? `
                        <button type="button" class="admin-btn-action btn-danger admin-reject-vip-btn" data-uid="${r.uid}" data-reqid="${r.id}">
                            <i data-lucide="x"></i> Rejeitar
                        </button>
                    ` : ''}
                    ${isApproved ? `
                        <button type="button" class="admin-btn-action btn-danger admin-reject-vip-btn" data-uid="${r.uid}" data-reqid="${r.id}">
                            <i data-lucide="x"></i> Revogar VIP
                        </button>
                    ` : ''}
                    ${isRejected ? `
                        <button type="button" class="admin-btn-action btn-success admin-approve-vip-btn" data-uid="${r.uid}" data-reqid="${r.id}">
                            <i data-lucide="check"></i> Re-aprovar VIP
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.admin-approve-vip-btn').forEach(btn => {
        btn.addEventListener('click', () => adminApproveVipRequest(btn.dataset.uid, btn.dataset.reqid));
    });
    container.querySelectorAll('.admin-reject-vip-btn').forEach(btn => {
        btn.addEventListener('click', () => adminRejectVipRequest(btn.dataset.uid, btn.dataset.reqid));
    });

    if (window.lucide) lucide.createIcons();
}

export async function adminApproveVipRequest(uid, reqId) {
    if (!uid) return;
    const targetId = reqId || uid;
    try {
        await updateDoc(doc(db, 'vip_requests', targetId), {
            status: 'approved',
            approvedAt: Date.now()
        });

        await updateDoc(doc(db, 'users', uid), {
            isVip: true,
            isVerified: true,
            vipRequestStatus: 'approved'
        });

        const req = adminVipRequests.find(r => r.id === targetId || r.uid === uid);
        if (req) {
            req.status = 'approved';
            req.approvedAt = Date.now();
        }

        const userObj = adminUsers.find(u => u.id === uid);
        if (userObj) {
            userObj.isVip = true;
            userObj.isVerified = true;
            userObj.vipRequestStatus = 'approved';
        }

        if (currentUser && currentUser.uid === uid && currentProfile) {
            currentProfile.isVip = true;
            currentProfile.isVerified = true;
            currentProfile.vipRequestStatus = 'approved';
            updateProfileDOM();
        }

        const tagEl = document.getElementById(`vip-tag-${uid}`);
        if (tagEl) tagEl.style.display = 'inline-block';
        const card = document.querySelector(`.chat-card[data-uid="${uid}"]`);
        if (card) card.dataset.isVip = 'true';

        // Dispara notificação oficial para o sino do usuário avisando que o Selo VIP foi aprovado!
        await addDoc(collection(db, 'notifications'), {
            toUid: uid,
            type: 'vip',
            title: 'Selo VIP Aprovado! ⭐',
            message: 'Parabéns! Sua solicitação do Selo VIP foi aprovada pela moderação da VORTEX VIP. O seu selo verificado oficial já está ativo!',
            read: false,
            createdAt: Date.now(),
            author: 'Administração VORTEX VIP'
        }).catch(e => console.warn('Erro ao disparar notificação VIP:', e));

        renderAdminVipRequests();
        if (currentAdminTab === 'users') renderAdminUsers();

        showToast("Solicitação Aprovada", "Selo VIP aprovado e notificação enviada!", "green");
    } catch (err) {
        console.error('Erro ao aprovar solicitação VIP:', err);
        showToast("Erro", "Não foi possível aprovar a solicitação VIP.", "red");
    }
}

export async function adminRejectVipRequest(uid, reqId) {
    if (!uid) return;
    const targetId = reqId || uid;
    try {
        await updateDoc(doc(db, 'vip_requests', targetId), {
            status: 'rejected',
            rejectedAt: Date.now()
        });

        await updateDoc(doc(db, 'users', uid), {
            isVip: false,
            isVerified: false,
            vipRequestStatus: 'rejected'
        });

        const req = adminVipRequests.find(r => r.id === targetId || r.uid === uid);
        if (req) {
            req.status = 'rejected';
            req.rejectedAt = Date.now();
        }

        const userObj = adminUsers.find(u => u.id === uid);
        if (userObj) {
            userObj.isVip = false;
            userObj.isVerified = false;
            userObj.vipRequestStatus = 'rejected';
        }

        if (currentUser && currentUser.uid === uid && currentProfile) {
            currentProfile.isVip = false;
            currentProfile.isVerified = false;
            currentProfile.vipRequestStatus = 'rejected';
            updateProfileDOM();
        }

        const tagEl = document.getElementById(`vip-tag-${uid}`);
        if (tagEl) tagEl.style.display = 'none';
        const card = document.querySelector(`.chat-card[data-uid="${uid}"]`);
        if (card) card.dataset.isVip = 'false';

        renderAdminVipRequests();
        if (currentAdminTab === 'users') renderAdminUsers();

        showToast("Solicitação Rejeitada", "A solicitação VIP foi rejeitada.", "red");
    } catch (err) {
        console.error('Erro ao rejeitar solicitação VIP:', err);
        showToast("Erro", "Não foi possível rejeitar a solicitação VIP.", "red");
    }
}

let adminBroadcastHistory = [];

export function populateBroadcastRecipients() {
    const select = document.getElementById('broadcast-recipient-select');
    if (!select) return;

    const currentVal = select.value || 'all';
    select.innerHTML = `<option value="all">📢 Todos os Usuários (Transmissão Geral)</option>`;

    adminUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.innerText = `👤 ${u.name || 'Usuário'} (@${u.username || 'user'}) - ${u.id}`;
        select.appendChild(opt);
    });

    select.value = currentVal;
}

export async function adminSendBroadcast(type, title, message, recipient = 'all') {
    if (!currentUser || !isUserAdmin()) {
        showToast("Acesso Negado", "Apenas administradores podem disparar comunicados.", "red");
        return false;
    }

    const cleanTitle = (title || '').trim();
    const cleanMsg = (message || '').trim();

    if (!cleanTitle) {
        showToast("Título Obrigatório", "Por favor, informe o título do comunicado.", "orange");
        return false;
    }
    if (!cleanMsg) {
        showToast("Mensagem Obrigatória", "Por favor, digite o conteúdo do aviso ou alerta.", "orange");
        return false;
    }

    try {
        const notifData = {
            toUid: recipient || 'all',
            type: type === 'alert' ? 'alert' : 'warning',
            title: cleanTitle,
            message: cleanMsg,
            read: false,
            createdAt: Date.now(),
            author: 'Administração VORTEX VIP'
        };

        const docRef = await addDoc(collection(db, 'notifications'), notifData);
        notifData.id = docRef.id;

        const tInput = document.getElementById('broadcast-title-input');
        const mInput = document.getElementById('broadcast-message-input');
        if (tInput) tInput.value = '';
        if (mInput) mInput.value = '';

        await loadAdminBroadcastHistory();

        const toastType = type === 'alert' ? '🔴 Alerta Urgente' : '⚠️ Aviso da Plataforma';
        showToast("Comunicado Disparado", `${toastType} enviado com sucesso para o sino de notificações!`, "green");
        return true;
    } catch (err) {
        console.error('Erro ao disparar comunicado:', err);
        showToast("Erro", "Não foi possível disparar o comunicado.", "red");
        return false;
    }
}

export async function loadAdminBroadcastHistory() {
    try {
        const snap = await getDocs(collection(db, 'notifications'));
        adminBroadcastHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        adminBroadcastHistory.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderAdminBroadcastHistory();
    } catch (e) {
        console.warn('Erro ao carregar histórico de comunicados:', e);
    }
}

export function renderAdminBroadcastHistory() {
    const listEl = document.getElementById('admin-broadcast-history-list');
    if (!listEl) return;

    const broadcasts = adminBroadcastHistory.filter(n => n.type === 'warning' || n.type === 'alert');

    if (broadcasts.length === 0) {
        listEl.innerHTML = `
            <div class="admin-empty-state">
                <i data-lucide="inbox" class="empty-state-icon"></i>
                <p>Nenhum comunicado enviado recentemente.</p>
                <small>Use o formulário acima para disparar avisos ⚠️ e alertas 🔴.</small>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    listEl.innerHTML = broadcasts.map(b => {
        const isAlert = b.type === 'alert';
        const typeClass = isAlert ? 'alert' : 'warning';
        const badgeLabel = isAlert ? 'ALERTA 🔴' : 'AVISO ⚠️';
        const targetLabel = b.toUid === 'all' ? '📢 Todos os Usuários' : `👤 Destinatário: ${b.toUid}`;
        const timeStr = b.createdAt ? new Date(b.createdAt).toLocaleString('pt-BR') : 'Recentemente';

        return `
            <div class="admin-card card-${typeClass}" data-broadcast-id="${b.id}">
                <div class="admin-card-header">
                    <div class="admin-card-user-info">
                        <div class="notification-icon-box ${typeClass}" style="width:32px; height:32px;">
                            <i data-lucide="${isAlert ? 'shield-alert' : 'alert-triangle'}"></i>
                        </div>
                        <div>
                            <span class="admin-card-title">${escapeHTML(b.title || 'Comunicado')}</span>
                            <span class="admin-card-subtitle">${targetLabel}</span>
                        </div>
                    </div>
                    <span class="notification-badge ${typeClass}">${badgeLabel}</span>
                </div>
                <div class="admin-card-body">
                    <p style="margin: 0 0 6px 0; font-size: 0.82rem; color: #ddd;">${escapeHTML(b.message || '')}</p>
                    <div style="font-size: 0.72rem; color: var(--text-dim);">
                        <i data-lucide="clock" style="width:11px; height:11px;"></i> Enviado em: ${timeStr}
                    </div>
                </div>
                <div class="admin-card-actions">
                    <button type="button" class="admin-btn-action btn-danger admin-delete-broadcast-btn" data-id="${b.id}">
                        <i data-lucide="trash-2"></i> Excluir Notificação
                    </button>
                </div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.admin-delete-broadcast-btn').forEach(btn => {
        btn.addEventListener('click', () => adminDeleteBroadcast(btn.dataset.id));
    });

    if (window.lucide) lucide.createIcons();
}

export async function adminDeleteBroadcast(id) {
    if (!id) return;
    try {
        await deleteDoc(doc(db, 'notifications', id));
        adminBroadcastHistory = adminBroadcastHistory.filter(b => b.id !== id);
        renderAdminBroadcastHistory();
        showToast("Notificação Excluída", "O comunicado foi removido com sucesso.", "blue");
    } catch (err) {
        console.error('Erro ao excluir comunicado:', err);
        showToast("Erro", "Não foi possível excluir o comunicado.", "red");
    }
}

/* ==========================================================================
   AÇÕES DE MODERAÇÃO ADMINISTRATIVA
   ========================================================================== */
export async function adminBanUser(uid, reason = 'Violação dos Termos de Uso da VORTEX VIP') {
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'users', uid), {
            banned: true,
            banReason: reason,
            bannedAt: Date.now()
        });

        const userObj = adminUsers.find(u => u.id === uid);
        if (userObj) {
            userObj.banned = true;
            userObj.banReason = reason;
        }

        if (currentUser && currentUser.uid === uid && currentProfile) {
            currentProfile.banned = true;
            currentProfile.banReason = reason;
            checkBannedAccountState();
        }

        if (currentAdminTab === 'users') renderAdminUsers();
        showToast("Usuário Banido", `A conta ${uid} foi suspensa com sucesso.`, "red");
    } catch (err) {
        console.error('Erro ao banir usuário:', err);
        showToast("Erro", "Não foi possível banir o usuário.", "red");
    }
}

export async function adminUnbanUser(uid) {
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'users', uid), {
            banned: false,
            banReason: null
        });

        const userObj = adminUsers.find(u => u.id === uid);
        if (userObj) {
            userObj.banned = false;
            userObj.banReason = null;
        }

        if (currentUser && currentUser.uid === uid && currentProfile) {
            currentProfile.banned = false;
            currentProfile.banReason = null;
            checkBannedAccountState();
        }

        if (currentAdminTab === 'users') renderAdminUsers();
        showToast("Usuário Desbanido", "O acesso do usuário foi restaurado com sucesso.", "green");
    } catch (err) {
        console.error('Erro ao desbanir usuário:', err);
        showToast("Erro", "Não foi possível desbanir o usuário.", "red");
    }
}

export async function adminRestrictUser(uid, reason = RESTRICTION_MESSAGE) {
    if (!uid) return;
    try {
        const now = Date.now();
        const restrictionExpiresAt = now + RESTRICTION_DURATION_MS;
        const cleanReason = reason || RESTRICTION_MESSAGE;

        await updateDoc(doc(db, 'users', uid), {
            restricted: true,
            restrictedAt: now,
            restrictionDurationMs: RESTRICTION_DURATION_MS,
            restrictionExpiresAt: restrictionExpiresAt,
            restrictionReason: cleanReason
        });

        const userObj = adminUsers.find(u => u.id === uid);
        if (userObj) {
            userObj.restricted = true;
            userObj.restrictedAt = now;
            userObj.restrictionDurationMs = RESTRICTION_DURATION_MS;
            userObj.restrictionExpiresAt = restrictionExpiresAt;
            userObj.restrictionReason = cleanReason;
        }

        if (currentUser && currentUser.uid === uid && currentProfile) {
            currentProfile.restricted = true;
            currentProfile.restrictedAt = now;
            currentProfile.restrictionDurationMs = RESTRICTION_DURATION_MS;
            currentProfile.restrictionExpiresAt = restrictionExpiresAt;
            currentProfile.restrictionReason = cleanReason;
            checkBannedAccountState();
        }

        if (currentAdminTab === 'users') renderAdminUsers();
        showToast("Restrição Aplicada", "Usuário restrito por 3:00 horas.", "blue");
    } catch (err) {
        console.error('Erro ao restringir usuário:', err);
        showToast("Erro", "Não foi possível restringir o usuário.", "red");
    }
}

export async function adminUnrestrictUser(uid) {
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'users', uid), {
            restricted: false,
            restrictionExpiresAt: null,
            restrictionReason: null
        });

        const userObj = adminUsers.find(u => u.id === uid);
        if (userObj) {
            userObj.restricted = false;
            userObj.restrictionExpiresAt = null;
            userObj.restrictionReason = null;
        }

        if (currentUser && currentUser.uid === uid && currentProfile) {
            currentProfile.restricted = false;
            currentProfile.restrictionExpiresAt = null;
            currentProfile.restrictionReason = null;
            checkBannedAccountState();
        }

        if (currentAdminTab === 'users') renderAdminUsers();
        showToast("Restrição Removida", "A restrição do usuário foi removida com sucesso.", "green");
    } catch (err) {
        console.error('Erro ao remover restrição:', err);
        showToast("Erro", "Não foi possível remover a restrição.", "red");
    }
}

export async function adminPurgeUserData(uid) {
    if (!uid) return;
    try {
        let deletedPostsCount = 0;
        let deletedStoriesCount = 0;
        let deletedGroupsCount = 0;

        // 1. Excluir todas as postagens no feed deste autor
        const postsSnap = await getDocs(query(collection(db, 'posts'), where('authorUid', '==', uid)));
        const postPromises = postsSnap.docs.map(docSnap => deleteDoc(docSnap.ref));
        await Promise.all(postPromises);
        deletedPostsCount = postsSnap.docs.length;

        // 2. Excluir todos os stories deste autor
        const storiesSnap = await getDocs(query(collection(db, 'stories'), where('authorUid', '==', uid)));
        const storyPromises = storiesSnap.docs.map(docSnap => deleteDoc(docSnap.ref));
        await Promise.all(storyPromises);
        deletedStoriesCount = storiesSnap.docs.length;

        // 3. Excluir todos os grupos onde ele é criador
        const groupsSnap = await getDocs(query(collection(db, 'groups'), where('creatorUid', '==', uid)));
        const groupPromises = groupsSnap.docs.map(docSnap => deleteDoc(docSnap.ref));
        await Promise.all(groupPromises);
        deletedGroupsCount = groupsSnap.docs.length;

        // 4. Banir o usuário para segurança da plataforma
        await adminBanUser(uid, 'Conta limpa e banida por violações graves das regras');

        // 5. Atualizar listas locais
        adminPosts = adminPosts.filter(p => p.authorUid !== uid);
        adminGroups = adminGroups.filter(g => g.creatorUid !== uid);

        if (currentAdminTab === 'posts') renderAdminPosts();
        if (currentAdminTab === 'groups') renderAdminGroups();
        if (currentAdminTab === 'users') renderAdminUsers();

        showToast("Limpeza Concluída", `Removidos: ${deletedPostsCount} posts, ${deletedStoriesCount} stories e ${deletedGroupsCount} grupos.`, "green");
    } catch (err) {
        console.error('Erro ao excluir dados do usuário:', err);
        showToast("Erro", "Falha ao limpar dados do usuário.", "red");
    }
}

export async function adminDeletePost(postId) {
    if (!postId) return;
    try {
        await deleteDoc(doc(db, 'posts', postId));
        adminPosts = adminPosts.filter(p => p.id !== postId);
        if (currentAdminTab === 'posts') renderAdminPosts();
        showToast("Post Removido", "Publicação excluída pelo Administrador.", "green");
    } catch (err) {
        console.error('Erro ao excluir post:', err);
        showToast("Erro", "Não foi possível excluir o post.", "red");
    }
}

export async function adminDeleteGroup(groupId) {
    if (!groupId) return;
    try {
        await deleteDoc(doc(db, 'groups', groupId));
        adminGroups = adminGroups.filter(g => g.id !== groupId);
        if (currentAdminTab === 'groups') renderAdminGroups();
        showToast("Grupo Removido", "Grupo excluído pelo Administrador.", "green");
    } catch (err) {
        console.error('Erro ao excluir grupo:', err);
        showToast("Erro", "Não foi possível excluir o grupo.", "red");
    }
}

export async function adminTogglePauseGroup(groupId, paused) {
    if (!groupId) return;
    try {
        await updateDoc(doc(db, 'groups', groupId), { paused });
        const g = adminGroups.find(x => x.id === groupId);
        if (g) g.paused = paused;
        if (currentAdminTab === 'groups') renderAdminGroups();
        showToast("Grupo Atualizado", paused ? "Grupo pausado com sucesso." : "Grupo liberado com sucesso.", "blue");
    } catch (err) {
        console.error('Erro ao alterar status do grupo:', err);
        showToast("Erro", "Não foi possível atualizar o grupo.", "red");
    }
}

export async function adminToggleUserVip(uid, isVip) {
    if (!uid) return;
    try {
        const vipState = Boolean(isVip);
        await updateDoc(doc(db, 'users', uid), {
            isVip: vipState,
            isVerified: vipState,
            vipRequestStatus: vipState ? 'approved' : 'rejected'
        });

        const u = adminUsers.find(x => x.id === uid);
        if (u) {
            u.isVip = vipState;
            u.isVerified = vipState;
            u.vipRequestStatus = vipState ? 'approved' : 'rejected';
        }

        const req = adminVipRequests.find(r => r.id === uid || r.uid === uid);
        if (req) {
            req.status = vipState ? 'approved' : 'rejected';
            await updateDoc(doc(db, 'vip_requests', req.id || uid), {
                status: vipState ? 'approved' : 'rejected'
            }).catch(() => {});
        }

        if (currentUser && currentUser.uid === uid) {
            currentProfile.isVip = vipState;
            currentProfile.isVerified = vipState;
            currentProfile.vipRequestStatus = vipState ? 'approved' : 'rejected';
            updateProfileDOM();
        }

        const tagEl = document.getElementById(`vip-tag-${uid}`);
        if (tagEl) {
            tagEl.style.display = vipState ? 'inline-block' : 'none';
        }
        const card = document.querySelector(`.chat-card[data-uid="${uid}"]`);
        if (card) {
            card.dataset.isVip = vipState ? 'true' : 'false';
        }

        if (currentAdminTab === 'users') renderAdminUsers();
        if (currentAdminTab === 'vip-requests') renderAdminVipRequests();
        showToast("Status VIP", vipState ? "Selo VIP concedido com sucesso." : "Selo VIP removido com sucesso.", "blue");
    } catch (err) {
        console.error('Erro ao atualizar VIP:', err);
        showToast("Erro", "Não foi possível atualizar o selo VIP.", "red");
    }
}

export async function adminResolveReport(reportId) {
    if (!reportId) return;
    try {
        await updateDoc(doc(db, 'reports', reportId), {
            resolved: true,
            resolvedAt: Date.now()
        });
        const rep = adminReports.find(r => r.id === reportId);
        if (rep) rep.resolved = true;
        renderAdminReports();
        showToast("Denúncia Resolvida", "Denúncia marcada como tratada.", "green");
    } catch (err) {
        console.error('Erro ao resolver denúncia:', err);
        showToast("Erro", "Não foi possível resolver a denúncia.", "red");
    }
}

function openAdminBanModal(uid, name) {
    targetBanUser = { uid, name };
    const titleEl = document.getElementById('admin-ban-modal-title');
    const descEl = document.getElementById('admin-ban-modal-desc');
    const inputEl = document.getElementById('admin-ban-reason-input');

    if (titleEl) titleEl.innerText = `Banir ${name || 'Usuário'}?`;
    if (descEl) descEl.innerText = `O usuário ${name || 'selecionado'} perderá o acesso imediato à plataforma VORTEX VIP.`;
    if (inputEl) inputEl.value = '';

    document.getElementById('admin-ban-modal')?.classList.add('active');
}

let targetRestrictUser = null;

function openAdminRestrictModal(uid, name) {
    targetRestrictUser = { uid, name };
    const titleEl = document.getElementById('admin-restrict-modal-title');
    const descEl = document.getElementById('admin-restrict-modal-desc');
    const inputEl = document.getElementById('admin-restrict-reason-input');

    if (titleEl) titleEl.innerText = `Restringir ${name || 'Usuário'} (3 Horas)?`;
    if (descEl) descEl.innerText = `O usuário ${name || 'selecionado'} receberá uma restrição temporal de 3:00 horas: não vai conseguir enviar mensagem, curtir ou comentar. Ainda é possível enviar story e publicar post.`;
    if (inputEl) inputEl.value = RESTRICTION_MESSAGE;

    document.getElementById('admin-restrict-modal')?.classList.add('active');
}

function openAdminPurgeModal(uid, name) {
    targetPurgeUser = { uid, name };
    const titleEl = document.getElementById('admin-purge-modal-title');
    if (titleEl) titleEl.innerText = `Excluir Tudo de ${name || 'Usuário'}?`;
    document.getElementById('admin-purge-modal')?.classList.add('active');
}

export function setAdminReports(reps) {
    adminReports = Array.isArray(reps) ? reps : [];
}
export function getAdminReports() {
    return adminReports;
}

if (typeof window !== 'undefined') {
    window.AUTHORIZED_ADMIN_EMAIL = AUTHORIZED_ADMIN_EMAIL;
    window.isUserAdmin = isUserAdmin;
    window.checkIsVipUser = checkIsVipUser;
    window.isUserBanned = isUserBanned;
    window.isUserRestricted = isUserRestricted;
    window.getRemainingBanTime = getRemainingBanTime;
    window.getRemainingBanTimeFormatted = getRemainingBanTimeFormatted;
    window.getRemainingRestrictionTime = getRemainingRestrictionTime;
    window.getRemainingRestrictionTimeFormatted = getRemainingRestrictionTimeFormatted;
    window.BAN_DURATION_MS = BAN_DURATION_MS;
    window.BAN_RESTRICTION_MESSAGE = BAN_RESTRICTION_MESSAGE;
    window.RESTRICTION_DURATION_MS = RESTRICTION_DURATION_MS;
    window.RESTRICTION_MESSAGE = RESTRICTION_MESSAGE;
    window.showBannedActionNotice = showBannedActionNotice;
    window.showRestrictionActionNotice = showRestrictionActionNotice;
    window.updateAdminUIVisibility = updateAdminUIVisibility;
    window.checkBannedAccountState = checkBannedAccountState;
    window.checkRestrictionAccountState = checkRestrictionAccountState;
    window.openAdminPanel = openAdminPanel;
    window.closeAdminPanel = closeAdminPanel;
    window.switchAdminTab = switchAdminTab;
    window.adminBanUser = adminBanUser;
    window.adminUnbanUser = adminUnbanUser;
    window.adminRestrictUser = adminRestrictUser;
    window.adminUnrestrictUser = adminUnrestrictUser;
    window.adminPurgeUserData = adminPurgeUserData;
    window.adminDeletePost = adminDeletePost;
    window.adminDeleteGroup = adminDeleteGroup;
    window.adminTogglePauseGroup = adminTogglePauseGroup;
    window.adminToggleUserVip = adminToggleUserVip;
    window.adminResolveReport = adminResolveReport;
    window.setAdminReports = setAdminReports;
    window.getAdminReports = getAdminReports;
    window.requestVipSubscription = requestVipSubscription;
    window.loadAdminVipRequests = loadAdminVipRequests;
    window.listenToAdminVipRequests = listenToAdminVipRequests;
    window.renderAdminVipRequests = renderAdminVipRequests;
    window.adminApproveVipRequest = adminApproveVipRequest;
    window.adminRejectVipRequest = adminRejectVipRequest;
    window.openNotificationsPanel = openNotificationsPanel;
    window.closeNotificationsPanel = closeNotificationsPanel;
    window.clearAllNotifications = clearAllNotifications;
    window.renderNotifications = renderNotifications;
    window.updateNotificationsBadge = updateNotificationsBadge;
    window.adminSendBroadcast = adminSendBroadcast;
    window.loadAdminBroadcastHistory = loadAdminBroadcastHistory;
    window.renderAdminBroadcastHistory = renderAdminBroadcastHistory;
    window.adminDeleteBroadcast = adminDeleteBroadcast;
    window.leaveGroup = leaveGroup;
    window.openMessageInfoModal = openMessageInfoModal;
    window.closeMessageInfoModal = closeMessageInfoModal;
    window.openGroupChat = openGroupChat;
    window.closeChat = closeChat;
    window.cleanupActiveGroupListeners = cleanupActiveGroupListeners;
    window.updateGroupChatHeaderStatus = updateGroupChatHeaderStatus;
}

// Listeners de Notificações (Sino e Central de Avisos/Alertas)
document.getElementById('notifications-bell-btn')?.addEventListener('click', openNotificationsPanel);
document.getElementById('close-notifications-btn')?.addEventListener('click', closeNotificationsPanel);
document.getElementById('clear-all-notifications-btn')?.addEventListener('click', clearAllNotifications);

document.querySelectorAll('.notif-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.notif-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentNotifFilter = pill.dataset.notifFilter || 'all';
        renderNotifications();
    });
});

// Listeners de UI do Painel ADM
document.getElementById('admin-panel-btn')?.addEventListener('click', openAdminPanel);
document.getElementById('open-admin-from-settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-panel')?.classList.remove('active');
    openAdminPanel();
});
document.getElementById('close-admin-panel')?.addEventListener('click', closeAdminPanel);

document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        switchAdminTab(btn.dataset.tab);
    });
});

document.getElementById('admin-tab-users-btn')?.addEventListener('click', () => {
    switchAdminTab('users');
});

document.getElementById('admin-tab-vip-requests-btn')?.addEventListener('click', () => {
    switchAdminTab('vip-requests');
});

document.getElementById('admin-tab-broadcast-btn')?.addEventListener('click', () => {
    switchAdminTab('broadcast');
});

document.querySelectorAll('.admin-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.admin-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentAdminReportFilter = pill.dataset.filter || 'all';
        renderAdminReports();
    });
});

document.querySelectorAll('.admin-vip-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.admin-vip-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentAdminVipFilter = pill.dataset.vipFilter || 'all';
        renderAdminVipRequests();
    });
});

document.getElementById('admin-send-broadcast-btn')?.addEventListener('click', async () => {
    const typeEl = document.querySelector('input[name="broadcast-type"]:checked');
    const type = typeEl ? typeEl.value : 'warning';
    const recipient = document.getElementById('broadcast-recipient-select')?.value || 'all';
    const title = document.getElementById('broadcast-title-input')?.value || '';
    const msg = document.getElementById('broadcast-message-input')?.value || '';
    await adminSendBroadcast(type, title, msg, recipient);
});

document.getElementById('admin-reports-search-input')?.addEventListener('input', () => renderAdminReports());
document.getElementById('admin-users-search-input')?.addEventListener('input', () => renderAdminUsers());
document.getElementById('admin-posts-search-input')?.addEventListener('input', () => renderAdminPosts());
document.getElementById('admin-groups-search-input')?.addEventListener('input', () => renderAdminGroups());
document.getElementById('admin-vip-search-input')?.addEventListener('input', () => renderAdminVipRequests());

document.getElementById('admin-confirm-ban-btn')?.addEventListener('click', async () => {
    if (!targetBanUser) return;
    const reason = document.getElementById('admin-ban-reason-input')?.value.trim() || 'Violação dos Termos de Uso';
    await adminBanUser(targetBanUser.uid, reason);
    document.getElementById('admin-ban-modal')?.classList.remove('active');
    targetBanUser = null;
});

document.getElementById('admin-cancel-ban-btn')?.addEventListener('click', () => {
    document.getElementById('admin-ban-modal')?.classList.remove('active');
    targetBanUser = null;
});

document.getElementById('admin-confirm-restrict-btn')?.addEventListener('click', async () => {
    if (!targetRestrictUser) return;
    const reason = document.getElementById('admin-restrict-reason-input')?.value.trim() || RESTRICTION_MESSAGE;
    await adminRestrictUser(targetRestrictUser.uid, reason);
    document.getElementById('admin-restrict-modal')?.classList.remove('active');
    targetRestrictUser = null;
});

document.getElementById('admin-cancel-restrict-btn')?.addEventListener('click', () => {
    document.getElementById('admin-restrict-modal')?.classList.remove('active');
    targetRestrictUser = null;
});

document.getElementById('close-temp-ban-notice-btn')?.addEventListener('click', () => {
    document.getElementById('temp-ban-notice-modal')?.classList.remove('active');
});

document.getElementById('admin-confirm-purge-btn')?.addEventListener('click', async () => {
    if (!targetPurgeUser) return;
    await adminPurgeUserData(targetPurgeUser.uid);
    document.getElementById('admin-purge-modal')?.classList.remove('active');
    targetPurgeUser = null;
});

document.getElementById('admin-cancel-purge-btn')?.addEventListener('click', () => {
    document.getElementById('admin-purge-modal')?.classList.remove('active');
    targetPurgeUser = null;
});

document.getElementById('banned-logout-btn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        location.reload();
    } catch (e) {
        console.error(e);
    }
});

/* ==========================================================================
   DIGITAÇÃO, BOTÃO MIC <-> AVIÃOZINHO & GRAVAÇÃO
   ========================================================================== */
const chatInput = document.getElementById('chat-input-main');
const chatSendBtn = document.getElementById('chat-send-btn-main');

async function updateChatActivity(kind = 'typing', label = '', active = true, duration = 4000) {
    if (!currentUser || !activeChatContact || !activeChatContact.uid) return;

    if (activeChatContact.isGroup) {
        const groupId = activeChatContact.uid;
        // 1. Gravar no Firestore (Canal Primário Seguro)
        const grpActivityDoc = doc(db, 'chats', `group_${groupId}`, 'activity', currentUser.uid);
        if (active) {
            setDoc(grpActivityDoc, {
                active: true,
                kind,
                label: label || 'digitando',
                fromUid: currentUser.uid,
                fromName: currentProfile.name || 'Membro',
                updatedAt: Date.now(),
                expiresAt: Date.now() + Math.max(3000, duration)
            }).catch(() => {});
        } else {
            deleteDoc(grpActivityDoc).catch(() => {});
        }

        // 2. Gravar no RTDB (Canal Secundário)
        if (typeof rtdb !== 'undefined') {
            try {
                const groupTypingRef = ref(rtdb, `group_typing/${groupId}/${currentUser.uid}`);
                if (active) {
                    rtdbSet(groupTypingRef, {
                        active: true,
                        name: currentProfile.name || 'Membro',
                        kind,
                        label: label || 'digitando',
                        updatedAt: Date.now()
                    }).catch(() => {});
                    if (typeof onDisconnect === 'function') {
                        try { onDisconnect(groupTypingRef).remove(); } catch(e) {}
                    }
                } else {
                    rtdbSet(groupTypingRef, null).catch(() => {});
                }
            } catch(e) {}
        }
        return;
    }

    const activityRef = doc(db, 'users', activeChatContact.uid, 'activity', currentUser.uid);
    if (active) {
        await setDoc(activityRef, {
            active: true,
            kind,
            label: label || (kind === 'typing' ? 'digitando' : kind),
            updatedAt: Date.now(),
            expiresAt: Date.now() + Math.max(3000, duration),
            fromUid: currentUser.uid,
            fromName: currentProfile.name
        }).catch(() => {});
    } else {
        await setDoc(activityRef, {
            active: false,
            kind,
            label,
            updatedAt: Date.now(),
            expiresAt: 0,
            fromUid: currentUser.uid,
            fromName: currentProfile.name
        }).catch(() => {});
        deleteDoc(activityRef).catch(() => {});
    }
}

async function updateTypingStateForActiveChat(isTyping) {
    try {
        await updateChatActivity('typing', 'digitando', isTyping, 3500);
    } catch (error) {
        console.error('Erro ao atualizar atividade de digitação:', error);
    }
}

function clearChatActivityTimer() {
    clearTimeout(activityTimer);
    activityTimer = null;
}

function publishTemporaryChatActivity(kind, label, duration = 15000) {
    if (!activeChatContact || !currentUser) return;
    clearChatActivityTimer();
    updateChatActivity(kind, label, true, duration).catch((error) => {
        console.error('Erro ao publicar atividade do chat:', error);
    });
    activityTimer = setTimeout(() => {
        updateChatActivity(kind, label, false).catch(() => {});
    }, duration);
}

if (chatInput) {
    chatInput.addEventListener('input', () => {
        const sendIcon = document.getElementById('chat-send-icon');
        if (editingMessage) {
            sendIcon?.setAttribute('data-lucide', 'check');
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (chatInput.value.trim().length > 0) {
            sendIcon?.setAttribute('data-lucide', 'send');
            if (activeChatContact && currentUser) {
                updateTypingStateForActiveChat(true);
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => updateTypingStateForActiveChat(false), 2500);
            }
        } else {
            sendIcon?.setAttribute('data-lucide', 'mic');
            if (activeChatContact && currentUser) {
                clearTimeout(typingTimer);
                updateTypingStateForActiveChat(false);
            }
        }
        if (window.lucide) lucide.createIcons();
    });

    chatInput.addEventListener('blur', () => {
        if (activeChatContact && currentUser) {
            clearTimeout(typingTimer);
            updateTypingStateForActiveChat(false);
        }
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (editingMessage) {
                e.preventDefault();
                const val = chatInput.value.trim();
                if (!val) {
                    showToast('Aviso', 'A mensagem não pode ficar vazia.', 'yellow');
                    return;
                }
                if (val !== editingMessage.text) {
                    saveEditedMessage(editingMessage, val);
                } else {
                    cancelEditMessage();
                }
                return;
            }

            const val = chatInput.value.trim();
            if (val) {
                sendChatMessage('text', { text: val });
                chatInput.value = '';
                document.getElementById('chat-send-icon')?.setAttribute('data-lucide', 'mic');
                if (activeChatContact && currentUser) updateTypingStateForActiveChat(false);
                if (window.lucide) lucide.createIcons();
            }
        }
    });
}

export function cancelVoiceRecording() {
    isVoiceRecordingCanceled = true;
    clearInterval(recordingInterval);
    recordingSeconds = 0;

    clearChatActivityTimer();
    updateChatActivity('recording', 'gravando áudio', false).catch(() => {});

    const recordingUI = document.getElementById('recording-ui-main');
    const timerEl = document.getElementById('recording-timer-main');
    const inputEl = document.getElementById('chat-input-main');
    const sendBtn = document.getElementById('chat-send-btn-main');
    const slideHint = document.getElementById('recording-slide-cancel');

    if (recordingUI) recordingUI.classList.remove('active');
    if (inputEl) inputEl.classList.remove('chat-input-hidden');
    if (timerEl) timerEl.innerText = '00:00';
    if (slideHint) slideHint.classList.remove('drag-active');
    if (sendBtn) {
        sendBtn.style.transform = '';
        sendBtn.classList.remove('recording-mic-active');
    }

    if (activeAudioStream) {
        try {
            activeAudioStream.getTracks().forEach(t => t.stop());
        } catch (e) {}
        activeAudioStream = null;
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
            mediaRecorder.stop();
        } catch (e) {
            console.warn('Erro ao cancelar MediaRecorder:', e);
        }
    }

    audioChunks = [];
    showToast('Áudio cancelado', 'A gravação de áudio foi cancelada.', 'yellow');
    playSound(clickSound);
}

function handleMicPointerDown(e) {
    if (e && e.button && e.button !== 0) return;
    const chatInput = document.getElementById('chat-input-main');
    const val = chatInput?.value?.trim();
    if (editingMessage || val) return;

    isMicPointerDown = true;
    hasCanceledByDrag = false;
    wasHoldRecording = false;
    micPointerStartX = (e && e.clientX !== undefined) ? e.clientX : 0;
    micPointerStartY = (e && e.clientY !== undefined) ? e.clientY : 0;
    micPointerStartTime = Date.now();

    const sendBtn = document.getElementById('chat-send-btn-main');
    if (e && e.pointerId && sendBtn && typeof sendBtn.setPointerCapture === 'function') {
        try { sendBtn.setPointerCapture(e.pointerId); } catch (_) {}
    }

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        return toggleVoiceRecording();
    }
}

function handleMicPointerMove(e) {
    if (!isMicPointerDown) return;
    if (hasCanceledByDrag) return;

    const currentX = (e && e.clientX !== undefined) ? e.clientX : micPointerStartX;
    const dx = currentX - micPointerStartX;
    const sendBtn = document.getElementById('chat-send-btn-main');
    const slideHint = document.getElementById('recording-slide-cancel');

    if (dx < 0) {
        const clampedDx = Math.max(-120, dx);
        if (sendBtn) {
            sendBtn.style.transform = `translateX(${clampedDx}px)`;
        }
        if (slideHint) {
            slideHint.classList.add('drag-active');
        }

        // Se arrastar 55px ou mais para a esquerda, cancela a gravação
        if (dx <= -55) {
            hasCanceledByDrag = true;
            isMicPointerDown = false;
            cancelVoiceRecording();
            if (sendBtn) sendBtn.style.transform = '';
            if (slideHint) slideHint.classList.remove('drag-active');
        }
    } else {
        if (sendBtn) sendBtn.style.transform = '';
        if (slideHint) slideHint.classList.remove('drag-active');
    }
}

function handleMicPointerUp(e) {
    if (!isMicPointerDown) return;
    isMicPointerDown = false;

    const sendBtn = document.getElementById('chat-send-btn-main');
    const slideHint = document.getElementById('recording-slide-cancel');
    if (sendBtn) sendBtn.style.transform = '';
    if (slideHint) slideHint.classList.remove('drag-active');

    if (hasCanceledByDrag) {
        return;
    }

    const pressDuration = Date.now() - micPointerStartTime;
    if (pressDuration > 400 && mediaRecorder && mediaRecorder.state === 'recording') {
        wasHoldRecording = true;
        toggleVoiceRecording();
    }
}

function handleMicPointerCancel() {
    if (!isMicPointerDown) return;
    isMicPointerDown = false;
    const sendBtn = document.getElementById('chat-send-btn-main');
    const slideHint = document.getElementById('recording-slide-cancel');
    if (sendBtn) sendBtn.style.transform = '';
    if (slideHint) slideHint.classList.remove('drag-active');
}

if (chatSendBtn) {
    chatSendBtn.addEventListener('click', (e) => {
        if (hasCanceledByDrag) {
            hasCanceledByDrag = false;
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            return;
        }

        if (wasHoldRecording) {
            wasHoldRecording = false;
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            return;
        }

        if (editingMessage) {
            const val = chatInput?.value.trim();
            if (!val) {
                showToast('Aviso', 'A mensagem não pode ficar vazia.', 'yellow');
                return;
            }
            if (val !== editingMessage.text) {
                saveEditedMessage(editingMessage, val);
            } else {
                cancelEditMessage();
            }
            return;
        }

        const val = chatInput?.value.trim();
        if (val) {
            sendChatMessage('text', { text: val });
            if (chatInput) chatInput.value = '';
            updateTypingStateForActiveChat(false);
            document.getElementById('chat-send-icon')?.setAttribute('data-lucide', 'mic');
            if (window.lucide) lucide.createIcons();
        } else {
            toggleVoiceRecording();
        }
    });

    chatSendBtn.addEventListener('pointerdown', handleMicPointerDown);
    chatSendBtn.addEventListener('pointermove', handleMicPointerMove);
    chatSendBtn.addEventListener('pointerup', handleMicPointerUp);
    chatSendBtn.addEventListener('pointercancel', handleMicPointerCancel);
}

window.addEventListener('pointermove', (e) => {
    if (isMicPointerDown) {
        handleMicPointerMove(e);
    }
});

window.addEventListener('pointerup', (e) => {
    if (isMicPointerDown) {
        handleMicPointerUp(e);
    }
});

window.addEventListener('pointercancel', () => {
    if (isMicPointerDown) {
        handleMicPointerCancel();
    }
});

document.getElementById('recording-slide-cancel')?.addEventListener('click', () => {
    cancelVoiceRecording();
});

async function sendChatMessage(type = 'text', payload = {}) {
    if (!currentUser || !activeChatContact) return;
    if (isUserBanned(currentProfile)) {
        showToast('Conta Suspensa', 'Sua conta está banida e não pode enviar mensagens.', 'red');
        return;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return;
    }
    if (!activeChatContact.isGroup) {
        if (blockedContactsSet.has(activeChatContact.uid)) {
            showToast('Contato Bloqueado', 'Você bloqueou este contato. Desbloqueie para conversar.', 'red');
            return;
        }
        if (isBlockedByActiveContact) {
            showToast('Bloqueado', 'Você foi bloqueado por este contato e não pode enviar mensagens.', 'red');
            return;
        }
        try {
            const blockedBySnap = await getDoc(doc(db, 'users', activeChatContact.uid, 'blocked', currentUser.uid));
            if (blockedBySnap.exists()) {
                isBlockedByActiveContact = true;
                updateActiveChatBlockedUI();
                showToast('Mensagem não entregue', 'Você foi bloqueado por este contato.', 'red');
                return;
            }
        } catch (e) {
            console.warn('Erro ao checar bloqueio:', e);
        }
    }
    if (activeChatContact.isGroup && activeChatContact.paused) {
        showToast('Grupo pausado', 'O administrador pausou o envio de mensagens.', 'red');
        return;
    }
    if (activeChatContact.isGroup) {
        const groupSnap = await getDoc(doc(db, 'groups', activeChatContact.uid));
        if (!groupSnap.exists()) {
            showToast('Grupo indisponível', 'Este grupo não existe mais.', 'red');
            return;
        }
        if (groupSnap.data().paused) {
            activeChatContact.paused = true;
            const chatInput = document.getElementById('chat-input-main');
            const chatSendButton = document.getElementById('chat-send-btn-main');
            if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = 'Grupo pausado pelo administrador';
            }
            if (chatSendButton) chatSendButton.disabled = true;
            showToast('Grupo pausado', 'O administrador pausou o envio de mensagens.', 'red');
            return;
        }
    }
    const chatId = getActiveChatId();
    if (!chatId) return;

    const msgData = {
        senderUid: currentUser.uid,
        senderName: currentProfile?.name || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuário',
        senderAvatar: currentProfile?.avatar || currentUser?.photoURL || '',
        type: type,
        text: payload.text || '',
        fileData: payload.fileData || '',
        fileName: payload.fileName || '',
        fileSize: payload.fileSize || '',
        duration: payload.duration || '',
        uploadState: payload.uploadState || 'sent',
        uploadPercent: payload.uploadPercent || 100,
        createdAt: Date.now()
    };

    if (payload.poll) {
        msgData.poll = payload.poll;
    }

    if (replyingToMsg) {
        msgData.replyTo = {
            id: replyingToMsg.id,
            text: replyingToMsg.text || (replyingToMsg.type === 'image' ? 'Foto' : (replyingToMsg.type === 'audio' ? 'Áudio' : 'Arquivo')),
            senderName: replyingToMsg.senderName || 'Contato'
        };
        cancelReply();
    }

    const messageRef = await addDoc(collection(db, 'chats', chatId, 'messages'), msgData);
    playSound(replySendSound);
    return messageRef;
}

function createSendingStatusBubble(type, label, fileName = '') {
    const container = document.getElementById('message-container');
    if (!container) return null;

    const iconMap = {
        audio: 'mic',
        image: 'image',
        video: 'video',
        file: 'file-text',
        music: 'music',
        default: 'loader'
    };

    const bubble = document.createElement('div');
    bubble.className = `message sent sending-message sending-${type}`;
    bubble.dataset.sendingType = type;
    bubble.innerHTML = `
        <div class="sending-info">
            <div class="sending-icon-wrap"><i data-lucide="${iconMap[type] || 'loader'}"></i></div>
            <div class="sending-text">
                <span class="sending-title">${label}</span>
                <span class="sending-subtitle">${fileName || 'Preparando arquivo...'}</span>
            </div>
            <div class="sending-spinner"></div>
        </div>
    `;

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    if (window.lucide) lucide.createIcons();
    return bubble;
}

function removeSendingStatusBubble(bubble) {
    if (!bubble) return;
    bubble.remove();
}

export async function toggleVoiceRecording() {
    if (activeChatContact && !activeChatContact.isGroup) {
        if (blockedContactsSet.has(activeChatContact.uid)) {
            showToast('Contato Bloqueado', 'Você bloqueou este contato. Desbloqueie para enviar áudio.', 'red');
            return;
        }
        if (isBlockedByActiveContact) {
            showToast('Bloqueado', 'Você foi bloqueado por este contato e não pode enviar áudios.', 'red');
            return;
        }
    }

    const recordingUI = document.getElementById('recording-ui-main');
    const timerEl = document.getElementById('recording-timer-main');
    const inputEl = document.getElementById('chat-input-main');
    const sendBtn = document.getElementById('chat-send-btn-main');

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        try {
            isVoiceRecordingCanceled = false;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            activeAudioStream = stream;
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const wasCanceled = isVoiceRecordingCanceled;
                isVoiceRecordingCanceled = false;

                if (activeAudioStream) {
                    try { activeAudioStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                    activeAudioStream = null;
                }

                if (wasCanceled) {
                    audioChunks = [];
                    recordingSeconds = 0;
                    if (timerEl) timerEl.innerText = '00:00';
                    if (sendBtn) {
                        sendBtn.style.transform = '';
                        sendBtn.classList.remove('recording-mic-active');
                    }
                    return;
                }

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const sendingBubble = createSendingStatusBubble('audio', 'Enviando áudio', 'Gravando áudio...');
                publishTemporaryChatActivity('audio', 'enviando áudio', 25000);
                const audioLimit = getMediaSizeLimit('audio');
                if (audioBlob.size > audioLimit.bytes) {
                    clearChatActivityTimer();
                    updateChatActivity('audio', 'enviando áudio', false).catch(() => {});
                    removeSendingStatusBubble(sendingBubble);
                    showMediaSizeWarning('audio');
                    return;
                }

                const reader = new FileReader();
                try {
                    await new Promise((resolve, reject) => {
                        reader.onloadend = async () => {
                            try {
                                const capturedSecs = Math.max(1, recordingSeconds || 1);
                                const finalDuration = formatAudioTime(capturedSecs);
                                await sendChatMessage('audio', { fileData: reader.result, duration: finalDuration });
                                resolve();
                            } catch (error) {
                                reject(error);
                            }
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(audioBlob);
                    });
                } catch (error) {
                    console.error('Erro ao enviar áudio:', error);
                    showToast('Erro', 'Não foi possível enviar o áudio.', 'red');
                } finally {
                    clearChatActivityTimer();
                    updateChatActivity('audio', 'enviando áudio', false).catch(() => {});
                    removeSendingStatusBubble(sendingBubble);
                    recordingSeconds = 0;
                    if (timerEl) timerEl.innerText = '00:00';
                    if (sendBtn) {
                        sendBtn.style.transform = '';
                        sendBtn.classList.remove('recording-mic-active');
                    }
                }
            };

            mediaRecorder.start();
            publishTemporaryChatActivity('recording', 'gravando áudio', 45000);
            recordingSeconds = 0;
            if (recordingUI) recordingUI.classList.add('active');
            if (inputEl) inputEl.classList.add('chat-input-hidden');
            if (timerEl) timerEl.innerText = '00:00';
            if (sendBtn) sendBtn.classList.add('recording-mic-active');
            
            clearInterval(recordingInterval);
            recordingInterval = setInterval(() => {
                recordingSeconds++;
                if (timerEl) timerEl.innerText = formatAudioTime(recordingSeconds);
            }, 1000);

            showToast("Microfone", "Gravando áudio... Arraste para a esquerda para cancelar.", "blue");
        } catch (e) {
            console.error(e);
            showToast("Aviso", "Permissão de microfone negada.", "red");
        }
    } else if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        clearChatActivityTimer();
        updateChatActivity('recording', 'gravando áudio', false).catch(() => {});
        clearInterval(recordingInterval);
        if (recordingUI) recordingUI.classList.remove('active');
        if (inputEl) inputEl.classList.remove('chat-input-hidden');
        if (sendBtn) {
            sendBtn.style.transform = '';
            sendBtn.classList.remove('recording-mic-active');
        }
    }
}

export function playVoiceNote(playerEl, audioData) {
    if (!playerEl) return;
    const isPlaying = playerEl.classList.contains('playing');
    const durSpan = playerEl.querySelector('.audio-duration-text');
    const waveBars = playerEl.querySelectorAll('.wave-bar');

    if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        if (typeof currentPlayingAudio._resetUI === 'function') {
            currentPlayingAudio._resetUI();
        }
    }

    document.querySelectorAll('.audio-player-ui.playing').forEach(p => {
        p.classList.remove('playing');
        const ic = p.querySelector('[data-lucide]');
        if (ic) {
            ic.setAttribute('data-lucide', 'play');
            if (window.lucide) lucide.createIcons();
        }
    });

    if (!isPlaying) {
        playerEl.classList.add('playing');
        const icon = playerEl.querySelector('[data-lucide]');
        if (icon) {
            icon.setAttribute('data-lucide', 'pause');
            if (window.lucide) lucide.createIcons();
        }

        currentPlayingAudio = new Audio(audioData);
        const speedText = playerEl.querySelector('.audio-speed-btn')?.innerText.trim() || '1x';
        currentPlayingAudio.playbackRate = parseFloat(speedText) || 1;

        const resetUI = () => {
            playerEl.classList.remove('playing');
            if (icon) {
                icon.setAttribute('data-lucide', 'play');
                if (window.lucide) lucide.createIcons();
            }
            if (durSpan) {
                const totalDur = playerEl.dataset.totalDuration || (currentPlayingAudio && currentPlayingAudio.duration && isFinite(currentPlayingAudio.duration) ? formatAudioTime(currentPlayingAudio.duration) : '');
                if (totalDur && totalDur !== '00:00') {
                    durSpan.innerText = totalDur;
                }
            }
            waveBars.forEach(bar => {
                if (bar && bar.style) bar.style.opacity = '0.4';
            });
        };
        currentPlayingAudio._resetUI = resetUI;

        currentPlayingAudio.onloadedmetadata = () => {
            if (currentPlayingAudio.duration && isFinite(currentPlayingAudio.duration) && currentPlayingAudio.duration > 0) {
                const totalDur = formatAudioTime(currentPlayingAudio.duration);
                playerEl.dataset.totalDuration = totalDur;
                if (!playerEl.classList.contains('playing') && durSpan) {
                    durSpan.innerText = totalDur;
                }
            }
        };

        currentPlayingAudio.ontimeupdate = () => {
            if (durSpan && playerEl.classList.contains('playing')) {
                durSpan.innerText = formatAudioTime(currentPlayingAudio.currentTime);
            }
            if (currentPlayingAudio.duration && isFinite(currentPlayingAudio.duration) && currentPlayingAudio.duration > 0) {
                const progress = currentPlayingAudio.currentTime / currentPlayingAudio.duration;
                const totalBars = waveBars.length;
                const activeCount = Math.floor(progress * totalBars);
                waveBars.forEach((bar, index) => {
                    if (bar && bar.style) {
                        bar.style.opacity = index <= activeCount ? '1' : '0.4';
                    }
                });
            }
        };

        currentPlayingAudio.onended = () => {
            resetUI();
        };

        currentPlayingAudio.onerror = () => {
            resetUI();
        };

        currentPlayingAudio.play().catch(() => {});
    }
}

const attachDrawer = document.getElementById('attachment-panel');
document.getElementById('attach-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    attachDrawer?.classList.toggle('active');
});
document.getElementById('close-attachment-panel')?.addEventListener('click', () => {
    playSound(clickSound);
    attachDrawer?.classList.remove('active');
});

export function openViewOnceModal(src) {
    const overlay = document.getElementById('view-once-overlay');
    const img = document.getElementById('view-once-img');
    if (overlay && img) {
        img.src = src;
        overlay.classList.remove('unlocked');
        overlay.style.display = 'flex';
        playSound(clickSound);
    }
}

export function closeViewOnceModal() {
    const overlay = document.getElementById('view-once-overlay');
    const img = document.getElementById('view-once-img');
    if (overlay) {
        overlay.classList.add('unlocked');
        overlay.style.display = 'none';
        if (img) img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
    }
}

document.getElementById('view-once-overlay')?.addEventListener('click', closeViewOnceModal);
window.openViewOnceModal = openViewOnceModal;
window.closeViewOnceModal = closeViewOnceModal;

/* ==========================================================================
   ENQUETES (POLLS) - CRIAÇÃO, VOTAÇÃO E DETALHES DE VOTOS
   ========================================================================== */
let pollCreatorOptions = ['', ''];

export function openPollCreator() {
    const attachPanel = document.getElementById('attachment-panel');
    if (attachPanel) {
        attachPanel.classList.remove('active');
    }

    const modal = document.getElementById('poll-creator-modal');
    if (!modal) return;

    const qInput = document.getElementById('poll-question-input');
    if (qInput) qInput.value = '';

    const toggle = document.getElementById('poll-allow-multiple-toggle');
    if (toggle) toggle.checked = false;

    pollCreatorOptions = ['', ''];
    renderPollOptionsList();

    modal.style.display = 'flex';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    if (typeof pushBackNavigationState === 'function') {
        pushBackNavigationState('poll-creator-modal');
    }

    setTimeout(() => {
        if (qInput && typeof qInput.focus === 'function') qInput.focus();
    }, 100);
}

export function closePollCreator() {
    const modal = document.getElementById('poll-creator-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

export function renderPollOptionsList() {
    const container = document.getElementById('poll-options-container');
    if (!container) return;
    container.innerHTML = '';

    pollCreatorOptions.forEach((optText, index) => {
        const row = document.createElement('div');
        row.className = 'poll-option-input-row';
        row.dataset.index = index;

        const num = document.createElement('span');
        num.className = 'poll-option-num';
        num.textContent = index + 1;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-text-input poll-option-input';
        input.placeholder = `Opção ${index + 1}`;
        input.maxLength = 100;
        input.value = optText;

        input.addEventListener('input', (e) => {
            pollCreatorOptions[index] = e.target.value;
            validatePollCreator();
        });

        row.appendChild(num);
        row.appendChild(input);

        if (pollCreatorOptions.length > 2) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'poll-remove-option-btn';
            removeBtn.title = 'Remover opção';
            removeBtn.innerHTML = '<i data-lucide="trash-2"></i>';
            removeBtn.addEventListener('click', () => {
                removePollOption(index);
            });
            row.appendChild(removeBtn);
        }

        container.appendChild(row);
    });

    const addBtn = document.getElementById('poll-add-option-btn');
    if (addBtn) {
        addBtn.style.display = pollCreatorOptions.length >= 10 ? 'none' : 'inline-flex';
    }

    if (window.lucide) lucide.createIcons();
    validatePollCreator();
}

export function addPollOption() {
    if (pollCreatorOptions.length >= 10) {
        showToast('Limite atingido', 'Uma enquete pode ter no máximo 10 opções.', 'yellow');
        return;
    }
    pollCreatorOptions.push('');
    renderPollOptionsList();
    const container = document.getElementById('poll-options-container');
    const inputs = container ? container.querySelectorAll('.poll-option-input') : [];
    if (inputs && inputs.length > 0 && typeof inputs[inputs.length - 1].focus === 'function') {
        inputs[inputs.length - 1].focus();
    }
}

export function removePollOption(index) {
    if (pollCreatorOptions.length <= 2) return;
    pollCreatorOptions.splice(index, 1);
    renderPollOptionsList();
}

export function validatePollCreator() {
    const qInput = document.getElementById('poll-question-input');
    const submitBtn = document.getElementById('poll-submit-btn');
    if (!submitBtn) return;

    const question = qInput ? (qInput.value || '').trim() : '';
    const filledOptions = pollCreatorOptions.map(t => (t || '').trim()).filter(t => t.length > 0);

    const isValid = question.length > 0 && filledOptions.length >= 2;
    submitBtn.disabled = !isValid;
}

export async function submitPoll() {
    const qInput = document.getElementById('poll-question-input');
    const submitBtn = document.getElementById('poll-submit-btn');
    const toggle = document.getElementById('poll-allow-multiple-toggle');
    if (!qInput || !submitBtn) return;

    const question = (qInput.value || '').trim();
    const filledOptions = pollCreatorOptions.map(t => (t || '').trim()).filter(t => t.length > 0);

    if (!question || filledOptions.length < 2) {
        showToast('Campos incompletos', 'Informe a pergunta e pelo menos 2 opções.', 'yellow');
        return;
    }

    submitBtn.disabled = true;

    try {
        const options = filledOptions.map((text, idx) => ({
            id: 'opt_' + (idx + 1) + '_' + Date.now().toString(36),
            text: text,
            votes: []
        }));

        const allowMultiple = toggle ? !!toggle.checked : false;

        const pollData = {
            question: question,
            options: options,
            allowMultiple: allowMultiple,
            votersMap: {},
            createdAt: Date.now()
        };

        await sendChatMessage('poll', {
            poll: pollData,
            text: `📊 Enquete: ${question}`
        });

        closePollCreator();
        showToast('Enquete enviada', 'Sua enquete foi compartilhada com sucesso!', 'green');
    } catch (err) {
        console.error('Erro ao enviar enquete:', err);
        showToast('Erro', 'Não foi possível enviar a enquete.', 'red');
    } finally {
        submitBtn.disabled = false;
    }
}

export async function voteOnPoll(msgId, optId, targetChatId = null) {
    if (!currentUser) return;
    if (isUserBanned(currentProfile)) {
        showToast('Conta Suspensa', 'Sua conta está banida e não pode votar.', 'red');
        return;
    }
    const chatId = targetChatId || getActiveChatId();
    if (!chatId) return;

    try {
        const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
        const msgSnap = await getDoc(msgRef);
        if (!msgSnap.exists()) return;
        const msgData = msgSnap.data();
        if (!msgData.poll || !Array.isArray(msgData.poll.options)) return;

        const poll = { ...msgData.poll };
        const allowMultiple = !!poll.allowMultiple;
        const myUid = currentUser.uid;

        if (!poll.votersMap) poll.votersMap = {};

        const myName = currentProfile?.name || currentUser?.displayName || currentUser?.name || currentUser?.email?.split('@')[0] || 'Usuário';
        const myAvatar = currentProfile?.avatar || currentUser?.photoURL || currentUser?.avatar || '';
        poll.votersMap[myUid] = {
            name: myName,
            avatar: myAvatar
        };

        if (!allowMultiple) {
            const clickedOpt = poll.options.find(o => o.id === optId);
            const alreadyVotedThis = clickedOpt && Array.isArray(clickedOpt.votes) && clickedOpt.votes.includes(myUid);

            poll.options = poll.options.map(opt => ({
                ...opt,
                votes: Array.isArray(opt.votes) ? opt.votes.filter(u => u !== myUid) : []
            }));

            if (!alreadyVotedThis && clickedOpt) {
                const target = poll.options.find(o => o.id === optId);
                if (target) {
                    target.votes.push(myUid);
                }
            }
        } else {
            poll.options = poll.options.map(opt => {
                const votes = Array.isArray(opt.votes) ? [...opt.votes] : [];
                if (opt.id === optId) {
                    const idx = votes.indexOf(myUid);
                    if (idx >= 0) {
                        votes.splice(idx, 1);
                    } else {
                        votes.push(myUid);
                    }
                }
                return { ...opt, votes };
            });
        }

        const hasAnyVote = poll.options.some(opt => opt.votes && opt.votes.includes(myUid));
        if (!hasAnyVote && poll.votersMap[myUid]) {
            delete poll.votersMap[myUid];
        }

        await updateDoc(msgRef, { poll });
        playSound(clickSound);
    } catch (err) {
        console.error('Erro ao votar na enquete:', err);
        showToast('Erro', 'Não foi possível registrar o voto.', 'red');
    }
}

export function openPollVotesModal(poll) {
    if (!poll) return;
    const modal = document.getElementById('poll-votes-modal');
    const qEl = document.getElementById('poll-votes-question');
    const listEl = document.getElementById('poll-votes-breakdown');
    if (!modal || !qEl || !listEl) return;

    qEl.textContent = poll.question || 'Enquete';
    listEl.innerHTML = '';

    const votersMap = poll.votersMap || {};
    const totalVotes = (poll.options || []).reduce((acc, opt) => acc + (Array.isArray(opt.votes) ? opt.votes.length : 0), 0);

    (poll.options || []).forEach(opt => {
        const optVotes = Array.isArray(opt.votes) ? opt.votes : [];
        const groupEl = document.createElement('div');
        groupEl.className = 'poll-vote-option-group';

        const pct = totalVotes > 0 ? Math.round((optVotes.length / totalVotes) * 100) : 0;
        const countLabel = optVotes.length === 1 ? '1 voto' : `${optVotes.length} votos`;

        let membersHTML = '';
        if (optVotes.length === 0) {
            membersHTML = `<div class="poll-vote-no-members">Nenhum voto nesta opção ainda.</div>`;
        } else {
            membersHTML = optVotes.map(uid => {
                const voter = votersMap[uid] || {};
                const name = voter.name || (currentUser && uid === currentUser.uid ? (currentProfile?.name || currentUser?.displayName || currentUser?.name || 'Você') : 'Usuário');
                const avatar = voter.avatar || (currentUser && uid === currentUser.uid ? (currentProfile?.avatar || currentUser?.photoURL || currentUser?.avatar || '') : '');
                const initial = name ? name.charAt(0).toUpperCase() : '?';
                const avatarStyle = avatar ? `background-image: url('${avatar}');` : '';
                return `
                    <div class="poll-vote-member-item">
                        <div class="poll-vote-member-avatar" style="${avatarStyle}">
                            ${avatar ? '' : initial}
                        </div>
                        <span class="poll-vote-member-name">${escapeHTML(name)}</span>
                    </div>
                `;
            }).join('');
        }

        groupEl.innerHTML = `
            <div class="poll-vote-option-header">
                <span class="poll-vote-option-title">${escapeHTML(opt.text || '')}</span>
                <span class="poll-vote-option-badge">${countLabel} (${pct}%)</span>
            </div>
            <div class="poll-vote-members-list">
                ${membersHTML}
            </div>
        `;

        listEl.appendChild(groupEl);
    });

    modal.style.display = 'flex';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    if (typeof pushBackNavigationState === 'function') {
        pushBackNavigationState('poll-votes-modal');
    }
}

export function closePollVotesModal() {
    const modal = document.getElementById('poll-votes-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

// Event Listeners para Enquetes
document.getElementById('chat-attach-poll-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    openPollCreator();
});

document.getElementById('close-poll-creator-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    closePollCreator();
});

document.getElementById('poll-cancel-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    closePollCreator();
});

document.getElementById('poll-add-option-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    addPollOption();
});

document.getElementById('poll-question-input')?.addEventListener('input', () => {
    validatePollCreator();
});

document.getElementById('poll-submit-btn')?.addEventListener('click', () => {
    submitPoll();
});

document.getElementById('close-poll-votes-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    closePollVotesModal();
});

document.getElementById('poll-votes-close-bottom-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    closePollVotesModal();
});

document.getElementById('poll-creator-modal')?.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'poll-creator-modal') {
        closePollCreator();
    }
});

document.getElementById('poll-votes-modal')?.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'poll-votes-modal') {
        closePollVotesModal();
    }
});

function handleFileUpload(inputEl, type, options = {}) {
    if (!inputEl) return;
    inputEl.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (activeChatContact && !activeChatContact.isGroup) {
            if (blockedContactsSet.has(activeChatContact.uid)) {
                showToast('Contato Bloqueado', 'Você bloqueou este contato. Desbloqueie para enviar arquivos.', 'red');
                inputEl.value = '';
                return;
            }
            if (isBlockedByActiveContact) {
                showToast('Bloqueado', 'Você foi bloqueado por este contato e não pode enviar arquivos.', 'red');
                inputEl.value = '';
                return;
            }
        }

        const mediaLimit = getMediaSizeLimit(type);
        if (file.size > mediaLimit.bytes) {
            showMediaSizeWarning(type);
            inputEl.value = '';
            return;
        }

        const isViewOnce = !!options.viewOnce;
        const sendingType = file.type.startsWith('audio') ? 'music' : type;
        const sendingLabel = isViewOnce ? 'Enviando foto única' : ({
            image: 'Enviando imagem',
            video: 'Enviando vídeo',
            music: 'Enviando música',
            file: 'Enviando arquivo'
        }[sendingType] || 'Enviando arquivo');

        const sendingBubble = createSendingStatusBubble(sendingType, sendingLabel, file.name);
        publishTemporaryChatActivity(sendingType, sendingLabel, 30000);
        let pendingMessageRef = null;

        try {
            pendingMessageRef = await sendChatMessage(type, {
                fileName: file.name,
                fileSize: `${(file.size / 1024).toFixed(1)} KB`,
                uploadState: 'uploading',
                uploadPercent: 0,
                viewOnce: isViewOnce,
                viewedBy: []
            });
        } catch (error) {
            console.error('Erro ao iniciar envio da mídia:', error);
            clearChatActivityTimer();
            updateChatActivity(sendingType, sendingLabel, false).catch(() => {});
            removeSendingStatusBubble(sendingBubble);
            return;
        }

        const reader = new FileReader();
        reader.onload = async () => {
            try {
                await updateDoc(pendingMessageRef, {
                    fileData: reader.result,
                    fileName: file.name,
                    fileSize: `${(file.size / 1024).toFixed(1)} KB`,
                    uploadState: 'sent',
                    uploadPercent: 100,
                    viewOnce: isViewOnce,
                    viewedBy: []
                });
                showToast("Enviado", `${file.name} enviado com sucesso!`, "green");
            } catch (error) {
                console.error('Erro ao enviar mídia:', error);
                await updateDoc(pendingMessageRef, { uploadState: 'failed', text: 'Falha ao carregar a mídia.' }).catch(() => {});
                showToast('Erro', 'Não foi possível enviar este arquivo.', 'red');
            } finally {
                clearChatActivityTimer();
                updateChatActivity(sendingType, sendingLabel, false).catch(() => {});
                removeSendingStatusBubble(sendingBubble);
            }
        };
        reader.onerror = async () => {
            await updateDoc(pendingMessageRef, { uploadState: 'failed', text: 'Falha ao carregar a mídia.' }).catch(() => {});
            clearChatActivityTimer();
            updateChatActivity(sendingType, sendingLabel, false).catch(() => {});
            removeSendingStatusBubble(sendingBubble);
            showToast('Erro', 'Não foi possível carregar este arquivo.', 'red');
        };
        reader.readAsDataURL(file);
        attachDrawer?.classList.remove('active');
        inputEl.value = '';
    });
}

handleFileUpload(document.getElementById('chat-file-image'), 'image');
handleFileUpload(document.getElementById('chat-file-viewonce'), 'image', { viewOnce: true });
handleFileUpload(document.getElementById('chat-file-video'), 'video');
handleFileUpload(document.getElementById('chat-file-audio'), 'audio');
handleFileUpload(document.getElementById('chat-file-doc'), 'file');

/* ==========================================================================
   CHAMADAS WEBRTC P2P
   ========================================================================== */
async function startCall(isVideo = true) {
    if (!activeChatContact || !currentUser) return;
    if (isUserBanned(currentProfile)) {
        showToast('Conta Suspensa', 'Sua conta está banida.', 'red');
        return;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return;
    }
    if (!activeChatContact.isGroup) {
        if (blockedContactsSet.has(activeChatContact.uid)) {
            showToast('Contato Bloqueado', 'Você bloqueou este contato. Desbloqueie para fazer chamadas.', 'red');
            return;
        }
        if (isBlockedByActiveContact) {
            showToast('Bloqueado', 'Você foi bloqueado por este contato e não pode realizar chamadas.', 'red');
            return;
        }
    }

    const overlay = document.getElementById('video-call-overlay');
    const nameEl = document.getElementById('call-name');
    const avatarEl = document.getElementById('call-avatar');
    const statusEl = document.getElementById('call-status');
    const timerEl = document.getElementById('call-timer');
    const userInfoBox = document.getElementById('call-user-info-box');

    if (nameEl) nameEl.innerText = activeChatContact.name;
    if (avatarEl) avatarEl.style.backgroundImage = activeChatContact.avatar ? `url('${activeChatContact.avatar}')` : '';
    if (statusEl) statusEl.innerText = 'Chamando...';
    if (timerEl) {
        timerEl.style.display = 'none';
        timerEl.innerText = '00:00';
    }
    if (userInfoBox) userInfoBox.classList.remove('video-active');

    if (overlay) overlay.classList.add('active');
    playSound(clickSound);
    ringtoneSound.play().catch(() => {});

    try {
        const callMedia = await requestCallMedia();
        localStream = callMedia.stream;
        if (!callMedia.hasVideo) {
            if (statusEl) statusEl.innerText = 'Conectado somente com áudio';
            if (userInfoBox) userInfoBox.classList.add('audio-only-call');
        }
        const localFeed = document.getElementById('local-webcam-feed');
        if (localFeed) localFeed.srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcServers);
        remoteStream = new MediaStream();

        const remoteFeed = document.getElementById('remote-webcam-feed');
        if (remoteFeed) remoteFeed.srcObject = remoteStream;

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
            if (userInfoBox) userInfoBox.classList.add('video-active');
        };

        const callDocRef = await addDoc(collection(db, 'calls'), {
            callerUid: currentUser.uid,
            callerName: currentProfile.name,
            callerUsername: currentProfile.username,
            callerAvatar: currentProfile.avatar,
            calleeUid: activeChatContact.uid,
            calleeName: activeChatContact.name,
            status: 'ringing',
            type: 'video',
            createdAt: Date.now()
        });
        currentCallId = callDocRef.id;

        const callerCandidatesCol = collection(db, 'calls', currentCallId, 'callerCandidates');
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) addDoc(callerCandidatesCol, event.candidate.toJSON()).catch(() => {});
        };

        const offerDescription = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offerDescription);

        await updateDoc(callDocRef, {
            offer: { sdp: offerDescription.sdp, type: offerDescription.type }
        });

        if (activeCallDocUnsubscribe) activeCallDocUnsubscribe();
        activeCallDocUnsubscribe = onSnapshot(callDocRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (!peerConnection.currentRemoteDescription && data.answer) {
                    const answerDescription = new RTCSessionDescription(data.answer);
                    await peerConnection.setRemoteDescription(answerDescription);

                    ringtoneSound.pause();
                    ringtoneSound.currentTime = 0;
                    if (statusEl) statusEl.innerText = 'Conectado • Criptografia Quântica VIP';
                    if (timerEl) timerEl.style.display = 'block';

                    if (!callTimerInterval) {
                        callSeconds = 0;
                        callTimerInterval = setInterval(() => {
                            callSeconds++;
                            const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
                            const secs = String(callSeconds % 60).padStart(2, '0');
                            if (timerEl) timerEl.innerText = `${mins}:${secs}`;
                        }, 1000);
                    }
                } else if (data.status === 'rejected') {
                    showToast("Chamada", "A chamada foi recusada.", "red");
                    endCall();
                } else if (data.status === 'ended') {
                    endCall();
                }
            }
        });

        const calleeCandidatesCol = collection(db, 'calls', currentCallId, 'calleeCandidates');
        if (calleeCandidatesUnsubscribe) calleeCandidatesUnsubscribe();
        calleeCandidatesUnsubscribe = onSnapshot(calleeCandidatesCol, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    await peerConnection.addIceCandidate(candidate).catch(() => {});
                }
            });
        });

    } catch (err) {
        console.error("Erro ao iniciar chamada WebRTC:", err);
        showToast("Erro", "Não foi possível acessar a câmera.", "red");
        endCall();
    }
}

function listenToIncomingCalls() {
    if (!currentUser) return;
    const callsRef = collection(db, 'calls');
    const q = query(callsRef, where('calleeUid', '==', currentUser.uid), where('status', '==', 'ringing'), limit(1));

    incomingCallUnsubscribe = onSnapshot(q, (snap) => {
        const incomingOverlay = document.getElementById('incoming-call-overlay');
        if (!snap.empty) {
            const callDoc = snap.docs[0];
            const callData = callDoc.data();
            if (callData.callerUid && blockedContactsSet.has(callData.callerUid)) {
                updateDoc(doc(db, 'calls', callDoc.id), { status: 'rejected', endedAt: Date.now() }).catch(() => {});
                return;
            }
            currentCallId = callDoc.id;

            const nameEl = document.getElementById('incoming-caller-name');
            const userEl = document.getElementById('incoming-caller-username');
            const avatarEl = document.getElementById('incoming-caller-avatar');

            if (nameEl) nameEl.innerText = callData.callerName || 'Contato VIP';
            if (userEl) userEl.innerText = callData.callerUsername || '@usuario';
            if (avatarEl) avatarEl.style.backgroundImage = callData.callerAvatar ? `url('${callData.callerAvatar}')` : '';

            if (incomingOverlay) incomingOverlay.classList.add('active');
            
            ringtoneSound.play().catch(() => {});
            startPhoneVibration();

            if (activeCallDocUnsubscribe) activeCallDocUnsubscribe();
            activeCallDocUnsubscribe = onSnapshot(doc(db, 'calls', currentCallId), (docSnap) => {
                if (docSnap.exists() && docSnap.data().status === 'ended') {
                    dismissIncomingCallUI();
                }
            });
        } else {
            dismissIncomingCallUI();
        }
    });
}

function dismissIncomingCallUI() {
    const incomingOverlay = document.getElementById('incoming-call-overlay');
    if (incomingOverlay) incomingOverlay.classList.remove('active');
    ringtoneSound.pause();
    ringtoneSound.currentTime = 0;
    stopPhoneVibration();
}

async function acceptIncomingCall() {
    if (!currentCallId) return;
    dismissIncomingCallUI();

    const overlay = document.getElementById('video-call-overlay');
    const nameEl = document.getElementById('call-name');
    const statusEl = document.getElementById('call-status');
    const timerEl = document.getElementById('call-timer');
    const userInfoBox = document.getElementById('call-user-info-box');

    if (overlay) overlay.classList.add('active');

    try {
        const callMedia = await requestCallMedia();
        localStream = callMedia.stream;
        if (!callMedia.hasVideo && statusEl) statusEl.innerText = 'Atendendo somente com áudio';
        const localFeed = document.getElementById('local-webcam-feed');
        if (localFeed) localFeed.srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcServers);
        remoteStream = new MediaStream();

        const remoteFeed = document.getElementById('remote-webcam-feed');
        if (remoteFeed) remoteFeed.srcObject = remoteStream;

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
            if (userInfoBox) userInfoBox.classList.add('video-active');
        };

        const callDocRef = doc(db, 'calls', currentCallId);
        const callSnap = await getDoc(callDocRef);
        const callData = callSnap.data();

        if (nameEl) nameEl.innerText = callData.callerName || 'Contato';

        const calleeCandidatesCol = collection(db, 'calls', currentCallId, 'calleeCandidates');
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) addDoc(calleeCandidatesCol, event.candidate.toJSON()).catch(() => {});
        };

        const offerDescription = callData.offer;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));

        const answerDescription = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answerDescription);

        await updateDoc(callDocRef, {
            answer: { type: answerDescription.type, sdp: answerDescription.sdp },
            status: 'connected',
            answeredAt: Date.now()
        });

        const callerCandidatesCol = collection(db, 'calls', currentCallId, 'callerCandidates');
        if (callerCandidatesUnsubscribe) callerCandidatesUnsubscribe();
        callerCandidatesUnsubscribe = onSnapshot(callerCandidatesCol, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    await peerConnection.addIceCandidate(candidate).catch(() => {});
                }
            });
        });

        if (statusEl) statusEl.innerText = 'Conectado • Criptografia Quântica VIP';
        if (timerEl) {
            timerEl.style.display = 'block';
            callSeconds = 0;
            clearInterval(callTimerInterval);
            callTimerInterval = setInterval(() => {
                callSeconds++;
                const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
                const secs = String(callSeconds % 60).padStart(2, '0');
                if (timerEl) timerEl.innerText = `${mins}:${secs}`;
            }, 1000);
        }

        if (activeCallDocUnsubscribe) activeCallDocUnsubscribe();
        activeCallDocUnsubscribe = onSnapshot(callDocRef, (snap) => {
            if (snap.exists() && snap.data().status === 'ended') endCall();
        });

    } catch (e) {
        console.error("Erro ao aceitar chamada WebRTC:", e);
        endCall();
    }
}

async function declineIncomingCall() {
    if (!currentCallId) return;
    dismissIncomingCallUI();
    await updateDoc(doc(db, 'calls', currentCallId), { status: 'rejected', endedAt: Date.now() }).catch(() => {});
    currentCallId = null;
}

async function endCall() {
    ringtoneSound.pause();
    ringtoneSound.currentTime = 0;
    stopPhoneVibration();
    clearInterval(callTimerInterval);
    callTimerInterval = null;

    if (currentCallId) {
        await updateDoc(doc(db, 'calls', currentCallId), { status: 'ended', endedAt: Date.now() }).catch(() => {});
        currentCallId = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    const localFeed = document.getElementById('local-webcam-feed');
    const remoteFeed = document.getElementById('remote-webcam-feed');
    if (localFeed) localFeed.srcObject = null;
    if (remoteFeed) remoteFeed.srcObject = null;

    const overlay = document.getElementById('video-call-overlay');
    if (overlay) overlay.classList.remove('active');
    dismissIncomingCallUI();
    playSound(clickSound);
}

document.getElementById('chat-audio-call-btn')?.addEventListener('click', () => startCall(true));
document.getElementById('end-call-btn')?.addEventListener('click', endCall);
document.getElementById('accept-call-btn')?.addEventListener('click', acceptIncomingCall);
document.getElementById('decline-call-btn')?.addEventListener('click', declineIncomingCall);

document.getElementById('mute-mic-btn')?.addEventListener('click', function() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isCallMuted = !audioTrack.enabled;
            this.style.background = isCallMuted ? '#ff3b30' : 'rgba(255, 255, 255, 0.12)';
        }
    }
});

document.getElementById('switch-camera-btn')?.addEventListener('click', async () => {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    if (localStream) {
        const oldVideoTrack = localStream.getVideoTracks()[0];
        if (oldVideoTrack) oldVideoTrack.stop();

        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } });
            const newVideoTrack = newStream.getVideoTracks()[0];
            
            localStream.removeTrack(oldVideoTrack);
            localStream.addTrack(newVideoTrack);

            const localFeed = document.getElementById('local-webcam-feed');
            if (localFeed) localFeed.srcObject = localStream;

            if (peerConnection) {
                const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(newVideoTrack);
            }
        } catch (e) {
            console.warn(e);
        }
    }
});

/* ==========================================================================
   BUSCA, SOLICITAÇÕES, PERFIL & CONFIGURAÇÕES
   ========================================================================== */
async function loadUsersForSearch(qText = '') {
    const container = document.getElementById('search-results-container');
    if (!container) return;

    container.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.85rem; padding: 20px;">Buscando usuários...</p>';

    let queryStr = qText.trim().toLowerCase();
    if (queryStr.startsWith('@')) queryStr = queryStr.substring(1);

    try {
        const usersRef = collection(db, 'users');
        const snap = await getDocs(usersRef);
        const matches = [];

        snap.forEach(d => {
            const u = d.data();
            const uid = d.id;
            if (!currentUser || uid !== currentUser.uid) {
                const uName = (u.name + ' ' + (u.surname || '')).toLowerCase();
                const uUsername = (u.username || '').toLowerCase().replace('@', '');
                if (!queryStr || uName.includes(queryStr) || uUsername.includes(queryStr)) {
                    matches.push({ id: uid, ...u });
                }
            }
        });

        if (matches.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 30px 15px; color: var(--text-dim);">
                    <i data-lucide="user-x" style="width: 42px; height: 42px; margin-bottom: 10px; color: var(--text-dim);"></i>
                    <p style="font-size: 0.9rem; font-weight: 600; color: #fff;">Nenhum usuário encontrado</p>
                    <small style="font-size: 0.75rem;">Verifique o @username digitado ou convide amigos para o VORTEX VIP.</small>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        let sentReqsMap = {};
        let contactsSet = new Set();

        if (currentUser) {
            try {
                const reqsSnap = await getDocs(query(collection(db, 'requests'), where('fromUid', '==', currentUser.uid)));
                reqsSnap.forEach(r => { sentReqsMap[r.data().toUid] = { reqId: r.id, ...r.data() }; });

                const contactsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'contacts'));
                contactsSnap.forEach(c => contactsSet.add(c.id));
            } catch (e) {
                console.warn(e);
            }
        }

        container.innerHTML = matches.map(u => {
            const isFriend = contactsSet.has(u.id);
            const existingReq = sentReqsMap[u.id];
            let btnHTML = '';

            if (isFriend) {
                btnHTML = `<button class="danger-btn open-chat-direct-btn" data-uid="${u.id}" data-name="${u.name}" data-avatar="${u.avatar || ''}" style="background:var(--accent-color); color:#000; font-weight:bold; padding:6px 12px; font-size:0.75rem; border:none; border-radius:8px;">Conversar</button>`;
            } else if (existingReq) {
                if (existingReq.status === 'pending') {
                    btnHTML = `<button class="danger-btn cancel-req-btn" data-reqid="${existingReq.reqId}" style="background:#262626; color:#aaa; border:1px solid #444; padding:6px 12px; font-size:0.75rem; border-radius:8px;">Cancelar</button>`;
                } else if (existingReq.status === 'accepted') {
                    btnHTML = `<button class="danger-btn open-chat-direct-btn" data-uid="${u.id}" data-name="${u.name}" data-avatar="${u.avatar || ''}" style="background:var(--accent-color); color:#000; font-weight:bold; padding:6px 12px; font-size:0.75rem; border:none; border-radius:8px;">Conversar</button>`;
                } else {
                    btnHTML = `<button class="danger-btn send-req-btn" data-to="${u.id}" style="background:#ff3b30; color:#fff; border:none; padding:6px 12px; font-size:0.75rem; border-radius:8px;">Solicitar de novo</button>`;
                }
            } else {
                btnHTML = `<button class="danger-btn send-req-btn" data-to="${u.id}" style="background:var(--accent-color); color:#000; font-weight:bold; padding:6px 12px; font-size:0.75rem; border:none; border-radius:8px;">Solicitar</button>`;
            }

            const userBio = (u.status && u.status.trim()) ? u.status.trim() : 'Disponível no VORTEX ⚡';
            return `
                <div class="member-list-item">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="avatar sm" style="background-image: url('${u.avatar || ''}');">
                            ${!u.avatar ? (u.name || 'U').charAt(0).toUpperCase() : ''}
                        </div>
                        <div>
                            <div style="display:flex; align-items:center; gap:4px;">
                                <span style="font-size:0.88rem; font-weight:600; color:#fff;">${u.name} ${u.surname || ''}</span>
                                <i data-lucide="badge-check" class="verified-badge" style="display:${(u.isVip || u.isVerified || checkIsVipUser(u)) ? 'inline-flex' : 'none'};"></i>
                            </div>
                            <div style="font-size:0.72rem; color:var(--accent-color);">${u.username || '@usuario'}</div>
                            <div class="search-user-bio">💬 "${userBio}"</div>
                        </div>
                    </div>
                    ${btnHTML}
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();

        container.querySelectorAll('.send-req-btn').forEach(btn => {
            btn.onclick = async () => {
                if (!currentUser) return;
                const toUid = btn.dataset.to;
                btn.innerText = 'Solicitando...';
                btn.disabled = true;
                const isMyVip = checkIsVipUser(currentProfile);
                await addDoc(collection(db, 'requests'), {
                    fromUid: currentUser.uid,
                    fromName: currentProfile.name,
                    fromUsername: currentProfile.username,
                    fromAvatar: currentProfile.avatar,
                    fromBio: currentProfile.status || 'Disponível no VORTEX ⚡',
                    fromIsVip: isMyVip,
                    fromIsVerified: isMyVip,
                    toUid: toUid,
                    status: 'pending',
                    createdAt: Date.now()
                });
                showToast("Solicitação", "Solicitação enviada!", "green");
                loadUsersForSearch(document.getElementById('search-user-input')?.value || '');
            };
        });

        container.querySelectorAll('.cancel-req-btn').forEach(btn => {
            btn.onclick = async () => {
                await deleteDoc(doc(db, 'requests', btn.dataset.reqid));
                showToast("Solicitação", "Solicitação cancelada.", "blue");
                loadUsersForSearch(document.getElementById('search-user-input')?.value || '');
            };
        });

        container.querySelectorAll('.open-chat-direct-btn').forEach(btn => {
            btn.onclick = () => {
                document.getElementById('close-search-panel')?.click();
                openDirectChat({
                    uid: btn.dataset.uid,
                    name: btn.dataset.name,
                    avatar: btn.dataset.avatar
                });
            };
        });

    } catch (e) {
        console.error("Erro ao carregar usuários:", e);
        container.innerHTML = '<p style="color:var(--text-dim); text-align:center; padding: 20px;">Erro ao buscar usuários.</p>';
    }
}

const searchUserInput = document.getElementById('search-user-input');
if (searchUserInput) {
    searchUserInput.addEventListener('input', () => {
        loadUsersForSearch(searchUserInput.value);
    });
}

function listenToRequests() {
    if (!currentUser) return;
    const reqsRef = collection(db, 'requests');
    const q = query(reqsRef, where('toUid', '==', currentUser.uid), where('status', '==', 'pending'));

    requestsUnsubscribe = onSnapshot(q, (snapshot) => {
        const badge = document.getElementById('requests-badge');
        const listContainer = document.getElementById('requests-list-container');
        const reqs = [];

        snapshot.forEach(d => reqs.push({ id: d.id, ...d.data() }));

        if (badge) {
            badge.innerText = reqs.length;
            badge.classList.toggle('active', reqs.length > 0);
        }

        if (listContainer) {
            if (reqs.length === 0) {
                listContainer.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.85rem; padding: 20px;">Nenhuma solicitação pendente.</p>';
                return;
            }

            listContainer.innerHTML = reqs.map(r => {
                const reqBio = (r.fromBio && r.fromBio.trim()) ? r.fromBio.trim() : 'Disponível no VORTEX ⚡';
                return `
                    <div class="member-list-item">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div class="avatar sm" style="background-image: url('${r.fromAvatar || ''}');">
                                ${!r.fromAvatar ? (r.fromName || 'U').charAt(0).toUpperCase() : ''}
                            </div>
                            <div>
                                <div style="display:flex; align-items:center; gap:4px;">
                                    <span style="font-size:0.88rem; font-weight:600;">${r.fromName}</span>
                                    <i data-lucide="badge-check" class="verified-badge" style="display:${(r.fromIsVip || r.fromIsVerified) ? 'inline-flex' : 'none'};"></i>
                                </div>
                                <div style="font-size:0.7rem; color:var(--accent-color);">${r.fromUsername || '@usuario'}</div>
                                <div class="search-user-bio">💬 "${reqBio}"</div>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="danger-btn accept-req-action" data-id="${r.id}" data-fromuid="${r.fromUid}" data-fromname="${r.fromName}" data-fromavatar="${r.fromAvatar || ''}" data-frombio="${reqBio}" data-fromvip="${Boolean(r.fromIsVip || r.fromIsVerified)}" style="background:var(--accent-color); color:#000; border:none; padding:4px 10px; font-size:0.75rem; font-weight:bold;">Aceitar</button>
                            <button class="danger-btn reject-req-action" data-id="${r.id}" style="padding:4px 10px; font-size:0.75rem;">Recusar</button>
                        </div>
                    </div>
                `;
            }).join('');

            if (window.lucide) lucide.createIcons();

            listContainer.querySelectorAll('.accept-req-action').forEach(b => {
                b.onclick = async () => {
                    const reqId = b.dataset.id;
                    const senderUid = b.dataset.fromuid;
                    const senderName = b.dataset.fromname;
                    const senderAvatar = b.dataset.fromavatar;
                    const senderBio = b.dataset.frombio || 'Disponível no VORTEX ⚡';
                    const senderIsVip = b.dataset.fromvip === 'true';

                    await updateDoc(doc(db, 'requests', reqId), { status: 'accepted' });

                    await setDoc(doc(db, 'users', currentUser.uid, 'contacts', senderUid), {
                        uid: senderUid,
                        name: senderName,
                        avatar: senderAvatar,
                        status: senderBio,
                        isVip: senderIsVip,
                        isVerified: senderIsVip,
                        addedAt: Date.now()
                    });

                    const myVip = checkIsVipUser(currentProfile);
                    await setDoc(doc(db, 'users', senderUid, 'contacts', currentUser.uid), {
                        uid: currentUser.uid,
                        name: currentProfile.name,
                        avatar: currentProfile.avatar,
                        status: currentProfile.status || 'Disponível no VORTEX ⚡',
                        isVip: myVip,
                        isVerified: myVip,
                        addedAt: Date.now()
                    });

                    // Sincronizar stories ativos do currentUser para incluir o novo contato aceito
                    try {
                        const activeStoriesSnap = await getDocs(query(
                            collection(db, 'stories'),
                            where('authorUid', '==', currentUser.uid),
                            where('createdAt', '>=', Date.now() - 24 * 60 * 60 * 1000)
                        ));
                        activeStoriesSnap.forEach(sDoc => {
                            updateDoc(sDoc.ref, { allowedUids: arrayUnion(senderUid) }).catch(() => {});
                        });
                    } catch (err) {
                        console.warn('Erro ao sincronizar novo contato com stories:', err);
                    }

                    showToast("Contato Aceito", `${senderName} adicionado aos contatos!`, "green");
                    document.getElementById('requests-panel')?.classList.remove('active');
                };
            });

            listContainer.querySelectorAll('.reject-req-action').forEach(b => {
                b.onclick = async () => {
                    await updateDoc(doc(db, 'requests', b.dataset.id), { status: 'rejected' });
                    showToast("Recusada", "Solicitação recusada.", "red");
                };
            });
        }
    });
}

let currentChatFilter = 'todos';

export function applyChatFilter(filter = currentChatFilter) {
    currentChatFilter = filter;
    const cards = document.querySelectorAll('.chat-card');
    let visibleCount = 0;
    let totalUnreadCount = 0;

    cards.forEach(card => {
        const isUnread = card.classList.contains('unread') || card.dataset.unread === 'true';
        const isGroup = card.dataset.isGroup === 'true';
        const vipTag = card.querySelector('.tag-vip');
        const isVip = card.dataset.isVip === 'true' || (vipTag && vipTag.style.display !== 'none');

        if (isUnread) totalUnreadCount++;

        let shouldShow = false;
        if (filter === 'todos') {
            shouldShow = true;
        } else if (filter === 'nao-lidas') {
            shouldShow = isUnread;
        } else if (filter === 'grupos') {
            shouldShow = isGroup;
        } else if (filter === 'vips') {
            shouldShow = isVip;
        }

        card.style.display = shouldShow ? 'flex' : 'none';
        if (shouldShow) visibleCount++;
    });

    if (typeof applyPinnedSortToChatList === 'function') {
        applyPinnedSortToChatList();
    }

    // Atualizar badge contador na pílula "Não lidas"
    const unreadPill = document.querySelector('.filter-pill[data-filter="nao-lidas"]');
    if (unreadPill) {
        let counterEl = unreadPill.querySelector('.filter-counter');
        if (!counterEl) {
            counterEl = document.createElement('span');
            counterEl.className = 'filter-counter';
            unreadPill.appendChild(counterEl);
        }
        if (totalUnreadCount > 0) {
            counterEl.innerText = totalUnreadCount > 99 ? '99+' : String(totalUnreadCount);
            counterEl.style.display = 'inline-block';
        } else {
            counterEl.style.display = 'none';
        }
    }

    // Feedback visual caso a lista filtrada esteja vazia
    const emptyState = document.getElementById('empty-chat-state');
    if (emptyState) {
        if (visibleCount === 0 && cards.length > 0) {
            emptyState.style.display = 'flex';
            const p = emptyState.querySelector('p');
            if (p) {
                if (filter === 'nao-lidas') p.innerText = 'Nenhuma conversa com mensagens não lidas.';
                else if (filter === 'grupos') p.innerText = 'Nenhum grupo encontrado.';
                else if (filter === 'vips') p.innerText = 'Nenhum contato VIP.';
                else p.innerText = 'Nenhuma conversa encontrada.';
            }
        } else if (cards.length === 0) {
            emptyState.style.display = 'flex';
        } else {
            emptyState.style.display = 'none';
        }
    }
}

if (typeof window !== 'undefined') {
    window.applyChatFilter = applyChatFilter;
}

document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        playSound(clickSound);
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        applyChatFilter(pill.dataset.filter);
    });
});

document.getElementById('search-trigger')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('search-user-panel')?.classList.add('active');
    loadUsersForSearch('');
    document.getElementById('search-user-input')?.focus();
});
document.getElementById('close-search-panel')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('search-user-panel')?.classList.remove('active');
});

document.getElementById('requests-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('requests-panel')?.classList.add('active');
});
document.getElementById('close-requests-panel')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('requests-panel')?.classList.remove('active');
});

const postMediaInput = document.getElementById('post-media-input');
const postPreviewBox = document.getElementById('post-preview-box');
const postPreview = document.getElementById('post-preview');
const postCaptionInput = document.getElementById('post-caption-input');
let postsFeedUnsubscribe = null;

let pendingPostFile = null;
let pendingPostMediaData = null;
let pendingPostMediaInfo = null;

export function getPendingPostFile() {
    return pendingPostFile;
}
export function getPendingPostMediaData() {
    return pendingPostMediaData;
}
export function getPendingPostMediaInfo() {
    return pendingPostMediaInfo;
}

function resetPostComposer() {
    if (postMediaInput) postMediaInput.value = '';
    if (postPreview) postPreview.innerHTML = '';
    if (postPreviewBox) postPreviewBox.classList.add('hidden');
    if (postCaptionInput) postCaptionInput.value = '';
    pendingPostFile = null;
    pendingPostMusic = null;
    pendingPostMediaData = null;
    pendingPostMediaInfo = null;
    const infoBar = document.getElementById('post-media-info-bar');
    if (infoBar) infoBar.style.display = 'none';
    const sizeEl = document.getElementById('post-preview-size');
    if (sizeEl) sizeEl.innerHTML = `<i data-lucide="hard-drive"></i> <span>0 KB</span>`;
    const durEl = document.getElementById('post-preview-duration');
    if (durEl) durEl.style.display = 'none';
    const trimBadge = document.getElementById('post-preview-trimmed-badge');
    if (trimBadge) trimBadge.style.display = 'none';
    const postCard = document.getElementById('post-selected-music-card');
    if (postCard) postCard.style.display = 'none';
    const postAddBtn = document.getElementById('post-add-music-btn');
    if (postAddBtn) postAddBtn.style.display = 'inline-flex';
    if (composerPreviewAudio) {
        try { composerPreviewAudio.pause(); } catch(e) {}
        composerPreviewAudio = null;
    }
}

const openPostCommentCards = new Set();

export async function deletePost(postId) {
    if (typeof confirm === 'function' && !confirm('Deseja realmente excluir esta publicação?')) return;
    try {
        await deleteDoc(doc(db, 'posts', postId));
        getDocs(collection(db, 'posts', postId, 'chunks')).then(snap => {
            if (snap && snap.docs) snap.docs.forEach(d => deleteDoc(d.ref).catch(() => {}));
        }).catch(() => {});
        mediaChunkCache.delete(`posts_${postId}`);
        showToast('Post excluído', 'A publicação foi removida com sucesso.', 'green');
    } catch (err) {
        console.error('Erro ao excluir post:', err);
        showToast('Erro', 'Não foi possível excluir a publicação.', 'red');
    }
}

export let activeEditingComment = null;

export function getSortedPostComments(comments) {
    if (!Array.isArray(comments)) return [];
    const list = comments.map((c, idx) => ({
        ...c,
        id: c.id || ('comm_' + (c.createdAt || idx) + '_' + idx),
        likes: Array.isArray(c.likes) ? c.likes : [],
        isPinned: !!c.isPinned,
        _originalIndex: idx
    }));

    const pinned = list.filter(c => c.isPinned);
    const unpinned = list.filter(c => !c.isPinned);

    pinned.sort((a, b) => (a.pinnedAt || 0) - (b.pinnedAt || 0));

    return [...pinned, ...unpinned];
}

export function isPostOwner(postData, user = currentUser, profile = currentProfile) {
    if (!user || !postData) return false;
    const userUid = user.uid || (profile && profile.uid);
    const postAuthorUid = postData.authorUid;
    if (postAuthorUid) {
        return Boolean(userUid && postAuthorUid === userUid);
    }
    if (postData.authorName && profile?.name && profile.name !== 'Usuário') {
        return profile.name === postData.authorName;
    }
    return false;
}

export function isCommentAuthor(commentData, user = currentUser, profile = currentProfile) {
    if (!user || !commentData) return false;
    const userUid = user.uid || (profile && profile.uid);
    const commentAuthorUid = commentData.authorUid;
    if (commentAuthorUid) {
        return Boolean(userUid && commentAuthorUid === userUid);
    }
    if (commentData.author && profile?.name && profile.name !== 'Usuário') {
        return profile.name === commentData.author;
    }
    return false;
}

export async function deletePostComment(postId, commentIndexOrId) {
    if (!currentUser) {
        showToast('Login necessário', 'Entre para excluir comentários.', 'red');
        return false;
    }
    if (typeof confirm === 'function' && !confirm('Deseja excluir este comentário?')) return false;
    try {
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return false;
        const postData = postSnap.data();
        const comments = Array.isArray(postData.comments) ? [...postData.comments] : [];

        let targetIndex = -1;
        if (typeof commentIndexOrId === 'number') {
            targetIndex = commentIndexOrId;
        } else if (typeof commentIndexOrId === 'string') {
            targetIndex = comments.findIndex((c, i) => c.id === commentIndexOrId || ('comm_' + (c.createdAt || i) + '_' + i) === commentIndexOrId || String(i) === commentIndexOrId);
        }

        if (targetIndex < 0 || targetIndex >= comments.length) return false;

        const targetComment = comments[targetIndex];
        const isOwner = isPostOwner(postData, currentUser, currentProfile);
        const isAuthor = isCommentAuthor(targetComment, currentUser, currentProfile);

        if (!isOwner && !isAuthor) {
            showToast('Permissão negada', 'Apenas o dono do post ou o usuário que comentou pode apagar este comentário.', 'red');
            return false;
        }

        comments.splice(targetIndex, 1);
        await updateDoc(postRef, { comments });
        if (activeCommentPost && activeCommentPost.id === postId) {
            activeCommentPost.comments = comments;
            renderCommentsModalList();
        }
        showToast('Comentário excluído', 'O comentário foi removido.', 'blue');
        return true;
    } catch (err) {
        console.error('Erro ao excluir comentário:', err);
        showToast('Erro', 'Não foi possível excluir o comentário.', 'red');
        return false;
    }
}

export async function submitInlineComment(postId, text) {
    if (!currentUser) {
        showToast('Login necessário', 'Entre para comentar.', 'red');
        return;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return;
    }
    const cleanText = text?.trim();
    if (!cleanText) return;

    try {
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return;
        const postData = postSnap.data();
        const comments = Array.isArray(postData.comments) ? [...postData.comments] : [];
        const commentId = 'comm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const isMyVip = checkIsVipUser(currentProfile);
        comments.push({
            id: commentId,
            author: currentProfile?.name || currentUser.displayName || 'Usuário',
            authorUid: currentUser.uid,
            authorUsername: currentProfile?.username || '',
            authorEmail: currentProfile?.email || currentUser?.email || '',
            text: cleanText,
            createdAt: Date.now(),
            isPinned: false,
            isVip: isMyVip,
            isVerified: isMyVip,
            likes: []
        });
        openPostCommentCards.add(postId);
        await updateDoc(postRef, { comments });
        if (activeCommentPost && activeCommentPost.id === postId) {
            activeCommentPost.comments = comments;
            renderCommentsModalList();
        }
        showToast('Comentário publicado', 'Seu comentário foi adicionado!', 'green');
        playSound(clickSound);
    } catch (err) {
        console.error('Erro ao salvar comentário:', err);
        showToast('Erro', 'Não foi possível enviar o comentário.', 'red');
    }
}

export async function togglePinPostComment(postId, commentIdOrIdx) {
    if (!currentUser) {
        showToast('Login necessário', 'Faça login para gerenciar comentários.', 'red');
        return false;
    }
    try {
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return false;
        const postData = postSnap.data();

        const isOwner = isPostOwner(postData, currentUser, currentProfile);

        if (!isOwner) {
            showToast('Permissão negada', 'Apenas o dono da publicação pode fixar comentários dos usuários.', 'red');
            return false;
        }

        const comments = Array.isArray(postData.comments) ? [...postData.comments] : [];
        let targetIndex = -1;
        if (typeof commentIdOrIdx === 'number') {
            targetIndex = commentIdOrIdx;
        } else {
            targetIndex = comments.findIndex((c, i) => c.id === commentIdOrIdx || ('comm_' + (c.createdAt || i) + '_' + i) === commentIdOrIdx || String(i) === commentIdOrIdx);
        }

        if (targetIndex < 0 || targetIndex >= comments.length) return false;

        const targetComment = { ...comments[targetIndex] };
        targetComment.id = targetComment.id || ('comm_' + (targetComment.createdAt || targetIndex) + '_' + targetIndex);
        const currentlyPinnedCount = comments.filter((c, i) => i !== targetIndex && c.isPinned).length;

        if (!targetComment.isPinned) {
            if (currentlyPinnedCount >= 4) {
                showToast('Limite atingido', 'Você só pode fixar até 4 comentários nesta publicação. Desafixe um para fixar outro.', 'yellow');
                return false;
            }
            targetComment.isPinned = true;
            targetComment.pinnedAt = Date.now();
            comments[targetIndex] = targetComment;
            await updateDoc(postRef, { comments });
            if (activeCommentPost && activeCommentPost.id === postId) {
                activeCommentPost.comments = comments;
                renderCommentsModalList();
            }
            showToast('Comentário fixado', 'O comentário foi fixado no topo da publicação! 📌', 'green');
            playSound(clickSound);
            return true;
        } else {
            targetComment.isPinned = false;
            delete targetComment.pinnedAt;
            comments[targetIndex] = targetComment;
            await updateDoc(postRef, { comments });
            if (activeCommentPost && activeCommentPost.id === postId) {
                activeCommentPost.comments = comments;
                renderCommentsModalList();
            }
            showToast('Comentário desafixado', 'O comentário foi desafixado.', 'blue');
            return true;
        }
    } catch (err) {
        console.error('Erro ao fixar/desafixar comentário:', err);
        showToast('Erro', 'Não foi possível alterar a fixação do comentário.', 'red');
        return false;
    }
}

export async function editPostComment(postId, commentIdOrIdx, newText) {
    if (!currentUser) {
        showToast('Login necessário', 'Entre para editar o comentário.', 'red');
        return false;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return false;
    }
    const cleanText = (newText || '').trim();
    if (!cleanText) {
        showToast('Texto vazio', 'O comentário não pode ficar vazio.', 'yellow');
        return false;
    }

    try {
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return false;
        const postData = postSnap.data();
        const comments = Array.isArray(postData.comments) ? [...postData.comments] : [];

        let targetIndex = -1;
        if (typeof commentIdOrIdx === 'number') {
            targetIndex = commentIdOrIdx;
        } else {
            targetIndex = comments.findIndex((c, i) => c.id === commentIdOrIdx || ('comm_' + (c.createdAt || i) + '_' + i) === commentIdOrIdx || String(i) === commentIdOrIdx);
        }

        if (targetIndex < 0 || targetIndex >= comments.length) return false;

        const targetComment = { ...comments[targetIndex] };
        const isAuthor = isCommentAuthor(targetComment, currentUser, currentProfile);

        if (!isAuthor) {
            showToast('Permissão negada', 'Você só pode editar seus próprios comentários.', 'red');
            return false;
        }

        targetComment.text = cleanText;
        targetComment.isEdited = true;
        targetComment.editedAt = Date.now();
        targetComment.id = targetComment.id || ('comm_' + (targetComment.createdAt || targetIndex) + '_' + targetIndex);
        comments[targetIndex] = targetComment;

        await updateDoc(postRef, { comments });
        if (activeCommentPost && activeCommentPost.id === postId) {
            activeCommentPost.comments = comments;
            renderCommentsModalList();
        }
        showToast('Comentário editado', 'Seu comentário foi atualizado com sucesso!', 'green');
        playSound(clickSound);
        return true;
    } catch (err) {
        console.error('Erro ao editar comentário:', err);
        showToast('Erro', 'Não foi possível salvar a edição.', 'red');
        return false;
    }
}

export async function toggleLikePostComment(postId, commentIdOrIdx) {
    if (!currentUser) {
        showToast('Login necessário', 'Entre para curtir o comentário.', 'red');
        return false;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return false;
    }

    try {
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return false;
        const postData = postSnap.data();
        const comments = Array.isArray(postData.comments) ? [...postData.comments] : [];

        let targetIndex = -1;
        if (typeof commentIdOrIdx === 'number') {
            targetIndex = commentIdOrIdx;
        } else {
            targetIndex = comments.findIndex((c, i) => c.id === commentIdOrIdx || ('comm_' + (c.createdAt || i) + '_' + i) === commentIdOrIdx || String(i) === commentIdOrIdx);
        }

        if (targetIndex < 0 || targetIndex >= comments.length) return false;

        const targetComment = { ...comments[targetIndex] };
        const likes = Array.isArray(targetComment.likes) ? [...targetComment.likes] : [];
        const userLiked = likes.includes(currentUser.uid);

        if (userLiked) {
            targetComment.likes = likes.filter(uid => uid !== currentUser.uid);
        } else {
            targetComment.likes = [...likes, currentUser.uid];
            playSound(clickSound);
        }

        targetComment.id = targetComment.id || ('comm_' + (targetComment.createdAt || targetIndex) + '_' + targetIndex);
        comments[targetIndex] = targetComment;

        await updateDoc(postRef, { comments });
        if (activeCommentPost && activeCommentPost.id === postId) {
            activeCommentPost.comments = comments;
            renderCommentsModalList();
        }
        return true;
    } catch (err) {
        console.error('Erro ao curtir comentário:', err);
        showToast('Erro', 'Não foi possível registrar a curtida.', 'red');
        return false;
    }
}

window.deletePost = deletePost;
window.deletePostComment = deletePostComment;
window.submitInlineComment = submitInlineComment;
window.togglePinPostComment = togglePinPostComment;
window.editPostComment = editPostComment;
window.toggleLikePostComment = toggleLikePostComment;
window.getSortedPostComments = getSortedPostComments;
window.isPostOwner = isPostOwner;
window.isCommentAuthor = isCommentAuthor;
window.setCurrentUser = (u) => { currentUser = u; };
window.getCurrentUser = () => currentUser;
window.setCurrentProfile = (p) => { currentProfile = p; if (typeof updateProfileDOM === 'function') updateProfileDOM(); };
window.getCurrentProfile = () => currentProfile;
window.renderPostsFeed = renderPostsFeed;

export const authorVipCache = new Map();
const authorListenersMap = new Map();

export function isAuthorVipUser(authorUid, data = {}) {
    if (authorUid && currentUser && authorUid === currentUser.uid) {
        return checkIsVipUser(currentProfile);
    }
    if (authorUid && authorVipCache.has(authorUid)) {
        return authorVipCache.get(authorUid);
    }
    if (data.isVip || data.isVerified || checkIsVipUser(data)) {
        return true;
    }
    const username = (data.authorUsername || data.username || '').toLowerCase().replace('@', '');
    const email = (data.authorEmail || data.email || '').toLowerCase();
    if (username === 'dxhuboficial' || email === 'dxhub.oficial@gmail.com') {
        return true;
    }
    return false;
}

export function syncFeedAuthorsVipStatus(posts = []) {
    if (typeof doc !== 'function' || typeof onSnapshot !== 'function' || typeof db === 'undefined') return;
    const authorUids = new Set();
    posts.forEach(p => {
        if (p.authorUid) authorUids.add(p.authorUid);
        if (Array.isArray(p.comments)) {
            p.comments.forEach(c => { if (c.authorUid) authorUids.add(c.authorUid); });
        }
    });

    authorUids.forEach(uid => {
        if (authorListenersMap.has(uid)) return;
        try {
            const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
                if (snap && snap.exists()) {
                    const uData = snap.data();
                    const isVip = checkIsVipUser(uData);
                    authorVipCache.set(uid, isVip);
                    const badges = document.querySelectorAll(`.verified-badge[data-author-uid="${uid}"]`);
                    badges.forEach(b => {
                        b.style.display = isVip ? 'inline-flex' : 'none';
                    });
                    if (badges.length > 0 && window.lucide) {
                        lucide.createIcons();
                    }
                }
            }, () => {});
            authorListenersMap.set(uid, unsub);
        } catch (e) {
            // Silencioso em testes ou caso offline
        }
    });
}

function resolvePostChunkedMedia(container, postsList) {
    if (!container) return;
    container.querySelectorAll('[data-chunk-post-id]').forEach(el => {
        const pId = el.dataset.chunkPostId;
        if (!pId) return;
        loadMediaWithChunks('posts', pId).then(fullData => {
            if (!fullData) return;
            const postObj = Array.isArray(postsList) ? postsList.find(p => p.id === pId) : null;
            if (postObj) postObj.mediaData = fullData;
            let src = fullData;
            if (el.dataset.chunkType === 'video' && el.dataset.chunkTrimmed === 'true' && !src.includes('#t=')) {
                src = `${src}#t=0,${el.dataset.chunkDuration || 120}`;
            }
            el.src = src;
            el.removeAttribute('data-chunk-post-id');
        }).catch(err => console.warn('Erro ao carregar chunks de mídia do post:', err));
    });
}

function renderPostsFeed(posts = []) {
    const feedList = document.getElementById('feed-list');
    const countLabel = document.getElementById('posts-count-label');
    const previewFeed = document.getElementById('posts-feed-list');

    const sorted = [...posts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (countLabel) countLabel.innerText = `${sorted.length} ${sorted.length === 1 ? 'postagem' : 'postagens'}`;

    syncFeedAuthorsVipStatus(sorted);

    if (previewFeed) {
        if (!sorted.length) {
            previewFeed.innerHTML = '<div class="post-empty">Nenhuma postagem ainda. Seja o primeiro a publicar.</div>';
        } else {
            previewFeed.innerHTML = sorted.slice(0, 3).map((post) => {
                const authorName = post.authorName || 'Usuário';
                const isPostAuthorVip = isAuthorVipUser(post.authorUid, post);
                const avatar = post.authorAvatar ? `style="background-image: url('${post.authorAvatar}')"` : '';
                const likes = Array.isArray(post.likes) ? post.likes.length : 0;
                const comments = Array.isArray(post.comments) ? post.comments : [];
                const caption = post.caption || '';
                const rawMedia = post.mediaData || (post.hasChunks && post.id && mediaChunkCache.get(`posts_${post.id}`)) || '';
                const isChunkPending = post.hasChunks && !rawMedia && post.id;
                const postMediaSrc = (post.type === 'video' && post.isTrimmed && rawMedia && typeof rawMedia === 'string' && !rawMedia.includes('#t='))
                    ? `${rawMedia}#t=0,${post.videoDuration || 120}`
                    : (rawMedia || '');
                const mediaTag = post.type === 'video'
                    ? `<video src="${postMediaSrc}" ${isChunkPending ? `data-chunk-post-id="${post.id}" data-chunk-type="video" data-chunk-trimmed="${post.isTrimmed ? 'true' : 'false'}" data-chunk-duration="${post.videoDuration || 120}"` : ''} controls playsinline></video>`
                    : `<img src="${postMediaSrc}" ${isChunkPending ? `data-chunk-post-id="${post.id}" data-chunk-type="image"` : ''} alt="Postagem" />`;
                const createdAt = new Date(post.createdAt || Date.now());
                const timeLabel = createdAt.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                const canDeletePost = isPostOwner(post, currentUser, currentProfile);

                const isThisMusicPlaying = currentFeedMusicAudio && !currentFeedMusicAudio.paused && currentFeedMusicPostId === post.id;

                return `
                    <article class="post-card" id="preview-post-card-${post.id}">
                        <div class="post-head">
                            <div class="post-author">
                                <div class="post-author-avatar" ${avatar}></div>
                                <div>
                                    <div class="post-author-name">
                                        <span>${escapeHTML(authorName)}</span>
                                        <i data-lucide="badge-check" class="verified-badge post-author-verified-badge" data-author-uid="${post.authorUid || ''}" style="display:${isPostAuthorVip ? 'inline-flex' : 'none'};"></i>
                                    </div>
                                    <div class="post-time">${timeLabel}</div>
                                </div>
                            </div>
                            ${canDeletePost ? `
                                <button class="post-delete-btn" type="button" data-action="delete-post" data-post-id="${post.id}" title="Excluir publicação">
                                    <i data-lucide="trash-2"></i> <span>Excluir</span>
                                </button>
                            ` : `
                                <button class="post-report-btn" type="button" data-action="report-post" data-post-id="${post.id}" title="Denunciar publicação">
                                    <i data-lucide="flag"></i> <span>Denunciar</span>
                                </button>
                            `}
                        </div>
                        <div class="post-media">${mediaTag}</div>
                        ${post.music && post.music.title ? `
                            <div class="feed-music-badge ${isThisMusicPlaying ? 'playing' : ''}" id="preview-music-badge-${post.id}" data-action="toggle-feed-music" data-post-id="${post.id}" data-audio-url="${escapeHTML(post.music.audioUrl || '')}" role="button" tabindex="0" title="Tocar música">
                                <i data-lucide="disc-3" class="feed-music-disc"></i>
                                <div class="feed-music-info">
                                    <span class="feed-music-title">${escapeHTML(post.music.title)}</span>
                                    <span class="feed-music-artist">• ${escapeHTML(post.music.artist || 'Artista')}</span>
                                </div>
                                <button class="feed-music-toggle-btn" type="button" aria-label="Tocar música">
                                    <i data-lucide="${isThisMusicPlaying ? 'pause' : 'play'}" id="preview-music-icon-${post.id}"></i>
                                </button>
                            </div>
                        ` : ''}
                        ${caption ? `<p class="post-caption">${escapeHTML(caption)}</p>` : ''}
                        <div class="post-actions">
                            <button class="post-action-btn" type="button">❤ ${likes}</button>
                            <button class="post-action-btn" type="button" data-action="open-comment-modal" data-post-id="${post.id}">💬 ${comments.length}</button>
                            <button class="post-action-btn post-share-btn" type="button" data-action="share-post" data-post-id="${post.id}" title="Compartilhar">
                                <i data-lucide="share-2"></i> <span>Compartilhar</span>
                            </button>
                        </div>
                    </article>
                `;
            }).join('');

            resolvePostChunkedMedia(previewFeed, posts);

            previewFeed.querySelectorAll('[data-action="open-comment-modal"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const postId = btn.dataset.postId;
                    const post = posts.find(p => p.id === postId);
                    if (post) openPostCommentModal(post);
                });
            });
        }
    }

    if (!feedList) return;
    if (!sorted.length) {
        feedList.innerHTML = '<div class="post-empty">Nenhuma postagem ainda. Seja o primeiro a publicar.</div>';
        if (window.lucide) lucide.createIcons();
        return;
    }

    feedList.innerHTML = sorted.map((post) => {
        const authorName = post.authorName || 'Usuário';
        const isPostAuthorVip = isAuthorVipUser(post.authorUid, post);
        const avatar = post.authorAvatar ? `style="background-image: url('${post.authorAvatar}')"` : '';
        const likes = Array.isArray(post.likes) ? post.likes.length : 0;
        const rawComments = Array.isArray(post.comments) ? post.comments : [];
        const sortedComments = getSortedPostComments(rawComments);
        const caption = post.caption || '';
        const rawMedia = post.mediaData || (post.hasChunks && post.id && mediaChunkCache.get(`posts_${post.id}`)) || '';
        const isChunkPending = post.hasChunks && !rawMedia && post.id;
        const postMediaSrc = (post.type === 'video' && post.isTrimmed && rawMedia && typeof rawMedia === 'string' && !rawMedia.includes('#t='))
            ? `${rawMedia}#t=0,${post.videoDuration || 120}`
            : (rawMedia || '');
        const mediaTag = post.type === 'video'
            ? `<video src="${postMediaSrc}" ${isChunkPending ? `data-chunk-post-id="${post.id}" data-chunk-type="video" data-chunk-trimmed="${post.isTrimmed ? 'true' : 'false'}" data-chunk-duration="${post.videoDuration || 120}"` : ''} controls playsinline></video>`
            : `<img src="${postMediaSrc}" ${isChunkPending ? `data-chunk-post-id="${post.id}" data-chunk-type="image"` : ''} alt="Postagem" />`;
        const createdAt = new Date(post.createdAt || Date.now());
        const timeLabel = createdAt.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const liked = currentUser && Array.isArray(post.likes) && post.likes.includes(currentUser.uid);
        const canDeletePost = isPostOwner(post, currentUser, currentProfile);
        const isCommentsOpen = openPostCommentCards.has(post.id);
        const isThisMusicPlaying = currentFeedMusicAudio && !currentFeedMusicAudio.paused && currentFeedMusicPostId === post.id;

        return `
            <article class="feed-card" id="post-card-${post.id}">
                <div class="feed-header">
                    <div class="feed-author">
                        <div class="feed-avatar" ${avatar}></div>
                        <div>
                            <div class="feed-username">
                                <span>${escapeHTML(authorName)}</span>
                                <i data-lucide="badge-check" class="verified-badge post-author-verified-badge" data-author-uid="${post.authorUid || ''}" style="display:${isPostAuthorVip ? 'inline-flex' : 'none'};"></i>
                            </div>
                            <div class="feed-time">${timeLabel}</div>
                        </div>
                    </div>
                    ${canDeletePost ? `
                        <button class="post-delete-btn" type="button" data-action="delete-post" data-post-id="${post.id}" title="Excluir post">
                            <i data-lucide="trash-2"></i> <span>Excluir post</span>
                        </button>
                    ` : `
                        <button class="post-report-btn" type="button" data-action="report-post" data-post-id="${post.id}" title="Denunciar post">
                            <i data-lucide="flag"></i> <span>Denunciar</span>
                        </button>
                    `}
                </div>
                <div class="feed-media">${mediaTag}</div>
                ${post.music && post.music.title ? `
                    <div class="feed-music-badge ${isThisMusicPlaying ? 'playing' : ''}" id="feed-music-badge-${post.id}" data-action="toggle-feed-music" data-post-id="${post.id}" data-audio-url="${escapeHTML(post.music.audioUrl || '')}" role="button" tabindex="0" title="Tocar música">
                        <i data-lucide="disc-3" class="feed-music-disc"></i>
                        <div class="feed-music-info">
                            <span class="feed-music-title">${escapeHTML(post.music.title)}</span>
                            <span class="feed-music-artist">• ${escapeHTML(post.music.artist || 'Artista')}</span>
                        </div>
                        <button class="feed-music-toggle-btn" type="button" aria-label="Tocar música">
                            <i data-lucide="${isThisMusicPlaying ? 'pause' : 'play'}" id="feed-music-icon-${post.id}"></i>
                        </button>
                    </div>
                ` : ''}
                <div class="feed-body">
                    ${caption ? `<p class="feed-caption">${escapeHTML(caption)}</p>` : ''}
                    <div class="feed-actions">
                        <button class="feed-action-btn ${liked ? 'liked' : ''}" type="button" data-post-id="${post.id}" data-action="like" title="Curtir">
                            <i data-lucide="heart"></i>
                            <span>${likes}</span>
                        </button>
                        <button class="feed-action-btn ${isCommentsOpen ? 'active' : ''}" type="button" data-post-id="${post.id}" data-action="comment" title="Comentários">
                            <i data-lucide="message-circle"></i>
                            <span>${rawComments.length}</span>
                        </button>
                        <button class="feed-action-btn share-action-btn" type="button" data-post-id="${post.id}" data-action="share-post" title="Compartilhar">
                            <i data-lucide="share-2"></i>
                            <span>Compartilhar</span>
                        </button>
                    </div>

                    <!-- Comentários Integrados Diretamente Dentro do Post -->
                    <div class="feed-comments-section ${isCommentsOpen ? 'open' : ''}" id="feed-comments-${post.id}">
                        <div class="feed-comments-box">
                            ${sortedComments.length ? sortedComments.map((comment) => {
                                const commentId = comment.id;
                                const cIdx = comment._originalIndex !== undefined ? comment._originalIndex : sortedComments.indexOf(comment);
                                const isPinned = !!comment.isPinned;
                                const isEdited = !!comment.isEdited;
                                const commentLikes = Array.isArray(comment.likes) ? comment.likes : [];
                                const commentLikesCount = commentLikes.length;
                                const userLikedComment = currentUser && commentLikes.includes(currentUser.uid);

                                const isOwner = isPostOwner(post, currentUser, currentProfile);
                                const isAuthor = isCommentAuthor(comment, currentUser, currentProfile);
                                const canDeleteComment = isOwner || isAuthor;

                                const isEditingThisComment = activeEditingComment && activeEditingComment.postId === post.id && activeEditingComment.commentId === commentId;

                                return `
                                    <div class="feed-comment ${isPinned ? 'is-pinned' : ''}" id="feed-comment-${post.id}-${commentId}" data-comment-id="${commentId}">
                                        ${isPinned ? `
                                            <div class="comment-pinned-indicator">
                                                <i data-lucide="pin"></i> <span>Fixado</span>
                                            </div>
                                        ` : ''}
                                        <div class="feed-comment-text-wrap">
                                            <div class="feed-comment-author-line">
                                                <strong>${escapeHTML(comment.author || 'Usuário')}</strong>
                                                <i data-lucide="badge-check" class="verified-badge comment-verified-badge" data-author-uid="${comment.authorUid || ''}" style="display:${isAuthorVipUser(comment.authorUid, comment) ? 'inline-flex' : 'none'};"></i>
                                                <span>:</span>
                                                ${isEdited ? `<span class="comment-edited-badge">(editado)</span>` : ''}
                                            </div>
                                            ${isEditingThisComment ? `
                                                <div class="comment-inline-edit-box">
                                                    <input type="text" class="comment-inline-edit-input" data-post-id="${post.id}" data-comment-id="${commentId}" value="${escapeHTML(comment.text || '')}" maxlength="220" />
                                                    <div class="comment-inline-edit-actions">
                                                        <button type="button" class="comment-inline-save-btn" data-action="save-comment-edit" data-post-id="${post.id}" data-comment-id="${commentId}">Salvar</button>
                                                        <button type="button" class="comment-inline-cancel-btn" data-action="cancel-comment-edit" data-post-id="${post.id}" data-comment-id="${commentId}">Cancelar</button>
                                                    </div>
                                                </div>
                                            ` : `
                                                <span>${escapeHTML(comment.text || '')}</span>
                                            `}
                                        </div>
                                        <div class="feed-comment-actions-bar">
                                            <button class="feed-comment-action-btn comment-like-btn ${userLikedComment ? 'liked' : ''}" type="button" data-action="like-comment" data-post-id="${post.id}" data-comment-id="${commentId}" data-comment-idx="${cIdx}" title="${userLikedComment ? 'Descurtir' : 'Curtir'}">
                                                <i data-lucide="heart"></i>
                                                <span class="comment-like-count">${commentLikesCount > 0 ? commentLikesCount : ''}</span>
                                            </button>
                                            ${isOwner ? `
                                                <button class="feed-comment-action-btn comment-pin-btn ${isPinned ? 'pinned' : ''}" type="button" data-action="pin-comment" data-post-id="${post.id}" data-comment-id="${commentId}" data-comment-idx="${cIdx}" title="${isPinned ? 'Desafixar comentário' : 'Fixar comentário'}">
                                                    <i data-lucide="pin"></i>
                                                    <span>${isPinned ? 'Desafixar' : 'Fixar'}</span>
                                                </button>
                                            ` : ''}
                                            ${isAuthor ? `
                                                <button class="feed-comment-action-btn comment-edit-btn" type="button" data-action="edit-comment" data-post-id="${post.id}" data-comment-id="${commentId}" data-comment-idx="${cIdx}" title="Editar comentário">
                                                    <i data-lucide="edit-2"></i>
                                                    <span>Editar</span>
                                                </button>
                                            ` : ''}
                                            ${!isAuthor ? `
                                                <button class="feed-comment-action-btn comment-report-btn" type="button" data-action="report-comment" data-post-id="${post.id}" data-comment-id="${commentId}" data-comment-idx="${cIdx}" title="Denunciar comentário">
                                                    <i data-lucide="flag"></i>
                                                    <span>Denunciar</span>
                                                </button>
                                            ` : ''}
                                            ${canDeleteComment ? `
                                                <button class="feed-comment-delete-btn" type="button" data-action="delete-comment" data-post-id="${post.id}" data-comment-idx="${cIdx}" data-comment-id="${commentId}" title="Excluir comentário">
                                                    <i data-lucide="trash-2"></i> <span>Excluir</span>
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                `;
                            }).join('') : '<div class="feed-no-comments">Nenhum comentário ainda. Escreva o primeiro abaixo!</div>'}
                        </div>

                        <div class="feed-comment-form">
                            <input type="text" class="feed-comment-input" data-post-id="${post.id}" maxlength="220" placeholder="Escreva um comentário..." aria-label="Escreva um comentário">
                            <button class="feed-comment-send-btn" type="button" data-action="send-inline-comment" data-post-id="${post.id}" title="Enviar comentário">
                                <i data-lucide="send"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    resolvePostChunkedMedia(feedList, posts);

    feedList.querySelectorAll('video').forEach(videoEl => {
        videoEl.addEventListener('timeupdate', () => {
            const maxD = Number(videoEl.dataset.chunkDuration) || 120;
            if (videoEl.dataset.chunkTrimmed === 'true' && videoEl.currentTime >= maxD) {
                videoEl.pause();
            }
        });
    });

    if (window.lucide) lucide.createIcons();

    // Curtir postagem
    feedList.querySelectorAll('[data-action="like"]').forEach(button => {
        button.addEventListener('click', async () => {
            if (!currentUser) {
                showToast('Login necessário', 'Entre para curtir.', 'red');
                return;
            }
            if (isUserRestricted(currentProfile)) {
                showRestrictionActionNotice();
                return;
            }
            const postId = button.dataset.postId;
            const post = posts.find(item => item.id === postId);
            if (!post) return;
            const currentLikes = Array.isArray(post.likes) ? [...post.likes] : [];
            const liked = currentLikes.includes(currentUser.uid);
            const updatedLikes = liked
                ? currentLikes.filter(uid => uid !== currentUser.uid)
                : [...currentLikes, currentUser.uid];
            await updateDoc(doc(db, 'posts', postId), { likes: updatedLikes });
        });
    });

    // Abrir/Fechar seção de comentários dentro do post
    feedList.querySelectorAll('[data-action="comment"]').forEach(button => {
        button.addEventListener('click', () => {
            const postId = button.dataset.postId;
            const commentsSection = document.getElementById(`feed-comments-${postId}`);
            if (!commentsSection) return;

            const isOpen = commentsSection.classList.toggle('open');
            button.classList.toggle('active', isOpen);
            if (isOpen) {
                openPostCommentCards.add(postId);
                const input = commentsSection.querySelector('.feed-comment-input');
                if (input) setTimeout(() => input.focus(), 80);
            } else {
                openPostCommentCards.delete(postId);
            }
        });
    });

    // Curtir comentário inline
    feedList.querySelectorAll('[data-action="like-comment"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId || parseInt(btn.dataset.commentIdx, 10);
            if (postId && commentId !== undefined) {
                await toggleLikePostComment(postId, commentId);
            }
        });
    });

    // Fixar/Desafixar comentário inline
    feedList.querySelectorAll('[data-action="pin-comment"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId || parseInt(btn.dataset.commentIdx, 10);
            if (postId && commentId !== undefined) {
                await togglePinPostComment(postId, commentId);
            }
        });
    });

    // Iniciar edição inline de comentário
    feedList.querySelectorAll('[data-action="edit-comment"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId;
            if (postId && commentId) {
                activeEditingComment = { postId, commentId };
                renderPostsFeed(posts);
                const editInput = feedList.querySelector(`.comment-inline-edit-input[data-comment-id="${commentId}"]`);
                if (editInput) {
                    editInput.focus();
                    if (editInput.setSelectionRange) editInput.setSelectionRange(editInput.value.length, editInput.value.length);
                }
            }
        });
    });

    // Cancelar edição inline
    feedList.querySelectorAll('[data-action="cancel-comment-edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            activeEditingComment = null;
            renderPostsFeed(posts);
        });
    });

    // Salvar edição inline
    feedList.querySelectorAll('[data-action="save-comment-edit"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId;
            const editInput = feedList.querySelector(`.comment-inline-edit-input[data-comment-id="${commentId}"]`);
            if (postId && commentId && editInput) {
                const ok = await editPostComment(postId, commentId, editInput.value);
                if (ok) {
                    activeEditingComment = null;
                }
            }
        });
    });

    // Salvar edição inline com tecla Enter
    feedList.querySelectorAll('.comment-inline-edit-input').forEach(input => {
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const postId = input.dataset.postId;
                const commentId = input.dataset.commentId;
                if (postId && commentId) {
                    const ok = await editPostComment(postId, commentId, input.value);
                    if (ok) {
                        activeEditingComment = null;
                    }
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                activeEditingComment = null;
                renderPostsFeed(posts);
            }
        });
    });

    // Enviar comentário inline pelo botão
    feedList.querySelectorAll('[data-action="send-inline-comment"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const postId = btn.dataset.postId;
            const input = feedList.querySelector(`.feed-comment-input[data-post-id="${postId}"]`);
            if (input && input.value.trim()) {
                submitInlineComment(postId, input.value);
                input.value = '';
            }
        });
    });

    // Enviar comentário inline ao pressionar Enter
    feedList.querySelectorAll('.feed-comment-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const postId = input.dataset.postId;
                if (postId && input.value.trim()) {
                    submitInlineComment(postId, input.value);
                    input.value = '';
                }
            }
        });
    });

    // Excluir comentário
    feedList.querySelectorAll('[data-action="delete-comment"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const postId = btn.dataset.postId;
            const commentIdx = parseInt(btn.dataset.commentIdx, 10);
            const commentId = btn.dataset.commentId;
            if (postId) {
                deletePostComment(postId, commentId || commentIdx);
            }
        });
    });

    // Excluir post (tanto no feed quanto em Publicações Recentes)
    document.querySelectorAll('[data-action="delete-post"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const postId = btn.dataset.postId;
            if (postId) {
                deletePost(postId);
            }
        });
    });

    // Denunciar post (tanto no feed quanto em Publicações Recentes)
    document.querySelectorAll('[data-action="report-post"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const post = posts.find(p => p.id === postId);
            if (!post) return;
            openReportModal({
                type: 'post',
                postId: post.id,
                targetUid: post.authorUid || post.uid || '',
                targetName: post.authorName || 'Autor da publicação',
                contentSnippet: post.caption || (post.type === 'video' ? 'Vídeo na publicação' : 'Foto na publicação')
            });
        });
    });

    // Denunciar comentário inline
    feedList.querySelectorAll('[data-action="report-comment"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId;
            const post = posts.find(p => p.id === postId);
            if (!post) return;
            const rawComments = Array.isArray(post.comments) ? post.comments : [];
            const comment = rawComments.find(c => (c.id && c.id === commentId) || (c.createdAt && String(c.createdAt) === String(commentId)))
                || rawComments[parseInt(btn.dataset.commentIdx, 10)];
            if (!comment) return;

            openReportModal({
                type: 'comment',
                commentId: comment.id || comment.createdAt || commentId,
                postId: post.id,
                targetUid: comment.authorUid || comment.uid || '',
                targetName: comment.author || 'Autor do comentário',
                contentSnippet: comment.text || ''
            });
        });
    });

    // Tocar/Pausar música do post (tanto no feed quanto em Publicações Recentes)
    document.querySelectorAll('.feed-music-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = badge.dataset.postId;
            const audioUrl = badge.dataset.audioUrl;
            if (postId && audioUrl) {
                toggleFeedPostMusic(postId, audioUrl);
            }
        });
    });

    // Sincronizar reprodução de vídeos que possuem música anexada
    document.querySelectorAll('.feed-card video, .post-card video').forEach(videoEl => {
        const postCard = videoEl.closest('.feed-card, .post-card');
        const badge = postCard?.querySelector('.feed-music-badge');
        if (badge) {
            const postId = badge.dataset.postId;
            const audioUrl = badge.dataset.audioUrl;
            if (postId && audioUrl) {
                videoEl.addEventListener('play', () => {
                    if (!currentFeedMusicAudio || currentFeedMusicPostId !== postId || currentFeedMusicAudio.paused) {
                        toggleFeedPostMusic(postId, audioUrl);
                    }
                });
                videoEl.addEventListener('pause', () => {
                    if (currentFeedMusicAudio && currentFeedMusicPostId === postId && !currentFeedMusicAudio.paused) {
                        toggleFeedPostMusic(postId, audioUrl);
                    }
                });
            }
        }
    });

    // Compartilhar postagem (Feed e Publicações Recentes)
    document.querySelectorAll('[data-action="share-post"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const post = posts.find(p => p.id === postId);
            if (post) {
                openPostShareModal(post);
            }
        });
    });

    if (typeof checkUrlForSharedPost === 'function') {
        checkUrlForSharedPost(posts);
    }
}

let activeCommentPost = null;

export function openPostCommentModal(post) {
    activeCommentPost = post;
    const modal = document.getElementById('post-comment-modal');
    const meta = document.getElementById('comment-modal-post-meta');
    const input = document.getElementById('comment-modal-input');
    if (!modal) return;

    if (meta) {
        const timeStr = new Date(post.createdAt || Date.now()).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const isPostAuthorVip = isAuthorVipUser(post.authorUid, post);
        meta.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px;"><span>${escapeHTML(post.authorName || 'Usuário')}</span><i data-lucide="badge-check" class="verified-badge post-author-verified-badge" data-author-uid="${post.authorUid || ''}" style="display:${isPostAuthorVip ? 'inline-flex' : 'none'};"></i></span> • ${timeStr}${post.caption ? ` • "${escapeHTML(post.caption)}"` : ''}`;
    }

    renderCommentsModalList();

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    if (window.lucide) lucide.createIcons();
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 80);
    }
}

export function closePostCommentModal() {
    const modal = document.getElementById('post-comment-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    activeCommentPost = null;
}

export function renderCommentsModalList() {
    const list = document.getElementById('comment-modal-list');
    if (!list || !activeCommentPost) return;

    const rawComments = Array.isArray(activeCommentPost.comments) ? activeCommentPost.comments : [];
    if (!rawComments.length) {
        list.innerHTML = '<div class="comment-empty">Nenhum comentário ainda. Seja o primeiro a comentar!</div>';
        return;
    }

    const sortedComments = getSortedPostComments(rawComments);

    list.innerHTML = sortedComments.map((c) => {
        const commentId = c.id;
        const idx = c._originalIndex !== undefined ? c._originalIndex : sortedComments.indexOf(c);
        const author = c.author || 'Usuário';
        const isCommentVip = isAuthorVipUser(c.authorUid, c);
        const text = c.text || '';
        const isPinned = !!c.isPinned;
        const isEdited = !!c.isEdited;
        const commentLikes = Array.isArray(c.likes) ? c.likes : [];
        const commentLikesCount = commentLikes.length;
        const userLikedComment = currentUser && commentLikes.includes(currentUser.uid);

        const isOwner = isPostOwner(activeCommentPost, currentUser, currentProfile);
        const isAuthor = isCommentAuthor(c, currentUser, currentProfile);
        const canDelete = isOwner || isAuthor;

        const isEditingThisComment = activeEditingComment && activeEditingComment.postId === activeCommentPost.id && activeEditingComment.commentId === commentId;

        return `
            <div class="comment-item ${isPinned ? 'is-pinned' : ''}" data-comment-id="${commentId}">
                ${isPinned ? `
                    <div class="comment-pinned-indicator">
                        <i data-lucide="pin"></i> <span>Fixado</span>
                    </div>
                ` : ''}
                <div style="flex: 1; min-width: 0;">
                    <div class="comment-item-header">
                        <strong>${escapeHTML(author)}</strong>
                        <i data-lucide="badge-check" class="verified-badge comment-verified-badge" data-author-uid="${c.authorUid || ''}" style="display:${isCommentVip ? 'inline-flex' : 'none'};"></i>
                        <span>:</span>
                        ${isEdited ? `<span class="comment-edited-badge">(editado)</span>` : ''}
                    </div>
                    ${isEditingThisComment ? `
                        <div class="comment-inline-edit-box">
                            <input type="text" class="comment-inline-edit-input" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}" value="${escapeHTML(text)}" maxlength="220" />
                            <div class="comment-inline-edit-actions">
                                <button type="button" class="comment-inline-save-btn" data-action="save-comment-edit" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}">Salvar</button>
                                <button type="button" class="comment-inline-cancel-btn" data-action="cancel-comment-edit" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}">Cancelar</button>
                            </div>
                        </div>
                    ` : `
                        <span style="display: block; margin-top: 2px;">${escapeHTML(text)}</span>
                    `}
                    <div class="comment-actions-bar">
                        <button class="feed-comment-action-btn comment-like-btn ${userLikedComment ? 'liked' : ''}" type="button" data-action="like-comment" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}" data-comment-idx="${idx}" title="${userLikedComment ? 'Descurtir' : 'Curtir'}">
                            <i data-lucide="heart"></i>
                            <span class="comment-like-count">${commentLikesCount > 0 ? commentLikesCount : ''}</span>
                        </button>
                        ${isOwner ? `
                            <button class="feed-comment-action-btn comment-pin-btn ${isPinned ? 'pinned' : ''}" type="button" data-action="pin-comment" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}" data-comment-idx="${idx}" title="${isPinned ? 'Desafixar' : 'Fixar'}">
                                <i data-lucide="pin"></i>
                                <span>${isPinned ? 'Desafixar' : 'Fixar'}</span>
                            </button>
                        ` : ''}
                        ${isAuthor ? `
                            <button class="feed-comment-action-btn comment-edit-btn" type="button" data-action="edit-comment" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}" data-comment-idx="${idx}" title="Editar">
                                <i data-lucide="edit-2"></i>
                                <span>Editar</span>
                            </button>
                        ` : ''}
                        ${!isAuthor ? `
                            <button type="button" class="feed-comment-action-btn comment-report-btn" data-action="report-comment" data-post-id="${activeCommentPost.id}" data-comment-id="${commentId}" data-comment-idx="${idx}" title="Denunciar comentário">
                                <i data-lucide="flag"></i>
                                <span>Denunciar</span>
                            </button>
                        ` : ''}
                        ${canDelete ? `<button type="button" class="comment-delete-btn" data-comment-idx="${idx}" data-comment-id="${commentId}" title="Apagar comentário">Excluir</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();

    // Event listeners
    list.querySelectorAll('[data-action="like-comment"]').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId || parseInt(btn.dataset.commentIdx, 10);
            if (postId && commentId !== undefined) {
                await toggleLikePostComment(postId, commentId);
            }
        };
    });

    list.querySelectorAll('[data-action="pin-comment"]').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId || parseInt(btn.dataset.commentIdx, 10);
            if (postId && commentId !== undefined) {
                await togglePinPostComment(postId, commentId);
            }
        };
    });

    list.querySelectorAll('[data-action="edit-comment"]').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId;
            if (postId && commentId) {
                activeEditingComment = { postId, commentId };
                renderCommentsModalList();
                const editInput = list.querySelector(`.comment-inline-edit-input[data-comment-id="${commentId}"]`);
                if (editInput) {
                    editInput.focus();
                    if (editInput.setSelectionRange) editInput.setSelectionRange(editInput.value.length, editInput.value.length);
                }
            }
        };
    });

    list.querySelectorAll('[data-action="cancel-comment-edit"]').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            activeEditingComment = null;
            renderCommentsModalList();
        };
    });

    list.querySelectorAll('[data-action="save-comment-edit"]').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId;
            const editInput = list.querySelector(`.comment-inline-edit-input[data-comment-id="${commentId}"]`);
            if (postId && commentId && editInput) {
                const ok = await editPostComment(postId, commentId, editInput.value);
                if (ok) {
                    activeEditingComment = null;
                    renderCommentsModalList();
                }
            }
        };
    });

    list.querySelectorAll('.comment-inline-edit-input').forEach(input => {
        input.onkeydown = async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const postId = input.dataset.postId;
                const commentId = input.dataset.commentId;
                if (postId && commentId) {
                    const ok = await editPostComment(postId, commentId, input.value);
                    if (ok) {
                        activeEditingComment = null;
                        renderCommentsModalList();
                    }
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                activeEditingComment = null;
                renderCommentsModalList();
            }
        };
    });

    list.querySelectorAll('.comment-delete-btn').forEach(delBtn => {
        delBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(delBtn.dataset.commentIdx, 10);
            const commentId = delBtn.dataset.commentId;
            if (!activeCommentPost) return;
            await deletePostComment(activeCommentPost.id, commentId || idx);
        };
    });

    list.querySelectorAll('[data-action="report-comment"]').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const postId = btn.dataset.postId;
            const commentId = btn.dataset.commentId;
            const post = activeCommentPost;
            if (!post) return;
            const rawComments = Array.isArray(post.comments) ? post.comments : [];
            const comment = rawComments.find(c => (c.id && c.id === commentId) || (c.createdAt && String(c.createdAt) === String(commentId)))
                || rawComments[parseInt(btn.dataset.commentIdx, 10)];
            if (!comment) return;

            openReportModal({
                type: 'comment',
                commentId: comment.id || comment.createdAt || commentId,
                postId: post.id,
                targetUid: comment.authorUid || comment.uid || '',
                targetName: comment.author || 'Autor do comentário',
                contentSnippet: comment.text || ''
            });
        };
    });
}

export async function submitPostComment() {
    if (!currentUser) {
        showToast('Login necessário', 'Entre para comentar.', 'red');
        return;
    }
    if (isUserRestricted(currentProfile)) {
        showRestrictionActionNotice();
        return;
    }
    if (!activeCommentPost) return;

    const input = document.getElementById('comment-modal-input');
    const text = input?.value?.trim();
    if (!text) return;

    const newComment = {
        id: 'comm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        author: currentProfile?.name || currentUser.displayName || 'Usuário',
        authorUid: currentUser.uid,
        text,
        createdAt: Date.now(),
        isPinned: false,
        likes: []
    };

    const updated = [...(activeCommentPost.comments || []), newComment];
    activeCommentPost.comments = updated;

    try {
        await updateDoc(doc(db, 'posts', activeCommentPost.id), { comments: updated });
        if (input) input.value = '';
        renderCommentsModalList();
        showToast('Comentário publicado', 'Seu comentário foi adicionado!', 'green');
    } catch (err) {
        console.error('Erro ao salvar comentário:', err);
        showToast('Erro', 'Não foi possível enviar o comentário.', 'red');
    }
}

document.getElementById('close-comment-modal')?.addEventListener('click', closePostCommentModal);
document.getElementById('comment-modal-send')?.addEventListener('click', submitPostComment);
document.getElementById('comment-modal-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        submitPostComment();
    }
});
document.getElementById('post-comment-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'post-comment-modal') {
        closePostCommentModal();
    }
});

window.openPostCommentModal = openPostCommentModal;
window.closePostCommentModal = closePostCommentModal;
window.submitPostComment = submitPostComment;

/* ==========================================================================
   SISTEMA DE COMPARTILHAMENTO DE POSTS (WHATSAPP, INSTAGRAM, FACEBOOK, TIKTOK, ETC.)
   ========================================================================== */
let activeSharePost = null;

export function getPostShareUrl(postId) {
    if (!postId) return (typeof window !== 'undefined' && window.location ? window.location.href : 'https://menssagem-dx.web.app/');
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'https://menssagem-dx.web.app';
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '/';
    return `${origin}${path}?post=${encodeURIComponent(postId)}`;
}

export function getPostShareText(post) {
    if (!post) return 'Confira esta publicação no VORTEX VIP:';
    const author = post.authorName ? `Publicação de ${post.authorName}` : 'Confira esta publicação';
    const caption = post.caption ? ` - "${post.caption}"` : '';
    return `⚡ ${author}${caption} no VORTEX VIP:`;
}

export function openPostShareModal(post) {
    if (!post) return;
    activeSharePost = post;
    const modal = document.getElementById('post-share-modal');
    if (!modal) return;

    const authorEl = document.getElementById('share-post-author');
    const avatarEl = document.getElementById('share-post-avatar');
    const captionEl = document.getElementById('share-post-caption');
    const linkInput = document.getElementById('share-link-input');
    const copyText = document.getElementById('share-copy-text');
    const copyBtn = document.getElementById('share-copy-link-btn');

    const authorName = post.authorName || 'Usuário';
    if (authorEl) authorEl.innerText = authorName;
    if (avatarEl) {
        avatarEl.style.backgroundImage = post.authorAvatar ? `url('${post.authorAvatar}')` : '';
    }
    if (captionEl) {
        captionEl.innerText = post.caption ? `"${post.caption}"` : 'Confira esta publicação no VORTEX VIP!';
    }

    const shareUrl = getPostShareUrl(post.id);
    if (linkInput) linkInput.value = shareUrl;

    if (copyText) copyText.innerText = 'Copiar';
    if (copyBtn) copyBtn.classList.remove('copied');

    modal.style.display = 'flex';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    if (window.lucide) {
        lucide.createIcons();
    }
}

export function closePostShareModal() {
    const modal = document.getElementById('post-share-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    activeSharePost = null;
}

export function shareToWhatsApp(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const text = getPostShareText(p);
    const shareLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(text + '\n' + url)}`;
    window.open(shareLink, '_blank');
}

export async function shareToInstagram(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const text = `${getPostShareText(p)}\n${url}`;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        }
    } catch (e) {}
    showToast('Instagram', 'Link e legenda copiados! Abrindo o Instagram...', 'green');
    setTimeout(() => {
        window.open('https://www.instagram.com/', '_blank');
    }, 400);
}

export function shareToFacebook(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const shareLink = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(shareLink, '_blank', 'noopener,noreferrer');
}

export async function shareToTikTok(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const text = `${getPostShareText(p)}\n${url}`;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        }
    } catch (e) {}
    showToast('TikTok', 'Link copiado! Abrindo o TikTok...', 'green');
    setTimeout(() => {
        window.open('https://www.tiktok.com/', '_blank');
    }, 400);
}

export function shareToTelegram(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const text = getPostShareText(p);
    const shareLink = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    window.open(shareLink, '_blank');
}

export function shareToX(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const text = getPostShareText(p);
    const shareLink = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(shareLink, '_blank');
}

export async function shareViaNative(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    const text = getPostShareText(p);

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'VORTEX VIP - Postagem',
                text: text,
                url: url
            });
            showToast('Compartilhado!', 'Publicação compartilhada com sucesso.', 'green');
            closePostShareModal();
        } catch (err) {
            if (err.name !== 'AbortError') {
                copyPostShareLink(p);
            }
        }
    } else {
        copyPostShareLink(p);
    }
}

export async function copyPostShareLink(post) {
    const p = post || activeSharePost;
    if (!p) return;
    const url = getPostShareUrl(p.id);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            const input = document.getElementById('share-link-input');
            if (input) {
                input.select();
                document.execCommand('copy');
            }
        }
        const copyText = document.getElementById('share-copy-text');
        const copyBtn = document.getElementById('share-copy-link-btn');
        if (copyText) copyText.innerText = 'Copiado! ✓';
        if (copyBtn) copyBtn.classList.add('copied');
        showToast('Link Copiado!', 'Link da publicação copiado para a área de transferência.', 'green');
        setTimeout(() => {
            if (copyText) copyText.innerText = 'Copiar';
            if (copyBtn) copyBtn.classList.remove('copied');
        }, 3000);
    } catch (err) {
        console.error('Erro ao copiar link do post:', err);
        showToast('Erro ao copiar', 'Selecione e copie o link manualmente.', 'red');
    }
}

let hasCheckedUrlPost = false;
export function checkUrlForSharedPost(postsList = []) {
    if (hasCheckedUrlPost) return;
    if (typeof window === 'undefined' || !window.location || !window.location.search) return;

    try {
        const params = new URLSearchParams(window.location.search);
        const sharedPostId = params.get('post');
        if (!sharedPostId) return;
        hasCheckedUrlPost = true;

        setTimeout(() => {
            const postCard = document.getElementById(`post-card-${sharedPostId}`) || document.getElementById(`preview-post-card-${sharedPostId}`);
            if (postCard) {
                const feedContainer = document.getElementById('reels-feed-container') || document.getElementById('posts-feed-modal');
                if (feedContainer && feedContainer.style.display === 'none') {
                    const openFeedBtn = document.getElementById('open-feed-btn') || document.getElementById('reels-feed-btn');
                    if (openFeedBtn) openFeedBtn.click();
                }
                postCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                postCard.classList.add('post-shared-highlight');
                setTimeout(() => postCard.classList.remove('post-shared-highlight'), 6000);
            }
        }, 600);
    } catch (e) {
        console.warn('Erro ao processar post compartilhado da URL:', e);
    }
}

// Listeners do Modal de Compartilhamento
document.getElementById('close-post-share-modal')?.addEventListener('click', closePostShareModal);
document.getElementById('share-whatsapp-btn')?.addEventListener('click', () => shareToWhatsApp());
document.getElementById('share-instagram-btn')?.addEventListener('click', () => shareToInstagram());
document.getElementById('share-facebook-btn')?.addEventListener('click', () => shareToFacebook());
document.getElementById('share-tiktok-btn')?.addEventListener('click', () => shareToTikTok());
document.getElementById('share-telegram-btn')?.addEventListener('click', () => shareToTelegram());
document.getElementById('share-x-btn')?.addEventListener('click', () => shareToX());
document.getElementById('share-native-more-btn')?.addEventListener('click', () => shareViaNative());
document.getElementById('share-copy-link-btn')?.addEventListener('click', () => copyPostShareLink());

document.getElementById('post-share-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'post-share-modal') {
        closePostShareModal();
    }
});

window.openPostShareModal = openPostShareModal;
window.closePostShareModal = closePostShareModal;
window.getPostShareUrl = getPostShareUrl;
window.getPostShareText = getPostShareText;
window.shareToWhatsApp = shareToWhatsApp;
window.shareToInstagram = shareToInstagram;
window.shareToFacebook = shareToFacebook;
window.shareToTikTok = shareToTikTok;
window.shareToTelegram = shareToTelegram;
window.shareToX = shareToX;
window.shareViaNative = shareViaNative;
window.copyPostShareLink = copyPostShareLink;
window.checkUrlForSharedPost = checkUrlForSharedPost;
window.getActiveSharePost = () => activeSharePost;

function listenToPosts() {
    if (postsFeedUnsubscribe) postsFeedUnsubscribe();
    postsFeedUnsubscribe = onSnapshot(collection(db, 'posts'), (snapshot) => {
        const posts = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        renderPostsFeed(posts);
    }, (error) => {
        console.error('Erro ao ouvir posts:', error);
    });
}

export function handlePostMediaSelection(file) {
    if (!file) return;
    pendingPostFile = file;
    const isVideo = (file.type && file.type.startsWith('video'));
    let objectUrl = null;
    try {
        const urlObj = (typeof window !== 'undefined' && window.URL) ? window.URL : (typeof URL !== 'undefined' ? URL : null);
        if (urlObj && typeof urlObj.createObjectURL === 'function') {
            objectUrl = urlObj.createObjectURL(file);
        }
    } catch (e) {
        objectUrl = 'blob:mockpreview';
    }

    const rawBytes = file.size || 102400;
    const isTrimmedInitial = isVideo && (typeof file.duration === 'number' && file.duration > 180);
    const initialDuration = isTrimmedInitial ? 120 : (file.duration || 0);
    const initialSize = formatBytesToKB(rawBytes);

    pendingPostMediaData = null;
    pendingPostMediaInfo = {
        type: isVideo ? 'video' : 'image',
        sizeBytes: rawBytes,
        sizeFormatted: initialSize,
        isTrimmed: isTrimmedInitial,
        duration: initialDuration,
        durationFormatted: formatDurationSeconds(initialDuration)
    };

    if (postPreview) {
        if (isVideo) {
            const videoSrc = isTrimmedInitial && objectUrl && !objectUrl.includes('#t=') ? `${objectUrl}#t=0,120` : objectUrl;
            postPreview.innerHTML = `<video src="${videoSrc}" controls playsinline autoplay muted></video>`;
        } else {
            postPreview.innerHTML = `<img src="${objectUrl}" alt="Pré-visualização da postagem" />`;
        }
    }

    const infoBar = document.getElementById('post-media-info-bar');
    const tagEl = document.getElementById('post-preview-tag');
    const sizeEl = document.getElementById('post-preview-size');
    const durEl = document.getElementById('post-preview-duration');
    const trimBadge = document.getElementById('post-preview-trimmed-badge');

    if (infoBar) infoBar.style.display = 'flex';
    if (tagEl) {
        tagEl.innerHTML = isVideo 
            ? '<i data-lucide="video"></i> <span>Vídeo</span>' 
            : '<i data-lucide="image"></i> <span>Foto</span>';
    }
    if (sizeEl) {
        sizeEl.innerHTML = `<i data-lucide="hard-drive"></i> <span>${initialSize}</span>`;
    }
    if (durEl) {
        if (isVideo && initialDuration > 0) {
            durEl.style.display = 'inline-flex';
            durEl.innerHTML = `<i data-lucide="clock"></i> <span>${formatDurationSeconds(initialDuration)}</span>`;
        } else {
            durEl.style.display = 'none';
        }
    }
    if (trimBadge) {
        if (isVideo && isTrimmedInitial) {
            trimBadge.style.display = 'inline-flex';
            trimBadge.innerHTML = `<i data-lucide="scissors"></i> <span>Cortado (2 min)</span>`;
        } else {
            trimBadge.style.display = 'none';
        }
    }

    if (postPreviewBox) postPreviewBox.classList.remove('hidden');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    // Otimização e corte assíncrono para KB
    if (isVideo) {
        trimAndCompressVideoToKB(file, { maxDuration: 120, cutThreshold: 180 }).then(result => {
            if (result) {
                pendingPostMediaInfo = result;
                if (sizeEl) sizeEl.innerHTML = `<i data-lucide="hard-drive"></i> <span>${result.sizeFormatted}</span>`;
                if (durEl) {
                    durEl.style.display = 'inline-flex';
                    durEl.innerHTML = `<i data-lucide="clock"></i> <span>${result.durationFormatted}</span>`;
                }
                if (trimBadge) {
                    if (result.isTrimmed) {
                        trimBadge.style.display = 'inline-flex';
                        trimBadge.innerHTML = `<i data-lucide="scissors"></i> <span>Cortado (2 min)</span>`;
                        showToast("Vídeo Ajustado", "Vídeo com mais de 3 minutos foi cortado para 2 minutos.", "blue");
                    } else {
                        trimBadge.style.display = 'none';
                    }
                }
                if (postPreview && result.isTrimmed && result.src) {
                    const v = postPreview.querySelector('video');
                    if (v && v.src !== result.src) v.src = result.src;
                }
                if (window.lucide && typeof window.lucide.createIcons === 'function') {
                    window.lucide.createIcons();
                }
            }
        }).catch(() => {});
    } else {
        compressImageFileToKB(file, { maxDimension: 1280, targetMaxKB: 500 }).then(res => {
            if (res) {
                pendingPostMediaData = res.dataUrl;
                pendingPostMediaInfo = {
                    type: 'image',
                    sizeBytes: res.sizeBytes,
                    sizeKB: res.sizeKB,
                    sizeFormatted: res.sizeFormatted,
                    isCompressed: true
                };
                if (sizeEl) sizeEl.innerHTML = `<i data-lucide="hard-drive"></i> <span>${res.sizeFormatted}</span>`;
                showToast("Foto Otimizada", `Convertida com sucesso para ${res.sizeFormatted}.`, "green");
                if (window.lucide && typeof window.lucide.createIcons === 'function') {
                    window.lucide.createIcons();
                }
            }
        }).catch(() => {});
    }
}

if (postMediaInput) {
    postMediaInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.type && file.type.startsWith('video')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = function() {
                try { window.URL.revokeObjectURL(video.src); } catch (err) {}
                const dur = Number(video.duration) || 0;
                file.originalDuration = dur;
                file.duration = dur;
                if (dur > 180) {
                    file.isTrimmed = true;
                    file.duration = 120;
                }
                handlePostMediaSelection(file);
            };
            try {
                video.src = URL.createObjectURL(file);
            } catch (err) {
                handlePostMediaSelection(file);
            }
        } else {
            handlePostMediaSelection(file);
        }
    });
}

document.getElementById('remove-post-media-btn')?.addEventListener('click', () => {
    resetPostComposer();
});

document.getElementById('publish-post-btn')?.addEventListener('click', async () => {
    if (!currentUser) {
        showToast('Erro', 'Você precisa estar logado para publicar.', 'red');
        return;
    }

    const file = postMediaInput?.files?.[0] || pendingPostFile || pendingPostMediaInfo?.file;
    if (!file && !pendingPostMediaData && !pendingPostMediaInfo) {
        showToast('Aviso', 'Selecione uma foto ou vídeo antes de publicar.', 'red');
        return;
    }

    const publishPostBtn = document.getElementById('publish-post-btn');
    if (publishPostBtn) {
        publishPostBtn.disabled = true;
        publishPostBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> <span>Publicando...</span>';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }

    const isVideo = file ? (file.type && file.type.startsWith('video')) : (pendingPostMediaInfo?.type === 'video');

    const savePostToFirestore = async (mediaPayload) => {
        try {
            const postDoc = {
                authorUid: currentUser.uid,
                authorName: currentProfile.name,
                authorAvatar: currentProfile.avatar,
                authorUsername: currentProfile.username || '@' + currentProfile.name,
                authorEmail: currentProfile.email || currentUser.email || '',
                isVip: checkIsVipUser(currentProfile),
                isVerified: checkIsVipUser(currentProfile),
                type: isVideo ? 'video' : 'image',
                mediaSizeKB: pendingPostMediaInfo?.sizeFormatted || formatBytesToKB(file?.size || 102400),
                isTrimmed: !!(pendingPostMediaInfo && pendingPostMediaInfo.isTrimmed) || !!(file && file.isTrimmed),
                videoDuration: isVideo ? (pendingPostMediaInfo?.duration || (file && file.duration) || 0) : null,
                caption: postCaptionInput?.value?.trim() || '',
                createdAt: Date.now(),
                likes: [],
                comments: [],
                music: pendingPostMusic ? {
                    id: pendingPostMusic.id,
                    title: pendingPostMusic.title,
                    artist: pendingPostMusic.artist,
                    cover: pendingPostMusic.cover,
                    audioUrl: pendingPostMusic.audioUrl,
                    duration: pendingPostMusic.duration || 30
                } : null
            };

            await saveMediaWithChunks('posts', postDoc, 'mediaData', mediaPayload);

            showToast('Post publicado', 'Sua foto ou vídeo foi enviado com sucesso.', 'green');
            resetPostComposer();
            document.getElementById('screenshot-gallery-overlay')?.classList.remove('active');
        } catch (error) {
            console.error('Erro ao publicar post:', error);
            showToast('Erro', 'Não foi possível publicar a mídia.', 'red');
        } finally {
            if (publishPostBtn) {
                publishPostBtn.disabled = false;
                publishPostBtn.innerHTML = '<i data-lucide="send"></i> <span>Publicar</span>';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
        }
    };

    if (pendingPostMediaData) {
        await savePostToFirestore(pendingPostMediaData);
        return;
    }

    if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
            await savePostToFirestore(reader.result);
        };
        reader.onerror = () => {
            if (publishPostBtn) {
                publishPostBtn.disabled = false;
                publishPostBtn.innerHTML = '<i data-lucide="send"></i> <span>Publicar</span>';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
            showToast('Erro', 'Erro ao ler arquivo.', 'red');
        };
        reader.readAsDataURL(file);
    } else {
        await savePostToFirestore('data:image/jpeg;base64,mockpreview');
    }
});

const feedNavItem = document.getElementById('feed-btn');
const galleryNavItem = document.getElementById('gallery-btn');

function setBottomNavActive(itemId) {
    [feedNavItem, galleryNavItem].forEach((item) => item?.classList.toggle('active', item && item.id === itemId));
}

function closeFeedOverlay() {
    const feedOverlay = document.getElementById('feed-overlay');
    if (feedOverlay) feedOverlay.classList.remove('active');
    setBottomNavActive('');
    if (currentFeedMusicAudio) {
        try { currentFeedMusicAudio.pause(); } catch(e) {}
        if (currentFeedMusicPostId) updateFeedMusicUI(currentFeedMusicPostId, false);
        currentFeedMusicAudio = null;
        currentFeedMusicPostId = null;
    }
}

function closePostComposerOverlay() {
    const composerOverlay = document.getElementById('screenshot-gallery-overlay');
    if (composerOverlay) composerOverlay.classList.remove('active');
    setBottomNavActive('');
    resetPostComposer();
}

function bindSocialOverlayCloseButtons() {
    const closeFeedBtn = document.getElementById('close-feed-btn');
    const closeGalleryBtn = document.getElementById('close-gallery-btn');

    closeFeedBtn?.addEventListener('click', () => {
        playSound(clickSound);
        closeFeedOverlay();
    });

    closeGalleryBtn?.addEventListener('click', () => {
        playSound(clickSound);
        closePostComposerOverlay();
    });
}

document.getElementById('feed-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    setBottomNavActive('feed-btn');
    listenToPosts();
    document.getElementById('feed-overlay')?.classList.add('active');
    document.getElementById('screenshot-gallery-overlay')?.classList.remove('active');
});

document.getElementById('open-post-from-feed-btn')?.addEventListener('click', () => {
    closeFeedOverlay();
    document.getElementById('screenshot-gallery-overlay')?.classList.add('active');
});

document.getElementById('gallery-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    setBottomNavActive('gallery-btn');
    resetPostComposer();
    listenToPosts();
    document.getElementById('feed-overlay')?.classList.remove('active');
    document.getElementById('screenshot-gallery-overlay')?.classList.add('active');
});

bindSocialOverlayCloseButtons();

document.getElementById('profile-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    const nameInp = document.getElementById('profile-name-input');
    const surnameInp = document.getElementById('profile-lastname-input');
    const usernameInp = document.getElementById('profile-username-input');
    const statusInp = document.getElementById('profile-status-input');

    if (nameInp) nameInp.value = currentProfile.name || '';
    if (surnameInp) surnameInp.value = currentProfile.surname || '';
    if (usernameInp) usernameInp.value = (currentProfile.username || '').replace('@', '');
    if (statusInp) statusInp.value = currentProfile.status || '';

    const prev = document.getElementById('profile-edit-avatar-preview');
    if (prev) {
        prev.style.backgroundImage = currentProfile.avatar ? `url('${currentProfile.avatar}')` : '';
    }

    document.getElementById('profile-edit-panel')?.classList.add('active');
});
document.getElementById('close-profile-edit')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('profile-edit-panel')?.classList.remove('active');
});

const profileUsernameInput = document.getElementById('profile-username-input');
profileUsernameInput?.addEventListener('input', () => {
    const cleanValue = profileUsernameInput.value.replace(/[^a-zA-Z0-9_.]/g, '');
    if (profileUsernameInput.value !== cleanValue) profileUsernameInput.value = cleanValue;
    profileUsernameInput.setCustomValidity(usernameValidationMessage(cleanValue));
});

document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const name = document.getElementById('profile-name-input')?.value.trim() || 'Usuário';
    const surname = document.getElementById('profile-lastname-input')?.value.trim() || '';
    const usernameInputValue = profileUsernameInput?.value.trim() || '';
    const bio = document.getElementById('profile-status-input')?.value.trim() || 'Online';
    const usernameKey = normalizeUsername(usernameInputValue);
    const usernameError = usernameValidationMessage(usernameKey);

    if (usernameError) {
        profileUsernameInput?.setCustomValidity(usernameError);
        profileUsernameInput?.reportValidity();
        showToast('Username inválido', usernameError, 'red');
        return;
    }

    const username = `@${usernameKey}`;
    const oldUsernameKey = normalizeUsername(currentProfile.username || '');
    const newUsernameRef = doc(db, 'usernames', usernameKey);
    const oldUsernameRef = oldUsernameKey ? doc(db, 'usernames', oldUsernameKey) : null;
    const userRef = doc(db, 'users', currentUser.uid);

    try {
        const existingUsersSnap = await getDocs(query(
            collection(db, 'users'),
            where('username', '==', username)
        ));
        const usernameUsedByAnotherUser = existingUsersSnap.docs.some(userDoc => userDoc.id !== currentUser.uid);
        if (usernameUsedByAnotherUser) {
            showToast('Username indisponível', 'Esse nome de usuário já está em uso.', 'red');
            return;
        }

        await runTransaction(db, async (transaction) => {
            const usernameSnap = await transaction.get(newUsernameRef);
            if (usernameSnap.exists() && usernameSnap.data().uid !== currentUser.uid) {
                throw new Error('USERNAME_TAKEN');
            }

            if (oldUsernameRef && oldUsernameKey !== usernameKey) {
                const oldUsernameSnap = await transaction.get(oldUsernameRef);
                if (oldUsernameSnap.exists() && oldUsernameSnap.data().uid === currentUser.uid) {
                    transaction.delete(oldUsernameRef);
                }
            }

            transaction.set(newUsernameRef, {
                uid: currentUser.uid,
                username,
                updatedAt: Date.now()
            });

            const userUpdatePayload = {
                name,
                surname,
                username,
                status: bio
            };
            if (currentProfile.avatar !== undefined) {
                userUpdatePayload.avatar = currentProfile.avatar;
            }
            transaction.set(userRef, userUpdatePayload, { merge: true });
        });
    } catch (error) {
        if (error.message === 'USERNAME_TAKEN') {
            showToast('Username indisponível', 'Esse nome de usuário já está em uso.', 'red');
        } else {
            console.error('Erro ao salvar username:', error);
            showToast('Erro', 'Não foi possível salvar o nome de usuário.', 'red');
        }
        return;
    }

    currentProfile.name = name;
    currentProfile.surname = surname;
    currentProfile.username = username;
    currentProfile.status = bio;
    updateProfileDOM();
    showToast("Perfil Salvo", "Dados atualizados com sucesso!", "green");
    document.getElementById('profile-edit-panel')?.classList.remove('active');
});

export async function compressImage(file, maxSize = 512, quality = 0.75) {
    return new Promise((resolve) => {
        if (!file) return resolve('');
        if (typeof file === 'string') return resolve(file);
        if (typeof FileReader === 'undefined') return resolve('');

        const reader = new FileReader();
        reader.onerror = () => resolve('');
        reader.onload = (e) => {
            const resultDataUrl = e.target.result;
            if (typeof Image === 'undefined' || typeof document === 'undefined' || typeof document.createElement !== 'function') {
                return resolve(resultDataUrl);
            }
            try {
                const img = new Image();
                img.onerror = () => resolve(resultDataUrl);
                img.onload = () => {
                    try {
                        let width = img.width || maxSize;
                        let height = img.height || maxSize;
                        if (width > height) {
                            if (width > maxSize) {
                                height = Math.round((height * maxSize) / width);
                                width = maxSize;
                            }
                        } else {
                            if (height > maxSize) {
                                width = Math.round((width * maxSize) / height);
                                height = maxSize;
                            }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext ? canvas.getContext('2d') : null;
                        if (!ctx || typeof canvas.toDataURL !== 'function') {
                            return resolve(resultDataUrl);
                        }
                        ctx.drawImage(img, 0, 0, width, height);
                        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                        resolve(compressedDataUrl || resultDataUrl);
                    } catch (err) {
                        resolve(resultDataUrl);
                    }
                };
                img.src = resultDataUrl;
            } catch (err) {
                resolve(resultDataUrl);
            }
        };
        reader.readAsDataURL(file);
    });
}

export async function updateProfileAvatar(avatarDataUrl) {
    if (!avatarDataUrl) return;
    currentProfile.avatar = avatarDataUrl;

    const prev = document.getElementById('profile-edit-avatar-preview');
    if (prev) prev.style.backgroundImage = `url('${avatarDataUrl}')`;
    const userAvatar = document.getElementById('user-avatar-display');
    if (userAvatar) userAvatar.style.backgroundImage = `url('${avatarDataUrl}')`;

    if (currentUser && currentUser.uid) {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                avatar: avatarDataUrl,
                updatedAt: Date.now()
            });
            showToast('Foto atualizada', 'Sua foto de perfil foi salva!', 'green');
        } catch (err) {
            console.error('Erro ao salvar foto de perfil no Firestore:', err);
            showToast('Aviso', 'Foto aplicada localmente. Salve o perfil para confirmar.', 'blue');
        }
    }
}

const profileEditAvatarPreview = document.getElementById('profile-edit-avatar-preview');
if (profileEditAvatarPreview) {
    profileEditAvatarPreview.addEventListener('click', () => {
        playSound(clickSound);
        document.getElementById('profile-file-input')?.click();
    });
}

const profileFileInput = document.getElementById('profile-file-input');
if (profileFileInput) {
    profileFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
            try {
                showToast('Processando foto...', 'Otimizando imagem...', 'blue');
                const compressedAvatar = await compressImage(file, 512, 0.78);
                if (compressedAvatar) {
                    await updateProfileAvatar(compressedAvatar);
                }
            } catch (err) {
                console.error('Erro ao processar foto de perfil:', err);
                showToast('Erro', 'Não foi possível carregar a foto.', 'red');
            }
        }
    });
}

window.compressImage = compressImage;
window.updateProfileAvatar = updateProfileAvatar;

document.getElementById('settings-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('settings-panel')?.classList.add('active');
});
document.getElementById('close-settings')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('settings-panel')?.classList.remove('active');
});

let currentPixPaymentId = null;
let pixStatusPollInterval = null;
let currentMercadoPagoInstance = null;

export function resetPixForm() {
    const formView = document.getElementById('pix-step-form');
    const qrView = document.getElementById('pix-step-qrcode');
    const qrImg = document.getElementById('pix-qr-image');
    const copyInput = document.getElementById('pix-copy-paste-input');

    if (formView) formView.style.display = 'block';
    if (qrView) qrView.style.display = 'none';
    if (qrImg) qrImg.src = '';
    if (copyInput) copyInput.value = '';
    if (pixStatusPollInterval) {
        clearInterval(pixStatusPollInterval);
        pixStatusPollInterval = null;
    }
}

export function resetCardForm() {
    const form = document.getElementById('card-payment-form');
    if (form && typeof form.reset === 'function') form.reset();
    document.querySelectorAll('.card-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === 'credit');
    });
}

export function openVipPaymentModal() {
    const modal = document.getElementById('vip-payment-modal');
    if (!modal) return;

    switchPaymentTab('pix');
    resetPixForm();
    resetCardForm();

    const successView = document.getElementById('payment-success-view');
    if (successView) successView.style.display = 'none';

    // Preencher campos com perfil atual se disponíveis
    const nameInp = document.getElementById('pix-payer-name');
    const emailInp = document.getElementById('pix-payer-email');
    const cardHolderInp = document.getElementById('card-holder-name');

    if (nameInp && currentProfile && currentProfile.name) {
        nameInp.value = `${currentProfile.name} ${currentProfile.surname || ''}`.trim();
    }
    if (emailInp && currentUser && currentUser.email) {
        emailInp.value = currentUser.email;
    }
    if (cardHolderInp && currentProfile && currentProfile.name) {
        cardHolderInp.value = `${currentProfile.name} ${currentProfile.surname || ''}`.trim().toUpperCase();
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
    playSound(clickSound);
    if (window.lucide) lucide.createIcons();

    // Acorda o servidor no Render em segundo plano (evita espera quando o usuário clicar em pagar)
    try {
        fetch(`${VORTEX_API_BASE}/api/config`).catch(() => {});
    } catch (_) {}
}

export function closeVipPaymentModal() {
    const modal = document.getElementById('vip-payment-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
    if (pixStatusPollInterval) {
        clearInterval(pixStatusPollInterval);
        pixStatusPollInterval = null;
    }
    playSound(clickSound);
}

export function switchPaymentTab(tabName) {
    document.querySelectorAll('.payment-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    const pixTab = document.getElementById('tab-btn-pix');
    const cardTab = document.getElementById('tab-btn-card');
    if (pixTab) pixTab.classList.toggle('active', tabName === 'pix');
    if (cardTab) cardTab.classList.toggle('active', tabName === 'card');

    const pixPanel = document.getElementById('payment-panel-pix');
    const cardPanel = document.getElementById('payment-panel-card');
    const successView = document.getElementById('payment-success-view');

    if (successView) successView.style.display = 'none';

    if (tabName === 'pix') {
        if (pixPanel) pixPanel.style.display = 'flex';
        if (cardPanel) cardPanel.style.display = 'none';
    } else {
        if (pixPanel) pixPanel.style.display = 'none';
        if (cardPanel) cardPanel.style.display = 'flex';
    }
    if (window.lucide) lucide.createIcons();
}

// URL base da API do servidor de pagamentos VORTEX VIP (Hospedado 24/7 na nuvem Render)
const VORTEX_API_BASE = 'https://vortex-backend-qnl9.onrender.com';

async function fetchApi(endpoint, options = {}) {
    // Aponta prioritariamente para o servidor na nuvem Render (24h online sem depender do PC)
    const primaryUrl = `${VORTEX_API_BASE}${endpoint}`;

    try {
        const res = await fetch(primaryUrl, options);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json') || res.ok) {
            return res;
        }
    } catch (err) {
        console.warn(`[VORTEX API] Falha ao conectar em ${primaryUrl}:`, err);
    }

    // Fallback secundário: tenta localhost se o desenvolvedor estiver testando localmente
    try {
        const localUrl = `http://localhost:3000${endpoint}`;
        const res = await fetch(localUrl, options);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json') || res.ok) {
            return res;
        }
    } catch (errLocal) {
        // Silencia erro do localhost
    }

    // Fallback relativo se o site estiver sendo servido pelo próprio Node
    try {
        const res = await fetch(endpoint, options);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json') && res.ok) {
            return res;
        }
    } catch (fallbackErr) {
        console.warn(`[VORTEX API] Falha no fallback relativo:`, fallbackErr);
    }

    throw new Error('Servidor de pagamento temporariamente indisponível. Tente novamente em instantes.');
}

export async function generatePixPayment() {
    if (!currentUser) {
        showToast('Login necessário', 'Entre na sua conta para prosseguir com o pagamento.', 'red');
        return;
    }

    const name = document.getElementById('pix-payer-name')?.value?.trim() || currentProfile.name || 'Cliente';
    const cpf = document.getElementById('pix-payer-cpf')?.value?.replace(/\D/g, '') || '11144477735';
    const email = document.getElementById('pix-payer-email')?.value?.trim() || currentUser.email || 'cliente@vortex.vip';

    const btn = document.getElementById('generate-pix-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="pix-pulse-dot" style="display:inline-block; margin-right:6px;"></span> Gerando Pix de R$ 30,00...';
    }

    try {
        const response = await fetchApi('/api/create-pix-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: currentUser.uid,
                name,
                cpf,
                email
            })
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('O servidor retornou uma resposta inválida. Inicie o servidor com npm start.');
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Falha ao gerar Pix');
        }

        currentPixPaymentId = data.id;

        const formView = document.getElementById('pix-step-form');
        const qrView = document.getElementById('pix-step-qrcode');
        const qrImg = document.getElementById('pix-qr-image');
        const copyInput = document.getElementById('pix-copy-paste-input');

        if (qrImg) {
            qrImg.src = data.qr_code_base64 ? `data:image/png;base64,${data.qr_code_base64}` : (data.ticket_url || '');
        }
        if (copyInput) {
            copyInput.value = data.qr_code || '';
        }

        if (formView) formView.style.display = 'none';
        if (qrView) qrView.style.display = 'block';

        showToast('Pix Gerado', 'QR Code de R$ 30,00 gerado com sucesso! Aguardando pagamento.', 'green');

        startPixStatusPolling(data.id);
    } catch (err) {
        console.error('Erro ao gerar Pix:', err);
        showToast('Erro no Pix', err.message || 'Não foi possível gerar o Pix. Tente novamente.', 'red');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="qr-code"></i> Gerar Pix de R$ 30,00';
            if (window.lucide) lucide.createIcons();
        }
    }
}

export function startPixStatusPolling(paymentId) {
    if (pixStatusPollInterval) clearInterval(pixStatusPollInterval);

    pixStatusPollInterval = setInterval(async () => {
        try {
            const res = await fetchApi(`/api/payment-status/${paymentId}`);
            if (!res.ok) return;
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) return;
            const data = await res.json();

            if (data.isApproved || data.status === 'approved') {
                clearInterval(pixStatusPollInterval);
                pixStatusPollInterval = null;
                handleSuccessfulVipPayment(paymentId, 'pix');
            }
        } catch (e) {
            console.warn('Polling status pagamento Pix:', e);
        }
    }, 3000);
}

export function copyPixCode() {
    const copyInput = document.getElementById('pix-copy-paste-input');
    const copyText = document.getElementById('copy-pix-text');
    const copyIcon = document.getElementById('copy-pix-icon');
    if (!copyInput || !copyInput.value) return;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(copyInput.value).then(() => {
            if (copyText) copyText.innerText = 'Copiado! ✓';
            if (copyIcon) copyIcon.setAttribute('data-lucide', 'check');
            showToast('Código Copiado', 'Código Pix Copia e Cola copiado com sucesso!', 'blue');
            if (window.lucide) lucide.createIcons();
            setTimeout(() => {
                if (copyText) copyText.innerText = 'Copiar';
                if (copyIcon) copyIcon.setAttribute('data-lucide', 'copy');
                if (window.lucide) lucide.createIcons();
            }, 3000);
        }).catch(() => {
            copyInput.select();
            document.execCommand('copy');
            showToast('Código Copiado', 'Código Pix copiado!', 'blue');
        });
    } else {
        copyInput.select();
        document.execCommand('copy');
        showToast('Código Copiado', 'Código Pix copiado!', 'blue');
    }
}

export async function submitCardPayment() {
    if (!currentUser) {
        showToast('Login necessário', 'Entre na sua conta para prosseguir com o pagamento.', 'red');
        return;
    }

    const cardHolderName = document.getElementById('card-holder-name')?.value?.trim();
    const cardNumber = document.getElementById('card-number')?.value?.replace(/\s+/g, '');
    const cardExpiry = document.getElementById('card-expiry')?.value?.trim();
    const cardCvv = document.getElementById('card-cvv')?.value?.trim();
    const cardCpf = document.getElementById('card-doc-number')?.value?.replace(/\D/g, '') || '11144477735';
    const installments = document.getElementById('card-installments')?.value || '1';
    const isDebit = document.getElementById('card-type-debit')?.classList.contains('active');

    if (!cardNumber || cardNumber.length < 13) {
        showToast('Cartão Inválido', 'Informe um número de cartão válido.', 'orange');
        return;
    }
    if (!cardExpiry || !cardExpiry.includes('/')) {
        showToast('Validade Inválida', 'Informe a validade no formato MM/AA.', 'orange');
        return;
    }
    if (!cardCvv || cardCvv.length < 3) {
        showToast('CVV Inválido', 'Informe o código de segurança (CVV).', 'orange');
        return;
    }

    const [expMonth, expYearStr] = cardExpiry.split('/');
    const expYear = expYearStr.length === 2 ? `20${expYearStr}` : expYearStr;

    const btn = document.getElementById('pay-card-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="pix-pulse-dot" style="display:inline-block; margin-right:6px;"></span> Processando R$ 30,00...';
    }

    try {
        let cardToken = null;

        if (typeof MercadoPago !== 'undefined' && !currentMercadoPagoInstance) {
            try {
                currentMercadoPagoInstance = new MercadoPago('APP_USR-2dc3e363-b4c1-43ca-a796-6466d7b3caf0', { locale: 'pt-BR' });
            } catch (e) {
                console.warn('Erro ao inicializar SDK Mercado Pago:', e);
            }
        }

        if (currentMercadoPagoInstance && typeof currentMercadoPagoInstance.createCardToken === 'function') {
            try {
                const tokenRes = await currentMercadoPagoInstance.createCardToken({
                    cardNumber: cardNumber,
                    cardholderName: cardHolderName,
                    cardExpirationMonth: expMonth,
                    cardExpirationYear: expYear,
                    securityCode: cardCvv,
                    identificationType: 'CPF',
                    identificationNumber: cardCpf
                });
                cardToken = tokenRes.id;
            } catch (tokErr) {
                console.warn('Falha na criação de token do cartão:', tokErr);
            }
        }

        if (!cardToken) {
            cardToken = 'tok_card_' + Math.random().toString(36).substring(2, 12);
        }

        const response = await fetchApi('/api/create-card-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: cardToken,
                uid: currentUser.uid,
                isDebit: Boolean(isDebit),
                installments: Number(installments) || 1,
                payer: {
                    email: currentUser.email || 'cliente@vortex.vip',
                    identification: {
                        type: 'CPF',
                        number: cardCpf
                    }
                }
            })
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('O servidor retornou uma resposta inválida. Inicie o servidor com npm start.');
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Falha ao processar pagamento com cartão');
        }

        if (data.isApproved || data.status === 'approved') {
            handleSuccessfulVipPayment(data.id, isDebit ? 'card_debit' : 'card_credit');
        } else if (data.status === 'in_process') {
            showToast('Em Análise', 'Seu pagamento com cartão está sob análise do Mercado Pago.', 'blue');
        } else {
            showToast('Não Aprovado', data.status_detail || 'Pagamento recusado pela operadora do cartão.', 'red');
        }
    } catch (err) {
        console.error('Erro no pagamento com cartão:', err);
        showToast('Erro no Cartão', err.message || 'Falha ao processar pagamento com cartão.', 'red');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="shield-check"></i> Pagar R$ 30,00';
            if (window.lucide) lucide.createIcons();
        }
    }
}

export function handleSuccessfulVipPayment(paymentId, type = 'pix') {
    playSound(unlockSound);

    const now = Date.now();
    const vipExpiresAt = now + (30 * 24 * 60 * 60 * 1000);

    currentProfile.isVip = true;
    currentProfile.isVerified = true;
    currentProfile.vipStatus = 'active';
    currentProfile.vipExpiresAt = vipExpiresAt;
    currentProfile.vipRequestStatus = 'approved';

    // Salva no Firestore
    if (currentUser && currentUser.uid) {
        updateDoc(doc(db, 'users', currentUser.uid), {
            isVip: true,
            isVerified: true,
            vipStatus: 'active',
            vipExpiresAt: vipExpiresAt,
            vipLastPaymentId: String(paymentId),
            vipLastPaymentDate: now,
            vipRequestStatus: 'approved'
        }).catch(() => {});
    }

    const userBadge = document.getElementById('user-verified-badge');
    if (userBadge) userBadge.style.display = 'inline-block';
    updateProfileDOM();
    checkVipSubscriptionLifecycle();

    const pixPanel = document.getElementById('payment-panel-pix');
    const cardPanel = document.getElementById('payment-panel-card');
    const successView = document.getElementById('payment-success-view');

    if (pixPanel) pixPanel.style.display = 'none';
    if (cardPanel) cardPanel.style.display = 'none';
    if (successView) successView.style.display = 'flex';

    showToast('Selo VIP Liberado! ⭐', 'Pagamento de R$ 30,00 confirmado! Seu Selo VIP foi ativado por 30 dias.', 'green');
    if (window.lucide) lucide.createIcons();
}

export async function requestVipSubscription() {
    if (!currentUser) {
        showToast('Login necessário', 'Entre na sua conta para solicitar o Selo VIP.', 'red');
        return;
    }

    const sub = getVipSubscriptionState(currentProfile);
    if (sub.status === 'active') {
        showToast('Selo VIP Ativo', `Sua assinatura está ativa! Restam ${sub.daysRemaining} dias.`, 'green');
        return;
    }

    try {
        const uid = currentUser.uid;
        const reqData = {
            uid: uid,
            name: `${currentProfile.name || ''} ${currentProfile.surname || ''}`.trim() || 'Usuário',
            username: currentProfile.username || '',
            email: currentUser.email || currentProfile.email || '',
            avatar: currentProfile.avatar || '',
            status: 'pending',
            createdAt: Date.now()
        };

        await setDoc(doc(db, 'vip_requests', uid), reqData);
        await updateDoc(doc(db, 'users', uid), {
            vipRequestStatus: 'pending'
        });

        currentProfile.vipRequestStatus = 'pending';
        const subscribeBtn = document.getElementById('subscribe-btn');
        if (subscribeBtn) {
            subscribeBtn.innerText = 'Em análise ⏳';
            subscribeBtn.className = 'danger-btn vip-action-btn pending';
        }

        openVipPaymentModal();
    } catch (err) {
        console.error('Erro ao solicitar VIP:', err);
        openVipPaymentModal();
    }
}

// Vinculação de Eventos do Modal de Pagamento
document.getElementById('subscribe-btn')?.addEventListener('click', requestVipSubscription);
document.getElementById('vip-grace-renew-btn')?.addEventListener('click', openVipPaymentModal);
document.getElementById('close-vip-payment-modal')?.addEventListener('click', closeVipPaymentModal);
document.getElementById('close-vip-success-btn')?.addEventListener('click', closeVipPaymentModal);

document.getElementById('tab-btn-pix')?.addEventListener('click', () => switchPaymentTab('pix'));
document.getElementById('tab-btn-card')?.addEventListener('click', () => switchPaymentTab('card'));

document.getElementById('generate-pix-btn')?.addEventListener('click', generatePixPayment);
document.getElementById('copy-pix-btn')?.addEventListener('click', copyPixCode);
document.getElementById('pix-back-form-btn')?.addEventListener('click', resetPixForm);

document.getElementById('card-type-credit')?.addEventListener('click', () => {
    document.getElementById('card-type-credit')?.classList.add('active');
    document.getElementById('card-type-debit')?.classList.remove('active');
});
document.getElementById('card-type-debit')?.addEventListener('click', () => {
    document.getElementById('card-type-debit')?.classList.add('active');
    document.getElementById('card-type-credit')?.classList.remove('active');
});

document.getElementById('pay-card-btn')?.addEventListener('click', submitCardPayment);
document.getElementById('card-payment-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitCardPayment();
});

// Formatação automática para número de cartão e validade
document.getElementById('card-number')?.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = val.replace(/(\d{4})(?=\d)/g, '$1 ');
});
document.getElementById('card-expiry')?.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (val.length >= 2) e.target.value = val.slice(0, 2) + '/' + val.slice(2);
    else e.target.value = val;
});
document.getElementById('pix-payer-cpf')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) e.target.value = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) e.target.value = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (v.length > 3) e.target.value = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    else e.target.value = v;
});
document.getElementById('card-doc-number')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) e.target.value = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) e.target.value = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (v.length > 3) e.target.value = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    else e.target.value = v;
});

// Exportar funções para escopo global e testes
if (typeof window !== 'undefined') {
    window.openVipPaymentModal = openVipPaymentModal;
    window.closeVipPaymentModal = closeVipPaymentModal;
    window.switchPaymentTab = switchPaymentTab;
    window.generatePixPayment = generatePixPayment;
    window.copyPixCode = copyPixCode;
    window.submitCardPayment = submitCardPayment;
    window.handleSuccessfulVipPayment = handleSuccessfulVipPayment;
    window.getVipSubscriptionState = getVipSubscriptionState;
    window.checkVipSubscriptionLifecycle = checkVipSubscriptionLifecycle;
}

document.getElementById('change-pin-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('set-pin-overlay')?.classList.remove('unlocked');
});

document.getElementById('pin-toggle')?.addEventListener('change', async (e) => {
    currentProfile.pinEnabled = e.target.checked;
    if (currentProfile.pinEnabled && (!currentProfile.pin || currentProfile.pin === '1234')) {
        document.getElementById('set-pin-overlay')?.classList.remove('unlocked');
    }
    if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { pinEnabled: e.target.checked }).catch(error => console.error('Erro ao salvar PIN:', error));
});

document.getElementById('main-fab-btn')?.addEventListener('click', () => {
    playSound(clickSound);
    document.getElementById('create-group-panel')?.classList.add('active');
    loadContactsForGroupCreation();
});

export async function loadContactsForGroupCreation() {
    const selectionList = document.getElementById('contacts-selection-list');
    if (!selectionList || !currentUser) return;

    cleanupGroupCreationListeners();
    selectionList.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.8rem;">Carregando contatos...</p>';
    try {
        const contactsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'contacts'));
        if (contactsSnap.empty) {
            selectionList.innerHTML = '<p style="color:var(--text-dim); text-align:center; font-size:0.8rem;">Você ainda não tem contatos adicionados.</p>';
            return;
        }

        selectionList.innerHTML = '';
        contactsSnap.forEach((d, i) => {
            const c = d.data();
            const contactUid = c.uid || d.id;
            const item = document.createElement('div');
            item.className = 'contact-selection-item';
            item.dataset.uid = contactUid;

            const initialAvatar = c.avatar || '';
            const initialName = c.name || 'Contato';

            item.innerHTML = `
                <div class="contact-info-mini">
                    <div class="avatar sm" id="group-create-avatar-${contactUid}" style="background-image: url('${initialAvatar}');">${!initialAvatar ? initialName.charAt(0).toUpperCase() : ''}</div>
                    <label for="group-member-${i}" id="group-create-name-${contactUid}">${initialName}</label>
                </div>
                <input type="checkbox" id="group-member-${i}" value="${contactUid}" title="Selecionar ${initialName}" aria-label="Selecionar ${initialName}">
            `;

            item.onclick = (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
                    const cb = item.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = !cb.checked;
                }
            };

            selectionList.appendChild(item);

            const unsub = onSnapshot(doc(db, 'users', contactUid), (uSnap) => {
                if (uSnap.exists()) {
                    const uData = uSnap.data();
                    const avEl = document.getElementById(`group-create-avatar-${contactUid}`);
                    const nameEl = document.getElementById(`group-create-name-${contactUid}`);
                    const liveAvatar = uData.avatar || '';
                    const liveName = uData.name || c.name || 'Contato';

                    if (avEl) {
                        if (liveAvatar) {
                            avEl.style.backgroundImage = `url('${liveAvatar}')`;
                            avEl.innerText = '';
                        } else {
                            avEl.style.backgroundImage = '';
                            avEl.innerText = liveName.charAt(0).toUpperCase() || '';
                        }
                    }
                    if (nameEl) {
                        nameEl.innerText = liveName;
                    }

                    if (currentUser && currentUser.uid) {
                        updateDoc(doc(db, 'users', currentUser.uid, 'contacts', contactUid), {
                            avatar: liveAvatar,
                            name: liveName
                        }).catch(() => {});
                    }
                }
            }, (err) => console.error('Erro ao escutar perfil do contato para grupo:', err));
            groupCreationUnsubscribes.push(unsub);
        });
    } catch (e) {
        console.error('Erro ao carregar contatos para criação de grupo:', e);
    }
}

document.getElementById('close-create-group')?.addEventListener('click', () => {
    playSound(clickSound);
    cleanupGroupCreationListeners();
    document.getElementById('create-group-panel')?.classList.remove('active');
});

document.getElementById('confirm-create-group')?.addEventListener('click', async () => {
    const groupName = document.getElementById('group-name-input')?.value.trim() || 'Novo Grupo VIP';
    const groupDesc = document.getElementById('group-desc-input')?.value.trim() || 'Grupo VIP';

    const selectedMembers = [currentUser.uid];
    document.querySelectorAll('#contacts-selection-list input:checked').forEach(inp => selectedMembers.push(inp.value));

    const groupRef = doc(collection(db, 'groups'));
    const groupData = {
        name: groupName,
        description: groupDesc,
        creatorUid: currentUser.uid,
        admins: [currentUser.uid],
        members: selectedMembers,
        createdAt: Date.now()
    };
    const batch = writeBatch(db);
    batch.set(groupRef, groupData);
    selectedMembers.forEach(memberUid => {
        batch.set(doc(db, 'users', memberUid, 'groups', groupRef.id), {
            groupId: groupRef.id,
            ...groupData
        });
    });
    await batch.commit();

    showToast("Grupo Criado", `Grupo "${groupName}" criado com sucesso!`, "green");
    cleanupGroupCreationListeners();
    document.getElementById('create-group-panel')?.classList.remove('active');
});

document.getElementById('close-group-profile')?.addEventListener('click', () => {
    cleanupGroupProfileMemberListeners();
    document.getElementById('group-profile-panel')?.classList.remove('active');
    managedGroup = null;
});

document.getElementById('save-group-profile')?.addEventListener('click', async () => {
    if (!managedGroup || managedGroup.creatorUid !== currentUser?.uid) return;
    const name = document.getElementById('group-profile-name')?.value.trim();
    const description = document.getElementById('group-profile-description')?.value.trim() || '';
    if (!name) {
        showToast('Nome obrigatório', 'Informe um nome para o grupo.', 'red');
        return;
    }

    try {
        const groupRef = doc(db, 'groups', managedGroup.groupId);
        await updateDoc(groupRef, { name, description, avatar: pendingGroupAvatar, updatedAt: Date.now() });
        managedGroup.name = name;
        managedGroup.description = description;
        managedGroup.avatar = pendingGroupAvatar;
        await syncGroupReferences(managedGroup);
        document.getElementById('group-profile-title').innerText = name;
        if (activeChatContact?.uid === managedGroup.groupId) {
            activeChatContact.name = name;
            activeChatContact.avatar = pendingGroupAvatar;
            document.getElementById('chat-window-name').innerText = name;
            document.getElementById('chat-window-avatar').style.backgroundImage = pendingGroupAvatar ? `url('${pendingGroupAvatar}')` : '';
        }
        showToast('Grupo atualizado', 'Nome e descrição salvos.', 'green');
    } catch (error) {
        console.error('Erro ao atualizar grupo:', error);
        showToast('Erro', 'Não foi possível atualizar o grupo.', 'red');
    }
});

document.getElementById('toggle-group-pause')?.addEventListener('click', async () => {
    if (!managedGroup || managedGroup.creatorUid !== currentUser?.uid) return;
    managedGroup.paused = !managedGroup.paused;
    try {
        await updateDoc(doc(db, 'groups', managedGroup.groupId), { paused: managedGroup.paused, updatedAt: Date.now() });
        activeChatContact && activeChatContact.uid === managedGroup.groupId && (activeChatContact.paused = managedGroup.paused);
        openGroupProfile(managedGroup);
        if (activeChatContact?.uid === managedGroup.groupId) openGroupChat(managedGroup);
        showToast(managedGroup.paused ? 'Grupo pausado' : 'Grupo liberado', managedGroup.paused ? 'Ninguém pode enviar mensagens agora.' : 'O envio de mensagens foi liberado.', 'blue');
    } catch (error) {
        managedGroup.paused = !managedGroup.paused;
        showToast('Erro', 'Não foi possível alterar o estado do grupo.', 'red');
    }
});

document.getElementById('report-group-btn')?.addEventListener('click', async () => {
    if (!managedGroup || !currentUser) return;
    try {
        await updateDoc(doc(db, 'groups', managedGroup.groupId), { reports: arrayUnion({ uid: currentUser.uid, createdAt: Date.now() }) });
        showToast('Denúncia enviada', 'Obrigado por informar o problema.', 'green');
    } catch (error) {
        console.error('Erro ao denunciar grupo:', error);
        showToast('Erro', 'Não foi possível enviar a denúncia.', 'red');
    }
});

document.getElementById('leave-group-btn')?.addEventListener('click', () => {
    leaveGroup();
});

document.getElementById('chat-leave-group-trigger')?.addEventListener('click', () => {
    leaveGroup();
});

document.getElementById('delete-group-profile-btn')?.addEventListener('click', () => {
    if (managedGroup?.creatorUid === currentUser?.uid) deleteGroup(managedGroup);
});

function compressGroupImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const image = new Image();
            image.onerror = reject;
            image.onload = () => {
                const maxSize = 512;
                const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.72));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

document.getElementById('group-avatar-input')?.addEventListener('change', async (event) => {
    if (managedGroup?.creatorUid !== currentUser?.uid) return;
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
        pendingGroupAvatar = await compressGroupImage(file);
        const avatar = document.getElementById('group-profile-avatar');
        if (avatar) avatar.style.backgroundImage = `url('${pendingGroupAvatar}')`;
        managedGroup.avatar = pendingGroupAvatar;
        await updateDoc(doc(db, 'groups', managedGroup.groupId), {
            avatar: pendingGroupAvatar,
            updatedAt: Date.now()
        });
        await syncGroupReferences(managedGroup);
        if (activeChatContact?.uid === managedGroup.groupId) {
            activeChatContact.avatar = pendingGroupAvatar;
            const chatAvatar = document.getElementById('chat-window-avatar');
            if (chatAvatar) chatAvatar.style.backgroundImage = `url('${pendingGroupAvatar}')`;
        }
        showToast('Imagem atualizada', 'A nova imagem já foi enviada para todos os membros.', 'green');
    } catch (error) {
        console.error('Erro ao preparar imagem do grupo:', error);
        showToast('Erro', 'Não foi possível carregar essa imagem.', 'red');
    }
});

document.getElementById('add-group-member-btn')?.addEventListener('click', async () => {
    const memberUid = document.getElementById('group-add-member-select')?.value;
    if (!memberUid) {
        showToast('Selecione um contato', 'Escolha quem deseja adicionar ao grupo.', 'red');
        return;
    }
    await addGroupMember(memberUid);
});

document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', async () => {
        const color = opt.dataset.color;
        currentProfile.accentColor = color;
        applyUserTheme();
        if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { accentColor: color }).catch(error => console.error('Erro ao salvar cor:', error));
    });
});

document.getElementById('sound-toggle')?.addEventListener('change', async (e) => {
    currentProfile.soundEnabled = e.target.checked;
    if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { soundEnabled: e.target.checked }).catch(error => console.error('Erro ao salvar sons:', error));
});

document.getElementById('ghost-toggle')?.addEventListener('change', async (e) => {
    currentProfile.ghostMode = e.target.checked;
    if (currentUser) {
        const presenceUpdate = {
            ghostMode: e.target.checked,
            online: e.target.checked ? false : true,
            lastSeen: Date.now()
        };
        await updateDoc(doc(db, 'users', currentUser.uid), presenceUpdate).catch(error => console.error('Erro ao salvar modo fantasma:', error));
    }
});

document.getElementById('privacy-toggle')?.addEventListener('change', async (e) => {
    const checked = !!e.target.checked;
    currentProfile.privacyMode = checked;
    applyUserTheme();
    if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.uid), { privacyMode: checked }).catch(error => console.error('Erro ao salvar privacidade:', error));
    }
});

document.getElementById('theme-toggle')?.addEventListener('change', async (e) => {
    const checked = !!e.target.checked;
    currentProfile.themeEnabled = checked;
    document.body.classList.toggle('total-black', !checked);
    applyUserTheme();
    if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.uid), { themeEnabled: checked }).catch(error => console.error('Erro ao salvar tema:', error));
    }
});

document.getElementById('signout-btn')?.addEventListener('click', async () => {
    if (confirm("Deseja realmente sair da sua conta?")) {
        await signOut(auth);
        location.reload();
    }
});

document.getElementById('google-login-main-btn')?.addEventListener('click', async () => {
    const authLoader = document.getElementById('auth-loading-msg');
    if (authLoader) authLoader.style.display = 'block';
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (e) {
        console.error(e);
        showToast("Erro", "Falha ao autenticar com o Google.", "red");
        if (authLoader) authLoader.style.display = 'none';
    }
});

function closeChat() {
    closeContactProfile();
    document.getElementById('chat-window')?.classList.remove('active');
    if (bioBubbleTimer) {
        clearTimeout(bioBubbleTimer);
        bioBubbleTimer = null;
    }
    const bioBubble = document.getElementById('chat-bio-bubble');
    if (bioBubble) {
        bioBubble.style.display = 'none';
        bioBubble.classList.remove('scrolled-hide', 'bubble-expired');
    }
    const leaveGroupTrigger = document.getElementById('chat-leave-group-trigger');
    if (leaveGroupTrigger) leaveGroupTrigger.style.display = 'none';
    exitSelectionMode();
    cancelReply();
    cancelEditMessage();
    hideFloatingReactions();
    cleanupActiveGroupListeners();
    if (activeContactActivityTimer) {
        clearTimeout(activeContactActivityTimer);
        activeContactActivityTimer = null;
    }
    clearChatActivityTimer();
    clearTimeout(typingTimer);
    if (activeChatContact && currentUser) {
        updateTypingStateForActiveChat(false);
    }
    if (currentChatUnsubscribe) currentChatUnsubscribe();
    if (contactStatusUnsubscribe) contactStatusUnsubscribe();
    if (activeChatActivityUnsubscribe) activeChatActivityUnsubscribe();
    if (blockedByContactUnsubscribe) {
        blockedByContactUnsubscribe();
        blockedByContactUnsubscribe = null;
    }
    isBlockedByActiveContact = false;
    activeChatContact = null;
    activeContactActivity = null;
    activeContactUserData = null;
    if (typeof applyChatFilter === 'function') applyChatFilter();
}

const closeChatBtn = document.getElementById('close-chat');
if (closeChatBtn) {
    closeChatBtn.onclick = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        closeChat();
    };
    closeChatBtn.addEventListener('click', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        closeChat();
    });
}

const closeContactProfileBtn = document.getElementById('close-contact-profile');
if (closeContactProfileBtn) {
    closeContactProfileBtn.onclick = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        closeContactProfile();
    };
    closeContactProfileBtn.addEventListener('click', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        closeContactProfile();
    });
}

/* ==========================================================================
   SISTEMA DE TRILHA SONORA & MÚSICAS VIA API (POSTS & STORIES)
   ========================================================================== */
export const MUSIC_API_KEY = 'f2d4476c21ea34d6a6a917f5f9ab5f3aed4fc833';

export let pendingStatusMusic = null;
export let pendingPostMusic = null;
export let activeMusicPickerTarget = null; // 'status' | 'post'
let musicPreviewAudio = null;
let currentlyPlayingPreviewTrackId = null;
let composerPreviewAudio = null;
let currentlyPlayingComposerTarget = null;
let currentFeedMusicAudio = null;
let currentFeedMusicPostId = null;
let musicSearchDebounceTimer = null;
let activeMusicGenre = 'trending';

const DEFAULT_TRENDING_TRACKS = [
    {
        id: 'hit_vortex_1',
        title: 'Cyber Drift (VIP Beat)',
        artist: 'Synthwave Vortex',
        cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop',
        audioUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
        duration: 30
    },
    {
        id: 'hit_vortex_2',
        title: 'Neon Nights & Lights',
        artist: 'Cyberpop Electro',
        cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
        audioUrl: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=electronic-future-beats-117997.mp3',
        duration: 30
    },
    {
        id: 'hit_vortex_3',
        title: 'Sunset Coffee Lo-Fi',
        artist: 'Chill Beats Studio',
        cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&h=300&fit=crop',
        audioUrl: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=chill-abstract-intention-12099.mp3',
        duration: 30
    },
    {
        id: 'hit_vortex_4',
        title: 'Tropical Festival Energy',
        artist: 'Club Mix Brasil',
        cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop',
        audioUrl: 'https://cdn.pixabay.com/download/audio/2021/08/08/audio_c97e59b2d8.mp3?filename=happy-commercial-113546.mp3',
        duration: 30
    }
];

export let userFavoriteTracks = [];
let userFavoriteTracksUnsubscribe = null;

export function isTrackFavorited(trackId) {
    if (!trackId) return false;
    return userFavoriteTracks.some(t => String(t.id) === String(trackId));
}

export function getUserFavoriteTracks() {
    return userFavoriteTracks;
}

export function setUserFavoriteTracks(tracks = []) {
    userFavoriteTracks = Array.isArray(tracks) ? tracks : [];
}

export async function loadUserFavoriteTracks() {
    if (userFavoriteTracksUnsubscribe) {
        userFavoriteTracksUnsubscribe();
        userFavoriteTracksUnsubscribe = null;
    }

    if (!currentUser) {
        userFavoriteTracks = [];
        return;
    }

    try {
        const local = localStorage.getItem(`vortex_fav_tracks_${currentUser.uid}`);
        if (local) {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed)) {
                userFavoriteTracks = parsed;
            }
        }
    } catch (e) {}

    try {
        if (typeof collection === 'function' && typeof onSnapshot === 'function' && typeof db !== 'undefined') {
            const favColRef = collection(db, 'users', currentUser.uid, 'favorite_tracks');
            userFavoriteTracksUnsubscribe = onSnapshot(favColRef, (snapshot) => {
                if (snapshot && Array.isArray(snapshot.docs)) {
                    const tracks = snapshot.docs.map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    })).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                    userFavoriteTracks = tracks;
                    try {
                        localStorage.setItem(`vortex_fav_tracks_${currentUser.uid}`, JSON.stringify(tracks));
                    } catch (e) {}
                    updateFavoriteIconsUI();
                }
            }, (error) => {
                console.warn('Erro ao sincronizar favoritas do Firestore:', error);
            });
        }
    } catch (err) {
        console.warn('Erro ao configurar listener de favoritas:', err);
    }
}

export async function toggleFavoriteTrack(track) {
    if (!track || !track.id) return;
    if (!currentUser) {
        showToast('Login necessário', 'Entre na sua conta para salvar músicas favoritas.', 'red');
        return;
    }

    const trackId = String(track.id);
    const existingIndex = userFavoriteTracks.findIndex(t => String(t.id) === trackId);
    const isAdding = existingIndex === -1;

    if (isAdding) {
        const newFav = {
            id: trackId,
            title: track.title || 'Música',
            artist: track.artist || 'Artista',
            cover: track.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop',
            audioUrl: track.audioUrl || '',
            duration: track.duration || 30,
            savedAt: Date.now()
        };
        userFavoriteTracks.unshift(newFav);
        try {
            localStorage.setItem(`vortex_fav_tracks_${currentUser.uid}`, JSON.stringify(userFavoriteTracks));
        } catch (e) {}
        showToast('Favoritos ❤️', `"${newFav.title}" salva nas suas favoritas!`, 'green');

        try {
            if (typeof setDoc === 'function' && typeof doc === 'function' && typeof db !== 'undefined') {
                await setDoc(doc(db, 'users', currentUser.uid, 'favorite_tracks', trackId), newFav);
            }
        } catch (err) {
            console.warn('Erro ao salvar favorita no Firestore:', err);
        }
    } else {
        const removed = userFavoriteTracks.splice(existingIndex, 1)[0];
        try {
            localStorage.setItem(`vortex_fav_tracks_${currentUser.uid}`, JSON.stringify(userFavoriteTracks));
        } catch (e) {}
        showToast('Favoritos', `"${removed?.title || 'Música'}" removida dos favoritos.`, 'yellow');

        try {
            if (typeof deleteDoc === 'function' && typeof doc === 'function' && typeof db !== 'undefined') {
                await deleteDoc(doc(db, 'users', currentUser.uid, 'favorite_tracks', trackId));
            }
        } catch (err) {
            console.warn('Erro ao excluir favorita no Firestore:', err);
        }
    }

    updateFavoriteIconsUI();

    if (activeMusicGenre === 'favorites') {
        const searchInput = document.getElementById('music-search-input');
        loadMusicPickerResults(searchInput?.value || '', 'favorites');
    }
}

export function updateFavoriteIconsUI() {
    document.querySelectorAll('.track-fav-btn').forEach(btn => {
        const tid = btn.dataset.trackId;
        const isFav = isTrackFavorited(tid);
        btn.classList.toggle('favorited', isFav);
        btn.title = isFav ? 'Remover dos favoritos' : 'Salvar nos favoritos';
        const icon = btn.querySelector('i, svg');
        if (icon) {
            icon.classList.toggle('filled', isFav);
        }
    });
}

export async function searchMusicTracks(query = '', genre = '') {
    const q = (query || '').trim().toLowerCase();
    const g = (genre || '').trim();

    if (g === 'favorites') {
        if (q) {
            return userFavoriteTracks.filter(t =>
                (t.title && t.title.toLowerCase().includes(q)) ||
                (t.artist && t.artist.toLowerCase().includes(q))
            );
        }
        return [...userFavoriteTracks];
    }

    const searchTerm = q || (g && g !== 'trending' ? `${g} hits` : 'top hits');

    try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=song&limit=25`;
        const res = await fetch(itunesUrl);
        if (res.ok) {
            const data = await res.json();
            if (data.results && Array.isArray(data.results) && data.results.length > 0) {
                const tracks = data.results
                    .filter(item => item.previewUrl)
                    .map(item => ({
                        id: String(item.trackId || Math.random()),
                        title: item.trackName || 'Música',
                        artist: item.artistName || 'Artista',
                        cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '300x300bb') : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop',
                        audioUrl: item.previewUrl,
                        duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 30
                    }));
                if (tracks.length > 0) return tracks;
            }
        }
    } catch (err) {
        console.warn("Consulta à API de músicas online falhou, usando catálogo local:", err);
    }

    if (q) {
        const filtered = DEFAULT_TRENDING_TRACKS.filter(t => 
            t.title.toLowerCase().includes(q) || 
            t.artist.toLowerCase().includes(q)
        );
        return filtered.length ? filtered : DEFAULT_TRENDING_TRACKS;
    }
    return DEFAULT_TRENDING_TRACKS;
}

export function openMusicPicker(target = 'status') {
    activeMusicPickerTarget = target;
    const modal = document.getElementById('music-picker-modal');
    if (modal) modal.classList.add('active');
    
    loadUserFavoriteTracks();

    const searchInput = document.getElementById('music-search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    const clearBtn = document.getElementById('music-clear-search-btn');
    if (clearBtn) clearBtn.style.display = 'none';

    activeMusicGenre = 'trending';
    document.querySelectorAll('.music-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.genre === 'trending');
    });

    loadMusicPickerResults('', 'trending');
}

export function closeMusicPicker() {
    stopMusicPreview();
    const modal = document.getElementById('music-picker-modal');
    if (modal) modal.classList.remove('active');
    activeMusicPickerTarget = null;
}

function stopMusicPreview() {
    if (musicPreviewAudio) {
        try { musicPreviewAudio.pause(); } catch(e) {}
        musicPreviewAudio = null;
    }
    if (currentlyPlayingPreviewTrackId) {
        updateTrackPreviewUI(currentlyPlayingPreviewTrackId, false);
        currentlyPlayingPreviewTrackId = null;
    }
}

function toggleTrackPreview(track) {
    if (currentlyPlayingPreviewTrackId === track.id) {
        stopMusicPreview();
        return;
    }

    stopMusicPreview();

    try {
        musicPreviewAudio = new Audio(track.audioUrl);
        currentlyPlayingPreviewTrackId = track.id;
        updateTrackPreviewUI(track.id, true);

        musicPreviewAudio.play().catch(err => {
            console.warn("Erro ao reproduzir prévia de música:", err);
            stopMusicPreview();
        });

        musicPreviewAudio.onended = () => {
            stopMusicPreview();
        };
        musicPreviewAudio.onerror = () => {
            stopMusicPreview();
        };
    } catch (err) {
        console.warn("Erro ao carregar áudio:", err);
        stopMusicPreview();
    }
}

function updateTrackPreviewUI(trackId, isPlaying) {
    const card = document.querySelector(`.music-track-card[data-track-id="${trackId}"]`);
    const icon = document.getElementById(`track-play-icon-${trackId}`);
    if (card) card.classList.toggle('playing', isPlaying);
    if (icon) {
        icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
        if (window.lucide) lucide.createIcons();
    }
}

let lastFetchedTracks = [];

async function loadMusicPickerResults(query = '', genre = '') {
    const loading = document.getElementById('music-loading-state');
    const empty = document.getElementById('music-empty-state');
    const list = document.getElementById('music-tracks-list');

    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (list) list.innerHTML = '';

    stopMusicPreview();

    const tracks = await searchMusicTracks(query, genre);
    lastFetchedTracks = tracks;

    if (loading) loading.style.display = 'none';

    if (!tracks || tracks.length === 0) {
        if (empty) {
            if (genre === 'favorites') {
                empty.innerHTML = `
                    <div class="music-empty-favorites">
                        <i data-lucide="heart" style="width:38px;height:38px;color:#ff4d67;"></i>
                        <span>Nenhuma música favoritada ainda.<br>Toque no coração ❤️ ao lado de qualquer música para salvar aqui!</span>
                    </div>
                `;
            } else {
                empty.innerHTML = `
                    <i data-lucide="music-4" style="width: 32px; height: 32px; color: var(--text-dim);"></i>
                    <span>Nenhuma música encontrada. Tente outra busca!</span>
                `;
            }
            empty.style.display = 'flex';
            if (window.lucide) lucide.createIcons();
        }
        return;
    }

    if (list) {
        list.innerHTML = tracks.map(track => {
            const isCurrentPlaying = currentlyPlayingPreviewTrackId === track.id;
            const isFav = isTrackFavorited(track.id);
            return `
                <div class="music-track-card ${isCurrentPlaying ? 'playing' : ''}" data-track-id="${escapeHTML(track.id)}">
                    <div class="track-cover-wrap">
                        <img src="${escapeHTML(track.cover)}" alt="Capa" class="track-cover-img" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop'">
                        <button type="button" class="track-play-overlay" data-action="preview-track" data-track-id="${escapeHTML(track.id)}" title="Ouvir 30s">
                            <i data-lucide="${isCurrentPlaying ? 'pause' : 'play'}" id="track-play-icon-${escapeHTML(track.id)}"></i>
                        </button>
                    </div>
                    <div class="track-info">
                        <span class="track-title">${escapeHTML(track.title)}</span>
                        <span class="track-artist">${escapeHTML(track.artist)}</span>
                        <span class="track-meta-tag"><i data-lucide="music-2" style="width:11px;height:11px;"></i> ${formatMusicDuration(track.duration)}</span>
                    </div>
                    <div class="track-actions-wrap">
                        <button type="button" class="track-fav-btn ${isFav ? 'favorited' : ''}" data-action="toggle-fav-track" data-track-id="${escapeHTML(track.id)}" title="${isFav ? 'Remover dos favoritos' : 'Salvar nos favoritos'}" aria-label="Favoritar">
                            <i data-lucide="heart" class="${isFav ? 'filled' : ''}"></i>
                        </button>
                        <button type="button" class="track-select-btn" data-action="select-track" data-track-id="${escapeHTML(track.id)}">
                            Usar
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();

        list.querySelectorAll('[data-action="preview-track"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tid = btn.dataset.trackId;
                const track = lastFetchedTracks.find(t => String(t.id) === String(tid)) || userFavoriteTracks.find(t => String(t.id) === String(tid));
                if (track) toggleTrackPreview(track);
            });
        });

        list.querySelectorAll('[data-action="toggle-fav-track"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const tid = btn.dataset.trackId;
                const track = lastFetchedTracks.find(t => String(t.id) === String(tid)) || userFavoriteTracks.find(t => String(t.id) === String(tid));
                if (track) await toggleFavoriteTrack(track);
            });
        });

        list.querySelectorAll('[data-action="select-track"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tid = btn.dataset.trackId;
                const track = lastFetchedTracks.find(t => String(t.id) === String(tid)) || userFavoriteTracks.find(t => String(t.id) === String(tid));
                if (track) selectMusicTrack(track);
            });
        });
    }
}

export function selectMusicTrack(track) {
    stopMusicPreview();

    if (activeMusicPickerTarget === 'status') {
        pendingStatusMusic = track;
        const card = document.getElementById('status-selected-music-card');
        const cover = document.getElementById('status-selected-music-cover');
        const title = document.getElementById('status-selected-music-title');
        const artist = document.getElementById('status-selected-music-artist');
        const addBtn = document.getElementById('status-add-music-btn');

        if (cover) cover.src = track.cover;
        if (title) title.innerText = track.title;
        if (artist) artist.innerText = track.artist;
        if (card) card.style.display = 'flex';
        if (addBtn) addBtn.style.display = 'none';
    } else if (activeMusicPickerTarget === 'post') {
        pendingPostMusic = track;
        const card = document.getElementById('post-selected-music-card');
        const cover = document.getElementById('post-selected-music-cover');
        const title = document.getElementById('post-selected-music-title');
        const artist = document.getElementById('post-selected-music-artist');
        const addBtn = document.getElementById('post-add-music-btn');

        if (cover) cover.src = track.cover;
        if (title) title.innerText = track.title;
        if (artist) artist.innerText = track.artist;
        if (card) card.style.display = 'flex';
        if (addBtn) addBtn.style.display = 'none';
    }

    closeMusicPicker();
    showToast('Música Anexada 🎵', `${track.title} • ${track.artist}`, 'green');
}

export function removeSelectedMusic(target) {
    if (composerPreviewAudio) {
        try { composerPreviewAudio.pause(); } catch(e) {}
        composerPreviewAudio = null;
        currentlyPlayingComposerTarget = null;
    }

    if (target === 'status') {
        pendingStatusMusic = null;
        const card = document.getElementById('status-selected-music-card');
        const addBtn = document.getElementById('status-add-music-btn');
        if (card) card.style.display = 'none';
        if (addBtn) addBtn.style.display = 'inline-flex';
    } else if (target === 'post') {
        pendingPostMusic = null;
        const card = document.getElementById('post-selected-music-card');
        const addBtn = document.getElementById('post-add-music-btn');
        if (card) card.style.display = 'none';
        if (addBtn) addBtn.style.display = 'inline-flex';
    }
}

function toggleComposerMusicPreview(target) {
    const track = target === 'status' ? pendingStatusMusic : pendingPostMusic;
    if (!track || !track.audioUrl) return;

    const iconId = target === 'status' ? 'status-preview-music-icon' : 'post-preview-music-icon';
    const iconEl = document.getElementById(iconId);

    if (composerPreviewAudio && currentlyPlayingComposerTarget === target) {
        try { composerPreviewAudio.pause(); } catch(e) {}
        composerPreviewAudio = null;
        currentlyPlayingComposerTarget = null;
        if (iconEl) {
            iconEl.setAttribute('data-lucide', 'play');
            if (window.lucide) lucide.createIcons();
        }
        return;
    }

    if (composerPreviewAudio) {
        try { composerPreviewAudio.pause(); } catch(e) {}
        composerPreviewAudio = null;
    }

    try {
        composerPreviewAudio = new Audio(track.audioUrl);
        currentlyPlayingComposerTarget = target;
        if (iconEl) {
            iconEl.setAttribute('data-lucide', 'pause');
            if (window.lucide) lucide.createIcons();
        }
        composerPreviewAudio.play().catch(err => {
            console.warn("Erro ao tocar preview do compositor:", err);
            if (iconEl) {
                iconEl.setAttribute('data-lucide', 'play');
                if (window.lucide) lucide.createIcons();
            }
        });
        composerPreviewAudio.onended = () => {
            if (iconEl) {
                iconEl.setAttribute('data-lucide', 'play');
                if (window.lucide) lucide.createIcons();
            }
            composerPreviewAudio = null;
            currentlyPlayingComposerTarget = null;
        };
    } catch(err) {
        console.warn("Erro ao criar áudio:", err);
    }
}

export async function toggleFeedPostMusic(postId, audioUrl) {
    if (currentFeedMusicAudio && currentFeedMusicPostId === postId) {
        if (!currentFeedMusicAudio.paused) {
            try { currentFeedMusicAudio.pause(); } catch(e) {}
            updateFeedMusicUI(postId, false);
        } else {
            updateFeedMusicUI(postId, true);
            try {
                await currentFeedMusicAudio.play();
            } catch (err) {
                console.warn("Erro ao retomar áudio:", err);
                updateFeedMusicUI(postId, false);
            }
        }
        return;
    }

    if (currentFeedMusicAudio) {
        try { currentFeedMusicAudio.pause(); } catch(e) {}
        if (currentFeedMusicPostId) updateFeedMusicUI(currentFeedMusicPostId, false);
        currentFeedMusicAudio = null;
        currentFeedMusicPostId = null;
    }

    if (storyMusicAudio) {
        try { storyMusicAudio.pause(); } catch(e) {}
        storyMusicAudio = null;
    }

    if (!audioUrl) {
        showToast('Áudio indisponível', 'Não foi possível encontrar a faixa desta postagem.', 'red');
        return;
    }

    try {
        const audio = new Audio(audioUrl);
        audio.loop = true;
        audio.onended = () => {
            updateFeedMusicUI(postId, false);
            if (currentFeedMusicAudio === audio) {
                currentFeedMusicAudio = null;
                currentFeedMusicPostId = null;
            }
        };

        currentFeedMusicAudio = audio;
        currentFeedMusicPostId = postId;
        updateFeedMusicUI(postId, true);

        const playPromise = audio.play();
        if (playPromise !== undefined) {
            try {
                await playPromise;
            } catch (err) {
                console.warn("Erro ao reproduzir áudio do post:", err);
                if (currentFeedMusicAudio === audio) {
                    updateFeedMusicUI(postId, false);
                    showToast('Aviso', 'Toque novamente para iniciar a reprodução.', 'blue');
                }
            }
        }
    } catch (err) {
        console.warn("Erro ao criar áudio do feed:", err);
        updateFeedMusicUI(postId, false);
    }
}

export function updateFeedMusicUI(postId, isPlaying) {
    const badge = document.getElementById(`feed-music-badge-${postId}`);
    const previewBadge = document.getElementById(`preview-music-badge-${postId}`);
    [badge, previewBadge].forEach(b => {
        if (b) {
            b.classList.toggle('playing', isPlaying);
            const toggleBtn = b.querySelector('.feed-music-toggle-btn');
            if (toggleBtn) {
                toggleBtn.innerHTML = `<i data-lucide="${isPlaying ? 'pause' : 'play'}" id="feed-music-icon-${postId}"></i>`;
            }
        }
    });
    if (window.lucide) lucide.createIcons();
}

function initMusicFeatureListeners() {
    document.getElementById('status-add-music-btn')?.addEventListener('click', () => {
        playSound(clickSound);
        openMusicPicker('status');
    });

    document.getElementById('post-add-music-btn')?.addEventListener('click', () => {
        playSound(clickSound);
        openMusicPicker('post');
    });

    document.getElementById('close-music-picker-btn')?.addEventListener('click', () => {
        playSound(clickSound);
        closeMusicPicker();
    });

    document.getElementById('music-picker-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'music-picker-modal') {
            closeMusicPicker();
        }
    });

    document.getElementById('status-remove-music-btn')?.addEventListener('click', () => {
        playSound(clickSound);
        removeSelectedMusic('status');
    });

    document.getElementById('post-remove-music-btn')?.addEventListener('click', () => {
        playSound(clickSound);
        removeSelectedMusic('post');
    });

    document.getElementById('status-preview-music-btn')?.addEventListener('click', () => {
        toggleComposerMusicPreview('status');
    });

    document.getElementById('post-preview-music-btn')?.addEventListener('click', () => {
        toggleComposerMusicPreview('post');
    });

    document.getElementById('story-music-mute-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        isStoryMusicMuted = !isStoryMusicMuted;
        if (storyMusicAudio) {
            storyMusicAudio.muted = isStoryMusicMuted;
        }
        const icon = document.getElementById('story-music-mute-icon');
        if (icon) {
            icon.setAttribute('data-lucide', isStoryMusicMuted ? 'volume-x' : 'volume-2');
            if (window.lucide) lucide.createIcons();
        }
    });

    const searchInput = document.getElementById('music-search-input');
    const clearBtn = document.getElementById('music-clear-search-btn');

    searchInput?.addEventListener('input', (e) => {
        const val = e.target.value;
        if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';

        clearTimeout(musicSearchDebounceTimer);
        musicSearchDebounceTimer = setTimeout(() => {
            loadMusicPickerResults(val, activeMusicGenre);
        }, 320);
    });

    clearBtn?.addEventListener('click', async () => {
        if (searchInput) searchInput.value = '';
        clearBtn.style.display = 'none';
        await loadMusicPickerResults('', activeMusicGenre);
    });

    document.querySelectorAll('.music-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
            playSound(clickSound);
            document.querySelectorAll('.music-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeMusicGenre = chip.dataset.genre || 'trending';
            const currentQuery = searchInput?.value || '';
            await loadMusicPickerResults(currentQuery, activeMusicGenre);
        });
    });
}

initMusicFeatureListeners();

/* ==========================================================================
   SISTEMA DE NAVEGAÇÃO E BOTÃO VOLTAR DO CELULAR (ANDROID / MOBILE BACK BUTTON)
   ========================================================================== */

let lastExitBackPressTime = 0;
let isBackNavInitialized = false;

export function closeTopmostActiveLayer() {
    // 1. Modais de Confirmação & Alertas Administrativos
    const banModal = document.getElementById('admin-ban-modal');
    if (banModal && banModal.classList && banModal.classList.contains('active')) {
        banModal.classList.remove('active');
        return true;
    }

    const restrictModal = document.getElementById('admin-restrict-modal');
    if (restrictModal && restrictModal.classList && restrictModal.classList.contains('active')) {
        restrictModal.classList.remove('active');
        return true;
    }

    const purgeModal = document.getElementById('admin-purge-modal');
    if (purgeModal && purgeModal.classList && purgeModal.classList.contains('active')) {
        purgeModal.classList.remove('active');
        return true;
    }

    const tempBanModal = document.getElementById('temp-ban-notice-modal');
    if (tempBanModal && tempBanModal.classList && tempBanModal.classList.contains('active')) {
        tempBanModal.classList.remove('active');
        return true;
    }

    // 2. Modais de Ações do Chat
    const deleteMsgModal = document.getElementById('delete-message-modal');
    if (deleteMsgModal && deleteMsgModal.classList && deleteMsgModal.classList.contains('active')) {
        const cancelBtn = document.getElementById('cancel-delete-modal-btn');
        if (cancelBtn) cancelBtn.click();
        deleteMsgModal.classList.remove('active');
        if (typeof messageToDelete !== 'undefined') messageToDelete = null;
        return true;
    }

    const clearChatModal = document.getElementById('clear-chat-modal');
    if (clearChatModal && clearChatModal.classList && clearChatModal.classList.contains('active')) {
        const cancelBtn = document.getElementById('cancel-clear-chat-btn');
        if (cancelBtn) cancelBtn.click();
        clearChatModal.classList.remove('active');
        return true;
    }

    const blockModal = document.getElementById('block-contact-modal');
    if (blockModal && blockModal.classList && blockModal.classList.contains('active')) {
        const cancelBtn = document.getElementById('cancel-block-contact-btn');
        if (cancelBtn) cancelBtn.click();
        blockModal.classList.remove('active');
        return true;
    }

    const fwdModal = document.getElementById('forward-modal');
    if (fwdModal && fwdModal.classList && fwdModal.classList.contains('active')) {
        const closeBtn = document.getElementById('close-forward-modal');
        if (closeBtn) closeBtn.click();
        fwdModal.classList.remove('active');
        return true;
    }

    const msgInfoModal = document.getElementById('message-info-modal');
    if (msgInfoModal && msgInfoModal.classList && msgInfoModal.classList.contains('active')) {
        if (typeof closeMessageInfoModal === 'function') {
            closeMessageInfoModal();
        } else {
            msgInfoModal.classList.remove('active');
        }
        return true;
    }

    const pollVotesModal = document.getElementById('poll-votes-modal');
    if (pollVotesModal && (pollVotesModal.classList.contains('active') || pollVotesModal.style.display === 'flex')) {
        if (typeof closePollVotesModal === 'function') {
            closePollVotesModal();
        } else {
            pollVotesModal.classList.remove('active');
            pollVotesModal.style.display = 'none';
        }
        return true;
    }

    const pollCreatorModal = document.getElementById('poll-creator-modal');
    if (pollCreatorModal && (pollCreatorModal.classList.contains('active') || pollCreatorModal.style.display === 'flex')) {
        if (typeof closePollCreator === 'function') {
            closePollCreator();
        } else {
            pollCreatorModal.classList.remove('active');
            pollCreatorModal.style.display = 'none';
        }
        return true;
    }

    // 3. Chamadas de Voz / Vídeo
    const videoCallOverlay = document.getElementById('video-call-overlay');
    if (videoCallOverlay && videoCallOverlay.classList && videoCallOverlay.classList.contains('active')) {
        const endBtn = document.getElementById('end-call-btn');
        if (endBtn) endBtn.click();
        videoCallOverlay.classList.remove('active');
        return true;
    }

    const incomingCallOverlay = document.getElementById('incoming-call-overlay');
    if (incomingCallOverlay && incomingCallOverlay.classList && incomingCallOverlay.classList.contains('active')) {
        const declineBtn = document.getElementById('decline-call-btn');
        if (declineBtn) declineBtn.click();
        incomingCallOverlay.classList.remove('active');
        return true;
    }

    // 4. Folha de Visualizadores dos Stories
    const viewersSheet = document.getElementById('story-viewers-sheet');
    if (viewersSheet && viewersSheet.classList && viewersSheet.classList.contains('active')) {
        const closeBtn = document.getElementById('close-viewers-sheet-btn');
        if (closeBtn) closeBtn.click();
        viewersSheet.classList.remove('active');
        return true;
    }

    // 5. Configuração de PIN
    const setPinOverlay = document.getElementById('set-pin-overlay');
    if (setPinOverlay && setPinOverlay.classList && !setPinOverlay.classList.contains('unlocked') && setPinOverlay.classList.contains('active')) {
        if (typeof window.closeSetPin === 'function') {
            window.closeSetPin();
        } else {
            setPinOverlay.classList.add('unlocked');
            setPinOverlay.classList.remove('active');
        }
        return true;
    }

    // 6. Menus e Gavetas do Chat
    const chatDropdown = document.getElementById('chat-dropdown-menu');
    if (chatDropdown && chatDropdown.classList && chatDropdown.classList.contains('active')) {
        chatDropdown.classList.remove('active');
        return true;
    }

    const attachPanel = document.getElementById('attachment-panel');
    if (attachPanel && attachPanel.classList && attachPanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-attachment-panel');
        if (closeBtn) closeBtn.click();
        attachPanel.classList.remove('active');
        return true;
    }

    if (typeof isSelectingMessages !== 'undefined' && isSelectingMessages) {
        if (typeof exitSelectionMode === 'function') exitSelectionMode();
        return true;
    }

    const floatingBar = document.getElementById('floating-reaction-bar');
    if (floatingBar && (floatingBar.style.display === 'flex' || (floatingBar.classList && floatingBar.classList.contains('active')) || (typeof isMessageActionActive !== 'undefined' && isMessageActionActive))) {
        if (typeof hideFloatingReactions === 'function') hideFloatingReactions();
        floatingBar.style.display = 'none';
        if (floatingBar.classList) floatingBar.classList.remove('active');
        return true;
    }

    // 7. Edição Inline e Comentários Abertos nos Posts do Feed
    if (typeof activeEditingComment !== 'undefined' && activeEditingComment) {
        activeEditingComment = null;
        if (typeof renderPostsFeed === 'function' && typeof posts !== 'undefined') {
            renderPostsFeed(posts);
        }
        return true;
    }

    if (typeof openPostCommentCards !== 'undefined' && openPostCommentCards && openPostCommentCards.size > 0) {
        const lastPostId = Array.from(openPostCommentCards).pop();
        const section = document.getElementById(`feed-comments-${lastPostId}`);
        if (section && section.classList) section.classList.remove('open');
        openPostCommentCards.delete(lastPostId);
        return true;
    }

    // 8. Visualizadores e Modais Rápidos
    const viewOnceOverlay = document.getElementById('view-once-overlay');
    if (viewOnceOverlay && (viewOnceOverlay.style.display === 'flex' || (viewOnceOverlay.classList && viewOnceOverlay.classList.contains('active')))) {
        if (typeof closeViewOnceModal === 'function') {
            closeViewOnceModal();
        } else {
            viewOnceOverlay.style.display = 'none';
            if (viewOnceOverlay.classList) viewOnceOverlay.classList.remove('active');
        }
        return true;
    }

    const musicPicker = document.getElementById('music-picker-modal');
    if (musicPicker && musicPicker.classList && musicPicker.classList.contains('active')) {
        if (typeof closeMusicPicker === 'function') {
            closeMusicPicker();
        } else {
            musicPicker.classList.remove('active');
        }
        return true;
    }

    const reportModal = document.getElementById('report-contact-modal');
    if (reportModal && reportModal.classList && reportModal.classList.contains('active')) {
        if (typeof closeReportModal === 'function') {
            closeReportModal();
        } else {
            reportModal.classList.remove('active');
        }
        return true;
    }

    const shareModal = document.getElementById('post-share-modal');
    if (shareModal && (shareModal.style.display === 'flex' || (shareModal.classList && shareModal.classList.contains('active')))) {
        if (typeof closePostShareModal === 'function') {
            closePostShareModal();
        } else {
            if (shareModal.classList) shareModal.classList.remove('active');
            shareModal.style.display = 'none';
        }
        return true;
    }

    const commentModal = document.getElementById('post-comment-modal');
    if (commentModal && commentModal.classList && commentModal.classList.contains('active')) {
        if (typeof closePostCommentModal === 'function') {
            closePostCommentModal();
        } else {
            commentModal.classList.remove('active');
        }
        return true;
    }

    const vipPaymentModal = document.getElementById('vip-payment-modal');
    if (vipPaymentModal && vipPaymentModal.classList && vipPaymentModal.classList.contains('active')) {
        if (typeof closeVipPaymentModal === 'function') {
            closeVipPaymentModal();
        } else {
            vipPaymentModal.classList.remove('active');
        }
        return true;
    }

    // 9. Telas Cheias, Painéis e Gavetas
    const storyViewer = document.getElementById('story-viewer');
    if (storyViewer && storyViewer.classList && storyViewer.classList.contains('active')) {
        if (typeof closeStoryViewer === 'function') {
            closeStoryViewer();
        } else {
            document.getElementById('close-story')?.click();
            storyViewer.classList.remove('active');
        }
        return true;
    }

    const adminPanel = document.getElementById('admin-panel');
    if (adminPanel && adminPanel.classList && adminPanel.classList.contains('active')) {
        if (typeof closeAdminPanel === 'function') {
            closeAdminPanel();
        } else {
            adminPanel.classList.remove('active');
        }
        return true;
    }

    const notificationsPanel = document.getElementById('notifications-panel');
    if (notificationsPanel && notificationsPanel.classList && notificationsPanel.classList.contains('active')) {
        if (typeof closeNotificationsPanel === 'function') {
            closeNotificationsPanel();
        } else {
            notificationsPanel.classList.remove('active');
        }
        return true;
    }

    const composerOverlay = document.getElementById('screenshot-gallery-overlay');
    if (composerOverlay && composerOverlay.classList && composerOverlay.classList.contains('active')) {
        if (typeof closePostComposerOverlay === 'function') {
            closePostComposerOverlay();
        } else {
            composerOverlay.classList.remove('active');
        }
        return true;
    }

    const feedOverlay = document.getElementById('feed-overlay');
    if (feedOverlay && feedOverlay.classList && feedOverlay.classList.contains('active')) {
        if (typeof closeFeedOverlay === 'function') {
            closeFeedOverlay();
        } else {
            feedOverlay.classList.remove('active');
        }
        return true;
    }

    const postStatusOverlay = document.getElementById('post-status-overlay');
    if (postStatusOverlay && postStatusOverlay.classList && postStatusOverlay.classList.contains('active')) {
        const closeBtn = document.getElementById('close-post-status');
        if (closeBtn) closeBtn.click();
        postStatusOverlay.classList.remove('active');
        return true;
    }

    const createGroupPanel = document.getElementById('create-group-panel');
    if (createGroupPanel && createGroupPanel.classList && createGroupPanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-create-group');
        if (closeBtn) closeBtn.click();
        createGroupPanel.classList.remove('active');
        return true;
    }

    const groupProfilePanel = document.getElementById('group-profile-panel');
    if (groupProfilePanel && groupProfilePanel.classList && groupProfilePanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-group-profile');
        if (closeBtn) closeBtn.click();
        groupProfilePanel.classList.remove('active');
        return true;
    }

    const contactProfilePanel = document.getElementById('contact-profile-panel');
    if (contactProfilePanel && contactProfilePanel.classList && contactProfilePanel.classList.contains('active')) {
        if (typeof closeContactProfile === 'function') {
            closeContactProfile();
        } else {
            const closeBtn = document.getElementById('close-contact-profile');
            if (closeBtn) closeBtn.click();
            contactProfilePanel.classList.remove('active');
        }
        return true;
    }

    const profileEditPanel = document.getElementById('profile-edit-panel');
    if (profileEditPanel && profileEditPanel.classList && profileEditPanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-profile-edit');
        if (closeBtn) closeBtn.click();
        profileEditPanel.classList.remove('active');
        return true;
    }

    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel && settingsPanel.classList && settingsPanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-settings');
        if (closeBtn) closeBtn.click();
        settingsPanel.classList.remove('active');
        return true;
    }

    const requestsPanel = document.getElementById('requests-panel');
    if (requestsPanel && requestsPanel.classList && requestsPanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-requests-panel');
        if (closeBtn) closeBtn.click();
        requestsPanel.classList.remove('active');
        return true;
    }

    const searchUserPanel = document.getElementById('search-user-panel');
    if (searchUserPanel && searchUserPanel.classList && searchUserPanel.classList.contains('active')) {
        const closeBtn = document.getElementById('close-search-panel');
        if (closeBtn) closeBtn.click();
        searchUserPanel.classList.remove('active');
        return true;
    }

    // 10. Janela de Conversa Ativa (1:1 ou Grupo)
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow && chatWindow.classList && chatWindow.classList.contains('active')) {
        if (typeof closeChat === 'function') {
            closeChat();
        } else {
            const closeBtn = document.getElementById('close-chat');
            if (closeBtn) closeBtn.click();
            chatWindow.classList.remove('active');
        }
        return true;
    }

    // Nenhuma camada ativa aberta (usuário está na lista principal de conversas)
    return false;
}

export function handleSystemBackPress() {
    const closedSomething = closeTopmostActiveLayer();

    if (closedSomething) {
        // Restaurar estado de guarda no histórico para capturar o próximo botão voltar
        try {
            if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
                window.history.pushState({ vortexState: 'active' }, '');
            }
        } catch (e) {}
        return true;
    } else {
        // Usuário está na tela inicial
        const now = Date.now();
        if (now - lastExitBackPressTime < 2000) {
            // Pressionou voltar duas vezes em menos de 2 segundos: sair
            if (typeof showToast === 'function') {
                showToast("VORTEX", "Até logo!", "white");
            }
            try {
                if (typeof window !== 'undefined' && window.history && typeof window.history.back === 'function') {
                    window.history.back();
                }
            } catch (e) {}
            return false;
        } else {
            lastExitBackPressTime = now;
            if (typeof showToast === 'function') {
                showToast("VORTEX", "Pressione voltar novamente para sair", "white");
            }
            try {
                if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
                    window.history.pushState({ vortexState: 'active' }, '');
                }
            } catch (e) {}
            return true;
        }
    }
}

export function initBackNavigation() {
    if (isBackNavInitialized) return;
    if (typeof window === 'undefined' || !window.history) return;

    isBackNavInitialized = true;

    try {
        if (typeof window.history.pushState === 'function') {
            if (!window.history.state || window.history.state.vortexState !== 'active') {
                if (typeof window.history.replaceState === 'function') {
                    window.history.replaceState({ vortexState: 'root' }, '');
                }
                window.history.pushState({ vortexState: 'active' }, '');
            }
        }
    } catch (e) {
        console.warn("Back nav history push error:", e);
    }

    window.addEventListener('popstate', () => {
        handleSystemBackPress();
    });
}

if (typeof window !== 'undefined') {
    window.clearChatForCurrentUser = clearChatForCurrentUser;
    window.copyMessageText = copyMessageText;
    window.startEditMessage = startEditMessage;
    window.cancelEditMessage = cancelEditMessage;
    window.saveEditedMessage = saveEditedMessage;
    window.getEditingMessage = () => editingMessage;
    window.isBlockedByActiveContact = () => isBlockedByActiveContact;
    window.getBlockedContactsSet = () => blockedContactsSet;
    window.sendChatMessage = sendChatMessage;
    window.openDeleteModal = openDeleteModal;
    window.enterSelectionMode = enterSelectionMode;
    window.exitSelectionMode = exitSelectionMode;
    window.getSelectedMessageIds = () => selectedMessageIds;
    window.getCurrentChatMessagesMap = () => currentChatMessagesMap;
    window.MUSIC_API_KEY = MUSIC_API_KEY;
    window.searchMusicTracks = searchMusicTracks;
    window.openMusicPicker = openMusicPicker;
    window.closeMusicPicker = closeMusicPicker;
    window.selectMusicTrack = selectMusicTrack;
    window.removeSelectedMusic = removeSelectedMusic;
    window.getPendingStatusMusic = () => pendingStatusMusic;
    window.getPendingPostMusic = () => pendingPostMusic;
    window.setPendingStatusMusic = (m) => { pendingStatusMusic = m; };
    window.setPendingPostMusic = (m) => { pendingPostMusic = m; };
    window.openStoryViewer = openStoryViewer;
    window.closeStoryViewer = closeStoryViewer;
    window.displayCurrentStory = displayCurrentStory;
    window.toggleFeedPostMusic = toggleFeedPostMusic;
    window.updateFeedMusicUI = updateFeedMusicUI;
    window.getCurrentFeedMusicAudio = () => currentFeedMusicAudio;
    window.getCurrentFeedMusicPostId = () => currentFeedMusicPostId;
    window.formatAudioTime = formatAudioTime;
    window.parseAudioDuration = parseAudioDuration;
    window.playVoiceNote = playVoiceNote;
    window.toggleVoiceRecording = toggleVoiceRecording;
    window.getCurrentPlayingAudio = () => currentPlayingAudio;
    window.loadContactsForGroupCreation = loadContactsForGroupCreation;
    window.cleanupGroupCreationListeners = cleanupGroupCreationListeners;
    window.pauseCurrentStory = pauseCurrentStory;
    window.resumeCurrentStory = resumeCurrentStory;
    window.isStoryPaused = () => isStoryPaused;
    window.isHoldingStory = () => isHoldingStory;
    window.handleStoryPointerDown = handleStoryPointerDown;
    window.handleStoryPointerUp = handleStoryPointerUp;
    window.cancelVoiceRecording = cancelVoiceRecording;
    window.handleMicPointerDown = handleMicPointerDown;
    window.handleMicPointerMove = handleMicPointerMove;
    window.handleMicPointerUp = handleMicPointerUp;
    window.getIsVoiceRecordingCanceled = () => isVoiceRecordingCanceled;
    window.togglePinChat = togglePinChat;
    window.isChatPinned = isChatPinned;
    window.getPinnedChats = getPinnedChats;
    window.setPinnedChats = setPinnedChats;
    window.updateChatPinUI = updateChatPinUI;
    window.applyPinnedSortToChatList = applyPinnedSortToChatList;
    window.setAvatarContent = setAvatarContent;
    window.refreshDirectChatStatus = refreshDirectChatStatus;
    window.openPostShareModal = openPostShareModal;
    window.closePostShareModal = closePostShareModal;
    window.getPostShareUrl = getPostShareUrl;
    window.getPostShareText = getPostShareText;
    window.shareToWhatsApp = shareToWhatsApp;
    window.shareToInstagram = shareToInstagram;
    window.shareToFacebook = shareToFacebook;
    window.shareToTikTok = shareToTikTok;
    window.shareToTelegram = shareToTelegram;
    window.shareToX = shareToX;
    window.shareViaNative = shareViaNative;
    window.copyPostShareLink = copyPostShareLink;
    window.checkUrlForSharedPost = checkUrlForSharedPost;
    window.getActiveSharePost = () => activeSharePost;
    window.togglePinPostComment = togglePinPostComment;
    window.editPostComment = editPostComment;
    window.toggleLikePostComment = toggleLikePostComment;
    window.getSortedPostComments = getSortedPostComments;
    window.isPostOwner = isPostOwner;
    window.isCommentAuthor = isCommentAuthor;
    window.getActiveReportTarget = () => activeReportTarget;
    window.openPollCreator = openPollCreator;
    window.closePollCreator = closePollCreator;
    window.renderPollOptionsList = renderPollOptionsList;
    window.addPollOption = addPollOption;
    window.removePollOption = removePollOption;
    window.validatePollCreator = validatePollCreator;
    window.submitPoll = submitPoll;
    window.voteOnPoll = voteOnPoll;
    window.openPollVotesModal = openPollVotesModal;
    window.closePollVotesModal = closePollVotesModal;
    window.getPollCreatorOptions = () => pollCreatorOptions;
    window.openContactProfile = openContactProfile;
    window.closeContactProfile = closeContactProfile;
    window.updateChatBioBubble = updateChatBioBubble;
    window.startBioBubbleTimer = startBioBubbleTimer;
    window.getBioBubbleTimer = () => bioBubbleTimer;
    window.initBackNavigation = initBackNavigation;
    window.closeTopmostActiveLayer = closeTopmostActiveLayer;
    window.handleSystemBackPress = handleSystemBackPress;
    window.isAuthorVipUser = isAuthorVipUser;
    window.authorVipCache = authorVipCache;
    window.toggleFavoriteTrack = toggleFavoriteTrack;
    window.isTrackFavorited = isTrackFavorited;
    window.getUserFavoriteTracks = getUserFavoriteTracks;
    window.setUserFavoriteTracks = setUserFavoriteTracks;
    window.loadUserFavoriteTracks = loadUserFavoriteTracks;
    window.loadMusicPickerResults = loadMusicPickerResults;
    window.formatMusicDuration = formatMusicDuration;
    window.openStoryPreview = openStoryPreview;
    window.removeSelectedStatusMedia = removeSelectedStatusMedia;
    window.setPendingStatusMedia = setPendingStatusMedia;
    window.getPendingStatusFile = () => pendingStatusFile;
    window.getPendingStatusFileSrc = () => pendingStatusFileSrc;
    window.isStoryPreviewMode = () => isStoryPreviewMode;
    window.formatBytesToKB = formatBytesToKB;
    window.formatDurationSeconds = formatDurationSeconds;
    window.compressImageFileToKB = compressImageFileToKB;
    window.trimAndCompressVideoToKB = trimAndCompressVideoToKB;
    window.handlePostMediaSelection = handlePostMediaSelection;
    window.resetPostComposer = resetPostComposer;
    window.getPendingPostMediaData = getPendingPostMediaData;
    window.getPendingPostMediaInfo = getPendingPostMediaInfo;
    window.getPendingStatusMediaInfo = () => pendingStatusMediaInfo;
    window.getPendingStatusCompressedData = () => pendingStatusCompressedData;
    window.saveMediaWithChunks = saveMediaWithChunks;
    window.loadMediaWithChunks = loadMediaWithChunks;
    window.mediaChunkCache = mediaChunkCache;
}

if (typeof window !== 'undefined') {
    initBackNavigation();
}