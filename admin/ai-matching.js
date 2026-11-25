/**
 * Noor-E-Nikah Admin AI Matching Module (Phase 2 Hardened)
 * Ultra Master Specification Implementation
 * Pure deterministic matching engine, multi-Maslak control, exact DOB math,
 * mutual age preferences, ranking, UI controller, and secure PostgreSQL RPC integration.
 */

// ============================================================================
// 1. PURE DETERMINISTIC MATCHING ENGINE
// ============================================================================
const AIMatchingEngine = {
    // Set of profile IDs actively locked in a confirmed pair (excluded from matching)
    activePairProfiles: new Set(),
    activePairsList: [],

    setActivePairs(pairs) {
        this.activePairProfiles.clear();
        this.activePairsList = [];
        if (Array.isArray(pairs)) {
            pairs.forEach(p => {
                const status = p.status || p.pair_status;
                if (status === 'Active') {
                    const bId = p.bride_profile_id || (p.bride && (p.bride.profile_id || p.bride.profileId));
                    const gId = p.groom_profile_id || (p.groom && (p.groom.profile_id || p.groom.profileId));
                    if (bId) this.activePairProfiles.add(String(bId).trim());
                    if (gId) this.activePairProfiles.add(String(gId).trim());
                    this.activePairsList.push(p);
                }
            });
        }
    },

    isProfileActivelyPaired(profileId) {
        if (!profileId) return false;
        return this.activePairProfiles.has(String(profileId).trim());
    },

    getActivePairForProfile(profileId) {
        if (!profileId) return null;
        const normId = String(profileId).trim().toLowerCase();
        return this.activePairsList.find(p => {
            const bId = p.bride_profile_id || (p.bride && (p.bride.profile_id || p.bride.profileId));
            const gId = p.groom_profile_id || (p.groom && (p.groom.profile_id || p.groom.profileId));
            return (bId && String(bId).trim().toLowerCase() === normId) ||
                   (gId && String(gId).trim().toLowerCase() === normId);
        }) || null;
    },

    // Parse preferred age range with exact Phase 2 semantics:
    // - "20-27" / "20 to 27": inclusive range 20 through 27 -> [20, 27]
    // - "25+": minimum 25 inclusive -> [25, 99]
    // - "above 25": strictly above 25 -> [26, 99]
    // - "min 25": minimum 25 inclusive -> [25, 99]
    // - "below 30": strictly below 30 -> [18, 29]
    // - "under 30": strictly below 30 -> [18, 29]
    // - "max 30": maximum 30 inclusive -> [18, 30]
    // - "25": exact age 25 only -> [25, 25]
    // - Ambiguous / non-numeric text -> null (classified as Needs Review)
    parsePreferredAgeRange(text) {
        if (!text || typeof text !== 'string') return null;
        const cleaned = text.trim();
        if (!cleaned) return null;

        // 1. Remove prefixes like around, approx, about
        let normalized = cleaned
            .replace(/\b(?:around|approx|approximately|about)\b\.?\s*/gi, '')
            // 2. Remove attached suffixes like 25yo, 25yrs, 25yr, 25y
            .replace(/(\d{1,2})\s*(?:years?(\s+old)?|yrs?|yr|yo|y)\b/gi, '$1')
            // 3. Remove standalone words like years old, years, yrs, yr, old, age, yo
            .replace(/\b(?:years?\s+old|years?|yrs?|yr|yo|old|age)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // 1. Inclusive Range: "20 - 27", "20-27", "20 to 27", "20 – 27", "20 — 27"
        const rangeMatch = normalized.match(/^(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})$/i);
        if (rangeMatch) {
            const min = parseInt(rangeMatch[1], 10);
            const max = parseInt(rangeMatch[2], 10);
            if (!isNaN(min) && !isNaN(max) && min > 0 && max >= min) {
                return { min, max, type: 'INCLUSIVE_RANGE', raw: cleaned };
            }
        }

        // 2. "above 25" or "> 25": Strictly above 25 (min = 26)
        const aboveMatch = normalized.match(/^(?:above|>)\s*(\d{1,2})$/i);
        if (aboveMatch) {
            const threshold = parseInt(aboveMatch[1], 10);
            if (!isNaN(threshold)) {
                return { min: threshold + 1, max: 99, threshold, type: 'STRICTLY_ABOVE', raw: cleaned };
            }
        }

        // 3. "25+" or ">= 25" or "min 25" or "minimum 25": Minimum 25 inclusive (min = 25)
        const minMatch = normalized.match(/^(?:min|minimum|>=)\s*(\d{1,2})$/i) || normalized.match(/^(\d{1,2})\s*\+$/);
        if (minMatch) {
            const min = parseInt(minMatch[1], 10);
            if (!isNaN(min)) {
                return { min, max: 99, type: 'MINIMUM_INCLUSIVE', raw: cleaned };
            }
        }

        // 4. "below 30" or "under 30" or "< 30": Strictly below 30 (max = 29)
        const belowMatch = normalized.match(/^(?:below|under|<)\s*(\d{1,2})$/i);
        if (belowMatch) {
            const threshold = parseInt(belowMatch[1], 10);
            if (!isNaN(threshold) && threshold > 18) {
                return { min: 18, max: threshold - 1, threshold, type: 'STRICTLY_BELOW', raw: cleaned };
            }
        }

        // 5. "max 30" or "maximum 30" or "<= 30" or "up to 30": Maximum 30 inclusive (max = 30)
        const maxMatch = normalized.match(/^(?:max|maximum|<=|up to)\s*(\d{1,2})$/i);
        if (maxMatch) {
            const max = parseInt(maxMatch[1], 10);
            if (!isNaN(max) && max >= 18) {
                return { min: 18, max, type: 'MAXIMUM_INCLUSIVE', raw: cleaned };
            }
        }

        // 6. Single integer age: "25" (exact age 25 only)
        const singleMatch = normalized.match(/^(\d{1,2})$/);
        if (singleMatch) {
            const val = parseInt(singleMatch[1], 10);
            if (!isNaN(val) && val >= 18) {
                return { min: val, max: val, type: 'EXACT_AGE_ONLY', raw: cleaned };
            }
        }

        return null;
    },

    // Parse date YYYY-MM-DD safely into components
    parseDateParts(dobStr) {
        if (!dobStr || typeof dobStr !== 'string') return null;
        const parts = dobStr.trim().split('-');
        if (parts.length !== 3) return null;
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dateObj = new Date(Date.UTC(y, m - 1, d));
        if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() !== m - 1 || dateObj.getUTCDate() !== d) {
            return null;
        }
        return { year: y, month: m, day: d, time: dateObj.getTime() };
    },

    // Reference today in Asia/Kolkata
    getTodayInKolkata(overrideDate) {
        if (overrideDate) {
            return this.parseDateParts(overrideDate);
        }
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const kolkataStr = formatter.format(now);
        return this.parseDateParts(kolkataStr);
    },

    // Calculate completed years, months, days
    calculateExactAge(dobStr, refDateStr) {
        const dob = this.parseDateParts(dobStr);
        if (!dob) return null;
        const ref = this.getTodayInKolkata(refDateStr);
        if (!ref) return null;

        if (dob.time > ref.time) return null;

        let years = ref.year - dob.year;
        let months = ref.month - dob.month;
        let days = ref.day - dob.day;

        if (days < 0) {
            months--;
            const prevMonthDate = new Date(Date.UTC(ref.year, ref.month - 1, 0));
            days += prevMonthDate.getUTCDate();
        }

        if (months < 0) {
            years--;
            months += 12;
        }

        const totalDays = Math.round((ref.time - dob.time) / 86400000);

        return {
            years,
            months,
            days,
            totalDays,
            display: `${years} yrs${months > 0 ? `, ${months} mos` : ''}`
        };
    },

    // Calculate exact difference between older and younger person
    // dobOlderStr must be <= dobYoungerStr (older was born earlier)
    calculateAgeDifference(dobOlderStr, dobYoungerStr) {
        const older = this.parseDateParts(dobOlderStr);
        const younger = this.parseDateParts(dobYoungerStr);
        if (!older || !younger) return null;

        const diffDays = Math.round((younger.time - older.time) / 86400000);
        if (diffDays < 0) return null;

        if (diffDays === 0) {
            return {
                diffDays: 0,
                years: 0,
                months: 0,
                days: 0,
                display: 'Same exact DOB (0 days difference)'
            };
        }

        let years = younger.year - older.year;
        let months = younger.month - older.month;
        let days = younger.day - older.day;

        if (days < 0) {
            months--;
            const prevMonthDate = new Date(Date.UTC(younger.year, younger.month - 1, 0));
            days += prevMonthDate.getUTCDate();
        }
        if (months < 0) {
            years--;
            months += 12;
        }

        let parts = [];
        if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
        if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
        if (days > 0 && years === 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);

        return {
            diffDays,
            years,
            months,
            days,
            display: parts.length > 0 ? parts.join(', ') : `${diffDays} days`
        };
    },

    // Age direction check:
    // Direction = 'bride': Groom must be older or same DOB => candidate.dob <= selected.dob
    // Direction = 'groom': Bride must be younger or same DOB => candidate.dob >= selected.dob
    checkAgeDirection(direction, selectedDobStr, candidateDobStr) {
        const s = this.parseDateParts(selectedDobStr);
        const c = this.parseDateParts(candidateDobStr);
        if (!s || !c) return { eligible: false, reason: 'Invalid or missing date of birth' };

        const isSameDob = (s.time === c.time);

        if (direction === 'bride') {
            if (c.time <= s.time) {
                return { eligible: true, isSameDob, olderDob: candidateDobStr, youngerDob: selectedDobStr };
            }
            return {
                eligible: false,
                reason: 'Groom is younger than Bride (strictly excluded by Islamic matrimonial age rule)'
            };
        } else if (direction === 'groom') {
            if (c.time >= s.time) {
                return { eligible: true, isSameDob, olderDob: selectedDobStr, youngerDob: candidateDobStr };
            }
            return {
                eligible: false,
                reason: 'Bride is older than Groom (strictly excluded by Islamic matrimonial age rule)'
            };
        }

        return { eligible: false, reason: 'Invalid search direction' };
    },

    // Evaluate single age preference with 2-year boundary flexibility
    evaluateSinglePreference(personAge, preferenceStr) {
        if (!personAge || isNaN(personAge)) {
            return { status: 'MISSING', label: 'Age unknown', code: 5 };
        }
        const range = this.parsePreferredAgeRange(preferenceStr);
        if (!range) {
            return { status: 'MISSING', label: 'Preference Missing / Needs Review', code: 5, raw: preferenceStr };
        }

        const age = Math.floor(personAge);

        // Exact match within [min, max]
        if (age >= range.min && age <= range.max) {
            let label = `Exact Preference Match (${range.min}-${range.max})`;
            if (range.type === 'STRICTLY_ABOVE') label = `Exact Preference Match (Above ${range.threshold})`;
            else if (range.type === 'MINIMUM_INCLUSIVE') label = `Exact Preference Match (${range.min}+)`;
            else if (range.type === 'STRICTLY_BELOW') label = `Exact Preference Match (Under ${range.threshold})`;
            else if (range.type === 'MAXIMUM_INCLUSIVE') label = `Exact Preference Match (Max ${range.max})`;
            else if (range.type === 'EXACT_AGE_ONLY') label = `Exact Preference Match (Age ${range.min})`;

            return { status: 'EXACT', label, code: 1, range };
        }

        // Two-year flexibility:
        // Lower extension: [min - 2, min - 1] (if min > 18)
        // Upper extension: [max + 1, max + 2] (if max < 99)
        const isFlexibleLower = (range.min > 18 && age >= range.min - 2 && age < range.min);
        const isFlexibleUpper = (range.max < 99 && age > range.max && age <= range.max + 2);

        if (isFlexibleLower || isFlexibleUpper) {
            return {
                status: 'FLEXIBLE',
                label: `Flexible — Within 2 Years (${range.min}-${range.max})`,
                code: 2,
                range
            };
        }

        // Outside preference
        return {
            status: 'OUTSIDE',
            label: `Outside Age Preference (${range.min}-${range.max})`,
            code: 4,
            range
        };
    },

    // Evaluate mutual age preference for both Selected and Candidate
    evaluateMutualPreference(selectedProfile, candidateProfile, refDateStr) {
        const sDob = selectedProfile['Date of Birth'] || selectedProfile.date_of_birth;
        const cDob = candidateProfile['Date of Birth'] || candidateProfile.date_of_birth;

        const sAgeObj = this.calculateExactAge(sDob, refDateStr);
        const cAgeObj = this.calculateExactAge(cDob, refDateStr);

        const sAge = sAgeObj ? sAgeObj.years : parseInt(selectedProfile.Age || selectedProfile.age, 10);
        const cAge = cAgeObj ? cAgeObj.years : parseInt(candidateProfile.Age || candidateProfile.age, 10);

        const sPrefStr = selectedProfile['Preferred Age Range'] || selectedProfile.preferred_age_range;
        const cPrefStr = candidateProfile['Preferred Age Range'] || candidateProfile.preferred_age_range;

        // Direction 1: Candidate's age against Selected's preference
        const sPrefOnC = this.evaluateSinglePreference(cAge, sPrefStr);

        // Direction 2: Selected's age against Candidate's preference
        const cPrefOnS = this.evaluateSinglePreference(sAge, cPrefStr);

        let combinedStatus = 'MISSING';
        let combinedLabel = 'Preference Missing / Review';
        let combinedRank = 5;

        if (sPrefOnC.status === 'EXACT' && cPrefOnS.status === 'EXACT') {
            combinedStatus = 'BOTH_EXACT';
            combinedLabel = 'Both Preferences Match';
            combinedRank = 1;
        } else if (
            (sPrefOnC.status === 'EXACT' && cPrefOnS.status === 'FLEXIBLE') ||
            (sPrefOnC.status === 'FLEXIBLE' && cPrefOnS.status === 'EXACT')
        ) {
            combinedStatus = 'ONE_EXACT_ONE_FLEXIBLE';
            combinedLabel = 'Flexible (1 Exact, 1 Flexible)';
            combinedRank = 2;
        } else if (sPrefOnC.status === 'FLEXIBLE' && cPrefOnS.status === 'FLEXIBLE') {
            combinedStatus = 'BOTH_FLEXIBLE';
            combinedLabel = 'Both Flexible (Within 2 Years)';
            combinedRank = 3;
        } else if (sPrefOnC.status === 'OUTSIDE' || cPrefOnS.status === 'OUTSIDE') {
            combinedStatus = 'OUTSIDE';
            combinedLabel = 'Outside Age Preference';
            combinedRank = 4;
        } else {
            combinedStatus = 'MISSING';
            combinedLabel = 'Preference Missing / Needs Review';
            combinedRank = 5;
        }

        return {
            combinedStatus,
            combinedLabel,
            combinedRank,
            selectedPrefOnCandidate: sPrefOnC,
            candidatePrefOnSelected: cPrefOnS
        };
    },

    // Normalize Maslak for matching: trim and case-insensitive
    normalizeMaslak(m) {
        if (!m || typeof m !== 'string') return '';
        return m.trim().toLowerCase();
    },

    // Special non-maslak values that must NEVER receive SAME_MASLAK classification or priority 0
    isSpecialNonMaslak(m) {
        if (!m || typeof m !== 'string') return true;
        const norm = m.trim().toLowerCase();
        const specialValues = [
            '',
            'other',
            'prefer not to say',
            'prefer_not_to_say',
            'prefer-not-to-say',
            'prefer not say',
            'not specified',
            'none',
            'n/a'
        ];
        return specialValues.includes(norm);
    },

    // Evaluate a single pair
    evaluatePair(selectedProfile, candidateProfile, adminSelectedMaslaks, direction, refDateStr) {
        const targetGender = direction === 'bride' ? 'Male' : 'Female';
        const expectedSelectedGender = direction === 'bride' ? 'Female' : 'Male';

        const sGender = (selectedProfile.Gender || selectedProfile.gender || '').trim();
        const cGender = (candidateProfile.Gender || candidateProfile.gender || '').trim();

        if (sGender.toLowerCase() !== expectedSelectedGender.toLowerCase()) {
            return { eligible: false, reason: `Selected profile gender is ${sGender}, expected ${expectedSelectedGender}` };
        }

        if (cGender.toLowerCase() !== targetGender.toLowerCase()) {
            return { eligible: false, reason: `Candidate gender is ${cGender}, expected ${targetGender}` };
        }

        // 1. Status Eligibility: ONLY exact 'New' and 'Reviewed' profiles can enter AI matching
        const ELIGIBLE_STATUSES = ['New', 'Reviewed'];
        const sStatus = selectedProfile.status;
        const cStatus = candidateProfile.status;

        if (!sStatus || !ELIGIBLE_STATUSES.includes(sStatus)) {
            return { eligible: false, reason: `Selected profile status "${sStatus}" is not eligible for matching (must be New or Reviewed)` };
        }
        if (!cStatus || !ELIGIBLE_STATUSES.includes(cStatus)) {
            return { eligible: false, reason: `Candidate profile status "${cStatus}" is not eligible for matching (must be New or Reviewed)` };
        }

        // 2. Active Confirmed Pair Exclusion (1:1 Active Bond)
        const sPid = selectedProfile.profileId || selectedProfile.profile_id;
        const cPid = candidateProfile.profileId || candidateProfile.profile_id;
        if (this.isProfileActivelyPaired(sPid)) {
            return { eligible: false, reason: `Selected profile (${sPid}) is already in an active confirmed pair` };
        }
        if (this.isProfileActivelyPaired(cPid)) {
            return { eligible: false, reason: `Candidate profile (${cPid}) is already in an active confirmed pair` };
        }

        // Maslak matching
        const sMaslak = selectedProfile.Maslak !== undefined ? selectedProfile.Maslak : (selectedProfile.maslak !== undefined ? selectedProfile.maslak : '');
        const cMaslak = candidateProfile.Maslak !== undefined ? candidateProfile.Maslak : (candidateProfile.maslak !== undefined ? candidateProfile.maslak : '');
        const sMaslakNorm = this.normalizeMaslak(sMaslak);
        const cMaslakNorm = this.normalizeMaslak(cMaslak);

        let matchedMaslakIndex = -1;
        let matchedMaslakOriginal = '';

        for (let i = 0; i < adminSelectedMaslaks.length; i++) {
            if (this.normalizeMaslak(adminSelectedMaslaks[i]) === cMaslakNorm) {
                matchedMaslakIndex = i;
                matchedMaslakOriginal = adminSelectedMaslaks[i];
                break;
            }
        }

        if (matchedMaslakIndex === -1) {
            return { eligible: false, reason: `Candidate Maslak "${cMaslak}" is not in Admin selection` };
        }

        // 3. Maslak Standard Check (Manual Review Flag)
        const STANDARD_MASLAKS = ['deobandi', 'barelvi', 'ahle hadees', 'salafi', 'tableeghi jamaat', 'sunni', 'shia', 'ahle sunnat', 'wahabi'];
        const manualReviewRequired = !cMaslakNorm || !STANDARD_MASLAKS.includes(cMaslakNorm);

        const isSpecial = this.isSpecialNonMaslak(sMaslak) || this.isSpecialNonMaslak(cMaslak);
        const isSameMaslak = !isSpecial && (cMaslakNorm === sMaslakNorm);
        const groupType = isSameMaslak ? 'SAME_MASLAK' : 'ADDITIONAL_MASLAK';
        const groupPriority = isSameMaslak ? 0 : 1 + matchedMaslakIndex;

        // Age direction
        const sDob = selectedProfile['Date of Birth'] || selectedProfile.date_of_birth;
        const cDob = candidateProfile['Date of Birth'] || candidateProfile.date_of_birth;

        const ageDir = this.checkAgeDirection(direction, sDob, cDob);
        if (!ageDir.eligible) {
            return { eligible: false, reason: ageDir.reason };
        }

        // Exact age and difference calculations
        const sAgeObj = this.calculateExactAge(sDob, refDateStr);
        const cAgeObj = this.calculateExactAge(cDob, refDateStr);
        const ageDiff = this.calculateAgeDifference(ageDir.olderDob, ageDir.youngerDob);

        // Mutual preference
        const mutualPref = this.evaluateMutualPreference(selectedProfile, candidateProfile, refDateStr);

        // Transparent explanation generator
        const gapText = ageDir.isSameDob ? 'Same exact DOB' : `${ageDiff.display} older`;
        let explanation = '';

        if (isSameMaslak) {
            if (mutualPref.combinedStatus === 'BOTH_EXACT') {
                explanation = `Same Maslak (${matchedMaslakOriginal}). Gender compatible. Groom is ${gapText}. Both age preferences are satisfied.`;
            } else if (mutualPref.combinedStatus === 'ONE_EXACT_ONE_FLEXIBLE' || mutualPref.combinedStatus === 'BOTH_FLEXIBLE') {
                explanation = `Same Maslak (${matchedMaslakOriginal}). Gender compatible. Groom is ${gapText}. Flexible age preference match within 2 years.`;
            } else if (mutualPref.combinedStatus === 'OUTSIDE') {
                explanation = `Same Maslak (${matchedMaslakOriginal}). Gender compatible. Groom is ${gapText}. Outside stated age preference. Shown for Admin review.`;
            } else {
                explanation = `Same Maslak (${matchedMaslakOriginal}). Gender compatible. Groom is ${gapText}. One or both age preferences are missing. Please review.`;
            }
        } else {
            if (mutualPref.combinedStatus === 'BOTH_EXACT') {
                explanation = `Admin selected ${matchedMaslakOriginal} as an additional Maslak. Gender compatible. Groom is ${gapText}. Both age preferences are satisfied.`;
            } else if (mutualPref.combinedStatus === 'ONE_EXACT_ONE_FLEXIBLE' || mutualPref.combinedStatus === 'BOTH_FLEXIBLE') {
                explanation = `Admin selected ${matchedMaslakOriginal} as an additional Maslak. Gender compatible. Groom is ${gapText}. Flexible preference match within 2 years.`;
            } else if (mutualPref.combinedStatus === 'OUTSIDE') {
                explanation = `Admin selected ${matchedMaslakOriginal} as an additional Maslak. Gender compatible. Groom is ${gapText}. Candidate is outside stated age preference. Shown for Admin review.`;
            } else {
                explanation = `Admin selected ${matchedMaslakOriginal} as an additional Maslak. Gender compatible. Groom is ${gapText}. Age preference missing. Please review.`;
            }
        }

        if (manualReviewRequired) {
            explanation = `⚠️ Manual Review Required — Maslak is unspecified or non-standard. ${explanation}`;
        }

        return {
            eligible: true,
            candidate: candidateProfile,
            profileId: candidateProfile.profileId || candidateProfile.profile_id,
            fullName: candidateProfile['Full Name'] || candidateProfile.full_name,
            gender: candidateProfile.Gender || candidateProfile.gender,
            dob: cDob,
            age: cAgeObj ? cAgeObj.years : parseInt(candidateProfile.Age || candidateProfile.age, 10),
            maslak: cMaslak,
            matchedMaslak: matchedMaslakOriginal,
            groupType,
            groupPriority,
            isSameMaslak,
            manualReviewRequired,
            candidateAge: cAgeObj,
            selectedAge: sAgeObj,
            ageDiff,
            mutualPref,
            explanation,
            city: candidateProfile.City || candidateProfile.city || '',
            state: candidateProfile.State || candidateProfile.state || '',
            photoUrl: candidateProfile.photoUrl || candidateProfile.photo_url || '',
            status: candidateProfile.status || 'New'
        };
    },

    // Deterministic ranking and grouping across entire pool
    rankAndGroup(selectedProfile, allProfiles, adminSelectedMaslaks, direction, refDateStr, statusFilter = 'All') {
        if (statusFilter === null || statusFilter === undefined) {
            statusFilter = 'All';
        }
        const normStatusFilter = String(statusFilter).trim().toLowerCase();
        if (!['all', 'new', 'reviewed'].includes(normStatusFilter)) {
            throw new Error(`Invalid status filter: "${statusFilter}". Supported values are: All, New, Reviewed.`);
        }

        const evaluated = [];
        let totalExamined = allProfiles.length;
        let oppositeGenderCount = 0;
        let sameMaslakCount = 0;
        let additionalMaslakCount = 0;
        let ageDirectionEligibleCount = 0;
        let bothExactCount = 0;
        let flexibleCount = 0;
        let outsideCount = 0;
        let missingCount = 0;

        const targetGender = direction === 'bride' ? 'Male' : 'Female';
        const sMaslak = selectedProfile.Maslak || selectedProfile.maslak || '';
        const sMaslakNorm = this.normalizeMaslak(sMaslak);
        const sId = selectedProfile.id;
        const sPid = selectedProfile.profileId || selectedProfile.profile_id;

        for (const candidate of allProfiles) {
            const cId = candidate.id;
            const cPid = candidate.profileId || candidate.profile_id;

            // Skip the selected profile itself
            if ((sId && cId === sId) || (sPid && cPid === sPid)) {
                continue;
            }

            // Filter by candidate status according to statusFilter
            const cStatus = candidate.status;
            if (normStatusFilter === 'all') {
                if (!['New', 'Reviewed'].includes(cStatus)) continue;
            } else if (normStatusFilter === 'new') {
                if (cStatus !== 'New') continue;
            } else if (normStatusFilter === 'reviewed') {
                if (cStatus !== 'Reviewed') continue;
            }

            const cGender = (candidate.Gender || candidate.gender || '').trim();
            if (cGender.toLowerCase() === targetGender.toLowerCase()) {
                oppositeGenderCount++;
            }

            const res = this.evaluatePair(selectedProfile, candidate, adminSelectedMaslaks, direction, refDateStr);
            if (res.eligible) {
                evaluated.push(res);
                ageDirectionEligibleCount++;

                if (res.isSameMaslak) sameMaslakCount++;
                else additionalMaslakCount++;

                if (res.mutualPref.combinedStatus === 'BOTH_EXACT') bothExactCount++;
                else if (res.mutualPref.combinedStatus === 'ONE_EXACT_ONE_FLEXIBLE' || res.mutualPref.combinedStatus === 'BOTH_FLEXIBLE') flexibleCount++;
                else if (res.mutualPref.combinedStatus === 'OUTSIDE') outsideCount++;
                else missingCount++;
            }
        }

        // Deterministic multi-tier sort:
        // Tier 1: groupPriority (Same Maslak first = 0, then additional Maslaks in Admin selection order = 1, 2, ...)
        // Tier 2: ageDiff.diffDays ascending (closest age gap first)
        // Tier 3: mutualPref.combinedRank ascending (BOTH_EXACT(1) > ONE_EXACT_ONE_FLEXIBLE(2) > BOTH_FLEXIBLE(3) > OUTSIDE(4) > MISSING(5))
        // Tier 4: profileId ascending (stable tie-breaker)
        evaluated.sort((a, b) => {
            if (a.groupPriority !== b.groupPriority) {
                return a.groupPriority - b.groupPriority;
            }
            if (a.ageDiff.diffDays !== b.ageDiff.diffDays) {
                return a.ageDiff.diffDays - b.ageDiff.diffDays;
            }
            if (a.mutualPref.combinedRank !== b.mutualPref.combinedRank) {
                return a.mutualPref.combinedRank - b.mutualPref.combinedRank;
            }
            return String(a.profileId || '').localeCompare(String(b.profileId || ''));
        });

        // Top 5 Recommended: First 5 entries of the overall ordered list
        const top5 = evaluated.slice(0, 5);
        const top5Ids = new Set(top5.map(m => String(m.profileId || m.profile_id || (m.candidate && (m.candidate.profileId || m.candidate.profile_id)))));

        // Result Groups (complete group matches preserving algorithm contract)
        const groups = [];
        // Remaining Groups strictly partitioned: Top5ProfileIDs ∩ RemainingGroupProfileIDs = ∅
        const remainingGroups = [];
        const remainingMatches = evaluated.filter(item => {
            const pid = String(item.profileId || item.profile_id || (item.candidate && (item.candidate.profileId || item.candidate.profile_id)));
            return !top5Ids.has(pid);
        });

        const isSpecialSelected = this.isSpecialNonMaslak(sMaslak);
        const hasSameMaslakSelected = !isSpecialSelected && adminSelectedMaslaks.some(m => this.normalizeMaslak(m) === sMaslakNorm);
        if (hasSameMaslakSelected) {
            const sameMatches = evaluated.filter(item => item.groupType === 'SAME_MASLAK');
            groups.push({
                groupType: 'SAME_MASLAK',
                maslak: sMaslak,
                title: `Same Maslak Matches — ${sMaslak}`,
                matches: sameMatches,
                count: sameMatches.length
            });

            const sameRemaining = remainingMatches.filter(item => item.groupType === 'SAME_MASLAK');
            remainingGroups.push({
                groupType: 'SAME_MASLAK',
                maslak: sMaslak,
                title: `Same Maslak Matches — ${sMaslak}`,
                matches: sameRemaining,
                count: sameRemaining.length
            });
        }

        for (const maslak of adminSelectedMaslaks) {
            if (!isSpecialSelected && this.normalizeMaslak(maslak) === sMaslakNorm) continue;
            const addMatches = evaluated.filter(item => item.groupType === 'ADDITIONAL_MASLAK' && this.normalizeMaslak(item.matchedMaslak) === this.normalizeMaslak(maslak));
            groups.push({
                groupType: 'ADDITIONAL_MASLAK',
                maslak: maslak,
                title: `Additional Maslak Matches — ${maslak}`,
                matches: addMatches,
                count: addMatches.length
            });

            const addRemaining = remainingMatches.filter(item => item.groupType === 'ADDITIONAL_MASLAK' && this.normalizeMaslak(item.matchedMaslak) === this.normalizeMaslak(maslak));
            remainingGroups.push({
                groupType: 'ADDITIONAL_MASLAK',
                maslak: maslak,
                title: `Additional Maslak Matches — ${maslak}`,
                matches: addRemaining,
                count: addRemaining.length
            });
        }

        return {
            summary: {
                totalExamined,
                oppositeGenderCount,
                sameMaslakCount,
                additionalMaslakCount,
                ageDirectionEligibleCount,
                bothExactCount,
                flexibleCount,
                outsideCount,
                missingCount,
                totalEligibleMatches: evaluated.length
            },
            allOrderedMatches: evaluated,
            top5,
            groups,
            remainingGroups
        };
    }
};

