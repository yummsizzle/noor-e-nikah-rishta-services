console.log("[ADMIN DEBUG] admin.js loaded");
const fieldMapToDb = {
    'Registering For': 'registering_for', 'Full Name': 'full_name', 'Gender': 'gender', 'Date of Birth': 'date_of_birth',
    'Age': 'age', 'Marital Status': 'marital_status', 'Height': 'height', 'Education': 'education',
    'Occupation': 'occupation', 'Salary': 'salary', 'Salary (₹)': 'salary',
    'City': 'city', 'State': 'state', 'Mother Tongue': 'mother_tongue', 'Languages Known': 'languages_known',
    'Father Occupation': 'father_occupation', "Father's Occupation": 'father_occupation',
    'Mother Occupation': 'mother_occupation', "Mother's Occupation": 'mother_occupation',
    'Brothers': 'brothers', 'Sisters': 'sisters',
    'Native Place': 'native_place', 'Family Location': 'family_location', 'Family Type': 'family_type',
    'Surname / Biradari': 'surname_biradari',
    'Maslak': 'maslak', 'Maslak / Religious Background': 'maslak',
    'Maslak Preference': 'maslak_preference', 'Religious Preference': 'maslak_preference',
    'About Candidate': 'about_candidate', 'Preferred Age Range': 'preferred_age_range', 'Preferred Location': 'preferred_location',
    'Preferred Education': 'preferred_education', 'Preferred Profession': 'preferred_profession', 'Other Preferences': 'other_preferences',
    'Guardian Name': 'guardian_name', 'Relationship': 'relationship', 'Mobile': 'mobile', 'WhatsApp': 'whatsapp',
    'Preferred Contact Time': 'preferred_contact_time', 'Photo Attached': 'photo_attached',
    'Email Address': 'email'
};
const dbMapToUI = {};
for(let k in fieldMapToDb) {
    if (!dbMapToUI[fieldMapToDb[k]]) {
        dbMapToUI[fieldMapToDb[k]] = k;
    }
}

const STORE = 'noorEnikahSubmissions';
let profiles = [];
window.getProfiles = () => profiles;
window.setProfiles = (val) => { profiles = val; };
window.getCurrentView = () => currentView;
window.getListType = () => listType;

// Supabase Data Mapping


