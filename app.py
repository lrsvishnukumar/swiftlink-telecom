from flask import Flask, render_template, jsonify, request, session, redirect, url_for, Response
import sqlite3
import os
import csv
import io
from datetime import datetime, timedelta
import re

app = Flask(__name__)
app.secret_key = "secret_key_123"

DB_PATH = "C:/swiftlink/telecom.db"
ADMIN_CONFIG = {'username': 'admin', 'password': 'admin123'}

def get_db_connection():
    if not os.path.exists(DB_PATH): print(f"❌ CRITICAL ERROR: Database file NOT found at {DB_PATH}")
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn
@app.route('/api/get_session_user')
def get_session_user():
    return jsonify({'mobile': session.get('user_mobile')})
# --- AUTO-UPGRADE DATABASE (Added Service Requests & Offers Table) ---
def check_and_upgrade_db():
    try:
        conn = get_db_connection()
        # 1. Check Payment Mode
        try: conn.execute("ALTER TABLE recharges ADD COLUMN payment_mode TEXT")
        except: pass
        
        # 2. Create Service Requests Table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS service_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mobile_no TEXT,
                name TEXT,
                address TEXT,
                service_type TEXT,
                date TEXT,
                status TEXT
            )
        """)

        # 3. Create Claimed Offers Table (NEW)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS claimed_offers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mobile_no TEXT,
                offer_name TEXT,
                current_plan TEXT,
                claim_date TEXT
            )
        """)

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ Database Check Warning: {e}")

check_and_upgrade_db() 

# --- PUBLIC ROUTES ---
@app.route('/')
def index(): return render_template('login.html')

@app.route('/login', methods=['POST'])
def login():
    mobile_no = request.form.get('mobile_no', '').strip()
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE mobile_no = ?', (mobile_no,)).fetchone()
    conn.close()
    if user:
        session['user_mobile'] = mobile_no
        return redirect(url_for('dashboard'))
    return f"Login Failed. User '{mobile_no}' not found."

@app.route('/logout')
def logout():
    session.pop('user_mobile', None)
    return redirect(url_for('index'))
@app.route('/api/register', methods=['POST'])
def register_user():
    # If request.json is None, it triggers the 415 error
    data = request.get_json(silent=True) 
    
    if not data:
        return jsonify({'status': 'Failed', 'error': 'Invalid JSON or missing Content-Type header'}), 415

    name = data.get('name')
    city = data.get('city')
    mobile = data.get('mobile_no')

    try:
        conn = get_db_connection()
        conn.execute("INSERT INTO users (name, city, mobile_no) VALUES (?, ?, ?)", (name, city, mobile))
        conn.commit()
        conn.close()
        session['user_mobile'] = mobile
        return jsonify({'status': 'Success'})
    except Exception as e:
        return jsonify({'status': 'Failed', 'error': str(e)}), 500
@app.route('/dashboard.html')
def dashboard():
    mobile = session.get('user_mobile', '1123456789')
    return render_template('dashboard.html', mobile_no=mobile)

@app.route('/history')
def history_page(): return render_template('history.html')

@app.route('/profile')
def profile(): return render_template('profile.html')

# --- ADMIN ROUTES ---
@app.route('/admin')
def admin_login(): return render_template('admin_login.html')

@app.route('/admin/auth', methods=['POST'])
def admin_auth():
    if request.form.get('username') == ADMIN_CONFIG['username'] and request.form.get('password') == ADMIN_CONFIG['password']:
        session['is_admin'] = True
        return redirect(url_for('admin_dashboard'))
    return "Invalid Admin Credentials!"
@app.route('/api/get_claimed_offers', methods=['POST'])
def get_claimed_offers():
    data = request.get_json()
    mobile = data.get('mobile_no')

    conn = get_db_connection()
    claims = conn.execute(
    "SELECT offer_name FROM claimed_offers WHERE mobile_no = ?",
    (mobile,)
     ).fetchall()
    conn.close()

    return jsonify([row['offer_name'] for row in claims])