window.AIMatchingEngine = AIMatchingEngine;

// ============================================================================
// 2. ADMIN UI CONTROLLER & WORKFLOW
// ============================================================================
let matchingState = {
    direction: 'bride', // 'bride' or 'groom'
    selectedProfileId: null,
    selectedProfile: null,
    selectedMaslaks: [], // Array of maslak strings in Admin selection order
    statusFilter: 'All', // 'All', 'New', or 'Reviewed'
    rawResult: null, // Output from RPC or mock fixture
    filteredMatches: [], // Filtered array of allOrderedMatches
    currentPage: 1,
    pageSize: 10,
    activeFilters: {
        status: 'All',
        maslak: 'All',
        preference: 'All',
        ageGap: 'All',
        search: ''
    }
};

window.matchingState = matchingState;

// Save matching configuration to sessionStorage for persistence across navigation
function saveMatchingStateToSession() {
    try {
        const stateToSave = {
            direction: matchingState.direction,
            selectedProfileId: matchingState.selectedProfileId,
            selectedMaslaks: matchingState.selectedMaslaks
        };
        sessionStorage.setItem('noor_ai_matching_state', JSON.stringify(stateToSave));
    } catch (e) {
        console.warn('[AI Matching] Failed to save matching state to sessionStorage', e);
    }
}

// Restore matching configuration from sessionStorage
function restoreMatchingStateFromSession() {
    try {
        const saved = sessionStorage.getItem('noor_ai_matching_state');
        if (!saved) return false;
        const parsed = JSON.parse(saved);
        if (!parsed || !parsed.selectedProfileId) return false;
        
        const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
        const p = allProfiles.find(item => (item.profileId || item.profile_id) === parsed.selectedProfileId);
        if (!p) return false;

        if (parsed.direction && parsed.direction !== matchingState.direction) {
            setMatchingDirection(parsed.direction, false);
        }

        selectMatchingProfile(p.profileId || p.profile_id, false);

        if (Array.isArray(parsed.selectedMaslaks) && parsed.selectedMaslaks.length > 0) {
            const chkPrimary = document.getElementById('chkPrimaryMaslak');
            if (chkPrimary) {
                const sMaslak = p.Maslak || p.maslak || '';
                chkPrimary.checked = parsed.selectedMaslaks.some(m => AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(sMaslak));
            }
            document.querySelectorAll('.additional-maslak-chk').forEach(chk => {
                chk.checked = parsed.selectedMaslaks.some(m => AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(chk.value));
            });
            handleMaslakSelectionChange();
        }
        return true;
    } catch (e) {
        console.warn('[AI Matching] Failed to restore matching state from sessionStorage', e);
        return false;
    }
}

// Initialize view when navigated to
async function initMatchingView() {
    console.log('[AI Matching] Initializing matching view...');
    
    // Refresh active pairs cache
    if (typeof refreshActivePairsCache === 'function') {
        await refreshActivePairsCache();
    }

    // Set direction to current state or default 'bride'
    setMatchingDirection(matchingState.direction || 'bride', false);

    // Bind keyboard Escape on search input
    const matchSearchInput = document.getElementById('matchProfileSearchInput');
    if (matchSearchInput && !matchSearchInput.dataset.bound) {
        matchSearchInput.dataset.bound = 'true';
        matchSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                clearSelectedMatchingProfile();
            }
        });
    }

    // If profile was already selected, refresh summary
    if (matchingState.selectedProfileId) {
        selectMatchingProfile(matchingState.selectedProfileId);
    } else {
        const restored = restoreMatchingStateFromSession();
        if (!restored) {
            clearSelectedMatchingProfile();
        }
    }
}

// Set matching direction: 'bride' (find Grooms) or 'groom' (find Brides)
function setMatchingDirection(direction, clearCurrent = true) {
    matchingState.direction = direction;

    const btnBride = document.getElementById('btnMatchBride');
    const btnGroom = document.getElementById('btnMatchGroom');
    const targetLabel = document.getElementById('matchTargetLabel');
    const directionBadge = document.getElementById('matchDirectionBadge');

    if (direction === 'bride') {
        if (btnBride) {
            btnBride.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition bg-wine text-cream shadow-sm flex items-center gap-1.5";
        }
        if (btnGroom) {
            btnGroom.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition text-wine/70 hover:text-wine hover:bg-white/60 flex items-center gap-1.5";
        }
        if (targetLabel) targetLabel.textContent = "Select Bride Profile";
        if (directionBadge) {
            directionBadge.textContent = "Female → Male (Grooms)";
            directionBadge.className = "px-2 py-0.5 text-[11px] font-semibold rounded-full bg-pink-50 text-pink-700 border border-pink-200";
        }
    } else {
        if (btnGroom) {
            btnGroom.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition bg-wine text-cream shadow-sm flex items-center gap-1.5";
        }
        if (btnBride) {
            btnBride.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition text-wine/70 hover:text-wine hover:bg-white/60 flex items-center gap-1.5";
        }
        if (targetLabel) targetLabel.textContent = "Select Groom Profile";
        if (directionBadge) {
            directionBadge.textContent = "Male → Female (Brides)";
            directionBadge.className = "px-2 py-0.5 text-[11px] font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200";
        }
    }

    if (clearCurrent) {
        clearSelectedMatchingProfile();
    }
}

