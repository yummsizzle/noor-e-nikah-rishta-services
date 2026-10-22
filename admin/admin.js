console.log("[ADMIN DEBUG] admin.js loaded");
const fieldMapToDb = {
    'Registering For': 'registering_for', 'Full Name': 'full_name', 'Gender': 'gender', 'Date of Birth': 'date_of_birth',
    'Age': 'age', 'Marital Status': 'marital_status', 'Height': 'height', 'Education': 'education',
    'Occupation': 'occupation', 'City': 'city', 'Mother Tongue': 'mother_tongue', 'Languages Known': 'languages_known',
    'Father Occupation': 'father_occupation', 'Mother Occupation': 'mother_occupation', 'Brothers': 'brothers',
    'Sisters': 'sisters', 'Family Location': 'family_location', 'Family Type': 'family_type', 'Maslak': 'maslak',
    'Maslak Preference': 'maslak_preference',
    'About Candidate': 'about_candidate', 'Preferred Age Range': 'preferred_age_range', 'Preferred Location': 'preferred_location',
    'Preferred Education': 'preferred_education', 'Preferred Profession': 'preferred_profession', 'Other Preferences': 'other_preferences',
    'Guardian Name': 'guardian_name', 'Relationship': 'relationship', 'Mobile': 'mobile', 'WhatsApp': 'whatsapp',
    'Preferred Contact Time': 'preferred_contact_time', 'Photo Attached': 'photo_attached'
};
const dbMapToUI = {};
for(let k in fieldMapToDb) dbMapToUI[fieldMapToDb[k]] = k;

const STORE = 'noorEnikahSubmissions';
let profiles = [];

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
    return uiData;
}
let currentView = 'dashboard';
let listType = 'all';
let currentPage = 1;
let activeFilters = {};
let activeProfileIndex = null;
let isEditMode = false;