@app.route('/admin/logout')
def admin_logout():
    session.pop('is_admin', None)
    return redirect(url_for('admin_login'))

@app.route('/admin/dashboard')
def admin_dashboard():
    if not session.get('is_admin'): return redirect(url_for('admin_login'))
    conn = get_db_connection()
    stats = {
        'users': conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        'revenue': conn.execute("SELECT SUM(plan_price) FROM recharges").fetchone()[0] or 0,
        'recharges': conn.execute("SELECT COUNT(*) FROM recharges").fetchone()[0],
        'pending_requests': conn.execute("SELECT COUNT(*) FROM service_requests WHERE status='Pending'").fetchone()[0]
    }
    plans = conn.execute("SELECT * FROM plans").fetchall()
    transactions = conn.execute("SELECT * FROM recharges ORDER BY id DESC LIMIT 10").fetchall()
    conn.close()
    return render_template('admin_dashboard.html', stats=stats, plans=plans, transactions=transactions)

@app.route('/admin/users')
def admin_users():
    if not session.get('is_admin'): return redirect(url_for('admin_login'))
    conn = get_db_connection()
    users = conn.execute("SELECT * FROM users").fetchall()
    conn.close()
    return render_template('admin_users.html', users=users)

@app.route('/admin/settings')
def admin_settings():
    if not session.get('is_admin'): return redirect(url_for('admin_login'))
    return render_template('admin_settings.html')

# --- ADMIN SERVICE REQUESTS PAGE ---
@app.route('/admin/requests')
def admin_requests():
    if not session.get('is_admin'): return redirect(url_for('admin_login'))
    conn = get_db_connection()
    requests = conn.execute("SELECT * FROM service_requests ORDER BY id DESC").fetchall()
    conn.close()
    return render_template('admin_requests.html', requests=requests)

@app.route('/admin/close_request/<int:req_id>', methods=['POST'])
def close_request(req_id):
    if not session.get('is_admin'): return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    conn.execute("UPDATE service_requests SET status='Completed' WHERE id=?", (req_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'Success'})

# --- API ENDPOINTS ---

# --- NEW: CLAIM OFFER ENDPOINT ---
@app.route('/api/claim_offer', methods=['POST'])
def claim_offer():
    data = request.json
    # 1. Improved mobile detection from request body if session is empty
    mobile = session.get('user_mobile') or data.get('mobile_no')
    offer_name = data.get('offer_name')
    
    print(f"DEBUG: Attempting to claim '{offer_name}' for mobile: {mobile}") 

    if not mobile or mobile == "None":
        return jsonify({'status': 'Failed', 'error': 'Session expired. Please login again.'})

    try:
        conn = get_db_connection()

        # 2. Check for the LATEST recharge
        last_recharge = conn.execute(
            "SELECT plan_price FROM recharges WHERE mobile_no LIKE ? ORDER BY id DESC LIMIT 1",
            (f"%{mobile}%",)
        ).fetchone()

        if not last_recharge:
            conn.close()
            return jsonify({'status': 'Failed', 'error': f'No recharge history found for {mobile}.'})

        current_plan = int(last_recharge['plan_price'])

        # 3. LOWERED REQUIREMENT FOR TESTING: Changed 500 to 10
        if current_plan < 10: 
            conn.close()
            return jsonify({'status': 'Failed', 'error': f'Plan ₹{current_plan} is too low.'})

        # 4. Check for duplicates and Insert claim
        existing = conn.execute("SELECT 1 FROM claimed_offers WHERE mobile_no = ? AND offer_name = ?", (mobile, offer_name)).fetchone()
        if existing:
            conn.close()
            return jsonify({'status': 'Failed', 'error': 'Already claimed!'})

        date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("INSERT INTO claimed_offers (mobile_no, offer_name, current_plan, claim_date) VALUES (?, ?, ?, ?)", (mobile, offer_name, current_plan, date))
        conn.commit()
        conn.close()
        return jsonify({'status': 'Success'})
    except Exception as e:
        return jsonify({'status': 'Failed', 'error': str(e)})
