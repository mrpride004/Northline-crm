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

// ---------- Reports ----------
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
      <h3 style={{ fontFamily: 'Georgia,serif', fontSize: '16px', marginBottom: '10px' }}>Staff & dispatch performance</h3>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Orders handled</th><th>Delivered</th><th>Avg. turnaround</th></tr></thead>
        <tbody>
          {perStaff.length === 0 && <tr><td colSpan="5" className="empty">No staff or dispatch partners yet.</td></tr>}
          {perStaff.map(s => (
            <tr key={s.id}>
              <td>{s.full_name}</td>
              <td style={{ fontSize: '12px', color: '#8A93A0' }}>{s.role}</td>
              <td>{s.handled}</td>
              <td>{s.delivered}</td>
              <td>{s.avgHours ? s.avgHours.toFixed(1) + ' hrs' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
