// --- GLOBAL VARIABLES ---
// TRUE SYNC FIX: Force the dashboard to use the exact user saved during login
window.userMobile = localStorage.getItem('userMobile');

let currentAmount = 0;
let currentPlanName = "";
let payMode = "";
let currentOfferToClaim = "";
let allPlans = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Dashboard JS Loaded");

    // Security Failsafe: If memory is empty, kick back to login
    if (!window.userMobile || window.userMobile === "null") {
        window.location.href = '/';
        return;
    }

    // A. FETCH USER DATA & FILL PROGRESS BAR
    fetch(`/api/user/${window.userMobile}`)
        .then(res => res.json())
        .then(data => {
            if (!data.error) {
                // --- 1. UPDATE UI ELEMENTS ---

                // Extra sync fix for the top-right header (Fallback for the 'Loading...' text)
                const headerName = document.querySelector('.header-profile span, .user-profile span');
                if (headerName) headerName.innerText = data.name;

                document.getElementById('user-name-display').innerText = data.name;
                document.getElementById('data-balance').innerText = data.data_balance;
                document.getElementById('active-plan-name').innerText = data.active_plan;

                const heroVal = document.getElementById('hero-validity');
                heroVal.innerText = data.days_left > 0 ? `Valid till ${data.expiry_date} (${data.days_left} days left)` : "Plan Expired";
                heroVal.style.color = data.days_left > 0 ? "#28a745" : "#d32f2f";

                // --- 2. PROGRESS BAR LOGIC ---
                const bar = document.getElementById('data-bar');
                if (bar) {
                    let pct = (parseFloat(data.data_balance) / 2.0) * 100;
                    if (pct > 100) pct = 100;
                    bar.style.width = pct + "%";
                }

                if (document.getElementById('vp-name')) document.getElementById('vp-name').innerText = data.active_plan;
                if (document.getElementById('vp-data')) document.getElementById('vp-data').innerText = data.data_balance;
                if (document.getElementById('vp-validity')) document.getElementById('vp-validity').innerText = heroVal.innerText;

                // TRIGGER 1: Show special offer 2.5 seconds after login/data load
                setTimeout(window.triggerSpecialOffer, 2500);
            }
        })
        .catch(err => console.error("Data Fetch Error:", err)); // Catches errors so the page doesn't break

    // B. FETCH PLANS & FILL GRID
    fetch('/api/get_plans')
        .then(res => res.json())
        .then(plans => {
            allPlans = plans.sort((a, b) => parseInt(a.price) - parseInt(b.price));
            const container = document.getElementById('plans-container');
            if (container) {
                container.innerHTML = '';
                allPlans.forEach(plan => {
                    container.innerHTML += createPlanCard(plan, plan.description || plan.data, false);
                });
            }
        });

    window.checkClaimedStatus();

    // TRIGGER 2: Show offer when navigating menu items
    // TRIGGER: When user clicks any menu item, show a FRESH offer
    document.addEventListener('click', (e) => {
        if (e.target.closest('.menu-item') || e.target.closest('.nav-link')) {
            // Clear any existing timeout to prevent overlapping popups
            if (window.navPopupTimeout) clearTimeout(window.navPopupTimeout);

            window.navPopupTimeout = setTimeout(() => {
                window.triggerSpecialOffer();
            }, 1500);
        }
    });
});

// --- THE EXACT DECEMBER SPECIAL OFFER LOGIC (RESTORED & DYNAMIC) ---
window.closeOfferModal = function () {
    const modal = document.getElementById('offer-modal');
    if (modal) modal.style.display = 'none';
};