@app.route('/api/service_request', methods=['POST'])
def handle_service_request():
    data = request.json
    # Check session first, then fallback to the data sent from JS
    mobile = session.get('user_mobile') or data.get('mobile_no')

    if not mobile:
        return jsonify({'status': 'Failed', 'error': 'User not logged in'}), 401
    
    # ... rest of your code ...

    date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        conn = get_db_connection()
        conn.execute("""
            INSERT INTO service_requests 
            (mobile_no, name, address, service_type, date, status) 
            VALUES (?, ?, ?, ?, ?, ?)
        """, (mobile, data['name'], data['address'], data['type'], date, 'Pending'))

        conn.commit()
        conn.close()

        return jsonify({'status': 'Success'})

    except Exception as e:
        return jsonify({'status': 'Failed', 'error': str(e)})
@app.route('/api/recharge', methods=['POST'])
def handle_recharge():
    data = request.json
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user_mobile = session.get('user_mobile', data.get('mobile_no', '1123456789'))
    pay_mode = data.get('payment_mode', 'Unknown').upper()
    try:
        conn = get_db_connection()
        with conn:
            conn.execute("INSERT INTO recharges (mobile_no, plan_price, plan_data, date, payment_mode) VALUES (?, ?, ?, ?, ?)",
                         (user_mobile, data['plan_price'], data['plan_data'], current_time, pay_mode))
        return jsonify({"status": "Success"}), 200
    except Exception as e:
        return jsonify({"status": "Failed", "error": str(e)}), 500

@app.route('/api/user/<mobile_no>')
def get_user(mobile_no):
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT * FROM users WHERE mobile_no = ?', (mobile_no,)).fetchone()
        last_recharge = conn.execute('SELECT * FROM recharges WHERE mobile_no = ? ORDER BY id DESC LIMIT 1', (mobile_no,)).fetchone()
        
        # --- THE FIX IS HERE: Added 'city' back to the response ---
        response = {
            'name': user['name'] if user else 'Guest', 
            'city': user['city'] if user else 'Unknown', # <-- This line was missing!
            'current_price': 0, 
            'active_plan': 'No Active Plan', 
            'data_balance': '0.0', 
            'days_left': 0, 
            'expiry_date': 'Expired'
        }
        
        if last_recharge:
            price = last_recharge['plan_price']
            response['current_price'] = int(price)
            response['active_plan'] = f"₹{price} Pack"
            plan_details = conn.execute('SELECT * FROM plans WHERE price = ?', (price,)).fetchone()
            validity_days = 28
            data_text = "1.0"
            if plan_details:
                val_match = re.search(r'(\d+)', plan_details['validity'])
                if val_match: validity_days = int(val_match.group(1))
                dat_match = re.search(r'(\d+(\.\d+)?)', plan_details['data'])
                if dat_match: data_text = dat_match.group(1)
            response['data_balance'] = data_text
            try: recharge_date = datetime.strptime(last_recharge['date'], '%Y-%m-%d %H:%M:%S')
            except: recharge_date = datetime.now()
            expiry = recharge_date + timedelta(days=validity_days)
            remain = (expiry.date() - datetime.now().date()).days
            if remain > 0: response['days_left'] = remain; response['expiry_date'] = expiry.strftime("%d %b %Y")
            else: response['days_left'] = 0; response['expiry_date'] = "Plan Expired"
        return jsonify(response)
    finally: conn.close()
    
@app.route('/api/get_plans')
def get_plans():
    conn = get_db_connection()
    try: return jsonify([dict(row) for row in conn.execute('SELECT * FROM plans').fetchall()])
    finally: conn.close()

