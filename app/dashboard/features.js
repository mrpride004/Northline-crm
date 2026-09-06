'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['New', 'Confirmed', 'Preparing', 'Dispatched', 'Delivered', 'Unreachable', 'Rescheduled', 'Cancelled'];

export function statusRowColor(status) {
  const map = {
    New: '#F1DFA9',
    Confirmed: '#B9E0D3',
    Preparing: '#C6CBF0',
    Dispatched: '#B6DEF3',
    Delivered: '#BEE4BE',
    Unreachable: '#F0C889',
    Rescheduled: '#D7BEEC',
    Cancelled: '#EFBEBA',
  };
  return map[status] || 'transparent';
}

export async function logEvent({ order_id, actor_id, actor_name, event_type, from_status, to_status, note }) {
  await supabase.from('order_events').insert({ order_id, actor_id, actor_name, event_type, from_status, to_status, note });
}

// ---------- Push notifications ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function enablePushNotifications(session, vapidPublicKey) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'Push notifications are not supported in this browser.' };
  }
  if (!vapidPublicKey) return { ok: false, error: 'Push isn\'t set up yet — ask your admin to finish the server setup.' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, error: 'Notification permission was not granted.' };
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }
    await fetch('/api/save-push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Something went wrong enabling notifications.' };
  }
}

export async function sendPushNotification(session, { userIds, title, body, url }) {
  if (!session || !userIds || userIds.length === 0) return;
  try {
    await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userIds, title, body, url }),
    });
  } catch (e) { /* best-effort — never block the main action on this */ }
}


export function showToast(message) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed; bottom:28px; left:50%; transform:translateX(-50%) translateY(0); background:#1F4D44; color:#fff; padding:11px 20px; border-radius:24px; font-size:13.5px; font-weight:600; z-index:9999; box-shadow:0 10px 30px rgba(0,0,0,.3); opacity:0; transition:opacity .18s ease, transform .18s ease;';
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(-6px)'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }, 1600);
}

// A more prominent, longer-lived banner for order alerts — tappable to dismiss early.
export function showOrderAlert(message) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%) translateY(-12px); background:#1F4D44; color:#fff; padding:13px 22px; border-radius:10px; font-size:13.5px; font-weight:600; z-index:9999; box-shadow:0 10px 30px rgba(0,0,0,.35); opacity:0; transition:opacity .2s ease, transform .2s ease; cursor:pointer; max-width:90vw; text-align:center;';
  el.onclick = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); };
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 5000);
}

// Short two-tone beep, generated on the fly — no audio file needed.
export function playNotificationSound() {
  if (typeof window === 'undefined' || !window.AudioContext && !window.webkitAudioContext) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.16);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.16);
    });
    setTimeout(() => ctx.close(), 500);
  } catch (e) { /* ignore — sound is best-effort */ }
}



export function getCycleStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export async function recordCommissionForOrder(order) {
  if (!order.staff_id || !order.product_id) return;
  const { data: rule } = await supabase.from('commission_rules').select('*').eq('product_id', order.product_id).maybeSingle();
  if (!rule) return;
  const isEligible = !rule.eligible_staff || rule.eligible_staff.length === 0 || rule.eligible_staff.includes(order.staff_id);
  if (!isEligible) return;
  const base = (order.quantity || 1) * Number(order.unit_price || 0);
  const cycleStart = getCycleStart(new Date());
  if (rule.standard_active) {
    const standardAmount = rule.standard_type === 'percentage' ? base * (rule.standard_value / 100) : rule.standard_value;
    if (standardAmount > 0) {
      await supabase.from('commission_ledger').insert({
        order_id: order.id, staff_id: order.staff_id, product_id: order.product_id,
        amount: standardAmount, commission_type: 'standard', cycle_start: cycleStart,
      });
    }
  }
  if (order.package_id && rule.upsell_active) {
    const upsellAmount = rule.upsell_type === 'percentage' ? base * (rule.upsell_value / 100) : rule.upsell_value;
    if (upsellAmount > 0) {
      await supabase.from('commission_ledger').insert({
        order_id: order.id, staff_id: order.staff_id, product_id: order.product_id,
        amount: upsellAmount, commission_type: 'upsell', cycle_start: cycleStart,
      });
    }
  }
}

export async function reverseCommissionForOrder(orderId) {
  await supabase.from('commission_ledger').update({ reversed: true }).eq('order_id', orderId).eq('reversed', false);
}

export async function recordFreeCommissionForOrder(order) {
  const { data: fresh } = await supabase.from('orders').select('*').eq('id', order.id).maybeSingle();
  if (!fresh || !fresh.staff_id) return;
  if (fresh.status !== 'Delivered' || fresh.payment_status !== 'Paid') return;
  const { data: rule } = await supabase.from('free_commission_rules').select('*').eq('active', true).limit(1).maybeSingle();
  if (!rule || !rule.amount || rule.amount <= 0) return;
  const isEligible = !rule.eligible_staff || rule.eligible_staff.length === 0 || rule.eligible_staff.includes(fresh.staff_id);
  if (!isEligible) return;
  const { data: existing } = await supabase.from('commission_ledger').select('id').eq('order_id', fresh.id).eq('commission_type', 'free').maybeSingle();
  if (existing) return; // already credited for this order
  await supabase.from('commission_ledger').insert({
    order_id: fresh.id, staff_id: fresh.staff_id, product_id: null, amount: rule.amount,
    commission_type: 'free', cycle_start: getCycleStart(new Date()),
  });
}


export async function copyToClipboard(text, label) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) { /* fall through to fallback */ }
  if (!ok) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      ok = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (e) { /* fall through */ }
  }
  if (ok) {
    showToast(`✓ ${label || 'Copied to clipboard'}`);
  } else {
    window.prompt('Copy this:', text);
  }
  return ok;
}

export function buildOrderSummary(order, products, packages, upsells) {
  const current = getCurrentPackage(order, upsells);
  const product = (products || []).find(p => p.id === current.productId);
  const pkg = current.packageId ? (packages || []).find(p => p.id === current.packageId) : null;
  const gift = pkg && pkg.gift_product_id ? (products || []).find(p => p.id === pkg.gift_product_id) : null;

  const lines = [
    `Order: ${order.id}`,
    `Customer: ${order.customer} (${order.phone || 'no phone'}${order.phone2 ? `, alt: ${order.phone2}` : ''})`,
    `Address: ${order.address || '—'}${order.state ? ', ' + order.state : ''}`,
    '',
    `${product ? product.name : '—'} × ${current.quantity} — ₦${current.unitPrice.toLocaleString()} each = ₦${current.amount.toLocaleString()}`,
    pkg ? `Package: ${pkg.name}` : null,
    gift ? `Free gift: ${gift.name} × ${order.gift_quantity}` : null,
  ];

  if (current.changed) {
    const prevProduct = (products || []).find(p => p.id === current.previousProductId);
    const prevPkg = current.previousPackageId ? (packages || []).find(p => p.id === current.previousPackageId) : null;
    lines.push(`(Customer moved to this package — originally ordered ${prevProduct ? prevProduct.name : '—'}${prevPkg ? ' · ' + prevPkg.name : ''})`);
  }

  lines.push(
    '',
    `Status: ${order.status}`,
    `Payment: ${order.payment_status || 'Unpaid'}`,
    order.priority === 'High' ? 'Priority: HIGH' : null,
    order.preferred_time ? `Preferred time: ${order.preferred_time}` : null,
    order.notes ? `Notes: ${order.notes}` : null,
  );
  return lines.filter(l => l !== null).join('\n');
}

// Finds the active package-change (the newest one that isn't rejected/reversed).
// A confirmed upsell REPLACES the original package for delivery/revenue purposes —
// the customer moved to a different package, they don't receive both.
export function activeUpsellFor(upsells) {
  const active = (upsells || []).filter(u => !['Rejected', 'Reversed'].includes(u.commission_status));
  if (active.length === 0) return null;
  return active.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

// What should actually be delivered and billed for this order right now.
export function getCurrentPackage(order, upsells) {
  const active = activeUpsellFor(upsells);
  if (active) {
    return {
      productId: active.upsell_product_id, packageId: active.upsell_package_id,
      quantity: active.additional_quantity, unitPrice: Number(active.unit_price || 0),
      amount: Number(active.additional_quantity || 1) * Number(active.unit_price || 0),
      changed: true,
      previousProductId: order.product_id, previousPackageId: order.package_id,
    };
  }
  return {
    productId: order.product_id, packageId: order.package_id,
    quantity: order.quantity || 1, unitPrice: Number(order.unit_price || 0),
    amount: (order.quantity || 1) * Number(order.unit_price || 0),
    changed: false, previousProductId: null, previousPackageId: null,
  };
}

export function computeSuccessRate(orders, staffId, windowDays, windowEnabled) {
  let myOrders = orders.filter(o => o.staff_id === staffId);
  if (windowEnabled && windowDays > 0) {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    myOrders = myOrders.filter(o => new Date(o.created_at) >= cutoff);
  }
  const delivered = myOrders.filter(o => o.status === 'Delivered');
  const deliveredPaid = delivered.filter(o => o.payment_status === 'Paid');
  const rate = delivered.length > 0 ? (deliveredPaid.length / delivered.length) * 100 : 100;
  return { rate, delivered: delivered.length, deliveredPaid: deliveredPaid.length };
}


export function orderTotal(o, upsells) {
  const current = getCurrentPackage(o, upsells);
  const fee = Number(o.delivery_fee || 0);
  return current.amount - fee;
}

export async function sendConfirmation({ phone, customerName, orderId, sendSms, sendWhatsapp }) {
  try {
    await fetch('/api/send-confirmation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, customerName, orderId, sendSms, sendWhatsapp }),
    });
  } catch (e) { console.error('Confirmation send failed', e); }
}

export async function forwardToDispatchCompany({ phone, channel, orderSummary }) {
  try {
    await fetch('/api/forward-dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, channel, orderSummary }),
    });
  } catch (e) { console.error('Dispatch forward failed', e); }
}

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe',
  'Zamfara', 'FCT (Abuja)',
];