// Custom UI Dialog
function showDialog(type, title, message, onConfirm = null, showInput = false, inputType = 'textarea', options = []) {
    let inputHtml = '';
    if (showInput) {
        if (inputType === 'select') {
            inputHtml = `<select id="dialogInput" class="w-full bg-white border border-gold/30 p-3.5 rounded-xl mb-4 text-[16px] md:text-sm focus:outline-none focus:border-wine">` + 
                        options.map(o => `<option value="${o}">${o}</option>`).join('') + `</select>`;
        } else {
            inputHtml = `<textarea id="dialogInput" class="w-full bg-white border border-gold/30 p-3.5 rounded-xl mb-4 text-[16px] md:text-sm focus:outline-none focus:border-wine" rows="3" placeholder="Type here..."></textarea>`;
        }
    }

    const dialogHTML = `
    <div id="tempDialog" class="fixed inset-0 z-[200] flex items-end md:items-center justify-center p-0 md:p-4">
        <div class="absolute inset-0 bg-[#320A16]/60 backdrop-blur-sm" onclick="document.getElementById('tempDialog').remove()"></div>
        <div class="relative bg-ivory w-full max-w-sm rounded-t-[24px] md:rounded-[20px] shadow-2xl p-6 border border-gold/20 flex flex-col items-center text-center animate-slide-up md:animate-none">
            <h3 class="font-serif text-2xl text-wine font-semibold mb-2">${title}</h3>
            <p class="text-wine/70 text-sm mb-6">${message}</p>
            ${inputHtml}
            <div class="flex flex-col md:flex-row w-full gap-3">
                <button onclick="document.getElementById('tempDialog').remove()" class="w-full py-3.5 md:py-3 bg-[#FAF8F5] border border-gold/20 text-wine rounded-xl text-[16px] md:text-sm font-medium hover:bg-white transition">Cancel</button>
                <button id="dialogConfirmBtn" class="w-full py-3.5 md:py-3 bg-wine text-cream rounded-xl text-[16px] md:text-sm font-medium shadow-md transition hover:bg-wine/90">Confirm</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    document.getElementById('dialogConfirmBtn').onclick = () => {
        let val = showInput ? document.getElementById('dialogInput').value : true;
        document.getElementById('tempDialog').remove();
        if(onConfirm) onConfirm(val);
    };
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

function navigate(view) {
    currentView = view;
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

// Dashboard
function initDashboard() {
    updateSidebarBadges();
    
    const kpiContainer = document.querySelector('#view-dashboard .grid');
    if (kpiContainer) {
        const pendingCount = profiles.filter(p => p.status === 'New').length;
        const shortCount = profiles.filter(p => p.status === 'Shortlisted').length;
        const fuCount = profiles.filter(p => p.status === 'Follow Up').length;
        
        // 2 cols on small mobile, up to 4 on lg
        kpiContainer.className = "grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5";
        kpiContainer.innerHTML = `
            <div class="glass-card p-4 md:p-6">
                <h3 class="text-2xl md:text-3xl font-serif text-wine font-semibold mb-0.5">${profiles.length}</h3>
                <p class="text-[11px] md:text-sm font-medium text-wine/80 uppercase md:capitalize tracking-wider md:tracking-normal">Total Profiles</p>
            </div>
            <div class="glass-card p-4 md:p-6">
                <h3 class="text-2xl md:text-3xl font-serif text-wine font-semibold mb-0.5">${pendingCount}</h3>
                <p class="text-[11px] md:text-sm font-medium text-wine/80 uppercase md:capitalize tracking-wider md:tracking-normal">Pending Review</p>
            </div>
            <div class="glass-card p-4 md:p-6">
                <h3 class="text-2xl md:text-3xl font-serif text-wine font-semibold mb-0.5">${shortCount}</h3>
                <p class="text-[11px] md:text-sm font-medium text-wine/80 uppercase md:capitalize tracking-wider md:tracking-normal">Shortlisted</p>
            </div>
            <div class="glass-card p-4 md:p-6">
                <h3 class="text-2xl md:text-3xl font-serif text-wine font-semibold mb-0.5">${fuCount}</h3>
                <p class="text-[11px] md:text-sm font-medium text-wine/80 uppercase md:capitalize tracking-wider md:tracking-normal">Follow Up Due</p>
            </div>
        `;
    }
    
    let dashData = profiles.slice().reverse().slice(0, 10);
    
    // Desktop Table
    const tbody = document.getElementById('dashTableBody');
    if(tbody) {
        tbody.innerHTML = dashData.map(p => {
            const idx = profiles.indexOf(p);
            return `<tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 text-[12px] text-wine/60">${p.createdAt.split('T')[0]}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender||'-'} / ${p.Age||'-'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City||'-'}</td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right"><button onclick="viewProfile(${idx})" class="px-3 py-1.5 border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine hover:bg-wine/5">View</button></td>
            </tr>`;
        }).join('');
    }
    
    // Mobile Cards
    const mobCont = document.getElementById('dashMobileCards');
    if(mobCont) {
        mobCont.innerHTML = dashData.map(p => {
            const idx = profiles.indexOf(p);
            return `<div class="p-5 flex flex-col gap-3">
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="font-serif font-bold text-wine text-[17px] leading-tight">${p['Full Name']||'-'}</h4>
                        <p class="text-[10px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                    </div>
                    ${getStatusBadge(p)}
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-wine/70">
                    <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gold/50"></span>${p.Gender||'-'} • ${p.Age||'-'}</span>
                    <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gold/50"></span>${p.City||'-'}</span>
                    <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gold/50"></span>${p.createdAt.split('T')[0]}</span>
                </div>
                <button onclick="viewProfile(${idx})" class="w-full py-3 mt-1 bg-[#FAF8F5] border border-gold/20 rounded-xl text-[13px] uppercase font-bold text-wine shadow-sm active:scale-[0.98] transition-transform">View Details</button>
            </div>`;
        }).join('');
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
            
            <div><label class="text-[10px] uppercase font-bold text-wine/50 block mb-1">Sect / Firqah</label>
            <select id="fltSect" class="w-full p-3 md:p-2 border rounded-xl md:rounded border-gold/30 text-[16px] md:text-sm bg-[#FAF8F5]"></select></div>
            
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
    
    document.getElementById('fltCity').innerHTML = '<option value="All">All</option>' + getOptions('City').map(c=>`<option value="${c}">${c}</option>`).join('');
    document.getElementById('fltSurname').innerHTML = '<option value="All">All</option>' + getOptions('Surname / Biradari').map(c=>`<option value="${c}">${c}</option>`).join('');
    document.getElementById('fltSect').innerHTML = '<option value="All">All</option>' + getOptions('Sect / Firqah').map(c=>`<option value="${c}">${c}</option>`).join('');
    document.getElementById('fltMaslak').innerHTML = '<option value="All">All</option>' + getOptions('Maslak / Religious Background').map(c=>`<option value="${c}">${c}</option>`).join('');
}

function applyFilters() {
    activeFilters = {
        gender: document.getElementById('fltGender').value,
        status: document.getElementById('fltStatus').value,
        city: document.getElementById('fltCity').value,
        minAge: document.getElementById('fltMinAge').value,
        maxAge: document.getElementById('fltMaxAge').value,
        surname: document.getElementById('fltSurname').value,
        sect: document.getElementById('fltSect').value,
        maslak: document.getElementById('fltMaslak').value,
        regFrom: document.getElementById('fltRegFrom').value,
        regTo: document.getElementById('fltRegTo').value
    };
    document.getElementById('filterModal').classList.add('hidden');
    renderListView();
}
function clearFilters() {
    activeFilters = {};
    document.getElementById('fltGender').value = 'All';
    document.getElementById('fltStatus').value = 'All';
    document.getElementById('fltCity').value = 'All';
    document.getElementById('fltMinAge').value = '';
    document.getElementById('fltMaxAge').value = '';
    document.getElementById('fltSurname').value = 'All';
    document.getElementById('fltSect').value = 'All';
    document.getElementById('fltMaslak').value = 'All';
    document.getElementById('fltRegFrom').value = '';
    document.getElementById('fltRegTo').value = '';
    applyFilters();
}

document.getElementById('listSearchInput').addEventListener('input', () => renderListView());

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

// List View
function renderListView() {
    let filtered = [...profiles];

// Supabase Data Mapping


    
    // Module Filters
    if (listType === 'pending') filtered = filtered.filter(p => p.status === 'New');
    if (listType === 'shortlisted') filtered = filtered.filter(p => p.status === 'Shortlisted');
    if (listType === 'contacted') filtered = filtered.filter(p => p.status === 'Contacted');
    if (listType === 'followup') {
        filtered = filtered.filter(p => p.status === 'Follow Up');
    }
    if (listType === 'notes') filtered = filtered.filter(p => p.notes && p.notes.length > 0);

    // Advanced Filters
    if (activeFilters.gender && activeFilters.gender !== 'All') filtered = filtered.filter(p=>p.Gender===activeFilters.gender);
    if (activeFilters.status && activeFilters.status !== 'All') filtered = filtered.filter(p=>p.status===activeFilters.status);
    if (activeFilters.city && activeFilters.city !== 'All') filtered = filtered.filter(p=>p.City===activeFilters.city);
    if (activeFilters.surname && activeFilters.surname !== 'All') filtered = filtered.filter(p=>p['Surname / Biradari']===activeFilters.surname);
    if (activeFilters.sect && activeFilters.sect !== 'All') filtered = filtered.filter(p=>p['Sect / Firqah']===activeFilters.sect);
    if (activeFilters.maslak && activeFilters.maslak !== 'All') filtered = filtered.filter(p=>p['Maslak / Religious Background']===activeFilters.maslak);
    if (activeFilters.minAge) filtered = filtered.filter(p=> parseInt(p.Age) >= parseInt(activeFilters.minAge));
    if (activeFilters.maxAge) filtered = filtered.filter(p=> parseInt(p.Age) <= parseInt(activeFilters.maxAge));
    if (activeFilters.regFrom) filtered = filtered.filter(p => new Date(p.createdAt.split('T')[0]) >= new Date(activeFilters.regFrom));
    if (activeFilters.regTo) filtered = filtered.filter(p => new Date(p.createdAt.split('T')[0]) <= new Date(activeFilters.regTo));

    // Global Search
    const term = document.getElementById('listSearchInput').value.toLowerCase();
    if(term) {
        filtered = filtered.filter(p => Object.values(p).some(v => String(v).toLowerCase().includes(term)));
    }
    
    // Header Titles
    const titles = {
        'all': {t: 'All Profiles', s: 'Manage and view all registered matrimonial profiles.'},
        'pending': {t: 'Pending Review', s: `Profiles submitted but not yet reviewed. (${filtered.length} pending)`},
        'shortlisted': {t: 'Shortlisted Profiles', s: 'Profiles selected for possible matchmaking consideration.'},
        'contacted': {t: 'Contacted Profiles', s: 'Profiles where the family/candidate has already been contacted.'},
        'followup': {t: 'Follow Up', s: 'Profiles requiring follow-up communication.'},
        'notes': {t: 'Profile Notes', s: 'Internal administrative notes on profiles.'}
    };
    document.getElementById('listTitle').innerText = titles[listType].t;
    document.getElementById('listSubtitle').innerText = titles[listType].s;

    // Filter Chips Render
    let chipsHTML = '';
    for(let k in activeFilters) {
        if(activeFilters[k] && activeFilters[k] !== 'All') {
            chipsHTML += `<span class="px-3 py-1.5 bg-white border border-gold/30 text-wine rounded-full text-[11px] font-bold uppercase shadow-sm">${k}: ${activeFilters[k]}</span>`;
        }
    }
    const chipsContainer = document.getElementById('activeFiltersContainer');
    if(chipsHTML) {
        chipsContainer.innerHTML = chipsHTML + '<button onclick="clearFilters()" class="text-[12px] font-bold text-wine/60 underline ml-2 hover:text-wine p-2">Clear All</button>';
        chipsContainer.classList.remove('hidden');
    } else {
        chipsContainer.classList.add('hidden');
    }

    const tbody = document.getElementById('listTableBody');
    const thead = document.getElementById('listTableHeader');
    const mobCont = document.getElementById('listMobileCards');
    
    if(filtered.length === 0) {
        if(thead) thead.innerHTML = '<tr><th class="p-4">Profiles</th></tr>';
        if(tbody) tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-wine/50 text-sm italic">No profiles found for this view.</td></tr>';
        if(mobCont) mobCont.innerHTML = '<div class="p-8 text-center text-wine/50 text-sm italic">No profiles found for this view.</div>';
        return;
    }

    const renderTableAndCards = (profilesArray, columnsHtml, desktopRowFn, mobileCardFn) => {
        if(thead) thead.innerHTML = `<tr>${columnsHtml}</tr>`;
        if(tbody) tbody.innerHTML = profilesArray.map(p => desktopRowFn(p, profiles.indexOf(p))).join('');
        if(mobCont) mobCont.innerHTML = profilesArray.map(p => mobileCardFn(p, profiles.indexOf(p))).join('');
    };

    if (listType === 'followup') {
        const today = new Date().setHours(0,0,0,0);
        const overdue = [], due = [], upcoming = [];

// Supabase Data Mapping


        filtered.forEach(p => {
            if(!p.followUpDate) return overdue.push(p);
            let d = new Date(p.followUpDate).setHours(0,0,0,0);
            if(d < today) overdue.push(p);
            else if(d === today) due.push(p);
            else upcoming.push(p);
        });
        
        const cols = `<th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Contact</th><th class="p-4">Follow-up Info</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        const deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Mobile||'-'}</td>
                <td class="p-4 text-[12px]"><p class="font-bold">${p.followUpDate||'-'} ${p.followUpTime||''}</p><p class="text-wine/60 truncate max-w-xs">${p.followUpNote||''}</p></td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="changeStatus(${idx},'Contacted')" class="px-2.5 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Complete</button>
                    <button onclick="openFollowUp(${idx})" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Reschedule</button>
                </td>
            </tr>`;
        
        const mobCard = (p, idx) => `
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gold/20 flex flex-col gap-3">
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="font-serif font-bold text-wine text-[18px] leading-tight">${p['Full Name']||'-'}</h4>
                        <p class="text-[11px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                    </div>
                    ${getStatusBadge(p)}
                </div>
                <div class="bg-purple-50/50 p-3 rounded-xl border border-purple-100 text-[13px]">
                    <div class="font-bold text-wine mb-1">${p.followUpDate||'-'} ${p.followUpTime||''}</div>
                    <div class="text-wine/70 leading-snug">${p.followUpNote||'No note provided.'}</div>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <button onclick="viewProfile(${idx})" class="py-3 bg-white border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm">View Profile</button>
                    <button onclick="changeStatus(${idx},'Contacted')" class="py-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-[12px] uppercase font-bold shadow-sm">Complete</button>
                    <button onclick="openFollowUp(${idx})" class="col-span-2 py-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1">Reschedule</button>
                </div>
            </div>`;

        if(thead) thead.innerHTML = `<tr>${cols}</tr>`;
        
        let deskHtml = '', mobHtml = '';
        if(overdue.length) {
            deskHtml += `<tr><td colspan="6" class="p-3 bg-red-50 text-red-800 font-bold text-xs uppercase tracking-wider">Overdue</td></tr>`;
            deskHtml += overdue.map(p => deskRow(p, profiles.indexOf(p))).join('');
            mobHtml += `<div class="px-2 py-1 text-red-800 font-bold text-xs uppercase tracking-wider">Overdue</div>`;
            mobHtml += overdue.map(p => mobCard(p, profiles.indexOf(p))).join('');
        }
        if(due.length) {
            deskHtml += `<tr><td colspan="6" class="p-3 bg-blue-50 text-blue-800 font-bold text-xs uppercase tracking-wider">Due Today</td></tr>`;
            deskHtml += due.map(p => deskRow(p, profiles.indexOf(p))).join('');
            mobHtml += `<div class="px-2 py-1 text-blue-800 font-bold text-xs uppercase tracking-wider mt-4">Due Today</div>`;
            mobHtml += due.map(p => mobCard(p, profiles.indexOf(p))).join('');
        }
        if(upcoming.length) {
            deskHtml += `<tr><td colspan="6" class="p-3 bg-gray-50 text-gray-800 font-bold text-xs uppercase tracking-wider">Upcoming</td></tr>`;
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
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gold/20 flex flex-col gap-3 relative overflow-hidden">
            <div class="flex justify-between items-start">
                <div>
                    <h4 class="font-serif font-bold text-wine text-[18px] leading-tight pr-2">${p['Full Name']||'-'}</h4>
                    <p class="text-[11px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                </div>
                ${getStatusBadge(p)}
            </div>
            <div class="grid grid-cols-2 gap-x-2 gap-y-3 text-[13px] text-wine/80 mt-1">
                ${fieldsHtml}
            </div>
            <div class="grid grid-cols-2 gap-2 mt-3 pt-4 border-t border-gold/10">
                <button onclick="viewProfile(${idx})" class="py-3 bg-[#FAF8F5] border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm active:scale-[0.98] transition-transform">View Details</button>
                ${actionsHtml}
            </div>
        </div>
    `;

    if (listType === 'pending') {
        cols = `<th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">City</th><th class="p-4">Reg Date</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender||'-'} / ${p.Age||'-'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City||'-'}</td>
                <td class="p-4 text-[12px] text-wine/80">${p.createdAt.split('T')[0]}</td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View Details</button>
                    <button onclick="changeStatus(${idx},'Reviewed')" class="px-2.5 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Review</button>
                    <button onclick="changeStatus(${idx},'Shortlisted')" class="px-2.5 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Shortlist</button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender||'-'} • ${p.Age||'-'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City||'-'}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Registered</span>${p.createdAt.split('T')[0]}</div>`,
            `<button onclick="changeStatus(${idx},'Reviewed')" class="py-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-[12px] uppercase font-bold shadow-sm active:scale-[0.98]">Review</button>
             <button onclick="changeStatus(${idx},'Shortlisted')" class="col-span-2 py-3 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1 active:scale-[0.98]">Shortlist</button>`
        );
    } 
    else if (listType === 'shortlisted') {
        cols = `<th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">City</th><th class="p-4">Surname / Maslak</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender||'-'} / ${p.Age||'-'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City||'-'}</td>
                <td class="p-4 text-[12px] text-wine/80"><p>${p['Surname / Biradari']||'-'}</p><p class="text-[10px] text-wine/50">${p['Sect / Firqah']||'-'} | ${p['Maslak']||'-'}</p></td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="changeStatus(${idx},'Contacted')" class="px-2.5 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Contacted</button>
                    <button onclick="changeStatus(${idx},'Reviewed')" class="px-2.5 py-1.5 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Remove</button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender||'-'} • ${p.Age||'-'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City||'-'}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Background</span>${p['Surname / Biradari']||'-'} • ${p['Maslak']||'-'}</div>`,
            `<button onclick="changeStatus(${idx},'Contacted')" class="py-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl text-[12px] uppercase font-bold shadow-sm">Contacted</button>
             <button onclick="changeStatus(${idx},'Reviewed')" class="col-span-2 py-3 bg-gray-50 border border-gray-200 text-gray-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1">Remove from Shortlist</button>`
        );
    }
    else if (listType === 'contacted') {
        cols = `<th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">City</th><th class="p-4">Contact</th><th class="p-4">Contacted Date</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender||'-'} / ${p.Age||'-'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.City||'-'}</td>
                <td class="p-4 text-[13px] text-wine/80">${p.Mobile||'-'}</td>
                <td class="p-4 text-[12px] text-wine/80">${p.contactedAt ? p.contactedAt.split('T')[0] : '-'}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="openFollowUp(${idx})" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] uppercase font-bold shadow-sm">Set Follow Up</button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender||'-'} • ${p.Age||'-'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City||'-'}</div>
             <div class="col-span-2"><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Contact</span>${p.Mobile||'-'}</div>`,
            `<button onclick="openFollowUp(${idx})" class="py-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl text-[12px] uppercase font-bold shadow-sm">Follow Up</button>
             <button onclick="changeStatus(${idx},'Closed')" class="col-span-2 py-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-[12px] uppercase font-bold shadow-sm mt-1">Close Profile</button>`
        );
    }
    else if (listType === 'notes') {
        cols = `<th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Latest Note</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80 italic break-words max-w-sm">${p.notes.length ? p.notes[p.notes.length-1].text : '-'}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View Notes</button>
                </td>
            </tr>`;
        mobCard = (p, idx) => `
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gold/20 flex flex-col gap-3">
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="font-serif font-bold text-wine text-[18px] leading-tight">${p['Full Name']||'-'}</h4>
                        <p class="text-[11px] font-bold text-wine/50 uppercase tracking-widest mt-0.5">${p.profileId}</p>
                    </div>
                </div>
                <div class="bg-yellow-50/50 p-4 rounded-xl border border-yellow-100/50 text-[14px] italic text-wine/80">
                    "${p.notes.length ? p.notes[p.notes.length-1].text : '-'}"
                </div>
                <button onclick="viewProfile(${idx})" class="w-full py-3 mt-1 bg-[#FAF8F5] border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm">Open Profile</button>
            </div>`;
    }
    else {
        cols = `<th class="p-4">Profile ID</th><th class="p-4">Candidate</th><th class="p-4">Gender/Age</th><th class="p-4">Location & Comm</th><th class="p-4">Contact</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th>`;
        deskRow = (p, idx) => `
            <tr class="border-b border-gold/10 hover:bg-[#FAF8F5] transition">
                <td class="p-4 font-bold text-[13px] text-wine">${p.profileId}</td>
                <td class="p-4"><p class="font-medium text-[14px] text-wine">${p['Full Name']||'-'}</p><p class="text-[10px] uppercase text-wine/50">${p['Registering For']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Gender||'-'} / ${p.Age||'-'}</td>
                <td class="p-4 text-[12px] text-wine/80"><p>${p.City||'-'}</p><p class="text-[10px] text-wine/50">${p['Surname / Biradari']||'-'}</p></td>
                <td class="p-4 text-[13px] text-wine/80">${p.Mobile||'-'}</td>
                <td class="p-4">${getStatusBadge(p)}</td>
                <td class="p-4 text-right flex justify-end gap-1 flex-wrap">
                    <button onclick="viewProfile(${idx})" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">View</button>
                    <button onclick="promptStatus()" class="px-2.5 py-1.5 bg-white border border-gold/30 rounded-lg text-[10px] uppercase font-bold text-wine shadow-sm">Status</button>
                </td>
            </tr>`;
        mobCard = (p, idx) => buildMobCard(p, idx, 
            `<div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Gender / Age</span>${p.Gender||'-'} • ${p.Age||'-'}</div>
             <div><span class="block text-[10px] font-bold uppercase text-wine/40 mb-0.5">Location</span>${p.City||'-'}</div>`,
            `<button onclick="activeProfileIndex=${idx}; promptStatus()" class="py-3 bg-[#FAF8F5] border border-gold/30 rounded-xl text-[12px] uppercase font-bold text-wine shadow-sm">Change Status</button>`
        );
    }
    
    renderTableAndCards(filtered, cols, deskRow, mobCard);
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