// --- DYNAMIC CONTENT REFRESH LOGIC ---
window.triggerSpecialOffer = function () {
    const offerModal = document.getElementById('offer-modal');
    if (!offerModal) return;

    const title = offerModal.querySelector('h2');
    const text = offerModal.querySelector('p');
    const btn = document.getElementById('offer-action-btn');

    const currentPriceText = document.getElementById('active-plan-name').innerText;
    const userCurrentPrice = parseInt(currentPriceText.match(/\d+/) || 0);

    // 1. Create a "Pool" of different offer types
    const upsellOffers = [
        { t: "Upgrade & Save!", d: "Switch to ₹299 for Unlimited Calls + 1.5GB/Day!", p: "299", b: "Upgrade Now" },
        { t: "Go Unlimited 5G!", d: "Get 84 Days Validity + 5G Data with the ₹719 Pack!", p: "719", b: "View Offer" },
        { t: "Running Low on Data?", d: "Grab 5GB Extra Data for just ₹25 today!", p: "25", b: "Add Data" },
        { t: "Flash Sale! ⚡", d: "10GB Extra Data for only ₹49! Valid for 24 hours.", p: "49", b: "Grab Deal" },
        { t: "Weekend Special", d: "Unlimited Night Data (12AM-6AM) for ₹99!", p: "99", b: "Activate" }
    ];

    // 2. Logic: 50% chance to show the "Targeted" offer, 50% chance to show a "Random" one
    let selected;
    if (Math.random() > 0.5) {
        // Targeted Logic
        if (userCurrentPrice < 100) selected = upsellOffers[0];
        else if (userCurrentPrice < 500) selected = upsellOffers[1];
        else selected = upsellOffers[2];
    } else {
        // Random Rotation Logic
        selected = upsellOffers[Math.floor(Math.random() * upsellOffers.length)];
    }

    // 3. Update the UI
    title.innerText = selected.t;
    text.innerText = selected.d;
    btn.innerText = selected.b;
    btn.onclick = function () {
        window.closeOfferModal();
        window.openRecharge(selected.p, selected.d);
    };

    offerModal.style.display = 'flex';
    offerModal.classList.add('active');
};
// --- GLOBAL TRIGGERS ---
// 1. On Login/Initial Load
window.addEventListener('load', () => setTimeout(window.triggerSpecialOffer, 2500));

// 2. On Navigation/Back Button
window.addEventListener('popstate', window.triggerSpecialOffer);

// 3. When closing "Available Packs"
const oldClose = window.closePlanModal;
window.closePlanModal = function () {
    if (oldClose) oldClose();
    setTimeout(window.triggerSpecialOffer, 800);
};

// --- PLAN CARD GENERATOR ---
function createPlanCard(plan, desc, isHighlight) {
    const priceInt = parseInt(plan.price);
    const isPremium = priceInt >= 700;
    const borderStyle = isPremium ? 'border: 2px solid #ff7f00; background: linear-gradient(to bottom, #fffcf9, #ffffff);' : 'background:white; border: 1px solid #eee;';
    const ottHtml = isPremium ? `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #ddd; display:flex; gap:10px; font-size:1.2rem;"><i class="fa-brands fa-amazon" style="color:#FF9900;"></i><i class="fa-solid fa-play" style="color:#E50914;"></i><i class="fa-brands fa-disney" style="color:#113CCF;"></i></div>` : '';

    return `<div class="plan-card" style="${borderStyle} padding:20px; border-radius:15px; margin:10px; display:inline-block; width: 250px; text-align:left; box-shadow: 0 4px 10px rgba(0,0,0,0.05); vertical-align: top;">
            <h3 style="color:#1a1a2e; margin:0; font-size: 1.8rem;">₹${plan.price}</h3>
            <p style="color:#555; font-size: 0.9rem; margin: 10px 0;">${desc}</p>
            <div style="font-size:13px; color:#777; margin-bottom:15px;"><i class="fa-solid fa-wifi"></i> ${plan.data} | <i class="fa-regular fa-calendar-days"></i> ${plan.validity}</div>
            <button onclick="window.openRecharge('${plan.price}', '${desc}')" style="background:#ff7f00; color:white; border:none; padding:10px; border-radius:8px; width:100%; cursor:pointer; font-weight:bold;">Recharge</button>
            ${ottHtml}
        </div>`;
}

// --- MODAL CONTROLS ---
window.viewCurrentPack = function () {
    const modal = document.getElementById('view-pack-modal');
    if (modal) modal.style.display = 'flex';
};

window.showUpgrades = function () {
    const modal = document.getElementById('plan-modal');
    const list = document.getElementById('upgrade-list');
    const currentActiveText = document.getElementById('active-plan-name').innerText;
    const currentPrice = currentActiveText.match(/\d+/) ? currentActiveText.match(/\d+/)[0] : null;

    if (modal) modal.style.display = 'flex';
    if (list && allPlans.length > 0) {
        list.innerHTML = '';
        const samePlan = allPlans.find(p => p.price.toString() === currentPrice);
        let html = '';
        if (samePlan) {
            html += `<div class="upgrade-same-card animated-card">
                        <div>
                            <small class="status-badge">● Active Plan</small>
                            <h3 style="margin:0;">₹${samePlan.price} - Renewal</h3>
                            <p style="font-size:0.8rem; margin:0;">${samePlan.data} | ${samePlan.validity}</p>
                        </div>
                        <button class="renewal-btn-shiny" onclick="window.openRecharge('${samePlan.price}', '${samePlan.data}')">Renew</button>
                    </div>`;
        }
        allPlans.forEach((plan, index) => {
            if (plan.price.toString() === currentPrice) return;
            html += `<div class="compact-plan-card glass-yellow animated-card" style="animation-delay: ${(index * 0.05)}s">
                        <div style="text-align: center;">
                            <h3 style="color: #856404; margin: 0; font-size: 1.4rem;">₹${plan.price}</h3>
                            <p style="font-size: 0.75rem; color: #666; margin: 5px 0;">${plan.data}<br>${plan.validity}</p>
                        </div>
                        <button class="select-btn-yellow" onclick="window.openRecharge('${plan.price}', '${plan.data}')">Select</button>
                    </div>`;
        });
        list.innerHTML = html;
    }
};