// ---------- Agent stock (admin: allocate stock to each dispatch agent) ----------
export function AgentStockPage({ profiles, products, agentStock, refresh }) {
  const [agentId, setAgentId] = useState('');
  const [amounts, setAmounts] = useState({});
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [errors, setErrors] = useState({});
  const dispatchList = profiles.filter(p => p.role === 'dispatch');
  const selected = dispatchList.find(d => d.id === agentId);

  function stockFor(pid) {
    const row = agentStock.find(a => a.agent_id === agentId && a.product_id === pid);
    return row ? row.quantity : 0;
  }

  async function send(pid) {
    const amt = parseInt(amounts[pid], 10);
    if (!amt || amt <= 0 || !agentId) return;
    const product = products.find(p => p.id === pid);
    if (!product || product.stock_quantity < amt) {
      setErrors({ ...errors, [pid]: `Only ${product ? product.stock_quantity : 0} in central inventory — can't send ${amt}.` });
      return;
    }
    setErrors({ ...errors, [pid]: null });
    const { error } = await supabase.rpc('send_stock_to_agent', { p_agent_id: agentId, p_product_id: pid, p_amount: amt });
    if (error) {
      setErrors({ ...errors, [pid]: error.message });
      return;
    }
    setAmounts({ ...amounts, [pid]: '' });
    refresh();
  }

  async function exportMovements() {
    if (!agentId) return;
    let query = supabase.from('stock_movements').select('*').eq('agent_id', agentId).order('created_at', { ascending: false });
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate + 'T23:59:59');
    const { data } = await query;
    const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
    const headers = ['Date', 'Product', 'Change', 'Reason'];
    const rows = (data || []).map(m => [new Date(m.created_at).toLocaleString(), prodName(m.product_id), m.delta, m.reason || '']);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-stock-${(selected?.full_name || 'agent').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Agent stock</h1><p className="page-sub">Send stock to a dispatch agent — this pulls it from central inventory. See what they're currently holding.</p></div>
      </div>
      <div style={{ marginBottom: '18px', maxWidth: '360px' }}>
        <label className="field-label">Select agent</label>
        <select value={agentId} onChange={e => setAgentId(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
          <option value="">— Choose a dispatch partner —</option>
          {dispatchList.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.state ? ` · ${d.state}` : ''}</option>)}
        </select>
      </div>

      {!agentId && <div className="empty">Choose an agent above to view and send stock.</div>}

      {agentId && (
        <>
          <table style={{ marginBottom: '20px' }}>
            <thead><tr><th>Product</th><th>Central inventory</th><th>Agent currently holds</th><th>Send more</th></tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><span className={'pill ' + (p.stock_quantity > 0 ? 'Delivered' : 'Cancelled')}>{p.stock_quantity} available</span></td>
                  <td><span className="pill Delivered">{stockFor(p.id)} units</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <input
                      type="number" min="1" placeholder="qty"
                      value={amounts[p.id] || ''}
                      onChange={e => setAmounts({ ...amounts, [p.id]: e.target.value })}
                      style={{ width: '80px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                    />{' '}
                    <button className="link-btn" onClick={() => send(p.id)}>Send</button>
                    {errors[p.id] && <div style={{ fontSize: '11px', color: '#B0483F', marginTop: '4px', maxWidth: '200px' }}>{errors[p.id]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', maxWidth: '460px' }}>
            <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '15px', marginTop: 0, marginBottom: '10px' }}>Download stock history for {selected?.full_name}</h3>
            <div className="row2" style={{ marginBottom: '10px' }}>
              <div><label className="field-label" style={{ marginTop: 0 }}>From (optional)</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
              <div><label className="field-label" style={{ marginTop: 0 }}>To (optional)</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
            </div>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '10px' }}>Leave both blank for the full history. Use the same date for both to get a single day.</p>
            <button className="btn primary" onClick={exportMovements} style={{ width: '100%' }}>⬇ Download CSV</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- My stock (dispatch agent's own view) ----------
export function MyStockPage({ profile, agentStock, products }) {
  const mine = agentStock.filter(a => a.agent_id === profile.id);
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">My stock</h1><p className="page-sub">Products currently sent to you by admin.</p></div></div>
      {mine.length === 0 ? <div className="empty">No stock has been sent to you yet.</div> : (
        <table>
          <thead><tr><th>Product</th><th>In your possession</th></tr></thead>
          <tbody>
            {mine.map(a => (
              <tr key={a.id}><td>{prodName(a.product_id)}</td><td><span className="pill Delivered">{a.quantity} units</span></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Confirm order (priority + preferred time + remark, before dispatch) ----------
// ---------- Status change with optional remark (and delivery fee if delivering) ----------
export function StatusRemarkModal({ order, newStatus, hidePaidCheckbox, onClose, onConfirm }) {
  const [remark, setRemark] = useState('');
  const [fee, setFee] = useState(order.delivery_fee || '');
  const [rescheduleDate, setRescheduleDate] = useState(order.reschedule_date || '');
  const [paidNow, setPaidNow] = useState(false);
  const isDelivering = newStatus === 'Delivered';
  const isRescheduling = newStatus === 'Rescheduled';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Mark as {newStatus}</h3>
        {isDelivering && (
          <>
            <label style={{ marginTop: 0 }}>Delivery fee collected (₦)</label>
            <input type="number" min="0" value={fee} onChange={e => setFee(e.target.value)} placeholder="e.g. 1500" autoFocus />
            {!hidePaidCheckbox && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13.5px', fontWeight: 'normal' }}>
                  <input type="checkbox" checked={paidNow} onChange={e => setPaidNow(e.target.checked)} />
                  Has payment been remitted? (mark it Paid too)
                </label>
                <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '6px' }}>
                  Leave unticked if payment hasn't come in yet — you (or admin) can mark it Paid separately later.
                </p>
              </>
            )}
          </>
        )}
        {isRescheduling && (
          <>
            <label style={{ marginTop: 0 }}>New delivery date</label>
            <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} autoFocus />
          </>
        )}
        <label style={{ marginTop: (isDelivering || isRescheduling) ? '14px' : 0 }}>Remark (optional)</label>
        <textarea value={remark} onChange={e => setRemark(e.target.value)} placeholder="Anything worth noting about this update" autoFocus={!isDelivering && !isRescheduling} />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onConfirm({ remark: remark.trim(), fee: parseFloat(fee) || 0, rescheduleDate, paidNow })}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmOrderModal({ order, profile, profiles, session, onClose, onConfirmed }) {
  const [priority, setPriority] = useState(order.priority || 'Normal');
  const [preferredTime, setPreferredTime] = useState(order.preferred_time || '');
  const [remark, setRemark] = useState('');
  const [statePref, setStatePref] = useState(null);
  const [chosenAgent, setChosenAgent] = useState(null);
  const [assignMode, setAssignMode] = useState(null);
  const [loadedPref, setLoadedPref] = useState(false);

  const matchingDispatch = (profiles || []).filter(p => p.role === 'dispatch' && p.active && order.state && p.state === order.state);

  useEffect(() => {
    (async () => {
      if (!order.state) { setLoadedPref(true); return; }
      const { data: pref } = await supabase.from('state_dispatch_preference').select('*').eq('state', order.state).maybeSingle();
      setStatePref(pref);

      if (pref && pref.active && pref.assignment_mode === 'round_robin' && matchingDispatch.length > 0) {
        const ids = matchingDispatch.map(d => d.id);
        const { data: activeOrders } = await supabase.from('orders').select('dispatch_id').in('dispatch_id', ids).not('status', 'in', '("Delivered","Cancelled")');
        const counts = {};
        ids.forEach(id => { counts[id] = 0; });
        (activeOrders || []).forEach(o => { if (o.dispatch_id) counts[o.dispatch_id] = (counts[o.dispatch_id] || 0) + 1; });
        const leastLoaded = matchingDispatch.slice().sort((a, b) => counts[a.id] - counts[b.id])[0];
        setChosenAgent(leastLoaded);
        setAssignMode('round_robin');
      } else if (pref && pref.active && pref.dispatch_id) {
        const agent = matchingDispatch.find(d => d.id === pref.dispatch_id);
        setChosenAgent(agent || matchingDispatch[0] || null);
        setAssignMode(agent ? 'preferred' : (matchingDispatch[0] ? 'first_match' : null));
      } else {
        setChosenAgent(matchingDispatch[0] || null);
        setAssignMode(matchingDispatch[0] ? 'first_match' : null);
      }
      setLoadedPref(true);
    })();
  }, []);

  const willAutoAssign = !order.dispatch_id && !!chosenAgent;

  async function confirm() {
    const patch = {
      status: 'Confirmed', priority, preferred_time: preferredTime.trim(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    };
    if (willAutoAssign) patch.dispatch_id = chosenAgent.id;
    await supabase.from('orders').update(patch).eq('id', order.id);
    await supabase.from('original_order_snapshots').upsert({
      order_id: order.id, customer: order.customer, phone: order.phone,
      product_id: order.product_id, package_id: order.package_id, quantity: order.quantity,
      unit_price: order.unit_price, total_amount: (order.quantity || 1) * Number(order.unit_price || 0),
      staff_id: order.staff_id, created_at: order.created_at, confirmed_at: patch.confirmed_at,
      order_source: order.created_by ? 'staff_submission' : 'admin', original_status: 'Confirmed',
    }, { onConflict: 'order_id' });
    await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: order.status, to_status: 'Confirmed' });
    await supabase.from('audit_log').insert({ actor_id: profile?.id, actor_name: profile?.full_name, action: 'Original Order Confirmed', order_id: order.id, new_value: `${order.quantity || 1} × product ${order.product_id}` });
    if (willAutoAssign) {
      await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'assigned', note: `Automatically sent to ${chosenAgent.full_name} (${order.state}) on confirmation${assignMode === 'round_robin' ? ' — load-balanced pick' : ''}.` });
      sendPushNotification(session, { userIds: [chosenAgent.id], title: 'New delivery assigned', body: order.customer, url: '/dashboard' });
    }
    if (remark.trim()) {
      await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: remark.trim() });
    }
    onConfirmed();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Confirm order · {order.customer}</h3>
        <label style={{ marginTop: 0 }}>Priority</label>
        <select value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="Normal">Normal</option>
          <option value="High">High priority</option>
        </select>
        <label>Preferred delivery time</label>
        <input value={preferredTime} onChange={e => setPreferredTime(e.target.value)} placeholder="e.g. After 5pm, or Saturday morning" />
        <label>Remark for dispatch (optional)</label>
        <textarea value={remark} onChange={e => setRemark(e.target.value)} placeholder="Anything dispatch should know before delivering" />
        {!loadedPref ? null : order.dispatch_id ? (
          <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '10px' }}>Already assigned to a dispatch partner — confirming will notify them.</p>
        ) : willAutoAssign ? (
          <p style={{ fontSize: '11.5px', color: '#2E6E62', marginTop: '10px' }}>
            ✓ Will automatically send to {chosenAgent.full_name} in {order.state} on confirmation
            {assignMode === 'preferred' ? ' (admin-preferred agent)' : assignMode === 'round_robin' ? ' (load-balanced — has the fewest active deliveries right now)' : ''}.
          </p>
        ) : (
          <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '10px' }}>No dispatch partner found for {order.state || "this order's state"} yet — admin will need to assign one manually.</p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={confirm}>Confirm order</button>
        </div>
      </div>
    </div>
  );
}