// Search profiles for autocomplete dropdown
function handleMatchProfileSearch(query) {
    const dropdown = document.getElementById('matchProfileDropdown');
    const clearBtn = document.getElementById('matchClearSelectedProfileBtn');
    const rawVal = query !== undefined && query !== null ? String(query) : '';
    const q = rawVal.trim().toLowerCase();

    // Toggle clear button immediately on typing
    if (clearBtn) {
        if (rawVal.trim().length > 0 || matchingState.selectedProfileId) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }

    if (!q) {
        if (dropdown) dropdown.classList.add('hidden');
        return;
    }
    if (!dropdown) return;
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const expectedGender = matchingState.direction === 'bride' ? 'Female' : 'Male';

    const filtered = allProfiles.filter(p => {
        // Enforce strict target profile eligibility: ONLY 'New' (Pending Review) and 'Reviewed' profiles
        const status = (p.status || '').trim();
        if (status !== 'New' && status !== 'Reviewed') return false;

        const g = (p.Gender || p.gender || '').trim();
        if (g.toLowerCase() !== expectedGender.toLowerCase()) return false;
        if (!q) return true;

        if (typeof window.matchesMasterSearch === 'function') {
            return window.matchesMasterSearch(p, q);
        }

        const pid = (p.profileId || p.profile_id || '').toLowerCase();
        const name = (p['Full Name'] || p.full_name || '').toLowerCase();
        const maslak = (p.Maslak || p.maslak || '').toLowerCase();
        const city = (p.City || p.city || '').toLowerCase();

        return pid.includes(q) || name.includes(q) || maslak.includes(q) || city.includes(q);
    });

    if (filtered.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-wine/50 text-center">No ${expectedGender} profiles found matching "${query}".</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    let html = '';
    filtered.slice(0, 15).forEach(p => {
        const pid = p.profileId || p.profile_id;
        const name = p['Full Name'] || p.full_name || 'Unnamed';
        const age = p.Age || p.age || '—';
        const maslak = p.Maslak || p.maslak || 'Unspecified';
        const city = p.City || p.city || '—';

        html += `
            <div onclick="selectMatchingProfile('${pid}')" class="px-3.5 py-2.5 hover:bg-[#FAF8F5] cursor-pointer flex items-center justify-between border-b border-gold/10 last:border-0 transition">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-full bg-wine/10 text-wine flex items-center justify-center text-xs font-bold font-serif">
                        ${name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div class="text-xs font-bold text-wine flex items-center gap-1.5">
                            <span>${name}</span>
                            <span class="text-[10px] font-mono px-1.5 py-0.2 bg-gold/15 text-wine/80 rounded border border-gold/30">${pid}</span>
                        </div>
                        <div class="text-[11px] text-wine/60">
                            ${age} yrs • ${maslak} • ${city}
                        </div>
                    </div>
                </div>
                <span class="text-xs text-gold font-medium hover:underline">Select</span>
            </div>
        `;
    });

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');
}

// Select a profile from dropdown or ID
function selectMatchingProfile(profileId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const p = allProfiles.find(item => (item.profileId || item.profile_id) === profileId);

    const dropdown = document.getElementById('matchProfileDropdown');
    if (dropdown) dropdown.classList.add('hidden');

    if (!p) {
        console.warn('[AI Matching] Profile not found:', profileId);
        return;
    }

    // Strict client-side gender validation against current search direction
    const expectedGender = matchingState.direction === 'bride' ? 'Female' : 'Male';
    const profileGender = (p.Gender || p.gender || '').trim();
    if (profileGender.toLowerCase() !== expectedGender.toLowerCase()) {
        const errorMsg = `Selected profile (${profileId} - ${p['Full Name'] || p.full_name}) has gender "${profileGender || 'unspecified'}", but current direction is searching for a ${expectedGender}. Please select a valid ${expectedGender} profile.`;
        console.warn('[AI Matching] Gender mismatch in selectMatchingProfile:', errorMsg);
        if (typeof showDialog === 'function') {
            showDialog('warning', 'Gender Mismatch', errorMsg);
        } else {
            alert(errorMsg);
        }
        return;
    }

    // Strict client-side status eligibility validation: ONLY 'New' and 'Reviewed'
    const profileStatus = (p.status || '').trim();
    if (profileStatus !== 'New' && profileStatus !== 'Reviewed') {
        const errorMsg = `Selected profile (${profileId} - ${p['Full Name'] || p.full_name}) has status "${profileStatus || 'unspecified'}", but AI Matching only accepts profiles with status "New" (Pending Review) or "Reviewed".`;
        console.warn('[AI Matching] Status eligibility rejection in selectMatchingProfile:', errorMsg);
        if (typeof showDialog === 'function') {
            showDialog('warning', 'Ineligible Status', errorMsg);
        } else {
            alert(errorMsg);
        }
        return;
    }

    matchingState.selectedProfileId = profileId;
    matchingState.selectedProfile = p;

    // Update search input
    const searchInput = document.getElementById('matchProfileSearchInput');
    if (searchInput) searchInput.value = `${p['Full Name'] || p.full_name} (${profileId})`;

    const clearBtn = document.getElementById('matchClearSelectedProfileBtn');
    if (clearBtn) clearBtn.classList.remove('hidden');

    const emptyPlaceholder = document.getElementById('matchSelectedProfileEmpty');
    if (emptyPlaceholder) emptyPlaceholder.classList.add('hidden');

    // Render Selected Profile Summary Card
    renderSelectedProfileSummaryCard(p);

    // Populate Maslak selection interface
    populateMaslakSelector(p, allProfiles);

    // Update Eligible Candidates Quick Count
    updateQuickCountNotice(p, allProfiles);

    // Save selection to session
    saveMatchingStateToSession();
}

// Render Selected Profile Summary Card
function renderSelectedProfileSummaryCard(p) {
    const card = document.getElementById('matchSelectedProfileCard');
    if (!card) return;

    const pid = p.profileId || p.profile_id;
    const name = p['Full Name'] || p.full_name || 'Unnamed';
    const gender = p.Gender || p.gender || '—';
    const dob = p['Date of Birth'] || p.date_of_birth || '';
    const ageObj = AIMatchingEngine.calculateExactAge(dob);
    const ageDisplay = ageObj ? `${ageObj.years} yrs, ${ageObj.months} mos` : (p.Age || p.age || '—') + ' yrs';
    const maslak = p.Maslak || p.maslak || 'Unspecified';
    const prefRange = p['Preferred Age Range'] || p.preferred_age_range || 'Not Specified';
    const city = p.City || p.city || '—';
    const state = p.State || p.state || '—';

    // Check if Maslak is non-standard
    const STANDARD_MASLAKS = ['deobandi', 'barelvi', 'ahle hadees', 'salafi', 'tableeghi jamaat', 'sunni', 'shia', 'ahle sunnat', 'wahabi'];
    const isStandardMaslak = maslak && STANDARD_MASLAKS.includes(AIMatchingEngine.normalizeMaslak(maslak));
    const specialWarningEl = document.getElementById('matchSpecialMaslakWarning');
    if (specialWarningEl) {
        if (!isStandardMaslak) {
            specialWarningEl.classList.remove('hidden');
        } else {
            specialWarningEl.classList.add('hidden');
        }
    }

    card.innerHTML = `
        <div class="flex items-start justify-between gap-2 sm:gap-3 pb-3 border-b border-gold/15">
            <div class="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-wine to-burg text-gold-lt flex items-center justify-center text-base sm:text-lg font-serif font-bold shadow-sm shrink-0">
                    ${name.charAt(0).toUpperCase()}
                </div>
                <div class="overflow-hidden min-w-0 flex-1">
                    <h4 class="font-serif text-sm sm:text-base font-bold text-wine leading-tight truncate">${name}</h4>
                    <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span class="font-mono text-xs font-semibold px-2 py-0.5 bg-gold/20 text-wine rounded-md border border-gold/30">${pid}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full ${gender === 'Female' ? 'bg-pink-100 text-pink-800' : 'bg-blue-100 text-blue-800'} font-semibold text-[11px]">${gender}</span>
                    </div>
                </div>
            </div>
            <button onclick="clearSelectedMatchingProfile()" class="text-xs px-2.5 py-1 text-wine/70 hover:text-wine rounded-lg border border-gold/30 hover:bg-gold/10 transition shrink-0 self-center">Change</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-3 pt-3 text-xs">
            <div>
                <span class="text-wine/60 text-[11px] block">Exact Age & DOB:</span>
                <span class="font-semibold text-wine">${ageDisplay}</span>
                <span class="text-[10px] text-wine/50 block font-mono">(${dob || 'No DOB'})</span>
            </div>
            <div>
                <span class="text-wine/60 text-[11px] block">Maslak / Sect:</span>
                <span class="font-semibold text-wine">${maslak}</span>
                ${!isStandardMaslak ? '<span class="text-[10px] text-amber-700 block font-medium">⚠️ Review needed</span>' : ''}
            </div>
            <div>
                <span class="text-wine/60 text-[11px] block">Age Preference:</span>
                <span class="font-semibold text-wine">${prefRange}</span>
            </div>
            <div>
                <span class="text-wine/60 text-[11px] block">Location:</span>
                <span class="font-semibold text-wine">${city}${state && state !== '—' ? ', ' + state : ''}</span>
            </div>
        </div>
    `;

    card.classList.remove('hidden');
}

// Clear selected profile
function clearSelectedMatchingProfile() {
    matchingState.selectedProfileId = null;
    matchingState.selectedProfile = null;
    matchingState.selectedMaslaks = [];
    matchingState.rawResult = null;
    matchingState.filteredMatches = [];

    try {
        sessionStorage.removeItem('noor_ai_matching_state');
    } catch(e) {}

    const searchInput = document.getElementById('matchProfileSearchInput');
    if (searchInput) searchInput.value = '';

    const clearBtn = document.getElementById('matchClearSelectedProfileBtn');
    if (clearBtn) clearBtn.classList.add('hidden');

    const dropdown = document.getElementById('matchProfileDropdown');
    if (dropdown) dropdown.classList.add('hidden');

    const card = document.getElementById('matchSelectedProfileCard');
    if (card) card.classList.add('hidden');

    const emptyPlaceholder = document.getElementById('matchSelectedProfileEmpty');
    if (emptyPlaceholder) emptyPlaceholder.classList.remove('hidden');

    const specialWarningEl = document.getElementById('matchSpecialMaslakWarning');
    if (specialWarningEl) specialWarningEl.classList.add('hidden');

    const resultsContainer = document.getElementById('matchResultsContainer');
    if (resultsContainer) resultsContainer.classList.add('hidden');

    const executeBtn = document.getElementById('btnExecuteMatch');
    if (executeBtn) executeBtn.disabled = true;

    // Reset Maslak selector
    const primaryLabel = document.getElementById('lblPrimaryMaslak');
    if (primaryLabel) primaryLabel.textContent = '—';
    const primaryCount = document.getElementById('cntPrimaryMaslak');
    if (primaryCount) primaryCount.textContent = '—';

    const addContainer = document.getElementById('matchAdditionalMaslaksContainer');
    if (addContainer) addContainer.innerHTML = '<div class="text-xs text-wine/40 col-span-2">Select a profile to load available Maslak groups.</div>';

    const chipsContainer = document.getElementById('matchSelectionOrderChips');
    if (chipsContainer) chipsContainer.innerHTML = '<span class="text-wine/40 italic">None</span>';
}

// Populate Maslak selection interface with dynamic values and counts
function populateMaslakSelector(selectedProfile, allProfiles) {
    const sMaslak = (selectedProfile.Maslak || selectedProfile.maslak || '').trim();
    const targetGender = matchingState.direction === 'bride' ? 'Male' : 'Female';

    // 1. Primary Maslak container
    const primaryLabel = document.getElementById('lblPrimaryMaslak');
    const primaryCount = document.getElementById('cntPrimaryMaslak');
    const chkPrimary = document.getElementById('chkPrimaryMaslak');

    if (primaryLabel) primaryLabel.textContent = sMaslak || 'Unspecified';
    if (chkPrimary) chkPrimary.checked = true;

    // Count opposite-gender profiles for primary Maslak
    const primaryOppositeCount = allProfiles.filter(p => {
        const g = (p.Gender || p.gender || '').trim();
        const m = (p.Maslak || p.maslak || '').trim();
        return g.toLowerCase() === targetGender.toLowerCase() && 
               AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(sMaslak);
    }).length;

    if (primaryCount) primaryCount.textContent = `${primaryOppositeCount} eligible ${targetGender.toLowerCase()}s`;

    // 2. Discover all unique Maslak values from profiles
    const maslakSet = new Set();
    ['Sunni', 'Deobandi', 'Ahle Hadees', 'Ahle Sunnat', 'Wahabi'].forEach(m => maslakSet.add(m));

    allProfiles.forEach(p => {
        const m = (p.Maslak || p.maslak || '').trim();
        if (m) maslakSet.add(m);
    });

    const additionalMaslaks = Array.from(maslakSet).filter(m => {
        return AIMatchingEngine.normalizeMaslak(m) !== AIMatchingEngine.normalizeMaslak(sMaslak);
    }).sort();

    const addContainer = document.getElementById('matchAdditionalMaslaksContainer');
    if (addContainer) {
        let html = '';
        additionalMaslaks.forEach((maslak, idx) => {
            const count = allProfiles.filter(p => {
                const g = (p.Gender || p.gender || '').trim();
                const m = (p.Maslak || p.maslak || '').trim();
                return g.toLowerCase() === targetGender.toLowerCase() && 
                       AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(maslak);
            }).length;

            html += `
                <div class="flex items-center justify-between p-2 rounded-xl hover:bg-[#FAF8F5] border border-gold/10 transition">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="chkMaslak_${idx}" value="${maslak}" class="additional-maslak-chk w-4 h-4 text-wine accent-wine rounded border-gold/30 cursor-pointer" onchange="handleMaslakSelectionChange()">
                        <label for="chkMaslak_${idx}" class="text-xs font-medium text-wine cursor-pointer">${maslak}</label>
                    </div>
                    <span class="text-[11px] text-wine/50 font-mono">${count}</span>
                </div>
            `;
        });
        addContainer.innerHTML = html;
    }

    handleMaslakSelectionChange();
}

// Handle checkbox changes and maintain ordered selection
function handleMaslakSelectionChange() {
    const sProfile = matchingState.selectedProfile;
    const sMaslak = sProfile ? (sProfile.Maslak || sProfile.maslak || '').trim() : '';

    const chkPrimary = document.getElementById('chkPrimaryMaslak');
    const addCheckboxes = document.querySelectorAll('.additional-maslak-chk:checked');

    const selectedList = [];

    // If Primary Maslak is checked, it is ALWAYS FIRST (Group Priority 0)
    if (chkPrimary && chkPrimary.checked && sMaslak) {
        selectedList.push(sMaslak);
    }

    addCheckboxes.forEach(chk => {
        const val = chk.value;
        if (!selectedList.some(m => AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(val))) {
            selectedList.push(val);
        }
    });

    matchingState.selectedMaslaks = selectedList;

    const chipsContainer = document.getElementById('matchSelectionOrderChips');
    if (chipsContainer) {
        if (selectedList.length === 0) {
            chipsContainer.innerHTML = '<span class="text-amber-700 italic">No Maslak selected. Please select at least one.</span>';
        } else {
            let chipsHtml = '';
            selectedList.forEach((m, idx) => {
                const isPrimary = !AIMatchingEngine.isSpecialNonMaslak(sMaslak) && (AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(sMaslak));
                chipsHtml += `
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${isPrimary ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-gold/20 text-wine border border-gold/40'}">
                        <span>${idx + 1}. ${m}</span>
                        <span class="text-[10px] opacity-75">${isPrimary ? '(Primary)' : '(Additional)'}</span>
                    </span>
                `;
            });
            chipsContainer.innerHTML = chipsHtml;
        }
    }

    const warning = document.getElementById('matchMaslakWarning');
    const executeBtn = document.getElementById('btnExecuteMatch');

    if (selectedList.length === 0) {
        if (warning) warning.classList.remove('hidden');
        if (executeBtn) executeBtn.disabled = true;
    } else {
        if (warning) warning.classList.add('hidden');
        if (executeBtn && matchingState.selectedProfileId) {
            executeBtn.disabled = false;
        }
    }

    saveMatchingStateToSession();
}

function selectAllMatchingMaslaks() {
    const chkPrimary = document.getElementById('chkPrimaryMaslak');
    if (chkPrimary) chkPrimary.checked = true;

    document.querySelectorAll('.additional-maslak-chk').forEach(chk => {
        chk.checked = true;
    });

    handleMaslakSelectionChange();
}

function clearAllMatchingMaslaks() {
    const chkPrimary = document.getElementById('chkPrimaryMaslak');
    if (chkPrimary) chkPrimary.checked = false;

    document.querySelectorAll('.additional-maslak-chk').forEach(chk => {
        chk.checked = false;
    });

    handleMaslakSelectionChange();
}

function resetDefaultMatchingMaslaks() {
    const chkPrimary = document.getElementById('chkPrimaryMaslak');
    if (chkPrimary) chkPrimary.checked = true;

    document.querySelectorAll('.additional-maslak-chk').forEach(chk => {
        chk.checked = false;
    });

    handleMaslakSelectionChange();
}

function updateQuickCountNotice(p, allProfiles) {
    const notice = document.getElementById('matchEligibleCandidateQuickCount');
    if (!notice) return;
    const targetGender = matchingState.direction === 'bride' ? 'Male' : 'Female';
    const eligibleOpposite = allProfiles.filter(item => {
        const itemGender = (item.Gender || item.gender || '').trim().toLowerCase();
        const itemStatus = (item.status || '').trim();
        return itemGender === targetGender.toLowerCase() && (itemStatus === 'New' || itemStatus === 'Reviewed');
    }).length;

    notice.textContent = `Ready to search across ${eligibleOpposite} eligible ${targetGender.toLowerCase()} profiles (New & Reviewed).`;
}

// Transform server RPC response into UI match structure
function transformRpcResult(data) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);

    const mapCandidate = (m) => {
        const fullProfile = allProfiles.find(p => (p.profileId || p.profile_id) === m.profile_id) || {};
        const prefStatus = m.combined_pref_status || m.mutual_pref_status || 'OUTSIDE_RANGE';
        const matchedMaslak = m.matched_maslak || m.matched_maslak_orig || m.maslak || '';
        return {
            candidate: fullProfile,
            profileId: m.profile_id,
            fullName: m.full_name,
            gender: m.gender,
            dob: m.date_of_birth,
            age: m.age,
            maslak: m.maslak,
            matchedMaslak: matchedMaslak,
            groupType: m.group_type,
            groupPriority: m.group_priority ?? 1,
            isSameMaslak: m.is_same_maslak !== undefined ? m.is_same_maslak : (m.group_type === 'SAME_MASLAK'),
            ageDiff: {
                diffDays: m.diff_days,
                display: m.age_difference_display || (m.diff_days === 0 ? 'Same exact DOB' : `${Math.floor(m.diff_days / 365)} years older`)
            },
            mutualPref: {
                combinedStatus: prefStatus,
                combinedRank: m.combined_pref_rank ?? m.mutual_pref_rank ?? 3,
                combinedLabel: String(prefStatus).replace(/_/g, ' ')
            },
            explanation: m.explanation || m.match_explanation || '',
            city: m.city || fullProfile.City || fullProfile.city || '',
            state: m.state || fullProfile.State || fullProfile.state || '',
            photoUrl: m.photo_url || fullProfile.photoUrl || fullProfile.photo_url || '',
            status: m.status || fullProfile.status || 'New',
            salary: m.salary !== undefined ? m.salary : (fullProfile.salary || fullProfile.Salary),
            education: m.education || fullProfile.education || fullProfile.Education || '',
            occupation: m.occupation || fullProfile.occupation || fullProfile.Profession || '',
            preferred_age_range: m.preferred_age_range || fullProfile.preferred_age_range || fullProfile['Preferred Age Range'] || ''
        };
    };

    const orderedMatches = (data.paginated_matches || []).map(mapCandidate);
    const top5Matches = (data.top5 || []).map(mapCandidate);
    const top5Ids = new Set(top5Matches.map(m => String(m.profileId || m.profile_id)));

    // Build groups from ordered matches (both complete groups and strictly partitioned remaining groups)
    const groupedMap = new Map();
    const remainingGroupedMap = new Map();

    orderedMatches.forEach(item => {
        const groupKey = item.matchedMaslak;
        if (!groupedMap.has(groupKey)) {
            groupedMap.set(groupKey, {
                groupType: item.groupType,
                maslak: groupKey,
                title: item.isSameMaslak ? `Same Maslak Matches — ${groupKey}` : `Additional Maslak Matches — ${groupKey}`,
                matches: []
            });
        }
        groupedMap.get(groupKey).matches.push(item);

        // Partition remaining groups: strictly exclude candidates featured in Top 5!
        // INVARIANT: Top5ProfileIDs ∩ RemainingGroupProfileIDs = ∅
        const pid = String(item.profileId || item.profile_id);
        if (!top5Ids.has(pid)) {
            if (!remainingGroupedMap.has(groupKey)) {
                remainingGroupedMap.set(groupKey, {
                    groupType: item.groupType,
                    maslak: groupKey,
                    title: item.isSameMaslak ? `Same Maslak Matches — ${groupKey}` : `Additional Maslak Matches — ${groupKey}`,
                    matches: []
                });
            }
            remainingGroupedMap.get(groupKey).matches.push(item);
        }
    });

    return {
        summary: {
            totalExamined: data.summary.total_examined,
            oppositeGenderCount: data.summary.opposite_gender_count,
            sameMaslakCount: data.summary.same_maslak_count,
            additionalMaslakCount: data.summary.additional_maslak_count,
            ageDirectionEligibleCount: data.summary.age_direction_eligible_count,
            bothExactCount: data.summary.both_exact_count,
            flexibleCount: data.summary.flexible_count,
            outsideCount: data.summary.outside_count,
            missingCount: data.summary.missing_count,
            totalEligibleMatches: data.summary.total_eligible_matches
        },
        allOrderedMatches: orderedMatches,
        top5: top5Matches,
        groups: Array.from(groupedMap.values()),
        remainingGroups: Array.from(remainingGroupedMap.values())
    };
}

