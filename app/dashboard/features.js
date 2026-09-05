'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['New', 'Confirmed', 'Preparing', 'Dispatched', 'Delivered', 'Unreachable', 'Rescheduled', 'Cancelled'];

export function statusRowColor(status) {
  const map = {
    New: '#FBF6EC',
    Confirmed: '#EAF4F1',
    Preparing: '#EEEFF9',
    Dispatched: '#EAF3FA',
    Delivered: '#EAF6EA',
    Unreachable: '#FBF0E2',
    Rescheduled: '#F5F0FA',
    Cancelled: '#FBEEED',
  };
  return map[status] || 'transparent';
}

export async function logEvent({ order_id, actor_id, actor_name, event_type, from_status, to_status, note }) {
  await supabase.from('order_events').insert({ order_id, actor_id, actor_name, event_type, from_status, to_status, note });
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

export async function ensureFreeCommission(staffId) {
  const { data: rule } = await supabase.from('free_commission_rules').select('*').eq('active', true).limit(1).maybeSingle();
  if (!rule || !rule.amount || rule.amount <= 0) return;
  const isEligible = !rule.eligible_staff || rule.eligible_staff.length === 0 || rule.eligible_staff.includes(staffId);
  if (!isEligible) return;
  const cycleStart = getCycleStart(new Date());
  const { data: existing } = await supabase.from('commission_ledger').select('id').eq('staff_id', staffId).eq('commission_type', 'free').eq('cycle_start', cycleStart).maybeSingle();
  if (existing) return;
  await supabase.from('commission_ledger').insert({
    staff_id: staffId, product_id: null, amount: rule.amount, commission_type: 'free', cycle_start: cycleStart,
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

export function buildOrderSummary(order, products, packages) {
  const product = (products || []).find(p => p.id === order.product_id);
  const pkg = order.package_id ? (packages || []).find(p => p.id === order.package_id) : null;
  const gift = pkg && pkg.gift_product_id ? (products || []).find(p => p.id === pkg.gift_product_id) : null;
  const lines = [
    `Order: ${order.id}`,
    `Created: ${new Date(order.created_at).toLocaleString()}`,
    `Customer: ${order.customer} (${order.phone || 'no phone'}${order.phone2 ? `, alt: ${order.phone2}` : ''})`,
    `Address: ${order.address || '—'}${order.state ? ', ' + order.state : ''}`,
    `Product: ${product ? product.name : '—'} × ${order.quantity || 1}`,
    pkg ? `Package: ${pkg.name}` : null,
    gift ? `Free gift: ${gift.name} × ${order.gift_quantity}` : null,
    `Status: ${order.status}`,
    `Payment: ${order.payment_status || 'Unpaid'}`,
    order.priority === 'High' ? 'Priority: HIGH' : null,
    order.preferred_time ? `Preferred time: ${order.preferred_time}` : null,
    order.notes ? `Notes: ${order.notes}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function orderTotal(o) {
  const qty = o.quantity || 1;
  const unit = Number(o.unit_price || 0);
  const fee = Number(o.delivery_fee || 0);
  return qty * unit - fee;
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
export function StatusRemarkModal({ order, newStatus, onClose, onConfirm }) {
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

export function ConfirmOrderModal({ order, profile, profiles, onClose, onConfirmed }) {
  const [priority, setPriority] = useState(order.priority || 'Normal');
  const [preferredTime, setPreferredTime] = useState(order.preferred_time || '');
  const [remark, setRemark] = useState('');
  const [statePref, setStatePref] = useState(null);
  const [loadedPref, setLoadedPref] = useState(false);

  const matchingDispatch = (profiles || []).filter(p => p.role === 'dispatch' && p.active && order.state && p.state === order.state);

  useEffect(() => {
    (async () => {
      if (!order.state) { setLoadedPref(true); return; }
      const { data } = await supabase.from('state_dispatch_preference').select('*').eq('state', order.state).maybeSingle();
      setStatePref(data);
      setLoadedPref(true);
    })();
  }, []);

  const preferredAgent = statePref && statePref.active && statePref.dispatch_id
    ? matchingDispatch.find(d => d.id === statePref.dispatch_id)
    : null;
  const chosenAgent = preferredAgent || matchingDispatch[0];
  const willAutoAssign = !order.dispatch_id && !!chosenAgent;

  async function confirm() {
    const patch = {
      status: 'Confirmed', priority, preferred_time: preferredTime.trim(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    };
    if (willAutoAssign) patch.dispatch_id = chosenAgent.id;
    await supabase.from('orders').update(patch).eq('id', order.id);
    await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: order.status, to_status: 'Confirmed' });
    if (willAutoAssign) {
      await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'assigned', note: `Automatically sent to ${chosenAgent.full_name} (${order.state}) on confirmation.` });
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
            ✓ Will automatically send to {chosenAgent.full_name} in {order.state} on confirmation{preferredAgent ? ' (admin-preferred agent)' : ''}.
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(60);
      setMovements(data || []);
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
  const revenue = delivered.reduce((sum, o) => sum + orderTotal(o), 0);
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
                const prodRevenue = prodDelivered.reduce((sum, o) => sum + orderTotal(o), 0);
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
  const isDispatch = person.role === 'dispatch';
  const handled = orders.filter(o => (isDispatch ? o.dispatch_id : o.staff_id) === person.id);
  const byStatus = {};
  STATUSES.forEach(s => { byStatus[s] = handled.filter(o => o.status === s).length; });
  const delivered = handled.filter(o => o.status === 'Delivered');
  const deliveryCharges = delivered.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);
  const avgHours = delivered.length
    ? delivered.reduce((sum, o) => sum + (new Date(o.delivered_at) - new Date(o.created_at)) / 3600000, 0) / delivered.length
    : null;

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
          <div className="stat"><div className="stat-num">{avgHours ? avgHours.toFixed(1) + 'h' : '—'}</div><div className="stat-label">Avg. turnaround</div></div>
          {isDispatch && <div className="stat"><div className="stat-num">₦{deliveryCharges.toLocaleString()}</div><div className="stat-label">Delivery charges collected</div></div>}
        </div>
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
export function SettingsPage({ settings, profiles, refresh }) {
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [statePrefs, setStatePrefs] = useState({});
  const [savingState, setSavingState] = useState('');

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

  async function saveStatePref(state, dispatchId, active) {
    setSavingState(state);
    await supabase.from('state_dispatch_preference').upsert({ state, dispatch_id: dispatchId || null, active, updated_at: new Date().toISOString() });
    await loadStatePrefs();
    setSavingState('');
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Settings</h1><p className="page-sub">Control automatic messaging and manage external dispatch companies.</p></div></div>

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
          return (
            <div key={state} className="list-manage-row">
              <span style={{ minWidth: '100px', display: 'inline-block' }}>{state}</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={pref?.dispatch_id || ''}
                  onChange={e => saveStatePref(state, e.target.value, pref ? pref.active : true)}
                  style={{ fontSize: '12px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                >
                  <option value="">— No preference (first match) —</option>
                  {agentsHere.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </select>
                <button
                  className="btn"
                  onClick={() => saveStatePref(state, pref?.dispatch_id, !(pref ? pref.active : true))}
                  disabled={savingState === state}
                >
                  {pref && !pref.active ? 'Off — turn on' : 'On — turn off'}
                </button>
              </div>
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


export function InventoryPage({ products, orders, refresh }) {
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
    </div>
  );
}

// ---------- Order history / remarks ----------
export function OrderHistoryModal({ order, profile, onClose, onLogged }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [remark, setRemark] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('order_events').select('*').eq('order_id', order.id).order('created_at', { ascending: false });
      setEvents(data || []);
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Order history · {order.customer}</h3>
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
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState('');

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => { load(); }, []);
  async function load() {
    await ensureFreeCommission(profile.id);
    const [{ data: led }, { data: cl }, { data: rateSetting }, { data: daySetting }] = await Promise.all([
      supabase.from('commission_ledger').select('*').eq('staff_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('commission_claims').select('*').eq('staff_id', profile.id).order('claimed_at', { ascending: false }),
      supabase.from('app_settings').select('*').eq('key', 'min_success_rate_to_claim').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day').maybeSingle(),
    ]);
    setLedger(led || []);
    setClaims(cl || []);
    setThreshold(rateSetting ? parseFloat(rateSetting.value) || 0 : 0);
    setClaimDay(daySetting ? parseInt(daySetting.value, 10) : 1);
    setLoading(false);
  }

  const myOrders = orders.filter(o => o.staff_id === profile.id);
  const myDelivered = myOrders.filter(o => o.status === 'Delivered');
  const myDeliveredPaid = myDelivered.filter(o => o.payment_status === 'Paid');
  const successRate = myDelivered.length > 0 ? (myDeliveredPaid.length / myDelivered.length) * 100 : 100;
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
        {freeTotal > 0 && <div style={{ fontSize: '11.5px', opacity: 0.75, marginTop: '2px' }}>Includes ₦{freeTotal.toLocaleString()} in free commission, no orders required</div>}
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
        <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '8px' }}>{myDeliveredPaid.length} paid out of {myDelivered.length} delivered orders you're on.</p>
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
    const [{ data: rateSetting }, { data: daySetting }, { data: freeRule }, { data: rules }] = await Promise.all([
      supabase.from('app_settings').select('*').eq('key', 'min_success_rate_to_claim').maybeSingle(),
      supabase.from('app_settings').select('*').eq('key', 'claim_day').maybeSingle(),
      supabase.from('free_commission_rules').select('*').limit(1).maybeSingle(),
      supabase.from('commission_rules').select('*'),
    ]);
    setThreshold(rateSetting ? parseFloat(rateSetting.value) || 0 : 0);
    setClaimDay(daySetting ? parseInt(daySetting.value, 10) : 1);
    const ruleMap = {};
    (rules || []).forEach(r => { ruleMap[r.product_id] = r; });
    setProductRules(ruleMap);
    if (freeRule) {
      setFreeActive(freeRule.active); setFreeAmount(freeRule.amount); setFreeEligible(freeRule.eligible_staff || []);
      if (freeRule.active) {
        await Promise.all(staffList.map(s => ensureFreeCommission(s.id)));
      }
    }
    const [{ data: led }, { data: cl }] = await Promise.all([
      supabase.from('commission_ledger').select('*'),
      supabase.from('commission_claims').select('*'),
    ]);
    setLedgerAll(led || []);
    setClaimsAll(cl || []);
  }

  async function saveSettings() {
    setSaving(true);
    await Promise.all([
      supabase.from('app_settings').upsert({ key: 'min_success_rate_to_claim', value: String(threshold) }),
      supabase.from('app_settings').upsert({ key: 'claim_day', value: String(claimDay) }),
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
        <button className="btn primary" onClick={saveSettings} disabled={saving} style={{ width: '100%' }}>{saving ? 'Saving…' : 'Save both settings'}</button>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '8px' }}>Success rate = their Delivered-and-Paid orders ÷ all their Delivered orders. Set the rate to 0 to let everyone claim freely regardless of performance.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '16px', marginBottom: '22px', maxWidth: '440px' }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 0, fontWeight: 600 }}>
          Free commission (flat, regardless of performance)
          <span><input type="checkbox" checked={freeActive} onChange={e => setFreeActive(e.target.checked)} /> On</span>
        </label>
        <p style={{ fontSize: '11px', color: '#8A93A0', margin: '4px 0 10px' }}>A separate rule from product commission — every eligible staff member gets this amount added automatically, once per cycle, no order required.</p>
        <label className="field-label">Amount per cycle (₦)</label>
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

      <table>
        <thead><tr><th>Staff</th><th>Joined</th><th>Unclaimed balance</th><th>Success rate</th><th>Eligible?</th><th>Last claim</th></tr></thead>
        <tbody>
          {staffList.length === 0 && <tr><td colSpan="6" className="empty">No staff added yet.</td></tr>}
          {staffList.map(s => {
            const myLedger = ledgerAll.filter(l => l.staff_id === s.id && !l.reversed);
            const myClaims = claimsAll.filter(c => c.staff_id === s.id);
            const earned = myLedger.reduce((sum, l) => sum + Number(l.amount), 0);
            const claimed = myClaims.reduce((sum, c) => sum + Number(c.amount), 0);
            const balance = earned - claimed;
            const myOrders = orders.filter(o => o.staff_id === s.id);
            const delivered = myOrders.filter(o => o.status === 'Delivered');
            const deliveredPaid = delivered.filter(o => o.payment_status === 'Paid');
            const rate = delivered.length > 0 ? (deliveredPaid.length / delivered.length) * 100 : 100;
            const lastClaim = myClaims.sort((a, b) => new Date(b.claimed_at) - new Date(a.claimed_at))[0];
            return (
              <tr key={s.id}>
                <td>{s.full_name}</td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                <td>₦{balance.toLocaleString()}</td>
                <td>{rate.toFixed(0)}%</td>
                <td><span className={'pill ' + (rate >= threshold ? 'Delivered' : 'Cancelled')}>{rate >= threshold ? 'Eligible' : 'Not yet'}</span></td>
                <td style={{ fontSize: '12px', color: '#8A93A0' }}>{lastClaim ? new Date(lastClaim.claimed_at).toLocaleDateString() : 'Never'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