function convertFromDb(row) {
    let uiData = {
        id: row.id,
        profileId: row.profile_id,
        photoUrl: row.photo_url,
        status: row.status,
        notes: row.notes || [],
        followUpDate: row.follow_up_date,
        followUpNote: row.follow_up_note,
        followUpTime: row.follow_up_time,
        contactedAt: row.contacted_at,
        closedAt: row.closed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    for(let k in row) {
        if(dbMapToUI[k]) uiData[dbMapToUI[k]] = row[k] !== null ? row[k].toString() : '';
    }
    // Backward-compatible field aliases & direct mappings so UI keys always match database values
    uiData['Surname / Biradari'] = row.surname_biradari || uiData['Surname / Biradari'] || '';
    uiData["Father's Occupation"] = row.father_occupation || uiData['Father Occupation'] || '';
    uiData['Father Occupation'] = row.father_occupation || uiData["Father's Occupation"] || '';
    uiData["Mother's Occupation"] = row.mother_occupation || uiData['Mother Occupation'] || '';
    uiData['Mother Occupation'] = row.mother_occupation || uiData["Mother's Occupation"] || '';
    uiData['Maslak'] = row.maslak || uiData['Maslak'] || '';
    uiData['Maslak / Religious Background'] = row.maslak || uiData['Maslak'] || '';
    uiData['Maslak Preference'] = row.maslak_preference || uiData['Maslak Preference'] || '';
    uiData['Religious Preference'] = row.maslak_preference || uiData['Religious Preference'] || '';
    uiData['Email Address'] = row.email || uiData['Email Address'] || '';
    uiData['Native Place'] = row.native_place || row.family_location || uiData['Native Place'] || uiData['Family Location'] || '';
    uiData['Family Location'] = uiData['Native Place'];
    uiData['Residential Address'] = row.native_place || row.family_location || uiData['Native Place'] || row.city || uiData['City'] || '';
    uiData['City'] = row.city || uiData['City'] || '';
    uiData['State'] = row.state || uiData['State'] || '';
    uiData['Salary'] = (row.salary !== null && row.salary !== undefined) ? String(row.salary) : '';
    uiData['Salary (₹)'] = uiData['Salary'];

    return uiData;
}

function formatSalary(val) {
    if (val === null || val === undefined || val === '') return '—';
    const num = Number(String(val).replace(/[^\d.]/g, ''));
    if (isNaN(num) || num < 0) return '—';
    return '₹' + Math.round(num).toLocaleString('en-IN');
}
let currentView = 'dashboard';
let listType = 'all';
let currentPage = 1;
const PAGE_SIZE = 10;
let selectedProfileIds = new Set();
window.selectedProfileIds = selectedProfileIds;
let shareModalState = {
    type: 'single',
    profiles: [],
    includeContact: false
};
window.shareModalState = shareModalState;
let activeFilters = {};
let activeProfileIndex = null;
let isEditMode = false;

// Custom UI Dialog
function showDialog(type, title, message, onConfirm = null, showInput = false, inputType = 'textarea', options = [], initialValue = '', confirmBtnText = 'Confirm', cancelBtnText = 'Cancel') {
    lockModalScroll();
    let inputHtml = '';
    if (showInput) {
        if (inputType === 'select') {
            inputHtml = `<select id="dialogInput" class="w-full bg-white border border-gold/30 p-3.5 rounded-xl mb-4 text-[16px] md:text-sm focus:outline-none focus:border-wine">` + 
                        options.map(o => `<option value="${o}" ${o === initialValue ? 'selected' : ''}>${o}</option>`).join('') + `</select>`;
        } else {
            const escapedVal = (initialValue || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            inputHtml = `<textarea id="dialogInput" class="w-full bg-[#FAF8F5] border border-gold/40 p-3.5 rounded-xl mb-4 text-[15px] md:text-sm text-wine focus:outline-none focus:border-wine transition" rows="4" placeholder="Type here...">${escapedVal}</textarea>`;
        }
    }

    const confirmBtnClass = type === 'danger' 
        ? 'bg-[#C9436B] hover:bg-[#A82B50] text-white' 
        : 'btn-wine';

    const dialogHTML = `
    <div id="tempDialog" class="fixed inset-0 z-[200] flex items-end md:items-center justify-center p-0 md:p-4">
        <div class="absolute inset-0 bg-[#320A16]/60 backdrop-blur-sm" onclick="closeTempDialog()"></div>
        <div class="relative bg-ivory w-full max-w-sm rounded-t-[24px] md:rounded-[20px] shadow-2xl p-6 border border-gold/20 flex flex-col items-center text-center animate-slide-up md:animate-none">
            <h3 class="font-serif text-2xl text-wine font-semibold mb-2">${title}</h3>
            <p class="text-wine/70 text-sm mb-6 leading-relaxed">${message}</p>
            ${inputHtml}
            <div class="flex flex-col md:flex-row w-full gap-3">
                <button onclick="closeTempDialog()" class="w-full py-3.5 md:py-3 bg-[#FAF8F5] border border-gold/20 text-wine rounded-xl text-[16px] md:text-sm font-medium hover:bg-white transition">${cancelBtnText}</button>
                <button id="dialogConfirmBtn" class="w-full py-3.5 md:py-3 ${confirmBtnClass} rounded-xl text-[16px] md:text-sm font-medium shadow-md transition">${confirmBtnText}</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    const inputEl = document.getElementById('dialogInput');
    if (inputEl) {
        setTimeout(() => {
            inputEl.focus();
            if (inputType !== 'select') {
                inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
            }
        }, 100);
    }
    document.getElementById('dialogConfirmBtn').onclick = () => {
        let val = showInput ? document.getElementById('dialogInput').value : true;
        closeTempDialog();
        if(onConfirm) onConfirm(val);
    };
}

function closeTempDialog() {
    const el = document.getElementById('tempDialog');
    if (el) el.remove();
    unlockModalScroll();
}

// Data Load (Supabase)
async function loadData() {
    try {
        console.log("[ADMIN DEBUG] loadData started");
        console.log("[ADMIN DEBUG] Supabase select started");
        const { data, error, status } = await window.supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
        console.log("[ADMIN DEBUG] Supabase select finished");
        console.log("[ADMIN DEBUG] HTTP status:", status);
        
        if (error) {
            console.error("[ADMIN DEBUG] loadData SELECT error:", error);
            throw error;
        }
        
        const inputLength = data ? data.length : 0;
        console.log(`[ADMIN DEBUG] rows returned = ${inputLength}`);
        console.log(`[ADMIN DEBUG] convertFromDb input = ${inputLength}`);
        
        profiles = data.map(convertFromDb);
        console.log(`[ADMIN DEBUG] convertFromDb output = ${profiles.length}`);
        console.log(`[ADMIN DEBUG] profiles array length = ${profiles.length}`);
        
        injectFilterUI();
        populateFilters();
        updateSidebarBadges();
        
        console.log(`[ADMIN DEBUG] currentView: ${currentView}`);
        if (currentView === 'dashboard') {
            console.log("[ADMIN DEBUG] renderDashboard called");
            initDashboard();
        } else {
            renderListView();
        }

        subscribeToRealtime();
    } catch(e) { 
        console.error("Error loading profiles:", e);
        profiles = []; 
    }
}

// Supabase Realtime logic
let realtimeSubscription = null;

function subscribeToRealtime() {
    if (realtimeSubscription) return; // Prevent duplicate subscriptions

    realtimeSubscription = window.supabaseClient
        .channel('admin-profiles-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
            handleRealtimeEvent(payload);
        })
        .subscribe(status => {
            console.log("[Realtime] Channel status:", status);
        });
}

function handleRealtimeEvent(payload) {
    console.log("[Realtime] EVENT RECEIVED:", payload.eventType);
    
    const { eventType, new: newRow, old: oldRow } = payload;
    let changed = false;

    const activeProfileId = (activeProfileIndex !== null && activeProfileIndex >= 0 && activeProfileIndex < profiles.length) 
        ? profiles[activeProfileIndex].id 
        : null;

    if (eventType === 'INSERT') {
        console.log("[Realtime] INSERT profile id:", newRow.id, "name:", newRow.full_name);
        const newProfile = convertFromDb(newRow);
        if (!profiles.some(p => p.id === newProfile.id)) {
            console.log(`[Admin] profiles count BEFORE: ${profiles.length}`);
            profiles.unshift(newProfile);
            changed = true;
            console.log(`[Admin] profiles count AFTER: ${profiles.length}`);
        } else {
            console.warn("[Realtime] Duplicate insert detected, ignoring.");
        }
    } else if (eventType === 'UPDATE') {
        console.log("[Realtime] UPDATE profile id:", newRow.id);
        const updatedProfile = convertFromDb(newRow);
        const idx = profiles.findIndex(p => p.id === updatedProfile.id);
        if (idx !== -1) {
            profiles[idx] = updatedProfile;
            changed = true;
        }
    } else if (eventType === 'DELETE') {
        console.log("[Realtime] DELETE profile id:", oldRow.id);
        const origLen = profiles.length;
        profiles = profiles.filter(p => p.id !== oldRow.id);
        if (profiles.length !== origLen) changed = true;
    }

    if (changed) {
        console.log("[Admin] UI re-rendering due to realtime change.");
        if (activeProfileId) {
            activeProfileIndex = profiles.findIndex(p => p.id === activeProfileId);
        }

        updateSidebarBadges();
        if (currentView === 'dashboard') {
            initDashboard();
        } else {
            renderListView(); // Any other view is a list view
        }
        
        if (!document.getElementById('profileModal').classList.contains('hidden') && !isEditMode) {
            if (activeProfileIndex !== -1) {
                renderProfileModal();
            } else {
                closeModal();
            }
        }
    }
}

function saveData() { /* Removed in favor of direct Supabase updates */ }

// Initialization
async function initializeAuth() {
    console.log("[ADMIN DEBUG] initializeAuth started");

    // Safety check: Never allow password recovery link to open admin dashboard directly
    if (window.location.hash && (window.location.hash.includes('type=recovery') || window.location.hash.includes('error_code='))) {
        console.log("[ADMIN DEBUG] Recovery hash detected on admin page, redirecting to reset-password.html");
        window.location.href = '/admin/reset-password.html' + window.location.hash;
        return;
    }

    // Check for prefilled email from password reset completion
    const urlParams = new URLSearchParams(window.location.search);
    const prefillEmail = urlParams.get('email');
    if (prefillEmail) {
        const emailInput = document.getElementById('adminEmail');
        const pwdInput = document.getElementById('adminPassword');
        if (emailInput) emailInput.value = prefillEmail;
        if (pwdInput) {
            pwdInput.value = '';
            setTimeout(() => pwdInput.focus(), 150);
        }
        if (window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    // Check existing session on page load (handles refresh)
    const { data: { session }, error } = await window.supabaseClient.auth.getSession();
    
    if (error) {
        console.warn("[ADMIN DEBUG] Session error (e.g., stale refresh token):", error.message);
        // Clear stale session
        await window.supabaseClient.auth.signOut();
    }
    
    console.log("[ADMIN DEBUG] authenticated =", !!session);
    if (session) {
        console.log("[ADMIN DEBUG] session detected. UID:", session.user.id);
        const loginScreen = document.getElementById('loginScreen');
        if (loginScreen) loginScreen.classList.add('hidden');
        
        const migrateBtn = document.getElementById('migrateDataBtn');
        if (migrateBtn) migrateBtn.classList.remove('hidden');
        
        loadData();
        navigate('dashboard');
    } else {
        const loginScreen = document.getElementById('loginScreen');
        if (loginScreen) loginScreen.classList.remove('hidden');
    }
    console.log("[ADMIN DEBUG] initializeAuth completed");

    // Listen for future auth state changes
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            console.log("[ADMIN DEBUG] PASSWORD_RECOVERY event received, redirecting to reset-password.html");
            window.location.href = '/admin/reset-password.html' + window.location.hash;
            return;
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            console.log("[ADMIN DEBUG] Auth state changed to", event, "UID:", session?.user?.id);
            const loginScreen = document.getElementById('loginScreen');
            if (loginScreen) loginScreen.classList.add('hidden');
            
            const migrateBtn = document.getElementById('migrateDataBtn');
            if (migrateBtn) migrateBtn.classList.remove('hidden');
            
            loadData();
            navigate('dashboard');
        } else if (event === 'SIGNED_OUT') {
            const loginScreen = document.getElementById('loginScreen');
            if (loginScreen) loginScreen.classList.remove('hidden');
            
            // Hide dashboard if visible
            const sections = ['dashboardSection', 'allProfilesSection', 'settingsSection'];
            sections.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
            
            // Clean up realtime subscription
            if (realtimeSubscription) {
                window.supabaseClient.removeChannel(realtimeSubscription);
                realtimeSubscription = null;
            }
            profiles = [];
        }
    });
}

console.log("[ADMIN DEBUG] DOM ready");
initializeAuth();

document.getElementById('togglePasswordBtn').addEventListener('click', () => {
    const pwdInput = document.getElementById('adminPassword');
    const eyeIcon = document.getElementById('eyeIcon');
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        eyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />`;
        document.getElementById('togglePasswordBtn').setAttribute('aria-label', 'Hide password');
    } else {
        pwdInput.type = 'password';
        eyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />`;
        document.getElementById('togglePasswordBtn').setAttribute('aria-label', 'Show password');
    }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log("[LOGIN] submit triggered");
    
    const email = document.getElementById('adminEmail').value.trim();
    const pwd = document.getElementById('adminPassword').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    const errorEl = document.getElementById('loginError');
    
    errorEl.classList.add('hidden');
    
    console.log("[LOGIN] email present:", !!email);
    console.log("[LOGIN] password present:", !!pwd);

    if (!email) {
        errorEl.textContent = 'Please enter your email address.';
        errorEl.classList.remove('hidden');
        return;
    }
    if (!pwd) {
        errorEl.textContent = 'Please enter your password.';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (!window.supabaseClient) {
        errorEl.textContent = 'Supabase client is not initialized.';
        errorEl.classList.remove('hidden');
        return;
    }
    
    btn.textContent = 'LOGGING IN...';
    btn.disabled = true;
    
    try {
        console.log("[LOGIN] calling signInWithPassword");
        const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password: pwd });
        console.log("[LOGIN] auth response received");
        
        if (error) {
            console.log("[LOGIN] login error:", error.message);
            if (error.message.toLowerCase().includes('invalid login credentials')) {
                errorEl.textContent = 'Invalid email or password. Please check your credentials and try again.';
            } else {
                errorEl.textContent = 'Login failed: ' + error.message;
            }
            errorEl.classList.remove('hidden');
        } else {
            console.log("[LOGIN] login success");
            errorEl.classList.add('hidden');
        }
    } catch (err) {
        console.error("Login Error:", err);
        console.log("[LOGIN] login error:", err.message || 'Unknown error');
        errorEl.textContent = 'An unexpected error occurred: ' + (err.message || 'Unknown error');
        errorEl.classList.remove('hidden');
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
});

// Forgot Password UI toggle & submission
const forgotLink = document.getElementById('forgotPasswordLink');
const backToLoginBtn = document.getElementById('backToLoginBtn');
const loginBox = document.getElementById('loginBox');
const forgotPasswordBox = document.getElementById('forgotPasswordBox');
const forgotEmail = document.getElementById('forgotEmail');
const adminEmail = document.getElementById('adminEmail');
const forgotMsg = document.getElementById('forgotMsg');

if (forgotLink) {
    forgotLink.addEventListener('click', () => {
        if (adminEmail && adminEmail.value.trim() && forgotEmail) {
            forgotEmail.value = adminEmail.value.trim();
        }
        if (loginBox) loginBox.classList.add('hidden');
        if (forgotPasswordBox) forgotPasswordBox.classList.remove('hidden');
        if (forgotMsg) forgotMsg.classList.add('hidden');
        const loginError = document.getElementById('loginError');
        if (loginError) loginError.classList.add('hidden');
        if (forgotEmail) setTimeout(() => forgotEmail.focus(), 100);
    });
}

if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', () => {
        if (forgotPasswordBox) forgotPasswordBox.classList.add('hidden');
        if (loginBox) loginBox.classList.remove('hidden');
        if (forgotMsg) forgotMsg.classList.add('hidden');
        const loginError = document.getElementById('loginError');
        if (loginError) loginError.classList.add('hidden');
        if (adminEmail) setTimeout(() => adminEmail.focus(), 100);
    });
}

const forgotForm = document.getElementById('forgotPasswordForm');
const sendResetBtn = document.getElementById('sendResetBtn');

if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (forgotEmail?.value || '').trim();
        if (forgotMsg) {
            forgotMsg.classList.add('hidden');
            forgotMsg.className = "px-3 py-2.5 rounded-lg text-xs leading-relaxed font-medium text-center border w-full";
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            if (forgotMsg) {
                forgotMsg.textContent = 'Please enter a valid email address.';
                forgotMsg.classList.remove('hidden');
                forgotMsg.classList.add('text-[#C9436B]', 'bg-[#FAF8F5]', 'border-[#C9436B]/20');
            }
            return;
        }

        if (!window.supabaseClient) {
            if (forgotMsg) {
                forgotMsg.textContent = 'Supabase client is not initialized.';
                forgotMsg.classList.remove('hidden');
                forgotMsg.classList.add('text-[#C9436B]', 'bg-[#FAF8F5]', 'border-[#C9436B]/20');
            }
            return;
        }

        const origText = sendResetBtn ? sendResetBtn.textContent : 'SEND RESET LINK';
        if (sendResetBtn) {
            sendResetBtn.textContent = 'SENDING LINK...';
            sendResetBtn.disabled = true;
        }

        try {
            const redirectUrl = `${window.location.origin}/admin/reset-password.html`;
            const { data, error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: redirectUrl
            });

            if (error) {
                console.warn("[FORGOT PASSWORD] error:", error.message);
                const isRateLimit = error.status === 429 || error.message.toLowerCase().includes('rate limit') || error.message.toLowerCase().includes('seconds');
                if (forgotMsg) {
                    if (isRateLimit) {
                        forgotMsg.textContent = error.message;
                    } else {
                        forgotMsg.textContent = 'Unable to send reset link: ' + error.message;
                    }
                    forgotMsg.classList.remove('hidden');
                    forgotMsg.classList.add('text-[#C9436B]', 'bg-[#FAF8F5]', 'border-[#C9436B]/20');
                }
            } else {
                if (forgotMsg) {
                    forgotMsg.textContent = 'If an account exists for this email address, a password reset link will be sent. Please check your inbox and spam folder.';
                    forgotMsg.classList.remove('hidden');
                    forgotMsg.classList.add('text-wine', 'bg-[#FAF8F5]', 'border-gold/40');
                }
            }
        } catch (err) {
            console.error("[FORGOT PASSWORD] unexpected error:", err);
            if (forgotMsg) {
                forgotMsg.textContent = 'An unexpected error occurred. Please try again later.';
                forgotMsg.classList.remove('hidden');
                forgotMsg.classList.add('text-[#C9436B]', 'bg-[#FAF8F5]', 'border-[#C9436B]/20');
            }
        } finally {
            if (sendResetBtn) {
                sendResetBtn.textContent = origText;
                sendResetBtn.disabled = false;
            }
        }
    });
}

document.getElementById('logoutBtn').addEventListener('click', () => {
    showDialog('info', 'Logout', 'Are you sure you want to logout?', async () => {
        await window.supabaseClient.auth.signOut();
        location.reload();
    });
});

// Sidebar 
function updateSidebarBadges() {
    const counts = {
        pending: profiles.filter(p => p.status === 'New').length,
        shortlisted: profiles.filter(p => p.status === 'Shortlisted').length,
        followup: profiles.filter(p => p.status === 'Follow Up').length
    };
    
    document.querySelectorAll('.nav-link').forEach(link => {
        const target = link.getAttribute('data-target');
        if (['pending', 'shortlisted', 'followup'].includes(target)) {
            let badge = link.querySelector('.nav-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'nav-badge bg-white/20 px-2 py-0.5 rounded text-[10px] ml-auto font-bold';
                link.appendChild(badge);
            }
            badge.innerText = counts[target];

// Supabase Data Mapping


            badge.style.display = counts[target] > 0 ? 'inline-block' : 'none';
        }
    });
}

document.querySelectorAll('.nav-link').forEach(l => {
    l.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(e.currentTarget.getAttribute('data-target'));
    });
});

document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('-translate-x-full');
    document.getElementById('sidebarOverlay').classList.remove('hidden');
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('sidebarOverlay').classList.add('hidden');
});

initDeleteQueryModalListeners();

function navigate(view) {
    currentView = view;
    currentPage = 1;
    selectedProfileIds.clear();
    closeAllDropdowns();
    document.querySelectorAll('.page-view').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-link').forEach(el => {
        el.classList.remove('bg-burg/50', 'border-gold/10', 'text-cream');
        el.classList.add('text-cream/60', 'hover:bg-white/5');
    });
    const active = document.querySelector('.nav-link[data-target="'+view+'"]');
    if (active) {
        active.classList.remove('text-cream/60', 'hover:bg-white/5');
        active.classList.add('bg-burg/50', 'border-gold/10', 'text-cream');
    }
    
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
        document.getElementById('sidebarOverlay').classList.add('hidden');
    }
    
    if (['all', 'pending', 'shortlisted', 'contacted', 'followup', 'notes'].includes(view)) {
        document.getElementById('view-list').classList.remove('hidden');
        listType = view;
        renderListView();
    } else {
        document.getElementById('view-' + view).classList.remove('hidden');
        if(view === 'dashboard') initDashboard();
    }
}

// Modal & Body Scroll Lock Helpers
function lockModalScroll() {
    document.body.classList.add('overflow-hidden');
}

function unlockModalScroll() {
    const openModals = [
        'profileModal', 'filterModal', 'followUpModal', 
        'deleteQueryModal', 'shareWhatsAppModal', 'tempDialog'
    ].some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });
    if (!openModals) {
        document.body.classList.remove('overflow-hidden');
    }
}

function openFilterModal() {
    populateFilters();
    lockModalScroll();
    const m = document.getElementById('filterModal');
    if (m) m.classList.remove('hidden');
}

function closeFilterModal() {
    const m = document.getElementById('filterModal');
    if (m) m.classList.add('hidden');
    unlockModalScroll();
}

function openFollowUpModal() {
    lockModalScroll();
    const m = document.getElementById('followUpModal');
    if (m) m.classList.remove('hidden');
}

function closeFollowUpModal() {
    const m = document.getElementById('followUpModal');
    if (m) m.classList.add('hidden');
    unlockModalScroll();
}

function closeShareModal() {
    const m = document.getElementById('shareWhatsAppModal');
    if (m) m.classList.add('hidden');
    unlockModalScroll();
}

// Dashboard Engine & KPI Cards
function initDashboard() {
    updateSidebarBadges();
    
    const pendingCount = profiles.filter(p => p.status === 'New').length;
    const shortCount = profiles.filter(p => p.status === 'Shortlisted').length;
    const fuCount = profiles.filter(p => p.status === 'Follow Up').length;

    // Update KPI Card Numbers
    const elTotal = document.getElementById('statTotal');
    const elPending = document.getElementById('statPending');
    const elShort = document.getElementById('statShortlisted');
    const elFu = document.getElementById('statFollowUp');

    if (elTotal) elTotal.textContent = profiles.length;
    if (elPending) elPending.textContent = pendingCount;
    if (elShort) elShort.textContent = shortCount;
    if (elFu) elFu.textContent = fuCount;

    // Ensure Dashboard Search Input is bound
    const searchInput = document.getElementById('dashSearchInput');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = 'true';
        searchInput.addEventListener('input', () => {
            renderDashboardRecent();
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                clearDashSearch();
            }
        });
    }

    renderDashboardRecent();
}

function getDashboardRecentProfiles() {
    let list = [...profiles];

    // 1. Advanced Filters (Status, Gender, City, Surname, Maslak, Age range, Reg dates)
    if (activeFilters.status && activeFilters.status !== 'All') {
        list = list.filter(p => p.status === activeFilters.status);
    }
    if (activeFilters.gender && activeFilters.gender !== 'All') {
        list = list.filter(p => p.Gender === activeFilters.gender);
    }
    if (activeFilters.city && activeFilters.city !== 'All') {
        list = list.filter(p => p.City === activeFilters.city);
    }
    if (activeFilters.surname && activeFilters.surname !== 'All') {
        list = list.filter(p => p['Surname / Biradari'] === activeFilters.surname);
    }
    if (activeFilters.maslak && activeFilters.maslak !== 'All') {
        list = list.filter(p => (p['Maslak'] === activeFilters.maslak || p['Maslak / Religious Background'] === activeFilters.maslak));
    }
    if (activeFilters.minAge) {
        list = list.filter(p => parseInt(p.Age, 10) >= parseInt(activeFilters.minAge, 10));
    }
    if (activeFilters.maxAge) {
        list = list.filter(p => parseInt(p.Age, 10) <= parseInt(activeFilters.maxAge, 10));
    }
    if (activeFilters.regFrom) {
        list = list.filter(p => p.createdAt && new Date(p.createdAt.split('T')[0]) >= new Date(activeFilters.regFrom));
    }
    if (activeFilters.regTo) {
        list = list.filter(p => p.createdAt && new Date(p.createdAt.split('T')[0]) <= new Date(activeFilters.regTo));
    }

    // 2. Multi-field Dashboard Search Query
    const searchInput = document.getElementById('dashSearchInput');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (query) {
        list = list.filter(p => {
            const searchableFields = [
                p['Full Name'],
                p.profileId,
                p.Gender,
                p.Age ? String(p.Age) : '',
                p.City,
                p.State,
                p['Native Place'],
                p['Family Location'],
                p.Education,
                p.Occupation,
                p.Salary,
                p['Salary (₹)'],
                formatSalary(p.Salary),
                p['Marital Status'],
                p.Mobile,
                p.WhatsApp,
                p['Guardian Name'],
                p.Relationship,
                p.status,
                p.createdAt ? p.createdAt.split('T')[0] : '',
                p['Mother Tongue'],
                p['Languages Known'],
                p['Surname / Biradari'],
                p.Maslak,
                p['Maslak / Religious Background'],
                p['Email Address'],
                p['Registering For']
            ];

            return searchableFields.some(val => {
                if (val === undefined || val === null) return false;
                return String(val).toLowerCase().includes(query);
            });
        });
    }

    // 3. Newest-registration-first sort order
    list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // When no search & no filter, show newest 10 records.
    // When search or filter is applied, return all matching records in newest-first order.
    const isFiltered = query.length > 0 || Object.values(activeFilters).some(v => v && v !== 'All');
    return isFiltered ? list : list.slice(0, 10);
}

function renderDashboardRecent() {
    const dashData = getDashboardRecentProfiles();
    const searchInput = document.getElementById('dashSearchInput');
    const query = searchInput ? searchInput.value.trim() : '';
    const hasFilter = Object.values(activeFilters).some(v => v && v !== 'All');
    const isFiltered = query.length > 0 || hasFilter;

    // Search clear button visibility
    const clearBtn = document.getElementById('dashSearchClearBtn');
    if (clearBtn) {
        if (query) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    // Filter active indicator dot on Dashboard Filter Button
    const filterDot = document.getElementById('dashActiveFilterDot');
    if (filterDot) {
        if (hasFilter) filterDot.classList.remove('hidden');
        else filterDot.classList.add('hidden');
    }

    // Results count badge
    const badge = document.getElementById('dashResultsCountBadge');
    if (badge) {
        if (isFiltered) {
            badge.textContent = `${dashData.length} match${dashData.length === 1 ? '' : 'es'}`;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    // Dashboard active filters banner
    const banner = document.getElementById('dashActiveFiltersBanner');
    if (banner) {
        if (hasFilter) {
            let pillsHtml = '<span class="text-wine/60 font-medium mr-1">Active Filters:</span>';
            for (let k in activeFilters) {
                const v = activeFilters[k];
                if (v && v !== 'All') {
                    pillsHtml += `<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gold/30 rounded-lg text-wine font-medium"><span>${k}: <b>${v}</b></span><button onclick="removeDashboardFilter('${k}')" class="text-wine/40 hover:text-wine ml-0.5" title="Remove filter">✕</button></span>`;
                }
            }
            pillsHtml += `<button onclick="clearFilters()" class="text-wine font-bold underline ml-2 hover:opacity-80">Clear All</button>`;
            banner.innerHTML = pillsHtml;
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
            banner.innerHTML = '';
        }
    }

    // Render Desktop Table Body
    const tbody = document.getElementById('dashTableBody');
    if (tbody) {
        if (dashData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="p-8 text-center text-wine/60 bg-[#FAF8F5]/50">
                        <div class="flex flex-col items-center justify-center gap-2">
                            <p class="font-medium text-[15px] text-wine">No matching registrations found</p>
                            <p class="text-xs text-wine/50">Try adjusting your search keywords or clearing active filters.</p>
                            ${isFiltered ? '<button onclick="clearDashAllSearchAndFilters()" class="mt-2 px-3 py-1.5 bg-wine text-white rounded-lg text-xs font-semibold hover:bg-wine/90 transition shadow-sm">Clear Search & Filters</button>' : ''}
                        </div>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = dashData.map(p => {
                const idx = profiles.indexOf(p);
                return `<tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                    <td class="p-4 text-[12px] text-wine/60">${p.createdAt ? p.createdAt.split('T')[0] : '—'}</td>
                    <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']|| '—'}</p></td>
                    <td class="p-4 text-[13px] text-wine/80">${p.Gender|| '—'} / ${p.Age ? p.Age + ' yrs' : '—'}</td>
                    <td class="p-4 text-[13px] text-wine/80">${p.City|| '—'}</td>
                    <td class="p-4">${getStatusBadge(p)}</td>
                    <td class="p-4 text-right flex justify-end items-center gap-1.5">
                        <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine hover:bg-wine/5 shadow-sm">View</button>
                        <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            <span>Delete</span>
                        </button>
                    </td>
                </tr>`;
            }).join('');
        }
    }

    // Render Mobile Cards
    const mobCont = document.getElementById('dashMobileCards');
    if (mobCont) {
        if (dashData.length === 0) {
            mobCont.innerHTML = `
                <div class="p-8 text-center text-wine/60">
                    <p class="font-medium text-[15px] text-wine">No matching registrations</p>
                    <p class="text-xs text-wine/50 mt-1">Try another search keyword or reset filters.</p>
                    ${isFiltered ? '<button onclick="clearDashAllSearchAndFilters()" class="mt-3 px-4 py-2 bg-wine text-white rounded-xl text-xs font-semibold hover:bg-wine/90 transition shadow-sm">Clear Search & Filters</button>' : ''}
                </div>
            `;
        } else {
            mobCont.innerHTML = dashData.map(p => {
                const idx = profiles.indexOf(p);
                return `<div class="p-4 md:p-5 border-b border-gold/10 last:border-b-0 flex flex-col gap-2.5">
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="font-serif font-bold text-wine text-[17px] leading-tight">${p['Full Name']|| '—'}</h4>
                            <p class="text-[10px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId || '—'}</p>
                        </div>
                        ${getStatusBadge(p)}
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-wine/70">
                        <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gold/50"></span>${p.Gender|| '—'} • ${p.Age ? p.Age + ' yrs' : '—'}</span>
                        <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gold/50"></span>${p.City|| '—'}</span>
                        <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gold/50"></span>${p.createdAt ? p.createdAt.split('T')[0] : '—'}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        <button onclick="viewProfile(${idx})" class="py-2.5 bg-[#FAF8F5] border border-gold/20 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm active:scale-[0.98] transition">View Details</button>
                        <button onclick="openDeleteQueryModal(${idx})" class="py-2.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-xl text-[12px] uppercase font-bold shadow-sm active:scale-[0.98] transition inline-flex items-center justify-center gap-1.5">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

function clearDashSearch() {
    const input = document.getElementById('dashSearchInput');
    if (input) {
        input.value = '';
        renderDashboardRecent();
        input.focus();
    }
}

function clearDashAllSearchAndFilters() {
    const input = document.getElementById('dashSearchInput');
    if (input) input.value = '';
    clearFilters();
}

function openDashboardFilter() {
    openFilterModal();
}

function removeDashboardFilter(key) {
    if (activeFilters[key]) {
        delete activeFilters[key];
        const inputMap = {
            gender: 'fltGender',
            status: 'fltStatus',
            city: 'fltCity',
            minAge: 'fltMinAge',
            maxAge: 'fltMaxAge',
            surname: 'fltSurname',
            maslak: 'fltMaslak',
            regFrom: 'fltRegFrom',
            regTo: 'fltRegTo'
        };
        const elId = inputMap[key];
        if (elId) {
            const el = document.getElementById(elId);
            if (el) {
                if (el.tagName === 'SELECT') el.value = 'All';
                else el.value = '';
            }
        }
        applyFilters();
    }
}

// Filters & Search
function injectFilterUI() {
    const filterContainer = document.querySelector('#filterModal .overflow-y-auto');
    if (!filterContainer) return;
    
    filterContainer.innerHTML = `
        <div class="space-y-4 text-sm pb-10">
            <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Gender</label>
            <select id="fltGender" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"><option value="All">All</option><option value="Male">Male</option><option value="Female">Female</option></select></div>
            
            <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Status</label>
            <select id="fltStatus" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"><option value="All">All</option><option value="New">New</option><option value="Reviewed">Reviewed</option><option value="Shortlisted">Shortlisted</option><option value="Contacted">Contacted</option><option value="Follow Up">Follow Up</option><option value="Closed">Closed</option></select></div>
            
            <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Min Age</label>
                <input type="number" id="fltMinAge" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]" placeholder="Min"></div>
                <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Max Age</label>
                <input type="number" id="fltMaxAge" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]" placeholder="Max"></div>
            </div>
            
            <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">City</label>
            <select id="fltCity" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"></select></div>
            
            <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Surname / Biradari</label>
            <select id="fltSurname" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"></select></div>
            
            <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Maslak</label>
            <select id="fltMaslak" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"></select></div>
            
            <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Reg Date (From)</label>
                <input type="date" id="fltRegFrom" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"></div>
                <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Reg Date (To)</label>
                <input type="date" id="fltRegTo" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"></div>
            </div>
        </div>
        <div class="sticky bottom-0 bg-white pt-4 pb-2 border-t mt-4 flex gap-3">
            <button onclick="clearFilters()" class="flex-1 py-3 border border-gold/30 text-wine rounded-xl text-[14px] font-bold uppercase tracking-wider bg-[#FAF8F5]">Clear</button>
            <button onclick="applyFilters()" class="flex-1 py-3 bg-wine text-white rounded-xl text-[14px] font-bold uppercase tracking-wider shadow-md">Apply</button>
        </div>
    `;
    
    // Remove the old static buttons from HTML since we made them sticky inside the scroll area
    const oldBtns = document.querySelector('#filterModal > div > div.p-4.border-t');
    if(oldBtns) oldBtns.remove();
}

function populateFilters() {
    const getOptions = (key) => [...new Set(profiles.map(p=>p[key]).filter(Boolean))].sort();
    const maslakOptions = [...new Set(profiles.map(p=>p['Maslak'] || p['Maslak / Religious Background']).filter(Boolean))].sort();
    
    const cityEl = document.getElementById('fltCity');
    const surnameEl = document.getElementById('fltSurname');
    const maslakEl = document.getElementById('fltMaslak');

    if (cityEl) cityEl.innerHTML = '<option value="All">All</option>' + getOptions('City').map(c=>`<option value="${c}">${c}</option>`).join('');
    if (surnameEl) surnameEl.innerHTML = '<option value="All">All</option>' + getOptions('Surname / Biradari').map(c=>`<option value="${c}">${c}</option>`).join('');
    if (maslakEl) maslakEl.innerHTML = '<option value="All">All</option>' + maslakOptions.map(c=>`<option value="${c}">${c}</option>`).join('');
}

function applyFilters() {
    activeFilters = {
        gender: document.getElementById('fltGender') ? document.getElementById('fltGender').value : 'All',
        status: document.getElementById('fltStatus') ? document.getElementById('fltStatus').value : 'All',
        city: document.getElementById('fltCity') ? document.getElementById('fltCity').value : 'All',
        minAge: document.getElementById('fltMinAge') ? document.getElementById('fltMinAge').value : '',
        maxAge: document.getElementById('fltMaxAge') ? document.getElementById('fltMaxAge').value : '',
        surname: document.getElementById('fltSurname') ? document.getElementById('fltSurname').value : 'All',
        maslak: document.getElementById('fltMaslak') ? document.getElementById('fltMaslak').value : 'All',
        regFrom: document.getElementById('fltRegFrom') ? document.getElementById('fltRegFrom').value : '',
        regTo: document.getElementById('fltRegTo') ? document.getElementById('fltRegTo').value : ''
    };
    currentPage = 1;
    selectedProfileIds.clear();
    closeFilterModal();
    if (currentView === 'dashboard') {
        renderDashboardRecent();
    } else {
        renderListView();
    }
}
function clearFilters() {
    activeFilters = {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('fltGender', 'All');
    setVal('fltStatus', 'All');
    setVal('fltCity', 'All');
    setVal('fltMinAge', '');
    setVal('fltMaxAge', '');
    setVal('fltSurname', 'All');
    setVal('fltMaslak', 'All');
    setVal('fltRegFrom', '');
    setVal('fltRegTo', '');
    currentPage = 1;
    selectedProfileIds.clear();
    applyFilters();
}

document.getElementById('listSearchInput').addEventListener('input', () => {
    currentPage = 1;
    selectedProfileIds.clear();
    renderListView();
});

// View Helpers
function getStatusBadge(p) {
    if(p.status === 'New') return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-800 border border-green-200">New</span>`;
    if(p.status === 'Reviewed') return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200">Reviewed</span>`;
    if(p.status === 'Shortlisted') return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-yellow-100 text-yellow-800 border border-yellow-200">Shortlisted</span>`;
    if(p.status === 'Follow Up') {
        if(!p.followUpDate) return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">Follow Up</span>`;
        let d = new Date(p.followUpDate).setHours(0,0,0,0);
        let t = new Date().setHours(0,0,0,0);
        let fuState = d < t ? 'bg-red-50 text-red-800 border-red-200' : (d === t ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-green-50 text-green-800 border-green-200');
        let fuLabel = d < t ? 'Overdue' : (d === t ? 'Due Today' : 'Upcoming');
        return `<div class="text-right"><span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${fuState}">${fuLabel}</span><br><span class="text-[10px] text-wine/60 mt-1 block font-medium">${p.followUpDate}</span></div>`;
    }
    if(p.status === 'Contacted') return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">Contacted</span>`;
    if(p.status === 'Closed') return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500 border border-gray-200">Closed</span>`;
    return `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-800 border border-gray-200">${p.status}</span>`;
}

// Data Filter & Helper Engine
function getFilteredProfiles() {
    let filtered = [...profiles];
    
    // Module Filters
    if (listType === 'pending') filtered = filtered.filter(p => p.status === 'New');
    if (listType === 'shortlisted') filtered = filtered.filter(p => p.status === 'Shortlisted');
    if (listType === 'contacted') filtered = filtered.filter(p => p.status === 'Contacted');
    if (listType === 'followup') filtered = filtered.filter(p => p.status === 'Follow Up');
    if (listType === 'notes') filtered = filtered.filter(p => p.notes && p.notes.length > 0);

    // Advanced Filters
    if (activeFilters.gender && activeFilters.gender !== 'All') filtered = filtered.filter(p => p.Gender === activeFilters.gender);
    if (activeFilters.status && activeFilters.status !== 'All') filtered = filtered.filter(p => p.status === activeFilters.status);
    if (activeFilters.city && activeFilters.city !== 'All') filtered = filtered.filter(p => p.City === activeFilters.city);
    if (activeFilters.surname && activeFilters.surname !== 'All') filtered = filtered.filter(p => p['Surname / Biradari'] === activeFilters.surname);
    if (activeFilters.maslak && activeFilters.maslak !== 'All') filtered = filtered.filter(p => (p['Maslak'] === activeFilters.maslak || p['Maslak / Religious Background'] === activeFilters.maslak));
    if (activeFilters.minAge) filtered = filtered.filter(p => parseInt(p.Age) >= parseInt(activeFilters.minAge));
    if (activeFilters.maxAge) filtered = filtered.filter(p => parseInt(p.Age) <= parseInt(activeFilters.maxAge));
    if (activeFilters.regFrom) filtered = filtered.filter(p => new Date(p.createdAt.split('T')[0]) >= new Date(activeFilters.regFrom));
    if (activeFilters.regTo) filtered = filtered.filter(p => new Date(p.createdAt.split('T')[0]) <= new Date(activeFilters.regTo));

    // Global Search
    const searchInput = document.getElementById('listSearchInput');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    if (term) {
        filtered = filtered.filter(p => Object.values(p).some(v => String(v).toLowerCase().includes(term)));
    }
    return filtered;
}

// Pagination & Selection Management
function changePage(p) {
    const filtered = getFilteredProfiles();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (p < 1 || p > totalPages) return;
    currentPage = p;
    renderListView();
    const listEl = document.getElementById('view-list');
    if (listEl) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleSelectPage(checked) {
    const filtered = getFilteredProfiles();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pagedProfiles = filtered.slice(startIdx, startIdx + PAGE_SIZE);

    pagedProfiles.forEach(p => {
        if (checked) {
            selectedProfileIds.add(p.id);
        } else {
            selectedProfileIds.delete(p.id);
        }
    });
    renderListView();
}

function selectAllFilteredProfiles() {
    const filtered = getFilteredProfiles();
    filtered.forEach(p => selectedProfileIds.add(p.id));
    renderListView();
}

function clearProfileSelection() {
    selectedProfileIds.clear();
    renderListView();
}

function toggleProfileSelection(id, checked, e) {
    if (checked) {
        selectedProfileIds.add(id);
    } else {
        selectedProfileIds.delete(id);
    }
    const evt = e || (typeof window !== 'undefined' ? window.event : null);
    if (evt && evt.target) {
        const tr = evt.target.closest('tr');
        if (tr) tr.classList.toggle('bg-[#FAF8F5]', checked);
        const card = evt.target.closest('div.bg-white');
        if (card) {
            card.classList.toggle('ring-2', checked);
            card.classList.toggle('ring-wine/20', checked);
            card.classList.toggle('bg-[#FAF8F5]/40', checked);
        }
    }
    const filtered = getFilteredProfiles();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pagedProfiles = filtered.slice(startIdx, startIdx + PAGE_SIZE);
    updateSelectionUI(filtered, pagedProfiles);
}

function updateSelectionUI(filtered = getFilteredProfiles(), pagedProfiles = null) {
    if (!pagedProfiles) {
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
        const cur = Math.max(1, Math.min(currentPage, totalPages));
        const startIdx = (cur - 1) * PAGE_SIZE;
        pagedProfiles = filtered.slice(startIdx, startIdx + PAGE_SIZE);
    }
    const selCount = selectedProfileIds.size;
    const filteredCount = filtered.length;
    const allCount = profiles.length;

    // Dropdown counters
    const expSelCount = document.getElementById('exportSelectedCount');
    if (expSelCount) expSelCount.innerText = selCount;
    const expFltCount = document.getElementById('exportFilteredCount');
    if (expFltCount) expFltCount.innerText = filteredCount;
    const expAllCount = document.getElementById('exportAllCount');
    if (expAllCount) expAllCount.innerText = allCount;

    const shrSelCount = document.getElementById('shareSelectedCount');
    if (shrSelCount) shrSelCount.innerText = selCount;
    const shrFltCount = document.getElementById('shareFilteredCount');
    if (shrFltCount) shrFltCount.innerText = filteredCount;
    const shrAllCount = document.getElementById('shareAllCount');
    if (shrAllCount) shrAllCount.innerText = allCount;

    // Button disabled states
    const expSelBtn = document.getElementById('exportSelectedBtn');
    if (expSelBtn) expSelBtn.disabled = selCount === 0;
    const shrSelBtn = document.getElementById('shareSelectedBtn');
    if (shrSelBtn) shrSelBtn.disabled = selCount === 0;

    const expFltBtn = document.getElementById('exportFilteredBtn');
    if (expFltBtn) expFltBtn.disabled = filteredCount === 0;
    const shrFltBtn = document.getElementById('shareFilteredBtn');
    if (shrFltBtn) shrFltBtn.disabled = filteredCount === 0;

    const expAllBtn = document.getElementById('exportAllBtn');
    if (expAllBtn) expAllBtn.disabled = allCount === 0;
    const shrAllBtn = document.getElementById('shareAllBtn');
    if (shrAllBtn) shrAllBtn.disabled = allCount === 0;

    // Selection Toolbar
    const toolbar = document.getElementById('selectionToolbar');
    if (toolbar) {
        if (selCount > 0) {
            toolbar.classList.remove('hidden');
            const badge = document.getElementById('selectionCountBadge');
            if (badge) badge.innerText = selCount;
            const text = document.getElementById('selectionText');
            if (text) text.innerText = selCount === 1 ? '1 Profile Selected' : `${selCount} Profiles Selected`;
        } else {
            toolbar.classList.add('hidden');
        }
    }

    // Select All Filtered Banner
    const banner = document.getElementById('selectAllFilteredBanner');
    if (banner) {
        const allPageSelected = pagedProfiles.length > 0 && pagedProfiles.every(p => selectedProfileIds.has(p.id));
        const hasMoreFiltered = filteredCount > pagedProfiles.length;
        const allFilteredSelected = filteredCount > 0 && filtered.every(p => selectedProfileIds.has(p.id));

        if (allPageSelected && hasMoreFiltered && !allFilteredSelected) {
            banner.classList.remove('hidden');
            const bText = document.getElementById('selectAllFilteredText');
            if (bText) bText.innerText = `All ${pagedProfiles.length} profiles on this page are selected.`;
            const bBtn = document.getElementById('selectAllFilteredBtn');
            if (bBtn) bBtn.innerText = `Select all ${filteredCount} filtered profiles`;
        } else {
            banner.classList.add('hidden');
        }
    }

    // Header Checkbox state
    const headerCb = document.getElementById('selectAllHeaderCheckbox');
    if (headerCb) {
        if (pagedProfiles.length === 0) {
            headerCb.checked = false;
            headerCb.indeterminate = false;
        } else {
            const pageSelectedCount = pagedProfiles.filter(p => selectedProfileIds.has(p.id)).length;
            if (pageSelectedCount === pagedProfiles.length) {
                headerCb.checked = true;
                headerCb.indeterminate = false;
            } else if (pageSelectedCount > 0) {
                headerCb.checked = false;
                headerCb.indeterminate = true;
            } else {
                headerCb.checked = false;
                headerCb.indeterminate = false;
            }
        }
    }
}

// Dropdown UI Handlers & Responsive Clamping
function positionDropdownSafely(menuEl, buttonEl) {
    if (!menuEl || !buttonEl) return;
    
    // Clear any previous inline styles to measure natural dimensions
    menuEl.style.left = '';
    menuEl.style.right = '';
    menuEl.style.width = '';
    menuEl.style.maxWidth = '';

    const isMobile = window.innerWidth < 768;
    if (isMobile) {
        const parentRect = buttonEl.parentElement.getBoundingClientRect();
        const maxAllowedWidth = Math.min(270, window.innerWidth - 24);
        menuEl.style.width = maxAllowedWidth + 'px';
        menuEl.style.maxWidth = 'calc(100vw - 24px)';
        
        let targetViewportLeft = parentRect.right - maxAllowedWidth;
        if (targetViewportLeft < 12) {
            targetViewportLeft = 12;
        }
        if (targetViewportLeft + maxAllowedWidth > window.innerWidth - 12) {
            targetViewportLeft = window.innerWidth - 12 - maxAllowedWidth;
        }
        
        const relativeLeft = targetViewportLeft - parentRect.left;
        menuEl.style.left = relativeLeft + 'px';
        menuEl.style.right = 'auto';
    } else {
        menuEl.style.left = 'auto';
        menuEl.style.right = '0';
        menuEl.style.width = '';
        menuEl.style.maxWidth = '';
    }
}

function toggleExportDropdown(e) {
    if (e) e.stopPropagation();
    const expMenu = document.getElementById('exportDropdownMenu');
    const shrMenu = document.getElementById('shareDropdownMenu');
    const btn = document.getElementById('exportDropdownBtn');
    if (shrMenu) shrMenu.classList.add('hidden');
    if (expMenu) {
        const willOpen = expMenu.classList.contains('hidden');
        if (willOpen) {
            positionDropdownSafely(expMenu, btn);
            expMenu.classList.remove('hidden');
        } else {
            expMenu.classList.add('hidden');
        }
    }
}

function toggleShareDropdown(e) {
    if (e) e.stopPropagation();
    const expMenu = document.getElementById('exportDropdownMenu');
    const shrMenu = document.getElementById('shareDropdownMenu');
    const btn = document.getElementById('shareDropdownBtn');
    if (expMenu) expMenu.classList.add('hidden');
    if (shrMenu) {
        const willOpen = shrMenu.classList.contains('hidden');
        if (willOpen) {
            positionDropdownSafely(shrMenu, btn);
            shrMenu.classList.remove('hidden');
        } else {
            shrMenu.classList.add('hidden');
        }
    }
}

function closeAllDropdowns() {
    const expMenu = document.getElementById('exportDropdownMenu');
    const shrMenu = document.getElementById('shareDropdownMenu');
    if (expMenu) {
        expMenu.classList.add('hidden');
        expMenu.style.left = '';
        expMenu.style.right = '';
    }
    if (shrMenu) {
        shrMenu.classList.add('hidden');
        shrMenu.style.left = '';
        shrMenu.style.right = '';
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#exportDropdownBtn') && !e.target.closest('#exportDropdownMenu') &&
        !e.target.closest('#shareDropdownBtn') && !e.target.closest('#shareDropdownMenu')) {
        closeAllDropdowns();
    }
});

window.addEventListener('resize', () => {
    closeAllDropdowns();
});

// CSV Export Engine
const CSV_COLUMNS = [
    { key: 'profileId', label: 'Profile ID' },
    { key: 'status', label: 'Status' },
    { key: 'createdAtFormatted', label: 'Registration Date' },
    // Basic
    { key: 'Full Name', label: 'Full Name' },
    { key: 'Registering For', label: 'Registering For' },
    { key: 'Gender', label: 'Gender' },
    { key: 'Age', label: 'Age' },
    { key: 'Date of Birth', label: 'Date of Birth' },
    { key: 'Marital Status', label: 'Marital Status' },
    { key: 'Height', label: 'Height' },
    // Professional
    { key: 'Education', label: 'Education' },
    { key: 'Occupation', label: 'Occupation' },
    { key: 'Salary (₹)', label: 'Salary (₹)' },
    { key: 'City', label: 'City' },
    { key: 'State', label: 'State' },
    { key: 'Mother Tongue', label: 'Mother Tongue' },
    { key: 'Languages Known', label: 'Languages Known' },
    // Family & Religious
    { key: 'Surname / Biradari', label: 'Surname / Biradari' },
    { key: "Father's Occupation", label: "Father's Occupation" },
    { key: "Mother's Occupation", label: "Mother's Occupation" },
    { key: 'Brothers', label: 'Brothers' },
    { key: 'Sisters', label: 'Sisters' },
    { key: 'Native Place', label: 'Native Place' },
    { key: 'Family Type', label: 'Family Type' },
    { key: 'Maslak', label: 'Maslak' },
    { key: 'Religious Preference', label: 'Religious Preference' },
    // About Candidate
    { key: 'About Candidate', label: 'About Candidate' },
    // Match Preferences
    { key: 'Preferred Age Range', label: 'Preferred Age Range' },
    { key: 'Preferred Location', label: 'Preferred Location' },
    { key: 'Preferred Education', label: 'Preferred Education' },
    { key: 'Preferred Profession', label: 'Preferred Profession' },
    { key: 'Other Preferences', label: 'Other Preferences' },
    // Contact Details
    { key: 'Guardian Name', label: 'Guardian Name', isContact: true },
    { key: 'Relationship', label: 'Relationship', isContact: true },
    { key: 'Mobile', label: 'Mobile', isContact: true, isPhone: true },
    { key: 'WhatsApp', label: 'WhatsApp', isContact: true, isPhone: true },
    { key: 'Preferred Contact Time', label: 'Preferred Contact Time', isContact: true },
    { key: 'Residential Address', label: 'Residential Address', isContact: true },
    { key: 'Email Address', label: 'Email Address', isContact: true }
];

function getTodayDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function sanitizeFilename(name) {
    if (!name) return 'profile';
    return String(name)
        .trim()
        .toLowerCase()
        .replace(/[/\\?%*:|"<>]/g, '')
        .replace(/\s+/g, '-');
}

function escapeCsvCell(val, isPhone = false) {
    if (val === undefined || val === null || val === '') return '—';
    let str = String(val).trim();
    if (!str) return '—';

    // Formula injection protection: prepend ' if value starts with =, +, -, @, \t, \r
    const formulaPrefixes = ['=', '+', '-', '@', '\t', '\r'];
    if (formulaPrefixes.includes(str.charAt(0))) {
        str = "'" + str;
    } else if (isPhone && /^\d+$/.test(str)) {
        str = "'" + str;
    }

    // RFC 4180 escaping
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function generateCsvContent(profileList, includeContact = true) {
    let csv = '\uFEFF'; // UTF-8 BOM
    
    // Header row
    const headers = CSV_COLUMNS.map(col => `"${col.label.replace(/"/g, '""')}"`);
    csv += headers.join(',') + '\r\n';

    // Data rows
    profileList.forEach(p => {
        const row = CSV_COLUMNS.map(col => {
            if (col.isContact && !includeContact) {
                return '—';
            }
            if (col.key === 'createdAtFormatted') {
                const regDate = p.createdAt ? p.createdAt.split('T')[0] : '—';
                return escapeCsvCell(regDate);
            }
            if (col.key === 'Salary (₹)') {
                const sal = p['Salary'] || p['Salary (₹)'];
                return escapeCsvCell(sal ? formatSalary(sal) : '—');
            }
            const val = p[col.key];
            return escapeCsvCell(val, col.isPhone);
        });
        csv += row.join(',') + '\r\n';
    });

    return csv;
}

function downloadCsvFile(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleExportAction(type) {
    closeAllDropdowns();
    let exportList = [];
    let filenameSuffix = '';

    if (type === 'selected') {
        exportList = profiles.filter(p => selectedProfileIds.has(p.id));
        if (exportList.length === 0) {
            showDialog('info', 'No Profiles Selected', 'Please select at least one profile using the checkboxes to export.');
            return;
        }
        filenameSuffix = 'selected-profiles';
    } else if (type === 'filtered') {
        exportList = getFilteredProfiles();
        if (exportList.length === 0) {
            showDialog('info', 'No Filtered Profiles', 'No profiles match the active search or filters.');
            return;
        }
        filenameSuffix = 'filtered-profiles';
    } else {
        exportList = [...profiles];
        if (exportList.length === 0) {
            showDialog('info', 'No Profiles Found', 'There are no profiles in the database to export.');
            return;
        }
        filenameSuffix = 'all-profiles';
    }

    const filename = `noor-e-nikah-${filenameSuffix}-${getTodayDate()}.csv`;
    const csvContent = generateCsvContent(exportList, true);
    downloadCsvFile(csvContent, filename);
}

function exportSingleProfile(idx) {
    const p = profiles[idx];
    if (!p) return;
    const nameStr = sanitizeFilename(p['Full Name'] || p.profileId || 'profile');
    const filename = `noor-e-nikah-profile-${nameStr}-${getTodayDate()}.csv`;
    const csvContent = generateCsvContent([p], true);
    downloadCsvFile(csvContent, filename);
}

// WhatsApp Sharing Engine
function formatSingleProfileWhatsApp(p, includeContact = false) {
    if (!p) return '';
    let msg = `🌟 NOOR-E-NIKAH MATRIMONIAL PROFILE 🌟\n\n`;
    msg += `Profile ID: ${p.profileId || '—'}\n`;
    msg += `Name: ${p['Full Name'] || '—'}\n`;
    msg += `Registering For: ${p['Registering For'] || '—'}\n`;
    msg += `Gender / Age: ${p.Gender || '—'} • ${p.Age ? p.Age + ' yrs' : '—'}\n`;
    msg += `Marital Status: ${p['Marital Status'] || '—'}\n`;
    msg += `Height: ${p.Height || '—'}\n\n`;

    msg += `🎓 EDUCATION & PROFESSION\n`;
    msg += `Education: ${p.Education || '—'}\n`;
    msg += `Occupation: ${p.Occupation || '—'}\n`;
    if (p['Salary'] || p['Salary (₹)']) {
        msg += `Salary: ${formatSalary(p['Salary'] || p['Salary (₹)'])} / month\n`;
    }
    msg += `City: ${p.City || '—'}\n`;
    if (p.State) {
        msg += `State: ${p.State}\n`;
    }
    msg += `Mother Tongue: ${p['Mother Tongue'] || '—'}\n`;
    if (p['Languages Known']) msg += `Languages: ${p['Languages Known']}\n`;
    msg += `\n`;

    msg += `🕌 RELIGIOUS & FAMILY\n`;
    msg += `Maslak: ${p.Maslak || p['Maslak / Religious Background'] || '—'}\n`;
    msg += `Surname / Biradari: ${p['Surname / Biradari'] || '—'}\n`;
    msg += `Native Place: ${p['Native Place'] || p['Family Location'] || '—'}\n`;
    msg += `Family Type: ${p['Family Type'] || '—'}\n`;
    msg += `\n`;

    msg += `🎯 MATCH PREFERENCES\n`;
    msg += `Preferred Age: ${p['Preferred Age Range'] || '—'}\n`;
    msg += `Preferred Location: ${p['Preferred Location'] || '—'}\n`;
    msg += `Preferred Education: ${p['Preferred Education'] || '—'}\n`;
    msg += `Preferred Profession: ${p['Preferred Profession'] || '—'}\n`;
    if (p['Other Preferences']) msg += `Other: ${p['Other Preferences']}\n`;
    msg += `\n`;

    if (includeContact) {
        msg += `📞 CONTACT DETAILS\n`;
        msg += `Guardian: ${p['Guardian Name'] || '—'} (${p.Relationship || '—'})\n`;
        msg += `Mobile: ${p.Mobile || '—'}\n`;
        msg += `WhatsApp: ${p.WhatsApp || '—'}\n`;
        msg += `Preferred Time: ${p['Preferred Contact Time'] || '—'}\n`;
        if (p['Email Address']) msg += `Email: ${p['Email Address']}\n`;
        if (p['Residential Address']) msg += `Address: ${p['Residential Address']}\n`;
        msg += `\n`;
    }

    msg += `Shared via Noor-E-Nikah Matrimonial Services`;
    return msg;
}

function formatMultiProfileWhatsApp(profileList, includeContact = false) {
    let msg = `🌟 NOOR-E-NIKAH MATRIMONIAL PROFILES 🌟\n\n`;
    msg += `Total Profiles: ${profileList.length}\n\n`;
    msg += `Summary List:\n`;
    profileList.slice(0, 10).forEach((p, idx) => {
        msg += `${idx + 1}. ${p['Full Name'] || 'Candidate'} — ${p.Gender || '—'}, ${p.Age ? p.Age + ' yrs' : '—'} | ${p.City || '—'} | ${p.Occupation || '—'} (ID: ${p.profileId || '—'})\n`;
    });
    if (profileList.length > 10) {
        msg += `\n... and ${profileList.length - 10} more profile(s).\n`;
    }
    msg += `\n`;
    if (includeContact) {
        msg += `ℹ️ Contact details are included in the shared export.\n`;
    } else {
        msg += `🔒 Contact details are kept private as per selection.\n`;
    }
    msg += `📎 A consolidated CSV file is attached.\n\n`;
    msg += `Shared via Noor-E-Nikah Matrimonial Services`;
    return msg;
}

function openShareSingleProfile(idx) {
    const p = profiles[idx];
    if (!p) return;
    shareModalState = {
        type: 'single',
        profiles: [p],
        includeContact: false
    };
    const toggle = document.getElementById('shareContactToggle');
    if (toggle) toggle.checked = false;

    document.getElementById('shareModalTitle').innerText = 'Share Profile on WhatsApp';
    document.getElementById('shareModalSubtitle').innerText = `${p['Full Name'] || 'Candidate'} (${p.profileId})`;
    document.getElementById('shareProfileCountBadge').innerText = '1 profile';
    document.getElementById('shareMultiNotice').classList.add('hidden');
    document.getElementById('sharePreviewText').innerText = formatSingleProfileWhatsApp(p, false);

    lockModalScroll();
    document.getElementById('shareWhatsAppModal').classList.remove('hidden');
}

function handleShareAction(type) {
    closeAllDropdowns();
    let shareList = [];

    if (type === 'selected') {
        shareList = profiles.filter(p => selectedProfileIds.has(p.id));
        if (shareList.length === 0) {
            showDialog('info', 'No Profiles Selected', 'Please select at least one profile using the checkboxes to share.');
            return;
        }
    } else if (type === 'filtered') {
        shareList = getFilteredProfiles();
        if (shareList.length === 0) {
            showDialog('info', 'No Filtered Profiles', 'No profiles match the active search or filters.');
            return;
        }
    } else {
        shareList = [...profiles];
        if (shareList.length === 0) {
            showDialog('info', 'No Profiles Found', 'There are no profiles in the database to share.');
            return;
        }
    }

    if (shareList.length === 1) {
        const globalIdx = profiles.indexOf(shareList[0]);
        openShareSingleProfile(globalIdx >= 0 ? globalIdx : 0);
        return;
    }

    shareModalState = {
        type: type,
        profiles: shareList,
        includeContact: false
    };
    const toggle = document.getElementById('shareContactToggle');
    if (toggle) toggle.checked = false;

    const label = type === 'all' ? 'All' : type === 'filtered' ? 'Filtered' : 'Selected';
    document.getElementById('shareModalTitle').innerText = `Share ${label} Profiles on WhatsApp`;
    document.getElementById('shareModalSubtitle').innerText = `Consolidated export of ${shareList.length} profiles`;
    document.getElementById('shareProfileCountBadge').innerText = `${shareList.length} profiles`;
    document.getElementById('shareMultiNotice').classList.remove('hidden');
    document.getElementById('sharePreviewText').innerText = formatMultiProfileWhatsApp(shareList, false);

    lockModalScroll();
    document.getElementById('shareWhatsAppModal').classList.remove('hidden');
}

function toggleShareContactDetails(checked) {
    shareModalState.includeContact = checked;
    if (shareModalState.type === 'single') {
        document.getElementById('sharePreviewText').innerText = formatSingleProfileWhatsApp(shareModalState.profiles[0], checked);
    } else {
        document.getElementById('sharePreviewText').innerText = formatMultiProfileWhatsApp(shareModalState.profiles, checked);
    }
}

async function executeShareWhatsApp() {
    if (!shareModalState.profiles || shareModalState.profiles.length === 0) return;

    if (shareModalState.type === 'single') {
        const text = formatSingleProfileWhatsApp(shareModalState.profiles[0], shareModalState.includeContact);
        const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
        window.open(waUrl, '_blank');
        closeShareModal();
    } else {
        const text = formatMultiProfileWhatsApp(shareModalState.profiles, shareModalState.includeContact);
        const filename = `noor-e-nikah-${shareModalState.type}-profiles-${getTodayDate()}.csv`;
        const csvContent = generateCsvContent(shareModalState.profiles, shareModalState.includeContact);

        let sharedSuccessfully = false;
        try {
            if (navigator.canShare && typeof File !== 'undefined') {
                const file = new File([csvContent], filename, { type: 'text/csv' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        title: 'Noor-E-Nikah Profiles Export',
                        text: text,
                        files: [file]
                    });
                    sharedSuccessfully = true;
                    closeShareModal();
                }
            }
        } catch (err) {
            console.log("Web Share API not completed or cancelled, using fallback", err);
        }

        if (!sharedSuccessfully) {
            downloadCsvFile(csvContent, filename);
            const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
            window.open(waUrl, '_blank');
            closeShareModal();
            showDialog('info', 'File Downloaded', `The profile export CSV file (${filename}) has been downloaded. WhatsApp is now open so you can attach the downloaded file.`);
        }
    }
}

// List View
function renderListView() {
    const filtered = getFilteredProfiles();
    
    // Header Titles
    const titles = {
        'all': {t: 'All Profiles', s: 'Manage and view all registered matrimonial profiles.'},
        'pending': {t: 'Pending Review', s: `Profiles submitted but not yet reviewed. (${filtered.length} pending)`},
        'shortlisted': {t: 'Shortlisted Profiles', s: 'Profiles selected for possible matchmaking consideration.'},
        'contacted': {t: 'Contacted Profiles', s: 'Profiles where the family/candidate has already been contacted.'},
        'followup': {t: 'Follow Up', s: 'Profiles requiring follow-up communication.'},
        'notes': {t: 'Profile Notes', s: 'Internal administrative notes on profiles.'}
    };
    if (titles[listType]) {
        document.getElementById('listTitle').innerText = titles[listType].t;
        document.getElementById('listSubtitle').innerText = titles[listType].s;
    }

    // Filter Chips Render
    let chipsHTML = '';
    for(let k in activeFilters) {
        if(activeFilters[k] && activeFilters[k] !== 'All') {
            chipsHTML += `<span class="px-3 py-1.5 bg-white border border-gold/30 text-wine rounded-full text-[11px] font-bold uppercase shadow-sm">${k}: ${activeFilters[k]}</span>`;
        }
    }
    const chipsContainer = document.getElementById('activeFiltersContainer');
    if (chipsContainer) {
        if(chipsHTML) {
            chipsContainer.innerHTML = chipsHTML + '<button onclick="clearFilters()" class="text-[12px] font-bold text-wine/60 underline ml-2 hover:text-wine p-2">Clear All</button>';
            chipsContainer.classList.remove('hidden');
        } else {
            chipsContainer.classList.add('hidden');
        }
    }

    const tbody = document.getElementById('listTableBody');
    const thead = document.getElementById('listTableHeader');
    const mobCont = document.getElementById('listMobileCards');
    const paginationEl = document.getElementById('listPagination');
    
    // Pagination calculations
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pagedProfiles = filtered.slice(startIdx, startIdx + PAGE_SIZE);

    // Update selection counters & toolbars
    updateSelectionUI(filtered, pagedProfiles);

    if (filtered.length === 0) {
        if(thead) thead.innerHTML = '<tr><th class="p-4">Profiles</th></tr>';
        if(tbody) tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-wine/50 text-sm italic">No profiles found for this view.</td></tr>';
        if(mobCont) mobCont.innerHTML = '<div class="p-8 text-center text-wine/50 text-sm italic">No profiles found for this view.</div>';
        if(paginationEl) paginationEl.classList.add('hidden');
        return;
    }

    // Render pagination controls
    if (paginationEl) {
        paginationEl.classList.remove('hidden');
        paginationEl.innerHTML = `
            <div class="text-xs text-wine/70">
                Showing <span class="font-bold text-wine">${startIdx + 1}</span> to <span class="font-bold text-wine">${Math.min(startIdx + PAGE_SIZE, filtered.length)}</span> of <span class="font-bold text-wine">${filtered.length}</span> profiles
            </div>
            <div class="flex items-center gap-1.5">
                <button onclick="changePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} class="px-3 py-1.5 border border-gold/20 rounded-lg text-xs font-medium text-wine hover:bg-[#FAF8F5] transition disabled:opacity-30 disabled:cursor-not-allowed">Previous</button>
                <span class="px-2 text-xs font-semibold text-wine">Page ${currentPage} of ${totalPages}</span>
                <button onclick="changePage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} class="px-3 py-1.5 border border-gold/20 rounded-lg text-xs font-medium text-wine hover:bg-[#FAF8F5] transition disabled:opacity-30 disabled:cursor-not-allowed">Next</button>
            </div>
        `;
    }

    const renderTableAndCards = (profilesArray, columnsHtml, desktopRowFn, mobileCardFn) => {
        if(thead) thead.innerHTML = `<tr>${columnsHtml}</tr>`;
        if(tbody) tbody.innerHTML = profilesArray.map(p => desktopRowFn(p, profiles.indexOf(p))).join('');
        if(mobCont) mobCont.innerHTML = profilesArray.map(p => mobileCardFn(p, profiles.indexOf(p))).join('');
    };

    if (listType === 'followup') {
        const today = new Date().setHours(0,0,0,0);
        const overdue = [], due = [], upcoming = [];

        pagedProfiles.forEach(p => {
            if(!p.followUpDate) return overdue.push(p);
            let d = new Date(p.followUpDate).setHours(0,0,0,0);
            if(d < today) overdue.push(p);
            else if(d === today) due.push(p);
            else upcoming.push(p);
        });
        
        const cols = `<th class="p-4 w-12 text-center"><input type="checkbox" id="selectAllHeaderCheckbox" onchange="toggleSelectPage(this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer"></th><th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Contact</th><th class="p-4">Follow-up Info</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        const deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition ${selectedProfileIds.has(p.id) ? 'bg-[#FAF8F5]' : ''}">
                <td class="p-4 text-center">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="profile-checkbox w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                </td>
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Mobile|| '—'}</td>
                <td class="p-4 text-[12px]"><p class="font-bold">${p.followUpDate|| '—'} ${p.followUpTime||''}</p><p class="text-wine/60 truncate max-w-xs">${p.followUpNote||''}</p></td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition">View</button>
                    <button onclick="exportSingleProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition inline-flex items-center gap-1" title="Download CSV">
                        <svg class="w-3 h-3 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="px-2.5 py-1.5 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg text-[10px] uppercase font-bold text-[#1E7E34] hover:bg-[#25D366]/20 transition inline-flex items-center gap-1" title="Share WhatsApp">
                        <svg class="w-3 h-3 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="changeStatus(${idx},'Contacted')" class="px-2.5 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Complete</button>
                    <button onclick="openFollowUp(${idx})" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Reschedule</button>
                    <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </td>
            </tr>`;
        
        const mobCard = (p, idx) => `
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gold/20 flex flex-col gap-3 ${selectedProfileIds.has(p.id) ? 'ring-2 ring-wine/20 bg-[#FAF8F5]/40' : ''}">
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                        <div>
                            <h4 class="font-serif font-bold text-wine text-[18px] leading-tight">${p['Full Name']|| '—'}</h4>
                            <p class="text-[11px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                        </div>
                    </div>
                    ${getStatusBadge(p)}
                </div>
                <div class="bg-purple-50/50 p-3 rounded-xl border border-purple-100 text-[13px]">
                    <div class="font-bold text-wine mb-1">${p.followUpDate|| '—'} ${p.followUpTime||''}</div>
                    <div class="text-wine/70 leading-snug">${p.followUpNote||'No note provided.'}</div>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <button onclick="viewProfile(${idx})" class="py-3 bg-white border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm">View Profile</button>
                    <button onclick="changeStatus(${idx},'Contacted')" class="py-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-[12px] uppercase font-bold shadow-sm">Complete</button>
                    <button onclick="exportSingleProfile(${idx})" class="py-2.5 bg-white border border-gold/30 rounded-xl text-[11px] uppercase font-bold text-wine shadow-sm flex items-center justify-center gap-1.5 hover:border-gold transition">
                        <svg class="w-3.5 h-3.5 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>Download CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="py-2.5 bg-[#25D366]/10 border border-[#25D366]/30 text-[#1E7E34] rounded-xl text-[11px] uppercase font-bold shadow-sm flex items-center justify-center gap-1.5 hover:bg-[#25D366]/20 transition">
                        <svg class="w-3.5 h-3.5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share WhatsApp</span>
                    </button>
                    <button onclick="openFollowUp(${idx})" class="col-span-2 py-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1">Reschedule</button>
                    <button onclick="openDeleteQueryModal(${idx})" class="col-span-2 py-2.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-xl text-[12px] uppercase font-bold shadow-sm flex items-center justify-center gap-1.5 mt-1 active:scale-[0.98] transition">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete Query</span>
                    </button>
                </div>
            </div>`;

        if(thead) thead.innerHTML = `<tr>${cols}</tr>`;
        
        let deskHtml = '', mobHtml = '';
        if(overdue.length) {
            deskHtml += `<tr><td colspan="7" class="p-3 bg-red-50 text-red-800 font-bold text-xs uppercase tracking-wider">Overdue</td></tr>`;
            deskHtml += overdue.map(p => deskRow(p, profiles.indexOf(p))).join('');
            mobHtml += `<div class="px-2 py-1 text-red-800 font-bold text-xs uppercase tracking-wider">Overdue</div>`;
            mobHtml += overdue.map(p => mobCard(p, profiles.indexOf(p))).join('');
        }
        if(due.length) {
            deskHtml += `<tr><td colspan="7" class="p-3 bg-blue-50 text-blue-800 font-bold text-xs uppercase tracking-wider">Due Today</td></tr>`;
            deskHtml += due.map(p => deskRow(p, profiles.indexOf(p))).join('');
            mobHtml += `<div class="px-2 py-1 text-blue-800 font-bold text-xs uppercase tracking-wider mt-4">Due Today</div>`;
            mobHtml += due.map(p => mobCard(p, profiles.indexOf(p))).join('');
        }
        if(upcoming.length) {
            deskHtml += `<tr><td colspan="7" class="p-3 bg-gray-50 text-gray-800 font-bold text-xs uppercase tracking-wider">Upcoming</td></tr>`;
            deskHtml += upcoming.map(p => deskRow(p, profiles.indexOf(p))).join('');
            mobHtml += `<div class="px-2 py-1 text-gray-600 font-bold text-xs uppercase tracking-wider mt-4">Upcoming</div>`;
            mobHtml += upcoming.map(p => mobCard(p, profiles.indexOf(p))).join('');
        }
        if(tbody) tbody.innerHTML = deskHtml;
        if(mobCont) mobCont.innerHTML = mobHtml;
        return;
    }

    let cols = '', deskRow = null, mobCard = null;
    
    // Generic Mobile Card builder to reduce duplication
    const buildMobCard = (p, idx, fieldsHtml, actionsHtml) => `
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gold/20 flex flex-col gap-3 relative overflow-hidden ${selectedProfileIds.has(p.id) ? 'ring-2 ring-wine/20 bg-[#FAF8F5]/40' : ''}">
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                    <div>
                        <h4 class="font-serif font-bold text-wine text-[18px] leading-tight pr-2">${p['Full Name']|| '—'}</h4>
                        <p class="text-[11px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                    </div>
                </div>
                ${getStatusBadge(p)}
            </div>
            <div class="grid grid-cols-2 gap-x-2 gap-y-3 text-[13px] text-wine/80 mt-1">
                ${fieldsHtml}
            </div>
            <div class="grid grid-cols-2 gap-2 mt-3 pt-4 border-t border-gold/10">
                <button onclick="viewProfile(${idx})" class="py-3 bg-[#FAF8F5] border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm active:scale-[0.98] transition-transform">View Details</button>
                ${actionsHtml}
                <button onclick="exportSingleProfile(${idx})" class="py-2.5 bg-white border border-gold/30 rounded-xl text-[11px] uppercase font-bold text-wine shadow-sm flex items-center justify-center gap-1.5 hover:border-gold transition">
                    <svg class="w-3.5 h-3.5 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    <span>Download CSV</span>
                </button>
                <button onclick="openShareSingleProfile(${idx})" class="py-2.5 bg-[#25D366]/10 border border-[#25D366]/30 text-[#1E7E34] rounded-xl text-[11px] uppercase font-bold shadow-sm flex items-center justify-center gap-1.5 hover:bg-[#25D366]/20 transition">
                    <svg class="w-3.5 h-3.5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                    <span>Share WhatsApp</span>
                </button>
                <button onclick="openDeleteQueryModal(${idx})" class="col-span-2 py-2.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-xl text-[12px] uppercase font-bold shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    <span>Delete Query</span>
                </button>
            </div>
        </div>
    `;

    if (listType === 'pending') {
        cols = `<th class="p-4 w-12 text-center"><input type="checkbox" id="selectAllHeaderCheckbox" onchange="toggleSelectPage(this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer"></th><th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">City</th><th class="p-4">Reg Date</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition ${selectedProfileIds.has(p.id) ? 'bg-[#FAF8F5]' : ''}">
                <td class="p-4 text-center">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="profile-checkbox w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                </td>
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']|| '—'}${p.Occupation ? ' • ' + p.Occupation : ''}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender|| '—'} / ${p.Age|| '—'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</td>
                <td class="p-4 text-[12px] text-wine/80">${p.createdAt.split('T')[0]}</td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View Details</button>
                    <button onclick="exportSingleProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition inline-flex items-center gap-1" title="Download CSV">
                        <svg class="w-3 h-3 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="px-2.5 py-1.5 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg text-[10px] uppercase font-bold text-[#1E7E34] hover:bg-[#25D366]/20 transition inline-flex items-center gap-1" title="Share WhatsApp">
                        <svg class="w-3 h-3 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="changeStatus(${idx},'Reviewed')" class="px-2.5 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Review</button>
                    <button onclick="changeStatus(${idx},'Shortlisted')" class="px-2.5 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Shortlist</button>
                    <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender|| '—'} • ${p.Age|| '—'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Profession / Salary</span>${p.Occupation || '—'}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Registered</span>${p.createdAt.split('T')[0]}</div>`,
            `<button onclick="changeStatus(${idx},'Reviewed')" class="py-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-[12px] uppercase font-bold shadow-sm active:scale-[0.98]">Review</button>
             <button onclick="changeStatus(${idx},'Shortlisted')" class="col-span-2 py-3 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1 active:scale-[0.98]">Shortlist</button>`
        );
    } 
    else if (listType === 'shortlisted') {
        cols = `<th class="p-4 w-12 text-center"><input type="checkbox" id="selectAllHeaderCheckbox" onchange="toggleSelectPage(this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer"></th><th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">City</th><th class="p-4">Surname / Maslak</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition ${selectedProfileIds.has(p.id) ? 'bg-[#FAF8F5]' : ''}">
                <td class="p-4 text-center">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="profile-checkbox w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                </td>
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']|| '—'}${p.Occupation ? ' • ' + p.Occupation : ''}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender|| '—'} / ${p.Age|| '—'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</td>
                <td class="p-4 text-[12px] text-wine/80"><p>${p['Surname / Biradari']|| '—'}</p><p class="text-[10px] text-wine/50">${p['Maslak']|| '—'}</p></td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="exportSingleProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition inline-flex items-center gap-1" title="Download CSV">
                        <svg class="w-3 h-3 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="px-2.5 py-1.5 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg text-[10px] uppercase font-bold text-[#1E7E34] hover:bg-[#25D366]/20 transition inline-flex items-center gap-1" title="Share WhatsApp">
                        <svg class="w-3 h-3 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="changeStatus(${idx},'Contacted')" class="px-2.5 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Contacted</button>
                    <button onclick="changeStatus(${idx},'Reviewed')" class="px-2.5 py-1.5 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Remove</button>
                    <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender|| '—'} • ${p.Age|| '—'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Profession / Salary</span>${p.Occupation || '—'}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Background</span>${p['Surname / Biradari']|| '—'} • ${p['Maslak']|| '—'}</div>`,
            `<button onclick="changeStatus(${idx},'Contacted')" class="py-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl text-[12px] uppercase font-bold shadow-sm">Contacted</button>
             <button onclick="changeStatus(${idx},'Reviewed')" class="col-span-2 py-3 bg-gray-50 border border-gray-200 text-gray-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1">Remove from Shortlist</button>`
        );
    }
    else if (listType === 'contacted') {
        cols = `<th class="p-4 w-12 text-center"><input type="checkbox" id="selectAllHeaderCheckbox" onchange="toggleSelectPage(this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer"></th><th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">City</th><th class="p-4">Contact</th><th class="p-4">Contacted Date</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition ${selectedProfileIds.has(p.id) ? 'bg-[#FAF8F5]' : ''}">
                <td class="p-4 text-center">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="profile-checkbox w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                </td>
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']|| '—'}${p.Occupation ? ' • ' + p.Occupation : ''}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender|| '—'} / ${p.Age|| '—'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.Mobile|| '—'}</td>
                <td class="p-4 text-[12px] text-wine/80">${p.contactedAt ? p.contactedAt.split('T')[0] : '—'}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="exportSingleProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition inline-flex items-center gap-1" title="Download CSV">
                        <svg class="w-3 h-3 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="px-2.5 py-1.5 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg text-[10px] uppercase font-bold text-[#1E7E34] hover:bg-[#25D366]/20 transition inline-flex items-center gap-1" title="Share WhatsApp">
                        <svg class="w-3 h-3 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="openFollowUp(${idx})" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Set Follow Up</button>
                    <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender|| '—'} • ${p.Age|| '—'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Profession / Salary</span>${p.Occupation || '—'}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Contact</span>${p.Mobile|| '—'}</div>`,
            `<button onclick="openFollowUp(${idx})" class="py-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl text-[12px] uppercase font-bold shadow-sm">Follow Up</button>
             <button onclick="changeStatus(${idx},'Closed')" class="col-span-2 py-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1">Close Profile</button>`
        );
    }
    else if (listType === 'notes') {
        cols = `<th class="p-4 w-12 text-center"><input type="checkbox" id="selectAllHeaderCheckbox" onchange="toggleSelectPage(this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer"></th><th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Latest Note</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition ${selectedProfileIds.has(p.id) ? 'bg-[#FAF8F5]' : ''}">
                <td class="p-4 text-center">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="profile-checkbox w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                </td>
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p></td>
                <td class="p-4 text-[13px] text-wine/80 italic break-words max-w-sm">${p.notes.length ? p.notes[p.notes.length-1].text : '—'}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View Notes</button>
                    <button onclick="exportSingleProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition inline-flex items-center gap-1" title="Download CSV">
                        <svg class="w-3 h-3 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="px-2.5 py-1.5 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg text-[10px] uppercase font-bold text-[#1E7E34] hover:bg-[#25D366]/20 transition inline-flex items-center gap-1" title="Share WhatsApp">
                        <svg class="w-3 h-3 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </td>
            </tr>`;
        mobCard = (p, idx) => `
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gold/20 flex flex-col gap-3 ${selectedProfileIds.has(p.id) ? 'ring-2 ring-wine/20 bg-[#FAF8F5]/40' : ''}">
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                        <div>
                            <h4 class="font-serif font-bold text-wine text-[18px] leading-tight">${p['Full Name']|| '—'}</h4>
                            <p class="text-[11px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                        </div>
                    </div>
                </div>
                <div class="bg-yellow-50/50 p-4 rounded-xl border border-yellow-100/50 text-[14px] italic text-wine/80">
                    "${p.notes.length ? p.notes[p.notes.length-1].text : '—'}"
                </div>
                <div class="grid grid-cols-2 gap-2 mt-1">
                    <button onclick="viewProfile(${idx})" class="py-3 bg-[#FAF8F5] border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm">Open Profile</button>
                    <button onclick="exportSingleProfile(${idx})" class="py-2.5 bg-white border border-gold/30 rounded-xl text-[11px] uppercase font-bold text-wine shadow-sm flex items-center justify-center gap-1.5 hover:border-gold transition">
                        <svg class="w-3.5 h-3.5 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="py-2.5 bg-[#25D366]/10 border border-[#25D366]/30 text-[#1E7E34] rounded-xl text-[11px] uppercase font-bold shadow-sm flex items-center justify-center gap-1.5 hover:bg-[#25D366]/20 transition">
                        <svg class="w-3.5 h-3.5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="openDeleteQueryModal(${idx})" class="col-span-2 py-3 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-xl text-[12px] uppercase font-bold shadow-sm flex items-center justify-center gap-1.5">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </div>
            </div>`;
    }
    else {
        cols = `<th class="p-4 w-12 text-center"><input type="checkbox" id="selectAllHeaderCheckbox" onchange="toggleSelectPage(this.checked)" class="w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer"></th><th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">Location & Comm</th><th class="p-4">Contact</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition ${selectedProfileIds.has(p.id) ? 'bg-[#FAF8F5]' : ''}">
                <td class="p-4 text-center">
                    <input type="checkbox" ${selectedProfileIds.has(p.id) ? 'checked' : ''} onchange="toggleProfileSelection('${p.id}', this.checked)" class="profile-checkbox w-4 h-4 rounded border-gold/40 text-wine focus:ring-wine/20 cursor-pointer">
                </td>
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']|| '—'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']|| '—'}${p.Occupation ? ' • ' + p.Occupation : ''}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender|| '—'} / ${p.Age|| '—'}</td>
                <td class="p-4 text-[12px] text-wine/80"><p>${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</p><p class="text-[10px] text-wine/50">${p['Surname / Biradari']|| '—'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Mobile|| '—'}</td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1.5 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="exportSingleProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm hover:border-gold transition inline-flex items-center gap-1" title="Download CSV">
                        <svg class="w-3 h-3 text-wine/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>CSV</span>
                    </button>
                    <button onclick="openShareSingleProfile(${idx})" class="px-2.5 py-1.5 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg text-[10px] uppercase font-bold text-[#1E7E34] hover:bg-[#25D366]/20 transition inline-flex items-center gap-1" title="Share WhatsApp">
                        <svg class="w-3 h-3 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                        <span>Share</span>
                    </button>
                    <button onclick="promptStatus()" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">Status</button>
                    <button onclick="openDeleteQueryModal(${idx})" class="px-2.5 py-1.5 bg-red-50 border border-red-200/70 text-[#C9436B] hover:bg-red-100 rounded-lg text-[10px] uppercase font-bold shadow-sm transition inline-flex items-center gap-1" title="Delete Query">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        <span>Delete</span>
                    </button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender|| '—'} • ${p.Age|| '—'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City ? (p.State ? `${p.City}, ${p.State}` : p.City) : (p.State || '—')}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Profession / Salary</span>${p.Occupation || '—'}${p.Salary ? ' • ' + formatSalary(p.Salary) : ''}</div>`,
            `<button onclick="activeProfileIndex=${idx}; promptStatus()" class="py-3 bg-[#FAF8F5] border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm">Change Status</button>`
        );
    }
    
    renderTableAndCards(pagedProfiles, cols, deskRow, mobCard);
}

async function changeStatus(idx, st, reRenderModal = false) {
    const p = profiles[idx];
    const nowStr = new Date().toISOString();
    
    let updateData = { status: st, updated_at: nowStr };
    if(st === 'Contacted' && !p.contactedAt) updateData.contacted_at = nowStr;
    if(st === 'Closed' && !p.closedAt) updateData.closed_at = nowStr;
    
    try {
        const { error } = await window.supabaseClient.from('profiles').update(updateData).eq('id', p.id);
        if (error) throw error;
        
        p.status = st;
        p.updatedAt = nowStr;
        if(updateData.contacted_at) p.contactedAt = nowStr;
        if(updateData.closed_at) p.closedAt = nowStr;
        
        updateSidebarBadges();
        renderListView();
        if (currentView === 'dashboard') initDashboard();
        if (reRenderModal) renderProfileModal();
    } catch(err) {
        console.error(err);
        showDialog('info', 'Error', 'Failed to update status.');
    }
}

function promptStatus() {
    const opts = ['New', 'Reviewed', 'Shortlisted', 'Contacted', 'Follow Up', 'Closed'];

// Supabase Data Mapping


    showDialog('info', 'Change Status', 'Select new status for this profile:', (val) => {
        changeStatus(activeProfileIndex, val, true);
    }, true, 'select', opts);
}

function openFollowUp(idx) {
    document.getElementById('fuIndex').value = idx;
    document.getElementById('fuDate').value = profiles[idx].followUpDate || '';
    document.getElementById('fuNote').value = profiles[idx].followUpNote || '';
    
    document.getElementById('followUpModal').classList.remove('hidden');
}

async function saveFollowUp() {
    const idx = document.getElementById('fuIndex').value;
    const d = document.getElementById('fuDate').value;
    if(!d) return showDialog('warning', 'Error', 'Date is required');
    
    const p = profiles[idx];
    const n = document.getElementById('fuNote').value;
    const nowStr = new Date().toISOString();
    
    const updateData = {
        follow_up_date: d,
        follow_up_note: n,
        status: 'Follow Up',
        updated_at: nowStr
    };
    
    try {
        const { error } = await window.supabaseClient.from('profiles').update(updateData).eq('id', p.id);
        if (error) throw error;
        
        p.followUpDate = d;
        p.followUpNote = n;
        p.status = 'Follow Up';
        p.updatedAt = nowStr;
        
        updateSidebarBadges();
        document.getElementById('followUpModal').classList.add('hidden');
        renderListView();
        if(currentView === 'dashboard') initDashboard();
        
        if(activeProfileIndex == idx && !document.getElementById('profileModal').classList.contains('hidden')){
            renderProfileModal();
        }
    } catch(err) {
        console.error(err);
        showDialog('info', 'Error', 'Failed to save follow-up.');
    }
}

// ==========================================
// Delete Enquiry / Query Modal & Functionality
// ==========================================
let deleteCandidateIndex = null;
let isDeletingQuery = false;

function showAdminNotification(message, type = 'success') {
    const existing = document.getElementById('adminNotificationToast');
    if (existing) existing.remove();

    const isSuccess = type === 'success';
    const isWarning = type === 'warning';
    
    let bg = 'bg-[#320A16] text-[#D4AF37] border-gold/40';
    let icon = `<svg class="w-5 h-5 text-gold flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;

    if (isWarning) {
        bg = 'bg-[#422006] text-[#FDE68A] border-amber-500/50';
        icon = `<svg class="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
    } else if (type === 'error') {
        bg = 'bg-red-900 text-white border-red-500';
        icon = `<svg class="w-5 h-5 text-red-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
    }

    const toast = document.createElement('div');
    toast.id = 'adminNotificationToast';
    toast.className = `fixed bottom-6 right-6 z-[300] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border ${bg} text-sm font-medium animate-slide-up transition-all duration-300 max-w-md`;
    toast.innerHTML = `${icon}<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast && toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

function openDeleteQueryModal(idx) {
    if (idx === null || idx === undefined || !profiles[idx]) return;
    deleteCandidateIndex = idx;
    
    const p = profiles[idx];
    const nameEl = document.getElementById('deleteModalTargetName');
    const idEl = document.getElementById('deleteModalTargetId');
    const errEl = document.getElementById('deleteModalError');
    const spinner = document.getElementById('deleteBtnSpinner');
    const btnText = document.getElementById('deleteBtnText');
    const confirmBtn = document.getElementById('deleteModalConfirmBtn');
    const cancelBtn = document.getElementById('deleteModalCancelBtn');
    
    if (nameEl) nameEl.textContent = p['Full Name'] || 'Candidate / Query';
    if (idEl) idEl.textContent = p.profileId || p.id || '';
    if (errEl) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
    }
    if (spinner) spinner.classList.add('hidden');
    if (btnText) btnText.textContent = 'Yes, Delete';
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    isDeletingQuery = false;

    lockModalScroll();
    const modal = document.getElementById('deleteQueryModal');
    if (modal) modal.classList.remove('hidden');
}

function closeDeleteQueryModal() {
    if (isDeletingQuery) return; // Prevent closing during active deletion
    const modal = document.getElementById('deleteQueryModal');
    if (modal) modal.classList.add('hidden');
    deleteCandidateIndex = null;
    unlockModalScroll();
}

async function executeDeleteQuery() {
    if (deleteCandidateIndex === null || !profiles[deleteCandidateIndex]) {
        closeDeleteQueryModal();
        return;
    }
    if (isDeletingQuery) return; // Prevent concurrent requests

    isDeletingQuery = true;
    const confirmBtn = document.getElementById('deleteModalConfirmBtn');
    const cancelBtn = document.getElementById('deleteModalCancelBtn');
    const spinner = document.getElementById('deleteBtnSpinner');
    const btnText = document.getElementById('deleteBtnText');
    const errEl = document.getElementById('deleteModalError');

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Deleting...';
    if (errEl) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
    }

    const target = profiles[deleteCandidateIndex];
    const targetId = target.id;
    const targetIdx = deleteCandidateIndex;

    try {
        console.log(`[Admin] Initiating permanent deletion of query ID: ${targetId} (${target.profileId || ''})`);
        
        // 1. Delete record from Supabase public.profiles (Strict Admin Delete RLS enforced on exact primary key UUID)
        const { error, count } = await window.supabaseClient
            .from('profiles')
            .delete({ count: 'exact' })
            .eq('id', targetId);

        if (error) {
            throw error;
        }

        // Verify that the database confirms deletion of the record
        if (count === 0 || count === null) {
            throw new Error('Zero records deleted. You may lack permission, or the record was already removed.');
        }

        console.log(`[Admin] Query ${targetId} permanently deleted from database. Verified count: ${count}`);

        // 2. Storage photo cleanup: delete only this customer's photo file from 'profile-photos' bucket
        let photoCleanupFailed = false;
        let photoCleanupErrorMsg = '';

        if (target.photoUrl && typeof target.photoUrl === 'string') {
            let photoPath = target.photoUrl.trim();
            if (photoPath.includes('profile-photos/')) {
                photoPath = photoPath.split('profile-photos/')[1];
            }
            if (photoPath.includes('?')) {
                photoPath = photoPath.split('?')[0];
            }

            // Path safety check: ensure non-empty relative path, strictly within profile-photos
            if (photoPath && photoPath !== '/' && !photoPath.startsWith('/') && !photoPath.includes('..')) {
                try {
                    console.log(`[Admin] Deleting associated photo from 'profile-photos' bucket: ${photoPath}`);
                    const { data: photoData, error: photoErr } = await window.supabaseClient.storage
                        .from('profile-photos')
                        .remove([photoPath]);

                    if (photoErr) {
                        photoCleanupFailed = true;
                        photoCleanupErrorMsg = photoErr.message || 'Storage service error';
                        console.error('[Admin] Storage photo removal failed:', photoErr);
                    } else {
                        console.log('[Admin] Photo deleted successfully from storage:', photoPath, photoData);
                    }
                } catch(pErr) {
                    photoCleanupFailed = true;
                    photoCleanupErrorMsg = pErr.message || 'Storage exception';
                    console.error('[Admin] Storage photo removal exception:', pErr);
                }
            }
        }

        // 3. Remove from local memory state & update UI without page reload
        profiles.splice(targetIdx, 1);

        // If detail modal was open for this record, close it
        if (activeProfileIndex === targetIdx) {
            closeModal();
        } else if (activeProfileIndex > targetIdx) {
            activeProfileIndex--;
        }

        // Reset state and close confirmation popup
        isDeletingQuery = false;
        closeDeleteQueryModal();

        // Refresh UI views and badge counts
        updateSidebarBadges();
        renderListView();
        if (currentView === 'dashboard') {
            initDashboard();
        }

        // 4. Show success or partial-cleanup warning message
        if (photoCleanupFailed) {
            showAdminNotification(
                `Query deleted from database, but photo cleanup failed (${photoCleanupErrorMsg}). Please check storage.`,
                'warning'
            );
        } else {
            showAdminNotification('Query Deleted Successfully', 'success');
        }

    } catch (err) {
        console.error('[Admin] Delete query failed:', err);

        // Reset button states so admin can retry or cancel
        isDeletingQuery = false;
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (btnText) btnText.textContent = 'Yes, Delete';

        // Display required error message in modal & toast; preserve enquiry in UI
        const errorMsg = 'Unable to Delete Query. Please try again or contact the system administrator.';
        if (errEl) {
            errEl.textContent = errorMsg;
            errEl.classList.remove('hidden');
        }
        showAdminNotification(errorMsg, 'error');
    }
}