// Run AI Matching: Strictly queries server RPC in production mode.
// CRITICAL HARDENING: No silent client-side fallback downloading the full table.
async function runAIMatching() {
    const sProfile = matchingState.selectedProfile;
    if (!sProfile) {
        showDialog('warning', 'Profile Required', 'Please select a profile to find matches.');
        return;
    }

    const targetStatus = (sProfile.status || '').trim();
    if (targetStatus !== 'New' && targetStatus !== 'Reviewed') {
        showDialog('warning', 'Ineligible Target Profile', `Selected profile ${sProfile.profileId || sProfile.profile_id} has status "${targetStatus}". AI Matching strictly requires target profiles to be "New" or "Reviewed".`);
        return;
    }

    if (matchingState.selectedMaslaks.length === 0) {
        showDialog('warning', 'Maslak Required', 'Please select at least one Maslak group.');
        return;
    }

    const executeBtn = document.getElementById('btnExecuteMatch');
    const originalBtnHtml = executeBtn.innerHTML;
    executeBtn.disabled = true;
    executeBtn.innerHTML = `
        <svg class="w-4 h-4 text-wine animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <span>Calculating Matches (Server RPC)...</span>
    `;

    try {
        let matchResult = null;

        const statusFilter = (document.getElementById('fltMatchStatus') ? document.getElementById('fltMatchStatus').value : null) || matchingState.statusFilter || 'All';

        // Mode A: Standalone mock preview harness (preview_ai_matching.html)
        if (window.IS_MOCK_PREVIEW) {
            console.log('[AI Matching] Running in standalone mock fixture preview mode.');
            const mockList = window.getProfiles ? window.getProfiles() : [];
            matchResult = AIMatchingEngine.rankAndGroup(
                sProfile,
                mockList,
                matchingState.selectedMaslaks,
                matchingState.direction,
                null,
                statusFilter
            );
        } else {
            // Mode B: Production Supabase Mode — STRICTLY uses authorized server RPC.
            // SECTION 12 HARDENING: Absolutely NO silent client-side fallback downloading profiles.
            if (!window.supabaseClient || typeof window.supabaseClient.rpc !== 'function') {
                throw new Error('Supabase client is not initialized. Cannot execute AI Matching RPC.');
            }

            console.log('[AI Matching] Invoking secure server RPC public.admin_find_ai_matches...');
            const { data, error } = await window.supabaseClient.rpc('admin_find_ai_matches', {
                p_selected_profile_id: sProfile.profileId || sProfile.profile_id,
                p_direction: matchingState.direction,
                p_selected_maslaks: matchingState.selectedMaslaks,
                p_status_filter: statusFilter,
                p_preference_filter: 'All',
                p_max_age_gap_days: null,
                p_city_state_search: null,
                p_page: 1,
                p_page_size: 500
            });

            if (error) {
                console.error('[AI Matching] Server RPC returned error:', error);
                let errTitle = 'Database RPC Error';
                let errMsg = `Matching query failed: ${error.message} (Code: ${error.code || 'UNKNOWN'}).`;

                if (error.code === 'PGRST202') {
                    errTitle = 'Database RPC Migration Pending';
                    errMsg = `The backend matching procedure "admin_find_ai_matches" was not found in the Supabase schema cache (Error PGRST202).\n\nPlease apply the SQL migration "supabase_ai_matching_rpc.sql" in the Supabase SQL Editor. Client-side fallback is strictly prohibited on production customer data.`;
                } else if (error.code === '42501') {
                    errTitle = 'Access Denied (42501)';
                    errMsg = 'Only the authorized administrator has permission to execute AI Matching.';
                }

                showDialog('danger', errTitle, errMsg + '\n\nWould you like to retry?', () => {
                    runAIMatching();
                }, false, 'text', [], '', 'Retry Matching', 'Close');
                return;
            }

            if (!data || !data.summary) {
                throw new Error('Server RPC returned invalid or empty matching payload.');
            }

            console.log('[AI Matching] Successfully received server RPC matching response.');
            matchResult = transformRpcResult(data);
        }

        matchingState.rawResult = matchResult;
        matchingState.filteredMatches = [...matchResult.allOrderedMatches];
        matchingState.currentPage = 1;

        // Render Summary KPI Cards
        renderMatchingKpis(matchResult.summary);

        // Populate Maslak filter options in results toolbar
        populateResultsFilterOptions();

        // Render Top 5 Recommended
        renderTop5Recommended(matchResult.top5);

        // Render Grouped Results
        renderGroupedResults(matchResult);

        // Render Pagination
        renderMatchingPagination();

        // Show Results container and smooth scroll
        const resultsContainer = document.getElementById('matchResultsContainer');
        if (resultsContainer) {
            resultsContainer.classList.remove('hidden');
            resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

    } catch (err) {
        console.error('[AI Matching] Matching failed:', err);
        // Phase 2 Hardening: Clear error presentation with Retry option. NO SILENT FALLBACK.
        showDialog(
            'warning',
            'Secure Matching Failed',
            `${err.message}\n\nPlease verify that you are logged in as the authorized administrator and that the database RPC migration is active.`,
            () => runAIMatching(),
            false,
            'text',
            [],
            '',
            'Retry Matching',
            'Dismiss'
        );
    } finally {
        executeBtn.disabled = false;
        executeBtn.innerHTML = originalBtnHtml;
    }
}

// Render Summary KPI Banner
function renderMatchingKpis(summary) {
    const kpiContainer = document.getElementById('matchKpiContainer');
    if (!kpiContainer) return;

    const cards = [
        { label: 'Examined', val: summary.totalExamined, color: 'text-wine', bg: 'bg-white' },
        { label: 'Opposite Gender', val: summary.oppositeGenderCount, color: 'text-blue-800', bg: 'bg-blue-50/50' },
        { label: 'Same Maslak', val: summary.sameMaslakCount, color: 'text-emerald-800', bg: 'bg-emerald-50/50' },
        { label: 'Additional Maslak', val: summary.additionalMaslakCount, color: 'text-indigo-800', bg: 'bg-indigo-50/50' },
        { label: 'Age-Direction OK', val: summary.ageDirectionEligibleCount, color: 'text-gold-dk', bg: 'bg-gold/10' },
        { label: 'Both Pref Match', val: summary.bothExactCount, color: 'text-emerald-700', bg: 'bg-emerald-50' },
        { label: 'Flexible (±2 Yrs)', val: summary.flexibleCount, color: 'text-amber-700', bg: 'bg-amber-50' },
        { label: 'Outside / Review', val: summary.outsideCount + summary.missingCount, color: 'text-purple-700', bg: 'bg-purple-50' }
    ];

    let html = '';
    cards.forEach(c => {
        html += `
            <div class="${c.bg} border border-gold/15 rounded-xl p-3 shadow-xs text-center flex flex-col justify-center">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-wine/60 truncate">${c.label}</span>
                <span class="text-xl font-serif font-bold ${c.color} mt-0.5">${c.val}</span>
            </div>
        `;
    });

    kpiContainer.innerHTML = html;
}

// Populate filter dropdowns in results toolbar
function populateResultsFilterOptions() {
    const maslakSelect = document.getElementById('fltMatchMaslakGroup');
    if (!maslakSelect) return;

    let html = '<option value="All">All Maslak Groups</option>';
    const sProfile = matchingState.selectedProfile;
    const sMaslak = sProfile ? (sProfile.Maslak || sProfile.maslak || '').trim() : '';

    matchingState.selectedMaslaks.forEach(m => {
        const isPrimary = !AIMatchingEngine.isSpecialNonMaslak(sMaslak) && (AIMatchingEngine.normalizeMaslak(m) === AIMatchingEngine.normalizeMaslak(sMaslak));
        html += `<option value="${m}">${isPrimary ? 'Same Maslak: ' : 'Additional: '}${m}</option>`;
    });

    maslakSelect.innerHTML = html;
}

// Render Top 5 Recommended Section
function renderTop5Recommended(top5List) {
    const container = document.getElementById('matchTop5CardsContainer');
    const top5Section = document.getElementById('matchTop5Section');
    if (!container || !top5Section) return;

    if (!top5List || top5List.length === 0) {
        top5Section.classList.add('hidden');
        return;
    }

    top5Section.classList.remove('hidden');

    let html = '';
    top5List.forEach((m, idx) => {
        html += createMatchCardHtml(m, idx + 1, true);
    });

    container.innerHTML = html;
}

// Render Grouped Results Sections
function renderGroupedResults(result) {
    const container = document.getElementById('matchGroupsContainer');
    if (!container) return;

    // Deduplication partition: Use remainingGroups or filter out top5 candidates
    // INVARIANT: Top5ProfileIDs ∩ RemainingGroupProfileIDs = ∅
    const top5Ids = new Set((result.top5 || []).map(m => String(m.profileId || m.profile_id)));
    const groupsToRender = (result.remainingGroups && result.remainingGroups.length > 0)
        ? result.remainingGroups
        : (result.groups || []).map(g => ({
            ...g,
            matches: (g.matches || []).filter(m => !top5Ids.has(String(m.profileId || m.profile_id)))
        }));

    let html = '';
    groupsToRender.forEach(group => {
        const isPrimary = (group.groupType === 'SAME_MASLAK');
        const remainingMatches = (group.matches || []).filter(m => !top5Ids.has(String(m.profileId || m.profile_id)));
        const candidateCount = remainingMatches.length;

        html += `
            <div class="bg-white border ${isPrimary ? 'border-emerald-300' : 'border-gold/20'} rounded-2xl p-5 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-gold/15">
                    <div class="flex items-center gap-2.5">
                        <span class="w-3 h-3 rounded-full ${isPrimary ? 'bg-emerald-500' : 'bg-gold'}"></span>
                        <div>
                            <h3 class="font-serif text-lg font-bold text-wine">${group.title}</h3>
                            <p class="text-xs text-wine/60">Ranked by closest age gap in days and mutual preferences (excluding Top 5).</p>
                        </div>
                    </div>
                    <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${isPrimary ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-gold/20 text-wine border border-gold/40'}">
                        ${candidateCount} ${candidateCount === 1 ? 'Candidate' : 'Candidates'}
                    </span>
                </div>
                ${candidateCount === 0
                    ? '<div class="text-center py-6 text-wine/40 text-xs italic">All candidates in this group are featured in Top 5 Recommended.</div>'
                    : `<div class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                        ${remainingMatches.slice(0, 12).map((m, idx) => createMatchCardHtml(m, idx + 1, false)).join('')}
                       </div>`
                }
            </div>
        `;
    });

    container.innerHTML = html;
}

// Generate HTML for a single Candidate Match Card
function createMatchCardHtml(m, rankNumber, isTop5) {
    const pid = m.profileId;
    const name = m.fullName || 'Candidate';
    const age = m.age;
    const ageDiffText = m.ageDiff ? m.ageDiff.display : '—';
    const maslak = m.maslak;
    const isSameMaslak = m.isSameMaslak;
    const prefStatus = m.mutualPref ? m.mutualPref.combinedStatus : 'MISSING';
    const explanation = m.explanation || '';
    const city = m.city || '—';
    const state = m.state || '—';
    const status = m.status || 'New';
    const isShortlisted = (status === 'Shortlisted');

    const sProfile = matchingState.selectedProfile;
    const sPid = sProfile ? (sProfile.profileId || sProfile.profile_id) : '';
    const brideId = matchingState.direction === 'bride' ? sPid : pid;
    const groomId = matchingState.direction === 'bride' ? pid : sPid;

    let prefBadgeClass = 'bg-gray-100 text-gray-800 border-gray-200';
    let prefBadgeText = 'Review Needed';
    if (prefStatus === 'BOTH_EXACT') {
        prefBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        prefBadgeText = 'Both Preferences Match';
    } else if (prefStatus === 'ONE_EXACT_ONE_FLEXIBLE' || prefStatus === 'BOTH_FLEXIBLE') {
        prefBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
        prefBadgeText = 'Flexible (±2 Yrs)';
    } else if (prefStatus === 'OUTSIDE') {
        prefBadgeClass = 'bg-orange-100 text-orange-800 border-orange-300';
        prefBadgeText = 'Outside Stated Preference';
    } else {
        prefBadgeClass = 'bg-purple-100 text-purple-800 border-purple-200';
        prefBadgeText = 'Preference Missing';
    }

    const maslakBadge = isSameMaslak
        ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">Same Maslak</span>`
        : `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">Additional: ${m.matchedMaslak}</span>`;

    const reviewBadge = m.manualReviewRequired
        ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-300">⚠️ Manual Review</span>`
        : '';

    return `
        <div class="bg-white border ${isTop5 ? 'border-gold/40 shadow-sm' : 'border-gold/20'} rounded-2xl p-4 flex flex-col justify-between hover:shadow-md transition relative group">
            <div>
                <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                        <div class="w-10 h-10 rounded-xl bg-wine/10 text-wine flex items-center justify-center font-serif font-bold text-sm shrink-0">
                            ${name.charAt(0).toUpperCase()}
                        </div>
                        <div class="overflow-hidden">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <h4 class="font-serif text-sm font-bold text-wine truncate">${name}</h4>
                                <span class="font-mono text-[11px] px-1.5 py-0.2 bg-gold/15 text-wine rounded border border-gold/30">${pid}</span>
                            </div>
                            <div class="text-[11px] text-wine/60 truncate">${city}${state && state !== '—' ? ', ' + state : ''}</div>
                        </div>
                    </div>
                    ${isTop5 ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-gold/30 text-wine border border-gold/50 shrink-0">#${rankNumber}</span>` : ''}
                </div>

                <div class="flex flex-wrap gap-1.5 mb-2.5">
                    ${maslakBadge}
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${prefBadgeClass} border">
                        ${prefBadgeText}
                    </span>
                    ${reviewBadge}
                </div>

                <div class="bg-[#FAF8F5] border border-gold/15 rounded-xl p-2.5 grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                        <span class="text-[10px] text-wine/50 block">Age & Difference:</span>
                        <span class="font-bold text-wine">${age} yrs</span>
                        <span class="text-[10px] text-wine/70 block">${ageDiffText}</span>
                    </div>
                    <div>
                        <span class="text-[10px] text-wine/50 block">Maslak:</span>
                        <span class="font-bold text-wine">${maslak}</span>
                        <span class="text-[10px] text-wine/70 block">${status}</span>
                    </div>
                </div>

                <div class="p-2.5 rounded-xl bg-gold/5 border border-gold/20 text-[11px] text-wine/80 leading-relaxed mb-3">
                    <span class="font-semibold text-wine block text-[10px] uppercase tracking-wider mb-0.5">Match Reason:</span>
                    "${explanation}"
                </div>
            </div>

            <div class="pt-2.5 border-t border-gold/10 flex flex-col gap-1.5 text-xs">
                <button onclick="confirmMatrimonialPair('${brideId}', '${groomId}')" class="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-gold to-gold-lt hover:from-gold-lt hover:to-gold text-wine font-bold shadow-sm transition flex items-center justify-center gap-1.5 min-h-[36px]">
                    <span>💍 Confirm Final Pair</span>
                </button>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button onclick="addMatchToShortlist('${brideId}', '${groomId}')" class="px-2 py-1.5 rounded-xl border border-gold/30 hover:bg-gold/10 text-wine font-medium transition text-center flex items-center justify-center gap-1">
                        <span>⭐ Shortlist</span>
                    </button>
                    <button onclick="viewBothProfilesModal('${brideId}', '${groomId}')" class="px-2 py-1.5 rounded-xl border border-gold/30 hover:bg-gold/10 text-wine font-medium transition text-center flex items-center justify-center gap-1">
                        <span>👁 Compare Profiles</span>
                    </button>
                    <button onclick="shareMatchingProfileWhatsApp('${pid}')" class="px-2 py-1.5 rounded-xl border border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-medium transition text-center flex items-center justify-center gap-1">
                        <span>📱 WhatsApp</span>
                    </button>
                    <button onclick="copyMatchingProfileIdText('${pid}')" class="px-2 py-1.5 rounded-xl border border-wine/20 text-wine/70 hover:bg-wine/5 transition text-center flex items-center justify-center gap-1">
                        <span>📋 Copy ID</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Apply client-side filters (Status, Maslak, preference, age gap, search)
function applyMatchingFilters() {
    if (!matchingState.rawResult) return;

    const statusEl = document.getElementById('fltMatchStatus');
    const statusFlt = statusEl ? statusEl.value : (matchingState.activeFilters?.status || 'All');
    const maslakFlt = document.getElementById('fltMatchMaslakGroup').value;
    const prefFlt = document.getElementById('fltMatchPreference').value;
    const ageGapFlt = document.getElementById('fltMatchAgeGap').value;
    const searchVal = (document.getElementById('matchResultsSearchInput').value || '').trim().toLowerCase();

    matchingState.activeFilters = {
        status: statusFlt,
        maslak: maslakFlt,
        preference: prefFlt,
        ageGap: ageGapFlt,
        search: searchVal
    };

    let list = matchingState.rawResult.allOrderedMatches;

    if (statusFlt !== 'All') {
        list = list.filter(m => (m.status || '').toLowerCase() === statusFlt.toLowerCase());
    }

    if (maslakFlt !== 'All') {
        list = list.filter(m => AIMatchingEngine.normalizeMaslak(m.matchedMaslak) === AIMatchingEngine.normalizeMaslak(maslakFlt));
    }

    if (prefFlt !== 'All') {
        list = list.filter(m => {
            const status = m.mutualPref ? m.mutualPref.combinedStatus : 'MISSING';
            if (prefFlt === 'FLEXIBLE') {
                return status === 'ONE_EXACT_ONE_FLEXIBLE' || status === 'BOTH_FLEXIBLE';
            }
            return status === prefFlt;
        });
    }

    if (ageGapFlt !== 'All') {
        const maxYears = parseInt(ageGapFlt, 10);
        list = list.filter(m => {
            const diffDays = m.ageDiff ? m.ageDiff.diffDays : 0;
            return diffDays <= maxYears * 365.25;
        });
    }

// Self-contained strict Profile ID query parser for fallback search
function parseMatchingProfileIdQuery(query) {
    if (!query) return null;
    const q = String(query).trim().toLowerCase();
    if (!q) return null;

    // Pattern 1: [NN][- /_] 4-digit-year [- /_] serial-digits (e.g. "NN-2026-34", "2026-34", "2026 34", "NN 2026 34")
    const mNum = q.match(/^(?:nn[\s\-_/]+)?(\d{4})[\s\-_/]+(\d+)$/i);
    if (mNum) {
        return {
            type: 'numeric',
            year: mNum[1],
            serialInt: parseInt(mNum[2], 10)
        };
    }

    // Pattern 2: Standalone serial with NN prefix (e.g. "NN-34", "NN 34", "NN/34")
    const mSerialOnly = q.match(/^nn[\s\-_/]+(\d{1,3})$/i);
    if (mSerialOnly) {
        return {
            type: 'serial_only',
            serialInt: parseInt(mSerialOnly[1], 10)
        };
    }

    // Pattern 3: Prefix only with 4-digit year (e.g. "NN-2026", "NN 2026")
    const mYearOnly = q.match(/^nn[\s\-_/]+(\d{4})$/i);
    if (mYearOnly) {
        return {
            type: 'year_prefix',
            year: mYearOnly[1]
        };
    }

    // Pattern 4: Explicit "NN-" prefix followed by alphanumeric tokens (e.g. "NN-GROOM-01")
    const mAlpha = q.match(/^nn[\s\-_/]+([a-z0-9]+(?:[\s\-_/]+[a-z0-9]+)*)$/i);
    if (mAlpha) {
        return {
            type: 'alphanumeric',
            key: 'nn-' + mAlpha[1].replace(/[\s\-_/]+/g, '-').toLowerCase()
        };
    }

    return null;
}

// Self-contained strict Profile ID matcher for fallback search
function checkMatchingProfileIdMatch(target, pidQuery) {
    const rawPid = String(target.profileId || target.profile_id || target['Profile ID'] || target.Profile_ID || target.id || '').trim();
    if (!rawPid) return false;

    if (pidQuery.type === 'numeric') {
        const pMatch = rawPid.match(/^(?:nn[\s\-_/]+)?(\d{4})[\s\-_/]+(\d+)$/i);
        if (pMatch) {
            return (pMatch[1] === pidQuery.year && parseInt(pMatch[2], 10) === pidQuery.serialInt);
        }
        return false;
    }

    if (pidQuery.type === 'serial_only') {
        const pMatch = rawPid.match(/^(?:nn[\s\-_/]+)?(?:\d{4}[\s\-_/]+)?(\d+)$/i);
        if (pMatch) {
            return parseInt(pMatch[1], 10) === pidQuery.serialInt;
        }
        return false;
    }

    if (pidQuery.type === 'year_prefix') {
        const pMatch = rawPid.match(/^(?:nn[\s\-_/]+)?(\d{4})[\s\-_/]+(\d+)$/i);
        if (pMatch) {
            return pMatch[1] === pidQuery.year;
        }
        return false;
    }

    if (pidQuery.type === 'alphanumeric') {
        const pAlpha = rawPid.match(/^nn[\s\-_/]+([a-z0-9]+(?:[\s\-_/]+[a-z0-9]+)*)$/i);
        if (pAlpha) {
            return ('nn-' + pAlpha[1].replace(/[\s\-_/]+/g, '-').toLowerCase()) === pidQuery.key;
        }
        return false;
    }

    return false;
}

    if (searchVal) {
        list = list.filter(m => {
            const target = m.candidate || m;
            if (typeof window !== 'undefined' && typeof window.matchesMasterSearch === 'function') {
                return window.matchesMasterSearch(target, searchVal);
            }
            // Strict standalone fallback when window.matchesMasterSearch is unavailable
            const pidQuery = (typeof window !== 'undefined' && typeof window.parseProfileIdQuery === 'function')
                ? window.parseProfileIdQuery(searchVal)
                : parseMatchingProfileIdQuery(searchVal);

            if (pidQuery) {
                // When query is a Profile ID, match strictly against Profile ID only - never substring match
                return (typeof window !== 'undefined' && typeof window.checkProfileIdMatch === 'function')
                    ? window.checkProfileIdMatch(target, pidQuery)
                    : checkMatchingProfileIdMatch(target, pidQuery);
            }

            // Normal text composite search (ONLY when query is NOT a Profile ID)
            const s = searchVal.trim().toLowerCase();
            const name = String(m.fullName || target['Full Name'] || target.full_name || target.fullName || '').toLowerCase();
            const city = String(m.city || target.City || target.city || '').toLowerCase();
            const state = String(m.state || target.State || target.state || '').toLowerCase();
            return name.includes(s) || city.includes(s) || state.includes(s);
        });
    }

    matchingState.filteredMatches = list;
    matchingState.currentPage = 1;

    renderMatchingPagination();
}

// Render pagination bar
function renderMatchingPagination() {
    const container = document.getElementById('matchPaginationContainer');
    if (!container) return;

    const total = matchingState.filteredMatches.length;
    const pageSize = matchingState.pageSize || 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = matchingState.currentPage || 1;

    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);

    container.innerHTML = `
        <div class="flex items-center gap-2">
            <span>Showing <span class="font-bold text-wine">${start}</span> to <span class="font-bold text-wine">${end}</span> of <span class="font-bold text-wine">${total}</span> matches</span>
            <span class="text-wine/40">|</span>
            <select onchange="changeMatchingPageSize(this.value)" class="text-xs bg-[#FAF8F5] border border-gold/30 rounded-lg px-2 py-1 text-wine">
                <option value="10" ${pageSize === 10 ? 'selected' : ''}>10 per page</option>
                <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 per page</option>
                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 per page</option>
            </select>
        </div>
        <div class="flex items-center gap-1.5">
            <button onclick="gotoMatchingPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg border border-gold/30 text-wine disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gold/10 transition">Prev</button>
            <span class="font-medium px-2">Page ${currentPage} of ${totalPages}</span>
            <button onclick="gotoMatchingPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg border border-gold/30 text-wine disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gold/10 transition">Next</button>
        </div>
    `;
}