// TRIGGER 3: Show offer after closing the plan modal
window.closePlanModal = function () {
    const modal = document.getElementById('plan-modal');
    if (modal) modal.style.display = 'none';
    setTimeout(window.triggerSpecialOffer, 800);
};

// --- PAYMENT LOGIC ---
window.openRecharge = (amount, plan) => {
    window.closePlanModal();
    currentAmount = amount; currentPlanName = plan;
    document.getElementById('payAmt').innerText = amount;
    document.getElementById('payPlan').innerText = plan;
    document.getElementById('paymentModalOverlay').style.display = 'flex';
    document.getElementById('payForm').style.display = 'block';
    document.getElementById('payLoader').style.display = 'none';
    document.getElementById('paySuccess').style.display = 'none';
};

// Function linked to the "Pay Now" button in your HTML
// Function linked to the "Pay Now" button in your HTML
window.validatePaymentAndConfirm = function () {
    if (!payMode) {
        window.showAlert("Selection Required", "Please select UPI or Card.", "error");
        return;
    }

    if (payMode === 'upi') {
        const upiVal = document.getElementById('upiVal') ? document.getElementById('upiVal').value.trim() : "";
        const upiRegex = /^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+$/;

        if (!upiRegex.test(upiVal)) {
            window.showAlert("Invalid UPI", "Please enter a valid format (e.g., name@bankname)", "error");
            return;
        }
    }
    else if (payMode === 'card') {
        const cardVal = document.getElementById('cardVal') ? document.getElementById('cardVal').value.trim() : "";
        const cardExp = document.getElementById('cardExp') ? document.getElementById('cardExp').value.trim() : "";
        const cardCvv = document.getElementById('cardCvv') ? document.getElementById('cardCvv').value.trim() : "";

        if (!/^\d{16}$/.test(cardVal)) {
            window.showAlert("Invalid Card", "Please enter exactly 16 numbers.", "error");
            return;
        }
        if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardExp)) {
            window.showAlert("Invalid Expiry", "Please use MM/YY format.", "error");
            return;
        }
        if (!/^\d{3}$/.test(cardCvv)) {
            window.showAlert("Invalid CVV", "Please enter exactly 3 digits.", "error");
            return;
        }
    }

    // If all checks pass, execute payment
    window.executePayment();
};

window.executePayment = function () {
    const payForm = document.getElementById('payForm');
    const payLoader = document.getElementById('payLoader');
    const paySuccess = document.getElementById('paySuccess');

    // UI Transition: Show loader
    if (payForm) payForm.style.display = 'none';
    if (payLoader) payLoader.style.display = 'flex';

    fetch('/api/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mobile_no: window.userMobile,
            plan_price: currentAmount,
            plan_data: currentPlanName,
            payment_mode: payMode
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "Success") {
                setTimeout(() => {
                    if (payLoader) payLoader.style.display = 'none';
                    if (paySuccess) paySuccess.style.display = 'flex'; // Centered success screen
                }, 1500);
            } else {
                if (payLoader) payLoader.style.display = 'none';
                if (payForm) payForm.style.display = 'block';
                window.showAlert("Error", data.error, "error");
            }
        })
        .catch(err => {
            console.error("Payment Error:", err);
            if (payLoader) payLoader.style.display = 'none';
            if (payForm) payForm.style.display = 'block';
        });
};
// --- UTILS ---
window.selectMode = (mode) => {
    payMode = mode;
    document.getElementById('inputUpi').style.display = mode === 'upi' ? 'block' : 'none';
    document.getElementById('inputCard').style.display = mode === 'card' ? 'block' : 'none';
    document.getElementById('btnUpi').classList.toggle('active-mode', mode === 'upi');
    document.getElementById('btnCard').classList.toggle('active-mode', mode === 'card');
};