function initDeleteQueryModalListeners() {
    const cancelBtn = document.getElementById('deleteModalCancelBtn');
    const closeX = document.getElementById('deleteModalCloseX');
    const backdrop = document.getElementById('deleteQueryBackdrop');
    const confirmBtn = document.getElementById('deleteModalConfirmBtn');
    const modal = document.getElementById('deleteQueryModal');

    if (cancelBtn) cancelBtn.addEventListener('click', closeDeleteQueryModal);
    if (closeX) closeX.addEventListener('click', closeDeleteQueryModal);
    if (backdrop) backdrop.addEventListener('click', closeDeleteQueryModal);
    if (confirmBtn) confirmBtn.addEventListener('click', executeDeleteQuery);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target === backdrop) {
                closeDeleteQueryModal();
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // 1. Close any open dropdowns
            closeAllDropdowns();

            // 2. Close temp dialog if active
            const tempDialog = document.getElementById('tempDialog');
            if (tempDialog) {
                closeTempDialog();
                return;
            }

            // 3. Close delete query confirmation modal
            const delModal = document.getElementById('deleteQueryModal');
            if (delModal && !delModal.classList.contains('hidden')) {
                closeDeleteQueryModal();
                return;
            }

            // 4. Close WhatsApp sharing modal
            const shareModal = document.getElementById('shareWhatsAppModal');
            if (shareModal && !shareModal.classList.contains('hidden')) {
                closeShareModal();
                return;
            }

            // 5. Close follow up modal
            const fuModal = document.getElementById('followUpModal');
            if (fuModal && !fuModal.classList.contains('hidden')) {
                closeFollowUpModal();
                return;
            }

            // 6. Close filter modal
            const fltModal = document.getElementById('filterModal');
            if (fltModal && !fltModal.classList.contains('hidden')) {
                closeFilterModal();
                return;
            }

            // 7. Close profile detail modal
            const profModal = document.getElementById('profileModal');
            if (profModal && !profModal.classList.contains('hidden')) {
                closeModal();
                return;
            }
        }
    });
}