function gotoMatchingPage(page) {
    const total = matchingState.filteredMatches.length;
    const pageSize = matchingState.pageSize || 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (page < 1 || page > totalPages) return;
    matchingState.currentPage = page;
    renderMatchingPagination();
}

function changeMatchingPageSize(newSize) {
    matchingState.pageSize = parseInt(newSize, 10);
    matchingState.currentPage = 1;
    renderMatchingPagination();
}

// Actions from Result Cards:
function viewMatchingProfileModal(profileId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const idx = allProfiles.findIndex(p => (p.profileId || p.profile_id) === profileId);
    if (idx !== -1 && typeof window.viewProfile === 'function') {
        window.viewProfile(idx);
    } else {
        showDialog('warning', 'Profile Not Found', `Profile ${profileId} could not be loaded.`);
    }
}

async function toggleShortlistMatchingProfile(profileId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const idx = allProfiles.findIndex(p => (p.profileId || p.profile_id) === profileId);
    if (idx === -1) return;

    const p = allProfiles[idx];
    const newStatus = (p.status === 'Shortlisted') ? 'New' : 'Shortlisted';

    if (typeof window.changeStatus === 'function') {
        await window.changeStatus(idx, newStatus, false);
        if (typeof showAdminNotification === 'function') {
            showAdminNotification(`Profile ${profileId} ${newStatus === 'Shortlisted' ? 'added to Shortlist' : 'removed from Shortlist'}`, 'success');
        }
        if (matchingState.rawResult) {
            renderTop5Recommended(matchingState.rawResult.top5);
            renderGroupedResults(matchingState.rawResult);
        }
    }
}

function shareMatchingProfileWhatsApp(profileId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const idx = allProfiles.findIndex(p => (p.profileId || p.profile_id) === profileId);
    if (idx !== -1 && typeof window.openShareSingleProfile === 'function') {
        window.openShareSingleProfile(idx);
    }
}

function copyMatchingProfileIdText(profileId) {
    navigator.clipboard.writeText(profileId).then(() => {
        if (typeof showAdminNotification === 'function') {
            showAdminNotification(`Profile ID ${profileId} copied to clipboard!`, 'success');
        } else {
            alert(`Copied Profile ID: ${profileId}`);
        }
    }).catch(err => {
        console.error('Failed to copy Profile ID:', err);
    });
}