@app.route('/admin/add_plan', methods=['POST'])
def add_plan():
    if not session.get('is_admin'): return jsonify({'error': 'Unauthorized'}), 403
    data = request.json
    conn = get_db_connection()
    conn.execute("INSERT INTO plans (price, data, validity, description) VALUES (?, ?, ?, ?)", (data['price'], data['data'], data['validity'], data['desc']))
    conn.commit()
    conn.close()
    return jsonify({'status': 'Success'})

@app.route('/admin/delete_plan/<int:plan_id>', methods=['DELETE'])
def delete_plan(plan_id):
    if not session.get('is_admin'): return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'Deleted'})

@app.route('/api/history/<mobile_no>')
def get_history(mobile_no):
    conn = get_db_connection()
    try: return jsonify([dict(row) for row in conn.execute('SELECT * FROM recharges WHERE mobile_no = ? ORDER BY id DESC', (mobile_no,)).fetchall()])
    finally: conn.close()
@app.route('/admin/export_recharges')
def export_recharges():
    # Only allow logged-in admins to download
    if not session.get('is_admin'):
        return redirect(url_for('admin_login'))

    try:
        conn = get_db_connection()
        # Fetch all transaction data from the recharges table
        transactions = conn.execute("SELECT * FROM recharges ORDER BY date DESC").fetchall()
        conn.close()

        # Create a CSV in memory using the io module
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Add the Header Row
        writer.writerow(['ID', 'Mobile No', 'Plan Price', 'Plan Data', 'Date', 'Payment Mode'])
        
        # Add the Data Rows
        for tx in transactions:
            writer.writerow([
                tx['id'], 
                tx['mobile_no'], 
                tx['plan_price'], 
                tx['plan_data'], 
                tx['date'], 
                tx['payment_mode']
            ])

        # Create the response as a downloadable file
        response = Response(output.getvalue(), mimetype="text/csv")
        response.headers["Content-Disposition"] = "attachment; filename=recharge_report.csv"
        
        return response
    except Exception as e:
        print(f"Export Error: {e}")
        return f"Error generating report: {e}", 500
@app.route('/admin/clear_old_history', methods=['POST'])
def clear_old_history():
    if not session.get('is_admin'): return jsonify({'error': 'Unauthorized'}), 403
    try:
        conn = get_db_connection()
        # Deletes records older than 180 days
        conn.execute("DELETE FROM recharges WHERE date < datetime('now', '-180 days')")
        conn.commit()
        conn.close()
        return jsonify({'status': 'Old history cleared successfully'})
    except Exception as e:
        return jsonify({'error': str(e)})
@app.route('/admin/update_password', methods=['POST'])
def update_password():
    if not session.get('is_admin'):
        return jsonify({'error': 'Unauthorized'}), 403
    
    new_password = request.json.get('new_password')
    if not new_password or len(new_password) < 4:
        return jsonify({'error': 'Password must be at least 4 characters'}), 400

    # Update the global config
    global ADMIN_CONFIG
    ADMIN_CONFIG['password'] = new_password
    
    return jsonify({'status': 'Success', 'message': 'Password updated successfully!'})
@app.route('/api/delete_account', methods=['POST'])
def delete_account():
    data = request.get_json()
    mobile = data.get('mobile_no')
    
    if not mobile:
        return jsonify({'status': 'Failed', 'error': 'No mobile number provided'}), 400

    try:
        conn = get_db_connection()
        # Delete from all tables to keep the database clean
        conn.execute("DELETE FROM users WHERE mobile_no = ?", (mobile,))
        conn.execute("DELETE FROM recharges WHERE mobile_no = ?", (mobile,))
        conn.execute("DELETE FROM claimed_offers WHERE mobile_no = ?", (mobile,))
        conn.execute("DELETE FROM service_requests WHERE mobile_no = ?", (mobile,))
        
        conn.commit()
        conn.close()
        
        # Clear the python session
        session.pop('user_mobile', None) 
        
        return jsonify({'status': 'Success'})
    except Exception as e:
        return jsonify({'status': 'Failed', 'error': str(e)}), 500
if __name__ == '__main__':
    app.run(debug=True)