window.submitServiceRequest = function () {
    const name = document.getElementById('serv-name').value;
    const address = document.getElementById('serv-addr').value;
    const serviceType = document.getElementById('service-title').innerText;
    fetch('/api/service_request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile_no: window.userMobile, name: name, address: address, type: serviceType })
    }).then(res => res.json()).then(data => {
        if (data.status === "Success") { alert("Request Sent Successfully ✅"); location.reload(); }
        else { alert("Failed: " + data.error); }
    });
};
// STEP 1: Open the Modal and Show Terms
window.claimOffer = function (offerName) {
    currentOfferToClaim = offerName; // Set the global variable

    // Update the Title and Terms in the Modal
    document.getElementById('claim-offer-title').innerText = "Claim " + offerName;

    const offerTerms = {
        "Google One 2TB": "• Valid for active subscribers.<br>• 3 Months free storage.<br>• New users only.",
        "Spotify Premium": "• 3 Months ad-free music.<br>• Premium Individual plan only.<br>• Redeem by June 2026.",
        "Swiggy One": "• Free delivery on all orders.<br>• Valid for 6 months.<br>• No minimum order value."
    };

    const termsBox = document.getElementById('offer-terms-display');
    if (termsBox) {
        termsBox.innerHTML = `<b>Terms for ${offerName}:</b><br>` + (offerTerms[offerName] || "Standard terms apply.");
    }

    // Show the Modal
    document.getElementById('offerClaimModal').style.display = 'flex';
};

// STEP 2: Process the actual API call after T&C check
window.processOfferClaim = function () {
    const checkbox = document.getElementById('tnc-checkbox');
    const errorText = document.getElementById('tnc-error');

    // T&C Validation
    if (!checkbox.checked) {
        errorText.style.display = "block";
        return;
    }

    errorText.style.display = "none";

    fetch('/api/claim_offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mobile_no: window.userMobile,
            offer_name: currentOfferToClaim
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "Success") {
                document.getElementById('offerClaimModal').style.display = 'none';
                window.showAlert("Success ✅", "Offer Claimed Successfully!", "success");

                // Refresh button states
                if (window.checkClaimedStatus) window.checkClaimedStatus();
            } else {
                window.showAlert("Error", data.error || "Something went wrong", "error");
            }
        })
        .catch(err => {
            console.error("Claim Error:", err);
            window.showAlert("Error", "Server error occurred", "error");
        });
};
// Function to check and grey out buttons
window.checkClaimedStatus = function () {
    if (!window.userMobile) return;

    fetch('/api/get_claimed_offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile_no: window.userMobile })
    })
        .then(res => res.json())
        .then(claimedList => {
            // claimedList is an array of names like ["Spotify Premium", "Swiggy One"]
            const allButtons = document.querySelectorAll('.offer-btn');

            allButtons.forEach(btn => {
                const offerName = btn.getAttribute('data-offer');
                if (claimedList.includes(offerName)) {
                    btn.innerText = "Claimed";
                    btn.style.background = "#888"; // Grey color
                    btn.style.color = "#ccc";
                    btn.style.cursor = "default";
                    btn.disabled = true;
                    btn.onclick = null; // Disable clicking
                }
            });
        })
        .catch(err => console.error("Error checking claims:", err));
};

window.showAlert = (title, message, type) => {
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('customAlertOverlay').style.display = 'flex';
};
// --- SERVICE MODAL LOGIC (FIX FOR CONSOLE ERROR) ---
window.openServiceModal = function (type) {
    const title = document.getElementById('service-title');
    const modal = document.getElementById('serviceModal');

    if (title && modal) {
        title.innerText = "Get " + type + " Connection";
        modal.style.display = 'flex';
        console.log("🚀 Service Modal Opened for:", type);
    } else {
        console.error("❌ Error: Service modal elements not found in HTML.");
    }
};

window.closeCustomAlert = () => document.getElementById('customAlertOverlay').style.display = 'none';
window.closePayModal = () => location.reload();
window.closeViewPackModal = () => document.getElementById('view-pack-modal').style.display = 'none';
window.closeServiceModal = () => document.getElementById('serviceModal').style.display = 'none';
window.closeConfirmModal = () => document.getElementById('customConfirmModal').style.display = 'none';
window.addEventListener('popstate', window.triggerSpecialOffer);
window.onclick = function (event) { if (event.target.className === 'modal-overlay') event.target.style.display = 'none'; };