// Export Matching Results to CSV
function exportMatchingResultsCSV() {
    if (!matchingState.filteredMatches || matchingState.filteredMatches.length === 0) {
        showDialog('info', 'Nothing to Export', 'No matches available to export.');
        return;
    }

    const sProfile = matchingState.selectedProfile;
    const sId = sProfile ? (sProfile.profileId || sProfile.profile_id) : 'Profile';

    const headers = [
        'Profile ID', 'Full Name', 'Gender', 'Age', 'Date of Birth',
        'Maslak', 'Match Group', 'Age Difference', 'Preference Status',
        'City', 'State', 'Status', 'Match Explanation'
    ];

    const expectedCount = matchingState.filteredMatches.length;
    const sanitizeMatchCell = (val) => {
        if (val === undefined || val === null || val === '') return '—';
        let str = String(val).replace(/\s*[\r\n]+\s*/g, ' | ').replace(/[ \t]{2,}/g, ' ').trim();
        if (!str) return '—';
        if (['=', '+', '-', '@', '\t', '\r'].includes(str.charAt(0))) {
            str = "'" + str;
        }
        return `"${str.replace(/"/g, '""')}"`;
    };

    const seenMatchIds = new Set();
    const rows = matchingState.filteredMatches.map(m => {
        if (m.profileId) seenMatchIds.add(m.profileId);
        return [
            m.profileId || '',
            m.fullName || '',
            m.gender || '',
            m.age || '',
            m.dob || '',
            m.maslak || '',
            m.isSameMaslak ? 'Same Maslak' : `Additional (${m.matchedMaslak})`,
            m.ageDiff ? m.ageDiff.display : '',
            m.mutualPref ? m.mutualPref.combinedStatus : '',
            m.city || '',
            m.state || '',
            m.status || '',
            m.explanation || ''
        ].map(sanitizeMatchCell).join(',');
    });

    if (rows.length !== expectedCount) {
        console.error('[Matching Export Error] Row count mismatch', { expectedCount, actualRows: rows.length });
        showDialog('error', 'Export Validation Failed', `Expected ${expectedCount} match rows but generated ${rows.length}. Export aborted.`);
        return;
    }

    const csvContent = '\uFEFF' + headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\r\n' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', `NoorENikah_Matches_For_${sId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Expose functions globally for inline onclick handlers
window.initMatchingView = initMatchingView;
window.setMatchingDirection = setMatchingDirection;
window.handleMatchProfileSearch = handleMatchProfileSearch;
window.selectMatchingProfile = selectMatchingProfile;
window.clearSelectedMatchingProfile = clearSelectedMatchingProfile;
window.handleMaslakSelectionChange = handleMaslakSelectionChange;
window.selectAllMatchingMaslaks = selectAllMatchingMaslaks;
window.clearAllMatchingMaslaks = clearAllMatchingMaslaks;
window.resetDefaultMatchingMaslaks = resetDefaultMatchingMaslaks;
window.runAIMatching = runAIMatching;
window.applyMatchingFilters = applyMatchingFilters;
window.gotoMatchingPage = gotoMatchingPage;
window.changeMatchingPageSize = changeMatchingPageSize;
window.viewMatchingProfileModal = viewMatchingProfileModal;
window.toggleShortlistMatchingProfile = toggleShortlistMatchingProfile;
window.shareMatchingProfileWhatsApp = shareMatchingProfileWhatsApp;
window.copyMatchingProfileIdText = copyMatchingProfileIdText;
window.exportMatchingResultsCSV = exportMatchingResultsCSV;
window.saveMatchingStateToSession = saveMatchingStateToSession;
window.restoreMatchingStateFromSession = restoreMatchingStateFromSession;

// ============================================================================
// 3. PAIR WORKFLOW SERVICE & LOCAL STORAGE FALLBACK STORE
// ============================================================================
const PairWorkflowService = {
    LOCAL_PAIRS_KEY: 'noor_confirmed_pairs',
    LOCAL_SHORTLISTS_KEY: 'noor_match_shortlists',

    getLocalPairs() {
        try {
            const data = localStorage.getItem(this.LOCAL_PAIRS_KEY);
            return data ? JSON.parse(data) : [];
        } catch(e) {
            return [];
        }
    },

    saveLocalPairs(pairs) {
        try {
            localStorage.setItem(this.LOCAL_PAIRS_KEY, JSON.stringify(pairs));
        } catch(e) {}
    },

    getLocalShortlists() {
        try {
            const data = localStorage.getItem(this.LOCAL_SHORTLISTS_KEY);
            return data ? JSON.parse(data) : [];
        } catch(e) {
            return [];
        }
    },

    saveLocalShortlists(sls) {
        try {
            localStorage.setItem(this.LOCAL_SHORTLISTS_KEY, JSON.stringify(sls));
        } catch(e) {}
    },

    // Populate profile details on a pair or shortlist item
    enrichPairWithProfiles(item) {
        const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
        const bId = item.bride_profile_id || (item.bride && (item.bride.profile_id || item.bride.profileId));
        const gId = item.groom_profile_id || (item.groom && (item.groom.profile_id || item.groom.profileId));

        const b = allProfiles.find(p => (p.profileId || p.profile_id) === bId) || {};
        const g = allProfiles.find(p => (p.profileId || p.profile_id) === gId) || {};
        
        return {
            id: item.id,
            bride_profile_id: bId || b.profileId || b.profile_id,
            groom_profile_id: gId || g.profileId || g.profile_id,
            status: item.status || item.pair_status || 'Active',
            stage: item.stage || 'Shortlisted',
            admin_notes: item.admin_notes || item.notes || '',
            created_at: item.created_at || new Date().toISOString(),
            updated_at: item.updated_at || new Date().toISOString(),
            released_at: item.released_at,
            bride: {
                profile_id: b.profileId || b.profile_id || bId,
                full_name: b['Full Name'] || b.full_name || 'Bride',
                gender: (b.Gender || b.gender || '').trim(),
                date_of_birth: b['Date of Birth'] || b.date_of_birth || '',
                age: b.Age || b.age || '—',
                maslak: b.Maslak || b.maslak || '—',
                city: b.City || b.city || '',
                state: b.State || b.state || '',
                photo_url: b.photoUrl || b.photo_url || '',
                salary: b.Salary || b.salary || '',
                preferred_age_range: b['Preferred Age Range'] || b.preferred_age_range || '',
                qualification: b.Education || b.education || b.Qualification || b.qualification || '',
                profession: b.Profession || b.profession || b.Occupation || b.occupation || ''
            },
            groom: {
                profile_id: g.profileId || g.profile_id || gId,
                full_name: g['Full Name'] || g.full_name || 'Groom',
                gender: (g.Gender || g.gender || '').trim(),
                date_of_birth: g['Date of Birth'] || g.date_of_birth || '',
                age: g.Age || g.age || '—',
                maslak: g.Maslak || g.maslak || '—',
                city: g.City || g.city || '',
                state: g.State || g.state || '',
                photo_url: g.photoUrl || g.photo_url || '',
                salary: g.Salary || g.salary || '',
                preferred_age_range: g['Preferred Age Range'] || g.preferred_age_range || '',
                qualification: g.Education || g.education || g.Qualification || g.qualification || '',
                profession: g.Profession || g.profession || g.Occupation || g.occupation || ''
            }
        };
    },

    async getPairs(statusFilter = 'Active') {
        let list = [];
        const isSupabaseLive = !window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function';
        if (isSupabaseLive) {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_get_pairs', {
                    p_status: statusFilter === 'History' ? 'All' : statusFilter
                });
                if (!error && Array.isArray(data)) {
                    list = data.map(p => this.enrichPairWithProfiles(p));
                }
            } catch (e) {
                console.warn('[Pairs] RPC admin_get_pairs failed:', e);
            }
        } else if (window.IS_MOCK_PREVIEW) {
            // ONLY fall back to localStorage if explicitly running in standalone fixture preview mode
            list = this.getLocalPairs().map(p => this.enrichPairWithProfiles(p));
        }

        const normFilter = (statusFilter || 'Active').trim();
        if (normFilter.toLowerCase() === 'active') {
            return list.filter(p => p.status === 'Active');
        } else if (normFilter.toLowerCase() === 'history' || normFilter.toLowerCase() === 'undone') {
            return list.filter(p => p.status !== 'Active');
        } else if (normFilter.toLowerCase() !== 'all') {
            return list.filter(p => (p.status || '').toLowerCase() === normFilter.toLowerCase());
        }
        return list;
    },

    async confirmPair(brideId, groomId, notes = '') {
        if (!brideId || !groomId) throw new Error('Both Bride Profile ID and Groom Profile ID are required.');

        // Enforce 1:1 active constraint check
        const activePairs = (await this.getPairs('Active')).filter(p => p.status === 'Active');
        const brideActive = activePairs.find(p => p.bride_profile_id === brideId);
        if (brideActive && brideActive.groom_profile_id !== groomId) {
            throw new Error(`Bride ${brideId} already has an active confirmed match with Groom ${brideActive.groom_profile_id}. Release existing pair first.`);
        }
        const groomActive = activePairs.find(p => p.groom_profile_id === groomId);
        if (groomActive && groomActive.bride_profile_id !== brideId) {
            throw new Error(`Groom ${groomId} already has an active confirmed match with Bride ${groomActive.bride_profile_id}. Release existing pair first.`);
        }

        const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
        const bProfile = allProfiles.find(p => (p.profileId || p.profile_id) === brideId);
        const gProfile = allProfiles.find(p => (p.profileId || p.profile_id) === groomId);

        // Strict client-side gender pre-validation: Bride MUST be Female, Groom MUST be Male
        if (bProfile) {
            const bGender = (bProfile.Gender || bProfile.gender || '').trim().toLowerCase();
            if (bGender !== 'female') {
                throw new Error(`Profile ${brideId} (${bProfile['Full Name'] || bProfile.full_name || 'Bride'}) is not Female (Gender: ${bProfile.Gender || bProfile.gender || 'unspecified'}). Matrimonial pairs strictly require a Female Bride.`);
            }
        }
        if (gProfile) {
            const gGender = (gProfile.Gender || gProfile.gender || '').trim().toLowerCase();
            if (gGender !== 'male') {
                throw new Error(`Profile ${groomId} (${gProfile['Full Name'] || gProfile.full_name || 'Groom'}) is not Male (Gender: ${gProfile.Gender || gProfile.gender || 'unspecified'}). Matrimonial pairs strictly require a Male Groom.`);
            }
        }

        const bOrigStatus = bProfile ? (bProfile.status || 'New') : 'New';
        const gOrigStatus = gProfile ? (gProfile.status || 'New') : 'New';

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_confirm_pair', {
                    p_bride_id: brideId,
                    p_groom_id: groomId,
                    p_notes: notes || ''
                });
                if (!error) return data;
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Pairs] RPC admin_confirm_pair failed or not deployed, using local store:', e);
            }
        }

        const local = this.getLocalPairs();
        let existing = local.find(p => p.bride_profile_id === brideId && p.groom_profile_id === groomId);
        if (existing) {
            existing.status = 'Active';
            existing.admin_notes = notes || existing.admin_notes;
            existing.bride_original_status = bOrigStatus;
            existing.groom_original_status = gOrigStatus;
            existing.confirmed_at = new Date().toISOString();
            existing.updated_at = new Date().toISOString();
            existing.unpaired_at = null;
            existing.unpair_reason = null;
            existing.released_at = null;
        } else {
            existing = {
                id: 'pair_' + Date.now(),
                bride_profile_id: brideId,
                groom_profile_id: groomId,
                status: 'Active',
                admin_notes: notes || '',
                bride_original_status: bOrigStatus,
                groom_original_status: gOrigStatus,
                confirmed_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                released_at: null
            };
            local.push(existing);
        }
        this.saveLocalPairs(local);
        return { success: true, pair_id: existing.id, message: 'Matrimonial pair confirmed successfully.' };
    },

    async unpairAndRestore(pairId, reason = '') {
        if (!pairId) throw new Error('Pair ID required.');

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_unpair_and_restore', {
                    p_pair_id: pairId,
                    p_reason: reason || ''
                });
                if (!error) return data;
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Pairs] RPC admin_unpair_and_restore failed, using local store:', e);
            }
        }

        const local = this.getLocalPairs();
        const p = local.find(item => item.id === pairId);
        if (p) {
            p.status = 'Undone';
            p.unpaired_at = new Date().toISOString();
            p.unpair_reason = reason || '';
            p.updated_at = new Date().toISOString();

            // Transactionally restore original profile statuses in local memory
            const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
            const bp = allProfiles.find(x => (x.profileId || x.profile_id) === p.bride_profile_id);
            const gp = allProfiles.find(x => (x.profileId || x.profile_id) === p.groom_profile_id);
            if (bp && p.bride_original_status) bp.status = p.bride_original_status;
            if (gp && p.groom_original_status) gp.status = p.groom_original_status;

            this.saveLocalPairs(local);
        }
        return { success: true, message: 'Pair undone successfully. Both profiles restored to their original statuses.' };
    },

    async releasePair(pairId, reason = '') {
        // Alias to unpairAndRestore
        return this.unpairAndRestore(pairId, reason);
    },

    async deletePairRecord(pairId) {
        if (!pairId) throw new Error('Pair ID required.');

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_delete_pair_record', {
                    p_pair_id: pairId
                });
                if (!error) return data;
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Pairs] RPC admin_delete_pair_record failed, using local store:', e);
            }
        }

        const local = this.getLocalPairs();
        const idx = local.findIndex(item => item.id === pairId);
        if (idx !== -1) {
            local.splice(idx, 1);
            this.saveLocalPairs(local);
        }
        return { success: true, message: 'Pair history record deleted permanently. Customer profiles remain untouched.' };
    },

    async archivePair(pairId) {
        if (!pairId) throw new Error('Pair ID required.');

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_archive_pair', {
                    p_pair_id: pairId
                });
                if (!error) return data;
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Pairs] RPC admin_archive_pair failed, using local store:', e);
            }
        }

        const local = this.getLocalPairs();
        const p = local.find(item => item.id === pairId);
        if (p) {
            p.status = 'Archived';
            p.updated_at = new Date().toISOString();
            this.saveLocalPairs(local);
        }
        return { success: true, message: 'Pair archived successfully.' };
    },

    async editPairNotes(pairId, notes) {
        if (!pairId) throw new Error('Pair ID required.');

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_edit_pair_notes', {
                    p_pair_id: pairId,
                    p_notes: notes || ''
                });
                if (!error) return data;
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Pairs] RPC admin_edit_pair_notes failed, using local store:', e);
            }
        }

        const local = this.getLocalPairs();
        const p = local.find(item => item.id === pairId);
        if (p) {
            p.admin_notes = notes || '';
            p.updated_at = new Date().toISOString();
            this.saveLocalPairs(local);
        }
        return { success: true, message: 'Pair notes updated successfully.' };
    },

    async getShortlists(stageFilter = 'All', typeFilter = 'All') {
        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_get_shortlists', {
                    p_stage: stageFilter,
                    p_type: typeFilter
                });
                if (!error && data) {
                    if (Array.isArray(data)) {
                        return data.map(item => (item.shortlist_type === 'pair' || (item.bride && item.groom)) ? this.enrichPairWithProfiles(item) : item);
                    } else if (data.pair && Array.isArray(data.pair)) {
                        data.pair = data.pair.map(sl => this.enrichPairWithProfiles(sl));
                        if (Array.isArray(data.all)) {
                            data.all = data.all.map(item => (item.shortlist_type === 'pair' || (item.bride && item.groom)) ? this.enrichPairWithProfiles(item) : item);
                        }
                        return data;
                    }
                }
            } catch(e) {
                console.warn('[Shortlist] RPC admin_get_shortlists failed, using local store:', e);
            }
        }

        // Local / client-side store
        let pairList = this.getLocalShortlists().map(sl => this.enrichPairWithProfiles(sl));
        if (stageFilter !== 'All') {
            pairList = pairList.filter(sl => sl.stage && sl.stage.toLowerCase() === stageFilter.toLowerCase());
        }
        pairList.forEach(p => { p.shortlist_type = 'pair'; });

        const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
        const singleList = allProfiles.filter(p => p.status === 'Shortlisted').map(p => ({
            id: p.id || p.profileId || p.profile_id,
            shortlist_type: 'single',
            stage: 'Shortlisted',
            profile_id: p.profileId || p.profile_id,
            full_name: p.fullName || p.full_name || p['Full Name'],
            gender: p.gender || p.Gender,
            date_of_birth: p.date_of_birth || p['Date of Birth'],
            age: p.age || p.Age,
            maslak: p.maslak || p.Maslak,
            city: p.city || p.City,
            state: p.state || p.State,
            education: p.education || p.Education,
            occupation: p.occupation || p.Profession || p.occupation,
            salary: p.salary || p.Salary,
            preferred_age_range: p.preferred_age_range || p['Preferred Age Range'],
            status: p.status,
            photo_url: p.photo_url,
            created_at: p.updated_at || p.updatedAt || new Date().toISOString()
        }));

        if (typeFilter === 'Pair') return pairList;
        if (typeFilter === 'Single') return singleList;
        return {
            single: singleList,
            pair: pairList,
            all: [...singleList, ...pairList]
        };
    },

    async manageSingleShortlist(action, profileId, notes = '') {
        if (!profileId) throw new Error('Profile ID is required.');

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_manage_single_shortlist', {
                    p_action: action,
                    p_profile_id: profileId,
                    p_notes: notes || ''
                });
                if (!error) {
                    if (data && data.success === false) {
                        throw new Error(data.message || 'Operation failed');
                    }
                    this._updateLocalProfileStatus(profileId, action === 'add' ? 'Shortlisted' : 'Reviewed');
                    return data;
                }
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Shortlist] RPC admin_manage_single_shortlist failed, falling back to local update:', e);
            }
        }

        // Local / client-side update
        const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
        const target = allProfiles.find(p => (p.profileId || p.profile_id) === profileId);
        if (action === 'add' && target && target.status === 'Shortlisted') {
            throw new Error(`Profile ${profileId} is already shortlisted.`);
        }
        this._updateLocalProfileStatus(profileId, action === 'add' ? 'Shortlisted' : 'Reviewed');
        return {
            success: true,
            profile_id: profileId,
            message: action === 'add' ? 'Profile shortlisted successfully.' : 'Profile removed from shortlist.'
        };
    },

    _updateLocalProfileStatus(profileId, newStatus) {
        const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
        const target = allProfiles.find(p => (p.profileId || p.profile_id) === profileId);
        if (target) {
            target.status = newStatus;
            target.updated_at = new Date().toISOString();
        }
    },

    async manageShortlist(action, brideId, groomId, stage = 'Shortlisted', notes = '') {
        if (!brideId || !groomId) throw new Error('Both Bride Profile ID and Groom Profile ID are required.');

        if (action === 'add') {
            const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
            const bProfile = allProfiles.find(p => (p.profileId || p.profile_id) === brideId);
            const gProfile = allProfiles.find(p => (p.profileId || p.profile_id) === groomId);
            if (bProfile) {
                const bGender = (bProfile.Gender || bProfile.gender || '').trim().toLowerCase();
                if (bGender !== 'female') {
                    throw new Error(`Profile ${brideId} (${bProfile['Full Name'] || bProfile.full_name || 'Bride'}) is not Female (Gender: ${bProfile.Gender || bProfile.gender || 'unspecified'}). Pair shortlist strictly requires a Female Bride.`);
                }
            }
            if (gProfile) {
                const gGender = (gProfile.Gender || gProfile.gender || '').trim().toLowerCase();
                if (gGender !== 'male') {
                    throw new Error(`Profile ${groomId} (${gProfile['Full Name'] || gProfile.full_name || 'Groom'}) is not Male (Gender: ${gProfile.Gender || gProfile.gender || 'unspecified'}). Pair shortlist strictly requires a Male Groom.`);
                }
            }
        }

        if (!window.IS_MOCK_PREVIEW && window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            try {
                const { data, error } = await window.supabaseClient.rpc('admin_manage_shortlist', {
                    p_action: action,
                    p_bride_id: brideId,
                    p_groom_id: groomId,
                    p_stage: stage,
                    p_notes: notes || ''
                });
                if (!error) return data;
                if (error.code !== 'PGRST202') throw new Error(error.message);
            } catch(e) {
                if (e.message && !e.message.includes('PGRST202')) throw e;
                console.warn('[Shortlist] RPC admin_manage_shortlist failed, using local store:', e);
            }
        }

        const local = this.getLocalShortlists();
        const idx = local.findIndex(sl => sl.bride_profile_id === brideId && sl.groom_profile_id === groomId);

        if (action === 'add') {
            if (idx !== -1) {
                local[idx].stage = stage;
                if (notes) local[idx].admin_notes = notes;
                local[idx].updated_at = new Date().toISOString();
            } else {
                local.push({
                    id: 'sl_' + Date.now(),
                    bride_profile_id: brideId,
                    groom_profile_id: groomId,
                    stage: stage,
                    admin_notes: notes || '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            }
        } else if (action === 'update_stage') {
            if (idx !== -1) {
                local[idx].stage = stage;
                local[idx].updated_at = new Date().toISOString();
            }
        } else if (action === 'update_notes') {
            if (idx !== -1) {
                local[idx].admin_notes = notes;
                local[idx].updated_at = new Date().toISOString();
            }
        } else if (action === 'remove') {
            if (idx !== -1) {
                local.splice(idx, 1);
            }
        }
        this.saveLocalShortlists(local);
        return { success: true, message: `Shortlist ${action} completed.` };
    }
};

// Refresh active pairs cache in matching engine
async function refreshActivePairsCache() {
    try {
        const pairs = await PairWorkflowService.getPairs('Active');
        AIMatchingEngine.setActivePairs(pairs || []);
    } catch(e) {
        console.warn('[AI Matching] Could not refresh active pairs cache:', e);
    }
}

// ============================================================================
// 4. CONFIRMED PAIRS VIEW CONTROLLERS
// ============================================================================
async function initPairsView() {
    await refreshActivePairsCache();
    await renderPairsList();
}

async function refreshPairsView() {
    await refreshActivePairsCache();
    await renderPairsList();
    if (typeof showAdminNotification === 'function') {
        showAdminNotification('Confirmed pairs refreshed', 'success');
    }
}

async function renderPairsList() {
    const container = document.getElementById('pairsCardsContainer');
    const emptyState = document.getElementById('pairsEmptyState');
    const filterEl = document.getElementById('fltPairsStatus');
    const statusFilter = filterEl ? filterEl.value : 'Active';

    if (!container) return;
    container.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-wine/50"><svg class="w-6 h-6 animate-spin mx-auto mb-2 text-wine" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Loading pairs...</div>`;

    const pairs = await PairWorkflowService.getPairs(statusFilter);

    if (!pairs || pairs.length === 0) {
        container.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
            const emptyTitle = emptyState.querySelector('h4');
            const emptyDesc = emptyState.querySelector('p');
            if (statusFilter === 'Active') {
                if (emptyTitle) emptyTitle.textContent = 'No Active Confirmed Pairs';
                if (emptyDesc) emptyDesc.textContent = 'Confirmed 1-to-1 matches will appear here. Currently no profiles are actively paired.';
            } else {
                if (emptyTitle) emptyTitle.textContent = 'No Pair History Found';
                if (emptyDesc) emptyDesc.textContent = 'Undone or archived relationship records will appear here.';
            }
        }
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    let html = '';
    pairs.forEach(pair => {
        const pStatus = pair.status || 'Active';
        const isActive = (pStatus === 'Active');
        let badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        let badgeText = 'Active (1:1 Confirmed)';
        if (pStatus === 'Undone' || pStatus === 'Released') {
            badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
            badgeText = 'Undone & Restored';
        } else if (pStatus === 'Archived') {
            badgeColor = 'bg-gray-100 text-gray-700 border-gray-300';
            badgeText = 'Archived History';
        }

        const confDate = (pair.confirmed_at || pair.created_at) ? new Date(pair.confirmed_at || pair.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
        const notes = pair.admin_notes || 'No notes added.';
        const unpairReason = pair.unpair_reason || '';
        const unpairDate = pair.unpaired_at ? new Date(pair.unpaired_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

        html += `
            <div id="pair-card-${pair.id}" class="bg-white border ${isActive ? 'border-emerald-300/80 shadow-sm' : 'border-gold/25'} rounded-2xl p-4 sm:p-5 hover:shadow-md transition flex flex-col justify-between space-y-4">
                <div class="space-y-3">
                    <div class="flex items-center justify-between pb-3 border-b border-gold/15">
                        <div class="flex items-center gap-2">
                            <span class="text-base sm:text-lg">${isActive ? '💍' : '📜'}</span>
                            <span class="font-serif text-sm sm:text-base font-bold text-wine">${isActive ? 'Active Confirmed Pair' : 'Pair History Record'}</span>
                            <span class="px-2 py-0.5 text-[10px] sm:text-[11px] font-bold rounded-full ${badgeColor} border">${badgeText}</span>
                        </div>
                        <span class="text-[11px] text-wine/50 font-mono">Confirmed: ${confDate}</span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div class="p-3 bg-pink-50/50 rounded-xl border border-pink-200/60 space-y-1 text-xs">
                            <div class="flex items-center justify-between">
                                <span class="text-[10px] font-bold text-pink-700 uppercase tracking-wider">Bride</span>
                                <span class="font-mono text-[11px] font-semibold text-wine bg-white/80 px-1.5 py-0.2 rounded border border-pink-200">${pair.bride.profile_id}</span>
                            </div>
                            <h5 class="font-serif font-bold text-wine text-sm truncate">${pair.bride.full_name}</h5>
                            <p class="text-wine/70 text-[11px]">${pair.bride.age} yrs • ${pair.bride.maslak}</p>
                            <p class="text-wine/60 text-[11px] truncate">${pair.bride.city}${pair.bride.state ? ', ' + pair.bride.state : ''}</p>
                            ${pair.bride_original_status ? `<span class="inline-block mt-1 text-[10px] text-pink-800 bg-pink-100/70 px-1.5 py-0.5 rounded">Original: ${pair.bride_original_status}</span>` : ''}
                        </div>

                        <div class="p-3 bg-blue-50/50 rounded-xl border border-blue-200/60 space-y-1 text-xs">
                            <div class="flex items-center justify-between">
                                <span class="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Groom</span>
                                <span class="font-mono text-[11px] font-semibold text-wine bg-white/80 px-1.5 py-0.2 rounded border border-blue-200">${pair.groom.profile_id}</span>
                            </div>
                            <h5 class="font-serif font-bold text-wine text-sm truncate">${pair.groom.full_name}</h5>
                            <p class="text-wine/70 text-[11px]">${pair.groom.age} yrs • ${pair.groom.maslak}</p>
                            <p class="text-wine/60 text-[11px] truncate">${pair.groom.city}${pair.groom.state ? ', ' + pair.groom.state : ''}</p>
                            ${pair.groom_original_status ? `<span class="inline-block mt-1 text-[10px] text-blue-800 bg-blue-100/70 px-1.5 py-0.5 rounded">Original: ${pair.groom_original_status}</span>` : ''}
                        </div>
                    </div>

                    <div class="p-2.5 bg-[#FAF8F5] border border-gold/15 rounded-xl text-xs text-wine/80">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-[10px] font-semibold uppercase tracking-wider text-wine/60">Admin Notes</span>
                            <button onclick="editMatrimonialPairNotes('${pair.id}', \`${(pair.admin_notes || '').replace(/`/g, '\\`').replace(/'/g, "\\'")}\`)" class="text-[11px] text-gold hover:underline font-medium">Edit</button>
                        </div>
                        <p class="text-[11px] leading-relaxed whitespace-pre-line">${notes}</p>
                    </div>

                    ${!isActive && (unpairReason || unpairDate) ? `
                        <div class="p-2.5 bg-amber-50/60 border border-amber-200/80 rounded-xl text-xs text-amber-900">
                            <span class="text-[10px] font-bold uppercase tracking-wider block mb-0.5">Unpair / Undo Details</span>
                            <p class="text-[11px]">${unpairDate ? 'Undone on ' + unpairDate + '. ' : ''}${unpairReason ? 'Reason: ' + unpairReason : 'No reason recorded.'}</p>
                        </div>
                    ` : ''}
                </div>

                <div class="pt-3 border-t border-gold/15 flex flex-wrap items-center gap-2 text-xs">
                    <button onclick="viewBothProfilesModal('${pair.bride.profile_id}', '${pair.groom.profile_id}')" class="px-3 py-1.5 rounded-xl border border-gold/30 bg-gold/10 hover:bg-gold/20 text-wine font-medium transition flex items-center gap-1">
                        <span>👁 Compare Profiles</span>
                    </button>
                    ${isActive ? `
                        <button onclick="unpairAndRestoreMatrimonialPair('${pair.id}', '${pair.bride.profile_id}', '${pair.groom.profile_id}')" class="px-3 py-1.5 rounded-xl border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold transition flex items-center gap-1.5 shadow-xs">
                            <span>💍 Unpair & Restore Original Status</span>
                        </button>
                    ` : `
                        <button onclick="deletePairHistoryRecord('${pair.id}')" class="px-3 py-1.5 rounded-xl border border-red-300 bg-red-50 hover:bg-red-100 text-red-800 font-medium transition flex items-center gap-1 ml-auto">
                            <span>🗑️ Delete Pair History Record</span>
                        </button>
                    `}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Show unambiguous Already Paired Dialog (Section 4)
function showAlreadyPairedDialog(existingPair, role, conflictId) {
    const brideName = (existingPair.bride && existingPair.bride.full_name) || 'Bride';
    const bridePid = (existingPair.bride && (existingPair.bride.profile_id || existingPair.bride.profileId)) || existingPair.bride_profile_id;
    const groomName = (existingPair.groom && existingPair.groom.full_name) || 'Groom';
    const groomPid = (existingPair.groom && (existingPair.groom.profile_id || existingPair.groom.profileId)) || existingPair.groom_profile_id;
    const confDate = (existingPair.confirmed_at || existingPair.created_at) ? new Date(existingPair.confirmed_at || existingPair.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Active';

    showDialog(
        'warning',
        'Profile Already Paired',
        `This ${role} (${conflictId}) is already part of an active confirmed pair. One profile cannot have two active final pairs at the same time.\n\nExisting Active Confirmed Pair:\n• Bride: ${brideName} (${bridePid})\n• Groom: ${groomName} (${groomPid})\n• Confirmed Date: ${confDate}\n\nTo pair this profile with someone else, you must first unpair the existing active relationship.`,
        () => {
            // Action: View Existing Pair
            if (typeof navigate === 'function') {
                navigate('pairs');
                const flt = document.getElementById('fltPairsStatus');
                if (flt) {
                    flt.value = 'Active';
                    renderPairsList();
                }
                setTimeout(() => {
                    const card = document.getElementById(`pair-card-${existingPair.id}`);
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.classList.add('ring-4', 'ring-gold', 'transition-all');
                        setTimeout(() => card.classList.remove('ring-4', 'ring-gold'), 3000);
                    }
                }, 300);
            }
        },
        false,
        'text',
        [],
        '',
        'View Existing Pair',
        'Cancel'
    );
}

// Confirm Final Pair (Section 2 & 3.1)
async function confirmMatrimonialPair(brideId, groomId) {
    if (!brideId || !groomId) {
        showDialog('warning', 'Missing IDs', 'Both Bride and Groom IDs are required to confirm a pair.');
        return;
    }

    // Refresh active pairs and check
    await refreshActivePairsCache();

    // Check if Bride or Groom is already actively paired
    if (AIMatchingEngine.isProfileActivelyPaired(brideId)) {
        const existingPair = AIMatchingEngine.getActivePairForProfile(brideId);
        if (existingPair) {
            showAlreadyPairedDialog(existingPair, 'Bride', brideId);
            return;
        }
    }
    if (AIMatchingEngine.isProfileActivelyPaired(groomId)) {
        const existingPair = AIMatchingEngine.getActivePairForProfile(groomId);
        if (existingPair) {
            showAlreadyPairedDialog(existingPair, 'Groom', groomId);
            return;
        }
    }

    // Load full profile details for status snapshots
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const bride = allProfiles.find(p => (p.profileId || p.profile_id) === brideId) || { full_name: 'Bride', status: 'New' };
    const groom = allProfiles.find(p => (p.profileId || p.profile_id) === groomId) || { full_name: 'Groom', status: 'New' };

    // Strict client-side gender pre-validation: Bride MUST be Female, Groom MUST be Male
    const bGender = (bride.Gender || bride.gender || '').trim().toLowerCase();
    const gGender = (groom.Gender || groom.gender || '').trim().toLowerCase();

    if (bGender !== 'female') {
        const errorMsg = `Invalid Bride profile (${brideId} - ${bride['Full Name'] || bride.full_name}): Gender must be Female, but found "${bride.Gender || bride.gender || 'unspecified'}". Matrimonial pairs strictly require a Female Bride and Male Groom.`;
        console.error('[Pairs] Gender validation failed:', errorMsg);
        showDialog('danger', 'Gender Validation Error', errorMsg);
        return;
    }

    if (gGender !== 'male') {
        const errorMsg = `Invalid Groom profile (${groomId} - ${groom['Full Name'] || groom.full_name}): Gender must be Male, but found "${groom.Gender || groom.gender || 'unspecified'}". Matrimonial pairs strictly require a Female Bride and Male Groom.`;
        console.error('[Pairs] Gender validation failed:', errorMsg);
        showDialog('danger', 'Gender Validation Error', errorMsg);
        return;
    }

    const brideStatus = bride.status || 'New';
    const groomStatus = groom.status || 'New';

    showDialog(
        'info',
        'Confirm Final Matrimonial Pair',
        `Are you sure you want to confirm this final matrimonial pair?\n\n• Bride: ${bride.full_name || 'Bride'} (${brideId}) [Current Status: ${brideStatus}]\n• Groom: ${groom.full_name || 'Groom'} (${groomId}) [Current Status: ${groomStatus}]\n\nEffects of Confirmation:\n1. Converts this match into a final confirmed 1-to-1 relationship.\n2. Both profiles will be excluded from new AI Matchmaker results while active.\n3. Original profile statuses are preserved and will be restored exactly if this pair is later undone.\n\nEnter optional notes:`,
        async (notes) => {
            try {
                const res = await PairWorkflowService.confirmPair(brideId, groomId, notes);
                await refreshActivePairsCache();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification(res.message || 'Matrimonial pair confirmed successfully!', 'success');
                } else {
                    alert('Pair confirmed successfully!');
                }
                // Refresh matching results if currently active
                if (matchingState.rawResult) {
                    runAIMatching();
                }
                if (typeof navigate === 'function') {
                    navigate('pairs');
                }
            } catch(e) {
                showDialog('danger', 'Confirmation Failed', e.message || 'Could not confirm pair.');
            }
        },
        true,
        'textarea',
        [],
        '',
        'Confirm Final Pair',
        'Cancel'
    );
}

// Unpair & Restore Original Status (Section 5)
async function unpairAndRestoreMatrimonialPair(pairId, brideId = '', groomId = '') {
    const pairs = await PairWorkflowService.getPairs('All');
    const pair = pairs.find(p => p.id === pairId) || {};
    const bId = brideId || pair.bride_profile_id || (pair.bride && pair.bride.profile_id) || 'Bride';
    const gId = groomId || pair.groom_profile_id || (pair.groom && pair.groom.profile_id) || 'Groom';
    const bName = (pair.bride && pair.bride.full_name) || 'Bride';
    const gName = (pair.groom && pair.groom.full_name) || 'Groom';
    const bOrigStatus = pair.bride_original_status || (pair.bride && pair.bride.status) || 'New';
    const gOrigStatus = pair.groom_original_status || (pair.groom && pair.groom.status) || 'New';

    showDialog(
        'warning',
        'Unpair & Restore Original Status',
        `Are you sure you want to unpair these profiles and restore their original profile statuses?\n\n• Bride: ${bName} (${bId}) — Restores to: ${bOrigStatus}\n• Groom: ${gName} (${gId}) — Restores to: ${gOrigStatus}\n\nEffects:\n1. The active 1-to-1 relationship is removed from Active Pairs.\n2. Both customer profiles remain safely in the database (never deleted).\n3. Both profiles may appear in AI Matchmaker again only if their restored status is "New" or "Reviewed" and all matching rules pass.\n\nEnter reason for unpairing (optional):`,
        async (reason) => {
            try {
                await PairWorkflowService.unpairAndRestore(pairId, reason);
                await refreshActivePairsCache();
                await renderPairsList();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification('Pair undone successfully. Original statuses restored.', 'success');
                }
                // Refresh AI Matching if currently open
                if (matchingState.rawResult) {
                    runAIMatching();
                }
            } catch(e) {
                showDialog('danger', 'Unpair Failed', e.message);
            }
        },
        true,
        'textarea',
        [],
        '',
        'Unpair & Restore',
        'Cancel'
    );
}

// Backward-compatible alias
const releaseMatrimonialPair = unpairAndRestoreMatrimonialPair;

// Permanently delete pair history record (Section 5)
async function deletePairHistoryRecord(pairId) {
    showDialog(
        'danger',
        'Delete Pair History Record',
        'Permanently delete this pair history record from the database?\n\nNOTE: This deletes ONLY the relationship record. Customer profiles, biodata, and Profile IDs will NOT be modified or deleted.',
        async () => {
            try {
                await PairWorkflowService.deletePairRecord(pairId);
                await refreshActivePairsCache();
                await renderPairsList();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification('Pair history record deleted.', 'success');
                }
            } catch(e) {
                showDialog('danger', 'Deletion Failed', e.message);
            }
        },
        false,
        'text',
        [],
        '',
        'Delete Record',
        'Cancel'
    );
}

async function archiveMatrimonialPair(pairId) {
    showDialog(
        'danger',
        'Archive Pair Record',
        'Are you sure you want to archive this pair record? It will be moved to archived history.',
        async () => {
            try {
                await PairWorkflowService.archivePair(pairId);
                await refreshActivePairsCache();
                await renderPairsList();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification('Pair archived successfully.', 'success');
                }
            } catch(e) {
                showDialog('danger', 'Archive Failed', e.message);
            }
        },
        false,
        'text',
        [],
        '',
        'Archive',
        'Cancel'
    );
}

async function editMatrimonialPairNotes(pairId, currentNotes = '') {
    showDialog(
        'info',
        'Edit Pair Notes',
        'Update notes for this matrimonial pair:',
        async (newNotes) => {
            try {
                await PairWorkflowService.editPairNotes(pairId, newNotes);
                await renderPairsList();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification('Notes updated successfully.', 'success');
                }
            } catch(e) {
                showDialog('danger', 'Update Failed', e.message);
            }
        },
        true,
        'textarea',
        [],
        currentNotes,
        'Save Notes',
        'Cancel'
    );
}