// Global confirmDelete alias for backward compatibility
function confirmDelete(idx) {
    openDeleteQueryModal(idx);
}

// Profile Modal (View/Edit)
const pFields = [
    {group: 'BASIC', f: ['Full Name', 'Registering For', 'Gender', 'Age', 'Date of Birth', 'Marital Status', 'Height']},
    {group: 'PROFESSIONAL', f: ['Education', 'Occupation', 'Salary (₹)', 'City', 'State', 'Mother Tongue', 'Languages Known']},
    {group: 'FAMILY & RELIGIOUS', f: ['Surname / Biradari', "Father's Occupation", "Mother's Occupation", 'Brothers', 'Sisters', 'Native Place', 'Family Type', 'Maslak', 'Religious Preference']},
    {group: 'ABOUT CANDIDATE', f: ['About Candidate']},
    {group: 'MATCH PREFERENCES', f: ['Preferred Age Range', 'Preferred Location', 'Preferred Education', 'Preferred Profession', 'Other Preferences']},
    {group: 'CONTACT', f: ['Guardian Name', 'Relationship', 'Mobile', 'WhatsApp', 'Preferred Contact Time', 'Residential Address', 'Email Address']}
];

// Supabase Data Mapping



function viewProfile(idx) {
    activeProfileIndex = idx;
    isEditMode = false;
    lockModalScroll();
    document.getElementById('profileModal').classList.remove('hidden');
    renderProfileModal();
}
function closeModal() {
    document.getElementById('profileModal').classList.add('hidden');
    unlockModalScroll();
}