function confirmDelete(idx) {
    showDialog('warning', 'Delete Profile', 'Are you sure you want to permanently delete this profile?', async () => {
        try {
            const { error } = await window.supabaseClient.from('profiles').delete().eq('id', profiles[idx].id);
            if (error) throw error;
            
            profiles.splice(idx, 1);
            updateSidebarBadges();
            renderListView();
            if(currentView === 'dashboard') initDashboard();
        } catch(err) {
            console.error(err);
            showDialog('info', 'Error', 'Failed to delete profile.');
        }
    });
}

// Profile Modal (View/Edit)
const pFields = [
    {group: 'BASIC', f: ['Full Name', 'Registering For', 'Gender', 'Age', 'Date of Birth', 'Marital Status', 'Height']},
    {group: 'PROFESSIONAL', f: ['Education', 'Occupation', 'City', 'Mother Tongue', 'Languages Known']},
    {group: 'FAMILY & RELIGIOUS', f: ['Surname / Biradari', "Father's Occupation", 'Sect / Firqah', 'Maslak', 'Religious Preference']},
    {group: 'CONTACT', f: ['Mobile', 'Email Address', 'Residential Address']}
];

// Supabase Data Mapping



function viewProfile(idx) {
    activeProfileIndex = idx;
    isEditMode = false;
    document.getElementById('profileModal').classList.remove('hidden');
    renderProfileModal();
}
function closeModal() { document.getElementById('profileModal').classList.add('hidden'); }