// ============================================================================
// 5. SHORTLIST WORKFLOW CONTROLLERS (UNIFIED SINGLE PROFILES & PAIRS)
// ============================================================================
let shortlistActiveFilterTab = sessionStorage.getItem('noor_shortlist_tab') || 'all';

function setShortlistFilterTab(tab) {
    shortlistActiveFilterTab = tab;
    sessionStorage.setItem('noor_shortlist_tab', tab);

    ['all', 'single', 'pair'].forEach(t => {
        const btn = document.getElementById('tabShortlist' + t.charAt(0).toUpperCase() + t.slice(1));
        if (!btn) return;
        if (t === tab) {
            btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition bg-wine text-cream shadow-sm';
        } else {
            btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition text-wine/70 hover:text-wine hover:bg-white/60';
        }
    });

    renderShortlistedUnifiedView();
}

function filterShortlistDisplay() {
    renderShortlistedUnifiedView();
}

async function initShortlistedPairsView() {
    await renderShortlistedUnifiedView();
}

async function renderShortlistedUnifiedView() {
    const container = document.getElementById('shortlistCardsContainer');
    const emptyState = document.getElementById('shortlistEmptyState');
    const emptyTitle = document.getElementById('shortlistEmptyTitle');
    const emptyText = document.getElementById('shortlistEmptyText');
    if (!container) return;

    container.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-wine/50"><svg class="w-6 h-6 animate-spin mx-auto mb-2 text-wine" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Loading shortlisted profiles and pairs...</div>`;

    // 1. Fetch pair shortlists
    let pairShortlists = [];
    try {
        pairShortlists = await PairWorkflowService.getShortlists('Shortlisted', 'Pair');
        if (!Array.isArray(pairShortlists)) pairShortlists = [];
    } catch(e) {
        console.warn('Failed to load pair shortlists:', e);
        pairShortlists = [];
    }

    // 2. Fetch single shortlists (from all profiles where status = 'Shortlisted')
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const singleShortlists = allProfiles.filter(p => p.status === 'Shortlisted');

    // Update count labels
    const countAllEl = document.getElementById('countShortlistAll');
    const countSingleEl = document.getElementById('countShortlistSingle');
    const countPairEl = document.getElementById('countShortlistPair');
    if (countAllEl) countAllEl.textContent = singleShortlists.length + pairShortlists.length;
    if (countSingleEl) countSingleEl.textContent = singleShortlists.length;
    if (countPairEl) countPairEl.textContent = pairShortlists.length;

    // Filter by search query
    const searchVal = (document.getElementById('shortlistSearchInput')?.value || '').trim().toLowerCase();

    let filteredSingles = singleShortlists;
    if (searchVal) {
        filteredSingles = filteredSingles.filter(p => {
            if (typeof window.matchesMasterSearch === 'function') {
                return window.matchesMasterSearch(p, searchVal);
            }
            const pid = (p.profileId || p.profile_id || '').toLowerCase();
            const name = (p.fullName || p.full_name || p['Full Name'] || '').toLowerCase();
            const city = (p.city || p.City || '').toLowerCase();
            const state = (p.state || p.State || '').toLowerCase();
            const maslak = (p.maslak || p.Maslak || '').toLowerCase();
            return pid.includes(searchVal) || name.includes(searchVal) || city.includes(searchVal) || state.includes(searchVal) || maslak.includes(searchVal);
        });
    }

    let filteredPairs = pairShortlists;
    if (searchVal) {
        filteredPairs = filteredPairs.filter(item => {
            if (typeof window.matchesMasterSearch === 'function') {
                const bMatch = item.bride ? window.matchesMasterSearch(item.bride, searchVal) : false;
                const gMatch = item.groom ? window.matchesMasterSearch(item.groom, searchVal) : false;
                const noteMatch = (item.admin_notes || '').toLowerCase().includes(searchVal);
                if (bMatch || gMatch || noteMatch) return true;
            }
            const bPid = (item.bride?.profile_id || '').toLowerCase();
            const bName = (item.bride?.full_name || '').toLowerCase();
            const gPid = (item.groom?.profile_id || '').toLowerCase();
            const gName = (item.groom?.full_name || '').toLowerCase();
            const bCity = (item.bride?.city || '').toLowerCase();
            const gCity = (item.groom?.city || '').toLowerCase();
            const notes = (item.admin_notes || '').toLowerCase();
            return bPid.includes(searchVal) || bName.includes(searchVal) || gPid.includes(searchVal) || gName.includes(searchVal) || bCity.includes(searchVal) || gCity.includes(searchVal) || notes.includes(searchVal);
        });
    }

    const showSingles = (shortlistActiveFilterTab === 'all' || shortlistActiveFilterTab === 'single');
    const showPairs = (shortlistActiveFilterTab === 'all' || shortlistActiveFilterTab === 'pair');

    const totalVisible = (showSingles ? filteredSingles.length : 0) + (showPairs ? filteredPairs.length : 0);

    if (totalVisible === 0) {
        container.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
            if (emptyTitle && emptyText) {
                if (shortlistActiveFilterTab === 'single') {
                    emptyTitle.textContent = 'No Single Profiles Shortlisted';
                    emptyText.textContent = 'Use "+ Shortlist Single Profile" or click Shortlist on any profile in All Profiles to save individual candidates here.';
                } else if (shortlistActiveFilterTab === 'pair') {
                    emptyTitle.textContent = 'No Shortlisted Pairs';
                    emptyText.textContent = 'Shortlist promising match combinations from the AI Matchmaker to review them here.';
                } else {
                    emptyTitle.textContent = 'No Shortlisted Profiles or Pairs';
                    emptyText.textContent = 'Shortlist individual candidates or pair matches from the AI Matchmaker to review them here.';
                }
            }
        }
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    let html = '';

    if (shortlistActiveFilterTab === 'all') {
        filteredSingles.forEach(p => {
            html += createSingleShortlistCardHtml(p);
        });
        filteredPairs.forEach(item => {
            html += createPairShortlistCardHtml(item);
        });
    } else if (shortlistActiveFilterTab === 'single') {
        filteredSingles.forEach(p => {
            html += createSingleShortlistCardHtml(p);
        });
    } else if (shortlistActiveFilterTab === 'pair') {
        filteredPairs.forEach(item => {
            html += createPairShortlistCardHtml(item);
        });
    }

    container.innerHTML = html;
}