export function ReportsPage({ orders, profiles, products, session }) {
  const [range, setRange] = useState('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [lastSeen, setLastSeen] = useState({});
  const [detailPerson, setDetailPerson] = useState(null);
  const [movements, setMovements] = useState([]);
  const [upsellsByOrder, setUpsellsByOrder] = useState({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(60);
      setMovements(data || []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('upsells').select('*');
      const map = {};
      (data || []).forEach(u => {
        if (!map[u.original_order_id]) map[u.original_order_id] = [];
        map[u.original_order_id].push(u);
      });
      setUpsellsByOrder(map);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!session) return;
      try {
        const res = await fetch('/api/team-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json();
        if (res.ok) {
          const map = {};
          body.statuses.forEach(s => { map[s.id] = s.last_sign_in_at; });
          setLastSeen(map);
        }
      } catch (e) { console.error('Failed to load last-seen', e); }
    })();
  }, [session]);

  function inRange(o) {
    const created = new Date(o.created_at);
    const now = new Date();
    if (range === 'today') return created.toDateString() === now.toDateString();
    if (range === '7d') return now - created <= 7 * 24 * 60 * 60 * 1000;
    if (range === '30d') return now - created <= 30 * 24 * 60 * 60 * 1000;
    if (range === 'custom') {
      if (fromDate && created < new Date(fromDate)) return false;
      if (toDate && created > new Date(toDate + 'T23:59:59')) return false;
      return true;
    }
    return true;
  }

  function timeAgo(iso) {
    if (!iso) return 'Never';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const scoped = orders.filter(inRange);
  const delivered = scoped.filter(o => o.status === 'Delivered');
  const cancelled = scoped.filter(o => o.status === 'Cancelled');
  const revenue = delivered.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
  const totalDeliveryCharges = delivered.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);

  function buildPerformance(role) {
    return profiles.filter(p => p.role === role).map(s => {
      const handled = scoped.filter(o => (role === 'dispatch' ? o.dispatch_id : o.staff_id) === s.id);
      const done = handled.filter(o => o.status === 'Delivered' && o.delivered_at);
      const cancelledByThem = handled.filter(o => o.status === 'Cancelled');
      const avgHours = done.length
        ? done.reduce((sum, o) => sum + (new Date(o.delivered_at) - new Date(o.created_at)) / 3600000, 0) / done.length
        : null;
      const deliveryCharges = done.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);
      const deliveryRate = handled.length ? done.length / handled.length : 0;
      return { ...s, handled: handled.length, delivered: done.length, cancelled: cancelledByThem.length, avgHours, deliveryCharges, deliveryRate };
    }).sort((a, b) => (b.deliveryRate - a.deliveryRate) || (b.delivered - a.delivered));
  }

  const staffPerf = buildPerformance('staff');
  const dispatchPerf = buildPerformance('dispatch');

  const dispatchAgents = profiles.filter(p => p.role === 'dispatch');
  const byState = {};
  dispatchAgents.forEach(a => {
    const st = a.state || 'Unassigned state';
    if (!byState[st]) byState[st] = { sent: 0, delivered: 0, agents: 0 };
    byState[st].agents += 1;
    const handled = scoped.filter(o => o.dispatch_id === a.id);
    byState[st].sent += handled.length;
    byState[st].delivered += handled.filter(o => o.status === 'Delivered').length;
  });
  const stateRows = Object.entries(byState).sort((a, b) => b[1].sent - a[1].sent);

  function PerformanceTable({ title, rows, roleLabel }) {
    return (
      <>
        <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '24px 0 10px' }}>{title}</h3>
        <table>
          <thead><tr><th>Name</th><th>State</th><th>Handled</th><th>Delivered</th><th>Avg. turnaround</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7" className="empty">No {roleLabel} added yet.</td></tr>}
            {rows.map(s => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setDetailPerson(s)}>
                <td>{s.full_name}{!s.active && <span style={{ color: '#8A93A0', fontSize: '11px' }}> (not receiving)</span>}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{s.state || '—'}</td>
                <td>{s.handled}</td>
                <td>{s.delivered}</td>
                <td>{s.avgHours ? s.avgHours.toFixed(1) + ' hrs' : '—'}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{timeAgo(lastSeen[s.id])}</td>
                <td><span className="link-btn">Details</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Reports</h1><p className="page-sub">Order volume, revenue, and team performance.</p></div>
      </div>
      <div className="product-tabs">
        <span className={'ptab' + (range === 'today' ? ' active' : '')} onClick={() => setRange('today')}>Today</span>
        <span className={'ptab' + (range === '7d' ? ' active' : '')} onClick={() => setRange('7d')}>Last 7 days</span>
        <span className={'ptab' + (range === '30d' ? ' active' : '')} onClick={() => setRange('30d')}>Last 30 days</span>
        <span className={'ptab' + (range === 'all' ? ' active' : '')} onClick={() => setRange('all')}>All time</span>
        <span className={'ptab' + (range === 'custom' ? ' active' : '')} onClick={() => setRange('custom')}>Custom range</span>
      </div>
      {range === 'custom' && (
        <div className="row2" style={{ maxWidth: '420px', marginBottom: '16px' }}>
          <div><label className="field-label" style={{ marginTop: 0 }}>From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
          <div><label className="field-label" style={{ marginTop: 0 }}>To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
        </div>
      )}
      <div className="stats">
        <div className="stat"><div className="stat-num">{scoped.length}</div><div className="stat-label">Orders</div></div>
        <div className="stat"><div className="stat-num">{delivered.length}</div><div className="stat-label">Delivered</div></div>
        <div className="stat"><div className="stat-num">{cancelled.length}</div><div className="stat-label">Cancelled</div></div>
        <div className="stat"><div className="stat-num">₦{revenue.toLocaleString()}</div><div className="stat-label">Revenue (after delivery fees)</div></div>
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Delivery charges</h3>
      <div className="stats" style={{ marginBottom: '8px' }}>
        <div className="stat"><div className="stat-num">₦{totalDeliveryCharges.toLocaleString()}</div><div className="stat-label">Total delivery charges (delivered orders)</div></div>
      </div>
      <p style={{ fontSize: '11.5px', color: '#8A93A0', marginBottom: '18px' }}>Delivery charges are entered by dispatch when they mark an order delivered, and are already subtracted from the revenue figure above.</p>

      {products && products.length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>By product</h3>
          <table style={{ marginBottom: '24px' }}>
            <thead><tr><th>Product</th><th>Orders</th><th>Delivered</th><th>Revenue</th></tr></thead>
            <tbody>
              {products.map(p => {
                const prodOrders = scoped.filter(o => o.product_id === p.id);
                const prodDelivered = prodOrders.filter(o => o.status === 'Delivered');
                const prodRevenue = prodDelivered.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{prodOrders.length}</td>
                    <td>{prodDelivered.length}</td>
                    <td>₦{prodRevenue.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>By status</h3>
      <table style={{ marginBottom: '24px' }}>
        <thead><tr><th>Status</th><th>Orders in this range</th></tr></thead>
        <tbody>
          {STATUSES.map(s => (
            <tr key={s}><td><span className={'pill ' + s}>{s}</span></td><td>{scoped.filter(o => o.status === s).length}</td></tr>
          ))}
        </tbody>
      </table>

      <PerformanceTable title="Staff performance (top performers first)" rows={staffPerf} roleLabel="staff" />
      <PerformanceTable title="Dispatch performance (top performers first)" rows={dispatchPerf} roleLabel="dispatch partners" />

      {products && products.length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '24px 0 10px' }}>Inventory levels</h3>
          <table style={{ marginBottom: '24px' }}>
            <thead><tr><th>Product</th><th>Current stock</th></tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}><td>{p.name}</td><td><span className={'pill ' + (p.stock_quantity <= p.low_stock_threshold ? 'Cancelled' : 'Delivered')}>{p.stock_quantity} units</span></td></tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '24px 0 10px' }}>Recent stock activity</h3>
          <table style={{ marginBottom: '24px' }}>
            <thead><tr><th>Date</th><th>Product</th><th>Change</th><th>Reason</th></tr></thead>
            <tbody>
              {movements.length === 0 && <tr><td colSpan="4" className="empty">No stock changes recorded yet.</td></tr>}
              {movements.map(m => {
                const prod = products.find(p => p.id === m.product_id);
                return (
                  <tr key={m.id}>
                    <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(m.created_at).toLocaleString()}</td>
                    <td>{prod ? prod.name : '—'}</td>
                    <td><span className={'pill ' + (m.delta >= 0 ? 'Delivered' : 'Cancelled')}>{m.delta >= 0 ? '+' : ''}{m.delta}</span></td>
                    <td style={{ fontSize: '12px', color: '#8A93A0' }}>{m.reason || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '24px 0 10px' }}>By state</h3>
      <table>
        <thead><tr><th>State</th><th>Agents</th><th>Orders sent</th><th>Delivered</th></tr></thead>
        <tbody>
          {stateRows.length === 0 && <tr><td colSpan="4" className="empty">No dispatch agents assigned to a state yet.</td></tr>}
          {stateRows.map(([state, d]) => (
            <tr key={state}><td>{state}</td><td>{d.agents}</td><td>{d.sent}</td><td>{d.delivered}</td></tr>
          ))}
        </tbody>
      </table>

      {detailPerson && (
        <PersonDetailModal
          person={detailPerson}
          orders={scoped}
          lastSeenText={timeAgo(lastSeen[detailPerson.id])}
          onClose={() => setDetailPerson(null)}
        />
      )}
    </div>
  );
}

export function PersonDetailModal({ person, orders, lastSeenText, session, onChanged, onClose }) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [commissionSummary, setCommissionSummary] = useState(null);
  const isDispatch = person.role === 'dispatch';
  const handled = orders.filter(o => (isDispatch ? o.dispatch_id : o.staff_id) === person.id);
  const byStatus = {};
  STATUSES.forEach(s => { byStatus[s] = handled.filter(o => o.status === s).length; });
  const delivered = handled.filter(o => o.status === 'Delivered');
  const deliveryCharges = delivered.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);
  const avgHours = delivered.length
    ? delivered.reduce((sum, o) => sum + (new Date(o.delivered_at) - new Date(o.created_at)) / 3600000, 0) / delivered.length
    : null;

  useEffect(() => {
    if (person.role !== 'staff') return;
    (async () => {
      const [{ data: led }, { data: cl }] = await Promise.all([
        supabase.from('commission_ledger').select('*').eq('staff_id', person.id).eq('reversed', false),
        supabase.from('commission_claims').select('*').eq('staff_id', person.id),
      ]);
      const earned = (led || []).reduce((sum, l) => sum + Number(l.amount), 0);
      const claimed = (cl || []).reduce((sum, c) => sum + Number(c.amount), 0);
      setCommissionSummary({ earned, claimed, balance: earned - claimed });
    })();
  }, [person.id]);

  const deliveredPaid = delivered.filter(o => o.payment_status === 'Paid');
  const successRate = delivered.length > 0 ? (deliveredPaid.length / delivered.length) * 100 : 100;

  function buildSummaryText() {
    const lines = [
      `Performance summary — ${person.full_name}`,
      `Role: ${person.role}${person.state ? ' · ' + person.state : ''}`,
      `Joined: ${person.created_at ? new Date(person.created_at).toLocaleDateString() : '—'}`,
      `Last seen: ${lastSeenText}`,
      '',
      `Total handled: ${handled.length}`,
      `Delivered: ${delivered.length}`,
      `Success rate (delivered & paid): ${successRate.toFixed(0)}%`,
      avgHours ? `Avg. turnaround: ${avgHours.toFixed(1)}h` : null,
      isDispatch ? `Delivery charges collected: ₦${deliveryCharges.toLocaleString()}` : null,
    ];
    STATUSES.forEach(s => lines.push(`  ${s}: ${byStatus[s]}`));
    if (commissionSummary) {
      lines.push('', `Commission earned: ₦${commissionSummary.earned.toLocaleString()}`, `Commission claimed: ₦${commissionSummary.claimed.toLocaleString()}`, `Unclaimed balance: ₦${commissionSummary.balance.toLocaleString()}`);
    }
    return lines.filter(l => l !== null).join('\n');
  }

  async function shareSummary() {
    await copyToClipboard(buildSummaryText(), 'Performance summary copied — paste it anywhere to share');
  }

  async function toggleActive() {
    setBusy(true);
    await supabase.from('profiles').update({ active: !person.active }).eq('id', person.id);
    setBusy(false);
    if (onChanged) onChanged();
  }

  async function setPassword() {
    if (!session || newPassword.length < 6) { setPasswordMsg('Password must be at least 6 characters.'); return; }
    setBusy(true);
    const res = await fetch('/api/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: person.id, newPassword }),
    });
    const body = await res.json();
    setBusy(false);
    setPasswordMsg(res.ok ? `Password updated — tell ${person.full_name.split(' ')[0]} their new password: ${newPassword}` : (body.error || 'Something went wrong.'));
  }

  async function remove() {
    if (!session) return;
    setBusy(true);
    await fetch('/api/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: person.id }),
    });
    setBusy(false);
    if (onChanged) onChanged();
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{person.full_name}</h3>
        <p style={{ fontSize: '12.5px', color: '#8A93A0', marginTop: '-10px', marginBottom: '10px' }}>
          {person.role === 'dispatch' ? 'Dispatch partner' : person.role}{person.state ? ` · ${person.state}` : ''} ·
          {' '}{person.active ? 'Receiving orders' : 'Not receiving orders'} · Joined {person.created_at ? new Date(person.created_at).toLocaleDateString() : '—'} · Last seen: {lastSeenText}
        </p>
        <div className="list-manage" style={{ marginBottom: '16px' }}>
          <div className="list-manage-row"><span>Email</span><span style={{ color: '#8A93A0' }}>{person.email || '—'}</span></div>
          <div className="list-manage-row"><span>Username</span><span style={{ color: '#8A93A0' }}>{person.username ? '@' + person.username : '—'}</span></div>
        </div>
        <div className="stats" style={{ marginBottom: '16px' }}>
          <div className="stat"><div className="stat-num">{handled.length}</div><div className="stat-label">Total handled</div></div>
          <div className="stat"><div className="stat-num">{delivered.length}</div><div className="stat-label">Delivered</div></div>
          <div className="stat"><div className="stat-num">{successRate.toFixed(0)}%</div><div className="stat-label">Success rate</div></div>
          <div className="stat"><div className="stat-num">{avgHours ? avgHours.toFixed(1) + 'h' : '—'}</div><div className="stat-label">Avg. turnaround</div></div>
          {isDispatch && <div className="stat"><div className="stat-num">₦{deliveryCharges.toLocaleString()}</div><div className="stat-label">Delivery charges collected</div></div>}
          {commissionSummary && <div className="stat"><div className="stat-num">₦{commissionSummary.balance.toLocaleString()}</div><div className="stat-label">Unclaimed commission</div></div>}
        </div>
        <button className="btn" onClick={shareSummary} style={{ marginBottom: '16px' }}>📋 Copy performance summary to share</button>
        <div className="list-manage" style={{ marginBottom: '16px' }}>
          {STATUSES.map(s => (
            <div key={s} className="list-manage-row"><span>{s}</span><span style={{ color: '#8A93A0' }}>{byStatus[s]}</span></div>
          ))}
        </div>

        {!showPassword ? (
          <button className="link-btn" onClick={() => setShowPassword(true)} style={{ marginBottom: '16px', display: 'block' }}>Set a new password for this person</button>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
            <label className="field-label" style={{ marginTop: 0 }}>New password (at least 6 characters)</label>
            <input value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Type a new password" style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '8px' }} />
            <button className="btn primary" onClick={setPassword} disabled={busy}>Set password</button>
            {passwordMsg && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '8px' }}>{passwordMsg}</p>}
          </div>
        )}

        {confirmRemove ? (
          <div className="banner" style={{ background: '#F3DEDC', borderColor: '#E7C3BF' }}>
            <p style={{ margin: '0 0 10px 0' }}>Remove {person.full_name}'s login permanently? They won't be able to sign in again. This can't be undone.</p>
            <button className="btn" onClick={() => setConfirmRemove(false)} disabled={busy}>Cancel</button>{' '}
            <button className="btn" style={{ background: '#B0483F', color: '#fff', borderColor: '#B0483F' }} onClick={remove} disabled={busy}>Yes, remove permanently</button>
          </div>
        ) : (
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <button className="btn" style={{ color: '#B0483F' }} onClick={() => setConfirmRemove(true)} disabled={busy}>Remove login</button>
            <div>
              <button className="btn" onClick={toggleActive} disabled={busy} style={{ marginRight: '8px' }}>{person.active ? 'Deactivate' : 'Activate'}</button>
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Settings: messaging toggles + external dispatch companies ----------
export function SettingsPage({ settings, profiles, session, profile, refresh }) {
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [statePrefs, setStatePrefs] = useState({});
  const [savingState, setSavingState] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState('all_staff');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyStatus, setNotifyStatus] = useState('');
  const [sendingNotify, setSendingNotify] = useState(false);

  async function sendCustomNotification() {
    if (!notifyMessage.trim()) { setNotifyStatus('Write a message first.'); return; }
    let userIds = [];
    if (notifyTarget === 'all_staff') userIds = (profiles || []).filter(p => p.role === 'staff').map(p => p.id);
    else if (notifyTarget === 'all_dispatch') userIds = (profiles || []).filter(p => p.role === 'dispatch').map(p => p.id);
    else if (notifyTarget === 'everyone') userIds = (profiles || []).filter(p => p.role !== 'admin').map(p => p.id);
    else userIds = [notifyTarget];
    if (userIds.length === 0) { setNotifyStatus('No one matches that selection.'); return; }
    setSendingNotify(true);
    await sendPushNotification(session, { userIds, title: 'Message from admin', body: notifyMessage.trim(), url: '/dashboard' });
    setSendingNotify(false);
    setNotifyStatus(`✓ Sent to ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}.`);
    setNotifyMessage('');
  }

  async function changeMyPassword() {
    if (newPassword.length < 6) { setPasswordMsg('Password must be at least 6 characters.'); return; }
    setSavingPassword(true);
    const res = await fetch('/api/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: profile.id, newPassword }),
    });
    const body = await res.json();
    setSavingPassword(false);
    setPasswordMsg(res.ok ? '✓ Password updated — use it next time you sign in.' : (body.error || 'Something went wrong.'));
    if (res.ok) setNewPassword('');
  }

  const dispatchList = (profiles || []).filter(p => p.role === 'dispatch');
  const statesWithMultipleAgents = [...new Set(dispatchList.map(d => d.state).filter(Boolean))]
    .filter(st => dispatchList.filter(d => d.state === st).length > 1);

  useEffect(() => { loadCompanies(); loadStatePrefs(); }, []);
  async function loadCompanies() {
    const { data } = await supabase.from('dispatch_companies').select('*').order('created_at', { ascending: false });
    setCompanies(data || []);
  }
  async function loadStatePrefs() {
    const { data } = await supabase.from('state_dispatch_preference').select('*');
    const map = {};
    (data || []).forEach(r => { map[r.state] = r; });
    setStatePrefs(map);
  }

  async function toggleSetting(key) {
    const current = settings[key] === 'true';
    await supabase.from('app_settings').upsert({ key, value: (!current).toString() });
    refresh();
  }

  async function addCompany() {
    if (!name.trim() || !phone.trim()) return;
    await supabase.from('dispatch_companies').insert({ name: name.trim(), contact_name: contactName.trim(), phone: phone.trim(), channel });
    setName(''); setContactName(''); setPhone('');
    loadCompanies();
  }
  async function removeCompany(id) {
    await supabase.from('dispatch_companies').delete().eq('id', id);
    loadCompanies();
  }

  async function saveStatePref(state, dispatchId, active, mode) {
    setSavingState(state);
    const existing = statePrefs[state];
    await supabase.from('state_dispatch_preference').upsert({
      state, dispatch_id: dispatchId || null, active,
      assignment_mode: mode || (existing ? existing.assignment_mode : 'preferred'),
      updated_at: new Date().toISOString(),
    });
    await loadStatePrefs();
    setSavingState('');
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Settings</h1><p className="page-sub">Control automatic messaging and manage external dispatch companies.</p></div></div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>My account</h3>
      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', maxWidth: '440px', marginBottom: '22px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Change my password</label>
        <input
          type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
          placeholder="New password (at least 6 characters)"
          style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px' }}
        />
        <button className="btn primary" onClick={changeMyPassword} disabled={savingPassword} style={{ width: '100%' }}>
          {savingPassword ? 'Saving…' : 'Set new password'}
        </button>
        {passwordMsg && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '10px' }}>{passwordMsg}</p>}
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Send a notification</h3>
      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', maxWidth: '440px', marginBottom: '22px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Who should get this?</label>
        <select value={notifyTarget} onChange={e => setNotifyTarget(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px' }}>
          <option value="all_staff">All staff</option>
          <option value="all_dispatch">All dispatch partners</option>
          <option value="everyone">Everyone (staff + dispatch)</option>
          {(profiles || []).filter(p => p.role !== 'admin').map(p => (
            <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
          ))}
        </select>
        <label className="field-label">Message</label>
        <textarea
          value={notifyMessage} onChange={e => setNotifyMessage(e.target.value)}
          placeholder="e.g. Please check your unassigned orders before close of business today"
          style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px', minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <button className="btn primary" onClick={sendCustomNotification} disabled={sendingNotify} style={{ width: '100%' }}>
          {sendingNotify ? 'Sending…' : '🔔 Send notification'}
        </button>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '8px' }}>
          Only reaches people who've turned on push notifications from their sidebar. It won't wake up someone who hasn't enabled it yet.
        </p>
        {notifyStatus && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '6px' }}>{notifyStatus}</p>}
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Order confirmation to customers</h3>
      <div className="list-manage" style={{ marginBottom: '22px' }}>
        <div className="list-manage-row">
          <span>Auto-send SMS when a new order is created</span>
          <button className="btn" onClick={() => toggleSetting('sms_auto_confirm')}>{settings.sms_auto_confirm === 'true' ? 'On — turn off' : 'Off — turn on'}</button>
        </div>
        <div className="list-manage-row">
          <span>Auto-send WhatsApp when a new order is created</span>
          <button className="btn" onClick={() => toggleSetting('whatsapp_auto_confirm')}>{settings.whatsapp_auto_confirm === 'true' ? 'On — turn off' : 'Off — turn on'}</button>
        </div>
      </div>
      <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-10px', marginBottom: '22px' }}>
        Even with these off, you can always send a confirmation manually from the order row. These only need
        TERMII / WhatsApp keys set up in Vercel to actually send — see the README.
      </p>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Preferred dispatch agent per state</h3>
      <p style={{ fontSize: '12.5px', color: '#8A93A0', marginBottom: '10px' }}>
        For states with more than one dispatch partner, pick who gets new orders automatically when a staff
        member confirms one there. Stays in effect until you change it or turn it off.
      </p>
      <div className="list-manage" style={{ marginBottom: '22px' }}>
        {statesWithMultipleAgents.length === 0 && (
          <div className="list-manage-row" style={{ color: '#8A93A0' }}>No state currently has more than one dispatch partner — nothing to set yet.</div>
        )}
        {statesWithMultipleAgents.map(state => {
          const agentsHere = dispatchList.filter(d => d.state === state);
          const pref = statePrefs[state];
          const mode = pref?.assignment_mode || 'preferred';
          return (
            <div key={state} className="list-manage-row" style={{ flexWrap: 'wrap' }}>
              <span style={{ minWidth: '100px', display: 'inline-block' }}>{state}</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={mode}
                  onChange={e => saveStatePref(state, pref?.dispatch_id, pref ? pref.active : true, e.target.value)}
                  style={{ fontSize: '12px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                >
                  <option value="preferred">Fixed agent</option>
                  <option value="round_robin">Load-balance (least busy)</option>
                </select>
                {mode === 'preferred' && (
                  <select
                    value={pref?.dispatch_id || ''}
                    onChange={e => saveStatePref(state, e.target.value, pref ? pref.active : true, mode)}
                    style={{ fontSize: '12px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                  >
                    <option value="">— No preference (first match) —</option>
                    {agentsHere.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                )}
                <button
                  className="btn"
                  onClick={() => saveStatePref(state, pref?.dispatch_id, !(pref ? pref.active : true), mode)}
                  disabled={savingState === state}
                >
                  {pref && !pref.active ? 'Off — turn on' : 'On — turn off'}
                </button>
              </div>
              {mode === 'round_robin' && (
                <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '4px', width: '100%' }}>
                  New orders here will automatically go to whichever of your {agentsHere.length} agents currently has the fewest active deliveries.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>External dispatch companies</h3>
      <p style={{ fontSize: '12.5px', color: '#8A93A0', marginBottom: '10px' }}>
        For couriers you haven't onboarded onto the CRM. Add their contact person here — when you forward an
        order to them, a message goes to this number for them to relay to their team.
      </p>
      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {companies.map(c => (
          <div key={c.id} className="list-manage-row">
            <span>{c.name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>· {c.contact_name} · {c.phone} · {c.channel}</span></span>
            <button className="tiny-x" onClick={() => removeCompany(c.id)}>Remove</button>
          </div>
        ))}
        {companies.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No external dispatch companies added yet.</div>}
      </div>
      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', maxWidth: '440px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Company name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Swift Riders Logistics" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Contact person's name</label>
        <input value={contactName} onChange={e => setContactName(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Their phone number</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+234..." style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Preferred channel</label>
        <select value={channel} onChange={e => setChannel(e.target.value)} style={{ width: '100%', marginBottom: '12px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
        </select>
        <button className="btn primary" onClick={addCompany} style={{ width: '100%' }}>Add company</button>
      </div>
    </div>
  );
}

// ---------- Submitter roles (manager / logistics / marketer): submit orders, see their own ----------
export function SubmitterView({ profile, products, orders, refresh }) {
  const [view, setView] = useState('submit');
  const allowed = profile.allowed_products && profile.allowed_products.length > 0
    ? products.filter(p => profile.allowed_products.includes(p.id))
    : products;
  const mine = orders.filter(o => o.created_by === profile.id);

  return (
    <div>
      <div className="product-tabs">
        <span className={'ptab' + (view === 'submit' ? ' active' : '')} onClick={() => setView('submit')}>Submit order</span>
        <span className={'ptab' + (view === 'mine' ? ' active' : '')} onClick={() => setView('mine')}>My submissions ({mine.length})</span>
      </div>
      {view === 'submit' && <SubmitOrderForm profile={profile} products={allowed} refresh={refresh} />}
      {view === 'mine' && (
        <table>
          <thead><tr><th>Order</th><th>Product</th><th>Customer</th><th>Status</th></tr></thead>
          <tbody>
            {mine.length === 0 && <tr><td colSpan="4" className="empty">You haven't submitted any orders yet.</td></tr>}
            {mine.map(o => {
              const prod = products.find(p => p.id === o.product_id);
              return (
                <tr key={o.id}>
                  <td className="oid">{o.id.slice(0, 8)}</td>
                  <td>{prod ? prod.name : '—'}</td>
                  <td>{o.customer}</td>
                  <td><span className={'pill ' + o.status}>{o.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SubmitOrderForm({ profile, products, refresh }) {
  const [productId, setProductId] = useState(products[0] ? products[0].id : '');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');

  async function submit() {
    if (!customer.trim() || !productId) { setMsg('Fill in a customer name and product.'); return; }
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_quantity <= 0) { setMsg('That product is out of stock — ask admin to restock before submitting.'); return; }
    const { data, error } = await supabase.from('orders').insert({
      product_id: productId, customer: customer.trim(), phone: phone.trim(), address: address.trim(),
      quantity: parseInt(quantity, 10) || 1, notes: notes.trim(), created_by: profile.id,
    }).select().single();
    if (error) { setMsg(error.message); return; }
    await logEvent({ order_id: data.id, actor_id: profile.id, actor_name: profile.full_name, event_type: 'created', note: `Submitted by ${profile.full_name} (${profile.role})` });
    setCustomer(''); setPhone(''); setAddress(''); setQuantity(1); setNotes('');
    setMsg('Order submitted — admin will review and assign it.');
    refresh();
  }

  if (products.length === 0) return <div className="empty">No products have been made available to you yet — ask your admin.</div>;

  return (
    <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '20px', maxWidth: '480px' }}>
      <label className="field-label" style={{ marginTop: 0 }}>Product</label>
      <select value={productId} onChange={e => setProductId(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
        {products.map(p => <option key={p.id} value={p.id} disabled={!p.stock_quantity || p.stock_quantity <= 0}>{p.name}{(!p.stock_quantity || p.stock_quantity <= 0) ? ' — OUT OF STOCK' : ''}</option>)}
      </select>
      <label className="field-label">Customer name</label>
      <input value={customer} onChange={e => setCustomer(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
      <label className="field-label">Phone</label>
      <input value={phone} onChange={e => setPhone(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
      <label className="field-label">Quantity</label>
      <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
      <label className="field-label">Delivery address</label>
      <textarea value={address} onChange={e => setAddress(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
      <label className="field-label">Notes</label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', marginBottom: '12px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
      <button className="btn primary" onClick={submit} style={{ width: '100%' }}>Submit order</button>
      {msg && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '10px' }}>{msg}</p>}
    </div>
  );
}

// ---------- Product packages (multiple named gift bundles per product) ----------
export function CommissionRuleModal({ product, profiles, onClose }) {
  const [standardActive, setStandardActive] = useState(true);
  const [standardType, setStandardType] = useState('fixed');
  const [standardValue, setStandardValue] = useState(0);
  const [upsellActive, setUpsellActive] = useState(true);
  const [upsellType, setUpsellType] = useState('fixed');
  const [upsellValue, setUpsellValue] = useState(0);
  const [eligibleStaff, setEligibleStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const staffList = (profiles || []).filter(p => p.role === 'staff');

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('commission_rules').select('*').eq('product_id', product.id).maybeSingle();
    if (data) {
      setStandardActive(data.standard_active); setStandardType(data.standard_type); setStandardValue(data.standard_value);
      setUpsellActive(data.upsell_active); setUpsellType(data.upsell_type); setUpsellValue(data.upsell_value);
      setEligibleStaff(data.eligible_staff || []);
    }
    setLoading(false);
  }

  function toggleStaff(id) {
    setEligibleStaff(eligibleStaff.includes(id) ? eligibleStaff.filter(x => x !== id) : [...eligibleStaff, id]);
  }

  async function save() {
    const payload = {
      product_id: product.id,
      standard_active: standardActive, standard_type: standardType, standard_value: parseFloat(standardValue) || 0,
      upsell_active: upsellActive, upsell_type: upsellType, upsell_value: parseFloat(upsellValue) || 0,
      eligible_staff: eligibleStaff.length > 0 ? eligibleStaff : null,
    };
    await supabase.from('commission_rules').upsert(payload, { onConflict: 'product_id' });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Commission · {product.name}</h3>
        {loading ? <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p> : (
          <>
            <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginTop: '0', marginBottom: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, fontWeight: 600 }}>
                Standard commission
                <span>
                  <input type="checkbox" checked={standardActive} onChange={e => setStandardActive(e.target.checked)} /> On
                </span>
              </label>
              <p style={{ fontSize: '11px', color: '#8A93A0', margin: '4px 0 10px' }}>Earned on every Paid order for this product.</p>
              <div className="row2">
                <select value={standardType} onChange={e => setStandardType(e.target.value)} disabled={!standardActive}>
                  <option value="fixed">Fixed ₦ amount</option>
                  <option value="percentage">% of order value</option>
                </select>
                <input type="number" min="0" value={standardValue} onChange={e => setStandardValue(e.target.value)} disabled={!standardActive} placeholder={standardType === 'fixed' ? 'e.g. 200' : 'e.g. 5'} />
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginBottom: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, fontWeight: 600 }}>
                Upsell commission
                <span>
                  <input type="checkbox" checked={upsellActive} onChange={e => setUpsellActive(e.target.checked)} /> On
                </span>
              </label>
              <p style={{ fontSize: '11px', color: '#8A93A0', margin: '4px 0 10px' }}>Extra bonus, only when the Paid order used a package (upsell). Stacks on top of standard.</p>
              <div className="row2">
                <select value={upsellType} onChange={e => setUpsellType(e.target.value)} disabled={!upsellActive}>
                  <option value="fixed">Fixed ₦ amount</option>
                  <option value="percentage">% of order value</option>
                </select>
                <input type="number" min="0" value={upsellValue} onChange={e => setUpsellValue(e.target.value)} disabled={!upsellActive} placeholder={upsellType === 'fixed' ? 'e.g. 100' : 'e.g. 3'} />
              </div>
            </div>

            <label style={{ marginTop: 0 }}>Which staff can earn this? (for this product)</label>
            <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '150px', overflowY: 'auto' }}>
              {staffList.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>No staff added yet.</p>}
              {staffList.map(s => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 2px' }}>
                  <input type="checkbox" checked={eligibleStaff.includes(s.id)} onChange={() => toggleStaff(s.id)} />
                  {s.full_name}
                </label>
              ))}
            </div>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '6px' }}>Leave all unchecked to make every staff member eligible.</p>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function ProductPackagesModal({ product, products, onClose }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [giftProductId, setGiftProductId] = useState('');
  const [giftQuantity, setGiftQuantity] = useState(1);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('product_packages').select('*').eq('product_id', product.id).order('created_at');
    setPackages(data || []);
    setLoading(false);
  }

  async function addPackage() {
    if (!name.trim()) return;
    await supabase.from('product_packages').insert({
      product_id: product.id, name: name.trim(),
      price: price === '' ? null : parseFloat(price),
      external_ref: externalRef.trim() || null,
      gift_product_id: giftProductId || null,
      gift_quantity: giftProductId ? (parseInt(giftQuantity, 10) || 0) : 0,
    });
    setName(''); setPrice(''); setExternalRef(''); setGiftProductId(''); setGiftQuantity(1);
    load();
  }
  async function removePackage(id) {
    await supabase.from('product_packages').delete().eq('id', id);
    load();
  }

  const giftOptions = products.filter(p => p.id !== product.id);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Packages · {product.name}</h3>
        <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-8px', marginBottom: '14px' }}>
          Create a package for each way this product is sent out — with a price, and with or without a free
          gift. You'll pick one of these when creating an order for this product.
        </p>
        {loading ? <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p> : (
          <div className="list-manage" style={{ marginBottom: '16px' }}>
            {packages.map(p => (
              <div key={p.id} className="list-manage-row">
                <span>{p.name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>
                  {p.price != null ? `· ₦${Number(p.price).toLocaleString()}` : ''}
                  {p.gift_product_id ? ` · gift: ${(products.find(g => g.id === p.gift_product_id) || {}).name || '—'} × ${p.gift_quantity}` : ' · no gift'}
                  {p.external_ref ? ` · ref: ${p.external_ref}` : ''}
                </span></span>
                <button className="tiny-x" onClick={() => removePackage(p.id)}>Remove</button>
              </div>
            ))}
            {packages.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No packages yet — orders for this product will just use plain quantity.</div>}
          </div>
        )}
        <label style={{ marginTop: 0 }}>Package name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard, With free sample" />
        <label>Price (₦)</label>
        <input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 15000" />
        <label>WordPress / WooCommerce reference (optional)</label>
        <input value={externalRef} onChange={e => setExternalRef(e.target.value)} placeholder="e.g. product ID, SKU, or variation ID" />
        <label>Free gift included (optional)</label>
        <select value={giftProductId} onChange={e => setGiftProductId(e.target.value)}>
          <option value="">No gift</option>
          {giftOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {giftProductId && (
          <>
            <label>Gift quantity</label>
            <input type="number" min="1" value={giftQuantity} onChange={e => setGiftQuantity(e.target.value)} />
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={addPackage}>Add package</button>
        </div>
      </div>
    </div>
  );
}


export function InventoryPage({ products, orders, profiles, agentStock, refresh }) {
  const [exactEdits, setExactEdits] = useState({});
  const [addAmounts, setAddAmounts] = useState({});

  async function addStock(p) {
    const amt = parseInt(addAmounts[p.id], 10);
    if (!amt || amt <= 0) return;
    await supabase.rpc('adjust_stock', { p_product_id: p.id, p_delta: amt });
    setAddAmounts({ ...addAmounts, [p.id]: '' });
    refresh();
  }
  async function subtractStock(p) {
    const amt = parseInt(addAmounts[p.id], 10);
    if (!amt || amt <= 0) return;
    await supabase.rpc('adjust_stock', { p_product_id: p.id, p_delta: -amt });
    setAddAmounts({ ...addAmounts, [p.id]: '' });
    refresh();
  }
  async function setExact(p) {
    const val = parseInt(exactEdits[p.id], 10);
    if (isNaN(val)) return;
    const delta = Math.max(0, val) - p.stock_quantity;
    if (delta !== 0) await supabase.rpc('adjust_stock', { p_product_id: p.id, p_delta: delta });
    setExactEdits({ ...exactEdits, [p.id]: '' });
    refresh();
  }
  async function setThreshold(p, val) {
    const t = parseInt(val, 10);
    if (isNaN(t)) return;
    await supabase.from('products').update({ low_stock_threshold: Math.max(0, t) }).eq('id', p.id);
    refresh();
  }

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Inventory</h1><p className="page-sub">Stock automatically drops as orders come in. Any addition below adds to what's already there — use "Set exact" only when you want to replace the number entirely.</p></div>
      </div>
      <table>
        <thead><tr><th>Product</th><th>In stock</th><th>Low stock alert below</th><th>Add / subtract quantity</th><th>Set exact</th></tr></thead>
        <tbody>
          {products.map(p => {
            const low = p.stock_quantity <= p.low_stock_threshold;
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <span className={low ? 'pill Cancelled' : 'pill Delivered'}>{p.stock_quantity} units</span>
                </td>
                <td>
                  <input
                    type="number"
                    defaultValue={p.low_stock_threshold}
                    onBlur={e => setThreshold(p, e.target.value)}
                    style={{ width: '70px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <input
                    type="number" min="1" placeholder="qty"
                    value={addAmounts[p.id] || ''}
                    onChange={e => setAddAmounts({ ...addAmounts, [p.id]: e.target.value })}
                    style={{ width: '80px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                  />{' '}
                  <button className="link-btn" onClick={() => addStock(p)}>Add</button>{' · '}
                  <button className="link-btn" onClick={() => subtractStock(p)}>Subtract</button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <input
                    placeholder="exact total"
                    value={exactEdits[p.id] || ''}
                    onChange={e => setExactEdits({ ...exactEdits, [p.id]: e.target.value })}
                    style={{ width: '90px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                  />{' '}
                  <button className="link-btn" onClick={() => setExact(p)}>Set</button>
                </td>
              </tr>
            );
          })}
          {products.length === 0 && <tr><td colSpan="5" className="empty">Add products first.</td></tr>}
        </tbody>
      </table>

      {profiles && agentStock && (() => {
        const dispatchList = profiles.filter(p => p.role === 'dispatch');
        if (dispatchList.length === 0) return null;
        const byState = {};
        dispatchList.forEach(d => {
          const key = d.state || 'No state set';
          if (!byState[key]) byState[key] = [];
          byState[key].push(d);
        });
        return (
          <>
            <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '28px 0 6px' }}>Agent stock, by state</h3>
            <p style={{ fontSize: '12px', color: '#8A93A0', marginBottom: '14px' }}>What every dispatch partner is currently holding, grouped by state — useful when a state has more than one agent.</p>
            {Object.entries(byState).map(([state, agents]) => (
              <div key={state} style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>{state}{agents.length > 1 ? ` (${agents.length} agents)` : ''}</div>
                <table>
                  <thead><tr><th>Agent</th>{products.map(p => <th key={p.id}>{p.name}</th>)}</tr></thead>
                  <tbody>
                    {agents.map(a => (
                      <tr key={a.id}>
                        <td>{a.full_name}</td>
                        {products.map(p => {
                          const row = agentStock.find(s => s.agent_id === a.id && s.product_id === p.id);
                          return <td key={p.id}>{row ? row.quantity : 0}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        );
      })()}
    </div>
  );
}

// ---------- Order history / remarks ----------
export function OrderHistoryModal({ order, products, profile, onClose, onLogged }) {
  const [events, setEvents] = useState([]);
  const [upsells, setUpsells] = useState([]);
  const [loading, setLoading] = useState(true);
  const [remark, setRemark] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data }, { data: up }] = await Promise.all([
        supabase.from('order_events').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('upsells').select('*').eq('original_order_id', order.id).order('created_at', { ascending: false }),
      ]);
      setEvents(data || []);
      setUpsells(up || []);
      setLoading(false);
    })();
  }, [order.id]);

  async function addRemark() {
    if (!remark.trim()) return;
    await logEvent({ order_id: order.id, actor_id: profile.id, actor_name: profile.full_name, event_type: 'remark', note: remark.trim() });
    setRemark('');
    const { data } = await supabase.from('order_events').select('*').eq('order_id', order.id).order('created_at', { ascending: false });
    setEvents(data || []);
    if (onLogged) onLogged();
  }
  const prodName = id => id ? ((products || []).find(p => p.id === id) || {}).name || '—' : '—';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Order history · {order.customer}</h3>
        {upsells.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#8A93A0', marginBottom: '6px' }}>UPSELLS ON THIS ORDER</div>
            {upsells.map(u => (
              <div key={u.id} style={{ fontSize: '12.5px', background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' }}>
                +{u.additional_quantity} {prodName(u.upsell_product_id)} · ₦{Number(u.upsell_amount).toLocaleString()} · <span style={{ color: '#8A93A0' }}>{u.commission_status}</span>
                <div style={{ fontSize: '10.5px', color: '#8A93A0' }}>{new Date(u.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
        <label style={{ marginTop: 0 }}>Add a remark</label>
        <textarea value={remark} onChange={e => setRemark(e.target.value)} placeholder="e.g. Customer asked to deliver after 5pm" />
        <div style={{ textAlign: 'right', marginTop: '8px' }}>
          <button className="btn primary" onClick={addRemark}>Add remark</button>
        </div>
        <div style={{ marginTop: '18px', maxHeight: '260px', overflowY: 'auto' }}>
          {loading && <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p>}
          {!loading && events.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>No activity logged yet.</p>}
          {events.map(e => (
            <div key={e.id} style={{ borderBottom: '1px solid #DEDAD0', padding: '10px 0', fontSize: '12.5px' }}>
              <div style={{ color: '#8A93A0', fontSize: '11px' }}>{new Date(e.created_at).toLocaleString()} · {e.actor_name || 'System'}</div>
              {e.event_type === 'status_change' && <div>Status changed: <strong>{e.from_status || '—'}</strong> → <strong>{e.to_status}</strong></div>}
              {e.event_type === 'remark' && <div>{e.note}</div>}
              {e.event_type === 'created' && <div>Order created.</div>}
              {e.event_type === 'assigned' && <div>{e.note}</div>}
            </div>
          ))}
        </div>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ---------- Customer history ----------
export function CustomerHistoryModal({ phone, customer, orders, products, onClose }) {
  const history = orders.filter(o => o.phone && phone && o.phone.trim() === phone.trim());
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{customer} · order history</h3>
        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {history.map(o => (
            <div key={o.id} style={{ borderBottom: '1px solid #DEDAD0', padding: '10px 0', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{prodName(o.product_id)} × {o.quantity || 1}</span>
                <span className={'pill ' + o.status}>{o.status}</span>
              </div>
              <div style={{ color: '#8A93A0', fontSize: '11.5px' }}>{new Date(o.created_at).toLocaleDateString()} · {o.payment_status}</div>
            </div>
          ))}
          {history.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>No other orders from this number yet.</p>}
        </div>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ---------- Notifications ----------
export function NotificationsBell({ profile, isAdmin }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [lowStock, setLowStock] = useState([]);

  useEffect(() => {
    (async () => {
      let query = supabase.from('order_events').select('*').order('created_at', { ascending: false }).limit(15);
      const { data } = await query;
      setEvents(data || []);
      if (isAdmin) {
        const { data: products } = await supabase.from('products').select('*');
        setLowStock((products || []).filter(p => p.stock_quantity <= p.low_stock_threshold));
      }
    })();
  }, [isAdmin]);

  const alertCount = lowStock.length;

  return (
    <div style={{ position: 'relative' }}>
      <button className="switch-out" onClick={() => setOpen(!open)} style={{ marginBottom: '8px' }}>
        🔔 Recent activity{alertCount > 0 ? ` (${alertCount} low stock)` : ''}
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: '30px', left: 0, background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', width: '280px', maxHeight: '360px', overflowY: 'auto', padding: '10px', zIndex: 60, boxShadow: '0 10px 30px rgba(0,0,0,.15)' }}>
          {isAdmin && lowStock.length > 0 && (
            <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #DEDAD0' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#B0483F', marginBottom: '4px' }}>⚠ Low stock</div>
              {lowStock.map(p => (
                <div key={p.id} style={{ fontSize: '12px', padding: '4px 2px' }}>{p.name} — only {p.stock_quantity} left</div>
              ))}
            </div>
          )}
          {events.length === 0 && lowStock.length === 0 && <div style={{ fontSize: '12px', color: '#8A93A0', padding: '8px' }}>No recent activity.</div>}
          {events.map(e => (
            <div key={e.id} style={{ fontSize: '12px', padding: '8px 4px', borderBottom: '1px solid #F0EEE8', color: '#1B2430' }}>
              <div style={{ color: '#8A93A0', fontSize: '10.5px' }}>{new Date(e.created_at).toLocaleString()}</div>
              {e.event_type === 'status_change' && <div>{e.actor_name || 'Someone'} moved an order to <strong>{e.to_status}</strong></div>}
              {e.event_type === 'remark' && <div>{e.actor_name || 'Someone'} added a remark</div>}
              {e.event_type === 'created' && <div>New order created</div>}
              {e.event_type === 'assigned' && <div>{e.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { STATUSES };

// ---------- Commission: staff-facing gamified board ----------
export function CommissionPage({ profile, orders, products, session }) {
  const [ledger, setLedger] = useState([]);
  const [claims, setClaims] = useState([]);
  const [threshold, setThreshold] = useState(0);
  const [claimDay, setClaimDay] = useState(1);
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState('');

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: led }, { data: cl }, { data: rateSetting }, { data: daySetting }, { data: windowSetting }] = await Promise.all([
      supabase.from('commission_ledger').select('*').eq('staff_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('commission_claims').select('*').eq('staff_id', profile.id).order('claimed_at', { ascending: false }),
      supabase.from('app_settings').select('*').eq('key', 'min_success_rate_to_claim').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'success_rate_window_days').maybeSingle(),
    ]);
    setLedger(led || []);
    setClaims(cl || []);
    setThreshold(rateSetting ? parseFloat(rateSetting.value) || 0 : 0);
    setClaimDay(daySetting ? parseInt(daySetting.value, 10) : 1);
    setWindowDays(windowSetting ? parseInt(windowSetting.value, 10) || 30 : 30);
    setLoading(false);
  }

  const myOrders = orders.filter(o => o.staff_id === profile.id);
  const rateInfo = computeSuccessRate(orders, profile.id, windowDays, profile.success_rate_window_enabled);
  const successRate = rateInfo.rate;
  const myDelivered = { length: rateInfo.delivered };
  const myDeliveredPaid = { length: rateInfo.deliveredPaid };
  const eligible = successRate >= threshold;
  const isClaimDay = new Date().getDay() === claimDay;

  const earned = ledger.filter(l => !l.reversed).reduce((sum, l) => sum + Number(l.amount), 0);
  const claimed = claims.reduce((sum, c) => sum + Number(c.amount), 0);
  const balance = earned - claimed;

  const cycleStart = getCycleStart(new Date());
  const thisWeek = ledger.filter(l => !l.reversed && l.cycle_start === cycleStart);
  const thisWeekTotal = thisWeek.reduce((sum, l) => sum + Number(l.amount), 0);

  const freeTotal = ledger.filter(l => !l.reversed && l.commission_type === 'free').reduce((sum, l) => sum + Number(l.amount), 0);

  const byProduct = {};
  ledger.filter(l => !l.reversed && l.commission_type !== 'free').forEach(l => {
    if (!byProduct[l.product_id]) byProduct[l.product_id] = { standard: 0, upsell: 0, count: 0 };
    byProduct[l.product_id][l.commission_type] += Number(l.amount);
    byProduct[l.product_id].count += 1;
  });

  async function claim() {
    if (!isClaimDay || !eligible || balance <= 0) return;
    setClaiming(true);
    await supabase.from('commission_claims').insert({ staff_id: profile.id, amount: balance });
    setClaiming(false);
    setMsg(`🎉 Claimed ₦${balance.toLocaleString()}! Nice work this cycle.`);
    load();
  }

  if (loading) return <div className="loading">Loading your commission…</div>;

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">My Commission</h1><p className="page-sub">Earned automatically every time one of your orders gets paid.</p></div>
      </div>

      <div style={{ background: 'linear-gradient(135deg, #1F4D44, #2E6E62)', borderRadius: '12px', padding: '28px', color: '#fff', marginBottom: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '12.5px', opacity: 0.85, marginBottom: '6px', letterSpacing: '.5px' }}>YOUR UNCLAIMED BALANCE</div>
        <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '42px', fontWeight: 700 }}>₦{balance.toLocaleString()}</div>
        <div style={{ fontSize: '12.5px', opacity: 0.85, marginTop: '6px' }}>₦{thisWeekTotal.toLocaleString()} earned this week so far</div>
        {freeTotal > 0 && <div style={{ fontSize: '11.5px', opacity: 0.75, marginTop: '2px' }}>Includes ₦{freeTotal.toLocaleString()} in per-order bonus commission</div>}
        <div style={{ marginTop: '18px' }}>
          {balance <= 0 ? (
            <span style={{ fontSize: '12.5px', opacity: 0.75 }}>Deliver more Paid orders to start earning towards your next claim.</span>
          ) : !eligible ? (
            <span style={{ fontSize: '12.5px', background: 'rgba(255,255,255,.15)', padding: '8px 16px', borderRadius: '20px' }}>Keep your delivery success rate up to unlock claiming</span>
          ) : !isClaimDay ? (
            <span style={{ fontSize: '12.5px', background: 'rgba(255,255,255,.15)', padding: '8px 16px', borderRadius: '20px' }}>✓ Eligible — claim opens {DAY_NAMES[claimDay]}</span>
          ) : (
            <button className="btn primary" onClick={claim} disabled={claiming} style={{ background: '#fff', color: '#1F4D44', fontWeight: 700, padding: '11px 28px', fontSize: '14px' }}>
              {claiming ? 'Claiming…' : '🎉 Claim your commission now'}
            </button>
          )}
        </div>
        {msg && <p style={{ fontSize: '12.5px', marginTop: '12px' }}>{msg}</p>}
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Your delivery success rate</h3>
      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
          <span>{successRate.toFixed(0)}% of your delivered orders got paid</span>
          <span style={{ color: '#8A93A0' }}>Needs {threshold}% to claim</span>
        </div>
        <div style={{ background: '#F0EEE8', borderRadius: '6px', height: '10px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, successRate)}%`, height: '100%', background: eligible ? '#2E6E62' : '#C6862F', transition: 'width .3s ease' }} />
        </div>
        <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '8px' }}>
          {myDeliveredPaid.length} paid out of {myDelivered.length} delivered orders you're on
          {profile.success_rate_window_enabled ? ` (last ${windowDays} days)` : ' (all-time)'}.
        </p>
      </div>

      {Object.keys(byProduct).length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>How you earned it, by product</h3>
          <table style={{ marginBottom: '20px' }}>
            <thead><tr><th>Product</th><th>Orders</th><th>Standard</th><th>Upsell bonus</th><th>Total</th></tr></thead>
            <tbody>
              {Object.entries(byProduct).map(([pid, d]) => {
                const prod = products.find(p => p.id === pid);
                return (
                  <tr key={pid}>
                    <td>{prod ? prod.name : '—'}</td>
                    <td>{d.count}</td>
                    <td>₦{d.standard.toLocaleString()}</td>
                    <td>₦{d.upsell.toLocaleString()}</td>
                    <td>₦{(d.standard + d.upsell).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Claim history</h3>
      <div className="list-manage">
        {claims.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No claims yet — your first one is waiting for you above.</div>}
        {claims.map(c => (
          <div key={c.id} className="list-manage-row"><span>{new Date(c.claimed_at).toLocaleDateString()}</span><span style={{ color: '#2E6E62', fontWeight: 600 }}>₦{Number(c.amount).toLocaleString()}</span></div>
        ))}
      </div>
    </div>
  );
}

// ---------- Commission: admin overview ----------
export function AdminCommissionPage({ profiles, orders, products, session }) {
  const [threshold, setThreshold] = useState(0);
  const [claimDay, setClaimDay] = useState(1);
  const [windowDays, setWindowDays] = useState(30);
  const [ledgerAll, setLedgerAll] = useState([]);
  const [claimsAll, setClaimsAll] = useState([]);
  const [saving, setSaving] = useState(false);
  const [freeActive, setFreeActive] = useState(false);
  const [freeAmount, setFreeAmount] = useState(0);
  const [freeEligible, setFreeEligible] = useState([]);
  const [savingFree, setSavingFree] = useState(false);
  const [productRules, setProductRules] = useState({});
  const [managingProduct, setManagingProduct] = useState(null);

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const staffList = profiles.filter(p => p.role === 'staff');

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: rateSetting }, { data: daySetting }, { data: windowSetting }, { data: freeRule }, { data: rules }] = await Promise.all([
      supabase.from('app_settings').select('*').eq('key', 'min_success_rate_to_claim').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'success_rate_window_days').maybeSingle(),
      supabase.from('free_commission_rules').select('*').limit(1).maybeSingle(),
      supabase.from('commission_rules').select('*'),
    ]);
    setThreshold(rateSetting ? parseFloat(rateSetting.value) || 0 : 0);
    setClaimDay(daySetting ? parseInt(daySetting.value, 10) : 1);
    setWindowDays(windowSetting ? parseInt(windowSetting.value, 10) || 30 : 30);
    const ruleMap = {};
    (rules || []).forEach(r => { ruleMap[r.product_id] = r; });
    setProductRules(ruleMap);
    if (freeRule) {
      setFreeActive(freeRule.active); setFreeAmount(freeRule.amount); setFreeEligible(freeRule.eligible_staff || []);
    }
    const [{ data: led }, { data: cl }] = await Promise.all([
      supabase.from('commission_ledger').select('*'),
      supabase.from('commission_claims').select('*'),
    ]);
    setLedgerAll(led || []);
    setClaimsAll(cl || []);
  }

  async function toggleStaffWindow(staffId, current) {
    await supabase.from('profiles').update({ success_rate_window_enabled: !current }).eq('id', staffId);
    // Refresh just the affected profile locally by reloading the page's profiles isn't available here —
    // parent refresh will pick it up on next natural reload; for immediate feedback, mutate in place.
    const idx = profiles.findIndex(p => p.id === staffId);
    if (idx >= 0) profiles[idx].success_rate_window_enabled = !current;
    load();
  }

  async function saveSettings() {
    setSaving(true);
    await Promise.all([
      supabase.from('app_settings').upsert({ key: 'min_success_rate_to_claim', value: String(threshold) }),
      supabase.from('app_settings').upsert({ key: 'claim_day', value: String(claimDay) }),
      supabase.from('app_settings').upsert({ key: 'success_rate_window_days', value: String(windowDays) }),
    ]);
    setSaving(false);
  }

  function toggleFreeStaff(id) {
    setFreeEligible(freeEligible.includes(id) ? freeEligible.filter(x => x !== id) : [...freeEligible, id]);
  }

  async function saveFreeRule() {
    setSavingFree(true);
    const { data: existing } = await supabase.from('free_commission_rules').select('id').limit(1).maybeSingle();
    const payload = { active: freeActive, amount: parseFloat(freeAmount) || 0, eligible_staff: freeEligible.length > 0 ? freeEligible : null };
    if (existing) {
      await supabase.from('free_commission_rules').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('free_commission_rules').insert(payload);
    }
    setSavingFree(false);
    load();
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Commission</h1><p className="page-sub">Set the claim eligibility rules and see where every staff member stands.</p></div></div>

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '22px', maxWidth: '440px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Day of the week claims open</label>
        <select value={claimDay} onChange={e => setClaimDay(parseInt(e.target.value, 10))} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }}>
          {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
        </select>
        <label className="field-label">Minimum delivery success rate to claim (%)</label>
        <input type="number" min="0" max="100" value={threshold} onChange={e => setThreshold(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }} />
        <label className="field-label">Rolling success-rate window (days)</label>
        <input type="number" min="1" value={windowDays} onChange={e => setWindowDays(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }} />
        <button className="btn primary" onClick={saveSettings} disabled={saving} style={{ width: '100%' }}>{saving ? 'Saving…' : 'Save all settings'}</button>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '8px' }}>Success rate = their Delivered-and-Paid orders ÷ all their Delivered orders. Set the rate to 0 to let everyone claim freely regardless of performance. The rolling window only applies to staff you've switched to "rolling" in the table below — everyone else uses all-time by default.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '22px', maxWidth: '440px' }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, fontWeight: 600 }}>
          Commission earned per delivered order
          <span><input type="checkbox" checked={freeActive} onChange={e => setFreeActive(e.target.checked)} /> On</span>
        </label>
        <p style={{ fontSize: '11px', color: '#8A93A0', margin: '4px 0 10px' }}>A flat bonus credited automatically every time one of an eligible staff member's orders is marked Delivered and Paid — separate from any product-specific commission.</p>
        <label className="field-label">Amount per delivered &amp; paid order (₦)</label>
        <input type="number" min="0" value={freeAmount} onChange={e => setFreeAmount(e.target.value)} disabled={!freeActive} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '12px' }} />
        <label className="field-label">Who's eligible?</label>
        <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '140px', overflowY: 'auto', marginBottom: '10px' }}>
          {staffList.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>No staff added yet.</p>}
          {staffList.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 2px' }}>
              <input type="checkbox" checked={freeEligible.includes(s.id)} onChange={() => toggleFreeStaff(s.id)} disabled={!freeActive} />
              {s.full_name}
            </label>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-4px', marginBottom: '10px' }}>Leave all unchecked to make everyone eligible.</p>
        <button className="btn primary" onClick={saveFreeRule} disabled={savingFree} style={{ width: '100%' }}>{savingFree ? 'Saving…' : 'Save free commission rule'}</button>
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Commission by product</h3>
      <p style={{ fontSize: '12px', color: '#8A93A0', marginBottom: '10px' }}>
        Every product you've listed shows up here automatically, including any you add later. Nothing earns
        commission until you configure it — there's no automatic default.
      </p>
      <table style={{ marginBottom: '24px' }}>
        <thead><tr><th>Product</th><th>Standard</th><th>Upsell</th><th>Eligible staff</th><th></th></tr></thead>
        <tbody>
          {(!products || products.length === 0) && <tr><td colSpan="5" className="empty">No products added yet.</td></tr>}
          {(products || []).map(p => {
            const rule = productRules[p.id];
            const fmt = (type, value) => type === 'percentage' ? `${value}%` : `₦${Number(value).toLocaleString()}`;
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{!rule ? <span style={{ color: '#8A93A0' }}>Not set</span> : rule.standard_active ? fmt(rule.standard_type, rule.standard_value) : <span style={{ color: '#8A93A0' }}>Off</span>}</td>
                <td>{!rule ? <span style={{ color: '#8A93A0' }}>Not set</span> : rule.upsell_active ? fmt(rule.upsell_type, rule.upsell_value) : <span style={{ color: '#8A93A0' }}>Off</span>}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{!rule || !rule.eligible_staff || rule.eligible_staff.length === 0 ? 'All staff' : `${rule.eligible_staff.length} selected`}</td>
                <td style={{ textAlign: 'right' }}><button className="link-btn" onClick={() => setManagingProduct(p)}>Configure</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {managingProduct && <CommissionRuleModal product={managingProduct} profiles={profiles} onClose={() => { setManagingProduct(null); load(); }} />}

      <div className="desktop-only">
      <table>
        <thead><tr><th>Staff</th><th>Joined</th><th>Unclaimed balance</th><th>Success rate</th><th>Rate window</th><th>Eligible?</th><th>Last claim</th></tr></thead>
        <tbody>
          {staffList.length === 0 && <tr><td colSpan="7" className="empty">No staff added yet.</td></tr>}
          {staffList.map(s => {
            const myLedger = ledgerAll.filter(l => l.staff_id === s.id && !l.reversed);
            const myClaims = claimsAll.filter(c => c.staff_id === s.id);
            const earned = myLedger.reduce((sum, l) => sum + Number(l.amount), 0);
            const claimed = myClaims.reduce((sum, c) => sum + Number(c.amount), 0);
            const balance = earned - claimed;
            const rateInfo = computeSuccessRate(orders, s.id, windowDays, s.success_rate_window_enabled);
            const rate = rateInfo.rate;
            const lastClaim = myClaims.sort((a, b) => new Date(b.claimed_at) - new Date(a.claimed_at))[0];
            return (
              <tr key={s.id}>
                <td>{s.full_name}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                <td>₦{balance.toLocaleString()}</td>
                <td>{rate.toFixed(0)}%</td>
                <td>
                  <button className="link-btn" style={{ fontSize: '11.5px' }} onClick={() => toggleStaffWindow(s.id, s.success_rate_window_enabled)}>
                    {s.success_rate_window_enabled ? `Rolling (${windowDays}d)` : 'All-time'}
                  </button>
                </td>
                <td><span className={'pill ' + (rate >= threshold ? 'Delivered' : 'Cancelled')}>{rate >= threshold ? 'Eligible' : 'Not yet'}</span></td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{lastClaim ? new Date(lastClaim.claimed_at).toLocaleDateString() : 'Never'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <div className="mobile-only">
        {staffList.length === 0 && <div className="empty">No staff added yet.</div>}
        {staffList.map(s => {
          const myLedger = ledgerAll.filter(l => l.staff_id === s.id && !l.reversed);
          const myClaims = claimsAll.filter(c => c.staff_id === s.id);
          const earned = myLedger.reduce((sum, l) => sum + Number(l.amount), 0);
          const claimed = myClaims.reduce((sum, c) => sum + Number(c.amount), 0);
          const balance = earned - claimed;
          const rateInfo = computeSuccessRate(orders, s.id, windowDays, s.success_rate_window_enabled);
          const rate = rateInfo.rate;
          const lastClaim = myClaims.sort((a, b) => new Date(b.claimed_at) - new Date(a.claimed_at))[0];
          return (
            <div key={s.id} className="mobile-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 600 }}>{s.full_name}</span>
                <span className={'pill ' + (rate >= threshold ? 'Delivered' : 'Cancelled')}>{rate >= threshold ? 'Eligible' : 'Not yet'}</span>
              </div>
              <div className="mobile-card-row"><span className="mobile-card-label">Joined</span><span className="mobile-card-value">{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</span></div>
              <div className="mobile-card-row"><span className="mobile-card-label">Unclaimed balance</span><span className="mobile-card-value" style={{ fontWeight: 600 }}>₦{balance.toLocaleString()}</span></div>
              <div className="mobile-card-row"><span className="mobile-card-label">Success rate</span><span className="mobile-card-value">{rate.toFixed(0)}%</span></div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">Rate window</span>
                <span className="mobile-card-value">
                  <button className="link-btn" style={{ fontSize: '11.5px' }} onClick={() => toggleStaffWindow(s.id, s.success_rate_window_enabled)}>
                    {s.success_rate_window_enabled ? `Rolling (${windowDays}d)` : 'All-time'}
                  </button>
                </span>
              </div>
              <div className="mobile-card-row"><span className="mobile-card-label">Last claim</span><span className="mobile-card-value">{lastClaim ? new Date(lastClaim.claimed_at).toLocaleDateString() : 'Never'}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Phase 1 fraud-proof upsell system ----------

export function AddUpsellModal({ order, products, packages, profile, onClose, onCreated }) {
  const [upsellProductId, setUpsellProductId] = useState('');
  const [upsellPackageId, setUpsellPackageId] = useState('');
  const [additionalQuantity, setAdditionalQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const originalProduct = products.find(p => p.id === order.product_id);
  const originalPackage = (packages || []).find(p => p.id === order.package_id);
  const upsellPackages = (packages || []).filter(p => p.product_id === upsellProductId);

  function onPackageChange(id) {
    setUpsellPackageId(id);
    const pkg = upsellPackages.find(p => p.id === id);
    if (pkg && pkg.price != null) setUnitPrice(pkg.price);
  }

  async function submit() {
    if (!upsellProductId || !additionalQuantity || unitPrice === '') { setError('Fill in the upsell product, quantity, and price.'); return; }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc('create_upsell', {
      p_original_order_id: order.id,
      p_upsell_product_id: upsellProductId,
      p_upsell_package_id: upsellPackageId || null,
      p_additional_quantity: parseInt(additionalQuantity, 10) || 1,
      p_unit_price: parseFloat(unitPrice) || 0,
    });
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Change package · {order.customer}</h3>
        <div style={{ background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px', fontWeight: 600 }}>ORIGINALLY ORDERED (locked, kept for history)</div>
          <div style={{ fontSize: '13.5px' }}>{originalProduct ? originalProduct.name : '—'}{originalPackage ? ` · ${originalPackage.name}` : ''}</div>
          <div style={{ fontSize: '12px', color: '#8A93A0' }}>Quantity: {order.quantity || 1} · ₦{Number(order.unit_price || 0).toLocaleString()} each</div>
        </div>
        <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '-6px', marginBottom: '14px' }}>
          Use this when the customer has decided to go with a different package instead — not on top of the original.
          Dispatch will only deliver what you enter below; the original package above will no longer be sent.
        </p>

        <label style={{ marginTop: 0 }}>New product</label>
        <select value={upsellProductId} onChange={e => { setUpsellProductId(e.target.value); setUpsellPackageId(''); setUnitPrice(''); }}>
          <option value="">— Select product —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {upsellPackages.length > 0 && (
          <>
            <label>New package (optional)</label>
            <select value={upsellPackageId} onChange={e => onPackageChange(e.target.value)}>
              <option value="">— No package —</option>
              {upsellPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
        <div className="row2">
          <div><label>Quantity to deliver</label><input type="number" min="1" value={additionalQuantity} onChange={e => setAdditionalQuantity(e.target.value)} /></div>
          <div><label>Unit price (₦)</label><input type="number" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></div>
        </div>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '10px' }}>
          Commission is calculated automatically from the admin's rules once this order is delivered and paid — you won't set an amount here.
        </p>
        {error && <p style={{ fontSize: '12px', color: '#B0483F', marginTop: '8px' }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add upsell'}</button>
        </div>
      </div>
    </div>
  );
}

export function RequestCorrectionModal({ order, profile, onClose, onSubmitted }) {
  const [field, setField] = useState('quantity');
  const [requestedValue, setRequestedValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const currentValues = { quantity: order.quantity, unit_price: order.unit_price, address: order.address, phone: order.phone };

  async function submit() {
    if (!requestedValue.trim() || !reason.trim()) return;
    setSaving(true);
    await supabase.from('order_corrections').insert({
      order_id: order.id, field, original_value: String(currentValues[field] ?? ''),
      requested_value: requestedValue.trim(), reason: reason.trim(), requested_by: profile?.id,
    });
    await supabase.from('audit_log').insert({ actor_id: profile?.id, actor_name: profile?.full_name, action: 'Correction Requested', order_id: order.id, previous_value: String(currentValues[field] ?? ''), new_value: requestedValue.trim(), reason: reason.trim() });
    setSaving(false);
    onSubmitted();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Request correction · {order.customer}</h3>
        <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-8px', marginBottom: '12px' }}>
          This order is confirmed and locked. An admin will review and approve or reject this request — nothing changes until then.
        </p>
        <label style={{ marginTop: 0 }}>What needs to change?</label>
        <select value={field} onChange={e => setField(e.target.value)}>
          <option value="quantity">Quantity (currently {order.quantity})</option>
          <option value="unit_price">Unit price (currently ₦{order.unit_price})</option>
          <option value="address">Delivery address</option>
          <option value="phone">Phone number</option>
        </select>
        <label>Requested new value</label>
        <input value={requestedValue} onChange={e => setRequestedValue(e.target.value)} />
        <label>Reason</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why does this need to change?" />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit request'}</button>
        </div>
      </div>
    </div>
  );
}

export function CorrectionsPage({ profile, session, refresh }) {
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('order_corrections').select('*').order('created_at', { ascending: false });
    setCorrections(data || []);
    setLoading(false);
  }

  async function review(correction, approve) {
    if (approve) {
      const patch = {};
      const val = ['quantity'].includes(correction.field) ? parseInt(correction.requested_value, 10)
        : ['unit_price'].includes(correction.field) ? parseFloat(correction.requested_value)
        : correction.requested_value;
      patch[correction.field] = val;
      await supabase.from('orders').update(patch).eq('id', correction.order_id);
    }
    await supabase.from('order_corrections').update({
      status: approve ? 'Approved' : 'Rejected', reviewed_by: profile?.id, reviewed_at: new Date().toISOString(),
    }).eq('id', correction.id);
    await supabase.from('audit_log').insert({
      actor_id: profile?.id, actor_name: profile?.full_name,
      action: approve ? 'Correction Approved' : 'Correction Rejected',
      order_id: correction.order_id, previous_value: correction.original_value, new_value: correction.requested_value,
    });
    load();
  }

  if (loading) return <div className="loading">Loading corrections…</div>;
  const pending = corrections.filter(c => c.status === 'Pending');
  const resolved = corrections.filter(c => c.status !== 'Pending');

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Order Corrections</h1><p className="page-sub">Requests to change a locked, confirmed order. Nothing changes until you approve it.</p></div></div>
      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Pending ({pending.length})</h3>
      <table style={{ marginBottom: '24px' }}>
        <thead><tr><th>Order</th><th>Field</th><th>From → To</th><th>Reason</th><th></th></tr></thead>
        <tbody>
          {pending.length === 0 && <tr><td colSpan="5" className="empty">Nothing waiting for review.</td></tr>}
          {pending.map(c => (
            <tr key={c.id}>
              <td className="oid">{c.order_id.slice(0, 8)}</td>
              <td>{c.field}</td>
              <td>{c.original_value} → {c.requested_value}</td>
              <td style={{ fontSize: '12px' }}>{c.reason}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="link-btn" onClick={() => review(c, true)}>Approve</button>{' · '}
                <button className="link-btn" style={{ color: '#B0483F' }} onClick={() => review(c, false)}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>History</h3>
      <table>
        <thead><tr><th>Order</th><th>Field</th><th>From → To</th><th>Status</th></tr></thead>
        <tbody>
          {resolved.length === 0 && <tr><td colSpan="4" className="empty">No resolved requests yet.</td></tr>}
          {resolved.map(c => (
            <tr key={c.id}>
              <td className="oid">{c.order_id.slice(0, 8)}</td>
              <td>{c.field}</td>
              <td>{c.original_value} → {c.requested_value}</td>
              <td><span className={'pill ' + (c.status === 'Approved' ? 'Delivered' : 'Cancelled')}>{c.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UpsellRulesPage({ products, packages, profiles }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('upsell_commission_rules').select('*').order('created_at', { ascending: false });
    setRules(data || []);
    setLoading(false);
  }
  const prodName = id => id ? (products.find(p => p.id === id) || {}).name || '—' : 'Any';
  const pkgName = id => id ? (packages.find(p => p.id === id) || {}).name || '—' : 'Any';
  const fmt = (type, value) => type === 'percentage' ? `${value}%` : type === 'per_unit' ? `₦${value}/unit` : `₦${Number(value).toLocaleString()}`;

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Upsell Commission Rules</h1><p className="page-sub">Fully dynamic — works with any product or package you list, now or in the future.</p></div>
        <button className="btn primary" onClick={() => setEditing({})}>+ New rule</button>
      </div>
      <CommissionRuleTester products={products} packages={packages} />
      {loading ? <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p> : (
        <table>
          <thead><tr><th>Original</th><th>Upsell</th><th>Commission</th><th>Active</th><th>Effective</th><th></th></tr></thead>
          <tbody>
            {rules.length === 0 && <tr><td colSpan="6" className="empty">No rules yet — click "+ New rule" to create one.</td></tr>}
            {rules.map(r => (
              <tr key={r.id}>
                <td>{prodName(r.original_product_id)} · {pkgName(r.original_package_id)}</td>
                <td>{prodName(r.upsell_product_id)} · {pkgName(r.upsell_package_id)}</td>
                <td>{fmt(r.commission_type, r.commission_value)}</td>
                <td><span className={'pill ' + (r.active ? 'Delivered' : 'Cancelled')}>{r.active ? 'On' : 'Off'}</span></td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{r.effective_start}{r.effective_end ? ` – ${r.effective_end}` : ''}</td>
                <td style={{ textAlign: 'right' }}><button className="link-btn" onClick={() => setEditing(r)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <UpsellRuleModal rule={editing} products={products} packages={packages} profiles={profiles} onClose={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function UpsellRuleModal({ rule, products, packages, profiles, onClose }) {
  const isNew = !rule.id;
  const [originalProductId, setOriginalProductId] = useState(rule.original_product_id || '');
  const [originalPackageId, setOriginalPackageId] = useState(rule.original_package_id || '');
  const [upsellProductId, setUpsellProductId] = useState(rule.upsell_product_id || '');
  const [upsellPackageId, setUpsellPackageId] = useState(rule.upsell_package_id || '');
  const [commissionType, setCommissionType] = useState(rule.commission_type || 'fixed');
  const [commissionValue, setCommissionValue] = useState(rule.commission_value || 0);
  const [active, setActive] = useState(rule.active !== false);
  const [effectiveStart, setEffectiveStart] = useState(rule.effective_start || new Date().toISOString().slice(0, 10));
  const [effectiveEnd, setEffectiveEnd] = useState(rule.effective_end || '');
  const [eligibleStaff, setEligibleStaff] = useState(rule.eligible_staff || []);

  const originalPackages = originalProductId ? packages.filter(p => p.product_id === originalProductId) : [];
  const upsellPackages = upsellProductId ? packages.filter(p => p.product_id === upsellProductId) : [];
  const staffList = (profiles || []).filter(p => p.role === 'staff');
  function toggleStaff(id) { setEligibleStaff(eligibleStaff.includes(id) ? eligibleStaff.filter(x => x !== id) : [...eligibleStaff, id]); }

  async function save() {
    const payload = {
      original_product_id: originalProductId || null, original_package_id: originalPackageId || null,
      upsell_product_id: upsellProductId || null, upsell_package_id: upsellPackageId || null,
      commission_type: commissionType, commission_value: parseFloat(commissionValue) || 0,
      active, effective_start: effectiveStart, effective_end: effectiveEnd || null,
      eligible_staff: eligibleStaff.length > 0 ? eligibleStaff : null,
    };
    if (isNew) {
      await supabase.from('upsell_commission_rules').insert(payload);
    } else {
      await supabase.from('upsell_commission_rules').update(payload).eq('id', rule.id);
    }
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{isNew ? 'New' : 'Edit'} upsell rule</h3>
        <label style={{ marginTop: 0 }}>Original product (leave blank for "any")</label>
        <select value={originalProductId} onChange={e => { setOriginalProductId(e.target.value); setOriginalPackageId(''); }}>
          <option value="">Any product</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {originalPackages.length > 0 && (
          <>
            <label>Original package</label>
            <select value={originalPackageId} onChange={e => setOriginalPackageId(e.target.value)}>
              <option value="">Any package</option>
              {originalPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
        <label>Upsell product (leave blank for "any")</label>
        <select value={upsellProductId} onChange={e => { setUpsellProductId(e.target.value); setUpsellPackageId(''); }}>
          <option value="">Any product</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {upsellPackages.length > 0 && (
          <>
            <label>Upsell package</label>
            <select value={upsellPackageId} onChange={e => setUpsellPackageId(e.target.value)}>
              <option value="">Any package</option>
              {upsellPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
        <div className="row2">
          <div><label>Commission type</label>
            <select value={commissionType} onChange={e => setCommissionType(e.target.value)}>
              <option value="fixed">Fixed ₦ amount</option>
              <option value="percentage">% of upsell value</option>
              <option value="per_unit">₦ per unit</option>
              <option value="per_package">₦ per package</option>
              <option value="per_event">₦ per upsell event</option>
            </select>
          </div>
          <div><label>Value</label><input type="number" min="0" value={commissionValue} onChange={e => setCommissionValue(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div><label>Effective from</label><input type="date" value={effectiveStart} onChange={e => setEffectiveStart(e.target.value)} /></div>
          <div><label>Effective until (optional)</label><input type="date" value={effectiveEnd} onChange={e => setEffectiveEnd(e.target.value)} /></div>
        </div>
        <label>Which staff can earn this rule?</label>
        <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '140px', overflowY: 'auto', marginBottom: '10px' }}>
          {staffList.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>No staff added yet.</p>}
          {staffList.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 2px' }}>
              <input type="checkbox" checked={eligibleStaff.includes(s.id)} onChange={() => toggleStaff(s.id)} />
              {s.full_name}
            </label>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-6px', marginBottom: '10px' }}>Leave all unchecked to make every staff member eligible for this rule.</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save rule</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Phase 2: rule testing tool, upsells oversight, suspicious activity ----------

export function UpsellsPage({ products, packages, profiles }) {
  const [upsells, setUpsells] = useState([]);
  const [ordersById, setOrdersById] = useState({});
  const [loading, setLoading] = useState(true);
  const [cancelReason, setCancelReason] = useState({});
  const [holdReason, setHoldReason] = useState({});
  const [busy, setBusy] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('upsells').select('*').order('created_at', { ascending: false });
    setUpsells(data || []);
    const orderIds = [...new Set((data || []).map(u => u.original_order_id))];
    if (orderIds.length > 0) {
      const { data: orderRows } = await supabase.from('orders').select('*').in('id', orderIds);
      const map = {};
      (orderRows || []).forEach(o => { map[o.id] = o; });
      setOrdersById(map);
    }
    setLoading(false);
  }
  const prodName = id => id ? (products.find(p => p.id === id) || {}).name || '—' : '—';
  const staffName = id => (profiles.find(p => p.id === id) || {}).full_name || '—';

  async function cancel(u) {
    const reason = cancelReason[u.id] || 'No reason given';
    setBusy(u.id);
    await supabase.rpc('cancel_upsell', { p_upsell_id: u.id, p_reason: reason });
    setBusy(null);
    load();
  }
  async function approve(u) {
    setBusy(u.id);
    const { error } = await supabase.rpc('approve_upsell_commission', { p_upsell_id: u.id });
    setBusy(null);
    if (error) { alert(error.message); return; }
    load();
  }
  async function hold(u) {
    const reason = holdReason[u.id] || 'No reason given';
    setBusy(u.id);
    await supabase.rpc('hold_upsell', { p_upsell_id: u.id, p_reason: reason });
    setBusy(null);
    load();
  }

  if (loading) return <div className="loading">Loading upsells…</div>;

  const pendingApproval = upsells.filter(u => u.commission_status === 'Eligible');

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Upsells</h1><p className="page-sub">Every genuine upsell, created only through the dedicated Add Upsell flow — never by editing an original order.</p></div></div>

      {pendingApproval.length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Waiting for your approval ({pendingApproval.length})</h3>
          <table style={{ marginBottom: '24px' }}>
            <thead><tr><th>Order details</th><th>Staff</th><th>Original → Upsell</th><th>Qty / Amount</th><th>Commission</th><th></th></tr></thead>
            <tbody>
              {pendingApproval.map(u => {
                const ord = ordersById[u.original_order_id];
                return (
                <tr key={u.id}>
                  <td>
                    <span className="oid">{u.original_order_id.slice(0, 8)}</span>
                    {ord && <div style={{ fontSize: '12px' }}>{ord.customer}<div style={{ color: '#8A93A0' }}>{ord.phone}{ord.address ? ` · ${ord.address}` : ''}</div></div>}
                  </td>
                  <td>{staffName(u.staff_id)}</td>
                  <td style={{ fontSize: '12.5px' }}>{prodName(u.original_product_id)} → {prodName(u.upsell_product_id)}</td>
                  <td>+{u.additional_quantity} · ₦{Number(u.upsell_amount).toLocaleString()}</td>
                  <td>₦{Number(u.commission_amount).toLocaleString()}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn primary" disabled={busy === u.id} onClick={() => approve(u)} style={{ marginRight: '6px' }}>Approve</button>
                    <input
                      placeholder="hold reason"
                      value={holdReason[u.id] || ''}
                      onChange={e => setHoldReason({ ...holdReason, [u.id]: e.target.value })}
                      style={{ width: '90px', fontSize: '11px', padding: '4px 6px', border: '1px solid #DEDAD0', borderRadius: '4px', marginRight: '6px' }}
                    />
                    <button className="btn" disabled={busy === u.id} onClick={() => hold(u)}>Hold</button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>All upsells</h3>
      <table>
        <thead><tr><th>Order details</th><th>Staff</th><th>Original → Upsell</th><th>Qty / Amount</th><th>Commission</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {upsells.length === 0 && <tr><td colSpan="7" className="empty">No upsells created yet.</td></tr>}
          {upsells.map(u => {
            const ord = ordersById[u.original_order_id];
            return (
            <tr key={u.id}>
              <td>
                <span className="oid">{u.original_order_id.slice(0, 8)}</span>
                {ord && <div style={{ fontSize: '12px' }}>{ord.customer}<div style={{ color: '#8A93A0' }}>{ord.phone}{ord.address ? ` · ${ord.address}` : ''}</div></div>}
              </td>
              <td>{staffName(u.staff_id)}</td>
              <td style={{ fontSize: '12.5px' }}>{prodName(u.original_product_id)} → {prodName(u.upsell_product_id)}</td>
              <td>+{u.additional_quantity} · ₦{Number(u.upsell_amount).toLocaleString()}</td>
              <td>₦{Number(u.commission_amount).toLocaleString()}</td>
              <td><span className={'pill ' + (u.commission_status === 'Paid' || u.commission_status === 'Approved' ? 'Delivered' : u.commission_status === 'Eligible' ? 'Preparing' : u.commission_status === 'Rejected' || u.commission_status === 'Reversed' ? 'Cancelled' : 'New')}>{u.commission_status}</span></td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {!['Rejected', 'Reversed', 'Approved', 'Paid'].includes(u.commission_status) && (
                  <>
                    <input
                      placeholder="reason"
                      value={cancelReason[u.id] || ''}
                      onChange={e => setCancelReason({ ...cancelReason, [u.id]: e.target.value })}
                      style={{ width: '90px', fontSize: '11px', padding: '4px 6px', border: '1px solid #DEDAD0', borderRadius: '4px', marginRight: '6px' }}
                    />
                    <button className="link-btn" style={{ color: '#B0483F' }} onClick={() => cancel(u)}>Cancel</button>
                  </>
                )}
              </td>
            </tr>
          );})}
        </tbody>
      </table>
    </div>
  );
}

export function CommissionRuleTester({ products, packages }) {
  const [originalProductId, setOriginalProductId] = useState('');
  const [originalPackageId, setOriginalPackageId] = useState('');
  const [upsellProductId, setUpsellProductId] = useState('');
  const [upsellPackageId, setUpsellPackageId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [result, setResult] = useState(null);
  const [tested, setTested] = useState(false);

  const originalPackages = originalProductId ? packages.filter(p => p.product_id === originalProductId) : [];
  const upsellPackages = upsellProductId ? packages.filter(p => p.product_id === upsellProductId) : [];
  const prodName = id => id ? (products.find(p => p.id === id) || {}).name || '—' : 'Any';
  const pkgName = id => id ? (packages.find(p => p.id === id) || {}).name || '—' : 'Any';

  async function runTest() {
    const { data, error } = await supabase.rpc('test_upsell_commission', {
      p_original_product_id: originalProductId || null,
      p_original_package_id: originalPackageId || null,
      p_upsell_product_id: upsellProductId || null,
      p_upsell_package_id: upsellPackageId || null,
      p_additional_quantity: parseInt(quantity, 10) || 1,
      p_unit_price: parseFloat(unitPrice) || 0,
    });
    setTested(true);
    setResult(error ? null : (data && data[0]) || null);
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', marginBottom: '24px', maxWidth: '520px' }}>
      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginTop: 0, marginBottom: '10px' }}>Test a commission rule</h3>
      <p style={{ fontSize: '12px', color: '#8A93A0', marginBottom: '12px' }}>Try a hypothetical upsell before staff ever see it — nothing here is saved.</p>
      <label className="field-label" style={{ marginTop: 0 }}>Original product</label>
      <select value={originalProductId} onChange={e => { setOriginalProductId(e.target.value); setOriginalPackageId(''); }} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px' }}>
        <option value="">Any product</option>
        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {originalPackages.length > 0 && (
        <>
          <label className="field-label">Original package</label>
          <select value={originalPackageId} onChange={e => setOriginalPackageId(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px' }}>
            <option value="">Any package</option>
            {originalPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
      <label className="field-label">Upsell product</label>
      <select value={upsellProductId} onChange={e => { setUpsellProductId(e.target.value); setUpsellPackageId(''); }} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px' }}>
        <option value="">Any product</option>
        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {upsellPackages.length > 0 && (
        <>
          <label className="field-label">Upsell package</label>
          <select value={upsellPackageId} onChange={e => setUpsellPackageId(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '10px' }}>
            <option value="">Any package</option>
            {upsellPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
      <div className="row2" style={{ marginBottom: '10px' }}>
        <div><label className="field-label" style={{ marginTop: 0 }}>Quantity</label><input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
        <div><label className="field-label" style={{ marginTop: 0 }}>Unit price (₦)</label><input type="number" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
      </div>
      <button className="btn primary" onClick={runTest} style={{ width: '100%', marginBottom: '12px' }}>Run test</button>
      {tested && (
        result ? (
          <div className="banner">
            <div><strong>Matched rule:</strong> {prodName(originalProductId)} · {pkgName(originalPackageId)} → {prodName(upsellProductId)} · {pkgName(upsellPackageId)}</div>
            <div><strong>Commission type:</strong> {result.commission_type} ({result.commission_value})</div>
            <div><strong>Specificity score:</strong> {result.specificity} (higher = more specific match, wins over general rules)</div>
            <div><strong>Calculated commission:</strong> ₦{Number(result.calculated_commission).toLocaleString()}</div>
          </div>
        ) : (
          <div className="banner" style={{ background: '#F3DEDC', color: '#B0483F', borderColor: '#E7C3BF' }}>
            No matching rule found — this combination would earn ₦0 right now.
          </div>
        )
      )}
    </div>
  );
}

export function SuspiciousActivityPage({ profiles, orders }) {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: corrections }, { data: upsells }] = await Promise.all([
      supabase.from('order_corrections').select('*'),
      supabase.from('upsells').select('*'),
    ]);
    setFlags(computeFlags(corrections || [], upsells || []));
    setLoading(false);
  }

  function computeFlags(corrections, upsells) {
    const staffList = profiles.filter(p => p.role === 'staff');
    const out = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Frequent correction requests per staff
    staffList.forEach(s => {
      const recent = corrections.filter(c => c.requested_by === s.id && new Date(c.created_at) > thirtyDaysAgo);
      if (recent.length >= 3) {
        out.push({ severity: 'High', staff: s.full_name, issue: `${recent.length} correction requests in the last 30 days`, type: 'Frequent corrections' });
      }
    });

    // Multiple corrections on the same order
    const byOrder = {};
    corrections.forEach(c => { byOrder[c.order_id] = (byOrder[c.order_id] || 0) + 1; });
    Object.entries(byOrder).forEach(([orderId, count]) => {
      if (count >= 2) {
        out.push({ severity: 'Medium', staff: '—', issue: `Order ${orderId.slice(0, 8)} has ${count} correction requests`, type: 'Repeated corrections on one order' });
      }
    });

    // Upsell created shortly after a correction on the same order
    upsells.forEach(u => {
      const relatedCorrections = corrections.filter(c => c.order_id === u.original_order_id);
      relatedCorrections.forEach(c => {
        const diffMinutes = Math.abs(new Date(u.created_at) - new Date(c.created_at)) / 60000;
        if (diffMinutes < 30) {
          out.push({ severity: 'High', staff: staffList.find(s => s.id === u.staff_id)?.full_name || '—', issue: `Upsell created within ${Math.round(diffMinutes)} min of a correction on order ${u.original_order_id.slice(0, 8)}`, type: 'Upsell right after correction' });
        }
      });
    });

    // Unusually high upsell activity vs total orders handled
    staffList.forEach(s => {
      const myOrders = orders.filter(o => o.staff_id === s.id);
      const myUpsells = upsells.filter(u => u.staff_id === s.id);
      if (myOrders.length >= 5 && myUpsells.length / myOrders.length > 0.6) {
        out.push({ severity: 'Medium', staff: s.full_name, issue: `${myUpsells.length} upsells across only ${myOrders.length} orders (${Math.round((myUpsells.length / myOrders.length) * 100)}%)`, type: 'High upsell ratio' });
      }
    });

    // Commission calculated but the upsold item was never actually delivered
    upsells.forEach(u => {
      if (['Eligible', 'Approved', 'Paid'].includes(u.commission_status) && u.delivery_status !== 'Delivered') {
        out.push({ severity: 'High', staff: staffList.find(s => s.id === u.staff_id)?.full_name || '—', issue: `Commission active on upsell for order ${u.original_order_id.slice(0, 8)} but delivery status is "${u.delivery_status}"`, type: 'Commission without delivery' });
      }
    });

    return out.sort((a, b) => (a.severity === 'High' ? 0 : 1) - (b.severity === 'High' ? 0 : 1));
  }

  if (loading) return <div className="loading">Scanning for suspicious activity…</div>;

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Suspicious Activity</h1><p className="page-sub">Automatically flagged patterns worth a closer look — nothing here is blocked automatically, it's for your review.</p></div></div>
      {flags.length === 0 ? (
        <div className="empty">Nothing flagged right now — everything looks normal.</div>
      ) : (
        <table>
          <thead><tr><th>Severity</th><th>Type</th><th>Staff</th><th>Detail</th></tr></thead>
          <tbody>
            {flags.map((f, i) => (
              <tr key={i}>
                <td><span className={'pill ' + (f.severity === 'High' ? 'Cancelled' : 'Preparing')}>{f.severity}</span></td>
                <td>{f.type}</td>
                <td>{f.staff}</td>
                <td style={{ fontSize: '12.5px' }}>{f.issue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Unified Commission hub: overview, upsell rules, upsells, corrections ----------
export function CommissionHub({ profiles, orders, products, packages, session, profile }) {
  const [tab, setTab] = useState('overview');
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'upsellrules', label: 'Upsell Rules' },
    { key: 'upsells', label: 'Upsells' },
    { key: 'corrections', label: 'Corrections' },
    { key: 'suspicious', label: 'Suspicious Activity' },
  ];
  return (
    <div>
      <div className="product-tabs" style={{ marginBottom: '18px' }}>
        {TABS.map(t => (
          <span key={t.key} className={'ptab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>{t.label}</span>
        ))}
      </div>
      {tab === 'overview' && <AdminCommissionPage profiles={profiles} orders={orders} products={products} session={session} />}
      {tab === 'upsellrules' && <UpsellRulesPage products={products} packages={packages} profiles={profiles} />}
      {tab === 'upsells' && <UpsellsPage products={products} packages={packages} profiles={profiles} />}
      {tab === 'corrections' && <CorrectionsPage profile={profile} session={session} refresh={() => {}} />}
      {tab === 'suspicious' && <SuspiciousActivityPage profiles={profiles} orders={orders} />}
    </div>
  );
}