function renderProfileModal() {
    const p = profiles[activeProfileIndex];
    if (!p) return;

// Supabase Data Mapping


    let html = '';
    
    // Header Info
    html += `
        <div class="mb-6 flex flex-wrap gap-4 md:gap-8 p-4 md:p-5 bg-[#FAF8F5] rounded-xl border border-gold/20 shadow-sm">
            <div class="w-full md:w-auto"><span class="block text-[10px] text-wine/50 font-bold uppercase tracking-wider mb-1">Profile ID</span><span class="font-serif text-xl font-semibold text-wine">${p.profileId}</span></div>
            <div class="w-1/2 md:w-auto"><span class="block text-[10px] text-wine/50 font-bold uppercase tracking-wider mb-1">Registration Date</span><span class="font-serif text-lg md:text-xl font-semibold text-wine">${p.createdAt.split('T')[0]}</span></div>
            <div class="w-1/2 md:w-auto"><span class="block text-[10px] text-wine/50 font-bold uppercase tracking-wider mb-1">Current Status</span><span class="font-serif text-lg md:text-xl font-semibold text-wine">${p.status}</span></div>
        </div>
    `;

    // Photo Section
    html += `
        <div class="mb-6 bg-white border border-gold/20 rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-center gap-6">
            <div class="w-32 h-32 flex-shrink-0 bg-[#FAF8F5] rounded-xl border border-gold/30 overflow-hidden flex items-center justify-center relative">
                <img id="modalProfilePhoto" src="" class="w-full h-full object-cover hidden" alt="Profile Photo">
                <div id="modalPhotoPlaceholder" class="text-[10px] uppercase font-bold text-wine/50 text-center px-2">Loading...</div>
            </div>
            <div class="text-center md:text-left">
                <h4 class="font-serif text-lg font-bold text-wine mb-1">Profile Photo</h4>
                <p class="text-[12px] font-medium text-wine/60" id="modalPhotoStatus">Checking secure storage...</p>
                <button id="modalPhotoViewBtn" class="mt-3 hidden px-4 py-2 bg-wine/10 text-wine rounded-lg text-[11px] font-bold uppercase transition hover:bg-wine/20">View Full Image</button>
            </div>
        </div>
    `;

    // Matchmaking Workflow Visualizer
    const stages = ['New', 'Reviewed', 'Shortlisted', 'Contacted', 'Follow Up', 'Closed'];

// Supabase Data Mapping


    const currIdx = stages.indexOf(p.status);
    html += `<div class="mb-8"><h4 class="font-serif text-sm text-wine/60 font-bold tracking-widest mb-4 uppercase border-b border-gold/20 pb-2">Matchmaking Workflow</h4>
        <div class="flex flex-col md:flex-row md:items-center overflow-x-hidden md:overflow-x-auto pb-2 gap-0 md:gap-2 pl-4 md:pl-0 border-l-2 md:border-l-0 border-gold/30 md:border-transparent ml-2 md:ml-0">`;
    stages.forEach((s, i) => {
        let active = s === p.status ? 'bg-wine text-white border-wine shadow-md' : (i < currIdx && p.status !== 'New' && p.status !== 'Closed' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-400 border-gray-200');
        
        // Vertical timeline dots on mobile
        let dot = s === p.status ? '<div class="md:hidden w-3 h-3 rounded-full bg-wine absolute -left-[23px] top-1/2 -translate-y-1/2 border-2 border-white"></div>' : '<div class="md:hidden w-3 h-3 rounded-full bg-gold/40 absolute -left-[23px] top-1/2 -translate-y-1/2 border-2 border-white"></div>';

        html += `<div class="flex items-center md:block relative mb-4 md:mb-0">`;
        html += dot;
        html += `<div class="px-4 py-3 md:py-2 rounded-xl text-[13px] md:text-[11px] font-bold uppercase tracking-wider border whitespace-nowrap transition-all w-full md:w-auto md:text-center ${active}">${s}</div>`;
        html += `</div>`;
        
        // Horizontal arrow on desktop
        if(i < stages.length - 1) {
            html += `<div class="hidden md:block text-gray-300">→</div>`;
        }
    });
    html += `</div></div>`;

    // Quick Actions
    if (!isEditMode) {
        html += `<div class="mb-8 p-4 md:p-5 bg-white border border-gold/20 rounded-xl shadow-sm"><h4 class="font-serif text-sm text-wine/60 font-bold tracking-widest mb-4 border-b border-gold/20 pb-2 uppercase">Quick Actions</h4><div class="grid grid-cols-1 sm:grid-cols-2 lg:flex gap-3">`;
        if(p.status === 'New') {
            html += `<button onclick="changeStatus(${activeProfileIndex},'Reviewed', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition shadow-sm">Mark as Reviewed</button>`;
            html += `<button onclick="changeStatus(${activeProfileIndex},'Shortlisted', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 transition shadow-sm">Shortlist</button>`;
        } else if(p.status === 'Reviewed') {
            html += `<button onclick="changeStatus(${activeProfileIndex},'Shortlisted', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 transition shadow-sm">Shortlist</button>`;
            html += `<button onclick="changeStatus(${activeProfileIndex},'Contacted', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition shadow-sm">Mark as Contacted</button>`;
        } else if(p.status === 'Shortlisted') {
            html += `<button onclick="changeStatus(${activeProfileIndex},'Contacted', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition shadow-sm">Mark as Contacted</button>`;
            html += `<button onclick="openFollowUp(${activeProfileIndex})" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition shadow-sm">Set Follow Up</button>`;
            html += `<button onclick="changeStatus(${activeProfileIndex},'Reviewed', true)" class="w-full lg:col-span-2 lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 transition shadow-sm">Remove from Shortlist</button>`;
        } else if(p.status === 'Contacted') {
            html += `<button onclick="openFollowUp(${activeProfileIndex})" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition shadow-sm">Set Follow Up</button>`;
        } else if(p.status === 'Follow Up') {
            html += `<button onclick="changeStatus(${activeProfileIndex},'Contacted', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition shadow-sm">Mark Follow-up Complete</button>`;
            html += `<button onclick="openFollowUp(${activeProfileIndex})" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition shadow-sm">Reschedule</button>`;
        } else if(p.status === 'Closed') {
            html += `<button onclick="changeStatus(${activeProfileIndex},'Reviewed', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 transition shadow-sm">Reopen Profile</button>`;
        }
        
        if (p.status !== 'Closed') {
            html += `<button onclick="changeStatus(${activeProfileIndex},'Closed', true)" class="w-full lg:w-auto px-4 py-3.5 md:py-2.5 rounded-xl md:rounded-lg text-[13px] md:text-xs font-bold uppercase bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition shadow-sm lg:ml-auto">Close Profile</button>`;
        }
        html += `</div></div>`;
    }

    // Profile Fields (1 col mobile, 3 desktop)
    pFields.forEach(g => {
        html += `<div class="mb-8"><h4 class="font-serif text-sm text-wine/60 font-bold tracking-widest mb-4 border-b border-gold/20 pb-2 uppercase">${g.group}</h4><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">`;
        g.f.forEach(f => {
            const key = f;
            const rawVal = p[key];
            const val = (rawVal !== undefined && rawVal !== null) ? String(rawVal).trim() : '';
            const safeId = 'edit_' + key.replace(/[^a-zA-Z]/g, '');
            const isFullWidth = (key === 'About Candidate' || key === 'Other Preferences');
            const colClass = isFullWidth ? 'col-span-1 md:col-span-2 lg:col-span-3' : '';
            if(isEditMode) {
                if(isFullWidth) {
                    html += `<div class="${colClass}"><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1.5">${key}</span>
                    <textarea id="${safeId}" rows="3" class="w-full bg-[#FAF8F5] px-4 md:px-3 py-3 md:py-2.5 border border-gold/30 rounded-xl text-[16px] md:text-[14px] text-wine focus:outline-none focus:border-wine/50">${val.replace(/"/g,'&quot;')}</textarea></div>`;
                } else if (key === 'Salary (₹)' || key === 'Salary') {
                    html += `<div class="${colClass}"><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1.5">${key}</span>
                    <div class="relative flex items-center">
                        <span class="absolute left-3 text-wine/60 font-semibold text-sm select-none pointer-events-none">₹</span>
                        <input type="number" min="0" step="1" id="${safeId}" value="${val.replace(/"/g,'&quot;')}" placeholder="e.g. 25000" class="w-full bg-[#FAF8F5] pl-8 pr-3 py-3 md:py-2.5 border border-gold/30 rounded-xl text-[16px] md:text-[14px] text-wine focus:outline-none focus:border-wine/50">
                    </div></div>`;
                } else {
                    html += `<div class="${colClass}"><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1.5">${key}</span>
                    <input type="text" id="${safeId}" value="${val.replace(/"/g,'&quot;')}" class="w-full bg-[#FAF8F5] px-4 md:px-3 py-3 md:py-2.5 border border-gold/30 rounded-xl text-[16px] md:text-[14px] text-wine focus:outline-none focus:border-wine/50"></div>`;
                }
            } else {
                let displayVal = val !== '' ? val : '—';
                if ((key === 'Salary (₹)' || key === 'Salary') && val !== '') {
                    displayVal = formatSalary(val) + ' / month';
                }
                html += `<div class="${colClass}"><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1">${key}</span><span class="block text-[16px] md:text-[15px] text-wine font-medium break-words ${isFullWidth ? 'whitespace-pre-line leading-relaxed' : ''}">${displayVal}</span></div>`;
            }
        });
        html += `</div></div>`;
    });
    
    // Follow-up Info Block
    if (!isEditMode && p.followUpDate) {
        html += `<div class="mb-8"><h4 class="font-serif text-sm text-wine/60 font-bold tracking-widest mb-4 border-b border-gold/20 pb-2">FOLLOW-UP INFORMATION</h4>
            <div class="bg-purple-50 border border-purple-100 rounded-xl shadow-sm p-4 md:p-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                    <div><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1">Date & Time</span><span class="block text-[16px] md:text-[14px] text-wine font-medium">${p.followUpDate} ${p.followUpTime || ''}</span></div>
                </div>
                <div><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1">Note</span><span class="block text-[16px] md:text-[14px] text-wine font-medium break-words">${p.followUpNote || '—'}</span></div>
            </div>
        </div>`;
    }

    // Admin Notes Section
    if(!isEditMode) {
        let nHtml = '<div class="p-5 text-[15px] md:text-sm text-wine/50 italic">No notes added.</div>';
        if (p.notes && p.notes.length) {
            const indexedNotes = p.notes.map((n, originalIndex) => ({ note: n, originalIndex }));
            indexedNotes.reverse();
            
            nHtml = indexedNotes.map(({ note: n, originalIndex }) => {
                const escapedText = (n.text || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                const noteDate = n.date ? new Date(n.date).toLocaleString() : 'Date N/A';
                
                return `
                <div class="p-4 md:p-5 border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <span class="block text-[10px] font-bold text-wine/40 uppercase tracking-wider mb-1.5">${noteDate}</span>
                            <div class="text-[15px] md:text-sm text-wine/80 whitespace-pre-wrap break-words leading-relaxed">${escapedText}</div>
                        </div>
                        <div class="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                            <button onclick="editNote(${originalIndex})" class="px-2.5 py-1 text-[11px] font-bold uppercase rounded-lg border border-gold/30 text-wine hover:bg-white transition shadow-sm" title="Edit Note">EDIT</button>
                            <button onclick="deleteNote(${originalIndex})" class="px-2.5 py-1 text-[11px] font-bold uppercase rounded-lg border border-red-200 text-[#C9436B] hover:bg-red-50 transition shadow-sm" title="Delete Note">DELETE</button>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
        html += `<div class="mb-8"><h4 class="font-serif text-sm text-wine/60 font-bold tracking-widest mb-4 border-b border-gold/20 pb-2">ADMIN NOTES</h4>
            <div class="bg-white border border-gold/10 rounded-xl shadow-sm overflow-hidden">${nHtml}</div>
        </div>`;
    }

    // Actions Header Configuration (Buttons in modal header)
    const actDiv = document.getElementById('modalActions');
    if(isEditMode) {
        actDiv.innerHTML = `<button onclick="isEditMode=false;renderProfileModal()" class="w-full sm:w-auto px-5 py-3.5 md:py-2.5 bg-[#FAF8F5] text-wine/60 border border-gold/20 rounded-xl md:rounded-lg text-[13px] md:text-[12px] uppercase font-bold transition hover:bg-white order-2 sm:order-1">Cancel</button><button onclick="saveProfile()" class="w-full sm:w-auto px-5 py-3.5 md:py-2.5 bg-wine text-cream rounded-xl md:rounded-lg text-[13px] md:text-[12px] uppercase font-bold shadow-md transition hover:bg-wine/90 order-1 sm:order-2">Save Changes</button>`;
    } else {
        actDiv.innerHTML = `
        <button onclick="isEditMode=true;renderProfileModal()" class="w-full sm:w-auto px-4 py-3.5 md:py-2.5 bg-[#FAF8F5] text-wine rounded-xl md:rounded-lg text-[13px] md:text-[11px] uppercase font-bold border border-gold/30 shadow-sm transition hover:bg-white">EDIT</button>
        <button onclick="promptStatus()" class="w-full sm:w-auto px-4 py-3.5 md:py-2.5 bg-wine text-cream rounded-xl md:rounded-lg text-[13px] md:text-[11px] uppercase font-bold shadow-sm transition hover:bg-wine/90">STATUS</button>
        <button onclick="promptNote()" class="col-span-2 sm:w-auto px-4 py-3.5 md:py-2.5 bg-[#FAF8F5] text-wine rounded-xl md:rounded-lg text-[13px] md:text-[11px] uppercase font-bold border border-gold/30 shadow-sm transition hover:bg-white">ADD NOTE</button>
        <button onclick="openDeleteQueryModal(activeProfileIndex)" class="w-full sm:w-auto px-4 py-3.5 md:py-2.5 bg-red-50 text-[#C9436B] hover:bg-red-100 rounded-xl md:rounded-lg text-[13px] md:text-[11px] uppercase font-bold border border-red-200/70 shadow-sm transition inline-flex items-center justify-center gap-1.5" title="Delete Query"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg><span>DELETE</span></button>
        <button onclick="closeModal()" class="hidden md:block px-4 py-2 bg-[#FAF8F5] text-wine/50 rounded-lg text-[11px] uppercase font-bold border border-gold/20 hover:bg-white transition">CLOSE</button>`;
    }
    
    document.getElementById('modalContent').innerHTML = html;
    loadModalPhoto(p);
}

async function loadModalPhoto(p) {
    const imgEl = document.getElementById('modalProfilePhoto');
    const placeholder = document.getElementById('modalPhotoPlaceholder');
    const statusText = document.getElementById('modalPhotoStatus');
    const viewBtn = document.getElementById('modalPhotoViewBtn');

    if (!imgEl) return;

    if (!p.photoUrl) {
        placeholder.textContent = 'Photo Not Available';
        statusText.textContent = 'No photo was uploaded.';
        return;
    }

    try {
        let path = p.photoUrl;
        if (path.includes('profile-photos/')) {
            path = path.split('profile-photos/')[1];
        }

        const { data, error } = await window.supabaseClient.storage.from('profile-photos').createSignedUrl(path, 3600);
        if (error) throw error;
        
        imgEl.src = data.signedUrl;
        imgEl.onload = () => {
            imgEl.classList.remove('hidden');
            placeholder.classList.add('hidden');
        };
        
        statusText.textContent = 'Securely loaded.';
        viewBtn.classList.remove('hidden');
        viewBtn.onclick = () => window.open(data.signedUrl, '_blank');
        
    } catch(err) {
        console.error("Error loading signed URL:", err);
        placeholder.textContent = 'Error Loading Photo';
        statusText.textContent = 'Failed to generate secure access token.';
    }
}

async function saveProfile() {
    const p = profiles[activeProfileIndex];
    let updateData = {};
    pFields.forEach(g => {
        g.f.forEach(f => {
            let el = document.getElementById('edit_' + f.replace(/[^a-zA-Z]/g, ''));
            if(el && fieldMapToDb[f]) {
                const val = el.value;
                p[f] = val;
                if (f === "Father's Occupation") p['Father Occupation'] = val;
                if (f === "Father Occupation") p["Father's Occupation"] = val;
                if (f === "Mother's Occupation") p['Mother Occupation'] = val;
                if (f === "Mother Occupation") p["Mother's Occupation"] = val;
                if (f === 'Maslak Preference') p['Religious Preference'] = val;
                if (f === 'Religious Preference') p['Maslak Preference'] = val;
                if (f === 'Maslak') p['Maslak / Religious Background'] = val;
                if (f === 'Maslak / Religious Background') p['Maslak'] = val;
                if (f === 'Surname / Biradari') p['Surname / Biradari'] = val;
                if (f === 'Email Address') p['Email Address'] = val;
                if (f === 'Native Place') {
                    p['Family Location'] = val;
                    updateData['native_place'] = val || null;
                    updateData['family_location'] = val || null;
                }
                if (f === 'Family Location') {
                    p['Native Place'] = val;
                    updateData['native_place'] = val || null;
                    updateData['family_location'] = val || null;
                }

                if (['Age', 'Brothers', 'Sisters'].includes(f)) {
                    const trimmed = (val || '').trim();
                    if (trimmed === '') {
                        updateData[fieldMapToDb[f]] = null;
                        p[f] = '';
                    } else {
                        const n = parseInt(trimmed, 10);
                        const validNum = (!isNaN(n) && n >= 0) ? n : null;
                        updateData[fieldMapToDb[f]] = validNum;
                        p[f] = validNum !== null ? String(validNum) : '';
                    }
                } else if (f === 'Salary (₹)' || f === 'Salary') {
                    const trimmed = (val || '').trim();
                    if (trimmed === '') {
                        updateData['salary'] = null;
                        p['Salary'] = '';
                        p['Salary (₹)'] = '';
                    } else {
                        const cleanVal = trimmed.replace(/[₹,\s]/g, '');
                        const n = parseFloat(cleanVal);
                        const validNum = (!isNaN(n) && n >= 0) ? Math.round(n * 100) / 100 : null;
                        updateData['salary'] = validNum;
                        p['Salary'] = validNum !== null ? String(validNum) : '';
                        p['Salary (₹)'] = p['Salary'];
                    }
                } else if (f === 'State') {
                    const trimmed = (val || '').trim();
                    updateData['state'] = trimmed || null;
                    p['State'] = trimmed;
                } else {
                    updateData[fieldMapToDb[f]] = val || null;
                }
            }
        });
    });
    
    const nowStr = new Date().toISOString();
    p.updatedAt = nowStr;
    updateData.updated_at = nowStr;
    
    try {
        let { error } = await window.supabaseClient.from('profiles').update(updateData).eq('id', p.id);
        if (error && error.message && error.message.includes('native_place')) {
            console.warn("Column native_place pending migration, saving to family_location:", error);
            delete updateData.native_place;
            const retryRes = await window.supabaseClient.from('profiles').update(updateData).eq('id', p.id);
            if (retryRes.error) throw retryRes.error;
        } else if (error) {
            throw error;
        }
        
        isEditMode = false;
        renderProfileModal();
        renderListView();
        showDialog('info', 'Profile Updated', 'Changes have been saved successfully.');
    } catch(err) {
        console.error(err);
        showDialog('info', 'Error', 'Failed to save changes.');
    }
}

function promptNote() {
    showDialog('info', 'Add Internal Note', 'Enter note for this profile:', async (val) => {
        const textVal = (val || '').trim();
        if(textVal) {
            const p = profiles[activeProfileIndex];
            if (!p) return;
            if (!Array.isArray(p.notes)) p.notes = [];
            const newNote = {
                id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                text: textVal,
                date: new Date().toISOString()
            };
            const nowStr = new Date().toISOString();
            
            p.notes.push(newNote);
            p.updatedAt = nowStr;
            
            try {
                const { error } = await window.supabaseClient.from('profiles').update({
                    notes: p.notes,
                    updated_at: nowStr
                }).eq('id', p.id);
                
                if (error) throw error;
                
                renderProfileModal();
                renderListView();
            } catch(err) {
                console.error(err);
                showDialog('info', 'Error', 'Failed to add note.');
                p.notes.pop();
            }
        }
    }, true, 'textarea', [], '', 'Add Note', 'Cancel');
}

function editNote(idx) {
    const p = profiles[activeProfileIndex];
    if (!p || !p.notes || !p.notes[idx]) return;
    const currentNote = p.notes[idx];
    
    showDialog('info', 'Edit Internal Note', 'Update note for this profile:', async (val) => {
        const textVal = (val || '').trim();
        if (!textVal) {
            showDialog('info', 'Validation Error', 'Note content cannot be empty.');
            return;
        }
        
        const originalText = currentNote.text;
        currentNote.text = textVal;
        const nowStr = new Date().toISOString();
        p.updatedAt = nowStr;
        
        try {
            const { error } = await window.supabaseClient.from('profiles').update({
                notes: p.notes,
                updated_at: nowStr
            }).eq('id', p.id);
            
            if (error) throw error;
            
            renderProfileModal();
            renderListView();
        } catch(err) {
            console.error(err);
            currentNote.text = originalText;
            showDialog('info', 'Error', 'Failed to update note.');
        }
    }, true, 'textarea', [], currentNote.text || '', 'Save Note', 'Cancel');
}

function deleteNote(idx) {
    const p = profiles[activeProfileIndex];
    if (!p || !p.notes || !p.notes[idx]) return;
    
    showDialog('danger', 'Delete Note', 'Are you sure you want to delete this note? This action cannot be undone.', async () => {
        const deletedNote = p.notes.splice(idx, 1)[0];
        const nowStr = new Date().toISOString();
        p.updatedAt = nowStr;
        
        try {
            const { error } = await window.supabaseClient.from('profiles').update({
                notes: p.notes,
                updated_at: nowStr
            }).eq('id', p.id);
            
            if (error) throw error;
            
            renderProfileModal();
            renderListView();
        } catch(err) {
            console.error(err);
            p.notes.splice(idx, 0, deletedNote);
            showDialog('info', 'Error', 'Failed to delete note.');
        }
    }, false, 'textarea', [], '', 'Delete', 'Cancel');
}

// Export Data - stacked buttons on mobile
function exportCSV(segment) {
    let d = profiles;
    if(segment !== 'All') {
        if(segment==='Male') d=d.filter(p=>p.Gender==='Male');
        else if(segment==='Female') d=d.filter(p=>p.Gender==='Female');
        else if(segment==='New') d=d.filter(p=>p.status==='New');
        else d=d.filter(p=>p.status===segment);
    }
    if(d.length===0) return showDialog('info','Export Failed', `No ${segment} profiles found to export.`);
    
    let headers = ['Profile ID','Status','Full Name','Gender','Age','City','State','Mobile'];

// Supabase Data Mapping


    let csv = headers.join(',') + '\n' + d.map(p=> {
        return headers.map(h => `"${(p[h]||'').replace(/"/g, '""')}"`).join(',');
    }).join('\n');
    
    let blob = new Blob([csv], {type: 'text/csv'});
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url; 
    a.download = `NoorENikah_${segment}_Export.csv`; 
    a.click();
}

async function viewSupabasePhoto(path) {
    try {
        const { data, error } = await window.supabaseClient.storage.from('profile-photos').createSignedUrl(path, 3600);
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch(err) {
        console.error(err);
        showDialog('warning', 'Error', 'Failed to load photo.');
    }
}