function createSingleShortlistCardHtml(p) {
    const pid = p.profileId || p.profile_id || '—';
    const name = p.fullName || p.full_name || p['Full Name'] || 'Candidate';
    const gender = p.gender || p.Gender || '—';
    const age = p.age || p.Age || '—';
    const dob = p.date_of_birth || p['Date of Birth'] || '';
    const maslak = p.maslak || p.Maslak || '—';
    const city = p.city || p.City || '—';
    const state = p.state || p.State || '—';
    const education = p.education || p.Education || '';
    const profession = p.occupation || p.Profession || p.occupation || '';
    const prefRange = p.preferred_age_range || p['Preferred Age Range'] || '—';
    const salaryVal = p.salary || p.Salary || p.monthly_salary;
    const salaryText = salaryVal ? `₹${Number(salaryVal).toLocaleString('en-IN')}/mo` : '—';
    const dateStr = p.updated_at || p.updatedAt ? new Date(p.updated_at || p.updatedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

    return `
        <div class="bg-white border border-gold/25 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4 relative">
            <div class="space-y-3">
                <div class="flex items-center justify-between pb-3 border-b border-gold/15">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-base sm:text-lg">👤</span>
                        <span class="font-serif text-sm sm:text-base font-bold text-wine">Single Profile</span>
                        <span class="px-2.5 py-0.5 text-[10px] sm:text-[11px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-200">Single</span>
                        <span class="px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold rounded-full ${gender.toLowerCase() === 'female' ? 'bg-pink-100 text-pink-800 border-pink-200' : 'bg-blue-50 text-blue-800 border-blue-200'} border">${gender}</span>
                    </div>
                    <span class="text-[11px] text-wine/50 font-mono">${dateStr}</span>
                </div>

                <div class="p-3.5 bg-gradient-to-br from-[#FAF8F5] to-white rounded-xl border border-gold/20 space-y-2.5">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-wine to-burg text-gold-lt flex items-center justify-center text-lg font-serif font-bold shadow-sm shrink-0">
                                ${name.charAt(0).toUpperCase()}
                            </div>
                            <div class="overflow-hidden min-w-0 flex-1">
                                <h4 class="font-serif text-base font-bold text-wine leading-tight truncate">${name}</h4>
                                <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                    <span class="font-mono text-xs font-semibold px-2 py-0.5 bg-gold/20 text-wine rounded-md border border-gold/30">${pid}</span>
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-semibold text-[11px]">Shortlisted</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-2 text-xs border-t border-gold/10">
                        <div>
                            <span class="text-wine/50 text-[10px] block">Age & DOB:</span>
                            <span class="font-semibold text-wine">${age} yrs</span>
                            <span class="text-[10px] text-wine/60 block font-mono">(${dob || '—'})</span>
                        </div>
                        <div>
                            <span class="text-wine/50 text-[10px] block">Maslak:</span>
                            <span class="font-semibold text-wine">${maslak}</span>
                        </div>
                        <div>
                            <span class="text-wine/50 text-[10px] block">Location:</span>
                            <span class="font-semibold text-wine truncate block">${city}${state && state !== '—' ? ', ' + state : ''}</span>
                        </div>
                        <div>
                            <span class="text-wine/50 text-[10px] block">Profession / Edu:</span>
                            <span class="font-semibold text-wine truncate block">${profession || education || '—'}</span>
                        </div>
                        <div>
                            <span class="text-wine/50 text-[10px] block">Salary:</span>
                            <span class="font-semibold text-wine">${salaryText}</span>
                        </div>
                        <div>
                            <span class="text-wine/50 text-[10px] block">Age Pref:</span>
                            <span class="font-semibold text-wine">${prefRange}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="pt-3 border-t border-gold/15 flex flex-wrap items-center gap-2 text-xs">
                <button onclick="viewSingleProfileFromShortlist('${pid}')" class="px-3 py-1.5 rounded-xl border border-gold/30 hover:bg-gold/10 text-wine font-medium transition flex items-center gap-1">
                    <span>👁 View Profile</span>
                </button>
                <button onclick="findMatchesForSingleShortlist('${pid}', '${gender}')" class="px-3 py-1.5 rounded-xl font-bold bg-gradient-to-r from-gold to-gold-lt text-wine shadow-sm hover:shadow transition flex items-center gap-1">
                    <span>✨ Find AI Match</span>
                </button>
                <button onclick="shareMatchingProfileWhatsApp('${pid}')" class="px-2.5 py-1.5 rounded-xl border border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-medium transition flex items-center gap-1">
                    <span>📱 WhatsApp</span>
                </button>
                <button onclick="copyMatchingProfileIdText('${pid}')" class="px-2.5 py-1.5 rounded-xl border border-wine/20 text-wine/70 hover:bg-wine/5 transition flex items-center gap-1">
                    <span>📋 Copy ID</span>
                </button>
                <button onclick="removeSingleProfileFromShortlist('${pid}')" class="px-2.5 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 font-medium transition ml-auto flex items-center gap-1">
                    <span>❌ Remove</span>
                </button>
            </div>
        </div>
    `;
}

function createPairShortlistCardHtml(item) {
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const notes = item.admin_notes || 'No notes added.';

    let stageBadge = 'bg-gold/20 text-wine border-gold/40';
    if (item.stage === 'Follow-up') stageBadge = 'bg-purple-100 text-purple-800 border-purple-200';
    if (item.stage === 'Closed') stageBadge = 'bg-gray-100 text-gray-700 border-gray-300';

    return `
        <div class="bg-white border border-gold/25 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4">
            <div class="space-y-3">
                <div class="flex items-center justify-between pb-3 border-b border-gold/15">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-base sm:text-lg">💍</span>
                        <span class="font-serif text-sm sm:text-base font-bold text-wine">Prospective Pair</span>
                        <span class="px-2.5 py-0.5 text-[10px] sm:text-[11px] font-bold rounded-full bg-purple-100 text-purple-800 border border-purple-200">Pair</span>
                        <span class="px-2 py-0.5 text-[10px] sm:text-[11px] font-bold rounded-full ${stageBadge} border">${item.stage}</span>
                    </div>
                    <span class="text-[11px] text-wine/50 font-mono">${dateStr}</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div class="p-3 bg-pink-50/50 rounded-xl border border-pink-200/60 space-y-1 text-xs">
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-bold text-pink-700 uppercase tracking-wider">Bride</span>
                            <span class="font-mono text-[11px] font-semibold text-wine bg-white/80 px-1.5 py-0.2 rounded border border-pink-200">${item.bride?.profile_id || '—'}</span>
                        </div>
                        <h5 class="font-serif font-bold text-wine text-sm truncate">${item.bride?.full_name || 'Bride'}</h5>
                        <p class="text-wine/70 text-[11px]">${item.bride?.age || '—'} yrs • ${item.bride?.maslak || '—'}</p>
                        <p class="text-wine/60 text-[11px] truncate">${item.bride?.city || '—'}${item.bride?.state ? ', ' + item.bride?.state : ''}</p>
                    </div>
                    <div class="p-3 bg-blue-50/50 rounded-xl border border-blue-200/60 space-y-1 text-xs">
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Groom</span>
                            <span class="font-mono text-[11px] font-semibold text-wine bg-white/80 px-1.5 py-0.2 rounded border border-blue-200">${item.groom?.profile_id || '—'}</span>
                        </div>
                        <h5 class="font-serif font-bold text-wine text-sm truncate">${item.groom?.full_name || 'Groom'}</h5>
                        <p class="text-wine/70 text-[11px]">${item.groom?.age || '—'} yrs • ${item.groom?.maslak || '—'}</p>
                        <p class="text-wine/60 text-[11px] truncate">${item.groom?.city || '—'}${item.groom?.state ? ', ' + item.groom?.state : ''}</p>
                    </div>
                </div>

                <div class="p-2.5 bg-[#FAF8F5] border border-gold/15 rounded-xl text-xs text-wine/80">
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-wine/60 block mb-0.5">Notes:</span>
                    <p class="text-[11px] leading-relaxed whitespace-pre-line">${notes}</p>
                </div>
            </div>

            <div class="pt-3 border-t border-gold/15 flex flex-wrap items-center gap-2 text-xs">
                <button onclick="confirmMatrimonialPair('${item.bride?.profile_id}', '${item.groom?.profile_id}')" class="px-3 py-1.5 rounded-xl font-bold bg-gradient-to-r from-gold to-gold-lt text-wine shadow-sm hover:shadow transition flex items-center gap-1">
                    <span>💍 Confirm Final Pair</span>
                </button>
                <button onclick="viewBothProfilesModal('${item.bride?.profile_id}', '${item.groom?.profile_id}')" class="px-2.5 py-1.5 rounded-xl border border-gold/30 hover:bg-gold/10 text-wine font-medium transition">
                    <span>👁 Compare Profiles</span>
                </button>
                <button onclick="updateShortlistStage('${item.bride?.profile_id}', '${item.groom?.profile_id}', 'Follow-up')" class="px-2.5 py-1.5 rounded-xl border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-900 font-medium transition">
                    <span>📞 Move to Follow-up</span>
                </button>
                <button onclick="removeShortlist('${item.bride?.profile_id}', '${item.groom?.profile_id}')" class="px-2.5 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 font-medium transition ml-auto flex items-center gap-1">
                    <span>❌ Remove</span>
                </button>
            </div>
        </div>
    `;
}

// Single Profile Shortlist Actions
function openShortlistSingleProfileModal() {
    const modal = document.getElementById('shortlistSingleModal');
    if (!modal) return;
    const input = document.getElementById('singleShortlistSearchInput');
    if (input) input.value = '';
    const preview = document.getElementById('singleShortlistSelectedPreview');
    if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
    const confirmBtn = document.getElementById('singleShortlistConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    window._selectedSingleProfileToShortlist = null;
    modal.classList.remove('hidden');
    renderSingleShortlistSearchResults('');
}

function closeShortlistSingleProfileModal() {
    const modal = document.getElementById('shortlistSingleModal');
    if (modal) modal.classList.add('hidden');
    window._selectedSingleProfileToShortlist = null;
}

function searchProfilesForSingleShortlist(query) {
    renderSingleShortlistSearchResults(query);
}

function renderSingleShortlistSearchResults(query) {
    const container = document.getElementById('singleShortlistSearchResults');
    if (!container) return;

    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const q = (query || '').trim().toLowerCase();

    let list = allProfiles;
    if (q) {
        list = list.filter(p => {
            if (typeof window.matchesMasterSearch === 'function') {
                return window.matchesMasterSearch(p, q);
            }
            const pid = (p.profileId || p.profile_id || '').toLowerCase();
            const name = (p.fullName || p.full_name || p['Full Name'] || '').toLowerCase();
            const city = (p.city || p.City || '').toLowerCase();
            return pid.includes(q) || name.includes(q) || city.includes(q);
        });
    }

    if (list.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-xs text-wine/50 italic">No matching profiles found.</div>';
        return;
    }

    container.innerHTML = list.slice(0, 15).map(p => {
        const pid = p.profileId || p.profile_id;
        const name = p.fullName || p.full_name || p['Full Name'];
        const gender = p.gender || p.Gender;
        const age = p.age || p.Age;
        const maslak = p.maslak || p.Maslak;
        const isShortlisted = (p.status === 'Shortlisted');

        return `
            <div onclick="selectProfileForSingleShortlist('${pid}')" class="p-2.5 rounded-xl hover:bg-gold/10 transition cursor-pointer flex items-center justify-between border-b border-gold/10 last:border-b-0">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-8 h-8 rounded-lg bg-wine/10 text-wine flex items-center justify-center font-bold text-xs shrink-0">${name.charAt(0)}</span>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                            <h5 class="text-xs font-bold text-wine truncate">${name}</h5>
                            <span class="font-mono text-[10px] px-1 bg-gold/20 text-wine rounded">${pid}</span>
                        </div>
                        <p class="text-[10px] text-wine/60">${gender} • ${age} yrs • ${maslak}</p>
                    </div>
                </div>
                ${isShortlisted 
                    ? '<span class="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">Already Shortlisted</span>'
                    : '<span class="text-xs text-gold font-bold">Select →</span>'
                }
            </div>
        `;
    }).join('');
}

function selectProfileForSingleShortlist(profileId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const p = allProfiles.find(item => (item.profileId || item.profile_id) === profileId);
    if (!p) return;

    window._selectedSingleProfileToShortlist = p;
    const preview = document.getElementById('singleShortlistSelectedPreview');
    const confirmBtn = document.getElementById('singleShortlistConfirmBtn');

    if (preview) {
        preview.innerHTML = `
            <div class="p-3 bg-gold/10 border border-gold/30 rounded-xl space-y-1 text-xs">
                <div class="flex items-center justify-between">
                    <span class="font-bold text-wine">${p.fullName || p.full_name || p['Full Name']}</span>
                    <span class="font-mono text-[11px] text-wine px-1.5 py-0.2 bg-white rounded border border-gold/30">${p.profileId || p.profile_id}</span>
                </div>
                <p class="text-[11px] text-wine/70">${p.gender || p.Gender} • ${p.age || p.Age} yrs • ${p.maslak || p.Maslak} • ${p.city || p.City || '—'}</p>
                ${p.status === 'Shortlisted' ? '<p class="text-[10px] text-amber-700 font-semibold mt-1">⚠️ Note: This candidate is already marked as Shortlisted.</p>' : ''}
            </div>
        `;
        preview.classList.remove('hidden');
    }

    if (confirmBtn) {
        confirmBtn.disabled = false;
    }
}

async function confirmShortlistSingleProfile() {
    const p = window._selectedSingleProfileToShortlist;
    if (!p) return;
    const pid = p.profileId || p.profile_id;

    try {
        await PairWorkflowService.manageSingleShortlist('add', pid);
        closeShortlistSingleProfileModal();
        if (typeof showAdminNotification === 'function') {
            showAdminNotification(`Profile ${pid} added to Single Shortlist!`, 'success');
        } else {
            alert(`Profile ${pid} added to Single Shortlist!`);
        }
        await renderShortlistedUnifiedView();
        if (typeof updateSidebarBadges === 'function') updateSidebarBadges();
    } catch(e) {
        showDialog('danger', 'Shortlist Failed', e.message);
    }
}

async function removeSingleProfileFromShortlist(profileId) {
    showDialog(
        'warning',
        'Remove from Shortlist',
        `Remove profile ${profileId} from the single-profile shortlist? Profile status will be returned to Reviewed.`,
        async () => {
            try {
                await PairWorkflowService.manageSingleShortlist('remove', profileId);
                await renderShortlistedUnifiedView();
                if (typeof updateSidebarBadges === 'function') updateSidebarBadges();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification(`Profile ${profileId} removed from shortlist.`, 'success');
                }
            } catch(e) {
                showDialog('danger', 'Remove Failed', e.message);
            }
        }
    );
}

function findMatchesForSingleShortlist(profileId, gender) {
    if (typeof navigate === 'function') {
        navigate('matching');
    }
    setTimeout(() => {
        const dir = (gender && gender.toLowerCase() === 'female') ? 'bride' : 'groom';
        if (typeof setMatchingDirection === 'function') setMatchingDirection(dir);
        if (typeof selectMatchingProfile === 'function') selectMatchingProfile(profileId);
    }, 150);
}

function viewSingleProfileFromShortlist(profileId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const idx = allProfiles.findIndex(p => (p.profileId || p.profile_id) === profileId);
    if (idx !== -1 && typeof viewProfile === 'function') {
        viewProfile(idx);
    } else if (typeof viewMatchingProfileModal === 'function') {
        viewMatchingProfileModal(profileId);
    }
}

async function initFollowupPairsView() {
    await renderShortlistList('Follow-up', 'followupCardsContainer', 'followupEmptyState');
}

async function initClosedPairsView() {
    await renderShortlistList('Closed', 'closedCardsContainer', 'closedEmptyState');
}

async function renderShortlistList(stageName, containerId, emptyStateId) {
    const container = document.getElementById(containerId);
    const emptyState = document.getElementById(emptyStateId);
    if (!container) return;

    container.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-wine/50"><svg class="w-6 h-6 animate-spin mx-auto mb-2 text-wine" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Loading ${stageName}...</div>`;

    const shortlists = await PairWorkflowService.getShortlists(stageName, 'Pair');

    if (!shortlists || shortlists.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    let html = '';
    shortlists.forEach(item => {
        html += createPairShortlistCardHtml(item);
    });

    container.innerHTML = html;
}

async function addMatchToShortlist(brideId, groomId, notes = '') {
    try {
        await PairWorkflowService.manageShortlist('add', brideId, groomId, 'Shortlisted', notes);
        if (typeof showAdminNotification === 'function') {
            showAdminNotification(`Added combination ${brideId} & ${groomId} to Shortlist!`, 'success');
        } else {
            alert(`Added combination ${brideId} & ${groomId} to Shortlist!`);
        }
    } catch(e) {
        showDialog('danger', 'Shortlist Failed', e.message);
    }
}

async function updateShortlistStage(brideId, groomId, newStage) {
    try {
        await PairWorkflowService.manageShortlist('update_stage', brideId, groomId, newStage);
        if (typeof showAdminNotification === 'function') {
            showAdminNotification(`Moved combination to ${newStage}`, 'success');
        }
        if (newStage === 'Shortlisted') initShortlistedPairsView();
        else if (newStage === 'Follow-up') initFollowupPairsView();
        else if (newStage === 'Closed') initClosedPairsView();
    } catch(e) {
        showDialog('danger', 'Update Failed', e.message);
    }
}

async function removeShortlist(brideId, groomId) {
    showDialog(
        'warning',
        'Remove Shortlist Entry',
        `Remove candidate pair ${brideId} & ${groomId} from shortlists?`,
        async () => {
            try {
                await PairWorkflowService.manageShortlist('remove', brideId, groomId);
                initShortlistedPairsView();
                initFollowupPairsView();
                initClosedPairsView();
                if (typeof showAdminNotification === 'function') {
                    showAdminNotification('Shortlist entry removed.', 'success');
                }
            } catch(e) {
                showDialog('danger', 'Remove Failed', e.message);
            }
        }
    );
}

// ============================================================================
// 6. COMPARATIVE BOTH PROFILES MODAL
// ============================================================================
function viewBothProfilesModal(brideId, groomId) {
    const allProfiles = window.getProfiles ? window.getProfiles() : (typeof profiles !== 'undefined' ? profiles : []);
    const b = allProfiles.find(p => (p.profileId || p.profile_id) === brideId) || {};
    const g = allProfiles.find(p => (p.profileId || p.profile_id) === groomId) || {};

    const modal = document.getElementById('bothProfilesModal');
    const content = document.getElementById('bothProfilesModalContent');
    const actions = document.getElementById('bothProfilesModalActions');
    if (!modal || !content) return;

    // Exact DOB and age math
    const bDob = b['Date of Birth'] || b.date_of_birth || '';
    const gDob = g['Date of Birth'] || g.date_of_birth || '';
    const bAgeObj = AIMatchingEngine.calculateExactAge(bDob);
    const gAgeObj = AIMatchingEngine.calculateExactAge(gDob);

    const bAgeStr = bAgeObj ? `${bAgeObj.years} yrs, ${bAgeObj.months} mos` : (b.Age || b.age || '—') + ' yrs';
    const gAgeStr = gAgeObj ? `${gAgeObj.years} yrs, ${gAgeObj.months} mos` : (g.Age || g.age || '—') + ' yrs';

    const diff = (bDob && gDob) ? AIMatchingEngine.calculateAgeDifference(gDob, bDob) : null;
    const diffDisplay = diff ? diff.display : '—';

    const bMaslak = b.Maslak || b.maslak || '—';
    const gMaslak = g.Maslak || g.maslak || '—';
    const sameMaslak = !AIMatchingEngine.isSpecialNonMaslak(bMaslak) && !AIMatchingEngine.isSpecialNonMaslak(gMaslak) && (AIMatchingEngine.normalizeMaslak(bMaslak) === AIMatchingEngine.normalizeMaslak(gMaslak));

    const bPref = b['Preferred Age Range'] || b.preferred_age_range || 'Not Specified';
    const gPref = g['Preferred Age Range'] || g.preferred_age_range || 'Not Specified';

    const mutualPref = AIMatchingEngine.evaluateMutualPreference(b, g);

    content.innerHTML = `
        <div class="p-3.5 bg-gold/10 border border-gold/30 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex items-center gap-2">
                <span class="font-bold text-wine uppercase tracking-wider text-[11px]">Age Difference:</span>
                <span class="font-bold text-wine bg-white/80 px-2 py-0.5 rounded-lg border border-gold/30">${diffDisplay}</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="font-bold text-wine uppercase tracking-wider text-[11px]">Maslak:</span>
                <span class="font-bold px-2 py-0.5 rounded-lg border ${sameMaslak ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-indigo-100 text-indigo-800 border-indigo-200'}">
                    ${sameMaslak ? 'Same Maslak (' + bMaslak + ')' : 'Cross-Maslak (' + bMaslak + ' vs ' + gMaslak + ')'}
                </span>
            </div>
            <div class="flex items-center gap-2">
                <span class="font-bold text-wine uppercase tracking-wider text-[11px]">Preference:</span>
                <span class="font-bold px-2 py-0.5 rounded-lg border bg-white/80 text-wine border-gold/30">
                    ${mutualPref.combinedLabel}
                </span>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-gradient-to-br from-pink-50/50 to-white border border-pink-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
                <div class="flex items-center justify-between pb-3 border-b border-pink-200">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-10 rounded-xl bg-pink-100 text-pink-700 flex items-center justify-center font-serif font-bold">
                            👰
                        </div>
                        <div>
                            <span class="text-[10px] font-bold text-pink-700 uppercase tracking-wider block">Bride</span>
                            <h4 class="font-serif text-base font-bold text-wine truncate">${b['Full Name'] || b.full_name || 'Bride'}</h4>
                        </div>
                    </div>
                    <span class="font-mono text-xs font-bold text-wine bg-white px-2 py-0.5 rounded-md border border-pink-200">${b.profileId || b.profile_id}</span>
                </div>

                <div class="space-y-2 text-xs">
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Age & DOB:</span>
                        <span class="font-bold text-wine">${bAgeStr} <span class="font-normal text-wine/50 text-[10px]">(${bDob || '—'})</span></span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Maslak:</span>
                        <span class="font-bold text-wine">${bMaslak}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Preferred Age:</span>
                        <span class="font-bold text-wine">${bPref}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Location:</span>
                        <span class="font-bold text-wine">${b.City || b.city || '—'}, ${b.State || b.state || '—'}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Education:</span>
                        <span class="font-bold text-wine">${b.Education || b.education || b.Qualification || '—'}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Profession:</span>
                        <span class="font-bold text-wine">${b.Profession || b.profession || b.Occupation || '—'}</span>
                    </div>
                    <div class="flex justify-between py-1">
                        <span class="text-wine/60">Salary:</span>
                        <span class="font-bold text-wine">${(b.Salary || b.salary) ? '₹' + Number(b.Salary || b.salary).toLocaleString('en-IN') : '—'}</span>
                    </div>
                </div>
            </div>

            <div class="bg-gradient-to-br from-blue-50/50 to-white border border-blue-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
                <div class="flex items-center justify-between pb-3 border-b border-blue-200">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-serif font-bold">
                            🤵
                        </div>
                        <div>
                            <span class="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Groom</span>
                            <h4 class="font-serif text-base font-bold text-wine truncate">${g['Full Name'] || g.full_name || 'Groom'}</h4>
                        </div>
                    </div>
                    <span class="font-mono text-xs font-bold text-wine bg-white px-2 py-0.5 rounded-md border border-blue-200">${g.profileId || g.profile_id}</span>
                </div>

                <div class="space-y-2 text-xs">
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Age & DOB:</span>
                        <span class="font-bold text-wine">${gAgeStr} <span class="font-normal text-wine/50 text-[10px]">(${gDob || '—'})</span></span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Maslak:</span>
                        <span class="font-bold text-wine">${gMaslak}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Preferred Age:</span>
                        <span class="font-bold text-wine">${gPref}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Location:</span>
                        <span class="font-bold text-wine">${g.City || g.city || '—'}, ${g.State || g.state || '—'}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Education:</span>
                        <span class="font-bold text-wine">${g.Education || g.education || g.Qualification || '—'}</span>
                    </div>
                    <div class="flex justify-between py-1 border-b border-gold/10">
                        <span class="text-wine/60">Profession:</span>
                        <span class="font-bold text-wine">${g.Profession || g.profession || g.Occupation || '—'}</span>
                    </div>
                    <div class="flex justify-between py-1">
                        <span class="text-wine/60">Salary:</span>
                        <span class="font-bold text-wine">${(g.Salary || g.salary) ? '₹' + Number(g.Salary || g.salary).toLocaleString('en-IN') : '—'}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (actions) {
        actions.innerHTML = `
            <button onclick="confirmMatrimonialPair('${brideId}', '${groomId}'); closeBothProfilesModal();" class="px-4 py-2 bg-gradient-to-r from-gold to-gold-lt text-wine font-bold rounded-xl text-xs shadow-sm hover:shadow transition flex items-center gap-1.5">
                <span>💍 Confirm Final Pair</span>
            </button>
            <button onclick="addMatchToShortlist('${brideId}', '${groomId}'); closeBothProfilesModal();" class="px-4 py-2 border border-gold/40 bg-gold/15 text-wine font-semibold rounded-xl text-xs hover:bg-gold/25 transition flex items-center gap-1.5">
                <span>⭐ Add to Shortlist</span>
            </button>
            <button onclick="closeBothProfilesModal()" class="px-4 py-2 border border-gold/30 rounded-xl text-xs font-medium text-wine hover:bg-gold/10 transition">
                Close
            </button>
        `;
    }

    modal.classList.remove('hidden');
    if (typeof lockModalScroll === 'function') lockModalScroll();
}

function closeBothProfilesModal() {
    const modal = document.getElementById('bothProfilesModal');
    if (modal) modal.classList.add('hidden');
    if (typeof unlockModalScroll === 'function') unlockModalScroll();
}

// Register all Pair Management Controllers globally
window.PairWorkflowService = PairWorkflowService;
window.refreshActivePairsCache = refreshActivePairsCache;
window.initPairsView = initPairsView;
window.refreshPairsView = refreshPairsView;
window.renderPairsList = renderPairsList;
window.confirmMatrimonialPair = confirmMatrimonialPair;
window.unpairAndRestoreMatrimonialPair = unpairAndRestoreMatrimonialPair;
window.releaseMatrimonialPair = releaseMatrimonialPair;
window.deletePairHistoryRecord = deletePairHistoryRecord;
window.showAlreadyPairedDialog = showAlreadyPairedDialog;
window.archiveMatrimonialPair = archiveMatrimonialPair;
window.editMatrimonialPairNotes = editMatrimonialPairNotes;
window.initShortlistedPairsView = initShortlistedPairsView;
window.initFollowupPairsView = initFollowupPairsView;
window.initClosedPairsView = initClosedPairsView;
window.renderShortlistList = renderShortlistList;
window.addMatchToShortlist = addMatchToShortlist;
window.updateShortlistStage = updateShortlistStage;
window.removeShortlist = removeShortlist;
window.viewBothProfilesModal = viewBothProfilesModal;
window.closeBothProfilesModal = closeBothProfilesModal;
window.setShortlistFilterTab = setShortlistFilterTab;
window.filterShortlistDisplay = filterShortlistDisplay;
window.renderShortlistedUnifiedView = renderShortlistedUnifiedView;
window.openShortlistSingleProfileModal = openShortlistSingleProfileModal;
window.closeShortlistSingleProfileModal = closeShortlistSingleProfileModal;
window.searchProfilesForSingleShortlist = searchProfilesForSingleShortlist;
window.selectProfileForSingleShortlist = selectProfileForSingleShortlist;
window.confirmShortlistSingleProfile = confirmShortlistSingleProfile;
window.removeSingleProfileFromShortlist = removeSingleProfileFromShortlist;
window.findMatchesForSingleShortlist = findMatchesForSingleShortlist;
window.viewSingleProfileFromShortlist = viewSingleProfileFromShortlist;

