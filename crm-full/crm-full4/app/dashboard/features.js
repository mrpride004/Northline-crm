'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['New', 'Confirmed', 'Preparing', 'Dispatched', 'Delivered', 'Unreachable', 'Rescheduled', 'Cancelled'];

export async function logEvent({ order_id, actor_id, actor_name, event_type, from_status, to_status, note }) {
  await supabase.from('order_events').insert({ order_id, actor_id, actor_name, event_type, from_status, to_status, note });
}

export function orderTotal(o) {
  const qty = o.quantity || 1;
  const unit = Number(o.unit_price || 0);
  const fee = Number(o.delivery_fee || 0);
  return qty * unit + fee;
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
  const dispatchList = profiles.filter(p => p.role === 'dispatch');
  const selected = dispatchList.find(d => d.id === agentId);

  function stockFor(pid) {
    const row = agentStock.find(a => a.agent_id === agentId && a.product_id === pid);
    return row ? row.quantity : 0;
  }

  async function send(pid) {
    const amt = parseInt(amounts[pid], 10);
    if (!amt || amt <= 0 || !agentId) return;
    const existing = agentStock.find(a => a.agent_id === agentId && a.product_id === pid);
    const newQty = (existing ? existing.quantity : 0) + amt;
    await supabase.from('agent_stock').upsert({ agent_id: agentId, product_id: pid, quantity: newQty, updated_at: new Date().toISOString() }, { onConflict: 'agent_id,product_id' });
    setAmounts({ ...amounts, [pid]: '' });
    refresh();
  }

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Agent stock</h1><p className="page-sub">Send stock to a dispatch agent and see what they're currently holding.</p></div>
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
        <table>
          <thead><tr><th>Product</th><th>Agent currently holds</th><th>Send more</th></tr></thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td><span className="pill Delivered">{stockFor(p.id)} units</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <input
                    type="number" min="1" placeholder="qty"
                    value={amounts[p.id] || ''}
                    onChange={e => setAmounts({ ...amounts, [p.id]: e.target.value })}
                    style={{ width: '80px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                  />{' '}
                  <button className="link-btn" onClick={() => send(p.id)}>Send</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
export function ConfirmOrderModal({ order, profile, onClose, onConfirmed }) {
  const [priority, setPriority] = useState(order.priority || 'Normal');
  const [preferredTime, setPreferredTime] = useState(order.preferred_time || '');
  const [remark, setRemark] = useState('');

  async function confirm() {
    await supabase.from('orders').update({
      status: 'Confirmed', priority, preferred_time: preferredTime.trim(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    }).eq('id', order.id);
    await logEvent({ order_id: order.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: order.status, to_status: 'Confirmed' });
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
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={confirm}>Confirm order</button>
        </div>
      </div>
    </div>
  );
}


export function ReportsPage({ orders, profiles }) {
  const [range, setRange] = useState('today');

  function inRange(o) {
    const created = new Date(o.created_at);
    const now = new Date();
    if (range === 'today') return created.toDateString() === now.toDateString();
    if (range === '7d') return now - created <= 7 * 24 * 60 * 60 * 1000;
    if (range === '30d') return now - created <= 30 * 24 * 60 * 60 * 1000;
    return true;
  }

  const scoped = orders.filter(inRange);
  const delivered = scoped.filter(o => o.status === 'Delivered');
  const cancelled = scoped.filter(o => o.status === 'Cancelled');
  const revenue = delivered.reduce((sum, o) => sum + orderTotal(o), 0);

  const staffList = profiles.filter(p => p.role === 'staff' || p.role === 'dispatch');
  const perStaff = staffList.map(s => {
    const handled = scoped.filter(o => o.staff_id === s.id || o.dispatch_id === s.id);
    const done = handled.filter(o => o.status === 'Delivered' && o.delivered_at);
    const avgHours = done.length
      ? done.reduce((sum, o) => sum + (new Date(o.delivered_at) - new Date(o.created_at)) / 3600000, 0) / done.length
      : null;
    return { ...s, handled: handled.length, delivered: done.length, avgHours };
  });

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
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-num">{scoped.length}</div><div className="stat-label">Orders</div></div>
        <div className="stat"><div className="stat-num">{delivered.length}</div><div className="stat-label">Delivered</div></div>
        <div className="stat"><div className="stat-num">{cancelled.length}</div><div className="stat-label">Cancelled</div></div>
        <div className="stat"><div className="stat-num">₦{revenue.toLocaleString()}</div><div className="stat-label">Revenue (delivered)</div></div>
      </div>
      <h3 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '16px', marginBottom: '10px' }}>Staff & dispatch performance</h3>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>State</th><th>Orders handled</th><th>Delivered</th><th>Avg. turnaround</th></tr></thead>
        <tbody>
          {perStaff.length === 0 && <tr><td colSpan="6" className="empty">No staff or dispatch partners yet.</td></tr>}
          {perStaff.map(s => (
            <tr key={s.id}>
              <td>{s.full_name}{!s.active && <span style={{ color: '#8A93A0', fontSize: '11px' }}> (inactive)</span>}</td>
              <td style={{ fontSize: '12px', color: '#8A93A0' }}>{s.role}</td>
              <td style={{ fontSize: '12px', color: '#8A93A0' }}>{s.state || '—'}</td>
              <td>{s.handled}</td>
              <td>{s.delivered}</td>
              <td>{s.avgHours ? s.avgHours.toFixed(1) + ' hrs' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
    </div>
  );
}

// ---------- Settings: messaging toggles + external dispatch companies ----------
export function SettingsPage({ settings, refresh }) {
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('whatsapp');

  useEffect(() => { loadCompanies(); }, []);
  async function loadCompanies() {
    const { data } = await supabase.from('dispatch_companies').select('*').order('created_at', { ascending: false });
    setCompanies(data || []);
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
        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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

// ---------- Inventory ----------
export function InventoryPage({ products, orders, refresh }) {
  const [edits, setEdits] = useState({});

  async function adjust(p, delta) {
    const next = Math.max(0, p.stock_quantity + delta);
    await supabase.from('products').update({ stock_quantity: next }).eq('id', p.id);
    refresh();
  }
  async function setExact(p) {
    const val = parseInt(edits[p.id], 10);
    if (isNaN(val)) return;
    await supabase.from('products').update({ stock_quantity: Math.max(0, val) }).eq('id', p.id);
    setEdits({ ...edits, [p.id]: '' });
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
        <div><h1 className="page-title">Inventory</h1><p className="page-sub">Stock automatically drops as orders come in.</p></div>
      </div>
      <table>
        <thead><tr><th>Product</th><th>In stock</th><th>Low stock alert below</th><th>Adjust</th></tr></thead>
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
                  <button className="btn" onClick={() => adjust(p, -1)}>−</button>{' '}
                  <button className="btn" onClick={() => adjust(p, 1)}>+</button>{' '}
                  <input
                    placeholder="set exact"
                    value={edits[p.id] || ''}
                    onChange={e => setEdits({ ...edits, [p.id]: e.target.value })}
                    style={{ width: '80px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px' }}
                  />{' '}
                  <button className="link-btn" onClick={() => setExact(p)}>Set</button>
                </td>
              </tr>
            );
          })}
          {products.length === 0 && <tr><td colSpan="4" className="empty">Add products first.</td></tr>}
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

  useEffect(() => {
    (async () => {
      let query = supabase.from('order_events').select('*').order('created_at', { ascending: false }).limit(15);
      const { data } = await query;
      setEvents(data || []);
    })();
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <button className="switch-out" onClick={() => setOpen(!open)} style={{ marginBottom: '8px' }}>
        🔔 Recent activity
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: '30px', left: 0, background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', width: '280px', maxHeight: '320px', overflowY: 'auto', padding: '10px', zIndex: 60, boxShadow: '0 10px 30px rgba(0,0,0,.15)' }}>
          {events.length === 0 && <div style={{ fontSize: '12px', color: '#8A93A0', padding: '8px' }}>No recent activity.</div>}
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