function renderProfileModal() {
    const p = profiles[activeProfileIndex];

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
            const val = p[key] || '';
            const safeId = 'edit_' + key.replace(/[^a-zA-Z]/g, '');
            if(isEditMode) {
                html += `<div><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1.5">${key}</span>
                <input type="text" id="${safeId}" value="${val.replace(/"/g,'&quot;')}" class="w-full bg-[#FAF8F5] px-4 md:px-3 py-3 md:py-2.5 border border-gold/30 rounded-xl text-[16px] md:text-[14px] text-wine focus:outline-none focus:border-wine/50"></div>`;
            } else {
                html += `<div><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1">${key}</span><span class="block text-[16px] md:text-[15px] text-wine font-medium break-words">${val || '-'}</span></div>`;
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
                <div><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-widest mb-1">Note</span><span class="block text-[16px] md:text-[14px] text-wine font-medium break-words">${p.followUpNote || '-'}</span></div>
            </div>
        </div>`;
    }

    // Admin Notes Section
    if(!isEditMode) {
        let nHtml = p.notes && p.notes.length ? [...p.notes].reverse().map(n=>`<div class="p-4 md:p-5 border-b border-gold/10 text-[15px] md:text-sm text-wine/80 hover:bg-[#FAF8F5] transition"><span class="block text-[10px] font-bold text-wine/40 uppercase tracking-wider mb-1.5">${new Date(n.date).toLocaleString()}</span>${n.text}</div>`).join('') : '<div class="p-5 text-[15px] md:text-sm text-wine/50 italic">No notes added.</div>';
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
                p[f] = el.value;
                if (['Age', 'Brothers', 'Sisters'].includes(f)) {
                    updateData[fieldMapToDb[f]] = parseInt(el.value) || 0;
                } else {
                    updateData[fieldMapToDb[f]] = el.value || null;
                }
            }
        });
    });
    
    const nowStr = new Date().toISOString();
    p.updatedAt = nowStr;
    updateData.updated_at = nowStr;
    
    try {
        const { error } = await window.supabaseClient.from('profiles').update(updateData).eq('id', p.id);
        if (error) throw error;
        
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
        if(val.trim()) {
            const p = profiles[activeProfileIndex];
            const newNote = {text: val.trim(), date: new Date().toISOString()};
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
    }, true);
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
    
    let headers = ['Profile ID','Status','Full Name','Gender','Age','City','Mobile'];

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
