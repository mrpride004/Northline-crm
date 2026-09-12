'use client';
import { useState, useEffect, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['New', 'Confirmed', 'Preparing', 'Dispatched', 'Delivered', 'Unreachable', 'Unverified', 'Rescheduled', 'Failed Delivery', 'Cancelled'];

const LEAD_SOURCES = ['WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Website', 'Phone Call', 'Referral', 'Influencer', 'Walk-in', 'Other'];

// Statuses a staff member can ever be granted (via role default or personal
// override) — 'Failed Delivery' is deliberately left out here, not just
// unchecked by default: only admin/dispatch can ever set it, so it doesn't
// belong in the staff permission picker at all.
const STAFF_ASSIGNABLE_STATUSES = STATUSES.filter(s => s !== 'Failed Delivery');

export function statusRowColor(status) {
  const map = {
    New: '#F1DFA9',
    Confirmed: '#B9E0D3',
    Preparing: '#C6CBF0',
    Dispatched: '#B6DEF3',
    Delivered: '#BEE4BE',
    Unreachable: '#F0C889',
    Unverified: '#E06BB8',
    Rescheduled: '#D7BEEC',
    'Failed Delivery': '#F0A882',
    Cancelled: '#EFBEBA',
  };
  return map[status] || 'transparent';
}

// CSS class names can't contain spaces as a single token, so "Failed
// Delivery" becomes "Failed-Delivery" for the .pill.<class> styling —
// display text everywhere else still uses the real "Failed Delivery" value.
export function pillClass(status) {
  return String(status || '').replace(/\s+/g, '-');
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

export async function silentlyRelinkPush(session) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return; // permission granted but no active subscription — nothing to silently relink
    await fetch('/api/save-push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
  } catch (e) { /* best-effort, never block the app on this */ }
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

// The real fix for unreliable notifications: every important event creates a
// PERSISTENT row per recipient (readable/recoverable later, tracked read/unread),
// in addition to the best-effort push. Use this instead of sendPushNotification
// directly for anything the recipient genuinely must not miss.
export async function notifyUsers(session, { userIds, type, title, body, orderId, upsellId }) {
  if (!userIds || userIds.length === 0) return;
  try {
    await supabase.from('notifications').insert(
      userIds.map(uid => ({ recipient_id: uid, type: type || 'general', title, body, order_id: orderId || null, related_upsell_id: upsellId || null }))
    );
  } catch (e) { /* if this fails we still try push below, better than nothing */ }
  sendPushNotification(session, { userIds, title, body, url: '/dashboard' });
}


export function showToast(message) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed; bottom:28px; left:50%; transform:translateX(-50%) translateY(0); background:#3730A3; color:#fff; padding:11px 20px; border-radius:24px; font-size:13.5px; font-weight:600; z-index:9999; box-shadow:0 10px 30px rgba(0,0,0,.3); opacity:0; transition:opacity .18s ease, transform .18s ease;';
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
  el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%) translateY(-12px); background:#3730A3; color:#fff; padding:13px 22px; border-radius:10px; font-size:13.5px; font-weight:600; z-index:9999; box-shadow:0 10px 30px rgba(0,0,0,.35); opacity:0; transition:opacity .2s ease, transform .2s ease; cursor:pointer; max-width:90vw; text-align:center;';
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



function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

export function getCycleStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export async function recordCommissionForOrder(order) {
  if (order.is_test) return; // test/demo orders never generate real commission
  if (!order.staff_id) return;
  if (!order.product_id && !order.set_id) return;
  const { data: rule } = order.set_id
    ? await supabase.from('commission_rules').select('*').eq('set_id', order.set_id).maybeSingle()
    : await supabase.from('commission_rules').select('*').eq('product_id', order.product_id).maybeSingle();
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
  if (fresh.is_test) return; // test/demo orders never generate real commission
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

export function buildOrderSummary(order, products, packages, upsells, productSets) {
  const current = getCurrentPackage(order, upsells);
  const product = current.setId ? null : (products || []).find(p => p.id === current.productId);
  const set = current.setId ? (productSets || []).find(s => s.id === current.setId) : null;
  const pkg = current.packageId ? (packages || []).find(p => p.id === current.packageId) : null;
  const gift = pkg && pkg.gift_product_id ? (products || []).find(p => p.id === pkg.gift_product_id) : null;
  const itemName = set ? `📦 ${set.name}` : (product ? product.name : '—');
  const setContents = set ? set.items?.map(i => `${i.quantity_per_set}× ${(products || []).find(p => p.id === i.product_id)?.name || '—'}`).join(' + ') : null;

  const lines = [
    `Order: ${order.serial_number ? '#' + order.serial_number : order.id}`,
    `Customer: ${order.customer} (${order.phone || 'no phone'}${order.phone2 ? `, alt: ${order.phone2}` : ''})`,
    `Address: ${order.address || '—'}${order.state ? ', ' + order.state : ''}`,
    '',
    `${itemName}${current.quantity > 1 ? ` × ${current.quantity}` : ''} — ₦${current.unitPrice.toLocaleString()} = ₦${current.amount.toLocaleString()}`,
    setContents ? `Set contains: ${setContents}` : null,
    pkg ? `Package: ${pkg.name}` : null,
    gift ? `Free gift: ${gift.name} × ${order.gift_quantity}` : null,
  ];

  if (current.changed) {
    const prevSet = current.previousSetId ? (productSets || []).find(s => s.id === current.previousSetId) : null;
    const prevProduct = current.previousSetId ? null : (products || []).find(p => p.id === current.previousProductId);
    const prevPkg = current.previousPackageId ? (packages || []).find(p => p.id === current.previousPackageId) : null;
    const prevLabel = prevSet ? `📦 ${prevSet.name}` : (prevProduct ? prevProduct.name : '—');
    lines.push(`(Customer moved to this package — originally ordered ${prevLabel}${prevPkg ? ' · ' + prevPkg.name : ''})`);
  }

  lines.push(
    '',
    `Status: ${order.status}`,
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
      productId: active.upsell_product_id, packageId: active.upsell_package_id, setId: active.upsell_set_id || null,
      quantity: active.additional_quantity, unitPrice: Number(active.unit_price || 0),
      amount: Number(active.additional_quantity || 1) * Number(active.unit_price || 0),
      changed: true,
      previousProductId: order.product_id, previousPackageId: order.package_id, previousSetId: order.set_id || null,
    };
  }
  return {
    productId: order.product_id, packageId: order.package_id, setId: order.set_id || null,
    quantity: order.quantity || 1, unitPrice: Number(order.unit_price || 0),
    amount: (order.quantity || 1) * Number(order.unit_price || 0),
    changed: false, previousProductId: null, previousPackageId: null, previousSetId: null,
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

export async function sendConfirmation({ phone, customerName, orderId, itemLabel, sendSms, sendWhatsapp, customMessage }) {
  try {
    await fetch('/api/send-confirmation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, customerName, orderId, itemLabel, sendSms, sendWhatsapp, customMessage }),
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
  const [collectAmounts, setCollectAmounts] = useState({});
  const [thresholdEdits, setThresholdEdits] = useState({});
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [errors, setErrors] = useState({});
  const [retrievals, setRetrievals] = useState([]);
  const dispatchList = profiles.filter(p => p.role === 'dispatch');
  const selected = dispatchList.find(d => d.id === agentId);

  useEffect(() => { loadRetrievals(); }, []);
  async function loadRetrievals() {
    const { data } = await supabase.from('agent_stock_retrievals').select('*').order('collected_at', { ascending: false }).limit(50);
    setRetrievals(data || []);
  }

  function rowFor(pid) {
    return agentStock.find(a => a.agent_id === agentId && a.product_id === pid) || null;
  }
  function stockFor(pid) {
    const row = rowFor(pid);
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

  async function collect(pid) {
    const amt = parseInt(collectAmounts[pid], 10);
    if (!amt || amt <= 0 || !agentId) return;
    const held = stockFor(pid);
    if (amt > held) {
      setErrors({ ...errors, [pid]: `This agent only has ${held} — can't collect ${amt}.` });
      return;
    }
    setErrors({ ...errors, [pid]: null });
    const { error } = await supabase.rpc('collect_agent_stock', { p_agent_id: agentId, p_product_id: pid, p_quantity: amt });
    if (error) {
      setErrors({ ...errors, [pid]: error.message });
      return;
    }
    setCollectAmounts({ ...collectAmounts, [pid]: '' });
    refresh();
    loadRetrievals();
  }

  async function confirmReceived(id) {
    await supabase.rpc('confirm_stock_received', { p_retrieval_id: id });
    refresh();
    loadRetrievals();
  }

  async function saveThreshold(pid) {
    const val = parseInt(thresholdEdits[pid], 10);
    if (isNaN(val)) return;
    const existing = rowFor(pid);
    if (existing) {
      await supabase.from('agent_stock').update({ low_stock_threshold: val }).eq('id', existing.id);
    } else {
      await supabase.from('agent_stock').insert({ agent_id: agentId, product_id: pid, quantity: 0, low_stock_threshold: val });
    }
    setThresholdEdits({ ...thresholdEdits, [pid]: '' });
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
      <div className="topbar" style={{ borderLeft: '4px solid #C6862F', paddingLeft: '14px' }}>
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
            <thead><tr><th>Product</th><th>Central inventory</th><th>Agent currently holds</th><th>Low-stock alert below</th><th>Send more</th><th>Collect back</th></tr></thead>
            <tbody>
              {products.map((p, pIdx) => {
                const row = rowFor(p.id);
                const qty = stockFor(p.id);
                const threshold = row?.low_stock_threshold;
                const isLow = threshold != null && qty <= threshold;
                const dotColor = ['#4A7FBF', '#4A9B6E', '#C6862F', '#8A5EBF', '#BF5E6E', '#5EA3BF'][pIdx % 6];
                return (
                <tr key={p.id}>
                  <td><span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: dotColor, marginRight: '7px' }}></span>{p.name}</td>
                  <td><span className={'pill ' + (p.stock_quantity > 0 ? 'Delivered' : 'Cancelled')}>{p.stock_quantity} available</span></td>
                  <td>
                    <span style={isLow ? { color: '#B0483F', fontWeight: 700 } : {}}>{qty} units{isLow ? ' — LOW' : ''}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <input
                      type="number" min="0" placeholder={threshold != null ? String(threshold) : 'none set'}
                      value={thresholdEdits[p.id] ?? ''}
                      onChange={e => setThresholdEdits({ ...thresholdEdits, [p.id]: e.target.value })}
                      style={{ width: '90px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                    />{' '}
                    <button className="link-btn" onClick={() => saveThreshold(p.id)}>Save</button>
                  </td>
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
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <input
                      type="number" min="1" max={qty} placeholder="qty"
                      value={collectAmounts[p.id] || ''}
                      onChange={e => setCollectAmounts({ ...collectAmounts, [p.id]: e.target.value })}
                      style={{ width: '80px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                    />{' '}
                    <button className="link-btn" onClick={() => collect(p.id)}>Collect</button>
                  </td>
                </tr>
              );})}
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

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '28px 0 10px' }}>Stock collected from agents</h3>
      {retrievals.filter(r => r.status === 'Pending Receipt').length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#8A93A0', marginBottom: '6px' }}>AWAITING CONFIRMATION — not yet added back to central inventory</div>
          {retrievals.filter(r => r.status === 'Pending Receipt').map(r => (
            <div key={r.id} className="list-manage-row">
              <span>
                {r.quantity} × {(products.find(p => p.id === r.product_id) || {}).name || '—'} from {(profiles.find(p => p.id === r.agent_id) || {}).full_name || '—'}
                <span style={{ color: '#8A93A0', fontSize: '11px' }}> · collected by {r.collected_by_name || '—'} · {new Date(r.collected_at).toLocaleString()}</span>
              </span>
              <button className="btn primary" onClick={() => confirmReceived(r.id)}>Confirm received</button>
            </div>
          ))}
        </div>
      )}
      <table>
        <thead><tr><th>Date</th><th>Agent</th><th>Product</th><th>Qty</th><th>Status</th><th>Received</th></tr></thead>
        <tbody>
          {retrievals.length === 0 && <tr><td colSpan="6" className="empty">No collections recorded yet.</td></tr>}
          {retrievals.map(r => (
            <tr key={r.id}>
              <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(r.collected_at).toLocaleString()}</td>
              <td>{(profiles.find(p => p.id === r.agent_id) || {}).full_name || '—'}</td>
              <td>{(products.find(p => p.id === r.product_id) || {}).name || '—'}</td>
              <td>{r.quantity}</td>
              <td><span className={'pill ' + (r.status === 'Received' ? 'Delivered' : 'New')}>{r.status}</span></td>
              <td style={{ fontSize: '12px', color: '#8A93A0' }}>{r.received_at ? new Date(r.received_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
export function StatusRemarkModal({ order, newStatus, hidePaidCheckbox, canEditFee, isAdmin, onClose, onConfirm }) {
  const [remark, setRemark] = useState('');
  const [fee, setFee] = useState(order.delivery_fee || '');
  const [rescheduleDate, setRescheduleDate] = useState(order.reschedule_date || '');
  const [paidNow, setPaidNow] = useState(false);
  const isDelivering = newStatus === 'Delivered';
  const isCancelling = newStatus === 'Cancelled';
  const isRescheduling = newStatus === 'Rescheduled';
  const isUnverified = newStatus === 'Unverified';
  const isFailedDelivery = newStatus === 'Failed Delivery';
  // Cancelled orders never went out, so there's nothing to collect a delivery
  // fee for — dispatch no longer gets a fee field for that one. Failed
  // Delivery is a real attempt (fuel/time spent, sometimes a partial
  // collection), so it keeps the fee field just like Delivered does.
  const showFeeField = canEditFee && (isDelivering || isFailedDelivery);
  const remarkMissing = (isUnverified || isFailedDelivery) && !remark.trim();

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Mark as {newStatus}</h3>
        {isUnverified && isAdmin && (
          <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-6px', marginBottom: '12px' }}>
            For a customer who placed an order but isn't looking serious, or kept giving excuses on the confirmation call. Record exactly what they said below — this is what makes the status useful.
          </p>
        )}
        {isFailedDelivery && (
          <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-6px', marginBottom: '12px' }}>
            The delivery attempt didn't go through — customer unavailable, refused at the door, wrong address, etc. Say what happened below; it'll show on the Failed Deliveries report.
          </p>
        )}
        {showFeeField && (
          <>
            <label style={{ marginTop: 0 }}>Delivery fee collected (₦)</label>
            <input type="number" min="0" value={fee} onChange={e => setFee(e.target.value)} placeholder="e.g. 1500" autoFocus />
          </>
        )}
        {isDelivering && !hidePaidCheckbox && (
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
        {isRescheduling && (
          <>
            <label style={{ marginTop: 0 }}>New delivery date</label>
            <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} autoFocus />
          </>
        )}
        <label style={{ marginTop: (showFeeField || isRescheduling) ? '14px' : 0 }}>Remark {(isUnverified || isFailedDelivery) ? '— what happened?' : '(optional)'}</label>
        <textarea
          value={remark} onChange={e => setRemark(e.target.value)}
          placeholder={
            isUnverified ? "e.g. \"Said they'll call back, never did\", \"Kept asking for a discount then went quiet\", \"Claims they didn't place the order\""
            : isFailedDelivery ? "e.g. \"Customer didn't pick up after 3 tries\", \"Wrong address, no landmark\", \"Refused at the door\""
            : 'Anything worth noting about this update'
          }
          autoFocus={!showFeeField && !isRescheduling}
        />
        {remarkMissing && <p style={{ fontSize: '11.5px', color: '#B0483F', marginTop: '4px' }}>A remark is required for {isFailedDelivery ? 'Failed Delivery' : 'Unverified'} — it's the whole point of the status.</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={remarkMissing} onClick={() => onConfirm({ remark: remark.trim(), fee: parseFloat(fee) || 0, rescheduleDate, paidNow })}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmOrderModal({ order, profile, profiles, session, onClose, onConfirmed }) {
  const [priority, setPriority] = useState(order.priority || 'Normal');
  const [preferredTime, setPreferredTime] = useState(order.preferred_time || '');
  const [remark, setRemark] = useState('');
  const [stateValue, setStateValue] = useState(order.state || '');
  const [statePref, setStatePref] = useState(null);
  const [chosenAgent, setChosenAgent] = useState(null);
  const [assignMode, setAssignMode] = useState(null);
  const [loadedPref, setLoadedPref] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const matchingDispatch = (profiles || []).filter(p => p.role === 'dispatch' && p.active && stateValue && p.state === stateValue);

  useEffect(() => {
    (async () => {
      setLoadedPref(false);
      if (!stateValue) { setChosenAgent(null); setAssignMode(null); setLoadedPref(true); return; }
      const { data: pref } = await supabase.from('state_dispatch_preference').select('*').eq('state', stateValue).maybeSingle();
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
  }, [stateValue]);

  const canAutoAssign = !profile || profile.role === 'admin' || profile.can_auto_assign !== false;
  const willAutoAssign = canAutoAssign && !order.dispatch_id && !!chosenAgent;

  async function confirm() {
    if (submitting) return; // guard against double-clicks causing duplicate assignment notifications/log entries
    setSubmitting(true);
    const patch = {
      status: 'Confirmed', priority, preferred_time: preferredTime.trim(), state: stateValue || null,
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    };
    if (willAutoAssign) patch.dispatch_id = chosenAgent.id;
    try {
      const { error } = await supabase.from('orders').update(patch).eq('id', order.id);
      if (error) { alert('Unable to confirm this order. Please try again.\n\n' + error.message); return; }
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
        await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'assigned', note: `Automatically sent to ${chosenAgent.full_name} (${stateValue}) on confirmation${assignMode === 'round_robin' ? ' — load-balanced pick' : ''}.` });
        notifyUsers(session, { userIds: [chosenAgent.id], type: 'order_assigned', title: 'New delivery assigned', body: order.customer, orderId: order.id });
      }
      if (remark.trim()) {
        await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: remark.trim() });
      }
      onConfirmed();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Confirm order · {order.customer}</h3>
        {canAutoAssign && (
          <>
            <label style={{ marginTop: 0 }}>Delivery state</label>
            <select value={stateValue} onChange={e => setStateValue(e.target.value)}>
              <option value="">— Select the customer's state —</option>
              {NIGERIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {!stateValue && <p style={{ fontSize: '11px', color: '#B0483F', marginTop: '4px' }}>Without a state, this can't auto-assign to dispatch — admin will need to assign manually.</p>}
          </>
        )}
        <label style={{ marginTop: canAutoAssign ? undefined : 0 }}>Priority</label>
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
          <p style={{ fontSize: '11.5px', color: '#4F46E5', marginTop: '10px' }}>
            ✓ Will automatically send to {chosenAgent.full_name} in {stateValue} on confirmation
            {assignMode === 'preferred' ? ' (admin-preferred agent)' : assignMode === 'round_robin' ? ' (load-balanced — has the fewest active deliveries right now)' : ''}.
          </p>
        ) : stateValue ? (
          <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '10px' }}>No dispatch partner found for {stateValue} yet — admin will need to assign one manually.</p>
        ) : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={confirm} disabled={submitting}>{submitting ? 'Confirming…' : 'Confirm order'}</button>
        </div>
      </div>
    </div>
  );
}


export function ReportsPage({ orders, profiles, products, session, latestRemarks }) {
  const [range, setRange] = useState('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [lastSeen, setLastSeen] = useState({});
  const [detailPerson, setDetailPerson] = useState(null);
  const [movements, setMovements] = useState([]);
  const [upsellsByOrder, setUpsellsByOrder] = useState({});
  const [section, setSection] = useState('overview');
  const [adExpenses, setAdExpenses] = useState([]);
  const [landingSources, setLandingSources] = useState([]);

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
      const { data } = await supabase.from('expenses').select('*').eq('category', 'ad_spend');
      setAdExpenses(data || []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('landing_page_sources').select('*');
      setLandingSources(data || []);
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

  function expenseInRange(e) {
    const d = new Date(e.expense_date + 'T00:00:00');
    const now = new Date();
    if (range === 'today') return d.toDateString() === now.toDateString();
    if (range === '7d') return now - d <= 7 * 24 * 60 * 60 * 1000;
    if (range === '30d') return now - d <= 30 * 24 * 60 * 60 * 1000;
    if (range === 'custom') {
      if (fromDate && d < new Date(fromDate)) return false;
      if (toDate && d > new Date(toDate + 'T23:59:59')) return false;
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
  const failedDeliveries = scoped.filter(o => o.status === 'Failed Delivery').sort((a, b) => new Date(b.status_updated_at || b.created_at) - new Date(a.status_updated_at || a.created_at));
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

  const scopedAdSpend = adExpenses.filter(expenseInRange);
  const spendByChannel = {};
  scopedAdSpend.forEach(e => {
    const key = (e.channel || 'Unspecified').trim();
    spendByChannel[key] = (spendByChannel[key] || 0) + Number(e.amount || 0);
  });
  const totalAdSpend = scopedAdSpend.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  function findSpendFor(sourceName) {
    const match = Object.keys(spendByChannel).find(k => k.toLowerCase() === sourceName.toLowerCase());
    return match ? spendByChannel[match] : 0;
  }

  const sourceStats = LEAD_SOURCES.map(src => {
    const srcOrders = scoped.filter(o => o.lead_source === src);
    const srcDelivered = srcOrders.filter(o => o.status === 'Delivered');
    const revenue = srcDelivered.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
    const spend = findSpendFor(src);
    const conversion = srcOrders.length ? (srcDelivered.length / srcOrders.length) * 100 : 0;
    const cac = spend > 0 && srcDelivered.length > 0 ? spend / srcDelivered.length : null;
    const roas = spend > 0 ? revenue / spend : null;
    return { source: src, orders: srcOrders.length, delivered: srcDelivered.length, revenue, spend, conversion, cac, roas };
  }).filter(s => s.orders > 0 || s.spend > 0);

  const matchedChannelNames = new Set(LEAD_SOURCES.map(s => s.toLowerCase()));
  const unmatchedSpend = Object.entries(spendByChannel).filter(([k]) => !matchedChannelNames.has(k.toLowerCase()));

  const totalMarketingRevenue = sourceStats.reduce((sum, s) => sum + s.revenue, 0);
  const blendedRoas = totalAdSpend > 0 ? totalMarketingRevenue / totalAdSpend : null;

  const campaignStats = landingSources.map(ls => {
    const lsOrders = scoped.filter(o => o.landing_page_source_id === ls.id);
    const lsDelivered = lsOrders.filter(o => o.status === 'Delivered');
    const revenue = lsDelivered.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
    const conversion = lsOrders.length ? (lsDelivered.length / lsOrders.length) * 100 : 0;
    const linkedProduct = (products || []).find(p => p.id === ls.product_id);
    return { id: ls.id, name: ls.name, product: linkedProduct ? linkedProduct.name : '—', orders: lsOrders.length, delivered: lsDelivered.length, revenue, conversion };
  }).filter(c => c.orders > 0).sort((a, b) => b.revenue - a.revenue);

  const productRevenue = (products || []).map(p => {
    const prodDelivered = scoped.filter(o => o.product_id === p.id && o.status === 'Delivered');
    const revenue = prodDelivered.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
    return { name: p.name, revenue, delivered: prodDelivered.length };
  }).filter(p => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const bestProduct = productRevenue[0] || null;

  const staffRevenue = profiles.filter(p => p.role === 'staff').map(s => {
    const handled = scoped.filter(o => o.staff_id === s.id && o.status === 'Delivered');
    const revenue = handled.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
    return { name: s.full_name, revenue, delivered: handled.length };
  }).filter(s => s.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const bestStaff = staffRevenue[0] || null;

  const bestCampaign = campaignStats[0] || null;

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
        <span className={'ptab' + (section === 'overview' ? ' active' : '')} onClick={() => setSection('overview')}>Overview</span>
        <span className={'ptab' + (section === 'marketing' ? ' active' : '')} onClick={() => setSection('marketing')}>Marketing</span>
        <span className={'ptab' + (section === 'team' ? ' active' : '')} onClick={() => setSection('team')}>Team</span>
        <span className={'ptab' + (section === 'state' ? ' active' : '')} onClick={() => setSection('state')}>By state</span>
      </div>
      <div className="product-tabs" style={{ marginTop: '-6px' }}>
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

      {section === 'overview' && (
        <>
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
                <tr key={s}><td><span className={'pill ' + pillClass(s)}>{s}</span></td><td>{scoped.filter(o => o.status === s).length}</td></tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Failed deliveries</h3>
          <div className="stats" style={{ marginBottom: '10px' }}>
            <div className="stat"><div className="stat-num">{failedDeliveries.length}</div><div className="stat-label">Failed delivery attempts in this range</div></div>
          </div>
          {failedDeliveries.length === 0 ? (
            <div className="empty" style={{ marginBottom: '24px' }}>No failed deliveries in this range.</div>
          ) : (
            <table style={{ marginBottom: '24px' }}>
              <thead><tr><th>Order</th><th>Customer</th><th>Staff</th><th>Dispatch</th><th>Fee</th><th>Reason</th><th>When</th></tr></thead>
              <tbody>
                {failedDeliveries.map(o => (
                  <tr key={o.id}>
                    <td className="oid">{o.serial_number ? '#' + o.serial_number : o.id.slice(0, 8)}</td>
                    <td>{o.customer}</td>
                    <td>{o.staff_id ? (profiles.find(p => p.id === o.staff_id) || {}).full_name || '—' : '—'}</td>
                    <td>{o.dispatch_id ? (profiles.find(p => p.id === o.dispatch_id) || {}).full_name || '—' : '—'}</td>
                    <td>₦{Number(o.delivery_fee || 0).toLocaleString()}</td>
                    <td style={{ fontSize: '12.5px', maxWidth: '240px' }}>{(latestRemarks && latestRemarks[o.id] && latestRemarks[o.id].note) || <span style={{ color: '#8A93A0' }}>No remark recorded</span>}</td>
                    <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(o.status_updated_at || o.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {section === 'marketing' && (
        <>
          <div className="stats" style={{ marginBottom: '18px' }}>
            <div className="stat"><div className="stat-num">₦{totalAdSpend.toLocaleString()}</div><div className="stat-label">Ad spend logged (this range)</div></div>
            <div className="stat"><div className="stat-num">₦{totalMarketingRevenue.toLocaleString()}</div><div className="stat-label">Revenue with a lead source set</div></div>
            <div className="stat"><div className="stat-num">{blendedRoas !== null ? blendedRoas.toFixed(2) + 'x' : '—'}</div><div className="stat-label">Blended ROAS</div></div>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '22px' }}>
            <div style={{ flex: '1 1 200px', background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px' }}>🏆 Best product</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{bestProduct ? bestProduct.name : '—'}</div>
              <div style={{ fontSize: '12px', color: '#8A93A0' }}>{bestProduct ? `₦${bestProduct.revenue.toLocaleString()} · ${bestProduct.delivered} delivered` : 'No delivered orders in this range yet.'}</div>
            </div>
            <div style={{ flex: '1 1 200px', background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px' }}>🏆 Best staff</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{bestStaff ? bestStaff.name : '—'}</div>
              <div style={{ fontSize: '12px', color: '#8A93A0' }}>{bestStaff ? `₦${bestStaff.revenue.toLocaleString()} · ${bestStaff.delivered} delivered` : 'No delivered orders in this range yet.'}</div>
            </div>
            <div style={{ flex: '1 1 200px', background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px' }}>🏆 Best campaign</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{bestCampaign ? bestCampaign.name : '—'}</div>
              <div style={{ fontSize: '12px', color: '#8A93A0' }}>{bestCampaign ? `₦${bestCampaign.revenue.toLocaleString()} · ${bestCampaign.delivered} delivered` : 'No landing-page orders in this range yet.'}</div>
            </div>
          </div>

          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '4px' }}>By lead source</h3>
          <p style={{ fontSize: '11.5px', color: '#8A93A0', marginBottom: '10px' }}>Ad spend is matched to a source by name from Finance → Expenses (category "Ad spend", channel field) — log spend there with a channel like "Facebook" or "TikTok" to see CAC and ROAS here.</p>
          <table style={{ marginBottom: '24px' }}>
            <thead><tr><th>Source</th><th>Orders</th><th>Delivered</th><th>Conversion</th><th>Revenue</th><th>Ad spend</th><th>CAC</th><th>ROAS</th></tr></thead>
            <tbody>
              {sourceStats.length === 0 && <tr><td colSpan="8" className="empty">No orders with a lead source, and no ad spend logged, in this range yet.</td></tr>}
              {sourceStats.map(s => (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td>{s.orders}</td>
                  <td>{s.delivered}</td>
                  <td>{s.conversion.toFixed(0)}%</td>
                  <td>₦{s.revenue.toLocaleString()}</td>
                  <td>{s.spend > 0 ? '₦' + s.spend.toLocaleString() : '—'}</td>
                  <td>{s.cac !== null ? '₦' + s.cac.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  <td>{s.roas !== null ? s.roas.toFixed(2) + 'x' : '—'}</td>
                </tr>
              ))}
              {(() => {
                const unset = scoped.filter(o => !o.lead_source);
                if (unset.length === 0) return null;
                const unsetDelivered = unset.filter(o => o.status === 'Delivered');
                const unsetRevenue = unsetDelivered.reduce((sum, o) => sum + orderTotal(o, upsellsByOrder[o.id]), 0);
                return (
                  <tr><td style={{ color: '#8A93A0' }}>Not set</td><td>{unset.length}</td><td>{unsetDelivered.length}</td><td>{unset.length ? ((unsetDelivered.length / unset.length) * 100).toFixed(0) : 0}%</td><td>₦{unsetRevenue.toLocaleString()}</td><td>—</td><td>—</td><td>—</td></tr>
                );
              })()}
            </tbody>
          </table>

          {unmatchedSpend.length > 0 && (
            <p style={{ fontSize: '11.5px', color: '#8A93A0', marginBottom: '18px' }}>
              Also logged, not matched to a lead source: {unmatchedSpend.map(([k, v]) => `${k} (₦${v.toLocaleString()})`).join(', ')}.
            </p>
          )}

          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>By campaign (landing pages)</h3>
          {campaignStats.length === 0 ? (
            <div className="empty" style={{ marginBottom: '24px' }}>No landing-page orders in this range yet.</div>
          ) : (
            <table style={{ marginBottom: '24px' }}>
              <thead><tr><th>Campaign</th><th>Product</th><th>Orders</th><th>Delivered</th><th>Conversion</th><th>Revenue</th></tr></thead>
              <tbody>
                {campaignStats.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i === 0 && '🏆 '}{c.name}</td>
                    <td>{c.product}</td>
                    <td>{c.orders}</td>
                    <td>{c.delivered}</td>
                    <td>{c.conversion.toFixed(0)}%</td>
                    <td>₦{c.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {section === 'team' && (
        <>
          <PerformanceTable title="Staff performance (top performers first)" rows={staffPerf} roleLabel="staff" />
          <PerformanceTable title="Dispatch performance (top performers first)" rows={dispatchPerf} roleLabel="dispatch partners" />
        </>
      )}

      {section === 'state' && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '0 0 10px' }}>By state</h3>
          <table>
            <thead><tr><th>State</th><th>Agents</th><th>Orders sent</th><th>Delivered</th></tr></thead>
            <tbody>
              {stateRows.length === 0 && <tr><td colSpan="4" className="empty">No dispatch agents assigned to a state yet.</td></tr>}
              {stateRows.map(([state, d]) => (
                <tr key={state}><td>{state}</td><td>{d.agents}</td><td>{d.sent}</td><td>{d.delivered}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

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
      const claimed = (cl || []).filter(c => c.status === 'Approved').reduce((sum, c) => sum + Number(c.amount), 0);
      setCommissionSummary({ earned, claimed, balance: earned - claimed });
    })();
  }, [person.id]);

  const deliveredPaid = delivered.filter(o => o.payment_status === 'Paid');
  const successRate = isDispatch
    ? (handled.length > 0 ? (delivered.length / handled.length) * 100 : 100)
    : (delivered.length > 0 ? (deliveredPaid.length / delivered.length) * 100 : 100);

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
export function SettingsPage({ settings, profiles, products, productSets, session, profile, refresh }) {
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [addingCompany, setAddingCompany] = useState(false);
  const [statePrefs, setStatePrefs] = useState({});
  const [savingState, setSavingState] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState('all_staff');
  const [historyPersonId, setHistoryPersonId] = useState('');
  const [orderSources, setOrderSources] = useState([]);
  const [editingSource, setEditingSource] = useState(null);
  const DEFAULT_CONFIRM_TEMPLATE = "Hi {customer}, we've received your order for {product} ({order_short}) and it's being processed.{track_line} — Trailblazer";
  const [confirmMessage, setConfirmMessage] = useState(settings?.auto_confirm_message || DEFAULT_CONFIRM_TEMPLATE);
  const [savingConfirmMessage, setSavingConfirmMessage] = useState(false);
  const [confirmMessageSaved, setConfirmMessageSaved] = useState(false);
  useEffect(() => { setConfirmMessage(settings?.auto_confirm_message || DEFAULT_CONFIRM_TEMPLATE); }, [settings?.auto_confirm_message]);
  async function saveConfirmMessage() {
    setSavingConfirmMessage(true);
    await supabase.from('app_settings').upsert({ key: 'auto_confirm_message', value: confirmMessage.trim() || DEFAULT_CONFIRM_TEMPLATE });
    await refresh();
    setSavingConfirmMessage(false);
    setConfirmMessageSaved(true);
    setTimeout(() => setConfirmMessageSaved(false), 2500);
  }

  const DEFAULT_REVIEW_TEMPLATE = "Hi {customer}, thanks for shopping with us! If you have a moment, we'd really appreciate a quick review: {review_link} — Trailblazer";
  const [reviewLink, setReviewLink] = useState(settings?.review_link || '');
  const [reviewMessage, setReviewMessage] = useState(settings?.review_request_message || DEFAULT_REVIEW_TEMPLATE);
  const [savingReviewSettings, setSavingReviewSettings] = useState(false);
  const [reviewSettingsSaved, setReviewSettingsSaved] = useState(false);
  useEffect(() => { setReviewLink(settings?.review_link || ''); }, [settings?.review_link]);
  useEffect(() => { setReviewMessage(settings?.review_request_message || DEFAULT_REVIEW_TEMPLATE); }, [settings?.review_request_message]);
  async function saveReviewSettings() {
    setSavingReviewSettings(true);
    await supabase.from('app_settings').upsert([
      { key: 'review_link', value: reviewLink.trim() },
      { key: 'review_request_message', value: reviewMessage.trim() || DEFAULT_REVIEW_TEMPLATE },
    ]);
    await refresh();
    setSavingReviewSettings(false);
    setReviewSettingsSaved(true);
    setTimeout(() => setReviewSettingsSaved(false), 2500);
  }

  useEffect(() => { loadOrderSources(); }, []);
  async function loadOrderSources() {
    const { data } = await supabase.from('landing_page_sources').select('*').order('created_at', { ascending: false });
    setOrderSources(data || []);
  }
  async function toggleSourceActive(s) {
    await supabase.from('landing_page_sources').update({ active: !s.active }).eq('id', s.id);
    loadOrderSources();
  }
  const [historyMessages, setHistoryMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function loadHistory(personId) {
    setHistoryPersonId(personId);
    if (!personId) { setHistoryMessages([]); return; }
    setLoadingHistory(true);
    const { data } = await supabase.from('messages').select('*').eq('recipient_id', personId).order('created_at', { ascending: false });
    setHistoryMessages(data || []);
    setLoadingHistory(false);
  }
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
    const text = notifyMessage.trim();
    await supabase.from('messages').insert(
      userIds.map(uid => ({ sender_id: profile?.id, sender_name: profile?.full_name, recipient_id: uid, body: text }))
    );
    await sendPushNotification(session, { userIds, title: 'Message from admin', body: text, url: '/dashboard' });
    setSendingNotify(false);
    setNotifyStatus(`✓ Sent to ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'} — they'll see it in Messages too.`);
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
    if (addingCompany) return; // guard against double-clicks creating duplicate companies
    if (!name.trim() || !phone.trim()) return;
    setAddingCompany(true);
    try {
      await supabase.from('dispatch_companies').insert({ name: name.trim(), contact_name: contactName.trim(), phone: phone.trim(), channel });
      setName(''); setContactName(''); setPhone('');
      loadCompanies();
    } finally {
      setAddingCompany(false);
    }
  }
  async function removeCompany(id) {
    const { error } = await supabase.from('dispatch_companies').delete().eq('id', id);
    if (error) {
      alert('Could not remove this external dispatch company — it has orders forwarded to it in the past, so deleting it would break those records. Try deactivating it instead, or clear it from any order first.');
      return;
    }
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

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Message history</h3>
      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', maxWidth: '520px', marginBottom: '22px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>View history for</label>
        <select value={historyPersonId} onChange={e => loadHistory(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }}>
          <option value="">— Choose a person —</option>
          {(profiles || []).filter(p => p.role !== 'admin').map(p => (
            <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
          ))}
        </select>
        {loadingHistory && <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p>}
        {!loadingHistory && historyPersonId && historyMessages.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>No messages sent to this person yet.</p>}
        {!loadingHistory && historyMessages.map(m => (
          <div key={m.id} style={{ borderBottom: '1px solid #F0EEE8', padding: '10px 0' }}>
            <div style={{ fontSize: '13px' }}>{m.body}</div>
            <div style={{ fontSize: '11px', color: '#8A93A0', marginTop: '4px' }}>
              Sent {new Date(m.created_at).toLocaleString()} ·{' '}
              {m.read_at ? (
                <span style={{ color: '#4F46E5' }}>Read {new Date(m.read_at).toLocaleString()}</span>
              ) : (
                <span style={{ color: '#B0483F', fontWeight: 600 }}>Unread</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Landing page order sources</h3>
      <p style={{ fontSize: '12px', color: '#8A93A0', marginBottom: '14px', maxWidth: '600px' }}>
        Connect an external landing page (via Zapier, Make, or Pabbly) so its form submissions become real orders here automatically — no manual entry, no separate queue. Each source gets its own API key.
      </p>
      <div className="list-manage" style={{ marginBottom: '14px' }}>
        {orderSources.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No landing pages connected yet.</div>}
        {orderSources.map(s => (
          <div key={s.id} className="list-manage-row">
            <span>
              {s.name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>· {(products.find(p => p.id === s.product_id) || {}).name || '—'} · {s.total_orders_received || 0} orders received{s.last_used_at ? ` · last: ${new Date(s.last_used_at).toLocaleDateString()}` : ''}</span>
              {!s.active && <span className="pill Cancelled" style={{ marginLeft: '8px' }}>Off</span>}
              {s.eligible_staff && s.eligible_staff.length > 0 && <span className="pill Preparing" style={{ marginLeft: '8px' }}>Restricted to {s.eligible_staff.length} staff</span>}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="link-btn" onClick={() => setEditingSource(s)}>Manage</button>
              <button className="btn" onClick={() => toggleSourceActive(s)}>{s.active ? 'Turn off' : 'Turn on'}</button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={() => setEditingSource({})} style={{ marginBottom: '22px' }}>+ Connect a new landing page</button>


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
      <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-10px', marginBottom: '14px' }}>
        Even with these off, you can always send a confirmation manually from the order row. These only need
        TERMII / WhatsApp keys set up in Vercel to actually send — see the README.
      </p>

      <div style={{ marginBottom: '22px' }}>
        <label style={{ marginTop: 0 }}>Auto-confirmation message</label>
        <textarea
          value={confirmMessage}
          onChange={e => setConfirmMessage(e.target.value)}
          rows={3}
          style={{ width: '100%', fontFamily: 'inherit' }}
        />
        <p style={{ fontSize: '11.5px', color: '#8A93A0', margin: '4px 0 8px' }}>
          Placeholders: <code>{'{customer}'}</code> name, <code>{'{product}'}</code> product/package/set ordered, <code>{'{order_short}'}</code> short order ID, <code>{'{track_line}'}</code> tracking sentence (blank if tracking isn't set up). This wording is used for SMS (fully free text) — WhatsApp instead sends a fixed template that Meta has pre-approved, with the same customer name, product, order ID and tracking link filled into it, so the exact phrasing there can only be changed by submitting a new template version to Meta for review.
        </p>
        <button className="btn" onClick={saveConfirmMessage} disabled={savingConfirmMessage}>
          {savingConfirmMessage ? 'Saving…' : confirmMessageSaved ? '✓ Saved' : 'Save message'}
        </button>
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Review requests</h3>
      <p style={{ fontSize: '12.5px', color: '#8A93A0', marginBottom: '10px' }}>
        "Request review" on a Delivered order sends this message by SMS (needs Termii keys) and always opens a
        pre-filled WhatsApp chat for staff to send themselves — WhatsApp's Business API can't send free-text
        messages like this without a separately Meta-approved template, so the manual link is the reliable option
        here.
      </p>
      <div style={{ marginBottom: '14px' }}>
        <label style={{ marginTop: 0 }}>Review link</label>
        <input value={reviewLink} onChange={e => setReviewLink(e.target.value)} placeholder="https://g.page/r/your-business/review" />
      </div>
      <div style={{ marginBottom: '22px' }}>
        <label>Review request message</label>
        <textarea
          value={reviewMessage}
          onChange={e => setReviewMessage(e.target.value)}
          rows={3}
          style={{ width: '100%', fontFamily: 'inherit' }}
        />
        <p style={{ fontSize: '11.5px', color: '#8A93A0', margin: '4px 0 8px' }}>
          Placeholders: <code>{'{customer}'}</code> name, <code>{'{review_link}'}</code> the link above.
        </p>
        <button className="btn" onClick={saveReviewSettings} disabled={savingReviewSettings}>
          {savingReviewSettings ? 'Saving…' : reviewSettingsSaved ? '✓ Saved' : 'Save message'}
        </button>
      </div>

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
            <span>
              {c.name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>· {c.contact_name} · {c.phone} · {c.channel}</span>
              {c.active === false && <span className="pill Cancelled" style={{ marginLeft: '8px' }}>Off</span>}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn" onClick={async () => { await supabase.from('dispatch_companies').update({ active: c.active === false }).eq('id', c.id); loadCompanies(); }}>
                {c.active === false ? 'Turn on' : 'Turn off'}
              </button>
              <button className="tiny-x" onClick={() => removeCompany(c.id)}>Remove</button>
            </div>
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
        <button className="btn primary" onClick={addCompany} disabled={addingCompany} style={{ width: '100%' }}>{addingCompany ? 'Adding…' : 'Add company'}</button>
      </div>
      {editingSource && (
        <OrderSourceModal
          source={editingSource} products={products} productSets={productSets} profiles={profiles}
          onClose={() => { setEditingSource(null); loadOrderSources(); }}
        />
      )}
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
                  <td><span className={'pill ' + pillClass(o.status)}>{o.status}</span></td>
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
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return; // guard against double-clicks creating duplicate orders
    if (!customer.trim() || !productId) { setMsg('Fill in a customer name and product.'); return; }
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_quantity <= 0) { setMsg('That product is out of stock — ask admin to restock before submitting.'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('orders').insert({
        product_id: productId, customer: customer.trim(), phone: phone.trim(), address: address.trim(),
        quantity: parseInt(quantity, 10) || 1, notes: notes.trim(), created_by: profile.id,
      }).select().single();
      if (error) { setMsg(error.message); return; }
      await logEvent({ order_id: data.id, actor_id: profile.id, actor_name: profile.full_name, event_type: 'created', note: `Submitted by ${profile.full_name} (${profile.role})` });
      setCustomer(''); setPhone(''); setAddress(''); setQuantity(1); setNotes('');
      setMsg('Order submitted — admin will review and assign it.');
      refresh();
    } finally {
      setSubmitting(false);
    }
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
      <button className="btn primary" onClick={submit} disabled={submitting} style={{ width: '100%' }}>{submitting ? 'Submitting…' : 'Submit order'}</button>
      {msg && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '10px' }}>{msg}</p>}
    </div>
  );
}

// ---------- Product packages (multiple named gift bundles per product) ----------
export function CommissionRuleModal({ product, set, profiles, onClose }) {
  // Either a product or a set — set_id and product_id are mutually exclusive
  // on commission_rules, mirroring how orders themselves work.
  const isSet = !product && !!set;
  const targetName = isSet ? set.name : product.name;
  const conflictColumn = isSet ? 'set_id' : 'product_id';

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
    const { data } = await supabase.from('commission_rules').select('*').eq(conflictColumn, isSet ? set.id : product.id).maybeSingle();
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
      product_id: isSet ? null : product.id,
      set_id: isSet ? set.id : null,
      standard_active: standardActive, standard_type: standardType, standard_value: parseFloat(standardValue) || 0,
      upsell_active: upsellActive, upsell_type: upsellType, upsell_value: parseFloat(upsellValue) || 0,
      eligible_staff: eligibleStaff.length > 0 ? eligibleStaff : null,
    };
    await supabase.from('commission_rules').upsert(payload, { onConflict: conflictColumn });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Commission · {targetName}</h3>
        {loading ? <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p> : (
          <>
            <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginTop: '0', marginBottom: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, fontWeight: 600 }}>
                Standard commission
                <span>
                  <input type="checkbox" checked={standardActive} onChange={e => setStandardActive(e.target.checked)} /> On
                </span>
              </label>
              <p style={{ fontSize: '11px', color: '#8A93A0', margin: '4px 0 10px' }}>Earned on every Paid order for this {isSet ? 'set' : 'product'}.</p>
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

            <label style={{ marginTop: 0 }}>Which staff can earn this? (for this {isSet ? 'set' : 'product'})</label>
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
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('product_packages').select('*').eq('product_id', product.id).order('created_at');
    setPackages(data || []);
    setLoading(false);
  }

  async function addPackage() {
    if (adding) return; // guard against double-clicks creating duplicate packages
    if (!name.trim()) return;
    setAdding(true);
    try {
      await supabase.from('product_packages').insert({
        product_id: product.id, name: name.trim(),
        price: price === '' ? null : parseFloat(price),
        external_ref: externalRef.trim() || null,
        gift_product_id: giftProductId || null,
        gift_quantity: giftProductId ? (parseInt(giftQuantity, 10) || 0) : 0,
      });
      setName(''); setPrice(''); setExternalRef(''); setGiftProductId(''); setGiftQuantity(1);
      load();
    } finally {
      setAdding(false);
    }
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
          <button className="btn primary" onClick={addPackage} disabled={adding}>{adding ? 'Adding…' : 'Add package'}</button>
        </div>
      </div>
    </div>
  );
}


export function ProductCategoriesPage({ categories, products, refresh }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [renameEdits, setRenameEdits] = useState({});

  async function add() {
    if (adding || !name.trim()) return;
    setAdding(true);
    setError('');
    try {
      const { error: err } = await supabase.from('product_categories').insert({ name: name.trim() });
      if (err) { setError(err.code === '23505' ? 'A category with that name already exists.' : err.message); return; }
      setName('');
      refresh();
    } finally {
      setAdding(false);
    }
  }

  async function rename(cat) {
    const val = (renameEdits[cat.id] ?? '').trim();
    if (!val || val === cat.name) { setRenameEdits({ ...renameEdits, [cat.id]: undefined }); return; }
    const { error: err } = await supabase.from('product_categories').update({ name: val }).eq('id', cat.id);
    if (err) { alert(err.code === '23505' ? 'A category with that name already exists.' : err.message); return; }
    setRenameEdits({ ...renameEdits, [cat.id]: undefined });
    refresh();
  }

  async function remove(cat) {
    const { error: err } = await supabase.from('product_categories').delete().eq('id', cat.id);
    if (err) { alert('Could not remove this category — remove or reassign its products first.'); return; }
    refresh();
  }

  return (
    <div>
      <div className="topbar" style={{ borderLeft: '4px solid #8E24AA', paddingLeft: '14px' }}>
        <div><h1 className="page-title">Categories</h1><p className="page-sub">Group products for organization and reporting — assign a category to each product from the Products tab.</p></div>
      </div>
      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {categories.map(cat => {
          const count = products.filter(p => p.category_id === cat.id).length;
          return (
            <div key={cat.id} className="list-manage-row">
              <span>
                <input
                  type="text"
                  value={renameEdits[cat.id] ?? cat.name}
                  onChange={e => setRenameEdits({ ...renameEdits, [cat.id]: e.target.value })}
                  style={{ fontSize: '13px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px', minWidth: '160px' }}
                />
                <span style={{ color: '#8A93A0', fontSize: '11.5px', marginLeft: '8px' }}>· {count} product{count !== 1 ? 's' : ''}</span>
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="link-btn" onClick={() => rename(cat)}>Save</button>
                <button className="tiny-x" onClick={() => remove(cat)}>Remove</button>
              </div>
            </div>
          );
        })}
        {categories.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No categories yet.</div>}
      </div>
      <div className="row2" style={{ maxWidth: '420px' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New category name" />
        <button className="btn primary" onClick={add} disabled={adding} style={{ flex: '0 0 auto' }}>{adding ? 'Adding…' : 'Add category'}</button>
      </div>
      {error && <p style={{ fontSize: '11.5px', color: '#B0483F', marginTop: '6px' }}>{error}</p>}
    </div>
  );
}

export function ProductVariantsModal({ product, onClose }) {
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('product_variants').select('*').eq('product_id', product.id).order('created_at');
    setVariants(data || []);
    setLoading(false);
  }

  async function addVariant() {
    if (adding) return; // guard against double-clicks creating duplicate variants
    if (!size.trim() && !color.trim()) { setError('Give this variant a size, a color, or both.'); return; }
    setAdding(true);
    setError('');
    try {
      const { error: err } = await supabase.from('product_variants').insert({
        product_id: product.id,
        size: size.trim() || null,
        color: color.trim() || null,
        sku: sku.trim() || null,
        price: price === '' ? null : parseFloat(price),
        stock_quantity: parseInt(stock, 10) || 0,
      });
      if (err) { setError(err.code === '23505' ? 'That code is already used by another variant — pick a different one.' : err.message); return; }
      setSize(''); setColor(''); setSku(''); setPrice(''); setStock('0');
      load();
    } finally {
      setAdding(false);
    }
  }

  async function removeVariant(id) {
    await supabase.from('product_variants').delete().eq('id', id);
    load();
  }

  async function toggleActive(v) {
    await supabase.from('product_variants').update({ active: !v.active }).eq('id', v.id);
    load();
  }

  function variantLabel(v) {
    return [v.size, v.color].filter(Boolean).join(' / ') || 'Default';
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Variants · {product.name}</h3>
        <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-8px', marginBottom: '14px' }}>
          Add a row for each size/color combination this product comes in, with its own code, price
          (optional — falls back to the product's default price when blank), and stock count.
        </p>
        {loading ? <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p> : (
          <div className="list-manage" style={{ marginBottom: '16px' }}>
            {variants.map(v => (
              <div key={v.id} className="list-manage-row">
                <span>
                  {variantLabel(v)}{' '}
                  {v.sku && <span className="pill" style={{ background: '#EEF2F8', color: '#4A7FBF', border: '1px solid #D6E0EE', fontFamily: 'monospace', fontSize: '11px' }}>{v.sku}</span>}
                  {' '}<span style={{ color: '#8A93A0', fontSize: '11.5px' }}>
                    {v.price != null ? `· ₦${Number(v.price).toLocaleString()}` : ''} · {v.stock_quantity} in stock
                  </span>
                  {!v.active && <span className="pill Cancelled" style={{ marginLeft: '8px' }}>Off</span>}
                </span>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="link-btn" onClick={() => toggleActive(v)}>{v.active ? 'Turn off' : 'Turn on'}</button>
                  <button className="tiny-x" onClick={() => removeVariant(v.id)}>Remove</button>
                </div>
              </div>
            ))}
            {variants.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No variants yet — this product sells as a single plain item.</div>}
          </div>
        )}
        <div className="row2">
          <div><label style={{ marginTop: 0 }}>Size (optional)</label><input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. Small, 250ml" /></div>
          <div><label style={{ marginTop: 0 }}>Color (optional)</label><input value={color} onChange={e => setColor(e.target.value)} placeholder="e.g. Red" /></div>
        </div>
        <label>Code / SKU (optional)</label>
        <input value={sku} onChange={e => setSku(e.target.value)} placeholder="Unique code for this variant" style={{ fontFamily: 'monospace' }} />
        <div className="row2">
          <div><label>Price override (₦, optional)</label><input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="Uses product default if blank" /></div>
          <div><label>Starting stock</label><input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} /></div>
        </div>
        {error && <p style={{ fontSize: '11.5px', color: '#B0483F' }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={addVariant} disabled={adding}>{adding ? 'Adding…' : 'Add variant'}</button>
        </div>
      </div>
    </div>
  );
}

// Orders still in the pipeline (not yet Delivered or Cancelled) have
// already committed stock even though it hasn't left the warehouse yet —
// this is what "reserved" means throughout the inventory subsystem.
const RESERVING_STATUSES = STATUSES.filter(s => s !== 'Delivered' && s !== 'Cancelled');

function reservedFor(orders, productId) {
  return orders
    .filter(o => o.product_id === productId && RESERVING_STATUSES.includes(o.status))
    .reduce((sum, o) => sum + (o.quantity || 1), 0);
}

export function ReceiveStockModal({ products, suppliers, onClose, refresh }) {
  const [productId, setProductId] = useState(products[0]?.id || '');
  const [quantity, setQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!productId || !qty || qty <= 0) { setError('Pick a product and a quantity greater than 0.'); return; }
    setSaving(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('adjust_stock', {
        p_product_id: productId, p_delta: qty, p_movement_type: 'received',
        p_reason: note.trim() || 'Stock received', p_supplier_id: supplierId || null,
      });
      if (err) { setError(err.message); return; }
      refresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Receive stock</h3>
        <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-8px', marginBottom: '14px' }}>Log new stock coming in, optionally against a supplier on file.</p>
        <label style={{ marginTop: 0 }}>Product</label>
        <select value={productId} onChange={e => setProductId(e.target.value)}>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label>Quantity received</label>
        <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 50" />
        <label>Supplier (optional)</label>
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">No supplier on file</option>
          {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label>Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. invoice number" />
        {error && <p style={{ fontSize: '11.5px', color: '#B0483F' }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Log stock received'}</button>
        </div>
      </div>
    </div>
  );
}

export function ReportDamageModal({ products, onClose, refresh }) {
  const [productId, setProductId] = useState(products[0]?.id || '');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!productId || !qty || qty <= 0) { setError('Pick a product and a quantity greater than 0.'); return; }
    setSaving(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('adjust_stock', {
        p_product_id: productId, p_delta: -qty, p_movement_type: 'damaged',
        p_reason: note.trim() || 'Damaged / lost stock',
      });
      if (err) { setError(err.message); return; }
      refresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Report damaged or lost stock</h3>
        <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-8px', marginBottom: '14px' }}>Write off stock that's damaged, expired, or missing — this removes it from what's countable as available.</p>
        <label style={{ marginTop: 0 }}>Product</label>
        <select value={productId} onChange={e => setProductId(e.target.value)}>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label>Quantity to write off</label>
        <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 3" />
        <label>Reason (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. water damage in storage" />
        {error && <p style={{ fontSize: '11.5px', color: '#B0483F' }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Write off stock'}</button>
        </div>
      </div>
    </div>
  );
}

export function SuppliersPage({ suppliers, refresh }) {
  const [editing, setEditing] = useState(null); // {} for new, or a supplier row
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function startEdit(s) {
    setEditing(s || {});
    setName(s?.name || ''); setContactName(s?.contact_name || ''); setPhone(s?.phone || ''); setEmail(s?.email || ''); setNotes(s?.notes || '');
    setError('');
  }

  async function save() {
    if (!name.trim()) { setError('Give this supplier a name.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { name: name.trim(), contact_name: contactName.trim() || null, phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null };
      const { error: err } = editing.id
        ? await supabase.from('suppliers').update(payload).eq('id', editing.id)
        : await supabase.from('suppliers').insert(payload);
      if (err) { setError(err.message); return; }
      setEditing(null);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    const { error: err } = await supabase.from('suppliers').delete().eq('id', s.id);
    if (err) { alert('Could not remove this supplier — it already has stock receipts logged against it.'); return; }
    refresh();
  }

  return (
    <div>
      <div className="topbar" style={{ borderLeft: '4px solid #C6862F', paddingLeft: '14px' }}>
        <div><h1 className="page-title">Suppliers</h1><p className="page-sub">Keep a contact record for everyone you buy stock from — pick one when logging received stock.</p></div>
        <button className="btn primary" onClick={() => startEdit(null)}>+ New supplier</button>
      </div>
      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {suppliers.map(s => (
          <div key={s.id} className="list-manage-row">
            <span>
              <strong>{s.name}</strong>{' '}
              <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>
                {[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details on file'}
              </span>
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="link-btn" onClick={() => startEdit(s)}>Edit</button>
              <button className="tiny-x" onClick={() => remove(s)}>Remove</button>
            </div>
          </div>
        ))}
        {suppliers.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No suppliers yet.</div>}
      </div>
      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing.id ? 'Edit supplier' : 'New supplier'}</h3>
            <label style={{ marginTop: 0 }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Company or person" />
            <label>Contact name (optional)</label>
            <input value={contactName} onChange={e => setContactName(e.target.value)} />
            <label>Phone (optional)</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="080..." />
            <label>Email (optional)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} />
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} />
            {error && <p style={{ fontSize: '11.5px', color: '#B0483F' }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save supplier'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function InventoryPage({ products, orders, profiles, agentStock, suppliers, refresh }) {
  const [exactEdits, setExactEdits] = useState({});
  const [addAmounts, setAddAmounts] = useState({});
  const [movements, setMovements] = useState([]);
  const [movementFilter, setMovementFilter] = useState('all');
  const [receiving, setReceiving] = useState(false);
  const [reportingDamage, setReportingDamage] = useState(false);

  useEffect(() => { loadMovements(); }, []);
  async function loadMovements() {
    const { data } = await supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(80);
    setMovements(data || []);
  }

  async function addStock(p) {
    const amt = parseInt(addAmounts[p.id], 10);
    if (!amt || amt <= 0) return;
    await supabase.rpc('adjust_stock', { p_product_id: p.id, p_delta: amt });
    setAddAmounts({ ...addAmounts, [p.id]: '' });
    refresh();
    loadMovements();
  }
  async function subtractStock(p) {
    const amt = parseInt(addAmounts[p.id], 10);
    if (!amt || amt <= 0) return;
    await supabase.rpc('adjust_stock', { p_product_id: p.id, p_delta: -amt });
    setAddAmounts({ ...addAmounts, [p.id]: '' });
    refresh();
    loadMovements();
  }
  async function setExact(p) {
    const val = parseInt(exactEdits[p.id], 10);
    if (isNaN(val)) return;
    const delta = Math.max(0, val) - p.stock_quantity;
    if (delta !== 0) await supabase.rpc('adjust_stock', { p_product_id: p.id, p_delta: delta });
    setExactEdits({ ...exactEdits, [p.id]: '' });
    refresh();
    loadMovements();
  }
  async function setThreshold(p, val) {
    const t = parseInt(val, 10);
    if (isNaN(t)) return;
    await supabase.from('products').update({ low_stock_threshold: Math.max(0, t) }).eq('id', p.id);
    refresh();
  }

  const MOVEMENT_LABELS = { received: 'Received', sold: 'Sold', returned: 'Returned', damaged: 'Damaged', transfer: 'Agent transfer', adjustment: 'Manual adjustment' };
  const MOVEMENT_COLORS = { received: '#2E7D32', sold: '#4A7FBF', returned: '#8A5EBF', damaged: '#B0483F', transfer: '#C6862F', adjustment: '#8A93A0' };
  const filteredMovements = movementFilter === 'all' ? movements : movements.filter(m => (m.movement_type || 'adjustment') === movementFilter);

  return (
    <div>
      <div className="topbar" style={{ borderLeft: '4px solid #4A9B6E', paddingLeft: '14px' }}>
        <div><h1 className="page-title">Inventory</h1><p className="page-sub">Stock automatically drops as orders are delivered and comes back if a delivered order is reversed. "Reserved" is what's already committed to orders still in progress — "Available" is what's actually free to promise a new customer.</p></div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setReceiving(true)}>+ Receive stock</button>
          <button className="btn" onClick={() => setReportingDamage(true)}>Report damaged/lost</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Product</th><th>In stock</th><th>Reserved</th><th>Available</th><th>Low stock alert below</th><th>Add / subtract quantity</th><th>Set exact</th></tr></thead>
        <tbody>
          {products.map(p => {
            const reserved = reservedFor(orders, p.id);
            const available = Math.max(0, p.stock_quantity - reserved);
            const outOfStock = available <= 0;
            const low = !outOfStock && available <= p.low_stock_threshold;
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.stock_quantity} units</td>
                <td style={{ color: reserved > 0 ? '#8A93A0' : undefined }}>{reserved}</td>
                <td>
                  <span className={outOfStock ? 'pill Cancelled' : low ? 'pill New' : 'pill Delivered'}>
                    {available} {outOfStock ? '— OUT OF STOCK' : low ? '— LOW' : ''}
                  </span>
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
          {products.length === 0 && <tr><td colSpan="7" className="empty">Add products first.</td></tr>}
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
            {Object.entries(byState).map(([state, agents], stateIdx) => {
              const stateColors = ['#4A7FBF', '#4A9B6E', '#C6862F', '#8A5EBF', '#BF5E6E', '#5EA3BF'];
              const accent = stateColors[stateIdx % stateColors.length];
              return (
              <div key={state} style={{ marginBottom: '20px', borderLeft: `4px solid ${accent}`, paddingLeft: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>{state}{agents.length > 1 ? ` (${agents.length} agents)` : ''}</div>
                <table>
                  <thead><tr><th>Agent</th>{products.map((p, pIdx) => <th key={p.id}><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: ['#4A7FBF', '#4A9B6E', '#C6862F', '#8A5EBF', '#BF5E6E', '#5EA3BF'][pIdx % 6], marginRight: '5px' }}></span>{p.name}</th>)}</tr></thead>
                  <tbody>
                    {agents.map((a, agentIdx) => (
                      <tr key={a.id} style={{ background: agentIdx % 2 === 1 ? '#FAF8F4' : undefined }}>
                        <td>{a.full_name}</td>
                        {products.map(p => {
                          const row = agentStock.find(s => s.agent_id === a.id && s.product_id === p.id);
                          const qty = row ? row.quantity : 0;
                          const threshold = row?.low_stock_threshold;
                          const isLow = threshold != null && qty <= threshold;
                          return <td key={p.id} style={isLow ? { color: '#B0483F', fontWeight: 700 } : {}}>{qty}{isLow ? ' — LOW' : ''}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );})}
          </>
        );
      })()}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '28px 0 10px', flexWrap: 'wrap', gap: '10px' }}>
        <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: 0 }}>Recent stock activity</h3>
        <select value={movementFilter} onChange={e => setMovementFilter(e.target.value)} style={{ fontSize: '12px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
          <option value="all">All types</option>
          {Object.entries(MOVEMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Change</th><th>Reason</th></tr></thead>
        <tbody>
          {filteredMovements.length === 0 && <tr><td colSpan="5" className="empty">No stock changes recorded yet.</td></tr>}
          {filteredMovements.map(m => {
            const prod = products.find(p => p.id === m.product_id);
            const type = m.movement_type || 'adjustment';
            return (
              <tr key={m.id}>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(m.created_at).toLocaleString()}</td>
                <td>{prod ? prod.name : '—'}{m.agent_id ? ' (agent)' : ''}</td>
                <td><span className="pill" style={{ background: MOVEMENT_COLORS[type] + '22', color: MOVEMENT_COLORS[type] }}>{MOVEMENT_LABELS[type] || type}</span></td>
                <td><span className={'pill ' + (m.delta >= 0 ? 'Delivered' : 'Cancelled')}>{m.delta >= 0 ? '+' : ''}{m.delta}</span></td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{m.reason || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {receiving && <ReceiveStockModal products={products} suppliers={suppliers || []} onClose={() => setReceiving(false)} refresh={() => { refresh(); loadMovements(); }} />}
      {reportingDamage && <ReportDamageModal products={products} onClose={() => setReportingDamage(false)} refresh={() => { refresh(); loadMovements(); }} />}
    </div>
  );
}

// ---------- Order history / remarks ----------
export function OrderHistoryModal({ order, products, productSets, profile, onClose, onLogged }) {
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
  const setNm = id => id ? ((productSets || []).find(s => s.id === id) || {}).name || '—' : '—';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Order history · {order.customer}</h3>
        {upsells.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#8A93A0', marginBottom: '6px' }}>UPSELLS ON THIS ORDER</div>
            {upsells.map(u => (
              <div key={u.id} style={{ fontSize: '12.5px', background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' }}>
                +{u.additional_quantity} {u.upsell_set_id ? `📦 ${setNm(u.upsell_set_id)}` : prodName(u.upsell_product_id)} · ₦{Number(u.upsell_amount).toLocaleString()} · <span style={{ color: '#8A93A0' }}>{u.commission_status}</span>
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
// Automatic customer classification — layered badges, not mutually exclusive
// (a customer can be both "Returning" and "VIP" and "COD Customer" at once).
// Thresholds are business heuristics, not exact science — tune here if the
// mix of badges customers get doesn't feel right in practice.
function classifyCustomer(stats) {
  const { totalOrders, deliveredCount, cancelledCount, returnedCount, totalSpent, lastOrderDate, codCount, prepaidCount } = stats;
  const badges = [];

  // Lifecycle stage — always exactly one of these two.
  if (totalOrders <= 1) {
    badges.push({ label: 'New Customer', color: '#4F46E5' });
  } else {
    badges.push({ label: 'Returning Customer', color: '#2E7D32' });
  }
  if (totalOrders === 1 && deliveredCount === 1) {
    badges.push({ label: 'First-Time Buyer', color: '#0277BD' });
  }

  // Value tiers.
  if (deliveredCount >= 5) badges.push({ label: 'VIP Customer', color: '#B8860B' });
  if (totalSpent >= 200000) badges.push({ label: 'High Value Customer', color: '#8E24AA' });

  // Recency / risk.
  const daysSinceLastOrder = lastOrderDate ? Math.floor((Date.now() - new Date(lastOrderDate).getTime()) / 86400000) : null;
  if (daysSinceLastOrder != null && totalOrders >= 2) {
    if (daysSinceLastOrder >= 120) {
      badges.push({ label: 'Inactive Customer', color: '#78716C' });
    } else if (daysSinceLastOrder >= 60) {
      badges.push({ label: 'At-Risk Customer', color: '#D2691E' });
    }
  }

  // Payment behavior.
  if (totalOrders > 0) {
    if (codCount / totalOrders >= 0.7) badges.push({ label: 'COD Customer', color: '#0E7490' });
    if (prepaidCount / totalOrders >= 0.7) badges.push({ label: 'Prepaid Customer', color: '#15803D' });
  }

  // Cancellation / return patterns.
  if (totalOrders >= 2 && cancelledCount / totalOrders >= 0.3) {
    badges.push({ label: 'Frequent Canceller', color: '#B0483F' });
  }
  if (totalOrders >= 2 && returnedCount / totalOrders >= 0.3) {
    badges.push({ label: 'Frequent Returner', color: '#B0483F' });
  }

  return badges;
}

export function CustomerHistoryModal({ phone, customer, orders, products, packages, productSets, upsellsByOrder, onClose }) {
  const history = orders
    .filter(o => o.phone && phone && o.phone.trim() === phone.trim())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const pkgName = id => (packages || []).find(p => p.id === id)?.name || null;
  const setName = id => (productSets || []).find(s => s.id === id)?.name || null;
  const itemName = o => (o.set_id ? (setName(o.set_id) || '—') : o.package_id ? (pkgName(o.package_id) || prodName(o.product_id)) : prodName(o.product_id));

  const totalOrders = history.length;
  const deliveredOrders = history.filter(o => o.status === 'Delivered');
  const cancelledOrders = history.filter(o => o.status === 'Cancelled');
  const returnedOrders = []; // Returns & Refunds module not built yet — always 0 for now.
  const codOrders = history.filter(o => (o.payment_method || 'COD') === 'COD');
  const prepaidOrders = history.filter(o => o.payment_method === 'Prepaid');
  const totalSpent = deliveredOrders.reduce((sum, o) => sum + getCurrentPackage(o, upsellsByOrder && upsellsByOrder[o.id]).amount, 0);
  const firstOrderDate = totalOrders > 0 ? history[history.length - 1].created_at : null;
  const lastOrderDate = totalOrders > 0 ? history[0].created_at : null;
  const daysSinceLastOrder = lastOrderDate ? Math.floor((Date.now() - new Date(lastOrderDate).getTime()) / 86400000) : null;

  const itemCounts = {};
  history.forEach(o => { const name = itemName(o); itemCounts[name] = (itemCounts[name] || 0) + 1; });
  const preferredEntry = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0];
  const productsPurchased = [...new Set(history.map(itemName))];

  const badges = classifyCustomer({
    totalOrders, deliveredCount: deliveredOrders.length, cancelledCount: cancelledOrders.length,
    returnedCount: returnedOrders.length, totalSpent, lastOrderDate,
    codCount: codOrders.length, prepaidCount: prepaidOrders.length,
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <h3>{customer} · customer history</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '4px 0 14px' }}>
          {badges.map(b => (
            <span key={b.label} style={{ fontSize: '11px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px', color: '#fff', background: b.color }}>{b.label}</span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
          <div className="stat" style={{ padding: '10px' }}><div className="stat-num" style={{ fontSize: '18px' }}>{totalOrders}</div><div className="stat-label">Total orders</div></div>
          <div className="stat" style={{ padding: '10px' }}><div className="stat-num" style={{ fontSize: '18px' }}>₦{totalSpent.toLocaleString()}</div><div className="stat-label">Total spent</div></div>
          <div className="stat" style={{ padding: '10px' }}><div className="stat-num" style={{ fontSize: '18px' }}>{deliveredOrders.length}</div><div className="stat-label">Successful deliveries</div></div>
          <div className="stat" style={{ padding: '10px' }}><div className="stat-num" style={{ fontSize: '18px' }}>{cancelledOrders.length}</div><div className="stat-label">Cancelled</div></div>
        </div>
        <div style={{ fontSize: '12px', color: '#5B6472', marginBottom: '14px', lineHeight: 1.7 }}>
          <div>First order: {firstOrderDate ? new Date(firstOrderDate).toLocaleDateString() : '—'}</div>
          <div>Last order: {lastOrderDate ? new Date(lastOrderDate).toLocaleDateString() : '—'}{daysSinceLastOrder != null ? ` (${daysSinceLastOrder}d ago)` : ''}</div>
          <div>Preferred item: {preferredEntry ? `${preferredEntry[0]} (×${preferredEntry[1]})` : '—'}</div>
          <div>Products purchased: {productsPurchased.length > 0 ? productsPurchased.join(', ') : '—'}</div>
        </div>
        <div style={{ maxHeight: '260px', overflowY: 'auto', borderTop: '1px solid #DEDAD0', paddingTop: '10px' }}>
          {history.map(o => (
            <div key={o.id} style={{ borderBottom: '1px solid #DEDAD0', padding: '10px 0', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{itemName(o)} × {o.quantity || 1}</span>
                <span className={'pill ' + pillClass(o.status)}>{o.status}</span>
              </div>
              <div style={{ color: '#8A93A0', fontSize: '11.5px' }}>{new Date(o.created_at).toLocaleDateString()} · {o.payment_status} · {o.payment_method || 'COD'}</div>
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

export { STATUSES, STAFF_ASSIGNABLE_STATUSES };

// ---------- Commission: staff-facing gamified board ----------
export function CommissionPage({ profile, orders, products, session }) {
  const [ledger, setLedger] = useState([]);
  const [claims, setClaims] = useState([]);
  const [threshold, setThreshold] = useState(0);
  const [claimFrequency, setClaimFrequency] = useState('weekly');
  const [claimDay, setClaimDay] = useState(1);
  const [claimDayOfMonth, setClaimDayOfMonth] = useState(1);
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState('');
  const [myEligibleUpsells, setMyEligibleUpsells] = useState([]);
  const [approvingId, setApprovingId] = useState(null);

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: led }, { data: cl }, { data: rateSetting }, { data: daySetting }, { data: freqSetting }, { data: domSetting }, { data: windowSetting }, { data: myUpsells }] = await Promise.all([
      supabase.from('commission_ledger').select('*').eq('staff_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('commission_claims').select('*').eq('staff_id', profile.id).order('claimed_at', { ascending: false }),
      supabase.from('app_settings').select('*').eq('key', 'min_success_rate_to_claim').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_frequency').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day_of_month').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'success_rate_window_days').maybeSingle(),
      supabase.from('upsells').select('*').eq('staff_id', profile.id).eq('commission_status', 'Eligible').order('created_at', { ascending: false }),
    ]);
    setLedger(led || []);
    setClaims(cl || []);
    setThreshold(rateSetting ? parseFloat(rateSetting.value) || 0 : 0);
    setClaimDay(daySetting ? parseInt(daySetting.value, 10) : 1);
    setClaimFrequency(freqSetting && freqSetting.value === 'monthly' ? 'monthly' : 'weekly');
    setClaimDayOfMonth(domSetting ? parseInt(domSetting.value, 10) || 1 : 1);
    setWindowDays(windowSetting ? parseInt(windowSetting.value, 10) || 30 : 30);
    let upsellsWithRules = myUpsells || [];
    const ruleIds = [...new Set(upsellsWithRules.map(u => u.commission_rule_id).filter(Boolean))];
    if (ruleIds.length > 0) {
      const { data: rules } = await supabase.from('upsell_commission_rules').select('*').in('id', ruleIds);
      const ruleMap = {};
      (rules || []).forEach(r => { ruleMap[r.id] = r; });
      upsellsWithRules = upsellsWithRules.map(u => ({ ...u, _rule: u.commission_rule_id ? ruleMap[u.commission_rule_id] : null }));
    }
    setMyEligibleUpsells(upsellsWithRules);
    setLoading(false);
  }

  async function selfApprove(u) {
    setApprovingId(u.id);
    const { error } = await supabase.rpc('staff_approve_own_upsell', { p_upsell_id: u.id });
    setApprovingId(null);
    if (error) { alert('Unable to approve this right now.'); return; }
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
    if (admins && admins.length > 0) {
      notifyUsers(session, {
        userIds: admins.map(a => a.id), type: 'upsell_auto_approved', title: 'Upsell auto-approved by staff',
        body: `${profile.full_name} auto-approved their own commission (₦${Number(u.commission_amount).toLocaleString()}) on an eligible upgrade.`,
        orderId: u.original_order_id,
      });
    }
    load();
  }

  const myOrders = orders.filter(o => o.staff_id === profile.id);
  const rateInfo = computeSuccessRate(orders, profile.id, windowDays, profile.success_rate_window_enabled);
  const successRate = rateInfo.rate;
  const myDelivered = { length: rateInfo.delivered };
  const myDeliveredPaid = { length: rateInfo.deliveredPaid };
  const eligible = successRate >= threshold;
  const isClaimDay = claimFrequency === 'monthly' ? new Date().getDate() === claimDayOfMonth : new Date().getDay() === claimDay;
  const claimOpensLabel = claimFrequency === 'monthly' ? `the ${ordinal(claimDayOfMonth)} of each month` : DAY_NAMES[claimDay];

  const earned = ledger.filter(l => !l.reversed).reduce((sum, l) => sum + Number(l.amount), 0);
  const claimed = claims.filter(c => c.status === 'Approved').reduce((sum, c) => sum + Number(c.amount), 0);
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

  const pendingClaim = claims.find(c => c.status === 'Pending');

  async function claim() {
    if (!isClaimDay || !eligible || balance <= 0 || pendingClaim) return;
    setClaiming(true);
    await supabase.from('commission_claims').insert({ staff_id: profile.id, amount: balance, status: 'Pending' });
    setClaiming(false);
    setMsg(`✓ Claim requested for ₦${balance.toLocaleString()} — admin will review and approve once you've been paid.`);
    load();
  }

  if (loading) return <div className="loading">Loading your commission…</div>;

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">My Commission</h1><p className="page-sub">Earned automatically every time one of your orders gets paid.</p></div>
      </div>

      <div style={{ background: 'linear-gradient(135deg, #3730A3, #4F46E5)', borderRadius: '12px', padding: '28px', color: '#fff', marginBottom: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '12.5px', opacity: 0.85, marginBottom: '6px', letterSpacing: '.5px' }}>YOUR UNCLAIMED BALANCE</div>
        <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '42px', fontWeight: 700 }}>₦{balance.toLocaleString()}</div>
        <div style={{ fontSize: '12.5px', opacity: 0.85, marginTop: '6px' }}>₦{thisWeekTotal.toLocaleString()} earned this week so far</div>
        {freeTotal > 0 && <div style={{ fontSize: '11.5px', opacity: 0.75, marginTop: '2px' }}>Includes ₦{freeTotal.toLocaleString()} in per-order bonus commission</div>}
        <div style={{ marginTop: '18px' }}>
          {pendingClaim ? (
            <span style={{ fontSize: '12.5px', background: 'rgba(255,255,255,.15)', padding: '8px 16px', borderRadius: '20px' }}>⏳ ₦{Number(pendingClaim.amount).toLocaleString()} claim requested — waiting on admin approval</span>
          ) : balance <= 0 ? (
            <span style={{ fontSize: '12.5px', opacity: 0.75 }}>Deliver more Paid orders to start earning towards your next claim.</span>
          ) : !eligible ? (
            <span style={{ fontSize: '12.5px', background: 'rgba(255,255,255,.15)', padding: '8px 16px', borderRadius: '20px' }}>Keep your delivery success rate up to unlock claiming</span>
          ) : !isClaimDay ? (
            <span style={{ fontSize: '12.5px', background: 'rgba(255,255,255,.15)', padding: '8px 16px', borderRadius: '20px' }}>✓ Eligible — claim opens {claimOpensLabel}</span>
          ) : (
            <button className="btn primary" onClick={claim} disabled={claiming} style={{ background: '#fff', color: '#3730A3', fontWeight: 700, padding: '11px 28px', fontSize: '14px' }}>
              {claiming ? 'Claiming…' : '🎉 Claim your commission now'}
            </button>
          )}
        </div>
        {msg && <p style={{ fontSize: '12.5px', marginTop: '12px' }}>{msg}</p>}
      </div>

      {myEligibleUpsells.length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Upsells waiting on commission approval</h3>
          <div className="list-manage" style={{ marginBottom: '22px' }}>
            {myEligibleUpsells.map(u => {
              const ord = orders.find(o => o.id === u.original_order_id);
              const canAutoApprove = !!(u._rule && u._rule.auto_approve && profile.can_auto_approve_upsell);
              return (
                <div key={u.id} className="list-manage-row">
                  <span>
                    {ord ? ord.customer : 'Order'} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>· ₦{Number(u.commission_amount).toLocaleString()} commission</span>
                  </span>
                  {canAutoApprove ? (
                    <button className="btn primary" disabled={approvingId === u.id} onClick={() => selfApprove(u)}>
                      {approvingId === u.id ? 'Approving…' : 'Approve Upsell'}
                    </button>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#8A93A0' }}>Waiting for admin approval</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Your delivery success rate</h3>
      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
          <span>{successRate.toFixed(0)}% of your delivered orders got paid</span>
          <span style={{ color: '#8A93A0' }}>Needs {threshold}% to claim</span>
        </div>
        <div style={{ background: '#F0EEE8', borderRadius: '6px', height: '10px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, successRate)}%`, height: '100%', background: eligible ? '#4F46E5' : '#C6862F', transition: 'width .3s ease' }} />
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
          <div key={c.id} className="list-manage-row"><span>{new Date(c.claimed_at).toLocaleDateString()}</span><span style={{ color: '#4F46E5', fontWeight: 600 }}>₦{Number(c.amount).toLocaleString()}</span></div>
        ))}
      </div>
    </div>
  );
}

// ---------- Commission: admin overview ----------
export function AdminCommissionPage({ profiles, orders, products, session }) {
  const [threshold, setThreshold] = useState(0);
  const [claimFrequency, setClaimFrequency] = useState('weekly');
  const [claimDay, setClaimDay] = useState(1);
  const [claimDayOfMonth, setClaimDayOfMonth] = useState(1);
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
    const [{ data: rateSetting }, { data: daySetting }, { data: freqSetting }, { data: domSetting }, { data: windowSetting }, { data: freeRule }, { data: rules }] = await Promise.all([
      supabase.from('app_settings').select('*').eq('key', 'min_success_rate_to_claim').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_frequency').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day_of_month').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'success_rate_window_days').maybeSingle(),
      supabase.from('free_commission_rules').select('*').limit(1).maybeSingle(),
      supabase.from('commission_rules').select('*'),
    ]);
    setThreshold(rateSetting ? parseFloat(rateSetting.value) || 0 : 0);
    setClaimDay(daySetting ? parseInt(daySetting.value, 10) : 1);
    setClaimFrequency(freqSetting && freqSetting.value === 'monthly' ? 'monthly' : 'weekly');
    setClaimDayOfMonth(domSetting ? parseInt(domSetting.value, 10) || 1 : 1);
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

  async function approveClaim(c) {
    const { error } = await supabase.rpc('approve_commission_claim', { p_claim_id: c.id });
    if (error) { alert('Unable to approve this claim right now.'); return; }
    notifyUsers(session, {
      userIds: [c.staff_id], type: 'commission_claim_approved', title: 'Commission claim approved',
      body: `Your ₦${Number(c.amount).toLocaleString()} claim has been approved.`,
    });
    load();
  }
  async function rejectClaim(c) {
    const { error } = await supabase.rpc('reject_commission_claim', { p_claim_id: c.id });
    if (error) { alert('Unable to reject this claim right now.'); return; }
    notifyUsers(session, {
      userIds: [c.staff_id], type: 'commission_claim_rejected', title: 'Commission claim rejected',
      body: `Your ₦${Number(c.amount).toLocaleString()} claim was not approved — check with admin.`,
    });
    load();
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
      supabase.from('app_settings').upsert({ key: 'claim_frequency', value: claimFrequency }),
      supabase.from('app_settings').upsert({ key: 'claim_day_of_month', value: String(claimDayOfMonth) }),
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

      {claimsAll.filter(c => c.status === 'Pending').length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Pending claims — awaiting your approval</h3>
          <div className="list-manage" style={{ marginBottom: '22px' }}>
            {claimsAll.filter(c => c.status === 'Pending').map(c => (
              <div key={c.id} className="list-manage-row">
                <span>
                  {(profiles.find(p => p.id === c.staff_id) || {}).full_name || '—'}
                  <span style={{ color: '#8A93A0', fontSize: '11.5px' }}> · requested {new Date(c.claimed_at).toLocaleDateString()}</span>
                </span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>₦{Number(c.amount).toLocaleString()}</span>
                  <button className="btn primary" onClick={() => approveClaim(c)}>Approve — I've paid this</button>
                  <button className="btn" onClick={() => rejectClaim(c)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '22px', maxWidth: '440px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Claim cycle</label>
        <select value={claimFrequency} onChange={e => setClaimFrequency(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        {claimFrequency === 'monthly' ? (
          <>
            <label className="field-label">Day of the month claims open</label>
            <select value={claimDayOfMonth} onChange={e => setClaimDayOfMonth(parseInt(e.target.value, 10))} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
            </select>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-8px', marginBottom: '14px' }}>Capped at 28 so it falls in every month, including February.</p>
          </>
        ) : (
          <>
            <label className="field-label">Day of the week claims open</label>
            <select value={claimDay} onChange={e => setClaimDay(parseInt(e.target.value, 10))} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '14px' }}>
              {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
            </select>
          </>
        )}
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
            const claimed = myClaims.filter(c => c.status === 'Approved').reduce((sum, c) => sum + Number(c.amount), 0);
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
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{lastClaim ? `${new Date(lastClaim.claimed_at).toLocaleDateString()} (${lastClaim.status})` : 'Never'}</td>
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
          const claimed = myClaims.filter(c => c.status === 'Approved').reduce((sum, c) => sum + Number(c.amount), 0);
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
              <div className="mobile-card-row"><span className="mobile-card-label">Last claim</span><span className="mobile-card-value">{lastClaim ? `${new Date(lastClaim.claimed_at).toLocaleDateString()} (${lastClaim.status})` : 'Never'}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Phase 1 fraud-proof upsell system ----------

export function AddUpsellModal({ order, products, packages, productSets, currentUpsells, profile, profiles, session, onClose, onCreated }) {
  const [targetType, setTargetType] = useState('product');
  const [upsellProductId, setUpsellProductId] = useState('');
  const [upsellPackageId, setUpsellPackageId] = useState('');
  const [upsellSetId, setUpsellSetId] = useState('');
  const [additionalQuantity, setAdditionalQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const currentPackage = getCurrentPackage(order, currentUpsells);
  const currentAmount = currentPackage.amount;
  const newAmount = (parseFloat(additionalQuantity) || 0) * (parseFloat(unitPrice) || 0);
  const isPriceEntered = unitPrice !== '' && additionalQuantity !== '';
  const isUpgrade = isPriceEntered && newAmount > currentAmount;

  const originalProduct = products.find(p => p.id === order.product_id);
  const originalPackage = (packages || []).find(p => p.id === order.package_id);
  const originalSet = (productSets || []).find(s => s.id === order.set_id);
  const upsellPackages = (packages || []).filter(p => p.product_id === upsellProductId);

  function onPackageChange(id) {
    setUpsellPackageId(id);
    const pkg = upsellPackages.find(p => p.id === id);
    if (pkg && pkg.price != null) setUnitPrice(pkg.price);
  }

  function onSetChange(id) {
    setUpsellSetId(id);
    const s = (productSets || []).find(ps => ps.id === id);
    if (s && s.price_mode === 'flat' && s.flat_price != null) setUnitPrice(s.flat_price);
  }

  async function submit() {
    if (order.status === 'Delivered') { setError('This order has already been delivered. Please select a valid package before delivery.'); return; }
    if (targetType === 'set') {
      if (!upsellSetId || !additionalQuantity || unitPrice === '') { setError('Please select a valid package.'); return; }
    } else if (!upsellProductId || !additionalQuantity || unitPrice === '') {
      setError('Please select a valid package.'); return;
    }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc('create_upsell', {
      p_original_order_id: order.id,
      p_upsell_product_id: targetType === 'set' ? null : upsellProductId,
      p_upsell_package_id: targetType === 'set' ? null : (upsellPackageId || null),
      p_additional_quantity: parseInt(additionalQuantity, 10) || 1,
      p_unit_price: parseFloat(unitPrice) || 0,
      p_upsell_set_id: targetType === 'set' ? upsellSetId : null,
    });
    setSaving(false);
    if (rpcError) { setError('Unable to update this order. Please try again.'); return; }
    const upsellId = data;
    const notifyIds = [];
    if (order.dispatch_id) notifyIds.push(order.dispatch_id);
    (profiles || []).filter(p => p.role === 'admin' && p.id !== profile?.id).forEach(p => notifyIds.push(p.id));
    if (notifyIds.length > 0) {
      notifyUsers(session, {
        userIds: notifyIds, type: 'package_changed', title: 'Order package changed',
        body: `${order.customer} — deliver the updated package, not the original`,
        orderId: order.id, upsellId,
      });
    }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Change package · {order.customer}</h3>
        <div style={{ background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px', fontWeight: 600 }}>ORIGINALLY ORDERED (locked, kept for history)</div>
          <div style={{ fontSize: '13.5px' }}>{originalSet ? `📦 ${originalSet.name}` : originalProduct ? originalProduct.name : '—'}{originalPackage ? ` · ${originalPackage.name}` : ''}</div>
          <div style={{ fontSize: '12px', color: '#8A93A0' }}>Quantity: {order.quantity || 1} · ₦{Number(order.unit_price || 0).toLocaleString()}</div>
        </div>
        <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '-6px', marginBottom: '14px' }}>
          Use this when the customer has decided to go with a different package instead — not on top of the original.
          Dispatch will only deliver what you enter below; the original package above will no longer be sent.
        </p>

        {productSets && productSets.length > 0 && (
          <div className="row2" style={{ marginBottom: '10px' }}>
            <button type="button" className={'btn' + (targetType === 'product' ? ' primary' : '')} onClick={() => setTargetType('product')} style={{ flex: 1 }}>Single product</button>
            <button type="button" className={'btn' + (targetType === 'set' ? ' primary' : '')} onClick={() => setTargetType('set')} style={{ flex: 1 }}>Product set</button>
          </div>
        )}

        {targetType === 'set' ? (
          <>
            <label style={{ marginTop: 0 }}>New set</label>
            <select value={upsellSetId} onChange={e => onSetChange(e.target.value)}>
              <option value="">— Select a set —</option>
              {productSets.map(s => {
                const { inStock, text } = setStockLabel(s, products);
                return <option key={s.id} value={s.id} disabled={!inStock}>{s.name}{text}</option>;
              })}
            </select>
          </>
        ) : (
        <>
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
        </>
        )}
        <div className="row2">
          <div><label>Quantity to deliver</label><input type="number" min="1" value={additionalQuantity} onChange={e => setAdditionalQuantity(e.target.value)} /></div>
          <div><label>Unit price (₦)</label><input type="number" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></div>
        </div>
        {isPriceEntered && (
          <div style={{ background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginTop: '12px', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#8A93A0' }}>Current package</span>
              <span>₦{currentAmount.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#8A93A0' }}>New package</span>
              <span>₦{newAmount.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontWeight: 600 }}>
              <span>Difference</span>
              <span style={{ color: isUpgrade ? '#4F46E5' : '#B0483F' }}>{isUpgrade ? '+' : ''}₦{(newAmount - currentAmount).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#8A93A0' }}>Status</span>
              <span>{isUpgrade ? '🟢 Valid upgrade' : '🟡 Not an upgrade — no commission'}</span>
            </div>
          </div>
        )}
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
                <td style={{ textAlign: 'right' }}>
                  <button className="link-btn" onClick={() => setEditing(r)}>Edit</button>{' '}
                  <button className="tiny-x" onClick={async () => { if (confirm('Delete this upsell rule? Past orders keep their own record of what was applied, so this is safe.')) { await supabase.from('upsell_commission_rules').delete().eq('id', r.id); load(); } }}>Delete</button>
                </td>
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
  const [autoApprove, setAutoApprove] = useState(rule.auto_approve || false);
  const [effectiveStart, setEffectiveStart] = useState(rule.effective_start || new Date().toISOString().slice(0, 10));
  const [effectiveEnd, setEffectiveEnd] = useState(rule.effective_end || '');
  const [eligibleStaff, setEligibleStaff] = useState(rule.eligible_staff || []);
  const [saving, setSaving] = useState(false);

  const originalPackages = originalProductId ? packages.filter(p => p.product_id === originalProductId) : [];
  const upsellPackages = upsellProductId ? packages.filter(p => p.product_id === upsellProductId) : [];
  const staffList = (profiles || []).filter(p => p.role === 'staff');
  function toggleStaff(id) { setEligibleStaff(eligibleStaff.includes(id) ? eligibleStaff.filter(x => x !== id) : [...eligibleStaff, id]); }

  async function save() {
    if (saving) return; // guard against double-clicks creating duplicate rules
    setSaving(true);
    try {
      const payload = {
        original_product_id: originalProductId || null, original_package_id: originalPackageId || null,
        upsell_product_id: upsellProductId || null, upsell_package_id: upsellPackageId || null,
        commission_type: commissionType, commission_value: parseFloat(commissionValue) || 0,
        active, effective_start: effectiveStart, effective_end: effectiveEnd || null,
        eligible_staff: eligibleStaff.length > 0 ? eligibleStaff : null,
        auto_approve: autoApprove,
      };
      if (isNew) {
        await supabase.from('upsell_commission_rules').insert(payload);
      } else {
        await supabase.from('upsell_commission_rules').update(payload).eq('id', rule.id);
      }
      onClose();
    } finally {
      setSaving(false);
    }
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
          <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} /> Allow auto-approval for this rule
        </label>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '6px' }}>
          When on, a staff member you've specifically granted auto-approval permission can approve their own commission on this upgrade instead of waiting for you.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Phase 2: rule testing tool, upsells oversight, suspicious activity ----------

export function UpsellsPage({ products, packages, productSets, profiles }) {
  const [upsells, setUpsells] = useState([]);
  const [ordersById, setOrdersById] = useState({});
  const [notificationsByUpsell, setNotificationsByUpsell] = useState({});
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
    const upsellIds = (data || []).map(u => u.id);
    if (upsellIds.length > 0) {
      const { data: msgs } = await supabase.from('notifications').select('*').in('related_upsell_id', upsellIds);
      const notifMap = {};
      (msgs || []).forEach(m => {
        if (!notifMap[m.related_upsell_id]) notifMap[m.related_upsell_id] = [];
        notifMap[m.related_upsell_id].push(m);
      });
      setNotificationsByUpsell(notifMap);
    }
    setLoading(false);
  }
  const prodName = id => id ? (products.find(p => p.id === id) || {}).name || '—' : '—';
  const setNm = id => id ? ((productSets || []).find(s => s.id === id) || {}).name || '—' : '—';
  const itemLabel = u => u.upsell_set_id ? `📦 ${setNm(u.upsell_set_id)}` : prodName(u.upsell_product_id);
  const originalLabel = u => prodName(u.original_product_id);
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
                  <td style={{ fontSize: '12.5px' }}>{originalLabel(u)} → {itemLabel(u)}</td>
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
        <thead><tr><th>Order details</th><th>Staff</th><th>Original → Upsell</th><th>Qty / Amount</th><th>Commission</th><th>When</th><th>Notified</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {upsells.length === 0 && <tr><td colSpan="9" className="empty">No upsells created yet.</td></tr>}
          {upsells.map(u => {
            const ord = ordersById[u.original_order_id];
            const notifs = notificationsByUpsell[u.id] || [];
            return (
            <tr key={u.id}>
              <td>
                <span className="oid">{u.original_order_id.slice(0, 8)}</span>
                {ord && <div style={{ fontSize: '12px' }}>{ord.customer}<div style={{ color: '#8A93A0' }}>{ord.phone}{ord.address ? ` · ${ord.address}` : ''}</div></div>}
              </td>
              <td>{staffName(u.staff_id)}</td>
              <td style={{ fontSize: '12.5px' }}>{originalLabel(u)} → {itemLabel(u)}</td>
              <td>+{u.additional_quantity} · ₦{Number(u.upsell_amount).toLocaleString()}</td>
              <td>₦{Number(u.commission_amount).toLocaleString()}</td>
              <td style={{ fontSize: '11.5px', color: '#8A93A0', whiteSpace: 'nowrap' }}>{new Date(u.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td style={{ fontSize: '11px' }}>
                {notifs.length === 0 ? (
                  <span style={{ color: '#8A93A0' }}>No one to notify</span>
                ) : (
                  notifs.map(m => (
                    <div key={m.id} style={{ marginBottom: '3px' }}>
                      {staffName(m.recipient_id)} —{' '}
                      {m.read_at ? (
                        <span style={{ color: '#4F46E5' }}>Read {new Date(m.read_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      ) : (
                        <span style={{ color: '#B0483F', fontWeight: 600 }}>Not read yet</span>
                      )}
                    </div>
                  ))
                )}
              </td>
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
export function CommissionHub({ profiles, orders, products, packages, productSets, session, profile }) {
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
      {tab === 'upsells' && <UpsellsPage products={products} packages={packages} productSets={productSets} profiles={profiles} />}
      {tab === 'corrections' && <CorrectionsPage profile={profile} session={session} refresh={() => {}} />}
      {tab === 'suspicious' && <SuspiciousActivityPage profiles={profiles} orders={orders} />}
    </div>
  );
}

// ---------- Unified Inventory hub: stock levels + agent stock together ----------
export function InventoryHub({ products, orders, profiles, agentStock, suppliers, refresh }) {
  const [tab, setTab] = useState('inventory');
  return (
    <div>
      <div className="product-tabs" style={{ marginBottom: '18px' }}>
        <span className={'ptab' + (tab === 'inventory' ? ' active' : '')} onClick={() => setTab('inventory')}>Inventory</span>
        <span className={'ptab' + (tab === 'agentstock' ? ' active' : '')} onClick={() => setTab('agentstock')}>Agent stock</span>
        <span className={'ptab' + (tab === 'suppliers' ? ' active' : '')} onClick={() => setTab('suppliers')}>Suppliers</span>
      </div>
      {tab === 'inventory' && <InventoryPage products={products} orders={orders} profiles={profiles} agentStock={agentStock} suppliers={suppliers} refresh={refresh} />}
      {tab === 'agentstock' && <AgentStockPage profiles={profiles} products={products} agentStock={agentStock} refresh={refresh} />}
      {tab === 'suppliers' && <SuppliersPage suppliers={suppliers || []} refresh={refresh} />}
    </div>
  );
}

// ---------- Persistent Messages inbox ----------
export function MessagesPage({ profile }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('messages').select('*').eq('recipient_id', profile.id).order('created_at', { ascending: false });
    setMessages(data || []);
    setLoading(false);
    const unread = (data || []).filter(m => !m.read_at);
    if (unread.length > 0) {
      await supabase.from('messages').update({ read_at: new Date().toISOString() }).in('id', unread.map(m => m.id));
    }
  }

  if (loading) return <div className="loading">Loading messages…</div>;

  const filtered = messages.filter(m => filter === 'all' ? true : filter === 'unread' ? !m.read_at : !!m.read_at);
  const sorted = filtered.slice().sort((a, b) => sortOrder === 'newest'
    ? new Date(b.created_at) - new Date(a.created_at)
    : new Date(a.created_at) - new Date(b.created_at));
  const unreadCount = messages.filter(m => !m.read_at).length;

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Messages</h1><p className="page-sub">Messages sent to you by admin.</p></div></div>
      {messages.length > 0 && (
        <div className="product-tabs" style={{ marginBottom: '16px' }}>
          <span className={'ptab' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>All ({messages.length})</span>
          <span className={'ptab' + (filter === 'unread' ? ' active' : '')} onClick={() => setFilter('unread')}>Unread ({unreadCount})</span>
          <span className={'ptab' + (filter === 'read' ? ' active' : '')} onClick={() => setFilter('read')}>Read ({messages.length - unreadCount})</span>
          <span className={'ptab' + (sortOrder === 'newest' ? ' active' : '')} onClick={() => setSortOrder('newest')}>Newest first</span>
          <span className={'ptab' + (sortOrder === 'oldest' ? ' active' : '')} onClick={() => setSortOrder('oldest')}>Oldest first</span>
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="empty">{messages.length === 0 ? 'No messages yet.' : 'Nothing matches this filter.'}</div>
      ) : (
        <div className="list-manage">
          {sorted.map(m => (
            <div key={m.id} className="list-manage-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', background: m.read_at ? 'transparent' : '#FBF6EC' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontWeight: 600, fontSize: '12.5px' }}>{m.sender_name || 'Admin'} {!m.read_at && <span className="pill New" style={{ marginLeft: '6px' }}>New</span>}</span>
                <span style={{ fontSize: '11px', color: '#8A93A0' }}>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: '13.5px' }}>{m.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Product Sets: bundle multiple distinct products as one sellable unit ----------
export function ProductSetsPage({ products, profiles, refresh }) {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [managingCommission, setManagingCommission] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: setRows }, { data: itemRows }] = await Promise.all([
      supabase.from('product_sets').select('*').order('created_at', { ascending: false }),
      supabase.from('product_set_items').select('*'),
    ]);
    const withItems = (setRows || []).map(s => ({ ...s, items: (itemRows || []).filter(i => i.set_id === s.id) }));
    setSets(withItems);
    setLoading(false);
  }

  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';

  async function toggleActive(set) {
    await supabase.from('product_sets').update({ active: !set.active }).eq('id', set.id);
    load();
  }

  if (loading) return <div className="loading">Loading sets…</div>;

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Product Sets</h1><p className="page-sub">Bundle two or more products together as one sellable item — each still draws from its own central and agent stock.</p></div>
        <button className="btn primary" onClick={() => setEditing({})}>+ New set</button>
      </div>
      {sets.length === 0 ? (
        <div className="empty">No sets created yet.</div>
      ) : (
        <div className="list-manage">
          {sets.map(s => (
            <div key={s.id} className="list-manage-row">
              <span>
                <strong>{s.name}</strong>{' '}
                {s.sku && <span className="pill" style={{ background: '#EEF2F8', color: '#4A7FBF', border: '1px solid #D6E0EE', fontFamily: 'monospace', fontSize: '11px' }}>{s.sku}</span>}
                {' '}<span style={{ color: '#8A93A0', fontSize: '11.5px' }}>
                  · {s.items.map(i => `${i.quantity_per_set}× ${prodName(i.product_id)}`).join(' + ')}
                  · {s.price_mode === 'flat' ? `₦${Number(s.flat_price || 0).toLocaleString()} flat` : 'Sum of component prices'}
                </span>
                {!s.active && <span className="pill Cancelled" style={{ marginLeft: '8px' }}>Off</span>}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="link-btn" onClick={() => setEditing(s)}>Edit</button>
                <button className="link-btn" onClick={() => setManagingCommission(s)}>Standard & upsell commission</button>
                <button className="btn" onClick={() => toggleActive(s)}>{s.active ? 'On — turn off' : 'Off — turn on'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <ProductSetModal set={editing} products={products} onClose={() => { setEditing(null); load(); refresh && refresh(); }} />}
      {managingCommission && <CommissionRuleModal set={managingCommission} profiles={profiles} onClose={() => setManagingCommission(null)} />}
    </div>
  );
}

function ProductSetModal({ set, products, onClose }) {
  const isNew = !set.id;
  const [name, setName] = useState(set.name || '');
  const [sku, setSku] = useState(set.sku || '');
  const [priceMode, setPriceMode] = useState(set.price_mode || 'flat');
  const [flatPrice, setFlatPrice] = useState(set.flat_price || '');
  const [items, setItems] = useState({}); // productId -> quantity_per_set
  const [loadingItems, setLoadingItems] = useState(!isNew);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data } = await supabase.from('product_set_items').select('*').eq('set_id', set.id);
      const map = {};
      (data || []).forEach(i => { map[i.product_id] = i.quantity_per_set; });
      setItems(map);
      setLoadingItems(false);
    })();
  }, []);

  function toggleProduct(id) {
    setItems(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  }
  function setQty(id, qty) {
    setItems(prev => ({ ...prev, [id]: Math.max(1, parseInt(qty, 10) || 1) }));
  }

  const sumPrice = Object.entries(items).reduce((sum, [pid, qty]) => {
    const p = products.find(pp => pp.id === pid);
    return sum + (p && p.default_price ? Number(p.default_price) * qty : 0);
  }, 0);

  async function save() {
    if (saving) return; // guard against double-clicks creating duplicate sets
    const productIds = Object.keys(items);
    if (!name.trim() || productIds.length < 2) {
      alert('Give the set a name and select at least 2 different products.');
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      const payload = { name: name.trim(), sku: sku.trim() || null, price_mode: priceMode, flat_price: priceMode === 'flat' ? (parseFloat(flatPrice) || 0) : null };
      let setId = set.id;
      if (isNew) {
        const { data, error } = await supabase.from('product_sets').insert(payload).select().single();
        if (error) { setSaveError(error.code === '23505' ? 'That code is already used by another product/set — pick a different one.' : error.message); return; }
        setId = data.id;
      } else {
        const { error } = await supabase.from('product_sets').update(payload).eq('id', set.id);
        if (error) { setSaveError(error.code === '23505' ? 'That code is already used by another product/set — pick a different one.' : error.message); return; }
        await supabase.from('product_set_items').delete().eq('set_id', set.id);
      }
      await supabase.from('product_set_items').insert(
        productIds.map(pid => ({ set_id: setId, product_id: pid, quantity_per_set: items[pid] }))
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{isNew ? 'New' : 'Edit'} product set</h3>
        <label style={{ marginTop: 0 }}>Set name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Complete Care Bundle" />
        <label>Code / SKU (optional, unique)</label>
        <input value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. SET-CARE-BUNDLE" style={{ fontFamily: 'monospace' }} />

        <label>Which products are in this set?</label>
        {loadingItems ? <p style={{ fontSize: '12px', color: '#8A93A0' }}>Loading…</p> : (
          <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {products.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '5px 2px' }}>
                <input type="checkbox" checked={!!items[p.id]} onChange={() => toggleProduct(p.id)} />
                <span style={{ flex: 1 }}>{p.name}</span>
                {items[p.id] && (
                  <input
                    type="number" min="1" value={items[p.id]}
                    onChange={e => setQty(p.id, e.target.value)}
                    style={{ width: '60px', padding: '4px 6px', border: '1px solid #DEDAD0', borderRadius: '4px', fontSize: '12px' }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '6px' }}>The number next to a checked product is how many of that product go into one unit of this set.</p>

        <label>Pricing</label>
        <select value={priceMode} onChange={e => setPriceMode(e.target.value)}>
          <option value="flat">One flat price for the whole set</option>
          <option value="sum">Sum of each product's default price</option>
        </select>
        {priceMode === 'flat' ? (
          <>
            <label>Flat price (₦)</label>
            <input type="number" min="0" value={flatPrice} onChange={e => setFlatPrice(e.target.value)} />
          </>
        ) : (
          <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '8px' }}>
            Calculated from products' default prices: ₦{sumPrice.toLocaleString()}. Set a default price on each product (in Products) for this to work — components without one count as ₦0.
          </p>
        )}
        {saveError && <p style={{ fontSize: '11.5px', color: '#B0483F', marginTop: '6px' }}>{saveError}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save set'}</button>
        </div>
      </div>
    </div>
  );
}

export function setStockLabel(set, products) {
  // Client-side estimate of whether a set looks in-stock, for disabling the option in a dropdown.
  if (!set.items || set.items.length === 0) return { inStock: true, text: '' };
  const short = set.items.some(i => {
    const p = products.find(pp => pp.id === i.product_id);
    return !p || p.stock_quantity < i.quantity_per_set;
  });
  return { inStock: !short, text: short ? ' — OUT OF STOCK' : '' };
}

// ---------- Daily order summary for Staff and Dispatch ----------
export function DailySummaryPage({ orders, profile, profiles, isDispatch }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  function setPreset(preset) {
    const d = new Date();
    if (preset === 'today') { setFromDate(todayStr); setToDate(todayStr); }
    else if (preset === 'yesterday') {
      d.setDate(d.getDate() - 1);
      const s = d.toISOString().slice(0, 10);
      setFromDate(s); setToDate(s);
    } else if (preset === 'week') {
      d.setDate(d.getDate() - 6);
      setFromDate(d.toISOString().slice(0, 10)); setToDate(todayStr);
    }
  }

  const mine = isDispatch ? orders.filter(o => o.dispatch_id === profile.id) : orders.filter(o => o.staff_id === profile.id);
  const inRange = dateStr => dateStr >= fromDate && dateStr <= toDate;

  const dayOrders = mine.filter(o => inRange(new Date(o.created_at).toISOString().slice(0, 10)));
  const statusChangedThatDay = mine.filter(o => o.status_updated_at && inRange(new Date(o.status_updated_at).toISOString().slice(0, 10)));

  const counts = {
    received: dayOrders.length,
    new: dayOrders.filter(o => o.status === 'New').length,
    confirmed: statusChangedThatDay.filter(o => o.status === 'Confirmed').length,
    delivered: statusChangedThatDay.filter(o => o.status === 'Delivered').length,
    cancelled: statusChangedThatDay.filter(o => o.status === 'Cancelled').length,
    unreachable: statusChangedThatDay.filter(o => o.status === 'Unreachable').length,
    unverified: statusChangedThatDay.filter(o => o.status === 'Unverified').length,
    rescheduled: statusChangedThatDay.filter(o => o.status === 'Rescheduled').length,
    failedDelivery: statusChangedThatDay.filter(o => o.status === 'Failed Delivery').length,
  };

  // Union of "received in range" and "changed status in range" for the activity list, de-duplicated.
  const activityMap = {};
  [...dayOrders, ...statusChangedThatDay].forEach(o => { activityMap[o.id] = o; });
  const activity = Object.values(activityMap).sort((a, b) => new Date(b.status_updated_at || b.created_at) - new Date(a.status_updated_at || a.created_at));

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Daily summary</h1><p className="page-sub">Pick a date or range to see what happened.</p></div></div>
      <div className="product-tabs" style={{ marginBottom: '12px' }}>
        <span className="ptab" onClick={() => setPreset('today')}>Today</span>
        <span className="ptab" onClick={() => setPreset('yesterday')}>Yesterday</span>
        <span className="ptab" onClick={() => setPreset('week')}>Last 7 days</span>
      </div>
      <div className="row2" style={{ marginBottom: '18px', maxWidth: '420px' }}>
        <div><label className="field-label" style={{ marginTop: 0 }}>From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
        <div><label className="field-label" style={{ marginTop: 0 }}>To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
      </div>
      <div className="stats" style={{ marginBottom: '20px' }}>
        <div className="stat"><div className="stat-num">{counts.received}</div><div className="stat-label">Received</div></div>
        <div className="stat"><div className="stat-num">{counts.new}</div><div className="stat-label">New</div></div>
        <div className="stat"><div className="stat-num">{counts.confirmed}</div><div className="stat-label">Confirmed</div></div>
        <div className="stat"><div className="stat-num">{counts.delivered}</div><div className="stat-label">Delivered</div></div>
        <div className="stat"><div className="stat-num">{counts.cancelled}</div><div className="stat-label">Cancelled</div></div>
        <div className="stat"><div className="stat-num">{counts.unreachable}</div><div className="stat-label">Unreachable</div></div>
        <div className="stat"><div className="stat-num">{counts.unverified}</div><div className="stat-label">Unverified</div></div>
        <div className="stat"><div className="stat-num">{counts.rescheduled}</div><div className="stat-label">Rescheduled</div></div>
        <div className="stat"><div className="stat-num">{counts.failedDelivery}</div><div className="stat-label">Failed delivery</div></div>
      </div>
      {activity.length === 0 ? (
        <div className="empty">Nothing in this range.</div>
      ) : (
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            {activity.map(o => (
              <tr key={o.id}>
                <td className="oid">{o.serial_number ? '#' + o.serial_number : o.id.slice(0, 8)}</td>
                <td>{o.customer}</td>
                <td><span className={'pill ' + pillClass(o.status)}>{o.status}</span></td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(o.status_updated_at || o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!isDispatch && profile.can_view_dispatch_success_rate && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '28px 0 10px' }}>Dispatch performance</h3>
          <table>
            <thead><tr><th>Dispatch partner</th><th>State</th><th>Delivered</th><th>Success rate</th></tr></thead>
            <tbody>
              {(profiles || []).filter(p => p.role === 'dispatch').map(d => {
                const handled = orders.filter(o => o.dispatch_id === d.id);
                const delivered = handled.filter(o => o.status === 'Delivered').length;
                const rate = handled.length > 0 ? Math.round((delivered / handled.length) * 100) : 100;
                return (
                  <tr key={d.id}>
                    <td>{d.full_name}</td>
                    <td style={{ color: '#8A93A0' }}>{d.state || '—'}</td>
                    <td>{delivered}</td>
                    <td>{rate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------- Failed deliveries — staff-facing view of their own orders that ----------
// dispatch (or admin) marked Failed Delivery, with the remark explaining why.
export function FailedDeliveriesPage({ orders, products, productSets, packages, profiles, profile, isDispatch }) {
  const [remarksByOrder, setRemarksByOrder] = useState({});

  const mine = isDispatch ? orders.filter(o => o.dispatch_id === profile.id) : orders.filter(o => o.staff_id === profile.id);
  const failed = mine.filter(o => o.status === 'Failed Delivery').sort((a, b) => new Date(b.status_updated_at || b.created_at) - new Date(a.status_updated_at || a.created_at));

  useEffect(() => {
    (async () => {
      if (failed.length === 0) { setRemarksByOrder({}); return; }
      // The failure reason is logged as its own 'remark' event alongside the
      // 'status_change' event (see updateOrder/applyStatusChange) — the
      // status_change row itself never carries a note. Most recent remark
      // per order is what we want here.
      const { data } = await supabase
        .from('order_events')
        .select('*')
        .in('order_id', failed.map(o => o.id))
        .eq('event_type', 'remark')
        .order('created_at', { ascending: false });
      const map = {};
      (data || []).forEach(e => { if (!map[e.order_id]) map[e.order_id] = e; }); // most recent per order
      setRemarksByOrder(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed.map(o => o.id).join(',')]);

  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const setName = id => ((productSets || []).find(s => s.id === id) || {}).name || '—';
  const pkgName = id => (packages || []).find(p => p.id === id)?.name || null;
  const personName = id => (profiles.find(p => p.id === id) || {}).full_name || '—';

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Failed deliveries</h1><p className="page-sub">Orders {isDispatch ? 'you' : 'assigned to you'} marked Failed Delivery, with the reason.</p></div>
      </div>
      <div className="stats" style={{ marginBottom: '20px' }}>
        <div className="stat"><div className="stat-num">{failed.length}</div><div className="stat-label">Failed deliveries</div></div>
      </div>
      {failed.length === 0 ? (
        <div className="empty">No failed deliveries — nice.</div>
      ) : (
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Item</th><th>{isDispatch ? 'Staff' : 'Dispatch'}</th><th>Fee</th><th>Reason</th><th>When</th></tr></thead>
          <tbody>
            {failed.map(o => {
              const ev = remarksByOrder[o.id];
              return (
                <tr key={o.id}>
                  <td className="oid">{o.serial_number ? '#' + o.serial_number : o.id.slice(0, 8)}</td>
                  <td>{o.customer}</td>
                  <td>{o.set_id ? `📦 ${setName(o.set_id)}` : prodName(o.product_id)}{!o.set_id && pkgName(o.package_id) ? <div style={{ fontSize: '11px', color: '#8A93A0' }}>{pkgName(o.package_id)}</div> : null}</td>
                  <td>{isDispatch ? personName(o.staff_id) : (o.dispatch_id ? personName(o.dispatch_id) : '—')}</td>
                  <td>₦{Number(o.delivery_fee || 0).toLocaleString()}</td>
                  <td style={{ fontSize: '12.5px', maxWidth: '260px' }}>{ev ? ev.note : <span style={{ color: '#8A93A0' }}>No remark recorded</span>}</td>
                  <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(o.status_updated_at || o.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Persistent notifications inbox — order alerts that survive being offline ----------
export function NotificationsPage({ profile }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('notifications').select('*').eq('recipient_id', profile.id).order('created_at', { ascending: false }).limit(100);
    setNotifications(data || []);
    setLoading(false);
    const unread = (data || []).filter(n => !n.read_at);
    if (unread.length > 0) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread.map(n => n.id));
    }
  }

  if (loading) return <div className="loading">Loading notifications…</div>;

  const filtered = notifications.filter(n => filter === 'all' ? true : filter === 'unread' ? !n.read_at : !!n.read_at);
  const unreadCount = notifications.filter(n => !n.read_at).length;

  const typeIcon = { new_order: '🆕', order_assigned: '📦', status_changed: '🔄', package_changed: '⬆' };

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Notifications</h1><p className="page-sub">Order alerts — these stay here even if you missed them at the time.</p></div></div>
      {notifications.length > 0 && (
        <div className="product-tabs" style={{ marginBottom: '16px' }}>
          <span className={'ptab' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>All ({notifications.length})</span>
          <span className={'ptab' + (filter === 'unread' ? ' active' : '')} onClick={() => setFilter('unread')}>Unread ({unreadCount})</span>
          <span className={'ptab' + (filter === 'read' ? ' active' : '')} onClick={() => setFilter('read')}>Read ({notifications.length - unreadCount})</span>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="empty">{notifications.length === 0 ? 'No notifications yet.' : 'Nothing matches this filter.'}</div>
      ) : (
        <div className="list-manage">
          {filtered.map(n => (
            <div key={n.id} className="list-manage-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', background: n.read_at ? 'transparent' : '#FBF6EC' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontWeight: 600, fontSize: '12.5px' }}>{typeIcon[n.type] || '🔔'} {n.title} {!n.read_at && <span className="pill New" style={{ marginLeft: '6px' }}>New</span>}</span>
                <span style={{ fontSize: '11px', color: '#8A93A0' }}>{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: '13.5px' }}>{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Landing page order source (Zapier/Make webhook intake) ----------
function OrderSourceModal({ source, products, productSets, profiles, onClose }) {
  const isNew = !source.id;
  const [name, setName] = useState(source.name || '');
  const [productId, setProductId] = useState(source.product_id || '');
  const [defaultState, setDefaultState] = useState(source.default_state || '');
  const [eligibleStaff, setEligibleStaff] = useState(source.eligible_staff || []);
  const staffList = (profiles || []).filter(p => p.role === 'staff');
  function toggleEligibleStaff(id) {
    setEligibleStaff(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  const [options, setOptions] = useState(() => {
    const entries = Object.entries(source.option_mapping || {});
    if (entries.length === 0) return [{ label: '', targetType: 'package', packageId: '', setId: '' }];
    return entries.map(([label, val]) => ({
      label,
      targetType: val.set_id ? 'set' : 'package',
      packageId: val.package_id || '',
      setId: val.set_id || '',
    }));
  });
  const [apiKey] = useState(source.api_key || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now())));
  const [fieldMapping, setFieldMapping] = useState(() => ({
    customer: '', phone: '', phone2: '', address: '', state: '', selected_option: '',
    ...(source.field_mapping || {}),
  }));
  const [showFieldMapping, setShowFieldMapping] = useState(Object.keys(source.field_mapping || {}).length > 0);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  function addOption() {
    setOptions([...options, { label: '', targetType: 'package', packageId: '', setId: '' }]);
  }
  function updateOption(i, patch) {
    setOptions(options.map((o, idx) => idx === i ? { ...o, ...patch } : o));
  }
  function removeOption(i) {
    setOptions(options.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) { alert('Give this landing page a name.'); return; }
    const mapping = {};
    options.forEach(o => {
      if (!o.label.trim()) return;
      if (o.targetType === 'set' && o.setId) mapping[o.label.trim()] = { set_id: o.setId };
      else if (o.targetType === 'package' && o.packageId) mapping[o.label.trim()] = { package_id: o.packageId };
    });
    setSaving(true);
    const cleanedMapping = {};
    Object.entries(fieldMapping).forEach(([k, v]) => { if (v && v.trim()) cleanedMapping[k] = v.trim(); });
    const payload = {
      name: name.trim(), product_id: productId || null, option_mapping: mapping,
      default_state: defaultState || null, api_key: apiKey, active: true,
      field_mapping: showFieldMapping ? cleanedMapping : {},
      eligible_staff: eligibleStaff.length > 0 ? eligibleStaff : null,
    };
    const { error } = isNew
      ? await supabase.from('landing_page_sources').insert(payload)
      : await supabase.from('landing_page_sources').update(payload).eq('id', source.id);
    setSaving(false);
    if (error) { alert('Unable to save this landing page source right now. Please try again.'); return; }
    onClose();
  }

  const endpointUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/order-intake';

  function copyKey() {
    copyToClipboard(apiKey, 'API key copied');
    setCopied(true);
  }

  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  function setDeep(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) { cur[k] = value; }
      else { cur[k] = cur[k] || {}; cur = cur[k]; }
    });
  }

  async function sendTestOrder() {
    setTesting(true);
    setTestResult(null);
    const sampleValues = {
      customer: 'Test Customer', phone: '08000000000', phone2: '08000000001',
      address: '123 Test Street', state: 'Lagos',
      selected_option: options[0] && options[0].label ? options[0].label : 'Test option',
    };
    let testBody = { api_key: apiKey };
    if (showFieldMapping && Object.values(fieldMapping).some(v => v && v.trim())) {
      Object.entries(fieldMapping).forEach(([field, path]) => {
        if (path && path.trim()) setDeep(testBody, path.trim(), sampleValues[field]);
      });
    } else {
      testBody = { ...testBody, ...sampleValues };
    }
    try {
      const res = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testBody),
      });
      const json = await res.json();
      setTestResult({ ok: res.ok, status: res.status, json, sentBody: testBody });
    } catch (e) {
      setTestResult({ ok: false, status: 'network error', json: { error: e.message }, sentBody: testBody });
    }
    setTesting(false);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: '560px' }} onClick={e => e.stopPropagation()}>
        <h3>{isNew ? 'Connect a new landing page' : 'Manage landing page'}</h3>

        <label style={{ marginTop: 0 }}>Name (for your own reference)</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Teatree Set — Main Funnel" />

        <label>Base product</label>
        <select value={productId} onChange={e => setProductId(e.target.value)}>
          <option value="">— Select product —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label>Default delivery state (optional)</label>
        <select value={defaultState} onChange={e => setDefaultState(e.target.value)}>
          <option value="">— None, staff picks it at confirmation —</option>
          {NIGERIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <label style={{ marginTop: '14px' }}>If this page offers a choice of packages/sets</label>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-4px', marginBottom: '8px' }}>
          Type the exact text your WordPress form submits for each option (e.g. what a dropdown or radio button's value is), and pick what it means in the CRM. Leave this as one blank row if the page only sells one thing.
        </p>
        {options.map((o, i) => {
          return (
            <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
              <input
                value={o.label} onChange={e => updateOption(i, { label: e.target.value })}
                placeholder="Option label from the form"
                style={{ flex: '1 1 140px', padding: '7px 9px', border: '1px solid #DEDAD0', borderRadius: '4px', fontSize: '12.5px' }}
              />
              <select value={o.targetType} onChange={e => updateOption(i, { targetType: e.target.value })} style={{ fontSize: '12px', padding: '6px 8px' }}>
                <option value="package">Package</option>
                <option value="set">Set</option>
              </select>
              {o.targetType === 'set' ? (
                <select value={o.setId} onChange={e => updateOption(i, { setId: e.target.value })} style={{ fontSize: '12px', padding: '6px 8px', flex: '1 1 140px' }}>
                  <option value="">— Choose set —</option>
                  {(productSets || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <PackagePicker productId={productId} value={o.packageId} onChange={val => updateOption(i, { packageId: val })} />
              )}
              <button className="tiny-x" onClick={() => removeOption(i)}>✕</button>
            </div>
          );
        })}
        <button className="link-btn" onClick={addOption}>+ Add another option</button>

        <label style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={showFieldMapping} onChange={e => setShowFieldMapping(e.target.checked)} />
          Advanced: this form sends raw field names (e.g. WP Webhooks free tier, which can't rename fields)
        </label>
        {showFieldMapping && (
          <div style={{ background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginTop: '10px' }}>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: 0, marginBottom: '10px' }}>
              Tell the CRM where to find each value inside the raw data your form sends. Use dot-notation for nested fields (e.g. names.first_name). Leave a field blank if this form doesn't have it.
            </p>
            {[
              { key: 'customer', label: 'Customer name', placeholder: 'form_data.input_text' },
              { key: 'phone', label: 'Phone', placeholder: 'form_data.names.first_name' },
              { key: 'phone2', label: '2nd phone (optional)', placeholder: 'form_data.names.last_name' },
              { key: 'address', label: 'Address', placeholder: 'form_data.description' },
              { key: 'state', label: 'State', placeholder: 'form_data.dropdown' },
              { key: 'selected_option', label: 'Selected package option', placeholder: 'form_data.input_radio2' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: '8px' }}>
                <label className="field-label" style={{ marginTop: 0, fontSize: '11px' }}>{f.label}</label>
                <input
                  value={fieldMapping[f.key] || ''} onChange={e => setFieldMapping({ ...fieldMapping, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  style={{ width: '100%', padding: '6px 9px', border: '1px solid #DEDAD0', borderRadius: '4px', fontSize: '12px' }}
                />
              </div>
            ))}
          </div>
        )}

        <label style={{ marginTop: '16px' }}>Which staff can see new orders from this page?</label>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-4px', marginBottom: '8px' }}>
          New orders from this landing page arrive unassigned. Leave everyone unchecked to let any staff member see and claim them (default, unchanged behavior). Check specific staff to limit who can see and claim these incoming orders.
        </p>
        {staffList.length === 0 ? (
          <p style={{ fontSize: '11.5px', color: '#8A93A0' }}>No staff logins yet — add staff under Team first.</p>
        ) : (
          <div style={{ background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '10px 12px', marginBottom: '4px', maxHeight: '150px', overflowY: 'auto' }}>
            {staffList.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 'normal', padding: '4px 0' }}>
                <input type="checkbox" checked={eligibleStaff.includes(p.id)} onChange={() => toggleEligibleStaff(p.id)} />
                {p.full_name}
              </label>
            ))}
          </div>
        )}

        {!isNew || apiKey ? (
          <div style={{ background: '#F6F4EF', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginTop: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#8A93A0', marginBottom: '6px' }}>ZAPIER / MAKE SETUP</div>
            <div style={{ fontSize: '12.5px', marginBottom: '6px' }}>Send a POST request to:</div>
            <code style={{ fontSize: '11.5px', display: 'block', background: '#fff', padding: '6px 8px', borderRadius: '4px', marginBottom: '8px', wordBreak: 'break-all' }}>{endpointUrl}</code>
            <div style={{ fontSize: '12.5px', marginBottom: '4px' }}>With this JSON body (map your form fields to these names):</div>
            <code style={{ fontSize: '11px', display: 'block', background: '#fff', padding: '8px', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
{`{
  "api_key": "${apiKey}",
  "customer": "Customer name",
  "phone": "080...",
  "phone2": "080... (optional)",
  "address": "Delivery address",
  "state": "Lagos (optional)",
  "selected_option": "exact option label (if any)",
  "quantity": 1,
  "notes": "optional"
}`}
            </code>
            <button className="link-btn" style={{ marginTop: '8px' }} onClick={copyKey}>{copied ? '✓ Copied' : '📋 Copy API key'}</button>
          </div>
        ) : null}

        <div style={{ marginTop: '16px' }}>
          <button className="btn" onClick={sendTestOrder} disabled={testing}>{testing ? 'Sending test…' : '🧪 Send a test order (bypasses WordPress)'}</button>
          <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '4px' }}>
            Sends fake sample data straight from your browser to the CRM, shaped using whatever mapping is filled in above. If this succeeds but your real form still doesn't, the problem is on the WordPress/WP Webhooks side. If this fails too, the problem is here in the CRM setup.
          </p>
          {testResult && (
            <div style={{ background: testResult.ok ? '#ECEAFB' : '#FBEAE8', border: '1px solid ' + (testResult.ok ? '#4F46E5' : '#B0483F'), borderRadius: '8px', padding: '12px', marginTop: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: '12.5px', color: testResult.ok ? '#3730A3' : '#B0483F', marginBottom: '6px' }}>
                {testResult.ok ? `✓ Success — order #${testResult.json.serial_number || '?'} created` : `✕ Failed (status ${testResult.status})`}
              </div>
              <code style={{ fontSize: '10.5px', display: 'block', background: '#fff', padding: '8px', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(testResult.json, null, 2)}
              </code>
              <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '6px' }}>Sent: {JSON.stringify(testResult.sentBody)}</div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Finance: real profit & loss per product/set, and company-wide.
//
// Revenue and delivery cost come straight from orders (delivery_fee already
// existed and is reused as the real cost of getting an order to a customer).
// Commission comes from commission_ledger (already existed). Everything else
// — cost of goods, packaging, waybill/freight-in, ad spend, salaries, other
// overhead — is entered by hand here, since there's no other source of truth
// for it. Only counts orders that are Delivered AND Paid as real revenue —
// anything still pending isn't money the company actually has yet.
// ============================================================================

const EXPENSE_CATEGORIES = [
  { key: 'waybill', label: 'Waybill / freight-in' },
  { key: 'ad_spend', label: 'Ad spend' },
  { key: 'salary', label: 'Salary' },
  { key: 'other', label: 'Other overhead' },
];

export function FinanceHub({ products, productSets, packages, orders, profiles, session, profile, upsellsByOrder, remittances, refresh }) {
  const [tab, setTab] = useState('profitability');
  const outstandingCount = orders.filter(o => o.payment_status !== 'Paid' && o.status !== 'Cancelled').length;
  return (
    <div>
      <div className="product-tabs" style={{ marginBottom: '18px' }}>
        <span className={'ptab' + (tab === 'profitability' ? ' active' : '')} onClick={() => setTab('profitability')}>Profitability</span>
        <span className={'ptab' + (tab === 'outstanding' ? ' active' : '')} onClick={() => setTab('outstanding')}>Outstanding payments{outstandingCount > 0 ? ` (${outstandingCount})` : ''}</span>
        <span className={'ptab' + (tab === 'remittance' ? ' active' : '')} onClick={() => setTab('remittance')}>Dispatch remittance</span>
        <span className={'ptab' + (tab === 'expenses' ? ' active' : '')} onClick={() => setTab('expenses')}>Expenses</span>
        <span className={'ptab' + (tab === 'costs' ? ' active' : '')} onClick={() => setTab('costs')}>Product costs</span>
      </div>
      {tab === 'profitability' && <ProfitabilityPage products={products} productSets={productSets} packages={packages} orders={orders} />}
      {tab === 'outstanding' && <OutstandingPaymentsPage orders={orders} profiles={profiles} upsellsByOrder={upsellsByOrder} profile={profile} />}
      {tab === 'remittance' && <RemittancePage orders={orders} profiles={profiles} upsellsByOrder={upsellsByOrder} remittances={remittances || []} profile={profile} refresh={refresh} />}
      {tab === 'expenses' && <ExpensesPage products={products} productSets={productSets} profiles={profiles} session={session} />}
      {tab === 'costs' && <ProductCostsPage products={products} />}
    </div>
  );
}

// ---------- Outstanding / pending payments — money not yet confirmed received ----------
// Delivered orders that haven't been marked Paid are the urgent case (goods
// already handed over); Partial and not-yet-delivered orders are shown too
// so admin has one place that answers "who still owes us money".
function OutstandingPaymentsPage({ orders, profiles, upsellsByOrder, profile }) {
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | delivered | partial | pending

  const unpaid = orders.filter(o => o.payment_status !== 'Paid' && o.status !== 'Cancelled');
  const rows = unpaid.map(o => {
    const current = getCurrentPackage(o, upsellsByOrder && upsellsByOrder[o.id]);
    return { order: o, amount: current.amount, bucket: o.status === 'Delivered' ? 'delivered' : (o.payment_status === 'Partial' ? 'partial' : 'pending') };
  }).sort((a, b) => new Date(b.order.created_at) - new Date(a.order.created_at));

  const filtered = filter === 'all' ? rows : rows.filter(r => r.bucket === filter);
  const totalOutstanding = rows.reduce((s, r) => s + r.amount, 0);
  const deliveredOutstanding = rows.filter(r => r.bucket === 'delivered').reduce((s, r) => s + r.amount, 0);
  const partialCount = rows.filter(r => r.bucket === 'partial').length;
  const pendingCount = rows.filter(r => r.bucket === 'pending').length;

  const personName = id => (profiles.find(p => p.id === id) || {}).full_name || '—';

  async function markPaid(o) {
    setBusyId(o.id);
    try {
      await supabase.from('orders').update({ payment_status: 'Paid' }).eq('id', o.id);
      await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Payment confirmed — marked as Paid.' });
      await recordCommissionForOrder(o);
      await recordFreeCommissionForOrder(o);
      await supabase.rpc('sync_upsells_for_order', { p_order_id: o.id });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Outstanding payments</h1><p className="page-sub">Every order that isn't marked Paid yet — who owes what, and since when.</p></div>
      </div>
      <div className="stats" style={{ marginBottom: '18px' }}>
        <div className="stat"><div className="stat-num">₦{totalOutstanding.toLocaleString()}</div><div className="stat-label">Total outstanding</div></div>
        <div className="stat"><div className="stat-num">₦{deliveredOutstanding.toLocaleString()}</div><div className="stat-label">Delivered but unpaid — most urgent</div></div>
        <div className="stat"><div className="stat-num">{partialCount}</div><div className="stat-label">Partial payments</div></div>
        <div className="stat"><div className="stat-num">{pendingCount}</div><div className="stat-label">Not yet delivered</div></div>
      </div>
      <div className="product-tabs" style={{ marginBottom: '14px' }}>
        <span className={'ptab' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>All ({rows.length})</span>
        <span className={'ptab' + (filter === 'delivered' ? ' active' : '')} onClick={() => setFilter('delivered')}>Delivered, unpaid ({rows.filter(r => r.bucket === 'delivered').length})</span>
        <span className={'ptab' + (filter === 'partial' ? ' active' : '')} onClick={() => setFilter('partial')}>Partial ({partialCount})</span>
        <span className={'ptab' + (filter === 'pending' ? ' active' : '')} onClick={() => setFilter('pending')}>Pending delivery ({pendingCount})</span>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">Nothing outstanding here — all clear.</div>
      ) : (
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Staff</th><th>Dispatch</th><th>Status</th><th>Amount</th><th>Since</th><th></th></tr></thead>
          <tbody>
            {filtered.map(({ order: o, amount }) => (
              <tr key={o.id}>
                <td className="oid">{o.serial_number ? '#' + o.serial_number : o.id.slice(0, 8)}</td>
                <td>{o.customer}</td>
                <td>{o.staff_id ? personName(o.staff_id) : '—'}</td>
                <td>{o.dispatch_id ? personName(o.dispatch_id) : '—'}</td>
                <td><span className={'pill ' + pillClass(o.status)}>{o.status}</span></td>
                <td style={{ fontWeight: 600 }}>₦{amount.toLocaleString()} <span style={{ fontSize: '10.5px', fontWeight: 400, color: '#8A93A0' }}>({o.payment_status || 'Unpaid'})</span></td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                <td><button className="link-btn" disabled={busyId === o.id} onClick={() => markPaid(o)}>{busyId === o.id ? 'Saving…' : 'Mark Paid'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Dispatch remittance — cash a dispatch agent is holding vs has handed in ----------
// payment_status='Paid' only means "someone confirmed this money came in" —
// for a COD order that's the moment the agent collects cash at the door,
// which is a different event from the agent later handing that cash to the
// office. There's no per-order "remitted" flag for that second event on
// purpose: agents remit accumulated cash periodically, not per delivery. So
// "collected" is computed fresh from delivered+paid+COD orders (never
// stored/duplicated — same principle as reserved stock in migration_v56),
// and "outstanding" is collected minus the sum of logged remittances.
//
// "Delivery attempts" needs no schema either — it's read straight from the
// existing order_events log: every status_change landing on Unreachable,
// Rescheduled or Failed Delivery was a doorstep attempt that didn't finish
// the job, so attempts = those events + 1 for the final outcome.
const FAILED_ATTEMPT_STATUSES = ['Unreachable', 'Rescheduled', 'Failed Delivery'];

function RemittancePage({ orders, profiles, upsellsByOrder, remittances, profile, refresh }) {
  const [attemptEvents, setAttemptEvents] = useState([]);
  const [loadingAttempts, setLoadingAttempts] = useState(true);
  const [recordingFor, setRecordingFor] = useState(null); // agent object
  const [removing, setRemoving] = useState(null); // remittance id

  useEffect(() => { loadAttempts(); }, []);
  async function loadAttempts() {
    setLoadingAttempts(true);
    const { data } = await supabase.from('order_events').select('order_id, to_status').eq('event_type', 'status_change').in('to_status', FAILED_ATTEMPT_STATUSES);
    setAttemptEvents(data || []);
    setLoadingAttempts(false);
  }

  const attemptCounts = {};
  attemptEvents.forEach(e => { attemptCounts[e.order_id] = (attemptCounts[e.order_id] || 0) + 1; });

  const dispatchAgents = profiles.filter(p => p.role === 'dispatch');

  const rows = dispatchAgents.map(agent => {
    const codDelivered = orders.filter(o => o.dispatch_id === agent.id && o.status === 'Delivered' && o.payment_status === 'Paid' && (o.payment_method || 'COD') === 'COD');
    const collected = codDelivered.reduce((s, o) => s + getCurrentPackage(o, upsellsByOrder && upsellsByOrder[o.id]).amount, 0);
    const agentRemittances = remittances.filter(r => r.dispatch_id === agent.id);
    const remitted = agentRemittances.reduce((s, r) => s + Number(r.amount || 0), 0);
    const outstanding = Math.max(0, collected - remitted);
    const finished = orders.filter(o => o.dispatch_id === agent.id && (o.status === 'Delivered' || o.status === 'Cancelled'));
    const totalAttempts = finished.reduce((s, o) => s + (attemptCounts[o.id] || 0) + 1, 0);
    const avgAttempts = finished.length > 0 ? (totalAttempts / finished.length) : 0;
    return { agent, codCount: codDelivered.length, collected, remitted, outstanding, avgAttempts, remittances: agentRemittances };
  }).sort((a, b) => b.outstanding - a.outstanding);

  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalCollected = rows.reduce((s, r) => s + r.collected, 0);
  const totalRemitted = rows.reduce((s, r) => s + r.remitted, 0);

  const recentRemittances = [...remittances].sort((a, b) => new Date(b.remittance_date) - new Date(a.remittance_date) || new Date(b.created_at) - new Date(a.created_at)).slice(0, 40);
  const agentName = id => (profiles.find(p => p.id === id) || {}).full_name || '—';

  async function removeRemittance(r) {
    if (!confirm('Remove this remittance entry? This only corrects a mistaken log — it doesn\'t change any order.')) return;
    setRemoving(r.id);
    await supabase.from('remittances').delete().eq('id', r.id);
    setRemoving(null);
    refresh();
  }

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Dispatch remittance</h1><p className="page-sub">Cash on hand per dispatch agent from COD deliveries — what they've collected, what they've handed in, and what's still outstanding. Separate from "Outstanding payments", which tracks orders no one has confirmed receiving money for yet.</p></div>
      </div>
      <div className="stats" style={{ marginBottom: '18px' }}>
        <div className="stat"><div className="stat-num">₦{totalCollected.toLocaleString()}</div><div className="stat-label">Total collected (COD, delivered)</div></div>
        <div className="stat"><div className="stat-num">₦{totalRemitted.toLocaleString()}</div><div className="stat-label">Total remitted</div></div>
        <div className="stat"><div className="stat-num">₦{totalOutstanding.toLocaleString()}</div><div className="stat-label">Outstanding cash</div></div>
      </div>
      {dispatchAgents.length === 0 ? <div className="empty">No dispatch agents yet.</div> : (
        <table>
          <thead><tr><th>Agent</th><th>COD delivered</th><th>Collected</th><th>Remitted</th><th>Outstanding</th><th>Avg. delivery attempts</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.agent.id}>
                <td>{r.agent.full_name}</td>
                <td>{r.codCount}</td>
                <td>₦{r.collected.toLocaleString()}</td>
                <td>₦{r.remitted.toLocaleString()}</td>
                <td style={{ fontWeight: 600, color: r.outstanding > 0 ? '#B0483F' : undefined }}>₦{r.outstanding.toLocaleString()}</td>
                <td style={{ color: '#8A93A0' }}>{loadingAttempts ? '…' : r.avgAttempts.toFixed(1)}</td>
                <td><button className="link-btn" onClick={() => setRecordingFor(r.agent)}>Record remittance</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', margin: '28px 0 6px' }}>Recent remittances</h3>
      {recentRemittances.length === 0 ? <div className="empty">No remittances logged yet.</div> : (
        <table>
          <thead><tr><th>Date</th><th>Agent</th><th>Amount</th><th>Note</th><th>Recorded by</th><th></th></tr></thead>
          <tbody>
            {recentRemittances.map(r => (
              <tr key={r.id}>
                <td>{r.remittance_date}</td>
                <td>{agentName(r.dispatch_id)}</td>
                <td style={{ fontWeight: 600 }}>₦{Number(r.amount || 0).toLocaleString()}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{r.note || '—'}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{r.recorded_by_name || '—'}</td>
                <td><button className="link-btn" disabled={removing === r.id} onClick={() => removeRemittance(r)}>{removing === r.id ? 'Removing…' : 'Remove'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {recordingFor && (
        <RecordRemittanceModal agent={recordingFor} profile={profile} onClose={() => { setRecordingFor(null); refresh(); }} />
      )}
    </div>
  );
}

function RecordRemittanceModal({ agent, profile, onClose }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('remittances').insert({
      dispatch_id: agent.id,
      amount: amt,
      remittance_date: date,
      note: note.trim() || null,
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Record remittance — {agent.full_name}</h3>
        <label>Amount received (₦)</label>
        <input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" autoFocus />
        <label>Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <label>Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. cash handed in at office" />
        {error && <p style={{ fontSize: '11.5px', color: '#B0483F' }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record remittance'}</button>
        </div>
      </div>
    </div>
  );
}

function ProductCostsPage({ products }) {
  const [costs, setCosts] = useState({}); // product_id -> { cost_price, packaging_cost }
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const channel = supabase.channel('product-costs-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_costs' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('product_costs').select('*');
    const map = {};
    (data || []).forEach(c => { map[c.product_id] = c; });
    setCosts(map);
    setLoading(false);
  }

  function fieldValue(p, field) {
    return edits[p.id]?.[field] ?? (costs[p.id] ? costs[p.id][field] : 0) ?? 0;
  }
  function setField(p, field, val) {
    setEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], [field]: val } }));
  }
  async function save(p) {
    const cost_price = parseFloat(fieldValue(p, 'cost_price')) || 0;
    const packaging_cost = parseFloat(fieldValue(p, 'packaging_cost')) || 0;
    setSaving(prev => ({ ...prev, [p.id]: true }));
    const { error } = await supabase.from('product_costs').upsert({ product_id: p.id, cost_price, packaging_cost, updated_at: new Date().toISOString() });
    setSaving(prev => ({ ...prev, [p.id]: false }));
    if (error) { alert(error.message); return; }
    setCosts(prev => ({ ...prev, [p.id]: { product_id: p.id, cost_price, packaging_cost } }));
  }

  if (loading) return <div className="loading">Loading product costs…</div>;

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Product costs</h1><p className="page-sub">What it actually costs the company per unit — this is what the Profitability report subtracts from revenue. Cost price excludes freight-in; log that separately as a Waybill expense.</p></div></div>
      {products.length === 0 ? <div className="empty">No products added yet.</div> : (
        <table>
          <thead><tr><th>Product</th><th>Sells for (default)</th><th>Cost price (₦)</th><th>Packaging cost (₦)</th><th></th></tr></thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td style={{ color: '#8A93A0' }}>{p.default_price ? `₦${Number(p.default_price).toLocaleString()}` : '—'}</td>
                <td>
                  <input type="number" min="0" value={fieldValue(p, 'cost_price')} onChange={e => setField(p, 'cost_price', e.target.value)}
                    style={{ width: '110px', fontSize: '12px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
                </td>
                <td>
                  <input type="number" min="0" value={fieldValue(p, 'packaging_cost')} onChange={e => setField(p, 'packaging_cost', e.target.value)}
                    style={{ width: '110px', fontSize: '12px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
                </td>
                <td><button className="link-btn" onClick={() => save(p)} disabled={saving[p.id]}>{saving[p.id] ? 'Saving…' : 'Save'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '10px' }}>A Set's cost is worked out automatically from its component products' cost + packaging prices. A Package's cost uses its base product's cost + packaging, plus the free gift's own cost + packaging if it has one.</p>
    </div>
  );
}

function ExpensesPage({ products, productSets, profiles, session }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('waybill');
  const [channel, setChannel] = useState('');
  const [targetType, setTargetType] = useState('none');
  const [targetId, setTargetId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterMonth, setFilterMonth] = useState('');

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const channel = supabase.channel('expenses-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false });
    setExpenses(data || []);
    setLoading(false);
  }

  function resetForm() {
    setChannel(''); setTargetType('none'); setTargetId(''); setStaffId(''); setAmount(''); setNotes('');
  }

  async function addExpense() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { alert('Enter a valid amount.'); return; }
    if (category === 'salary' && !staffId) { alert('Pick who this salary is for.'); return; }
    setSaving(true);
    const payload = {
      category,
      channel: category === 'ad_spend' ? (channel.trim() || null) : null,
      product_id: targetType === 'product' && targetId ? targetId : null,
      set_id: targetType === 'set' && targetId ? targetId : null,
      staff_id: category === 'salary' ? staffId : null,
      amount: amt,
      expense_date: expenseDate,
      notes: notes.trim() || null,
      created_by: session?.user?.id || null,
    };
    const { error } = await supabase.from('expenses').insert(payload);
    setSaving(false);
    if (error) { alert(error.message); return; }
    resetForm();
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this expense entry? This will change past Profitability numbers.')) return;
    await supabase.from('expenses').delete().eq('id', id);
    load();
  }

  const filtered = expenses.filter(e => {
    if (filterCategory !== 'all' && e.category !== filterCategory) return false;
    if (filterMonth && String(e.expense_date).slice(0, 7) !== filterMonth) return false;
    return true;
  });
  const totalFiltered = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);

  function labelFor(e) {
    if (e.product_id) return (products.find(p => p.id === e.product_id) || {}).name || '—';
    if (e.set_id) return ((productSets || []).find(s => s.id === e.set_id) || {}).name || '—';
    if (e.staff_id) return (profiles.find(p => p.id === e.staff_id) || {}).full_name || '—';
    return 'General / company-wide';
  }

  if (loading) return <div className="loading">Loading expenses…</div>;

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Expenses</h1><p className="page-sub">Log every real cost outside individual orders — freight getting stock from the manufacturer to the office or an agent, ad spend, salaries, and other overhead. These feed straight into the Profitability report.</p></div></div>

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '22px', maxWidth: '540px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Category</label>
        <select value={category} onChange={e => { setCategory(e.target.value); resetForm(); }} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '12px' }}>
          {EXPENSE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>

        {category === 'ad_spend' && (
          <>
            <label className="field-label">Channel</label>
            <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="e.g. Facebook, TikTok, Google" style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '12px' }} />
          </>
        )}

        {(category === 'waybill' || category === 'ad_spend') && (
          <>
            <label className="field-label">Which product/set was this for? (optional)</label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <select value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(''); }} style={{ padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
                <option value="none">Not tied to one</option>
                <option value="product">A product</option>
                <option value="set">A set</option>
              </select>
              {targetType === 'product' && (
                <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ flex: 1, padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
                  <option value="">Choose product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {targetType === 'set' && (
                <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ flex: 1, padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
                  <option value="">Choose set…</option>
                  {(productSets || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '0', marginBottom: '12px' }}>Tagging it counts this cost against that product/set in the Profitability report. Leave untagged and it's counted as general company overhead instead.</p>
          </>
        )}

        {category === 'salary' && (
          <>
            <label className="field-label">Staff member</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '12px' }}>
              <option value="">Choose…</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>)}
            </select>
          </>
        )}

        <div className="row2" style={{ marginBottom: '12px' }}>
          <div>
            <label className="field-label" style={{ marginTop: 0 }}>Amount (₦)</label>
            <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
          </div>
          <div>
            <label className="field-label" style={{ marginTop: 0 }}>Date</label>
            <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
          </div>
        </div>
        <label className="field-label">Notes (optional)</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. GIG Logistics waybill for 200 units to Lagos office" style={{ width: '100%', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px', marginBottom: '12px' }} />
        <button className="btn primary" onClick={addExpense} disabled={saving} style={{ width: '100%' }}>{saving ? 'Saving…' : 'Add expense'}</button>
      </div>

      <div className="product-tabs" style={{ marginBottom: '12px' }}>
        <span className={'ptab' + (filterCategory === 'all' ? ' active' : '')} onClick={() => setFilterCategory('all')}>All</span>
        {EXPENSE_CATEGORIES.map(c => (
          <span key={c.key} className={'ptab' + (filterCategory === c.key ? ' active' : '')} onClick={() => setFilterCategory(c.key)}>{c.label}</span>
        ))}
      </div>
      <div style={{ marginBottom: '12px' }}>
        <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
      </div>

      <div className="stats" style={{ marginBottom: '14px' }}>
        <div className="stat"><div className="stat-num">₦{totalFiltered.toLocaleString()}</div><div className="stat-label">Total ({filtered.length} entries)</div></div>
      </div>

      {filtered.length === 0 ? <div className="empty">No expenses logged for this filter yet.</div> : (
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Channel</th><th>Tied to</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id}>
                <td>{e.expense_date}</td>
                <td>{(EXPENSE_CATEGORIES.find(c => c.key === e.category) || {}).label || e.category}</td>
                <td>{e.channel || '—'}</td>
                <td>{labelFor(e)}</td>
                <td>₦{Number(e.amount).toLocaleString()}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{e.notes || '—'}</td>
                <td><button className="tiny-x" onClick={() => remove(e.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function money(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-₦' : '₦') + Math.abs(v).toLocaleString();
}

export function ProfitabilityPage({ products, productSets, packages, orders }) {
  const [range, setRange] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [commissionLedger, setCommissionLedger] = useState([]);
  const [upsellsByOrder, setUpsellsByOrder] = useState({});
  const [setItems, setSetItems] = useState([]);
  const [productCosts, setProductCosts] = useState({});
  const [loading, setLoading] = useState(true);
  const [focusedKey, setFocusedKey] = useState(null);
  const [expandedKeys, setExpandedKeys] = useState({});
  const [filterText, setFilterText] = useState('');

  async function loadFinanceData() {
    const [{ data: exp }, { data: ledger }, { data: upsells }, { data: items }, { data: costs }] = await Promise.all([
      supabase.from('expenses').select('*'),
      supabase.from('commission_ledger').select('*').eq('reversed', false),
      supabase.from('upsells').select('*'),
      supabase.from('product_set_items').select('*'),
      supabase.from('product_costs').select('*'),
    ]);
    setExpenses(exp || []);
    setCommissionLedger(ledger || []);
    const map = {};
    (upsells || []).forEach(u => { if (!map[u.original_order_id]) map[u.original_order_id] = []; map[u.original_order_id].push(u); });
    setUpsellsByOrder(map);
    setSetItems(items || []);
    const costMap = {};
    (costs || []).forEach(c => { costMap[c.product_id] = c; });
    setProductCosts(costMap);
    setLoading(false);
  }

  useEffect(() => { loadFinanceData(); }, []);

  // Live: this report is only as good as the freshest expense/commission/cost
  // data, and it's often left open on a screen — so any relevant change from
  // anywhere else in the CRM refetches it automatically.
  useEffect(() => {
    let debounceTimer = null;
    function scheduleRefresh() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { loadFinanceData(); }, 400);
    }
    const channel = supabase.channel('profitability-live');
    ['expenses', 'commission_ledger', 'upsells', 'product_set_items', 'product_costs'].forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    });
    channel.subscribe();
    return () => { clearTimeout(debounceTimer); supabase.removeChannel(channel); };
  }, []);

  if (loading) return <div className="loading">Loading profitability…</div>;

  const commissionByOrder = {};
  commissionLedger.forEach(c => { commissionByOrder[c.order_id] = (commissionByOrder[c.order_id] || 0) + Number(c.amount || 0); });

  const setItemsBySet = {};
  setItems.forEach(i => { if (!setItemsBySet[i.set_id]) setItemsBySet[i.set_id] = []; setItemsBySet[i.set_id].push(i); });

  function costFor(productId) {
    return productCosts[productId] || { cost_price: 0, packaging_cost: 0 };
  }

  function getLine(o) {
    const current = getCurrentPackage(o, upsellsByOrder[o.id]);
    if (current.setId) {
      const set = (productSets || []).find(s => s.id === current.setId);
      return { type: 'set', id: current.setId, name: (set ? set.name : 'Unknown set') + ' (Set)', quantity: current.quantity || 1, amount: current.amount || 0, tagProductId: null, tagSetId: current.setId, set };
    }
    if (current.packageId) {
      const pkg = (packages || []).find(p => p.id === current.packageId);
      const baseProduct = pkg ? products.find(p => p.id === pkg.product_id) : null;
      return { type: 'package', id: current.packageId, name: (baseProduct ? baseProduct.name + ' — ' : '') + (pkg ? pkg.name : 'Unknown package'), quantity: current.quantity || 1, amount: current.amount || 0, tagProductId: pkg ? pkg.product_id : null, tagSetId: null, pkg, baseProduct };
    }
    const product = products.find(p => p.id === current.productId);
    return { type: 'product', id: current.productId || 'unknown', name: product ? product.name : 'Unknown product', quantity: current.quantity || 1, amount: current.amount || 0, tagProductId: current.productId || null, tagSetId: null, product };
  }

  function unitCogs(line) {
    if (line.type === 'set') return (setItemsBySet[line.id] || []).reduce((s, i) => s + Number(costFor(i.product_id).cost_price || 0) * Number(i.quantity_per_set || 1), 0);
    if (line.type === 'package') return line.baseProduct ? Number(costFor(line.baseProduct.id).cost_price || 0) : 0;
    return line.product ? Number(costFor(line.product.id).cost_price || 0) : 0;
  }
  function unitPackaging(line) {
    if (line.type === 'set') return (setItemsBySet[line.id] || []).reduce((s, i) => s + Number(costFor(i.product_id).packaging_cost || 0) * Number(i.quantity_per_set || 1), 0);
    if (line.type === 'package') return line.baseProduct ? Number(costFor(line.baseProduct.id).packaging_cost || 0) : 0;
    return line.product ? Number(costFor(line.product.id).packaging_cost || 0) : 0;
  }
  function unitGift(line) {
    if (line.type !== 'package' || !line.pkg || !line.pkg.gift_product_id) return 0;
    const gift = products.find(p => p.id === line.pkg.gift_product_id);
    if (!gift) return 0;
    const gc = costFor(gift.id);
    return (Number(gc.cost_price || 0) + Number(gc.packaging_cost || 0)) * Number(line.pkg.gift_quantity || 0);
  }

  // Builds the per-line breakdown plus clean, non-duplicated company totals
  // for one set of orders + one set of expenses.
  function buildStats(ordersList, expensesList) {
    const lines = {};
    ordersList.forEach(o => {
      const line = getLine(o);
      const key = line.type + ':' + line.id;
      if (!lines[key]) lines[key] = { key, name: line.name, type: line.type, tagProductId: line.tagProductId, tagSetId: line.tagSetId, orders: 0, deliveredPaid: 0, revenue: 0, cogs: 0, packaging: 0, delivery: 0, commission: 0, gift: 0, waybill: 0, adSpend: 0 };
      const L = lines[key];
      L.orders += 1;
      if (o.status === 'Delivered' && o.payment_status === 'Paid') {
        L.deliveredPaid += 1;
        L.revenue += Number(line.amount || 0);
        L.cogs += unitCogs(line) * line.quantity;
        L.packaging += unitPackaging(line) * line.quantity;
        L.gift += unitGift(line) * line.quantity;
        L.delivery += Number(o.delivery_fee || 0);
        L.commission += commissionByOrder[o.id] || 0;
      }
    });
    // Tag waybill/ad spend onto every line that shares that product (a
    // product's packages share its freight/marketing cost) or that set.
    expensesList.forEach(e => {
      if (e.category !== 'waybill' && e.category !== 'ad_spend') return;
      Object.values(lines).forEach(L => {
        const matches = (e.product_id && L.tagProductId === e.product_id) || (e.set_id && L.tagSetId === e.set_id);
        if (matches) { if (e.category === 'waybill') L.waybill += Number(e.amount || 0); else L.adSpend += Number(e.amount || 0); }
      });
    });
    const lineArray = Object.values(lines).map(L => ({
      ...L,
      closingRate: L.orders > 0 ? L.deliveredPaid / L.orders : 0,
      grossProfit: L.revenue - L.cogs - L.packaging - L.gift,
      netProfit: L.revenue - L.cogs - L.packaging - L.delivery - L.commission - L.gift - L.waybill - L.adSpend,
    })).sort((a, b) => b.netProfit - a.netProfit);

    // Company totals computed independently (never by summing the per-line
    // waybill/ad spend, since those can be tagged to more than one line —
    // e.g. a product and its packages — and would double-count here).
    const paidOrders = ordersList.filter(o => o.status === 'Delivered' && o.payment_status === 'Paid');
    const revenue = lineArray.reduce((s, L) => s + L.revenue, 0);
    const cogs = lineArray.reduce((s, L) => s + L.cogs, 0);
    const packaging = lineArray.reduce((s, L) => s + L.packaging, 0);
    const delivery = lineArray.reduce((s, L) => s + L.delivery, 0);
    const commission = lineArray.reduce((s, L) => s + L.commission, 0);
    const gift = lineArray.reduce((s, L) => s + L.gift, 0);
    const waybill = expensesList.filter(e => e.category === 'waybill').reduce((s, e) => s + Number(e.amount || 0), 0);
    const adSpend = expensesList.filter(e => e.category === 'ad_spend').reduce((s, e) => s + Number(e.amount || 0), 0);
    const salary = expensesList.filter(e => e.category === 'salary').reduce((s, e) => s + Number(e.amount || 0), 0);
    const other = expensesList.filter(e => e.category === 'other').reduce((s, e) => s + Number(e.amount || 0), 0);
    const grossProfit = revenue - cogs - packaging - gift;
    const netProfit = revenue - cogs - packaging - delivery - commission - gift - waybill - adSpend - salary - other;
    const closingRate = ordersList.length > 0 ? paidOrders.length / ordersList.length : 0;
    return {
      lines: lineArray,
      totals: { orders: ordersList.length, deliveredPaid: paidOrders.length, closingRate, revenue, cogs, packaging, delivery, commission, gift, waybill, adSpend, salary, other, grossProfit, netProfit },
    };
  }

  // Rolls per-line results (which count each PACKAGE as its own line) up to
  // one row per real, sellable entity — a product (with every one of its
  // packages, plus any bare/no-package sales, combined into it) or a set.
  // This is what keeps the report readable as more packages get added to a
  // product: the row count only grows when a NEW product/set is added, not
  // every time a variant is. Seeded from the full product/set lists so a
  // brand-new item with zero orders still shows up (at zero) rather than
  // only appearing once it has history.
  function buildGroups(lineArray, expensesList) {
    const groups = {};
    products.forEach(p => {
      groups['product:' + p.id] = { key: 'product:' + p.id, kind: 'product', id: p.id, name: p.name, sku: p.sku || '', orders: 0, deliveredPaid: 0, revenue: 0, cogs: 0, packaging: 0, delivery: 0, commission: 0, gift: 0, children: [] };
    });
    (productSets || []).forEach(s => {
      groups['set:' + s.id] = { key: 'set:' + s.id, kind: 'set', id: s.id, name: s.name, sku: s.sku || '', orders: 0, deliveredPaid: 0, revenue: 0, cogs: 0, packaging: 0, delivery: 0, commission: 0, gift: 0, children: [] };
    });
    lineArray.forEach(L => {
      const gid = L.type === 'set' ? L.id : (L.tagProductId || L.id);
      const key = (L.type === 'set' ? 'set:' : 'product:') + gid;
      if (!groups[key]) {
        // The product/set behind this line was since deleted — still surface
        // its numbers rather than silently dropping them.
        groups[key] = { key, kind: L.type === 'set' ? 'set' : 'product', id: gid, name: L.name, sku: '', orders: 0, deliveredPaid: 0, revenue: 0, cogs: 0, packaging: 0, delivery: 0, commission: 0, gift: 0, children: [] };
      }
      const G = groups[key];
      G.orders += L.orders;
      G.deliveredPaid += L.deliveredPaid;
      G.revenue += L.revenue;
      G.cogs += L.cogs;
      G.packaging += L.packaging;
      G.delivery += L.delivery;
      G.commission += L.commission;
      G.gift += L.gift;
      G.children.push(L);
    });
    return Object.values(groups).map(G => {
      // Waybill/ad spend computed ONCE per group, straight from the expense
      // ledger — never by summing children's tagged amounts, which would
      // multiply a product's freight/ad cost by however many packages it has.
      const waybill = expensesList.filter(e => e.category === 'waybill' && ((G.kind === 'product' && e.product_id === G.id) || (G.kind === 'set' && e.set_id === G.id))).reduce((s, e) => s + Number(e.amount || 0), 0);
      const adSpend = expensesList.filter(e => e.category === 'ad_spend' && ((G.kind === 'product' && e.product_id === G.id) || (G.kind === 'set' && e.set_id === G.id))).reduce((s, e) => s + Number(e.amount || 0), 0);
      const grossProfit = G.revenue - G.cogs - G.packaging - G.gift;
      const netProfit = G.revenue - G.cogs - G.packaging - G.delivery - G.commission - G.gift - waybill - adSpend;
      return { ...G, waybill, adSpend, closingRate: G.orders > 0 ? G.deliveredPaid / G.orders : 0, grossProfit, netProfit, children: G.children.sort((a, b) => b.revenue - a.revenue) };
    }).sort((a, b) => (b.orders > 0) - (a.orders > 0) || b.netProfit - a.netProfit || a.name.localeCompare(b.name));
  }

  function inDateRange(dateStr) {
    if (!dateStr) return range === 'all';
    const d = new Date(dateStr);
    const now = new Date();
    if (range === 'all') return true;
    if (range === 'today') return d.toDateString() === now.toDateString();
    if (range === '7d') return now - d <= 7 * 24 * 60 * 60 * 1000;
    if (range === '30d') return now - d <= 30 * 24 * 60 * 60 * 1000;
    if (range === 'thismonth') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (range === 'custom') {
      if (fromDate && d < new Date(fromDate)) return false;
      if (toDate && d > new Date(toDate + 'T23:59:59')) return false;
      return true;
    }
    return true;
  }

  const scopedOrders = orders.filter(o => inDateRange(o.created_at));
  const scopedExpenses = expenses.filter(e => inDateRange(e.expense_date));
  const { lines, totals } = buildStats(scopedOrders, scopedExpenses);
  const groups = buildGroups(lines, scopedExpenses);
  const filteredGroups = filterText.trim()
    ? groups.filter(g => g.name.toLowerCase().includes(filterText.trim().toLowerCase()) || (g.sku || '').toLowerCase().includes(filterText.trim().toLowerCase()))
    : groups;
  const focusedGroup = focusedKey ? groups.find(g => g.key === focusedKey) : null;

  // "Best month" and "Best product" always look across the FULL history,
  // regardless of whatever range is selected above — the point is to answer
  // "what's our best month/product ever", not "best within my current filter".
  const monthKeys = [...new Set(orders.filter(o => o.status === 'Delivered' && o.payment_status === 'Paid' && o.created_at).map(o => String(o.created_at).slice(0, 7)))];
  const monthlyRows = monthKeys.map(mk => {
    const monthOrders = orders.filter(o => String(o.created_at).slice(0, 7) === mk);
    const monthExpenses = expenses.filter(e => String(e.expense_date).slice(0, 7) === mk);
    const { totals: mt } = buildStats(monthOrders, monthExpenses);
    return { month: mk, ...mt };
  }).sort((a, b) => b.month.localeCompare(a.month));
  const bestMonth = monthlyRows.slice().sort((a, b) => b.netProfit - a.netProfit)[0];

  const { lines: allTimeLines } = buildStats(orders, expenses);
  const bestProduct = allTimeLines.filter(l => l.orders > 0).slice().sort((a, b) => b.netProfit - a.netProfit)[0];

  const profitColor = totals.netProfit >= 0 ? '#3730A3' : '#B0483F';

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Profitability</h1><p className="page-sub">Real revenue in, real cost out — per product/set, and for the whole company. Only Delivered &amp; Paid orders count as revenue.</p></div></div>

      <div className="product-tabs">
        <span className={'ptab' + (range === 'today' ? ' active' : '')} onClick={() => setRange('today')}>Today</span>
        <span className={'ptab' + (range === '7d' ? ' active' : '')} onClick={() => setRange('7d')}>Last 7 days</span>
        <span className={'ptab' + (range === '30d' ? ' active' : '')} onClick={() => setRange('30d')}>Last 30 days</span>
        <span className={'ptab' + (range === 'thismonth' ? ' active' : '')} onClick={() => setRange('thismonth')}>This month</span>
        <span className={'ptab' + (range === 'all' ? ' active' : '')} onClick={() => setRange('all')}>All time</span>
        <span className={'ptab' + (range === 'custom' ? ' active' : '')} onClick={() => setRange('custom')}>Custom range</span>
      </div>
      {range === 'custom' && (
        <div className="row2" style={{ maxWidth: '420px', margin: '12px 0 16px' }}>
          <div><label className="field-label" style={{ marginTop: 0 }}>From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
          <div><label className="field-label" style={{ marginTop: 0 }}>To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', margin: '18px 0' }}>
        {bestMonth && (
          <div style={{ background: '#FBF6EC', border: '1px solid #E8DDBE', borderRadius: '8px', padding: '14px 18px', flex: '1 1 260px' }}>
            <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px' }}>🏆 Best month ever</div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>{monthLabel(bestMonth.month)}</div>
            <div style={{ fontSize: '13px', color: bestMonth.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(bestMonth.netProfit)} net profit · {money(bestMonth.revenue)} revenue</div>
          </div>
        )}
        {bestProduct && (
          <div style={{ background: '#ECEAFB', border: '1px solid #C7C2F0', borderRadius: '8px', padding: '14px 18px', flex: '1 1 260px' }}>
            <div style={{ fontSize: '11px', color: '#8A93A0', marginBottom: '4px' }}>🏆 Best performing product/set ever</div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>{bestProduct.name}</div>
            <div style={{ fontSize: '13px', color: '#3730A3' }}>{money(bestProduct.netProfit)} net profit · {(bestProduct.closingRate * 100).toFixed(0)}% closing rate</div>
          </div>
        )}
      </div>

      {monthlyRows.length > 1 && (
        <>
          <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '4px' }}>Monthly trend</h3>
          <p style={{ fontSize: '12px', color: '#8A93A0', margin: '0 0 10px' }}>Full history, regardless of the range picked above — most recent first.</p>
          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table>
              <thead><tr><th>Month</th><th>Orders</th><th>Delivered &amp; paid</th><th>Revenue</th><th>Gross profit</th><th>Net profit</th></tr></thead>
              <tbody>
                {monthlyRows.map(m => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td>{m.orders}</td>
                    <td>{m.deliveredPaid}</td>
                    <td>{money(m.revenue)}</td>
                    <td style={{ color: m.grossProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(m.grossProfit)}</td>
                    <td style={{ fontWeight: 600, color: m.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(m.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Company-wide, for this range</h3>
      <div className="stats" style={{ marginBottom: '10px' }}>
        <div className="stat"><div className="stat-num">{totals.orders}</div><div className="stat-label">Orders placed</div></div>
        <div className="stat"><div className="stat-num">{totals.deliveredPaid}</div><div className="stat-label">Delivered &amp; paid</div></div>
        <div className="stat"><div className="stat-num">{(totals.closingRate * 100).toFixed(1)}%</div><div className="stat-label">Closing rate</div></div>
        <div className="stat"><div className="stat-num">{money(totals.revenue)}</div><div className="stat-label">Revenue</div></div>
        <div className="stat"><div className="stat-num" style={{ color: totals.grossProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(totals.grossProfit)}</div><div className="stat-label">Gross profit</div></div>
        <div className="stat"><div className="stat-num" style={{ color: profitColor }}>{money(totals.netProfit)}</div><div className="stat-label">Net profit / (loss)</div></div>
      </div>
      <p style={{ fontSize: '11px', color: '#8A93A0', margin: '-6px 0 14px' }}>Gross profit = revenue less cost of goods, packaging &amp; free gifts. Net profit also subtracts delivery, commission, waybill, ad spend, salaries &amp; other overhead.</p>
      <div className="stats" style={{ marginBottom: '20px' }}>
        <div className="stat"><div className="stat-num">{money(totals.cogs)}</div><div className="stat-label">Cost of goods</div></div>
        <div className="stat"><div className="stat-num">{money(totals.packaging)}</div><div className="stat-label">Packaging</div></div>
        <div className="stat"><div className="stat-num">{money(totals.delivery)}</div><div className="stat-label">Delivery to customer</div></div>
        <div className="stat"><div className="stat-num">{money(totals.commission)}</div><div className="stat-label">Commission</div></div>
        <div className="stat"><div className="stat-num">{money(totals.gift)}</div><div className="stat-label">Free gifts</div></div>
        <div className="stat"><div className="stat-num">{money(totals.waybill)}</div><div className="stat-label">Waybill / freight-in</div></div>
        <div className="stat"><div className="stat-num">{money(totals.adSpend)}</div><div className="stat-label">Ad spend</div></div>
        <div className="stat"><div className="stat-num">{money(totals.salary)}</div><div className="stat-label">Salaries</div></div>
        <div className="stat"><div className="stat-num">{money(totals.other)}</div><div className="stat-label">Other overhead</div></div>
      </div>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '4px' }}>By product / set, for this range</h3>
      <p style={{ fontSize: '12px', color: '#8A93A0', margin: '0 0 12px' }}>One row per product or set — every package and variant of a product is combined into its row. Pick one below (or click its row) for the full breakdown.</p>

      <div className="row2" style={{ maxWidth: '640px', marginBottom: '14px' }}>
        <div style={{ flex: '1 1 260px' }}>
          <label className="field-label" style={{ marginTop: 0 }}>Jump to a product or set</label>
          <select
            value={focusedKey || ''}
            onChange={e => { setFocusedKey(e.target.value || null); }}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
          >
            <option value="">— All products &amp; sets (overview below) —</option>
            <optgroup label="Products">
              {groups.filter(g => g.kind === 'product').map(g => (
                <option key={g.key} value={g.key}>{g.name}{g.sku ? ` [${g.sku}]` : ''}{g.orders === 0 ? ' — no orders yet' : ''}</option>
              ))}
            </optgroup>
            <optgroup label="Sets">
              {groups.filter(g => g.kind === 'set').map(g => (
                <option key={g.key} value={g.key}>{g.name}{g.sku ? ` [${g.sku}]` : ''}{g.orders === 0 ? ' — no orders yet' : ''}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label className="field-label" style={{ marginTop: 0 }}>Search the table below</label>
          <input
            value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Name or code…"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
          />
        </div>
      </div>

      {focusedGroup && (
        <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <div>
              <span className="pill" style={{ background: focusedGroup.kind === 'set' ? '#ECEAFB' : '#EEF2F8', color: focusedGroup.kind === 'set' ? '#3730A3' : '#4A7FBF', border: '1px solid ' + (focusedGroup.kind === 'set' ? '#C7C2F0' : '#D6E0EE'), marginRight: '8px' }}>{focusedGroup.kind === 'set' ? 'Set' : 'Product'}</span>
              <span style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '18px', fontWeight: 600 }}>{focusedGroup.name}</span>
              {focusedGroup.sku && <span className="pill" style={{ marginLeft: '8px', background: '#F5F2EA', color: '#4B5566', border: '1px solid #DEDAD0', fontFamily: 'monospace', fontSize: '11px' }}>{focusedGroup.sku}</span>}
            </div>
            <button className="link-btn" onClick={() => setFocusedKey(null)}>✕ Clear — show all</button>
          </div>

          {focusedGroup.kind === 'set' && setItemsBySet[focusedGroup.id] && setItemsBySet[focusedGroup.id].length > 0 && (
            <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '-4px', marginBottom: '14px' }}>
              Contains: {setItemsBySet[focusedGroup.id].map(i => `${i.quantity_per_set}× ${(products.find(p => p.id === i.product_id) || {}).name || '—'}`).join(' + ')}
            </p>
          )}

          {focusedGroup.orders === 0 ? (
            <div className="empty">No orders for this {focusedGroup.kind} in this range yet.</div>
          ) : (
            <>
              <div className="stats" style={{ marginBottom: '10px' }}>
                <div className="stat"><div className="stat-num">{focusedGroup.orders}</div><div className="stat-label">Orders</div></div>
                <div className="stat"><div className="stat-num">{focusedGroup.deliveredPaid}</div><div className="stat-label">Delivered &amp; paid</div></div>
                <div className="stat"><div className="stat-num">{(focusedGroup.closingRate * 100).toFixed(0)}%</div><div className="stat-label">Closing rate</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.revenue)}</div><div className="stat-label">Revenue</div></div>
                <div className="stat"><div className="stat-num" style={{ color: focusedGroup.grossProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(focusedGroup.grossProfit)}</div><div className="stat-label">Gross profit</div></div>
                <div className="stat"><div className="stat-num" style={{ color: focusedGroup.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(focusedGroup.netProfit)}</div><div className="stat-label">Net profit / (loss)</div></div>
              </div>
              <div className="stats" style={{ marginBottom: '16px' }}>
                <div className="stat"><div className="stat-num">{money(focusedGroup.cogs)}</div><div className="stat-label">Cost of goods</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.packaging)}</div><div className="stat-label">Packaging</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.delivery)}</div><div className="stat-label">Delivery to customer</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.commission)}</div><div className="stat-label">Commission</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.gift)}</div><div className="stat-label">Free gifts</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.waybill)}</div><div className="stat-label">Waybill / freight-in</div></div>
                <div className="stat"><div className="stat-num">{money(focusedGroup.adSpend)}</div><div className="stat-label">Ad spend</div></div>
              </div>

              {focusedGroup.kind === 'product' && focusedGroup.children.length > 0 && (
                <>
                  <h4 style={{ fontSize: '13px', margin: '0 0 8px', color: '#4B5566' }}>Breakdown by package</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead><tr><th>Package</th><th>Orders</th><th>Closing rate</th><th>Revenue</th><th>Net profit</th></tr></thead>
                      <tbody>
                        {focusedGroup.children.map(c => (
                          <tr key={c.key}>
                            <td>{c.type === 'package' ? c.name.replace(/^.*?—\s*/, '') : 'No package (plain product)'}</td>
                            <td>{c.orders}</td>
                            <td>{(c.closingRate * 100).toFixed(0)}%</td>
                            <td>{money(c.revenue)}</td>
                            <td style={{ fontWeight: 600, color: c.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(c.netProfit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {filteredGroups.length === 0 ? <div className="empty">No products or sets match "{filterText}".</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th></th><th>Product / Set</th><th>Orders</th><th>Closing rate</th><th>Revenue</th><th>COGS</th><th>Packaging</th><th>Delivery</th><th>Commission</th><th>Gift</th><th>Waybill</th><th>Ad spend</th><th>Net profit</th></tr></thead>
            <tbody>
              {filteredGroups.map(G => {
                const canExpand = G.children.length > 0;
                const isOpen = !!expandedKeys[G.key];
                return (
                  <Fragment key={G.key}>
                    <tr
                      onClick={() => setFocusedKey(G.key)}
                      style={{ cursor: 'pointer', opacity: G.orders === 0 ? 0.55 : 1, background: focusedKey === G.key ? '#FBF6EC' : undefined }}
                    >
                      <td style={{ width: '20px' }}>
                        {canExpand && (
                          <span
                            onClick={e => { e.stopPropagation(); setExpandedKeys({ ...expandedKeys, [G.key]: !isOpen }); }}
                            style={{ cursor: 'pointer', color: '#8A93A0', display: 'inline-block', width: '14px' }}
                          >{isOpen ? '▾' : '▸'}</span>
                        )}
                      </td>
                      <td>
                        <span className="pill" style={{ marginRight: '6px', fontSize: '10px', background: G.kind === 'set' ? '#ECEAFB' : '#EEF2F8', color: G.kind === 'set' ? '#3730A3' : '#4A7FBF', border: '1px solid ' + (G.kind === 'set' ? '#C7C2F0' : '#D6E0EE') }}>{G.kind === 'set' ? 'Set' : 'Product'}</span>
                        {G.name}
                        {G.sku && <span style={{ marginLeft: '6px', fontFamily: 'monospace', fontSize: '11px', color: '#8A93A0' }}>[{G.sku}]</span>}
                        {G.orders === 0 && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#8A93A0' }}>— no orders yet</span>}
                      </td>
                      <td>{G.orders}</td>
                      <td>{(G.closingRate * 100).toFixed(0)}%</td>
                      <td>{money(G.revenue)}</td>
                      <td>{money(G.cogs)}</td>
                      <td>{money(G.packaging)}</td>
                      <td>{money(G.delivery)}</td>
                      <td>{money(G.commission)}</td>
                      <td>{money(G.gift)}</td>
                      <td>{money(G.waybill)}</td>
                      <td>{money(G.adSpend)}</td>
                      <td style={{ fontWeight: 600, color: G.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(G.netProfit)}</td>
                    </tr>
                    {isOpen && G.children.map(c => (
                      <tr key={c.key} style={{ background: '#FAFAF7', fontSize: '12px', color: '#4B5566' }}>
                        <td></td>
                        <td style={{ paddingLeft: '28px' }}>↳ {c.type === 'package' ? c.name.replace(/^.*?—\s*/, '') : 'No package (plain product)'}</td>
                        <td>{c.orders}</td>
                        <td>{(c.closingRate * 100).toFixed(0)}%</td>
                        <td>{money(c.revenue)}</td>
                        <td>{money(c.cogs)}</td>
                        <td>{money(c.packaging)}</td>
                        <td>{money(c.delivery)}</td>
                        <td>{money(c.commission)}</td>
                        <td>{money(c.gift)}</td>
                        <td colSpan={2} style={{ color: '#8A93A0' }}>(counted once above)</td>
                        <td style={{ fontWeight: 600, color: c.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(c.netProfit)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: '11px', color: '#8A93A0', margin: '8px 0 24px' }}>Each row is one product or set, no matter how many packages it has — click a row, or use the dropdown above, for the full breakdown. New products and sets appear here automatically, even before their first order.</p>

      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>By month (all time)</h3>
      {monthlyRows.length === 0 ? <div className="empty">No delivered &amp; paid orders yet.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Month</th><th>Orders</th><th>Closing rate</th><th>Revenue</th><th>Total costs</th><th>Net profit</th></tr></thead>
            <tbody>
              {monthlyRows.map(m => (
                <tr key={m.month} style={bestMonth && m.month === bestMonth.month ? { background: '#FBF6EC' } : undefined}>
                  <td>{monthLabel(m.month)} {bestMonth && m.month === bestMonth.month && '🏆'}</td>
                  <td>{m.orders}</td>
                  <td>{(m.closingRate * 100).toFixed(0)}%</td>
                  <td>{money(m.revenue)}</td>
                  <td>{money(m.revenue - m.netProfit)}</td>
                  <td style={{ fontWeight: 600, color: m.netProfit >= 0 ? '#3730A3' : '#B0483F' }}>{money(m.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PackagePicker({ productId, value, onChange }) {
  const [packages, setPackages] = useState([]);
  useEffect(() => {
    if (!productId) { setPackages([]); return; }
    (async () => {
      const { data } = await supabase.from('product_packages').select('*').eq('product_id', productId);
      setPackages(data || []);
    })();
  }, [productId]);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ fontSize: '12px', padding: '6px 8px', flex: '1 1 140px' }}>
      <option value="">— Just the product, no package —</option>
      {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
